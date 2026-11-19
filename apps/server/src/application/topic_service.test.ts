import {describe, it, expect, vi} from 'vitest';
import {TopicService} from './topic_service.js';
import {
  ExecutionAuthority,
  DELEGATED_READ_OPERATIONS,
} from './execution_authority.js';
import {OperationError} from './operation_error.js';
import {AiPriceWindowClosedError} from '../modules/processing/ai_price_policy.js';
import {informationEntryBodySha256} from '../modules/entries/information_entry_identity.js';
import type {CurrentInformationEntry} from '../modules/entries/information_entry_contract.js';
import type {InformationEntryAssociationRepositoryPort} from '../modules/entries/information_entry_association_repository.js';
import {
  topicScopeSchema,
  type TopicRepository,
  type TopicRecord,
  type TopicProvider,
  type TopicResponse,
  type TopicJob,
  type TopicValue,
  topicSummaryStale,
} from '../modules/entries/content_topics.js';
import {
  selectTopicCandidates,
  prepareTopicInput,
} from '../modules/entries/topic_candidates.js';
import {
  EMPTY_ANNOTATION_VOCABULARY,
  type AnnotationVocabulary,
} from '../modules/entries/structured_annotations.js';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = ExecutionAuthority.owner(id(1));
it('retains domain-only local candidates without sending them to the model', () => {
  const rows = [entry(2), entry(3)];
  for (const e of rows) {
    const a = e.value.annotations;
    if (!a?.dimensions[0]) throw new Error('Missing fixture annotation');
    a.dimensions[0].role = 'domain';
  }
  const prepared = prepareTopicInput(
    rows,
    EMPTY_ANNOTATION_VOCABULARY,
    topicScopeSchema.parse({entryId: id(2)}),
    [],
    [],
  );
  expect(prepared.candidates).toHaveLength(1);
  expect(prepared.candidates[0]?.eligibleForAi).toBe(false);
  expect(prepared.input.entries).toHaveLength(1);
});
it('keeps label candidates first and bounds vector-only additions under the same scope', () => {
  const rows = [2, 3, 4, 5, 6, 7].map((n) => {
    const row = entry(n);
    if (n < 4) return row;
    const annotations = row.value.annotations;
    if (!annotations) throw new Error('Missing fixture annotation');
    return {
      ...row,
      value: {
        ...row.value,
        isPrivate: n === 7,
        annotations: {...annotations, labels: []},
      },
    };
  });
  const result = selectTopicCandidates(
    rows,
    EMPTY_ANNOTATION_VOCABULARY,
    topicScopeSchema.parse({entryId: id(2), candidateLimit: 8}),
    new Map([
      [id(3), 6000],
      [id(4), 9500],
      [id(5), 9400],
      [id(6), 9300],
      [id(7), 9900],
    ]),
  );
  expect(result.candidates.map((c) => c.entryId)).toEqual([
    id(3),
    id(4),
    id(5),
  ]);
  expect(result.candidates[0]?.labelCandidate).toBe(true);
  expect(result.candidates.every((c) => c.uncertain)).toBe(true);
});
function entry(
  n: number,
  body = `Memory bandwidth limits computation for synthetic version ${String(n)}.`,
): CurrentInformationEntry {
  const hash = informationEntryBodySha256(body);
  const dimension = {
    id: id(100),
    name: '对象',
    role: 'entity' as const,
    description: '',
    enabled: true,
  };
  return {
    workspaceId: id(1),
    entryId: id(n),
    resourceId: id(n + 20),
    snapshotId: id(n + 40),
    revision: 1,
    revisionId: id(n + 60),
    sourceKey: 'synthetic-' + String(n),
    canonicalUri: `https://source${String(n)}.invalid/article`,
    capturedAt: '2026-10-24T00:00:00.000Z',
    publishedAt: '2026-01-02T00:00:00.000Z',
    value: {
      annotations: {
        schemaVersion: 1,
        vocabularyRevision: 0,
        dimensions: [dimension],
        inputRevision: 1,
        inputBodySha256: hash,
        origin: 'manual',
        originVersion: 'test',
        status: 'complete',
        note: '',
        readingState: 'unread',
        claims: [],
        labels: [
          {
            dimensionId: dimension.id,
            term: {
              id: id(101),
              dimensionId: dimension.id,
              label: '内存',
              meaning: '计算机内存',
            },
            wording: '内存',
            primary: true,
            evidence: {start: 0, end: body.length, quote: body},
          },
        ],
      },
      titlePath: 'Memory bandwidth ' + String(n),
      body,
      bodySha256: informationEntryBodySha256(body),
      documentOrder: 0,
      chunkMode: 'whole',
      splitRuleVersion: 'synthetic',
      isPrivate: false,
      fragmentIds: [id(n + 80)],
      contentKeywords: [],
      domains: [],
    },
  };
}
class MemoryTopics implements TopicRepository {
  rows = new Map<string, TopicRecord>();
  tail: Promise<unknown> = Promise.resolve();
  read(id: string) {
    return Promise.resolve(structuredClone(this.rows.get(id)));
  }
  list(kind: 'topic' | 'job') {
    return Promise.resolve(
      structuredClone(
        [...this.rows.values()].filter((r) => r.value.kind === kind),
      ),
    );
  }
  save(writes: Parameters<TopicRepository['save']>[0]) {
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
        updatedAt: new Date().toISOString(),
        value: structuredClone(w.value),
      });
    return Promise.resolve(true);
  }
  withLock<T>(action: () => Promise<T>): Promise<T> {
    const p = this.tail.then(action);
    this.tail = p.catch(() => undefined);
    return p;
  }
}
function response(
  input: Parameters<TopicProvider['generate']>[0],
): TopicResponse {
  return {
    topics: [
      {
        topicId: input.topics[0]?.id ?? null,
        name: '带宽约束',
        scope: '内存带宽与计算效率',
        summary: '两份材料讨论带宽约束。',
        members: input.entries
          .filter(
            (e) =>
              !input.topics[0]?.value.members.some(
                (m) => m.entryId === e.entryId && m.decision === 'excluded',
              ),
          )
          .map((e) => ({
            entryId: e.entryId,
            revision: e.revision,
            quote: e.body,
            reason: '讨论带宽约束',
          })),
      },
    ],
    relations: [],
    note: '',
  };
}
function fixture(
  custom?: TopicProvider['generate'],
  sourceGuidance?: (snapshotId: string) => Promise<string>,
  associations?: InformationEntryAssociationRepositoryPort,
) {
  const rows = [entry(2), entry(3), entry(4)],
    repository = new MemoryTopics();
  const provider = {
    generate: vi.fn(custom ?? ((input) => Promise.resolve(response(input)))),
  };
  const check = vi.fn(() => Promise.resolve());
  const service = new TopicService({
    workspaceId: id(1),
    repository,
    entries: {
      loadCurrentEntries: () =>
        Promise.resolve(rows.filter((e) => !e.value.isPrivate)),
      materializeEntries: () => Promise.reject(new Error('not used')),
      reviseEntry: () => Promise.reject(new Error('not used')),
    },
    provider,
    ...(sourceGuidance ? {sourceGuidance} : {}),
    ...(associations ? {associations} : {}),
    checkModelCall: check,
    executionSettings: () => Promise.resolve({automaticRetryLimit: 1}),
  });
  const scope = topicScopeSchema.parse({entryId: id(2)});
  const start = () =>
    service.execute(owner, 'topic_job_start', {
      scope,
      budgetId: 'synthetic-p5',
    }) as Promise<{
      jobId: string;
      reused: boolean;
    }>;
  const job = (key: string) => repository.rows.get(key)?.value as TopicJob;
  const done = (key: string) =>
    Promise.resolve(
      vi.waitFor(() => {
        expect(job(key).status).not.toBe('running');
      }),
    );
  return {rows, repository, provider, service, start, job, done, check, scope};
}
describe('bounded background topics', () => {
  it('starts the next queued group when the prior group finishes without a timer tick', async () => {
    let release: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const f = fixture(async () => {
      calls++;
      if (calls === 1) await first;
      return {topics: [], relations: [], note: ''};
    });
    const a = await f.start();
    const b = (await f.service.execute(owner, 'topic_job_start', {
      scope: {...f.scope, entryId: id(3)},
      budgetId: 'synthetic-p5',
    })) as {jobId: string};
    expect(f.job(b.jobId).status).toBe('queued');
    required(release)();
    await vi.waitFor(() => {
      expect(f.job(a.jobId).status).toBe('succeeded');
      expect(f.job(b.jobId).status).toBe('succeeded');
    });
    expect(calls).toBe(2);
    await f.service.drain();
  });
  it('lists large topic sets with bounded protection reads and preserves cross-batch overrides', async () => {
    const blocked = {
      workspaceId: id(1),
      entryLowId: id(1000),
      entryHighId: id(1105),
      revision: 1,
      revisionId: id(3000),
      value: {action: 'block' as const, manualAdjustment: 0, isBlocked: true},
    };
    const scoped = vi.fn(
      (_workspace: string, _private: boolean, ids: readonly string[]) => {
        if (ids.length > 100) throw new Error('association read limit');
        return Promise.resolve({
          projections: [],
          overrides:
            ids.includes(blocked.entryLowId) ||
            ids.includes(blocked.entryHighId)
              ? [blocked]
              : [],
        });
      },
    );
    const full = vi.fn(() => Promise.reject(new Error('unscoped read')));
    const f = fixture(undefined, undefined, {
      loadAssociationSnapshot: full,
      loadAssociationSnapshotForEntries: scoped,
      replaceAssociationProjections: () => Promise.resolve(0),
      writeAssociationOverride: () => Promise.resolve('unchanged'),
    });
    f.rows.splice(
      0,
      f.rows.length,
      ...Array.from({length: 130}, (_, i) => entry(i + 1000)),
    );
    const topic = (n: number, a: number, b: number): TopicRecord => {
      const members = [required(f.rows[a]), required(f.rows[b])].map((e) => ({
        entryId: e.entryId,
        revision: e.revision,
        quote: e.value.body,
        reason: '同一主题',
        decision: 'included' as const,
        origin: 'ai' as const,
      }));
      return {
        id: id(n + 2000),
        version: 1,
        updatedAt: '2026-11-05T00:00:00.000Z',
        value: {
          kind: 'topic',
          name: '主题',
          scope: '合成材料',
          origin: 'ai',
          members,
          summary: '',
          summaryVersions: [],
          ruleVersion: 'topics.v1',
          relations: [
            {
              from: required(members[0]),
              to: required(members[1]),
              kind: 'continues',
              reason: '后续材料',
              origin: 'ai',
              blocked: false,
            },
          ],
        },
      };
    };
    for (let n = 0; n < 54; n++) {
      const row = topic(n, n * 2, n * 2 + 1);
      f.repository.rows.set(row.id, row);
    }
    const crossBatch = topic(54, 0, 105);
    f.repository.rows.set(crossBatch.id, crossBatch);
    const list = (input: Record<string, string>) =>
      f.service.execute(owner, 'topics_list', input) as Promise<{
        topics: {id: string; value: TopicValue}[];
      }>;
    const all = await list({});
    expect(all.topics).toHaveLength(55);
    expect(scoped.mock.calls.map((c) => c[2].length)).toEqual([100, 8]);
    expect(
      all.topics.find((t) => t.id === crossBatch.id)?.value.relations,
    ).toEqual([]);
    expect(all.topics[0]?.value.relations).toHaveLength(1);
    expect(full).not.toHaveBeenCalled();

    scoped.mockClear();
    expect((await list({entryId: id(1000)})).topics).toHaveLength(2);
    expect(scoped.mock.calls[0]?.[2]).toEqual([id(1000), id(1001), id(1105)]);
    scoped.mockClear();
    expect(
      (await list({snapshotId: required(f.rows[2]).snapshotId})).topics,
    ).toHaveLength(1);
    expect(scoped.mock.calls[0]?.[2]).toEqual([id(1002), id(1003)]);
    scoped.mockClear();
    expect((await list({entryId: id(1129)})).topics).toEqual([]);
    expect(scoped).not.toHaveBeenCalled();
    f.rows[0] = {
      ...required(f.rows[0]),
      value: {...required(f.rows[0]).value, isPrivate: true},
    };
    scoped.mockClear();
    expect((await list({entryId: id(1000)})).topics).toEqual([]);
    expect(scoped).not.toHaveBeenCalled();
  });
  it('freezes source guidance and includes changed guidance in job identity', async () => {
    let guidance = '比较带宽瓶颈';
    const f = fixture(undefined, () => Promise.resolve(guidance));
    const first = await f.start();
    await f.service.drain();
    expect(
      f
        .job(first.jobId)
        .input.entries.every((e) => e.ownerRelationGuidance === guidance),
    ).toBe(true);
    guidance = '比较成本约束';
    const second = await f.start();
    await f.service.drain();
    expect(second.jobId).not.toBe(first.jobId);
    expect(f.job(first.jobId).input.entries[0]?.ownerRelationGuidance).toBe(
      '比较带宽瓶颈',
    );
    expect(f.job(second.jobId).input.entries[0]?.ownerRelationGuidance).toBe(
      guidance,
    );
  });
  it('reuses the same successful inputs, including after their AI topic was created', async () => {
    const f = fixture();
    const r = await f.start();
    await f.service.drain();
    expect(f.job(r.jobId).status).toBe('succeeded');
    expect(await f.repository.list('topic')).toHaveLength(1);
    expect((await f.start()).reused).toBe(true);
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
  });
  it('keeps no-topic output successful and does not require a pair relation', async () => {
    const f = fixture(() =>
      Promise.resolve({
        topics: [],
        relations: [],
        note: '没有足够具体的共同问题。',
      }),
    );
    const r = await f.start();
    await f.service.drain();
    expect(f.job(r.jobId).status).toBe('succeeded');
    expect(await f.repository.list('topic')).toHaveLength(0);
  });
  it('saves paid answers but refuses late member versions and invalid quotes', async () => {
    let release: ((r: TopicResponse) => void) | undefined;
    const f = fixture(
      (input) =>
        new Promise((resolve) => {
          release = () => {
            resolve(response(input));
          };
        }),
    );
    const r = await f.start();
    await vi.waitFor(() => {
      expect(release).toBeDefined();
    });
    f.rows[0] = {...required(f.rows[0]), revision: 2};
    release?.({topics: [], relations: [], note: ''});
    await f.service.drain();
    expect(f.job(r.jobId)).toMatchObject({
      status: 'failed',
      errorCode: 'topic_input_changed',
    });
    expect(f.job(r.jobId).result).toBeDefined();
    expect(await f.repository.list('topic')).toHaveLength(0);
    const b = fixture((input) => {
      const v = response(input);
      required(required(v.topics[0]).members[0]).quote = 'not in source';
      return Promise.resolve(v);
    });
    const rb = await b.start();
    await b.service.drain();
    expect(b.job(rb.jobId).status).toBe('failed');
  });
  it('honors cancellation while preserving in-flight output', async () => {
    let release: (() => void) | undefined;
    const f = fixture(
      (input) =>
        new Promise((resolve) => {
          release = () => {
            resolve(response(input));
          };
        }),
    );
    const r = await f.start();
    await vi.waitFor(() => {
      expect(release).toBeDefined();
    });
    const row = required(f.repository.rows.get(r.jobId));
    await f.service.execute(owner, 'topic_job_control', {
      jobId: r.jobId,
      expectedVersion: row.version,
      action: 'cancel',
    });
    release?.();
    await f.service.drain();
    expect(f.job(r.jobId).status).toBe('cancelled');
    expect(f.job(r.jobId).result).toBeDefined();
    expect(await f.repository.list('topic')).toHaveLength(0);
  });
  it('keeps the original response, deduplicates members and skips single-entry topics', async () => {
    for (const onlyOneEntry of [false, true]) {
      const f = fixture((input) => {
        const v = response(input);
        const t = required(v.topics[0]);
        const first = required(t.members[0]);
        t.members = onlyOneEntry
          ? [first, {...first}]
          : [...t.members, {...first}];
        return Promise.resolve(v);
      });
      const {jobId} = await f.start();
      await f.service.drain();
      expect(f.job(jobId).status).toBe('succeeded');
      expect(f.job(jobId).result?.topics[0]?.members).toHaveLength(
        onlyOneEntry ? 2 : 4,
      );
      const topics = await f.repository.list('topic');
      if (onlyOneEntry) expect(topics).toHaveLength(0);
      else {
        const topic = required(topics[0]).value as TopicValue;
        expect(topic.members).toHaveLength(3);
      }
    }
  });
  it('applies a valid group alongside single-member and empty proposals without retrying', async () => {
    const f = fixture((input) => {
      const result = response(input),
        good = required(result.topics[0]);
      result.topics.push(
        {...good, name: 'Singleton', members: [required(good.members[0])]},
        {...good, name: 'Empty', members: []},
      );
      return Promise.resolve(result);
    });
    const {jobId} = await f.start();
    await f.service.drain();
    expect(f.job(jobId).status).toBe('succeeded');
    expect(f.job(jobId).result?.topics).toHaveLength(3);
    expect(await f.repository.list('topic')).toHaveLength(1);
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
  });
  it('resumes a paid result after an AI-only version conflict without calling the model again', async () => {
    const f = fixture();
    const first = await f.start();
    await vi.waitFor(() => {
      expect(f.job(first.jobId).status).toBe('succeeded');
    });
    const initial = required((await f.repository.list('topic'))[0]);
    if (initial.value.kind !== 'topic') throw new Error('fixture');
    f.rows[0] = {...required(f.rows[0]), revision: 2};
    let release: (() => void) | undefined;
    f.provider.generate.mockImplementationOnce(
      (input) =>
        new Promise((resolve) => {
          release = () => {
            resolve(response(input));
          };
        }),
    );
    const next = await f.start();
    await vi.waitFor(() => {
      expect(release).toBeDefined();
    });
    await f.repository.save([
      {
        id: initial.id,
        expectedVersion: initial.version,
        value: {...initial.value, scope: 'Changed AI scope'},
      },
    ]);
    required(release)();
    await vi.waitFor(() => {
      expect(f.job(next.jobId).status).toBe('failed');
    });
    const changed = required(await f.repository.read(initial.id));
    const extra = entry(5);
    f.rows.push(extra);
    await f.repository.save([
      {
        id: initial.id,
        expectedVersion: changed.version,
        value: {
          ...initial.value,
          members: [
            ...initial.value.members,
            {
              entryId: extra.entryId,
              revision: extra.revision,
              quote: extra.value.body,
              reason: 'Concurrent AI membership',
              decision: 'included',
              origin: 'ai',
            },
          ],
        },
      },
    ]);
    const job = required(await f.repository.read(next.jobId));
    await f.service.execute(owner, 'topic_job_control', {
      jobId: next.jobId,
      expectedVersion: job.version,
      action: 'resume',
    });
    await vi.waitFor(() => {
      expect(f.job(next.jobId).status).toBe('succeeded');
    });
    await f.service.drain();
    expect(f.provider.generate).toHaveBeenCalledTimes(2);
    const topic = required(await f.repository.read(initial.id))
      .value as TopicValue;
    expect(topic.members.map((m) => m.entryId)).toContain(extra.entryId);
  });
  it('checks cancellation again before dispatch and retains its reservation', async () => {
    let reserve: (() => Promise<void>) | undefined;
    let fail: ((error: unknown) => void) | undefined;
    const dispatched = vi.fn();
    const f = fixture(
      (input, _budget, onUsage) =>
        new Promise((resolve, reject) => {
          fail = reject;
          reserve = async () => {
            await onUsage({
              id: id(90),
              batchId: 'synthetic-p5',
              reservedNanoCny: 100,
            });
            dispatched();
            resolve(response(input));
          };
        }),
    );
    const job = await f.start();
    await vi.waitFor(() => {
      expect(reserve).toBeDefined();
    });
    const row = required(await f.repository.read(job.jobId));
    await f.service.execute(owner, 'topic_job_control', {
      jobId: row.id,
      expectedVersion: row.version,
      action: 'cancel',
    });
    await required(reserve)().catch((error: unknown) => {
      fail?.(error);
    });
    await f.service.drain();
    expect(dispatched).not.toHaveBeenCalled();
    expect(f.job(job.jobId)).toMatchObject({
      status: 'cancelled',
      usage: [{reservedNanoCny: 100}],
    });
  });
  it('keeps newer manual topic edits when a paid answer arrives', async () => {
    const f = fixture();
    const first = await f.start();
    await vi.waitFor(() => {
      expect(f.job(first.jobId).status).toBe('succeeded');
    });
    const initial = required((await f.repository.list('topic'))[0]);
    f.rows[0] = {...required(f.rows[0]), revision: 2};
    let release: (() => void) | undefined;
    f.provider.generate.mockImplementationOnce(
      (input) =>
        new Promise((resolve) => {
          release = () => {
            resolve(response(input));
          };
        }),
    );
    const next = await f.start();
    await vi.waitFor(() => {
      expect(release).toBeDefined();
    });
    await f.service.execute(owner, 'topic_save', {
      topicId: initial.id,
      expectedVersion: initial.version,
      name: '人工确定的范围',
      scope: '保留这个主题的人工范围',
    });
    release?.();
    await f.service.drain();
    expect(f.job(next.jobId)).toMatchObject({
      status: 'failed',
      errorCode: 'topic_version_changed',
    });
    expect(f.job(next.jobId).result).toBeDefined();
    expect((await f.repository.read(initial.id))?.value).toMatchObject({
      name: '人工确定的范围',
      summary: '',
    });
  });
  it('keeps price waits unspent and retries only transport failures within frozen attempts', async () => {
    const f = fixture();
    f.check.mockRejectedValueOnce(new AiPriceWindowClosedError());
    const r = await f.start();
    await vi.waitFor(() => {
      expect(f.job(r.jobId).errorCode).toBe('ai_price_window_closed');
    });
    expect(f.job(r.jobId).attempts).toBe(0);
    expect(f.provider.generate).not.toHaveBeenCalled();
    await f.service.poll();
    await vi.waitFor(() => {
      expect(f.job(r.jobId).status).toBe('succeeded');
    });
    const bad = fixture(() => {
      return Promise.reject(
        new OperationError('rejected', 'ai_provider_unavailable'),
      );
    });
    const b = await bad.start();
    await vi.waitFor(() => {
      expect(bad.job(b.jobId).errorCode).toBe('ai_provider_unavailable');
    });
    await bad.service.poll();
    await vi.waitFor(() => {
      expect(bad.job(b.jobId).status).toBe('failed');
    });
    await bad.service.poll();
    expect(bad.provider.generate).toHaveBeenCalledTimes(2);
    const invalid = fixture(() => {
      return Promise.reject(
        new OperationError('rejected', 'ai_provider_invalid_json'),
      );
    });
    const c = await invalid.start();
    await invalid.service.drain();
    expect(invalid.job(c.jobId).attempts).toBe(1);
    expect(invalid.job(c.jobId).status).toBe('failed');
  });
  it('hides an AI topic with fewer than two retained members and keeps its exclusions', async () => {
    const f = fixture();
    await f.start();
    await f.service.drain();
    let t = required((await f.repository.list('topic'))[0]);
    if (t.value.kind !== 'topic') throw new Error('fixture');
    for (const member of t.value.members.slice(0, -1)) {
      const {origin: ignored, ...evidence} = member;
      void ignored;
      await f.service.execute(owner, 'topic_member_set', {
        topicId: t.id,
        expectedVersion: t.version,
        member: {
          ...evidence,
          decision: 'excluded',
          reason: 'Evidence does not support the topic',
        },
      });
      t = required(await f.repository.read(t.id));
    }
    expect(await f.service.execute(owner, 'topics_list', {})).toMatchObject({
      topics: [],
    });
    expect(
      t.value.kind === 'topic' &&
        t.value.members.filter((m) => m.decision === 'excluded'),
    ).toHaveLength(2);
  });
  it('preserves manual exclusions and rejects agent overwrite, stale summaries and private reads', async () => {
    const f = fixture();
    const first = await f.start();
    await vi.waitFor(() => {
      expect(f.job(first.jobId).status).toBe('succeeded');
    });
    let t = required((await f.repository.list('topic'))[0]);
    if (t.value.kind !== 'topic') throw new Error('fixture');
    const m = required(t.value.members[0]);
    const member = {
      entryId: m.entryId,
      revision: m.revision,
      quote: m.quote,
      reason: '人工排除',
      decision: 'excluded',
    };
    await f.service.execute(owner, 'topic_member_set', {
      topicId: t.id,
      expectedVersion: t.version,
      member,
    });
    const a = ExecutionAuthority.agent(id(1), 'synthetic-agent', [
      ...DELEGATED_READ_OPERATIONS,
      'agent.relations',
    ]);
    t = required(await f.repository.read(t.id));
    expect(t.value).toMatchObject({summary: '', summaryVersions: []});
    await expect(
      f.service.execute(a, 'topic_member_set', {
        topicId: t.id,
        expectedVersion: t.version,
        member: {...member, decision: 'pinned'},
      }),
    ).rejects.toMatchObject({code: 'topic_manual_decision'});
    const next = await f.start();
    await vi.waitFor(() => {
      expect(f.job(next.jobId).status).toBe('succeeded');
    });
    t = required(await f.repository.read(t.id));
    if (t.value.kind !== 'topic') throw new Error('fixture');
    expect(t.value.members[0]?.decision).toBe('excluded');
    expect(topicSummaryStale(t.value, f.rows)).toBe(false);
    f.rows[0] = {
      ...required(f.rows[0]),
      value: {...required(f.rows[0]).value, isPrivate: true},
    };
    expect(await f.service.execute(owner, 'topics_list', {})).toEqual({
      topics: [],
      jobs: [],
      budget: null,
    });
    await expect(
      f.service.execute(a, 'topic_job_start', {
        scope: f.scope,
        budgetId: 'synthetic-p5',
      }),
    ).rejects.toMatchObject({code: 'topic_owner_required'});
  });
  it('validates pair evidence and applies optional grounded relations once', async () => {
    const f = fixture((input) => {
      const v = response(input),
        a = required(input.entries[0]),
        b = required(input.entries[1]);
      v.relations = [
        {
          from: {entryId: a.entryId, revision: a.revision, quote: a.body},
          to: {entryId: b.entryId, revision: b.revision, quote: b.body},
          kind: 'continues',
          reason: '后续条目比较同一问题',
        },
      ];
      return Promise.resolve(v);
    });
    const r = (await f.service.execute(owner, 'topic_job_start', {
      scope: {...f.scope, maxRelations: 1},
      budgetId: 'synthetic-p5',
    })) as {
      jobId: string;
    };
    await f.service.drain();
    expect(f.job(r.jobId).status).toBe('succeeded');
    const t = required((await f.repository.list('topic'))[0]);
    if (t.value.kind !== 'topic') throw new Error('fixture');
    expect(t.value.relations).toHaveLength(1);
  });
});
describe('topic recall', () => {
  it('excludes stale and single-current-member old topics while retaining current manual exclusions', () => {
    const rows = [entry(2), entry(3), entry(4)];
    const members = rows.map((e) => ({
      entryId: e.entryId,
      revision: e.revision,
      quote: e.value.body,
      reason: 'Prior evidence',
      decision: 'included' as const,
      origin: 'ai' as const,
    }));
    const value: TopicValue = {
      kind: 'topic',
      name: 'Prior',
      scope: 'A shared question',
      origin: 'ai',
      members,
      relations: [],
      summary: 'Old summary',
      summaryVersions: [],
      ruleVersion: 'old',
    };
    const topics: TopicRecord[] = [
      {id: id(10), version: 1, updatedAt: '', value},
      {
        id: id(11),
        version: 1,
        updatedAt: '',
        value: {...value, members: [required(members[0])]},
      },
      {
        id: id(12),
        version: 1,
        updatedAt: '',
        value: {...value, members: members.map((m) => ({...m, revision: 99}))},
      },
    ];
    const p = prepareTopicInput(
      rows,
      EMPTY_ANNOTATION_VOCABULARY,
      topicScopeSchema.parse({entryId: id(2)}),
      topics,
      [],
    );
    expect(p.input.topics.map((t) => t.id)).toEqual([id(10)]);
    expect(p.input.topics[0]?.value.summary).toBe('');
    expect(topics[0]?.value).toEqual(value);
  });
  it('retains complete originals while the provider limits transmitted excerpts', () => {
    const rows = [entry(2), entry(3)].map((e) => {
      const body = e.value.body + '\n' + 'A'.repeat(60_000);
      const bodySha256 = informationEntryBodySha256(body);
      return {
        ...e,
        value: {
          ...e.value,
          body,
          bodySha256,
          annotations: {
            ...required(e.value.annotations),
            inputBodySha256: bodySha256,
          },
        },
      };
    });
    const scope = topicScopeSchema.parse({entryId: id(2), candidateLimit: 2});
    const prepared = prepareTopicInput(
      rows,
      EMPTY_ANNOTATION_VOCABULARY,
      scope,
      [],
      [],
    );
    expect(prepared.input.entries.map((e) => e.body)).toEqual(
      rows.map((e) => e.value.body),
    );
    const oversized = rows.map((e) => ({
      ...e,
      value: {...e.value, body: e.value.body.repeat(2)},
    }));
    expect(
      prepareTopicInput(
        oversized,
        EMPTY_ANNOTATION_VOCABULARY,
        scope,
        [],
        [],
      ).input.entries.map((e) => e.body),
    ).toEqual(oversized.map((e) => e.value.body));
  });
  it('does not send word-only similarities or empty label sets to the model', async () => {
    const f = fixture();
    for (const row of f.rows)
      delete (row.value as {annotations?: unknown}).annotations;
    expect(
      selectTopicCandidates(f.rows, EMPTY_ANNOTATION_VOCABULARY, f.scope)
        .candidates,
    ).toEqual([]);
    const {jobId} = await f.start();
    await f.service.drain();
    expect(f.job(jobId).status).toBe('succeeded');
    expect(f.provider.generate).not.toHaveBeenCalled();
  });
  it('keeps manual documents distinct when their canonical URI has no host', () => {
    const entries = Array.from({length: 8}, (_, i) => ({
      ...entry(i + 2),
      canonicalUri: 'struinfo:manual/' + String(i),
    }));
    const selected = selectTopicCandidates(
      entries,
      EMPTY_ANNOTATION_VOCABULARY,
      topicScopeSchema.parse({entryId: id(2)}),
    );
    expect(selected.candidates).toHaveLength(7);
    expect(
      selected.candidates.every((c) => c.source.startsWith('synthetic-')),
    ).toBe(true);
  });
  it('bounds source/document/reprint contributions and respects time filters', () => {
    const entries = Array.from({length: 30}, (_, i) => entry(i + 2));
    entries[2] = {...required(entries[2]), value: required(entries[1]).value};
    entries[3] = {
      ...required(entries[3]),
      snapshotId: required(entries[0]).snapshotId,
    };
    entries[4] = {
      ...required(entries[4]),
      publishedAt: '2020-01-01T00:00:00.000Z',
    };
    for (let i = 6; i < 20; i++)
      entries[i] = {
        ...required(entries[i]),
        canonicalUri: 'https://same.invalid/' + String(i),
      };
    const v = selectTopicCandidates(
      entries,
      EMPTY_ANNOTATION_VOCABULARY,
      topicScopeSchema.parse({
        entryId: id(2),
        candidateLimit: 8,
        publishedFrom: '2024-01-01T00:00:00.000Z',
      }),
    );
    expect(v.candidates.length).toBeLessThanOrEqual(7);
    expect(
      v.candidates.filter((c) => c.source === 'same.invalid').length,
    ).toBeLessThanOrEqual(2);
    expect(v.candidates.map((c) => c.entryId)).not.toContain(id(4));
    expect(v.candidates.map((c) => c.entryId)).not.toContain(id(5));
    expect(v.candidates.map((c) => c.entryId)).not.toContain(id(6));
  });
  it('counts cooccurrence inside independent entries, not across digest siblings or repeated publishers', () => {
    const dim = {
      id: id(100),
      name: '对象',
      role: 'entity' as const,
      description: '',
      enabled: true,
    };
    const vocabulary: AnnotationVocabulary = {
      revision: 1,
      dimensions: [dim],
      terms: [],
      aliases: [],
      relations: [],
    };
    const tagged = (n: number, terms: number[]) => {
      const e = entry(n, 'Synthetic prose ' + String(n));
      return {
        ...e,
        value: {
          ...e.value,
          annotations: {
            schemaVersion: 1 as const,
            vocabularyRevision: 1,
            dimensions: [dim],
            inputRevision: 1,
            inputBodySha256: e.value.bodySha256,
            origin: 'manual' as const,
            originVersion: 'test',
            status: 'complete' as const,
            note: '',
            readingState: 'unread' as const,
            claims: [],
            labels: terms.map((t) => ({
              dimensionId: dim.id,
              term: {
                id: id(t),
                dimensionId: dim.id,
                label: 'term' + String(t),
                meaning: 'synthetic',
              },
              wording: 'term' + String(t),
              primary: true,
              evidence: {start: 0, end: 9, quote: 'Synthetic'},
            })),
          },
        },
      };
    };
    const seed = tagged(2, [101]),
      a = tagged(3, [101]),
      b = tagged(4, [102]);
    const no = selectTopicCandidates(
      [seed, a, {...b, snapshotId: a.snapshotId}],
      vocabulary,
      topicScopeSchema.parse({entryId: seed.entryId}),
    );
    expect(no.candidates.every((c) => c.samples === 0)).toBe(true);
    const both = tagged(5, [101, 102]),
      repeat = {
        ...tagged(6, [101, 102]),
        canonicalUri: required(both.canonicalUri),
      };
    const yes = selectTopicCandidates(
      [seed, a, b, both, repeat],
      vocabulary,
      topicScopeSchema.parse({entryId: seed.entryId}),
    );
    expect(yes.candidates.find((c) => c.entryId === b.entryId)?.samples).toBe(
      1,
    );
  });
});
function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error('Missing synthetic or selected entry');
  return value;
}
