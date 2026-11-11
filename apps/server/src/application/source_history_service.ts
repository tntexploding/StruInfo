import {createHash, randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {SourceConnectorDocument} from '../modules/subscriptions/source_connector.js';
import type {ReviewSourceSubscription} from '../storage/review_preferences_store.js';
import type {
  HistoryArticle,
  HistoryPage,
  SourceHistoryReader,
  HistoryItemResult,
  HistorySession as Session,
  HistoryCheckpointStore,
} from '../modules/subscriptions/source_history.js';
import {
  historyIdentity,
  historyUrl,
} from '../modules/subscriptions/source_history.js';
import {OperationError} from './operation_error.js';
import {
  advanceHistoryTasks,
  pauseHistoryTasks,
  type HistoryTaskPorts,
} from './source_history_processing.js';
const batchKey = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/u);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine(
    (s) =>
      Number.isFinite(Date.parse(s)) && new Date(s).toISOString().startsWith(s),
  );
const articleId = z.string().regex(/^[a-f0-9]{64}$/u);
const perSourceLimit = z.number().int().min(1).max(5000).optional();
const filter = {
  subscriptionIds: z.array(z.uuid()).max(32).optional(),
  text: z.string().trim().max(200).default(''),
  from: day.optional(),
  to: day.optional(),
};
const ordered = (v: {from?: string | undefined; to?: string | undefined}) =>
  !v.from || !v.to || v.from <= v.to;
const selection = z
  .object({
    text: filter.text,
    from: day.optional(),
    to: day.optional(),
    perSourceLimit,
  })
  .strict()
  .refine(ordered);
