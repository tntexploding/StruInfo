import {
  AiPriceWindowClosedError,
  AiOperationsPausedError,
  AI_PRICE_WAIT,
} from '../modules/processing/ai_price_policy.js';
import {requireOperationValue} from './operation_error.js';
import {describe, expect, it, vi} from 'vitest';
import type {
  CurrentInformationEntry,
  InformationEntryRepositoryPort,
} from '../modules/entries/index.js';
import type {EvidenceReadRepositoryPort} from '../modules/evidence/index.js';
import {
  ExecutionAuthority,
  DELEGATED_READ_OPERATIONS,
  AGENT_WRITE_OPERATIONS,
} from './execution_authority.js';
import {ReportService} from './report_service.js';
import {
  reportRequestSchema,
  type ReportRecord,
  type ReportRepository,
  type ReportProvider,
  type ReportEdit,
} from './report_contract.js';
import {reportPeriod, selectReportSources} from './report_selection.js';
import type {IntakeRecord} from './document_intake_contract.js';
import {ReportCommands} from './report_commands.js';

const id = (n: number) =>
  '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const W = id(1),
  owner = ExecutionAuthority.owner(W);
const request = reportRequestSchema.parse({
  kind: 'daily',
  date: '2040-01-02',
  timeZone: 'Asia/Shanghai',
});
function entry(
  n: number,
  patch: Partial<CurrentInformationEntry> = {},
): CurrentInformationEntry {
  return {
    workspaceId: W,
    entryId: id(n),
    resourceId: id(n + 100),
    snapshotId: id(n + 200),
    revisionId: id(n + 300),
    revision: 1,
    sourceKey: 'Synthetic source ' + String(n),
    canonicalUri: 'https://example.invalid/' + String(n),
    capturedAt: '2040-01-02T00:00:00.000Z',
    publishedAt: '2040-01-01T18:00:00.000Z',
    value: {
      titlePath: 'Synthetic complete article ' + String(n),
      body:
        'Complete synthetic article ' +
        String(n) +
        ': observations.\n\nContext and limits are preserved.',
      bodySha256: 'a'.repeat(64),
      documentOrder: 1,
      chunkMode: 'whole',
      splitRuleVersion: 'synthetic',
      isPrivate: false,
      contentKeywords: [],
      domains: [],
      fragmentIds: [id(n + 400)],
    },
    ...patch,
  };
}
const admit = (e: CurrentInformationEntry): IntakeRecord => ({
  snapshotId: e.snapshotId,
  version: 1,
  updatedAt: e.capturedAt,
  value: {
    decision: 'admitted',
    origin: 'manual',
    reason: 'Synthetic admission',
    preparation: 'received',
  },
});
function fixture(configured = true, checkModelCall?: () => Promise<void>) {
  const entries = [entry(10), entry(11)],
    intake = entries.map(admit),
    rows = new Map<string, ReportRecord>();
  const repository: ReportRepository = {
    read: (key) => Promise.resolve(structuredClone(rows.get(key))),
    list: () => Promise.resolve(structuredClone([...rows.values()])),
    save: (key, version, state) => {
      if ((rows.get(key)?.version ?? 0) !== version)
        return Promise.resolve(false);
      rows.set(key, {
        reportId: key,
        version: version + 1,
        state: structuredClone(state),
        createdAt: '2040-01-02T12:00:00.000Z',
        updatedAt: '2040-01-02T12:00:00.000Z',
      });
      return Promise.resolve(true);
    },
    withLock: async (_key, action) => action(),
  };
  const provider = {
    model: 'synthetic-report-model',
    plan: vi.fn<ReportProvider['plan']>(() =>
      Promise.resolve({
        groups: [
          {title: '星藤实验', sources: [1], recommended: true},
          {title: '合成观察', sources: [2], recommended: true},
        ],
      }),
    ),
    summarize: vi.fn<ReportProvider['summarize']>((input) =>
      Promise.resolve({
        title: input.title,
        points: [
          {
            text: '合成摘要，保留证据中的限制。',
            sources: input.sources.map((s) => s.handle),
          },
        ],
      }),
    ),
  };
  const deps = {
    workspaceId: W,
    repository,
    entries: {
      loadCurrentEntries: () => Promise.resolve(entries),
    } as unknown as InformationEntryRepositoryPort,
    evidence: {
      listSnapshots: () =>
        Promise.resolve(
          entries.map((e) => ({
            snapshotId: e.snapshotId,
            capturedAt: e.capturedAt,
          })),
        ),
    } as unknown as EvidenceReadRepositoryPort,
    intake: {list: () => Promise.resolve(intake)},
    ...(configured ? {provider} : {}),
    ...(checkModelCall ? {checkModelCall} : {}),
  };
  const service = new ReportService(deps);
  const done = async (key: string, using = service) => {
    await vi.waitFor(async () => {
      expect((await using.read(owner, key)).active).toBe(false);
    });
    return (await using.read(owner, key)).report;
  };
  return {entries, intake, rows, provider, service, deps, done};
}
describe('report material selection', () => {
  it('limits summaries after independent event planning and retains other reading and source dates', async () => {
    const f = fixture();
    f.entries[0] = {
      ...requireOperationValue(f.entries[0]),
      publishedAt: '2039-12-01T00:00:00Z',
    };
    const r = (
      await f.service.create(owner, 'ranked-events', {...request, maxItems: 1})
    ).report;
    await f.service.generate(owner, r.reportId, r.version);
    const finished = await f.done(r.reportId);
    expect(finished.state).toMatchObject({
      status: 'ready',
      calls: 2,
      items: [{group: {sources: [1]}}],
      otherGroups: [{sources: [2]}],
    });
    expect(f.provider.plan.mock.calls[0]?.[0]).not.toHaveProperty('maxItems');
    expect(f.provider.summarize).toHaveBeenCalledTimes(1);
    expect(f.provider.summarize.mock.calls[0]?.[0]).toMatchObject({
      period: {from: '2040-01-02', to: '2040-01-02'},
      timeField: 'received',
      sources: [{publishedDate: '2039-12-01', receivedDate: '2040-01-02'}],
    });
    const output = await f.service.export(owner, r.reportId);
    expect(output.markdown).toContain('## 其他阅读');
    expect(output.markdown).toContain('合成观察 [2]');
    expect(output.markdown).toContain(
      '发布：2039-12-01 · 接收：2040-01-02 · 补充阅读',
    );
    expect(output.markdown).toContain(
      requireOperationValue(f.entries[1]).entryId,
    );
  });
  it('rejects incomplete event coverage before generating summaries', async () => {
    const f = fixture();
    f.provider.plan.mockResolvedValueOnce({
      groups: [{title: 'Omitted source', sources: [1], recommended: true}],
    });
    const r = (await f.service.create(owner, 'missing-event', request)).report;
    await f.service.generate(owner, r.reportId, r.version);
    expect((await f.done(r.reportId)).state).toMatchObject({
      status: 'failed',
      errorCode: 'incomplete_report_selection',
      calls: 1,
    });
    expect(f.provider.summarize).not.toHaveBeenCalled();
  });
  it('uses the selected received body and excludes earlier web captures from reports', () => {
    const received = entry(10),
      web = {...entry(11), snapshotId: id(998)},
      old = {...entry(12), snapshotId: id(997)};
    const intake = admit(received);
    intake.value.preparedSnapshotId = web.snapshotId;
    intake.value.bodySource = 'received';
    intake.value.previousPreparedSnapshotIds = [old.snapshotId];
    const result = selectReportSources(
      request,
      [received, web, old],
      [intake],
      [{snapshotId: received.snapshotId, capturedAt: '2040-01-02T00:00:00Z'}],
    );
    expect(result.sources.map((s) => s.entryId)).toEqual([received.entryId]);
  });
  it('retains original receipt dates for prepared documents and does not invent publication dates', () => {
    const e = {...entry(10)};
    delete e.publishedAt;
    const intake = {...admit(e), snapshotId: id(999)};
    intake.value.preparedSnapshotId = e.snapshotId;
    const result = selectReportSources(
      request,
      [e],
      [intake],
      [
        {snapshotId: intake.snapshotId, capturedAt: '2040-01-01T17:00:00Z'},
        {snapshotId: e.snapshotId, capturedAt: '2040-01-03T00:00:00Z'},
      ],
    );
    expect(result.sources[0]).toMatchObject({
      date: '2040-01-02',
      receivedDate: '2040-01-02',
    });
    expect(result.sources[0]).not.toHaveProperty('publishedDate');
  });
  it('waits without a call, resumes only price waits after restart, and rechecks every story', async () => {
    let blocked = true;
    const f = fixture(true, async () => {
      await Promise.resolve();
      if (blocked) throw new AiPriceWindowClosedError();
    });
    const r = (await f.service.create(owner, 'price-report', request)).report;
    await f.service.generate(owner, r.reportId, r.version);
    expect((await f.done(r.reportId)).state).toMatchObject({
      status: 'queued',
      calls: 0,
      errorCode: AI_PRICE_WAIT,
    });
    await f.service.pollPriceDeferred();
    expect(f.provider.plan).not.toHaveBeenCalled();
    await f.service.drain();
    const resumed = new ReportService(f.deps);
    blocked = false;
    const plan = requireOperationValue(f.provider.plan.getMockImplementation());
    f.provider.plan.mockImplementationOnce(async (input) => {
      const value = await plan(input);
      blocked = true;
      return value;
    });
    await resumed.pollPriceDeferred();
    expect((await f.done(r.reportId, resumed)).state).toMatchObject({
      planned: true,
      status: 'queued',
      calls: 1,
      errorCode: AI_PRICE_WAIT,
    });
    expect(f.provider.summarize).not.toHaveBeenCalled();
    blocked = false;
    await resumed.pollPriceDeferred();
    expect((await f.done(r.reportId, resumed)).state).toMatchObject({
      status: 'ready',
      calls: 3,
    });
    expect((await f.done(r.reportId, resumed)).state.errorCode).toBeUndefined();
  });
  it('refunds a request blocked at final dispatch and respects cancellation of the wait', async () => {
    const f = fixture(true, () => Promise.resolve());
    f.provider.plan.mockRejectedValueOnce(new AiPriceWindowClosedError());
    const r = (await f.service.create(owner, 'price-race', request)).report;
    await f.service.generate(owner, r.reportId, r.version);
    const waiting = await f.done(r.reportId);
    expect(waiting.state).toMatchObject({
      status: 'queued',
      calls: 0,
      errorCode: AI_PRICE_WAIT,
    });
    await f.service.cancel(owner, r.reportId, waiting.version);
    await f.service.pollPriceDeferred();
    expect(f.provider.plan).toHaveBeenCalledTimes(1);
    expect((await f.service.read(owner, r.reportId)).report.state.status).toBe(
      'cancelled',
    );
  });
  it('uses local calendar dates, Monday–Sunday weeks and validates calendar/timezone', () => {
    expect(
      reportPeriod({...request, kind: 'weekly', date: '2040-01-01'}),
    ).toEqual({from: '2039-12-26', to: '2040-01-01'});
    expect(() => reportPeriod({...request, date: '2040-02-30'})).toThrow(
      'invalid_report_date',
    );
    expect(() => reportPeriod({...request, timeZone: 'unknown/zone'})).toThrow(
      'invalid_report_timezone',
    );
    const e = entry(10, {capturedAt: '2040-01-01T16:00:00Z'});
    expect(
      selectReportSources(request, [e], [admit(e)], [e]).sources,
    ).toHaveLength(1);
    expect(
      selectReportSources({...request, timeZone: 'UTC'}, [e], [admit(e)], [e])
        .sources,
    ).toHaveLength(0);
    expect(
      reportPeriod({
        ...request,
        kind: 'weekly',
        date: '2040-03-11',
        timeZone: 'America/New_York',
      }),
    ).toEqual({from: '2040-03-05', to: '2040-03-11'});
  });
  it('uses the original intake date and only admitted public entries with requested dates and filters', () => {
    const e = entry(10, {capturedAt: '2040-01-05T00:00:00Z'}),
      privateEntry = entry(11);
    const original = {snapshotId: id(999), capturedAt: '2040-01-02T00:00:00Z'};
    const record = {
      ...admit(e),
      snapshotId: original.snapshotId,
      value: {...admit(e).value, preparedSnapshotId: e.snapshotId},
    };
    const selected = selectReportSources(
      request,
      [
        e,
        {...privateEntry, value: {...privateEntry.value, isPrivate: true}},
        entry(12),
        entry(13),
      ],
      [
        record,
        admit(privateEntry),
        {...admit(entry(12)), value: {...admit(e).value, decision: 'held'}},
      ],
      [original],
    );
    expect(selected.sources.map((s) => s.entryId)).toEqual([e.entryId]);
    expect(selected.sources[0]?.intakeSnapshotId).toBe(original.snapshotId);
    const missing = entry(14);
    delete (missing as {publishedAt?: string}).publishedAt;
    expect(
      selectReportSources(
        {...request, timeField: 'published'},
        [missing],
        [admit(missing)],
        [missing],
      ).sources,
    ).toHaveLength(0);
    expect(
      selectReportSources(
        {...request, topics: ['absent']},
        [e],
        [record],
        [original],
      ).sources,
    ).toHaveLength(0);
    expect(
      selectReportSources(
        {...request, sources: ['EXAMPLE.INVALID'], topics: ['context']},
        [e],
        [record],
        [original],
      ).sources,
    ).toHaveLength(1);
  });
  it('deduplicates captures within the chosen period without deleting independently split entries or backfilling unchecked material', () => {
    const a = entry(10),
      b = entry(11, {
        canonicalUri: requireOperationValue(a.canonicalUri),
        capturedAt: '2040-01-02T01:00:00Z',
      });
    const newerOutside = entry(12, {
      canonicalUri: requireOperationValue(a.canonicalUri),
      capturedAt: '2040-01-03T01:00:00Z',
    });
    const sameCapture = entry(13, {
      snapshotId: b.snapshotId,
      canonicalUri: requireOperationValue(a.canonicalUri),
      capturedAt: b.capturedAt,
    });
    const duplicateBody = {...entry(14), value: b.value};
    const entries = [a, b, newerOutside, sameCapture, duplicateBody];
    const records = [
      admit(a),
      admit(b),
      admit(newerOutside),
      admit(duplicateBody),
    ];
    const selected = selectReportSources(request, entries, records, entries);
    expect(selected.sources.map((s) => s.entryId).sort()).toEqual(
      [b.entryId, sameCapture.entryId].sort(),
    );
    expect(selected.duplicateCount).toBe(2);
    expect(
      selectReportSources(
        {...request, selectedEntryIds: [b.entryId]},
        entries,
        records,
        entries,
      ).sources.map((s) => s.entryId),
    ).toEqual([b.entryId]);
    expect(
      selectReportSources(
        {...request, selectedEntryIds: []},
        entries,
        records,
        entries,
      ).sources,
    ).toEqual([]);
  });
});
describe('reviewable report workflow', () => {
  it('creates idempotently without model calls and exposes only read operations to agents', async () => {
    const f = fixture(),
      created = await f.service.create(owner, 'synthetic-report', request);
    expect(
      (await f.service.create(owner, 'synthetic-report', request)).report
        .reportId,
    ).toBe(created.report.reportId);
    expect(f.rows.size).toBe(1);
    expect(f.provider.plan).not.toHaveBeenCalled();
    await expect(
      f.service.create(owner, 'synthetic-report', {...request, kind: 'weekly'}),
    ).rejects.toMatchObject({code: 'idempotency_conflict'});
    const agent = ExecutionAuthority.agent(W, 'synthetic-agent', [
      ...DELEGATED_READ_OPERATIONS,
      ...AGENT_WRITE_OPERATIONS,
    ]);
    expect((await f.service.list(agent)).reports).toHaveLength(1);
    const commands = new ReportCommands(agent, f.service);
    await expect(
      commands.execute('report_create', {requestKey: 'other', request}),
    ).rejects.toMatchObject({code: 'report_owner_required'});
    for (const operation of ['report_generate', 'report_cancel'])
      await expect(
        commands.execute(operation, {
          reportId: created.report.reportId,
          expectedVersion: 1,
        }),
      ).rejects.toMatchObject({code: 'report_owner_required'});
    await expect(
      f.service.list(
        ExecutionAuthority.agent(W, 'processing-only', ['processing.read']),
      ),
    ).rejects.toMatchObject({kind: 'forbidden'});
    expect(f.provider.plan).not.toHaveBeenCalled();
  });
  it('generates cited Chinese stories from complete bodies, preserves AI drafts when edited, and exports reviewed source versions', async () => {
    const f = fixture(),
      r = (await f.service.create(owner, 'report', request)).report;
    await f.service.generate(owner, r.reportId, r.version);
    let ready = await f.done(r.reportId);
    expect(ready.state).toMatchObject({
      status: 'ready',
      calls: 3,
      planned: true,
    });
    expect(f.provider.summarize.mock.calls[0]?.[0].sources[0]?.text).toBe(
      f.entries[0]?.value.body,
    );
    expect(JSON.stringify(f.provider.plan.mock.calls)).not.toContain(W);
    expect((await f.service.export(owner, r.reportId)).markdown).toContain(
      '待复核草稿',
    );
    const edit: ReportEdit = {
      title: '合成日报',
      reviewed: true,
      items: ready.state.items.map((i) => ({
        included: i.included,
        story: {
          title: i.group.title,
          points: [{text: '人工核对后的合成内容', sources: i.group.sources}],
        },
      })),
    };
    ready = (await f.service.edit(owner, r.reportId, ready.version, edit))
      .report;
    expect(ready.state.items[0]?.draft?.points[0]?.text).toBe(
      '合成摘要，保留证据中的限制。',
    );
    expect(ready.state.status).toBe('reviewed');
    const markdown = (await f.service.export(owner, r.reportId)).markdown;
    expect(markdown).toContain('已人工核对');
    expect(markdown).toContain('https://example.invalid/10');
    expect(markdown).toContain('版本 1');
    expect(markdown).toContain(f.entries[0]?.snapshotId);
    await expect(
      f.service.edit(owner, r.reportId, 1, edit),
    ).rejects.toMatchObject({code: 'stale_report_version'});
  });
  it.each([false, true])(
    'exports one source list per story and preserves mixed-source point attribution (%s)',
    async (multiple) => {
      const f = fixture(false);
      const created = await f.service.create(
        owner,
        'compact-citations',
        request,
      );
      const saved = await f.service.edit(
        owner,
        created.report.reportId,
        created.report.version,
        {
          title: '合成引用检查',
          reviewed: false,
          items: [
            {
              included: true,
              story: {
                title: '合成观察',
                points: [
                  {text: '合成结论。', sources: [1], role: 'finding'},
                  {
                    text: '合成依据。',
                    sources: multiple ? [2] : [1],
                    role: 'evidence',
                  },
                  {
                    text: '合成限制。',
                    sources: multiple ? [1, 2] : [1],
                    role: 'limitation',
                  },
                ],
              },
            },
          ],
        },
      );
      const markdown = (await f.service.export(owner, saved.report.reportId))
        .markdown;
      const body = markdown.split('## 出处')[0];
      expect(body).not.toMatch(/核心结论|关键依据|适用限制|^- /mu);
      expect(body).toContain(
        '\n\n合成结论。' + (multiple ? ' [1]' : '') + '\n\n',
      );
      expect(body).toContain('合成依据。' + (multiple ? ' [2]' : '') + '\n');
      expect(body).toContain(
        '合成限制。' + (multiple ? ' [1] [2]' : '') + '\n',
      );
      expect(body).toContain(
        '来源：[1]' + (multiple ? ' [2]' : '') + ' · 人工编辑。',
      );
      expect(markdown.match(/^\[1\] /gm)).toHaveLength(1);
      expect(markdown.match(/^\[2\] /gm) ?? []).toHaveLength(multiple ? 1 : 0);
      expect(f.rows.get(saved.report.reportId)).toEqual(saved.report);
      expect(f.provider.plan).not.toHaveBeenCalled();
      expect(f.provider.summarize).not.toHaveBeenCalled();
    },
  );
  it('supports model-off manual authoring and rejects invented citations', async () => {
    const f = fixture(false),
      r = (await f.service.create(owner, 'manual', request)).report;
    await expect(
      f.service.generate(owner, r.reportId, 1),
    ).rejects.toMatchObject({code: 'ai_not_configured'});
    const edit: ReportEdit = {
      title: '合成报告',
      reviewed: false,
      items: [
        {
          included: true,
          story: {
            title: '人工内容',
            points: [{text: '仅来自合成原文', sources: [40]}],
          },
        },
      ],
    };
    await expect(
      f.service.edit(owner, r.reportId, 1, edit),
    ).rejects.toMatchObject({code: 'invalid_report_group'});
    requireOperationValue(
      requireOperationValue(edit.items[0]).story.points[0],
    ).sources = [1];
    expect(
      (await f.service.edit(owner, r.reportId, 1, edit)).report.state.status,
    ).toBe('ready');
    expect((await f.service.export(owner, r.reportId)).markdown).toContain(
      '人工编辑',
    );
  });
  it('bounds total calls and resumes only unfinished steps after a failed summary', async () => {
    const f = fixture();
    let attempt = 0;
    f.provider.summarize.mockImplementation((input) => {
      if (++attempt === 2)
        return Promise.reject(new Error('synthetic-provider-secret'));
      return Promise.resolve({
        title: input.title,
        points: [
          {text: '合成摘要', sources: input.sources.map((s) => s.handle)},
        ],
      });
    });
    const r = (await f.service.create(owner, 'resume', request)).report;
    await f.service.generate(owner, r.reportId, 1);
    const failed = await f.done(r.reportId);
    expect(failed.state).toMatchObject({
      status: 'failed',
      calls: 3,
      errorCode: 'report_generation_failed',
    });
    expect(failed.state.items[0]?.draft).toBeDefined();
    await f.service.generate(owner, r.reportId, failed.version);
    expect((await f.done(r.reportId)).state).toMatchObject({
      status: 'ready',
      calls: 4,
    });
    expect(f.provider.plan).toHaveBeenCalledTimes(1);
    const bounded = fixture(),
      b = (
        await bounded.service.create(owner, 'budget', {
          ...request,
          maxModelCalls: 2,
        })
      ).report;
    await bounded.service.generate(owner, b.reportId, 1);
    const exhausted = await bounded.done(b.reportId);
    expect(exhausted.state).toMatchObject({
      status: 'failed',
      calls: 2,
      errorCode: 'report_call_budget_exhausted',
    });
    await expect(
      bounded.service.generate(owner, b.reportId, exhausted.version),
    ).rejects.toMatchObject({code: 'report_call_budget_exhausted'});
    expect(bounded.provider.summarize).toHaveBeenCalledTimes(1);
  });
  it('does not overwrite cancellation or spend more calls after a concurrent source decision', async () => {
    const f = fixture();
    f.provider.plan.mockImplementationOnce(async () => {
      const r = requireOperationValue([...f.rows.values()][0]);
      await f.service.cancel(owner, r.reportId, r.version);
      return {groups: [{title: 'Cancelled', sources: [1], recommended: true}]};
    });
    const r = (await f.service.create(owner, 'cancel', request)).report;
    await f.service.generate(owner, r.reportId, 1);
    expect((await f.done(r.reportId)).state).toMatchObject({
      status: 'cancelled',
      calls: 1,
      items: [],
    });
    expect(f.provider.summarize).not.toHaveBeenCalled();
    const hidden = fixture();
    const h = (await hidden.service.create(owner, 'hidden', request)).report;
    hidden.provider.plan.mockImplementationOnce(() => {
      hidden.intake[0] = {
        ...requireOperationValue(hidden.intake[0]),
        value: {
          ...requireOperationValue(hidden.intake[0]).value,
          decision: 'blocked',
        },
      };
      return Promise.resolve({
        groups: [{title: 'Blocked', sources: [1], recommended: true}],
      });
    });
    await hidden.service.generate(owner, h.reportId, 1);
    await vi.waitFor(() => {
      expect(hidden.rows.get(h.reportId)?.state.status).toBe('failed');
    });
    expect(hidden.provider.summarize).not.toHaveBeenCalled();
    await expect(hidden.service.read(owner, h.reportId)).rejects.toMatchObject({
      code: 'report_sources_unavailable',
    });
    expect((await hidden.service.list(owner)).reports).toEqual([]);
  });
  it('rechecks source visibility and versions before model calls, edits and exports', async () => {
    const f = fixture(),
      r = (await f.service.create(owner, 'stale', request)).report;
    f.entries[0] = {...requireOperationValue(f.entries[0]), revision: 2};
    expect((await f.service.read(owner, r.reportId)).staleSources).toEqual([
      id(10),
    ]);
    await expect(
      f.service.generate(owner, r.reportId, 1),
    ).rejects.toMatchObject({code: 'report_sources_changed'});
    await expect(f.service.export(owner, r.reportId)).rejects.toMatchObject({
      code: 'report_sources_changed',
    });
    f.entries[0] = {
      ...requireOperationValue(f.entries[0]),
      value: {...requireOperationValue(f.entries[0]).value, isPrivate: true},
    };
    await expect(f.service.read(owner, r.reportId)).rejects.toMatchObject({
      code: 'report_sources_unavailable',
    });
    expect((await f.service.list(owner)).reports).toEqual([]);
    expect(f.provider.plan).not.toHaveBeenCalled();
  });
  it('rejects unknown and repeated plan references, and tolerates an empty editorial selection', async () => {
    for (const groups of [
      [{title: 'Unknown', sources: [40]}],
      [
        {title: 'A', sources: [1]},
        {title: 'B', sources: [1]},
      ],
    ]) {
      const f = fixture();
      f.provider.plan.mockResolvedValueOnce({
        groups: groups.map((group) => ({...group, recommended: true})),
      });
      const r = (await f.service.create(owner, 'invalid', request)).report;
      await f.service.generate(owner, r.reportId, 1);
      expect((await f.done(r.reportId)).state).toMatchObject({
        status: 'failed',
        calls: 1,
        errorCode: 'invalid_report_group',
        items: [],
      });
      expect(f.provider.summarize).not.toHaveBeenCalled();
    }
    const f = fixture();
    f.provider.plan.mockResolvedValueOnce({
      groups: [{title: '背景材料', sources: [1, 2], recommended: false}],
    });
    const r = (await f.service.create(owner, 'empty', request)).report;
    await f.service.generate(owner, r.reportId, 1);
    expect((await f.done(r.reportId)).state).toMatchObject({
      status: 'ready',
      calls: 1,
      items: [],
    });
    await expect(f.service.export(owner, r.reportId)).rejects.toMatchObject({
      code: 'report_not_ready',
    });
  });
  it('keeps queued tasks dormant on restart and requires explicit continuation', async () => {
    const f = fixture(),
      r = (await f.service.create(owner, 'restart', request)).report;
    f.rows.set(r.reportId, {
      ...r,
      state: {...r.state, status: 'running', model: f.provider.model, calls: 1},
    });
    const restored = new ReportService(f.deps);
    expect((await restored.read(owner, r.reportId)).active).toBe(false);
    expect(f.provider.plan).not.toHaveBeenCalled();
    await restored.generate(owner, r.reportId, r.version);
    expect((await f.done(r.reportId, restored)).state).toMatchObject({
      status: 'ready',
      calls: 4,
    });
  });
});

