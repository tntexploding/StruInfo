import {describe, it, expect, vi} from 'vitest';
import {ResearchService, researchSettingsId} from './research_service.js';
import {ReportPipeline} from './report_pipeline.js';
import {ReportService} from './report_service.js';
import {ExecutionAuthority} from './execution_authority.js';
import {AiWorkQueue} from './ai_work_queue.js';
import {
  researchSettingsSchema,
  researchRecordValueSchema,
  scheduleSchema,
  type ResearchRepository,
  type ResearchRecord,
  type WebSearchProvider,
} from './research_contract.js';
import {
  reportRequestSchema,
  type ReportRecord,
  type ReportRepository,
} from './report_contract.js';
import {latestReportSlot} from './report_schedule.js';
import {
  DeepSeekSearchProvider,
  publicWebUrl,
} from '../platform/ai/deepseek_search_provider.js';
import type {
  InformationEntryRepositoryPort,
  CurrentInformationEntry,
} from '../modules/entries/index.js';
import type {EvidenceReadRepositoryPort} from '../modules/evidence/index.js';
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture');
  return value;
}
const id = (n: number) =>
  '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const owner = ExecutionAuthority.owner(id(1));
class MemoryResearch implements ResearchRepository {
  rows = new Map<string, ResearchRecord>();
  tail: Promise<unknown> = Promise.resolve();
  read(id: string) {
    return Promise.resolve(structuredClone(this.rows.get(id)));
  }
  list(kind: ResearchRecord['value']['kind']) {
    return Promise.resolve(
      structuredClone(
        [...this.rows.values()].filter((r) => r.value.kind === kind),
      ),
    );
  }
  save(writes: Parameters<ResearchRepository['save']>[0]) {
    if (
      writes.some(
        (w) => (this.rows.get(w.id)?.version ?? 0) !== w.expectedVersion,
      )
    )
      return Promise.resolve(false);
    for (const w of writes)
      this.rows.set(w.id, {
        id: w.id,
        version: w.expectedVersion + 1,
        updatedAt: '2040-01-02T12:00:00.000Z',
        value: researchRecordValueSchema.parse(structuredClone(w.value)),
      });
    return Promise.resolve(true);
  }
  withLock<T>(action: () => Promise<T>) {
    const p = this.tail.then(action);
    this.tail = p.catch(() => undefined);
    return p;
  }
}
const webRow = {
  title: 'Synthetic bandwidth',
  url: 'https://example.invalid/article',
  content: 'A full synthetic article about memory bandwidth.',
  summary: 'Synthetic summary.',
  contentKind: 'body' as const,
  retrievedAt: '2040-01-02T00:00:00.000Z',
};
async function searchFixture(enabled = true) {
  const repository = new MemoryResearch();
  await repository.save([
    {
      id: researchSettingsId(id(1)),
      expectedVersion: 0,
      value: {
        kind: 'settings',
        settings: researchSettingsSchema.parse({enabled}),
        watchSince: '2040-01-02T00:00:00.000Z',
      },
    },
  ]);
  const web = {
    search: vi.fn<WebSearchProvider['search']>(() => Promise.resolve([webRow])),
    fetch: vi.fn<WebSearchProvider['fetch']>(() => Promise.resolve(webRow)),
  };
  const gate = vi.fn(() => Promise.resolve()),
    capture = vi.fn(() => Promise.resolve({status: 'created'}));
  const evidence = {
    handle: 'E01',
    titlePath: 'Local synthetic',
    excerpt: 'A local body.',
    truncated: false,
    contentKeywords: [],
    domains: [],
    entryId: id(4),
    entryRevision: 1,
    snapshotId: id(5),
    fragmentIds: [id(6)],
  };
  const local = {
    retrieve: vi.fn<
      (
        request: unknown,
      ) => Promise<{querySha256: string; evidence: (typeof evidence)[]}>
    >(() =>
      Promise.resolve({
        querySha256: 'a'.repeat(64),
        evidence: [evidence],
      }),
    ),
  };
  const answer = {
    model: 'synthetic',
    providerKey: 'deepseek-responses-v1' as const,
    promptVersion: 'test',
    synthesize: vi.fn(() =>
      Promise.resolve({
        answer: 'Synthetic answer',
        evidenceStatus: 'supported' as const,
        claims: [{statement: 'A local observation', evidenceRefs: ['E01']}],
        limitations: [],
      }),
    ),
  };
  const visible = new Set([id(4)]);
  const service = new ResearchService({
    workspaceId: id(1),
    repository,
    web,
    local,
    answer,
    queue: new AiWorkQueue(() => Promise.resolve(2)),
    checkAllowed: gate,
    visibleEntryIds: () => Promise.resolve(visible),
    capture,
    clock: () => new Date('2040-01-02T12:00:00Z'),
  });
  return {service, repository, web, gate, capture, local, answer, visible};
}
describe('P6 DeepSeek public research', () => {
  it('rechecks cached answers and in-flight model results against public visibility', async () => {
    const f = await searchFixture();
    const request = {
      requestKey: 'local',
      question: 'memory',
      mode: 'local',
      query: {text: '', limit: 20},
    };
    await f.service.answer(owner, request);
    f.visible.clear();
    await expect(f.service.answer(owner, request)).rejects.toMatchObject({
      code: 'research_evidence_unavailable',
    });
    expect(f.answer.synthesize).toHaveBeenCalledTimes(1);
    f.visible.add(id(4));
    f.answer.synthesize.mockImplementationOnce(() => {
      f.visible.clear();
      return Promise.resolve({
        answer: 'Synthetic answer',
        evidenceStatus: 'supported',
        claims: [{statement: 'Observation', evidenceRefs: ['E01']}],
        limitations: [],
      });
    });
    await expect(
      f.service.answer(owner, {...request, requestKey: 'inflight'}),
    ).rejects.toMatchObject({code: 'research_evidence_unavailable'});
  });
  it('defaults off and requires paid-call authority before contacting the provider', async () => {
    const f = await searchFixture(false);
    await expect(
      f.service.search(owner, {requestKey: 'a', query: 'public'}),
    ).rejects.toMatchObject({code: 'web_search_disabled'});
    expect(f.web.search).not.toHaveBeenCalled();
    const agent = ExecutionAuthority.agent(id(1), 'reader', ['entries.search']);
    await expect(
      f.service.search(agent, {requestKey: 'b', query: 'public'}),
    ).rejects.toMatchObject({code: 'operation_not_authorized'});
  });
  it('shares concurrent identical requests and preserves the result for explicit pending capture', async () => {
    const f = await searchFixture();
    const [a, b] = await Promise.all([
      f.service.search(owner, {requestKey: 'a', query: 'public'}),
      f.service.search(owner, {requestKey: 'a', query: 'public'}),
    ]);
    expect(a).toEqual(b);
    expect(f.web.search).toHaveBeenCalledTimes(1);
    expect(f.capture).not.toHaveBeenCalled();
    await f.service.capture(owner, {sessionId: a.sessionId, index: 0});
    expect(f.capture).toHaveBeenCalledWith(owner, expect.any(String), webRow);
    expect((await f.service.status(owner)).estimatedCny).toBe(0.005);
    await expect(
      f.service.search(owner, {requestKey: 'a', query: 'changed'}),
    ).rejects.toMatchObject({code: 'idempotency_conflict'});
  });
  it('reserves daily allowance before dispatch, including uncertain failures across service restarts', async () => {
    const f = await searchFixture();
    const row = await f.repository.read(researchSettingsId(id(1)));
    expect(row?.value.kind).toBe('settings');
    if (row?.value.kind !== 'settings') throw Error('fixture');
    await f.repository.save([
      {
        id: row.id,
        expectedVersion: row.version,
        value: {
          ...row.value,
          settings: {...row.value.settings, dailyRequests: 1},
        },
      },
    ]);
    f.web.search.mockRejectedValueOnce(Error('connection lost'));
    await expect(
      f.service.search(owner, {requestKey: 'a', query: 'public'}),
    ).rejects.toThrow('connection lost');
    await expect(
      f.service.search(owner, {requestKey: 'b', query: 'public'}),
    ).rejects.toMatchObject({code: 'web_daily_limit'});
    expect(f.web.search).toHaveBeenCalledTimes(1);
    expect((await f.repository.list('charge'))[0]?.value).toMatchObject({
      status: 'unknown',
      estimatedCny: 0.005,
    });
  });
  it('does not dispatch through a closed AI gate', async () => {
    const f = await searchFixture();
    f.gate.mockRejectedValueOnce(Error('paused'));
    await expect(
      f.service.search(owner, {requestKey: 'a', query: 'public'}),
    ).rejects.toThrow('paused');
    expect(await f.repository.list('charge')).toEqual([]);
    expect(f.web.search).not.toHaveBeenCalled();
  });
  it('rejects private scopes before either search or model work', async () => {
    const f = await searchFixture();
    await expect(
      f.service.answer(owner, {
        requestKey: 'a',
        question: 'Synthetic?',
        mode: 'mixed',
        webQuery: 'public',
        query: {includePrivate: true},
      }),
    ).rejects.toMatchObject({code: 'ai_query_private_scope_forbidden'});
    expect(f.web.search).not.toHaveBeenCalled();
    expect(f.answer.synthesize).not.toHaveBeenCalled();
  });
  it('falls back to filtered local evidence on a network failure and never sends library body to search', async () => {
    const f = await searchFixture();
    f.web.search.mockRejectedValueOnce(Error('offline'));
    const r = await f.service.answer(owner, {
      requestKey: 'a',
      question: 'Synthetic?',
      mode: 'mixed',
      webQuery: 'public memory',
      query: {sourceKey: 'chosen-source'},
    });
    expect(r).toMatchObject({
      evidenceStatus: 'supported',
      limitations: ['联网搜索未完成，本次回答仅使用库内材料。'],
    });
    expect(f.web.search).toHaveBeenCalledWith('public memory', 5);
    expect(f.local.retrieve.mock.calls[0]?.[0]).toMatchObject({
      query: {sourceKey: 'chosen-source'},
    });
  });
  it('retains summary-only evidence, refuses capture, and separates account sessions', async () => {
    const f = await searchFixture();
    f.web.search.mockResolvedValueOnce([
      {...webRow, content: '', contentKind: 'summary'},
    ]);
    const r = await f.service.search(owner, {requestKey: 'a', query: 'public'});
    await expect(
      f.service.capture(owner, {sessionId: r.sessionId, index: 0}),
    ).rejects.toMatchObject({code: 'web_body_required'});
    const agent = ExecutionAuthority.agent(id(1), 'other', [
      'entries.search',
      'sources.capture',
    ]);
    await expect(
      f.service.capture(agent, {sessionId: r.sessionId, index: 0}),
    ).rejects.toMatchObject({code: 'web_session_expired'});
  });
  it.each([
    'http://localhost/',
    'http://127.1/',
    'http://10.1.1.1/',
    'http://[::1]/',
    'https://u:password@example.com',
    'file:///test',
  ])('rejects unsafe result %s', (url) => {
    expect(() => publicWebUrl(url)).toThrow();
  });
  it('uses fixed Search / Fetch endpoints with bounded public evidence and no credential redirects', async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          results: [
            {
              title: 'Synthetic',
              url: 'https://example.invalid/a',
              summary: 'Excerpt',
              content: 'Full body',
              date: null,
            },
            {title: 'Local', url: 'http://127.0.0.1/x', content: 'private'},
          ],
        }),
      ),
    );
    const p = new DeepSeekSearchProvider('synthetic-secret', fetcher);
    const results = await p.search('memory', 5);
    expect(results).toHaveLength(1);
    expect(results[0]?.contentKind).toBe('body');
    expect(fetcher.mock.calls[0]).toMatchObject([
      'https://api.deepseek.com/v1/tools/search',
      {
        redirect: 'error',
        body: JSON.stringify({query: 'memory', count: 5, need_content: true}),
      },
    ]);
    expect(JSON.stringify(results)).not.toContain('synthetic-secret');
  });
});

