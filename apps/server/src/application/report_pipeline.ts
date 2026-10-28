import {createHash} from 'node:crypto';
import {
  researchOwnerSchemas,
  scheduleSchema,
  type ResearchRepository,
  type ResearchRecord,
  type ResearchValue,
} from './research_contract.js';
import type {ReportService} from './report_service.js';
import {ExecutionAuthority} from './execution_authority.js';
import {OperationError, requireOperationValue} from './operation_error.js';
import {deriveProcessingRunId} from '../modules/processing/processing_identity.js';
import {researchSettingsId, settingsFromRecord} from './research_service.js';
import {
  AI_PRICE_WAIT,
  AI_OPERATIONS_PAUSED,
} from '../modules/processing/ai_price_policy.js';
import {
  inQuietHours,
  latestReportSlot,
  localParts,
  validTimeZone,
  zonedTime,
} from './report_schedule.js';
import type {CurrentInformationEntry} from '../modules/entries/information_entry_contract.js';

type Notice = Extract<ResearchValue, {kind: 'notice'}>;
export class ReportPipeline {
  private closing = false;
  constructor(
    private readonly deps: {
      workspaceId: string;
      repository: ResearchRepository;
      reports: ReportService;
      entries: () => Promise<readonly CurrentInformationEntry[]>;
      eventEntries?: () => Promise<readonly CurrentInformationEntry[]>;
      clock?: () => Date;
      budgetStatus: () => Promise<{
        batchId: string;
        paused: boolean;
        remainingCny: number;
      } | null>;
    },
  ) {}
  private now() {
    return this.deps.clock?.() ?? new Date();
  }
  private id(key: string) {
    return deriveProcessingRunId(
      this.deps.workspaceId,
      'report-pipeline:' + key,
    );
  }
  private owner(a: ExecutionAuthority) {
    if (a.identity.kind !== 'owner' || a.workspaceId !== this.deps.workspaceId)
      throw new OperationError('forbidden', 'report_owner_required');
  }
  private async save(
    id: string,
    expectedVersion: number,
    value: ResearchValue,
  ) {
    if (!(await this.deps.repository.save([{id, expectedVersion, value}])))
      throw new OperationError('conflict', 'research_revision_conflict');
  }
  async status(a: ExecutionAuthority) {
    if (a.workspaceId !== this.deps.workspaceId)
      throw new OperationError('forbidden', 'workspace_mismatch');
    a.require('entries.search');
    a.require('processing.read');
    const [schedules, runs, notices, entries, settings, budget] =
      await Promise.all([
        this.deps.repository.list('schedule'),
        this.deps.repository.list('run'),
        this.deps.repository.list('notice'),
        this.deps.entries(),
        this.deps.repository.read(researchSettingsId(this.deps.workspaceId)),
        this.deps.budgetStatus(),
      ]);
    const visible = new Set(entries.map((e) => e.entryId));
    const allowed: ResearchRecord[] = [];
    for (const r of notices) {
      if (
        r.value.kind !== 'notice' ||
        r.value.visibleAt > this.now().toISOString() ||
        r.value.entryIds.some((id) => !visible.has(id))
      )
        continue;
      if (r.value.reportId) {
        try {
          await this.deps.reports.read(a, r.value.reportId);
        } catch {
          continue;
        }
      }
      allowed.push(r);
    }
    return {
      settings: settingsFromRecord(settings),
      settingsVersion: settings?.version ?? 0,
      budget,
      schedules,
      runs: runs.slice(0, 100),
      notices: allowed.slice(0, 100),
    };
  }
  async execute(
    a: ExecutionAuthority,
    name: string,
    input: unknown,
  ): Promise<unknown> {
    if (name === 'report_pipeline_status') return this.status(a);
    this.owner(a);
    switch (name) {
      case 'research_settings_save': {
        const q = researchOwnerSchemas.research_settings_save.parse(input);
        if (!validTimeZone(q.settings.notices.timeZone))
          throw new OperationError('invalid_input', 'invalid_timezone');
        await this.deps.repository.withLock(async () => {
          const id = researchSettingsId(this.deps.workspaceId),
            old = await this.deps.repository.read(id);
          const was = old?.value.kind === 'settings' ? old.value : undefined;
          await this.save(id, q.expectedVersion, {
            kind: 'settings',
            settings: q.settings,
            watchSince:
              was && was.settings.notices.enabled && q.settings.notices.enabled
                ? was.watchSince
                : this.now().toISOString(),
          });
        });
        return this.status(a);
      }
      case 'report_schedule_save': {
        const q = researchOwnerSchemas.report_schedule_save.parse(input);
        const s = scheduleSchema.parse(q.schedule);
        if (!validTimeZone(s.timeZone))
          throw new OperationError('invalid_input', 'invalid_timezone');
        if (s.enabled && s.request.composition !== 'collection') {
          const b = await this.deps.budgetStatus();
          if (
            !b ||
            b.paused ||
            b.remainingCny <= 0 ||
            b.batchId !== s.request.batchId
          )
            throw new OperationError('rejected', 'report_budget_required');
        }
        await this.deps.repository.withLock(async () => {
          const rows = await this.deps.repository.list('schedule');
          if (!q.expectedVersion && rows.length >= 16)
            throw new OperationError('rejected', 'report_schedule_limit');
          await this.save(q.id, q.expectedVersion, {
            kind: 'schedule',
            schedule: s,
            activatedAt: this.now().toISOString(),
          });
        });
        return this.status(a);
      }
      case 'report_publish': {
        const q = researchOwnerSchemas.report_publish.parse(input);
        return this.publish(a, q.reportId, q.expectedVersion);
      }
      case 'notice_read': {
        const q = researchOwnerSchemas.notice_read.parse(input),
          r = await this.deps.repository.read(q.id);
        if (r?.value.kind !== 'notice')
          throw new OperationError('rejected', 'notice_missing');
        await this.save(r.id, q.expectedVersion, {...r.value, read: true});
        return this.status(a);
      }
      default:
        throw new OperationError('invalid_input', 'unknown_operation');
    }
  }
  async publish(a: ExecutionAuthority, reportId: string, version: number) {
    this.owner(a);
    const {report} = await this.deps.reports.read(a, reportId);
    if (report.version !== version)
      throw new OperationError('conflict', 'report_version_conflict');
    const output = await this.deps.reports.export(a, reportId);
    const current = await this.deps.reports.read(a, reportId);
    if (current.report.version !== version)
      throw new OperationError('conflict', 'report_version_conflict');
    const id = this.id('publication:' + reportId + ':' + String(version));
    return this.deps.repository.withLock(async () => {
      const old = await this.deps.repository.read(id);
      if (old) return old;
      const now = this.now().toISOString(),
        value: Notice = {
          kind: 'notice',
          category: 'report',
          title: report.state.title,
          entryIds: report.state.sources.map((s) => s.entryId),
          reportId,
          reportVersion: version,
          markdown: output.markdown,
          eventKey: 'report:' + reportId,
          fingerprint: hash(output.markdown),
          correction: (await this.deps.repository.list('notice')).some(
            (n) => n.value.kind === 'notice' && n.value.reportId === reportId,
          ),
          urgent: false,
          read: false,
          visibleAt: now,
          createdAt: now,
        };
      await this.save(id, 0, value);
      return this.deps.repository.read(id);
    });
  }
  async poll() {
    if (this.closing) return;
    await this.deps.repository.withLock(async () => {
      const now = this.now();
      for (const row of await this.deps.repository.list('schedule')) {
        if (row.value.kind !== 'schedule' || !row.value.schedule.enabled)
          continue;
        const s = row.value.schedule,
          slot = latestReportSlot(s, now);
        if (!slot || slot.due.toISOString() < row.value.activatedAt) continue;
        const id = this.id(`run:${row.id}:${slot.key}`);
        if (await this.deps.repository.read(id)) continue;
        await this.save(id, 0, {
          kind: 'run',
          scheduleId: row.id,
          scheduleVersion: row.version,
          slot: slot.key,
          cutoff: slot.due.toISOString(),
          request: {
            ...s.request,
            date: slot.reportDate,
            timeZone: s.timeZone,
            cutoff: slot.due.toISOString(),
          },
          publish: s.publish,
          status:
            s.missed === 'skip' && now.getTime() - slot.due.getTime() > 3600000
              ? 'skipped'
              : 'queued',
        });
      }
    });
    for (const r of await this.deps.repository.list('run')) {
      if (this.isClosing()) break;
      if (
        r.value.kind === 'run' &&
        ['queued', 'generating'].includes(r.value.status)
      )
        await this.advance(r);
    }
    await this.eventNotices();
  }
  private async advance(row: ResearchRecord) {
    if (row.value.kind !== 'run') return;
    const a = ExecutionAuthority.owner(this.deps.workspaceId);
    const value = row.value;
    try {
      let result = value.reportId
        ? await this.deps.reports.read(a, value.reportId)
        : await this.deps.reports.create(
            a,
            'scheduled-' + row.id,
            value.request,
          );
      if (value.status === 'queued') {
        await this.save(row.id, row.version, {
          ...value,
          reportId: result.report.reportId,
          status: 'generating',
        });
        row = requireOperationValue(await this.deps.repository.read(row.id));
      }
      if (result.report.state.status === 'draft') {
        result = await this.deps.reports.generate(
          a,
          result.report.reportId,
          result.report.version,
        );
      }
      const state = result.report.state.status;
      if (
        !result.active &&
        (state === 'running' ||
          (state === 'queued' &&
            result.report.state.errorCode !== AI_PRICE_WAIT &&
            result.report.state.errorCode !== AI_OPERATIONS_PAUSED))
      ) {
        await this.save(row.id, row.version, {
          ...value,
          reportId: result.report.reportId,
          status: 'failed',
          errorCode: 'report_resume_required',
        });
        return;
      }

      if (state === 'ready' || state === 'reviewed') {
        if (value.publish)
          await this.publish(a, result.report.reportId, result.report.version);
        await this.save(row.id, row.version, {
          ...value,
          reportId: result.report.reportId,
          status: value.publish ? 'published' : 'ready',
        });
      } else if (state === 'failed' || state === 'cancelled')
        await this.save(row.id, row.version, {
          ...value,
          reportId: result.report.reportId,
          status: 'failed',
          errorCode: result.report.state.errorCode ?? 'report_cancelled',
        });
    } catch (error) {
      if (error instanceof OperationError && error.kind === 'conflict') return;
      const latest = await this.deps.repository.read(row.id);
      if (
        latest?.value.kind === 'run' &&
        ['queued', 'generating'].includes(latest.value.status)
      )
        await this.save(row.id, latest.version, {
          ...latest.value,
          status: 'failed',
          errorCode:
            error instanceof OperationError
              ? error.code
              : 'report_pipeline_failed',
        });
    }
  }
  private async eventNotices() {
    const settingsRow = await this.deps.repository.read(
      researchSettingsId(this.deps.workspaceId),
    );
    if (
      settingsRow?.value.kind !== 'settings' ||
      !settingsRow.value.settings.notices.enabled
    )
      return;
    const watchSince = settingsRow.value.watchSince;
    const config = settingsRow.value.settings.notices,
      now = this.now();
    const entries = await (this.deps.eventEntries?.() ?? this.deps.entries());
    await this.deps.repository.withLock(async () => {
      const latest = await this.deps.repository.read(settingsRow.id);
      if (latest?.version !== settingsRow.version) return;
      const notices = await this.deps.repository.list('notice');
      const groups = new Map<string, CurrentInformationEntry[]>();
      for (const e of entries) {
        if (e.capturedAt < watchSince || e.value.isPrivate) continue;
        if (
          config.sources.length &&
          !config.sources.some((s) =>
            e.sourceKey.toLowerCase().includes(s.toLowerCase()),
          )
        )
          continue;
        const key = e.canonicalUri ?? e.resourceId;
        const group = groups.get(key) ?? [];
        group.push(e);
        groups.set(key, group);
      }
      let nextVisible = now.getTime();
      for (const row of notices) {
        if (
          row.value.kind === 'notice' &&
          row.value.category === 'content' &&
          !row.value.urgent
        )
          nextVisible = Math.max(
            nextVisible,
            Date.parse(row.value.visibleAt) + config.intervalMinutes * 60000,
          );
      }
      for (const [key, group] of groups) {
        const id = this.id('event:' + key),
          old = notices.find((n) => n.id === id),
          fingerprint = hash(
            group
              .map((e) => e.entryId + ':' + String(e.revision))
              .sort()
              .join('|'),
          );
        if (
          old?.value.kind === 'notice' &&
          old.value.fingerprint === fingerprint
        )
          continue;
        const urgent = config.urgentTerms.some((t) =>
          group.some((e) =>
            (e.value.titlePath + ' ' + e.value.body)
              .toLowerCase()
              .includes(t.toLowerCase()),
          ),
        );
        let at = new Date(urgent ? now.getTime() : nextVisible);
        if (
          !urgent &&
          inQuietHours(at, config.timeZone, config.quietFrom, config.quietTo)
        ) {
          const p = localParts(at, config.timeZone),
            d = new Date(p.date + 'T12:00:00Z');
          if (config.quietFrom > config.quietTo && p.time >= config.quietFrom)
            d.setUTCDate(d.getUTCDate() + 1);
          at =
            zonedTime(
              d.toISOString().slice(0, 10),
              config.quietTo,
              config.timeZone,
            ) ?? new Date(at.getTime() + 3600000);
        }
        const value: Notice = {
          kind: 'notice',
          category: 'content',
          title: requireOperationValue(group[0]).value.titlePath,
          entryIds: group.slice(0, 512).map((e) => e.entryId),
          eventKey: hash(key),
          fingerprint,
          correction: !!old,
          urgent,
          read: false,
          visibleAt: at.toISOString(),
          createdAt:
            old?.value.kind === 'notice'
              ? old.value.createdAt
              : now.toISOString(),
        };
        await this.save(id, old?.version ?? 0, value);
        if (!urgent)
          nextVisible = at.getTime() + config.intervalMinutes * 60000;
      }
    });
  }
  private isClosing() {
    return this.closing;
  }
  stop() {
    this.closing = true;
  }
}
function hash(s: string) {
  return createHash('sha256').update(s).digest('hex');
}
