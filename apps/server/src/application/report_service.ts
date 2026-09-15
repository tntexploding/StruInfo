import {
  AI_PRICE_WAIT,
  isAiPriceWait,
} from '../modules/processing/ai_price_policy.js';
import type {InformationEntryRepositoryPort} from '../modules/entries/index.js';
import type {EvidenceReadRepositoryPort} from '../modules/evidence/index.js';
import {deriveProcessingRunId} from '../modules/processing/processing_identity.js';
import type {DocumentIntakeService} from './document_intake_service.js';
import type {ExecutionAuthority} from './execution_authority.js';
import {OperationError} from './operation_error.js';
import {
  reportEditSchema,
  reportPlanSchema,
  reportRequestSchema,
  reportStorySchema,
  type ReportEdit,
  type ReportRepository,
  type ReportRequest,
  type ReportProvider,
  type ReportState,
} from './report_contract.js';
import {renderReportMarkdown, validateReportState} from './report_content.js';
import {selectReportSources} from './report_selection.js';

export class ReportService {
  readonly #running = new Map<string, Promise<void>>();
  #tail: Promise<void> = Promise.resolve();
  #closing = false;
  public constructor(
    private readonly deps: {
      workspaceId: string;
      repository: ReportRepository;
      entries: InformationEntryRepositoryPort;
      evidence: EvidenceReadRepositoryPort;
      intake: Pick<DocumentIntakeService, 'list'>;
      provider?: ReportProvider;
      checkModelCall?: () => Promise<void>;
    },
  ) {}