function reportFixture() {
  const repository = new MemoryResearch(),
    reports = new Map<string, ReportRecord>();
  let now = new Date('2040-01-02T00:00:00Z');
  const entry: CurrentInformationEntry = {
    workspaceId: id(1),
    entryId: id(2),
    resourceId: id(3),
    snapshotId: id(4),
    revisionId: id(5),
    revision: 1,
    sourceKey: 'Synthetic publisher',
    capturedAt: '2040-01-02T00:00:00.000Z',
    value: {
      titlePath: 'Synthetic memory evidence',
      body: 'Synthetic article with supported observations.',
      bodySha256: 'a'.repeat(64),
      documentOrder: 1,
      chunkMode: 'whole',
      splitRuleVersion: 'synthetic',
      isPrivate: false,
      contentKeywords: [],
      domains: [],
      fragmentIds: [id(6)],
    },
  };
  const entries = [entry];
  const repo: ReportRepository = {
    read: (key) => Promise.resolve(structuredClone(reports.get(key))),
    list: () => Promise.resolve([...reports.values()]),
    save: (key, version, state) => {
      if ((reports.get(key)?.version ?? 0) !== version)
        return Promise.resolve(false);
      reports.set(key, {
        reportId: key,
        version: version + 1,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        state: structuredClone(state),
      });
      return Promise.resolve(true);
    },
    withLock: async (_id, action) => action(),
  };
  const service = new ReportService({
    workspaceId: id(1),
    repository: repo,
    entries: {
      loadCurrentEntries: () =>
        Promise.resolve(entries.filter((e) => !e.value.isPrivate)),
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
    intake: {
      list: () =>
        Promise.resolve(
          entries.map((e) => ({
            snapshotId: e.snapshotId,
            version: 1,
            updatedAt: e.capturedAt,
            value: {
              decision: 'admitted' as const,
              origin: 'manual' as const,
              reason: 'test',
              preparation: 'received' as const,
            },
          })),
        ),
    },
  });
  const deps = {
    workspaceId: id(1),
    repository,
    reports: service,
    entries: () => Promise.resolve(entries.filter((e) => !e.value.isPrivate)),
    clock: () => now,
    budgetStatus: () => Promise.resolve(null),
  };
  return {
    repository,
    entries,
    reports,
    service,
    pipeline: new ReportPipeline(deps),
    deps,
    setTime: (time: string) => {
      now = new Date(time);
    },
  };
}
const schedule = () =>
  scheduleSchema.parse({
    name: 'Synthetic daily',
    enabled: true,
    timeZone: 'UTC',
    localTime: '09:00',
    cadence: 'daily',
    missed: 'once',
    publish: true,
    request: reportRequestSchema.parse({
      kind: 'daily',
      date: '2040-01-01',
      timeZone: 'UTC',
      composition: 'collection',
    }),
  });
describe('P6 schedules and independent publication', () => {
  it('keeps the same slot identity across configuration revisions', async () => {
    const f = reportFixture();
    f.setTime('2040-01-03T09:00:00Z');
    await f.pipeline.execute(owner, 'report_schedule_save', {
      id: id(20),
      expectedVersion: 0,
      schedule: schedule(),
    });
    await f.pipeline.poll();
    await f.pipeline.execute(owner, 'report_schedule_save', {
      id: id(20),
      expectedVersion: 1,
      schedule: {...schedule(), name: 'Renamed'},
    });
    await new ReportPipeline(f.deps).poll();
    expect(f.reports.size).toBe(1);
    expect(await f.repository.list('run')).toHaveLength(1);
  });
  it('marks an interrupted generated report for owner continuation without another call', async () => {
    const f = reportFixture();
    await f.pipeline.execute(owner, 'report_schedule_save', {
      id: id(20),
      expectedVersion: 0,
      schedule: {...schedule(), publish: false},
    });
    f.setTime('2040-01-03T09:01:00Z');
    await f.pipeline.poll();
    const report = required([...f.reports.values()][0]);
    f.reports.set(report.reportId, {
      ...report,
      state: {...report.state, status: 'queued'},
    });
    const run = required((await f.repository.list('run'))[0]);
    if (run.value.kind !== 'run') throw Error('fixture');
    await f.repository.save([
      {
        id: run.id,
        expectedVersion: run.version,
        value: {...run.value, status: 'generating'},
      },
    ]);
    await new ReportPipeline(f.deps).poll();
    expect((await f.repository.read(run.id))?.value).toMatchObject({
      status: 'failed',
      errorCode: 'report_resume_required',
    });
    expect(f.reports.get(report.reportId)?.state.calls).toBe(0);
  });
  it('ends a daytime quiet interval on the same day', async () => {
    const f = reportFixture();
    f.setTime('2040-01-02T00:00:00Z');
    await f.pipeline.execute(owner, 'research_settings_save', {
      expectedVersion: 0,
      settings: researchSettingsSchema.parse({
        notices: {
          enabled: true,
          timeZone: 'UTC',
          quietFrom: '09:00',
          quietTo: '18:00',
        },
      }),
    });
    f.setTime('2040-01-02T12:00:00Z');
    await f.pipeline.poll();
    expect((await f.repository.list('notice'))[0]?.value).toMatchObject({
      visibleAt: '2040-01-02T18:00:00.000Z',
    });
  });
  it('generates and publishes a single frozen report even after polling and process recreation', async () => {
    const f = reportFixture();
    await f.pipeline.execute(owner, 'report_schedule_save', {
      id: id(20),
      expectedVersion: 0,
      schedule: schedule(),
    });
    f.setTime('2040-01-03T09:01:00Z');
    await f.pipeline.poll();
    await new ReportPipeline(f.deps).poll();
    expect(f.reports.size).toBe(1);
    expect(await f.repository.list('run')).toHaveLength(1);
    expect(await f.repository.list('notice')).toHaveLength(1);
    const report = [...f.reports.values()][0];
    expect(report?.state.sources[0]).toMatchObject({
      revision: 1,
      frozenText: f.entries[0]?.value.body,
    });
  });
  it('keeps generation separate when automatic publication is off, and deduplicates an explicit publication version', async () => {
    const f = reportFixture();
    await f.pipeline.execute(owner, 'report_schedule_save', {
      id: id(20),
      expectedVersion: 0,
      schedule: {...schedule(), publish: false},
    });
    f.setTime('2040-01-03T09:01:00Z');
    await f.pipeline.poll();
    expect(await f.repository.list('notice')).toEqual([]);
    const r = [...f.reports.values()][0];
    if (!r) throw Error('missing');
    await f.pipeline.publish(owner, r.reportId, r.version);
    await f.pipeline.publish(owner, r.reportId, r.version);
    expect(await f.repository.list('notice')).toHaveLength(1);
  });
  it('skips missed windows when requested and never grants an unbudgeted AI schedule', async () => {
    const f = reportFixture();
    await f.pipeline.execute(owner, 'report_schedule_save', {
      id: id(20),
      expectedVersion: 0,
      schedule: {...schedule(), missed: 'skip'},
    });
    f.setTime('2040-01-03T12:00:00Z');
    await f.pipeline.poll();
    expect(f.reports.size).toBe(0);
    expect((await f.repository.list('run'))[0]?.value).toMatchObject({
      status: 'skipped',
    });
    const s = schedule();
    s.request.composition = 'ai';
    await expect(
      f.pipeline.execute(owner, 'report_schedule_save', {
        id: id(21),
        expectedVersion: 0,
        schedule: s,
      }),
    ).rejects.toMatchObject({code: 'report_budget_required'});
  });
  it('freezes published Markdown and hides it after a source becomes private', async () => {
    const f = reportFixture();
    const r = (
      await f.service.create(owner, 'test', {
        ...schedule().request,
        date: '2040-01-02',
      })
    ).report;
    const published = await f.pipeline.publish(owner, r.reportId, r.version);
    f.entries[0] = {
      ...required(f.entries[0]),
      revision: 2,
      value: {
        ...required(f.entries[0]).value,
        body: 'Changed source body',
      },
    };
    expect((await f.service.export(owner, r.reportId)).markdown).not.toContain(
      'Changed source body',
    );
    expect((await f.pipeline.status(owner)).notices[0]?.value).toEqual(
      published?.value,
    );
    f.entries[0] = {
      ...f.entries[0],
      value: {...f.entries[0].value, isPrivate: true},
    };
    expect((await f.pipeline.status(owner)).notices).toEqual([]);
  });
  it('merges article updates, supports urgent notices, and respects quiet time without a model', async () => {
    const f = reportFixture();
    const settings = researchSettingsSchema.parse({
      notices: {
        enabled: true,
        timeZone: 'UTC',
        quietFrom: '22:00',
        quietTo: '08:00',
        sources: [],
        urgentTerms: [],
        intervalMinutes: 60,
      },
    });
    await f.pipeline.execute(owner, 'research_settings_save', {
      expectedVersion: 0,
      settings,
    });
    f.setTime('2040-01-02T23:00:00Z');
    await f.pipeline.poll();
    expect((await f.repository.list('notice'))[0]?.value).toMatchObject({
      visibleAt: '2040-01-03T08:00:00.000Z',
    });
    expect((await f.pipeline.status(owner)).notices).toEqual([]);
    f.entries[0] = {...required(f.entries[0]), revision: 2};
    await f.pipeline.execute(owner, 'research_settings_save', {
      expectedVersion: 1,
      settings: {
        ...settings,
        notices: {...settings.notices, urgentTerms: ['memory']},
      },
    });
    await f.pipeline.poll();
    expect(await f.repository.list('notice')).toHaveLength(1);
    expect((await f.pipeline.status(owner)).notices[0]?.value).toMatchObject({
      urgent: true,
      correction: true,
    });
  });
  it('uses local calendar boundaries and skips nonexistent DST slots', () => {
    const s = schedule();
    s.timeZone = 'America/New_York';
    s.localTime = '02:30';
    expect(latestReportSlot(s, new Date('2026-03-08T12:00:00Z'))?.key).toBe(
      '2026-03-07T02:30',
    );
    s.localTime = '01:30';
    expect(latestReportSlot(s, new Date('2026-11-01T08:00:00Z'))?.key).toBe(
      '2026-11-01T01:30',
    );
  });
});
