import {createHash, randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {EvidenceSnapshotSummary} from '../modules/evidence/index.js';
import type {SourceConnectorDocument} from '../modules/subscriptions/source_connector.js';
import type {ReviewSourceSubscription} from '../storage/review_preferences_store.js';
import type {
  HistoryArticle,
  HistoryPage,
  SourceHistoryReader,
} from '../modules/subscriptions/source_history.js';
import {
  historyIdentity,
  historyUrl,
} from '../modules/subscriptions/source_history.js';
import {OperationError} from './operation_error.js';
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
export const historySchemas = {
  history_restore: z
    .object({
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
interface SourceState {
  subscriptionId: string;
  label: string;
  base: string;
  queue: HistoryPage[];
  seen: Set<string>;
  pageFingerprints: Set<string>;
  methods: Set<string>;
  failed: {page: HistoryPage; code: string}[];
  busy: boolean;
  rateLimited: boolean;
  count: number;
  limited: boolean;
  custom: boolean;
}
interface Session {
  id: string;
  touched: number;
  sources: Map<string, SourceState>;
  articles: Map<string, HistoryArticle>;
  plan?: {
    id: string;
    ids: Set<string>;
    from: string | undefined;
    to: string | undefined;
  };
}
interface Dependencies {
  sources: () => Promise<readonly ReviewSourceSubscription[]>;
  snapshots: () => Promise<readonly EvidenceSnapshotSummary[]>;
  reader: SourceHistoryReader;
  importArticle: (
    source: ReviewSourceSubscription,
    document: SourceConnectorDocument,
  ) => Promise<{snapshotId: string; outcome: 'created' | 'existing'}>;
}
export class SourceHistoryService {
  private readonly sessions = new Map<string, Session>();
  private write: Promise<unknown> = Promise.resolve();
  public constructor(private readonly deps: Dependencies) {}
  public async execute(
    name: keyof typeof historySchemas,
    input: unknown,
  ): Promise<unknown> {
    const parsed = historySchemas[name].safeParse(input);
    if (!parsed.success)
      throw new OperationError('invalid_input', 'history_invalid_request');
    const value = parsed.data;
    if (name === 'history_restore' && 'articles' in value) {
      const ids = [...new Set(value.articles.map((a) => a.subscriptionId))];
      if (ids.length > 32)
        throw new OperationError('invalid_input', 'history_invalid_request');
      const opened = await this.open(
        ids.map((subscriptionId) => ({subscriptionId})),
      );
      const session = this.session(opened.sessionId);
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
        return {sessionId: session.id, sources: this.state(session)};
      } catch (error) {
        this.sessions.delete(session.id);
        throw error;
      }
    }
    if (name === 'history_open' && 'sources' in value)
      return this.open(value.sources);
    if (!('sessionId' in value))
      throw new OperationError('invalid_input', 'history_invalid_request');
    if (name === 'history_close') {
      this.sessions.delete(value.sessionId);
      return {closed: true};
    }
    const session = this.session(value.sessionId);
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
      return {
        item,
        body: new TextDecoder().decode(result.document.sourceUtf8),
        access: result.access,
      };
    }
    if (name === 'history_prepare_import') {
      const request = historySchemas.history_prepare_import.parse(input);
      const action = this.write
        .catch(() => undefined)
        .then(() => {
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
                (!item.publishedAt ||
                  item.publishedAt.slice(0, 10) > request.to))
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
          const plan = {
            id: randomUUID(),
            ids,
            from: request.from,
            to: request.to,
          };
          session.plan = plan;
          return {planId: plan.id};
        });
      this.write = action;
      return action;
    }
    if (name === 'history_import') {
      const request = historySchemas.history_import.parse(input);
      // Serialize selected imports; retries first check canonical addresses in durable evidence.
      const action = this.write
        .catch(() => undefined)
        .then(() => {
          if (
            session.plan?.id !== request.planId ||
            request.ids.some((id) => !session.plan?.ids.has(id))
          )
            throw new OperationError('conflict', 'history_selection_changed');
          return this.import(session, request.ids, session.plan);
        });
      this.write = action;
      return action;
    }
    const query =
      name === 'history_select'
        ? historySchemas.history_select.parse(input)
        : historySchemas.history_list.parse(input);
    const existing = await this.existing();
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
        if (existing.has(historyIdentity(a.url))) return false;
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
        articles: selected.map(({id, subscriptionId}) => ({
          id,
          subscriptionId,
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
        existingSnapshotId: existing.get(historyIdentity(a.url)),
      })),
    };
  }
  private async open(
    request: {subscriptionId: string; archiveUrl?: string | undefined}[],
  ) {
    for (const [key, session] of this.sessions)
      if (Date.now() - session.touched > 2 * 60 * 60 * 1000)
        this.sessions.delete(key);
    if (this.sessions.size >= 8)
      throw new OperationError('conflict', 'history_session_limit');
    const configured = await this.deps.sources();
    const session: Session = {
      id: randomUUID(),
      touched: Date.now(),
      sources: new Map(),
      articles: new Map(),
    };
    for (const selection of request) {
      const source = configured.find(
        (s) => s.subscriptionId === selection.subscriptionId && !s.isPrivate,
      );
      if (!source || (source.kind !== 'rss_atom' && source.kind !== 'web'))
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
    this.sessions.set(session.id, session);
    return {sessionId: session.id, sources: this.state(session)};
  }
  private session(id: string) {
    const session = this.sessions.get(id);
    if (!session || Date.now() - session.touched > 2 * 60 * 60 * 1000) {
      this.sessions.delete(id);
      throw new OperationError('not_found', 'history_session_expired');
    }
    session.touched = Date.now();
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
    if (!state || !source || base !== state.base)
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
  private async existing() {
    const map = new Map<string, string>();
    for (const s of await this.deps.snapshots())
      if (!s.isPrivate && s.canonicalUri) {
        try {
          map.set(historyIdentity(s.canonicalUri), s.snapshotId);
        } catch {
          /* Legacy non-URL evidence. */
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
    const existing = await this.existing(),
      results: {
        id: string;
        status: 'imported' | 'existing' | 'failed';
        snapshotId?: string;
        code?: string;
      }[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        const item = this.item(session, id),
          source = await this.currentSource(session, item.subscriptionId);
        const prior = existing.get(historyIdentity(item.url));
        if (prior) {
          results.push({id, status: 'existing', snapshotId: prior});
          continue;
        }
        const result = await this.deps.reader.article(item);
        this.enrich(item, result);
        if (
          (plan.from &&
            (!item.publishedAt || item.publishedAt.slice(0, 10) < plan.from)) ||
          (plan.to &&
            (!item.publishedAt || item.publishedAt.slice(0, 10) > plan.to))
        )
          throw new OperationError('conflict', 'history_selection_changed');
        const canonical = historyIdentity(result.document.canonicalUri),
          duplicate = existing.get(canonical);
        if (duplicate) {
          results.push({id, status: 'existing', snapshotId: duplicate});
          continue;
        }
        const imported = await this.deps.importArticle(source, result.document);
        existing.set(canonical, imported.snapshotId);
        existing.set(historyIdentity(item.url), imported.snapshotId);
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
    return {results};
  }
}