  private async current(entryIds?: readonly string[]) {
    const [entries, intake] = await Promise.all([
      entryIds && this.deps.entries.loadCurrentEntriesByIds
        ? this.deps.entries.loadCurrentEntriesByIds(
            this.deps.workspaceId,
            false,
            entryIds,
          )
        : this.deps.entries.loadCurrentEntries(this.deps.workspaceId, false),
      this.deps.intake.list(),
    ]);
    return {
      entries: new Map(
        entries.filter((e) => !e.value.isPrivate).map((e) => [e.entryId, e]),
      ),
      intake: new Map(intake.map((r) => [r.snapshotId, r])),
    };
  }
  private checkSources(
    state: ReportState,
    data: Awaited<ReturnType<ReportService['current']>>,
    strict = false,
  ) {
    const stale: string[] = [];
    for (const source of state.sources) {
      const entry = data.entries.get(source.entryId),
        record = data.intake.get(source.intakeSnapshotId);
      if (
        entry?.snapshotId !== source.snapshotId ||
        record?.value.decision !== 'admitted' ||
        (record.value.preparedSnapshotId ?? record.snapshotId) !==
          source.snapshotId
      )
        throw new OperationError('forbidden', 'report_sources_unavailable');
      if (entry.revision !== source.revision) stale.push(source.entryId);
    }
    if (strict && stale.length)
      throw new OperationError('conflict', 'report_sources_changed');
    return stale;
  }
  public async preview(authority: ExecutionAuthority, input: ReportRequest) {
    authority.require('entries.search');
    const request = reportRequestSchema.parse(input);
    const [data, snapshots] = await Promise.all([
      this.current(),
      this.deps.evidence.listSnapshots(this.deps.workspaceId),
    ]);
    return selectReportSources(
      request,
      [...data.entries.values()],
      [...data.intake.values()],
      snapshots,
    );
  }
  public async create(
    authority: ExecutionAuthority,
    requestKey: string,
    input: ReportRequest,
  ) {
    this.writeAuthority(authority);
    const request = reportRequestSchema.parse(input);
    const reportId = deriveProcessingRunId(
      this.deps.workspaceId,
      'report:' + JSON.stringify([authority.identity.id, requestKey]),
    );
    const existing = await this.deps.repository.read(reportId);
    if (existing) {
      if (JSON.stringify(existing.state.request) !== JSON.stringify(request))
        throw new OperationError('conflict', 'idempotency_conflict');
      return this.read(authority, reportId);
    }
    const selected = await this.preview(authority, request);
    if (!selected.sources.length)
      throw new OperationError('rejected', 'no_report_sources');
    const state: ReportState = {
      request,
      actor: {kind: 'owner', id: authority.identity.id},
      title:
        (request.kind === 'daily' ? '日报 · ' : '周报 · ') +
        selected.period.from +
        (request.kind === 'weekly' ? ' — ' + selected.period.to : ''),
      ...selected,
      items: [],
      planned: false,
      status: 'draft',
      calls: 0,
    };
    validateReportState(state);
    if (!(await this.deps.repository.save(reportId, 0, state))) {
      const concurrent = await this.get(reportId);
      if (JSON.stringify(concurrent.state.request) !== JSON.stringify(request))
        throw new OperationError('conflict', 'idempotency_conflict');
    }
    return this.read(authority, reportId);
  }
  public async list(authority: ExecutionAuthority) {
    authority.require('processing.read');
    authority.require('entries.search');
    const [rows, data] = await Promise.all([
      this.deps.repository.list(),
      this.current(),
    ]);
    const reports = [];
    for (const r of rows) {
      try {
        const stale = this.checkSources(r.state, data);
        reports.push({
          reportId: r.reportId,
          version: r.version,
          title: r.state.title,
          kind: r.state.request.kind,
          period: r.state.period,
          status: r.state.status,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          itemCount: r.state.items.filter((i) => i.included).length,
          stale: stale.length > 0,
        });
      } catch (error) {
        if (
          !(error instanceof OperationError) ||
          error.code !== 'report_sources_unavailable'
        )
          throw error;
      }
    }
    return {reports, model: this.deps.provider?.model ?? null};
  }
  public async read(authority: ExecutionAuthority, reportId: string) {
    authority.require('processing.read');
    authority.require('entries.search');
    const report = await this.get(reportId);
    const staleSources = this.checkSources(
      report.state,
      await this.current(report.state.sources.map((s) => s.entryId)),
    );
    return {
      report,
      staleSources,
      active: this.#running.has(reportId),
      model: this.deps.provider?.model ?? null,
    };
  }
  public async generate(
    authority: ExecutionAuthority,
    reportId: string,
    expectedVersion: number,
  ) {
    const report = await this.editable(authority, reportId, expectedVersion);
    const provider = this.deps.provider;
    if (!provider) throw new OperationError('rejected', 'ai_not_configured');
    if (this.#closing || this.#running.size >= 8)
      throw new OperationError('rejected', 'report_queue_unavailable');
    if (
      this.#running.has(reportId) ||
      !['draft', 'failed', 'queued', 'running'].includes(report.state.status)
    )
      throw new OperationError('conflict', 'report_not_resumable');
    if (report.state.calls >= report.state.request.maxModelCalls)
      throw new OperationError('rejected', 'report_call_budget_exhausted');
    if (report.state.model && report.state.model !== provider.model)
      throw new OperationError('conflict', 'report_model_changed');
    const state = {
      ...report.state,
      status: 'queued' as const,
      model: provider.model,
      origin: 'internal_model' as const,
    };
    delete state.errorCode;
    await this.save(reportId, report.version, state);
    this.launch(reportId);
    return this.read(authority, reportId);
  }
  public async cancel(
    authority: ExecutionAuthority,
    reportId: string,
    expectedVersion: number,
  ) {
    this.writeAuthority(authority);
    const report = await this.get(reportId);
    if (report.version !== expectedVersion)
      throw new OperationError('conflict', 'stale_report_version');
    if (!['queued', 'running', 'failed', 'draft'].includes(report.state.status))
      throw new OperationError('conflict', 'report_not_cancellable');
    const cancelled = {
      ...report.state,
      status: 'cancelled' as const,
    };
    if (cancelled.errorCode === AI_PRICE_WAIT) delete cancelled.errorCode;
    await this.save(reportId, report.version, cancelled);
    return this.read(authority, reportId);
  }
  public async edit(
    authority: ExecutionAuthority,
    reportId: string,
    expectedVersion: number,
    input: ReportEdit,
  ) {
    const report = await this.editable(authority, reportId, expectedVersion);
    if (
      this.#running.has(reportId) ||
      ['queued', 'running', 'cancelled'].includes(report.state.status)
    )
      throw new OperationError('conflict', 'report_not_editable');
    const edit = reportEditSchema.parse(input);
    if (edit.items.length > report.state.request.maxItems)
      throw new OperationError('invalid_input', 'report_item_limit');
    const items = edit.items.map((item, index) => {
      const sources = [
        ...new Set(item.story.points.flatMap((p) => p.sources)),
      ].sort((a, b) => a - b);
      const old = report.state.items[index];
      if (old) {
        // Preserve original model wording and its source group when correcting.
        if (sources.some((id) => !old.group.sources.includes(id)))
          throw new OperationError('invalid_input', 'invalid_report_citation');
        return {
          ...old,
          included: item.included,
          ...(JSON.stringify(old.edited ?? old.draft) ===
          JSON.stringify(item.story)
            ? {}
            : {edited: item.story}),
        };
      }
      return {
        group: {title: item.story.title, sources},
        included: item.included,
        edited: item.story,
      };
    });
    if (report.state.items.length && items.length !== report.state.items.length)
      throw new OperationError('invalid_input', 'report_item_count_changed');
    if (edit.reviewed && !items.some((i) => i.included))
      throw new OperationError('invalid_input', 'no_report_items');
    await this.save(reportId, report.version, {
      ...report.state,
      title: edit.title,
      items,
      ...(report.state.otherGroups
        ? {
            otherGroups: report.state.otherGroups
              .map((group) => ({
                ...group,
                sources: group.sources.filter(
                  (id) =>
                    !items.some((item) => item.group.sources.includes(id)),
                ),
              }))
              .filter((group) => group.sources.length > 0),
          }
        : {}),
      planned: true,
      origin: report.state.origin ?? 'manual',
      status: edit.reviewed ? 'reviewed' : 'ready',
    });
    return this.read(authority, reportId);
  }
  public async export(authority: ExecutionAuthority, reportId: string) {
    const {report} = await this.read(authority, reportId);
    this.checkSources(
      report.state,
      await this.current(report.state.sources.map((s) => s.entryId)),
      true,
    );
    if (
      !['ready', 'reviewed'].includes(report.state.status) ||
      !report.state.items.some((i) => i.included)
    )
      throw new OperationError('rejected', 'report_not_ready');
    return {
      fileName:
        report.state.request.kind + '-' + report.state.period.from + '.md',
      markdown: renderReportMarkdown(report),
    };
  }
  private writeAuthority(authority: ExecutionAuthority) {
    if (authority.identity.kind !== 'owner')
      throw new OperationError('forbidden', 'report_owner_required');
  }
  private async editable(
    authority: ExecutionAuthority,
    id: string,
    version: number,
  ) {
    this.writeAuthority(authority);
    const r = await this.get(id);
    if (r.version !== version)
      throw new OperationError('conflict', 'stale_report_version');
    this.checkSources(
      r.state,
      await this.current(r.state.sources.map((s) => s.entryId)),
      true,
    );
    return r;
  }
  private async get(id: string) {
    const r = await this.deps.repository.read(id);
    if (!r) throw new OperationError('not_found', 'report_not_found');
    return r;
  }
  private async save(id: string, version: number, state: ReportState) {
    validateReportState(state);
    if (!(await this.deps.repository.save(id, version, state)))
      throw new OperationError('conflict', 'stale_report_version');
  }
  private launch(id: string) {
    if (this.#closing || this.#running.has(id)) return;
    const job = this.#tail
      .then(() => this.run(id))
      .catch(() => {
        /* Durable state remains explicitly resumable on storage interruption. */
      })
      .finally(() => this.#running.delete(id));
    this.#running.set(id, job);
    this.#tail = job;
  }
  private async run(id: string) {
    await this.deps.repository.withLock(id, async () => {
      let record = await this.get(id);
      let unsentCall = false;
      try {
        for (;;) {
          record = await this.get(id);
          if (!['queued', 'running'].includes(record.state.status)) return;
          if (this.#closing)
            throw new OperationError('rejected', 'report_interrupted');
          const data = await this.current(
            record.state.sources.map((s) => s.entryId),
          );
          this.checkSources(record.state, data, true);
          const state = structuredClone(record.state),
            provider = this.deps.provider;
          delete state.errorCode;
          if (!provider || provider.model !== state.model)
            throw new OperationError('rejected', 'report_model_changed');
          if (state.planned && state.items.every((i) => i.draft)) {
            await this.save(id, record.version, {...state, status: 'ready'});
            return;
          }
          if (state.calls >= state.request.maxModelCalls)
            throw new OperationError(
              'rejected',
              'report_call_budget_exhausted',
            );
          await this.deps.checkModelCall?.();
          state.calls++;
          state.status = 'running';
          const claimedVersion = record.version + 1;
          await this.save(id, record.version, state);
          record = await this.get(id);
          if (
            record.version !== claimedVersion ||
            record.state.status !== 'running'
          )
            return;
          unsentCall = true;
          if (!state.planned) {
            const plan = reportPlanSchema.parse(
              await provider.plan({
                kind: state.request.kind,
                sources: state.sources.map((s) => ({
                  handle: s.handle,
                  title: s.title,
                  excerpt: s.excerpt,
                  keywords: s.keywords,
                  reason: s.reason,
                  ...(s.receivedDate ? {receivedDate: s.receivedDate} : {}),
                  ...(s.publishedDate ? {publishedDate: s.publishedDate} : {}),
                  ...(s.publicationInferred !== undefined
                    ? {publicationInferred: s.publicationInferred}
                    : {}),
                })),
              }),
            );
            state.items = [];
            state.otherGroups = [];
            for (const {recommended, ...group} of plan.groups) {
              if (recommended && state.items.length < state.request.maxItems)
                state.items.push({group, included: true});
              else state.otherGroups.push(group);
            }
            state.planned = true;
          } else {
            const item = state.items.find((i) => !i.draft);
            if (!item)
              throw new OperationError('rejected', 'invalid_report_state');
            item.draft = reportStorySchema.parse(
              await provider.summarize({
                kind: state.request.kind,
                title: item.group.title,
                period: state.period,
                timeField: state.request.timeField,
                sources: item.group.sources.map((handle) => {
                  const source = state.sources.find((s) => s.handle === handle);
                  const entry = source
                    ? data.entries.get(source.entryId)
                    : undefined;
                  if (!entry)
                    throw new OperationError(
                      'rejected',
                      'report_sources_unavailable',
                    );
                  return {
                    handle,
                    title: entry.value.titlePath,
                    text: entry.value.body,
                    ...(source?.receivedDate
                      ? {receivedDate: source.receivedDate}
                      : {}),
                    ...(source?.publishedDate
                      ? {publishedDate: source.publishedDate}
                      : {}),
                    ...(source?.publicationInferred !== undefined
                      ? {publicationInferred: source.publicationInferred}
                      : {}),
                  };
                }),
              }),
            );
          }
          unsentCall = false;
          this.checkSources(
            state,
            await this.current(state.sources.map((s) => s.entryId)),
            true,
          );
          await this.save(id, record.version, state);
        }
      } catch (error) {
        const latest = await this.get(id);
        if (
          latest.version !== record.version ||
          !['running', 'queued'].includes(latest.state.status)
        )
          return;
        if (isAiPriceWait(error)) {
          await this.save(id, latest.version, {
            ...latest.state,
            status: 'queued',
            errorCode: AI_PRICE_WAIT,
            calls: latest.state.calls - (unsentCall ? 1 : 0),
          });
          return;
        }
        const code =
          error instanceof OperationError
            ? error.code
            : 'report_generation_failed';
        await this.save(id, latest.version, {
          ...latest.state,
          status: 'failed',
          errorCode: code,
        });
      }
    });
  }
  public stop() {
    this.#closing = true;
  }
  public async pollPriceDeferred() {
    if (this.#closing || !this.deps.checkModelCall) return;
    try {
      await this.deps.checkModelCall();
    } catch (error) {
      if (isAiPriceWait(error)) return;
      throw error;
    }
    const reports = this.deps.repository.listPriceDeferred
      ? await this.deps.repository.listPriceDeferred()
      : await this.deps.repository.list();
    for (const report of reports) {
      if (this.#running.size >= 8) break;
      if (
        report.state.status === 'queued' &&
        report.state.errorCode === AI_PRICE_WAIT
      )
        this.launch(report.reportId);
    }
  }
  public async drain() {
    this.stop();
    await Promise.all(this.#running.values());
  }
}
