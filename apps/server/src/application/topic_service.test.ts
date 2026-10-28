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
import {
  topicScopeSchema,
  type TopicRepository,
  type TopicRecord,
  type TopicProvider,
  type TopicResponse,
  type TopicJob,
  topicSummaryStale,
} from '../modules/entries/content_topics.js';
import {selectTopicCandidates} from '../modules/entries/topic_candidates.js';
import {
  EMPTY_ANNOTATION_VOCABULARY,
  type AnnotationVocabulary,
} from '../modules/entries/structured_annotations.js';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = ExecutionAuthority.owner(id(1));
function entry(
  n: number,
  body = `Memory bandwidth limits computation for synthetic version ${String(n)}.`,
): CurrentInformationEntry {
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