it('reads report activity without starting work and hides newly private material', async () => {
  const f = fixture();
  const r = (await f.service.create(owner, 'overview-status', request)).report;
  f.rows.set(r.reportId, {
    ...r,
    state: {...r.state, status: 'queued', errorCode: AI_PRICE_WAIT},
  });
  const result = await new ReportCommands(owner, f.service).execute(
    'reports_list',
    {prioritizeActive: true},
  );
  expect(result).toMatchObject({
    reports: [
      {
        status: 'queued',
        active: false,
        errorCode: AI_PRICE_WAIT,
        planned: false,
        completedItemCount: 0,
      },
    ],
  });
  expect(f.provider.plan).not.toHaveBeenCalled();
  f.entries[0] = {
    ...requireOperationValue(f.entries[0]),
    value: {...requireOperationValue(f.entries[0]).value, isPrivate: true},
  };
  expect((await f.service.list(owner, true)).reports).toEqual([]);
});

it('global stop saves an in-flight report plan and waits before further summaries', async () => {
  let allowed = true;
  const check = async () => {
    await Promise.resolve();
    if (!allowed) throw new AiOperationsPausedError();
  };
  const f = fixture(true, check);
  const service = new ReportService({...f.deps, checkOperations: check});
  const plan = requireOperationValue(f.provider.plan.getMockImplementation());
  f.provider.plan.mockImplementationOnce(async (input) => {
    const result = await plan(input);
    allowed = false;
    return result;
  });
  const report = (await service.create(owner, 'global-report', request)).report;
  await service.generate(owner, report.reportId, report.version);
  expect((await f.done(report.reportId, service)).state).toMatchObject({
    planned: true,
    status: 'queued',
    errorCode: 'ai_operations_paused',
    calls: 1,
  });
  await service.pollPriceDeferred();
  expect(f.provider.summarize).not.toHaveBeenCalled();
  allowed = true;
  await service.pollPriceDeferred();
  expect((await f.done(report.reportId, service)).state.status).toBe('ready');
  expect(f.provider.plan).toHaveBeenCalledTimes(1);
});

describe('document journey reports', () => {
  it('uses complete calendar months, including leap years, and all-time topic selection', () => {
    expect(
      reportPeriod({...request, kind: 'monthly', date: '2040-02-18'}),
    ).toEqual({from: '2040-02-01', to: '2040-02-29'});
    expect(reportPeriod({...request, kind: 'topic'})).toEqual({
      from: '0001-01-01',
      to: '9999-12-31',
    });
  });
  it('creates a cited search collection without model calls and exports it', async () => {
    const f = fixture();
    const result = await f.service.create(owner, 'collection-without-ai', {
      ...request,
      composition: 'collection',
      maxItems: 0,
    });
    expect(result.report.state).toMatchObject({
      status: 'ready',
      origin: 'search_results',
      calls: 0,
    });
    expect(result.report.state.items.length).toBe(
      result.report.state.sources.length,
    );
    const output = await f.service.export(owner, result.report.reportId);
    expect(output.markdown).toContain('检索摘录');
    expect(f.provider.plan).not.toHaveBeenCalled();
    expect(f.provider.summarize).not.toHaveBeenCalled();
  });
});