export const historySchemas = {
  history_items: z
    .object({sessionId: z.uuid(), offset: z.number().int().min(0).default(0)})
    .strict(),
  history_status: z.object({sessionId: z.uuid().optional()}).strict(),
  history_run: z.discriminatedUnion('action', [
    z
      .object({
        sessionId: z.uuid(),
        action: z.literal('process'),
        planId: z.uuid(),
        budgetId: batchKey,
        retryFailed: z.boolean().default(false),
        maxModelCalls: z.number().int().min(1).max(64).optional(),
        legacyEntryLimit: z.number().int().min(1).max(64).optional(),
      })
      .strict(),
    z
      .object({
        sessionId: z.uuid(),
        action: z.literal('scan'),
        retryFailed: z.boolean().default(false),
      })
      .strict(),
    z
      .object({
        sessionId: z.uuid(),
        action: z.literal('import'),
        planId: z.uuid(),
        retryFailed: z.boolean().default(false),
      })
      .strict(),
    z.object({sessionId: z.uuid(), action: z.literal('pause')}).strict(),
  ]),
  history_restore: z
    .object({
      batchKey: batchKey.optional(),
      legacyOwned: z
        .record(articleId, z.uuid().nullable())
        .refine((v) => Object.keys(v).length <= 5000)
        .optional(),
      articles: z
        .array(
          z
            .object({
              subscriptionId: z.uuid(),
              url: z.url().max(2000),
              title: z.string().max(1000),
              publishedAt: z.iso.datetime({offset: true}).optional(),
              dateInferred: z.boolean().optional(),
              titleFromUrl: z.boolean().optional(),
              access: z.enum(['public', 'restricted', 'unknown']),
            })
            .strict(),
        )
        .min(1)
        .max(5000),
    })
    .strict(),
  history_close: z.object({sessionId: z.uuid()}).strict(),
  history_open: z
    .object({
      selection: selection.optional(),
      sources: z
        .array(
          z
            .object({
              subscriptionId: z.uuid(),
              archiveUrl: z.url().max(2000).optional(),
            })
            .strict(),
        )
        .min(1)
        .max(32),
    })
    .strict(),
  history_scan: z
    .object({
      sessionId: z.uuid(),
      subscriptionId: z.uuid(),
      retry: z.boolean().default(false),
    })
    .strict(),
  history_list: z
    .object({
      sessionId: z.uuid(),
      ...filter,
      offset: z.number().int().min(0).default(0),
    })
    .strict()
    .refine(ordered),
  history_select: z
    .object({sessionId: z.uuid(), ...filter, perSourceLimit})
    .strict()
    .refine(ordered),
  history_preview: z
    .object({sessionId: z.uuid(), id: z.string().regex(/^[a-f0-9]{64}$/u)})
    .strict(),
  history_prepare_import: z
    .object({
      sessionId: z.uuid(),
      ids: z.array(articleId).min(1).max(5000),
      ...filter,
      perSourceLimit,
    })
    .strict()
    .refine(ordered),
  history_import: z
    .object({
      sessionId: z.uuid(),
      planId: z.uuid(),
      ids: z
        .array(z.string().regex(/^[a-f0-9]{64}$/u))
        .min(1)
        .max(8),
    })
    .strict(),
};
interface Dependencies {
  tasks?: HistoryTaskPorts;
  checkpoint?: HistoryCheckpointStore;
  onCheckpointError?: () => void;
  documentProgress?: (refs: {id: string; taskId?: string}[]) => Promise<
    Map<
      string,
      {
        receipt?: string | undefined;
        decision?: string | undefined;
        publishedEntries?: number | undefined;
        phase?: string | undefined;
        status?: string | undefined;
        errorCode?: string | undefined;
        calls?: number | undefined;
        entryLimit?: number | undefined;
      }
    >
  >;
  publicReceipts: (sourceIds: string[]) => Promise<
    readonly {
      subscriptionId: string;
      canonicalUri: string;
      snapshotId: string;
      historyImportKey?: string;
    }[]
  >;
  sources: () => Promise<readonly ReviewSourceSubscription[]>;
  reader: SourceHistoryReader;
  importArticle: (
    source: ReviewSourceSubscription,
    document: SourceConnectorDocument,
    historyImportKey: string,
  ) => Promise<{snapshotId: string; outcome: 'created' | 'existing'}>;
}
export class SourceHistoryService {
  private readonly sessions = new Map<string, Session>();
  private write: Promise<unknown> = Promise.resolve();
  private initialized: Promise<void> | undefined;
  private running: Promise<void> | undefined;
  private stopping = false;
  public constructor(private readonly deps: Dependencies) {}
  private ready() {
    return (this.initialized ??= (async () => {
      for (const session of (await this.deps.checkpoint?.load()) ?? [])
        this.sessions.set(session.id, session);
    })().catch(() => {
      this.initialized = undefined;
      throw new OperationError('rejected', 'history_checkpoint_failed');
    }));
  }
  private serial<T>(work: () => Promise<T>) {
    const next = this.write.catch(() => undefined).then(work);
    this.write = next;
    return next;
  }
  private async save(
    session: Session,
    changed: readonly HistoryArticle[] = [],
  ) {
    session.touched = Date.now();
    try {
      await this.deps.checkpoint?.save(session, changed);
    } catch {
      this.sessions.clear();
      this.initialized = undefined;
      throw new OperationError('rejected', 'history_checkpoint_failed');
    }
  }
  public async execute(
    name: keyof typeof historySchemas,
    input: unknown,
  ): Promise<unknown> {
    await this.ready();
    if (
      name === 'history_status' ||
      name === 'history_items' ||
      name === 'history_select' ||
      name === 'history_list'
    )
      return this.command(name, input);
    return this.serial(() => this.command(name, input));
  }
  private async command(
    name: keyof typeof historySchemas,
    input: unknown,
  ): Promise<unknown> {
    const parsed = historySchemas[name].safeParse(input);
    if (!parsed.success)
      throw new OperationError('invalid_input', 'history_invalid_request');
    const value = parsed.data;
    if (name === 'history_status') {
      const {sessionId} = historySchemas.history_status.parse(input);
      const configured = await this.deps.sources();
      const sessions = sessionId
        ? [this.session(sessionId)]
        : [...this.sessions.values()];
      return {
        ...(sessionId && this.deps.tasks
          ? {
              budget: await this.deps.tasks.limits().then(
                (v) => v.budget,
                () => null,
              ),
            }
          : {}),
        sessions: sessions
          .filter((s) =>
            [...s.sources.keys()].every((id) =>
              configured.some((c) => c.subscriptionId === id && !c.isPrivate),
            ),
          )
          .sort((a, b) => b.touched - a.touched)
          .map((s) => this.progress(s, Boolean(sessionId))),
      };
    }
    if (name === 'history_restore' && 'articles' in value) {
      const request = historySchemas.history_restore.parse(input);
      const bound =
        request.batchKey &&
        [...this.sessions.values()].find(
          (s) => s.batchKey === request.batchKey,
        );
      if (bound) {
        const same = new Set(
          request.articles.map((row) =>
            createHash('sha256')
              .update(row.subscriptionId + '\0' + historyIdentity(row.url))
              .digest('hex'),
          ),
        );
        const ids = bound.plan?.ids ?? new Set(bound.articles.keys());
        if (same.size !== ids.size || [...ids].some((id) => !same.has(id)))
          throw new OperationError('conflict', 'history_selection_changed');
        for (const id of bound.sources.keys())
          await this.currentSource(bound, id);
        return {sessionId: bound.id, sources: this.state(bound)};
      }
      const ids = [...new Set(value.articles.map((a) => a.subscriptionId))];
      if (ids.length > 32)
        throw new OperationError('invalid_input', 'history_invalid_request');
      const opened = await this.open(
        ids.map((subscriptionId) => ({subscriptionId})),
      );
      const session = this.session(opened.sessionId);
      if (request.batchKey) session.batchKey = request.batchKey;
      if (request.legacyOwned && request.batchKey)
        session.legacyOwned = request.legacyOwned;
      try {
        // Restored rows are untrusted directory hints, never receipt decisions.
        // Actual source bytes, access and publication are checked again on import.
        for (const row of value.articles) {
          const state = session.sources.get(row.subscriptionId);
          const url = state && historyUrl(row.url, state.base);
          if (!url)
            throw new OperationError(
              'invalid_input',
              'history_article_not_same_site',
            );
          const id = createHash('sha256')
            .update(row.subscriptionId + '\0' + historyIdentity(url))
            .digest('hex');
          session.articles.set(id, {
            subscriptionId: row.subscriptionId,
            title: row.title,
            access: row.access,
            url,
            id,
            ...(row.publishedAt !== undefined
              ? {publishedAt: row.publishedAt}
              : {}),
            ...(row.dateInferred !== undefined
              ? {dateInferred: row.dateInferred}
              : {}),
            ...(row.titleFromUrl !== undefined
              ? {titleFromUrl: row.titleFromUrl}
              : {}),
          });
        }
        for (const state of session.sources.values()) {
          state.count = [...session.articles.values()].filter(
            (a) => a.subscriptionId === state.subscriptionId,
          ).length;
          state.queue = [];
          state.methods.add('恢复的选定目录');
          // A selection is not proof that a publisher's full archive was scanned.
          state.limited = true;
        }
        await this.save(session, [...session.articles.values()]);
        return {sessionId: session.id, sources: this.state(session)};
      } catch (error) {
        this.sessions.delete(session.id);
        await this.deps.checkpoint?.remove(session.id);
        throw error;
      }
    }
    if (name === 'history_open' && 'sources' in value)
      return this.open(value.sources, value.selection);
    if (!('sessionId' in value))
      throw new OperationError('invalid_input', 'history_invalid_request');
    if (name === 'history_close') {
      const id = z.uuid().parse(value.sessionId);
      if (this.sessions.get(id)?.work)
        throw new OperationError('conflict', 'history_batch_busy');
      await this.deps.checkpoint?.remove(id);
      this.sessions.delete(id);
      return {closed: true};
    }
    const session = this.session(z.uuid().parse(value.sessionId));
    if (name === 'history_items') {
      for (const sourceId of session.sources.keys())
        await this.currentSource(session, sourceId);
      const {offset} = historySchemas.history_items.parse(input),
        plan = session.plan;
      const selected = [...(plan?.ids ?? [])];
      const items = selected.slice(offset, offset + 25).map((id) => ({
        id,
        title: this.item(session, id).title,
        ...(plan?.results.get(id) ?? {status: 'pending' as const}),
      }));
      const refs = items.flatMap((item) =>
        'snapshotId' in item && item.snapshotId
          ? [
              {
                id: item.snapshotId,
                ...(item.job?.taskId ? {taskId: item.job.taskId} : {}),
              },
            ]
          : [],
      );
      const states = refs.length
        ? await this.deps.documentProgress?.(refs)
        : undefined;
      return {
        offset,
        total: selected.length,
        items: items.map((item) => ({
          ...item,
          ...('snapshotId' in item && item.snapshotId
            ? {document: states?.get(item.snapshotId)}
            : {}),
        })),
      };
    }
    if (name === 'history_run') {
      const run = historySchemas.history_run.parse(input);
      if (run.action === 'pause') {
        delete session.work;
        if (
          session.plan?.processing &&
          session.plan.processing.state !== 'finished'
        ) {
          session.plan.processing.state = 'paused';
          await this.save(session);
          if (this.deps.tasks)
            await pauseHistoryTasks(session, this.deps.tasks);
        }
      } else {
        for (const id of session.sources.keys())
          await this.currentSource(session, id);
        if (
          session.work === 'process' &&
          run.action === 'import' &&
          !run.retryFailed &&
          session.plan?.id === run.planId
        )
          return this.progress(session, true);
        if (
          session.work &&
          session.work !== run.action &&
          !(session.work === 'import' && run.action === 'process')
        )
          throw new OperationError('conflict', 'history_batch_busy');
        if (run.action === 'scan') {
          if (session.plan)
            throw new OperationError('conflict', 'history_selection_changed');
          if (run.retryFailed)
            for (const source of session.sources.values()) {
              source.queue.push(...source.failed.map((f) => f.page));
              source.failed = [];
              source.rateLimited = false;
            }
        } else {
          const plan = session.plan;
          if (plan?.id !== run.planId)
            throw new OperationError('conflict', 'history_selection_changed');
          plan.background = true;
          if (run.action === 'process') {
            const limits = await this.deps.tasks?.limits();
            if (
              limits?.budget?.batchId !== run.budgetId ||
              limits.budget.model !== limits.model ||
              limits.budget.paused ||
              limits.budget.remainingCny <= 0
            )
              throw new OperationError('rejected', 'history_budget_required');
            const prior = plan.processing;
            if (
              (prior && prior.budgetId !== run.budgetId) ||
              (session.batchKey && session.batchKey !== run.budgetId)
            )
              throw new OperationError('conflict', 'history_budget_changed');
            if (run.retryFailed) {
              for (const row of plan.results.values())
                if (
                  row.job?.finished &&
                  !row.job.taskId &&
                  row.job.reason &&
                  row.job.reason !== 'history_receipt_changed'
                )
                  delete row.job;
            } else if (prior?.state === 'finished')
              return this.progress(session, true);
            plan.processing = {
              ...(prior ?? {
                budgetId: run.budgetId,
                maxModelCalls: Math.min(
                  run.maxModelCalls ?? limits.maxModelCalls,
                  limits.maxModelCalls,
                ),
                ...(run.legacyEntryLimit
                  ? {legacyEntryLimit: run.legacyEntryLimit}
                  : {}),
              }),
              state: 'running',
            };
          } else if (run.retryFailed) {
            if (plan.processing?.state === 'finished')
              plan.processing.state = 'paused';
            for (const [id, row] of plan.results)
              if (row.status === 'failed') plan.results.delete(id);
          }
        }
        session.work = run.action;
        delete session.problem;
      }
      await this.save(session);
      if (session.work) this.poll();
      return this.progress(session, true);
    }
    if (session.work && name === 'history_prepare_import') {
      const proposed = historySchemas.history_prepare_import.parse(input),
        previous = session.plan;
      if (
        previous &&
        previous.from === proposed.from &&
        previous.to === proposed.to &&
        previous.ids.size === new Set(proposed.ids).size &&
        proposed.ids.every((id) => previous.ids.has(id))
      )
        return {sessionId: session.id, planId: previous.id};
    }
    if (session.work && !['history_list', 'history_select'].includes(name))
      throw new OperationError('conflict', 'history_batch_busy');
    if (name === 'history_scan') {
      const request = historySchemas.history_scan.parse(input);
      return this.scan(session, request.subscriptionId, request.retry);
    }
    if (name === 'history_preview') {
      const item = this.item(
        session,
        historySchemas.history_preview.parse(input).id,
      );
      await this.currentSource(session, item.subscriptionId);
      const result = await this.deps.reader.article(item);
      this.enrich(item, result);
      await this.save(session, [item]);
      return {
        item,
        body: new TextDecoder().decode(result.document.sourceUtf8),
        access: result.access,
      };
    }
    if (name === 'history_prepare_import') {
      const request = historySchemas.history_prepare_import.parse(input);
      const ids = new Set(request.ids),
        counts = new Map<string, number>();
      for (const id of ids) {
        const item = this.item(session, id);
        if (
          (request.subscriptionIds &&
            !request.subscriptionIds.includes(item.subscriptionId)) ||
          (request.from &&
            (!item.publishedAt ||
              item.publishedAt.slice(0, 10) < request.from)) ||
          (request.to &&
            (!item.publishedAt || item.publishedAt.slice(0, 10) > request.to))
        )
          throw new OperationError('conflict', 'history_selection_changed');
        const count = (counts.get(item.subscriptionId) ?? 0) + 1;
        if (
          request.perSourceLimit !== undefined &&
          count > request.perSourceLimit
        )
          throw new OperationError(
            'invalid_input',
            'history_source_limit_exceeded',
          );
        counts.set(item.subscriptionId, count);
      }
      const previous = session.plan;
      const canonical = [...this.sessions.values()].find(
        (s) =>
          s.id !== session.id &&
          s.plan?.from === request.from &&
          s.plan?.to === request.to &&
          s.plan?.ids.size === ids.size &&
          [...ids].every((id) => s.plan?.ids.has(id)),
      );
      if (!previous && canonical?.plan) {
        for (const id of canonical.sources.keys())
          await this.currentSource(canonical, id);
        if (
          session.batchKey &&
          ((canonical.batchKey && session.batchKey !== canonical.batchKey) ||
            (canonical.plan.processing &&
              session.batchKey !== canonical.plan.processing.budgetId))
        )
          throw new OperationError('conflict', 'history_selection_changed');
        if (session.batchKey) canonical.batchKey = session.batchKey;
        if (session.legacyOwned) canonical.legacyOwned = session.legacyOwned;
        await this.save(canonical);
        await this.deps.checkpoint?.remove(session.id);
        this.sessions.delete(session.id);
        return {sessionId: canonical.id, planId: canonical.plan.id};
      }
      if (
        previous &&
        previous.from === request.from &&
        previous.to === request.to &&
        ids.size === previous.ids.size &&
        [...ids].every((id) => previous.ids.has(id))
      ) {
        return {sessionId: session.id, planId: previous.id};
      }
      if (previous?.background || (previous && session.batchKey))
        throw new OperationError('conflict', 'history_selection_changed');
      const plan = {
        id: randomUUID(),
        ids,
        from: request.from,
        to: request.to,
        results: new Map<string, HistoryItemResult>(),
      };
      session.plan = plan;
      await this.save(session);
      return {sessionId: session.id, planId: plan.id};
    }
    if (name === 'history_import') {
      const request = historySchemas.history_import.parse(input);
      // Serialize selected imports; retries first check canonical addresses in durable evidence.
      if (
        session.plan?.id !== request.planId ||
        request.ids.some((id) => !session.plan?.ids.has(id))
      )
        throw new OperationError('conflict', 'history_selection_changed');
      return this.import(session, request.ids, session.plan);
    }
    const query =
      name === 'history_select'
        ? historySchemas.history_select.parse(input)
        : historySchemas.history_list.parse(input);
    for (const id of session.sources.keys())
      await this.currentSource(session, id);
    const existing = await this.existing(session);
    const all = [...session.articles.values()].filter(
      (a) =>
        (!query.subscriptionIds ||
          query.subscriptionIds.includes(a.subscriptionId)) &&
        (!query.text ||
          (a.title + ' ' + a.url)
            .toLowerCase()
            .includes(query.text.toLowerCase())),
    );
    const undated = all.filter((a) => !a.publishedAt).length;
    const rows = all
      .filter(
        (a) =>
          (!query.from ||
            Boolean(
              a.publishedAt && a.publishedAt.slice(0, 10) >= query.from,
            )) &&
          (!query.to ||
            Boolean(a.publishedAt && a.publishedAt.slice(0, 10) <= query.to)),
      )
      .sort(
        (a, b) =>
          (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') ||
          a.id.localeCompare(b.id),
      );
    if (name === 'history_select') {
      const request = historySchemas.history_select.parse(input);
      const counts = new Map<string, number>();
      const selected = rows.filter((a) => {
        if (existing.has(this.receiptKey(a.subscriptionId, a.url)))
          return false;
        const count = counts.get(a.subscriptionId) ?? 0;
        if (
          request.perSourceLimit !== undefined &&
          count >= request.perSourceLimit
        )
          return false;
        counts.set(a.subscriptionId, count + 1);
        return true;
      });
      const ids = selected.map((a) => a.id);
      if (ids.length > 5000)
        throw new OperationError(
          'invalid_input',
          'history_selection_too_large',
        );
      return {
        ids,
        articles: selected.map(({id, subscriptionId, title, publishedAt}) => ({
          id,
          subscriptionId,
          title,
          publishedAt,
        })),
        undated,
        sources: this.state(session),
      };
    }
    const offset =
      'offset' in query && typeof query.offset === 'number' ? query.offset : 0;
    return {
      sessionId: session.id,
      sources: this.state(session),
      total: rows.length,
      undated,
      offset,
      articles: rows.slice(offset, offset + 50).map((a) => ({
        ...a,
        existingSnapshotId: existing.get(
          this.receiptKey(a.subscriptionId, a.url),
        )?.snapshotId,
      })),
    };
  }
  private async open(
    request: {subscriptionId: string; archiveUrl?: string | undefined}[],
    preset?: z.infer<typeof selection>,
  ) {
    for (const [key, session] of this.sessions)
      if (
        !this.deps.checkpoint &&
        !session.work &&
        Date.now() - session.touched > 2 * 60 * 60 * 1000
      )
        this.sessions.delete(key);
    if (
      [...this.sessions.values()].filter(
        (s) =>
          Boolean(s.work) || !s.plan || s.plan.results.size < s.plan.ids.size,
      ).length >= 8
    )
      throw new OperationError('conflict', 'history_session_limit');
    const configured = await this.deps.sources();
    const session: Session = {
      id: randomUUID(),
      touched: Date.now(),
      parts: 0,
      ...(preset ? {selection: preset} : {}),
      sources: new Map(),
      articles: new Map(),
    };
    for (const selection of request) {
      const source = configured.find(
        (s) => s.subscriptionId === selection.subscriptionId && !s.isPrivate,
      );
      if (
        !source ||
        source.receiving?.history === 'none' ||
        (source.kind !== 'rss_atom' && source.kind !== 'web')
      )
        throw new OperationError('invalid_input', 'history_source_unsupported');
      const base = source.kind === 'rss_atom' ? source.feedUrl : source.pageUrl;
      const archive = selection.archiveUrl
        ? historyUrl(selection.archiveUrl, base)
        : undefined;
      if (selection.archiveUrl && !archive)
        throw new OperationError(
          'invalid_input',
          'history_archive_not_same_site',
        );
      const queue: HistoryPage[] =
        source.kind === 'rss_atom' ? [{kind: 'feed', url: base}] : [];
      queue.push(
        archive
          ? {
              kind: /\.xml(?:\?|$)/u.test(archive) ? 'sitemap' : 'html',
              url: archive,
            }
          : {kind: 'robots', url: new URL('/robots.txt', base).href},
      );
      session.sources.set(source.subscriptionId, {
        subscriptionId: source.subscriptionId,
        label: source.label,
        base,
        queue,
        seen: new Set(),
        pageFingerprints: new Set(),
        methods: new Set(),
        failed: [],
        busy: false,
        rateLimited: false,
        count: 0,
        limited: false,
        custom: Boolean(archive),
      });
    }
    await this.save(session);
    this.sessions.set(session.id, session);
    return {sessionId: session.id, sources: this.state(session)};
  }
  private session(id: string) {
    const session = this.sessions.get(id);
    if (
      !session ||
      (!this.deps.checkpoint &&
        !session.work &&
        Date.now() - session.touched > 2 * 60 * 60 * 1000)
    ) {
      this.sessions.delete(id);
      throw new OperationError('not_found', 'history_session_expired');
    }
    return session;
  }
  private item(session: Session, id: string) {
    const item = session.articles.get(id);
    if (!item)
      throw new OperationError('not_found', 'history_article_not_found');
    return item;
  }
  private async currentSource(session: Session, id: string) {
    const state = session.sources.get(id);
    const source = (await this.deps.sources()).find(
      (s) => s.subscriptionId === id && !s.isPrivate,
    );
    const base =
      source?.kind === 'rss_atom'
        ? source.feedUrl
        : source?.kind === 'web'
          ? source.pageUrl
          : undefined;
    if (
      !state ||
      !source ||
      source.receiving?.history === 'none' ||
      base !== state.base
    )
      throw new OperationError('conflict', 'history_source_changed');
    return source;
  }
  private async scan(session: Session, id: string, retry: boolean) {
    await this.currentSource(session, id);
    const source = session.sources.get(id);
    if (!source)
      throw new OperationError('not_found', 'history_source_not_found');
    if (source.busy)
      throw new OperationError('conflict', 'history_source_busy');
    if (source.rateLimited && !retry) return {sources: this.state(session)};
    if (retry) {
      source.rateLimited = false;
      source.queue.push(...source.failed.map((f) => f.page));
      source.failed = [];
    }
    const page = source.queue.shift();
    if (!page) return {sources: this.state(session)};
    source.busy = true;
    const changed: HistoryArticle[] = [];
    try {
      const result = await this.deps.reader.read(page, source.base);
      for (const row of result.articles) {
        const canonical = historyUrl(row.url, source.base);
        if (!canonical) continue;
        const key = createHash('sha256')
          .update(id + '\0' + historyIdentity(canonical))
          .digest('hex');
        const old = session.articles.get(key);
        if (!old && session.articles.size >= 100_000) {
          source.limited = true;
          source.queue = [];
          break;
        }
        if (!old)
          session.articles.set(key, {
            ...row,
            url: canonical,
            id: key,
            subscriptionId: id,
          });
        else
          session.articles.set(key, {
            ...old,
            ...(!row.titleFromUrl
              ? {title: row.title, titleFromUrl: false}
              : {}),
            ...(!old.publishedAt && row.publishedAt
              ? {publishedAt: row.publishedAt, dateInferred: row.dateInferred}
              : {}),
            ...(row.access !== 'unknown' ? {access: row.access} : {}),
          });
        changed.push(this.item(session, key));
      }
      source.count = [...session.articles.values()].filter(
        (a) => a.subscriptionId === id,
      ).length;
      source.methods.add(result.method);
      source.seen.add(page.url);
      if (result.replaceQueue && !source.custom) source.queue = [];
      // Broken APIs sometimes repeat their first page regardless of the cursor.
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(result.articles.map((a) => a.url)))
        .digest('hex');
      const paginated = page.kind === 'substack' || page.kind === 'wordpress';
      const repeated =
        paginated &&
        result.articles.length > 0 &&
        source.pageFingerprints.has(fingerprint);
      if (paginated) source.pageFingerprints.add(fingerprint);
      if (repeated) source.limited = true;
      for (const next of source.limited ? [] : result.next)
        if (
          !source.seen.has(next.url) &&
          !source.queue.some((p) => p.url === next.url) &&
          source.queue.length < 5000
        )
          source.queue.push(next);
    } catch (error) {
      const code =
        error instanceof Error ? error.message : 'history_read_failed';
      source.rateLimited = code === 'history_http_429';
      source.failed.push({
        page,
        code: code.startsWith('history_') ? code : 'history_read_failed',
      });
      if (
        !source.custom &&
        !source.rateLimited &&
        ['feed', 'robots', 'substack', 'wordpress', 'sitemap'].includes(
          page.kind,
        )
      ) {
        const fallback: HistoryPage =
          page.kind === 'feed'
            ? {kind: 'robots', url: new URL('/robots.txt', source.base).href}
            : page.kind === 'robots' ||
                page.kind === 'wordpress' ||
                page.kind === 'substack'
              ? {
                  kind: 'sitemap',
                  url: new URL('/sitemap.xml', source.base).href,
                }
              : {kind: 'html', url: new URL('.', source.base).href};
        if (
          !source.seen.has(fallback.url) &&
          !source.queue.some((p) => p.url === fallback.url) &&
          !source.failed.some((f) => f.page.url === fallback.url)
        )
          source.queue.push(fallback);
      }
    } finally {
      source.busy = false;
      session.touched = Date.now();
    }
    await this.save(session, changed);
    return {sources: this.state(session)};
  }
  private state(session: Session) {
    return [...session.sources.values()].map((s) => ({
      subscriptionId: s.subscriptionId,
      label: s.label,
      count: s.count,
      pending: s.rateLimited ? 0 : s.queue.length,
      busy: s.busy,
      status: s.busy
        ? 'loading'
        : s.rateLimited
          ? 'waiting'
          : s.queue.length
            ? 'more'
            : s.limited
              ? 'limited'
              : s.failed.length
                ? 'partial'
                : s.methods.has('公开文章目录')
                  ? 'directory_complete'
                  : 'index_complete',
      methods: [...s.methods],
      errors: s.failed.slice(-6).map((f) => ({url: f.page.url, code: f.code})),
    }));
  }
  private receiptKey(subscriptionId: string, url: string) {
    return subscriptionId + '\0' + historyIdentity(url);
  }
  private async existing(session: Session) {
    const map = new Map<
      string,
      {snapshotId: string; historyImportKey?: string}
    >();
    for (const row of await this.deps.publicReceipts([
      ...session.sources.keys(),
    ])) {
      try {
        map.set(this.receiptKey(row.subscriptionId, row.canonicalUri), row);
      } catch {
        /* Older receipts may contain non-URL addresses. */
      }
    }
    return map;
  }
  private enrich(
    item: HistoryArticle,
    result: Awaited<ReturnType<SourceHistoryReader['article']>>,
  ) {
    item.title = result.title;
    item.titleFromUrl = false;
    item.access = result.access;
    const pub = result.document.publication;
    if (pub?.instant) {
      item.publishedAt = pub.instant;
      item.dateInferred = pub.inferred;
    }
  }
  private async import(
    session: Session,
    ids: string[],
    plan: NonNullable<Session['plan']>,
  ) {
    const existing = await this.existing(session),
      results: HistoryItemResult[] = [];
    const changed: HistoryArticle[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        const item = this.item(session, id),
          source = await this.currentSource(session, item.subscriptionId);
        const finished = plan.results.get(id);
        if (finished && finished.status !== 'failed') {
          results.push({...finished, status: 'existing'});
          continue;
        }
        const prior = existing.get(
          this.receiptKey(item.subscriptionId, item.url),
        );
        if (prior) {
          results.push({
            id,
            status:
              prior.historyImportKey === plan.id + ':' + id
                ? 'imported'
                : 'existing',
            snapshotId: prior.snapshotId,
          });
          continue;
        }
        const result = await this.deps.reader.article(item);
        this.enrich(item, result);
        changed.push(item);
        if (result.access === 'restricted')
          throw new OperationError('rejected', 'history_article_restricted');
        if (
          (plan.from &&
            (!item.publishedAt || item.publishedAt.slice(0, 10) < plan.from)) ||
          (plan.to &&
            (!item.publishedAt || item.publishedAt.slice(0, 10) > plan.to))
        )
          throw new OperationError('conflict', 'history_selection_changed');
        const canonical = historyIdentity(result.document.canonicalUri),
          duplicate = existing.get(
            this.receiptKey(item.subscriptionId, canonical),
          );
        if (duplicate) {
          results.push({
            id,
            status:
              duplicate.historyImportKey === plan.id + ':' + id
                ? 'imported'
                : 'existing',
            snapshotId: duplicate.snapshotId,
          });
          continue;
        }
        const historyImportKey = plan.id + ':' + id;
        const imported = await this.deps.importArticle(
          source,
          result.document,
          historyImportKey,
        );
        existing.set(this.receiptKey(item.subscriptionId, canonical), {
          snapshotId: imported.snapshotId,
          historyImportKey,
        });
        existing.set(this.receiptKey(item.subscriptionId, item.url), {
          snapshotId: imported.snapshotId,
          historyImportKey,
        });
        results.push({
          id,
          status: imported.outcome === 'created' ? 'imported' : 'existing',
          snapshotId: imported.snapshotId,
        });
      } catch (error) {
        results.push({
          id,
          status: 'failed',
          code:
            error instanceof OperationError
              ? error.code
              : error instanceof Error && error.message.startsWith('history_')
                ? error.message
                : 'history_import_failed',
        });
      }
    }
    for (const row of results) {
      if (plan.results.get(row.id)?.status !== 'imported')
        plan.results.set(row.id, row);
    }
    await this.save(session, changed);
    return {results};
  }
  private progress(session: Session, detail: boolean) {
    const plan = session.plan,
      results = [...(plan?.results.values() ?? [])];
    return {
      sessionId: session.id,
      ...(session.batchKey ? {batchKey: session.batchKey} : {}),
      updatedAt: new Date(session.touched).toISOString(),
      sources: this.state(session),
      work: session.work ?? null,
      problem: session.problem,
      selection: session.selection,
      plan: plan
        ? {
            planId: plan.id,
            processing: plan.processing,
            submitted: results.filter((r) => r.job?.taskId).length,
            taskAttention: results.filter(
              (r) => r.job?.taskId && r.job.finished && r.job.reason,
            ).length,
            submissionFailures: results.filter(
              (r) =>
                r.job?.finished &&
                !r.job.taskId &&
                r.job.reason &&
                r.job.reason !== 'history_receipt_changed',
            ).length,
            selected: plan.ids.size,
            pending: plan.ids.size - results.length,
            imported: results.filter((r) => r.status === 'imported').length,
            existing: results.filter((r) => r.status === 'existing').length,
            failed: results.filter((r) => r.status === 'failed').length,
            ...(detail
              ? {
                  failures: results
                    .filter((r) => r.status === 'failed')
                    .map((r) => ({
                      ...r,
                      title: session.articles.get(r.id)?.title,
                    })),
                }
              : {}),
          }
        : null,
    };
  }
  public poll() {
    if (this.stopping || this.running) return;
    this.running = this.run().finally(() => {
      this.running = undefined;
    });
    void this.running.catch(() => this.deps.onCheckpointError?.());
  }
  private async run() {
    await this.ready();
    const waiting = new Set<string>();
    while (!this.stopping) {
      const session = [...this.sessions.values()]
        .filter((s) => s.work && !waiting.has(s.id))
        .sort((a, b) => a.touched - b.touched)[0];
      if (!session) return;
      await this.serial(async () => {
        if (!session.work || this.stopping) return;
        try {
          if (session.work === 'scan') {
            const source = [...session.sources.values()].find(
              (s) => s.queue.length && !s.rateLimited,
            );
            if (source) {
              await this.scan(session, source.subscriptionId, false);
              return;
            }
          } else if (session.plan) {
            if (
              session.work === 'process' &&
              this.deps.tasks &&
              session.plan.processing &&
              session.plan.results.size < session.plan.ids.size
            ) {
              const limits = await this.deps.tasks.limits();
              if (
                !limits.allowed ||
                limits.budget?.batchId !== session.plan.processing.budgetId ||
                limits.budget.paused ||
                limits.budget.remainingCny <= 0
              ) {
                session.plan.processing.wait = limits.allowed
                  ? 'budget_wait'
                  : 'dispatch_wait';
                waiting.add(session.id);
                await this.save(session);
                return;
              }
            }
            const pending = [...session.plan.ids]
              .filter((id) => !session.plan?.results.has(id))
              .slice(0, 8);
            if (pending.length) {
              await this.import(session, pending, session.plan);
              return;
            }
            if (
              session.work === 'process' &&
              session.plan.processing &&
              this.deps.tasks
            ) {
              for (const id of session.sources.keys())
                await this.currentSource(session, id);
              const policy = session.plan.processing;
              const state = await advanceHistoryTasks(
                session,
                this.deps.tasks,
                () => this.save(session),
              );
              if (state !== 'finished') {
                if (state !== 'again') waiting.add(session.id);
                if (state === 'again') delete policy.wait;
                else policy.wait = state;
                await this.save(session);
                return;
              }
              policy.state = 'finished';
              delete policy.wait;
            }
          }
        } catch (error) {
          if (
            error instanceof OperationError &&
            error.code === 'history_checkpoint_failed'
          )
            throw error;
          session.problem =
            error instanceof OperationError
              ? error.code
              : 'history_batch_interrupted';
          if (session.plan?.processing?.state === 'running')
            session.plan.processing.state = 'paused';
        }
        delete session.work;
        await this.save(session);
      });
    }
  }
  public async drain() {
    this.stopping = true;
    await this.running;
    await this.write.catch(() => undefined);
  }
}
