import {describe, expect, it, vi} from 'vitest';
import {
  unpublishedSnapshots,
  publishedEntryRepository,
  DocumentPublicationService,
} from './document_publication.js';
import {ExecutionAuthority} from './execution_authority.js';
import type {AgentTask} from './agent_task_contract.js';
import type {
  IntakeRecord,
  DocumentIntakeRepository,
} from './document_intake_contract.js';
import type {DocumentIntakeService} from './document_intake_service.js';
import type {
  CurrentInformationEntry,
  InformationEntryRepositoryPort,
} from '../modules/entries/index.js';
const W = '11111111-1111-4111-8111-111111111111',
  S = '22222222-2222-4222-8222-222222222222',
  P = '33333333-3333-4333-8333-333333333333',
  E = '44444444-4444-4444-8444-444444444444';
const entry = (revision = 1) =>
  ({entryId: E, snapshotId: P, revision}) as CurrentInformationEntry;
const record = (): IntakeRecord => ({
  snapshotId: S,
  version: 1,
  updatedAt: '2040-01-01T00:00:00Z',
  value: {
    receipt: 'accepted',
    decision: 'admitted',
    origin: 'model',
    reason: 'Synthetic complete article',
    preparedSnapshotId: P,
    preparation: 'web_article',
  },
});
const task = (status: string) =>
  ({
    taskId: E,
    request: {kind: 'document', snapshotId: S},
    state: {status, steps: [{kind: 'split', targetId: P, complete: true}]},
    createdAt: '2040-01-01T00:00:00Z',
    updatedAt: '2040-01-01T00:00:01Z',
  }) as AgentTask;
describe('document knowledge publication', () => {
  it.each(['queued', 'running', 'paused', 'failed', 'cancelled'])(
    'keeps %s document results in the workbench only',
    (status) => {
      const blocked = unpublishedSnapshots(
        [record()],
        [task(status)],
        [entry()],
      );
      expect(blocked.has(P)).toBe(true);
    },
  );
  it('publishes a completed current body and excludes its received/historical copies', () => {
    const r = record();
    r.value.previousPreparedSnapshotIds = [E];
    const blocked = unpublishedSnapshots([r], [task('succeeded')], [entry()]);
    expect([...blocked]).toEqual([S, E]);
  });
  it.each(['pending', 'rejected'])(
    'excludes %s receipts even after an earlier successful task',
    (receipt) => {
      const r = record();
      r.value.receipt = receipt as 'pending' | 'rejected';
      expect(
        unpublishedSnapshots([r], [task('succeeded')], [entry()]).has(P),
      ).toBe(true);
    },
  );
  it('withdraws held/blocked material from every knowledge consumer', () => {
    const r = record();
    r.value.decision = 'blocked';
    expect(
      unpublishedSnapshots([r], [task('succeeded')], [entry()]).has(P),
    ).toBe(true);
  });
  it('requires confirmation again after a document entry changes', () => {
    const r = record();
    r.value.publication = {
      origin: 'manual',
      confirmedAt: '2040-01-02T00:00:00Z',
      entries: [{entryId: E, revision: 1}],
    };
    expect(unpublishedSnapshots([r], [task('failed')], [entry()]).has(P)).toBe(
      false,
    );
    expect(unpublishedSnapshots([r], [task('failed')], [entry(2)]).has(P)).toBe(
      true,
    );
  });
  it('keeps historical non-task material usable and filters targeted reads as well as searches', async () => {
    const raw = {
      loadCurrentEntries: vi.fn(() => Promise.resolve([entry()])),
      loadCurrentEntriesByIds: vi.fn(() => Promise.resolve([entry()])),
    } as unknown as InformationEntryRepositoryPort;
    expect(unpublishedSnapshots([], [], [entry()]).size).toBe(0);
    const visible = publishedEntryRepository(raw, () =>
      Promise.resolve(new Set([P])),
    );
    expect(await visible.loadCurrentEntries(W, false)).toEqual([]);
    expect(await visible.loadCurrentEntriesByIds?.(W, false, [E])).toEqual([]);
    expect(await raw.loadCurrentEntries(W, false)).toHaveLength(1);
  });
  it('uses the same version-checked confirmation for owner and external Agent, with no read-only bypass', async () => {
    let r = record();
    const repository = {
      withLock: async <T>(_id: string, fn: () => Promise<T>) => fn(),
      save: vi.fn(
        (_id: string, version: number, value: IntakeRecord['value']) => {
          if (version !== r.version) return Promise.resolve(false);
          r = {...r, version: r.version + 1, value};
          return Promise.resolve(true);
        },
      ),
    } as unknown as DocumentIntakeRepository;
    const intake = {
      publicSnapshot: () => Promise.resolve({}),
      record: () => Promise.resolve(r),
    } as unknown as DocumentIntakeService;
    const raw = {
      loadCurrentEntries: () => Promise.resolve([entry()]),
    } as unknown as InformationEntryRepositoryPort;
    const service = new DocumentPublicationService(
      W,
      repository,
      intake,
      raw,
      () => Promise.resolve([]),
    );
    const input = {snapshotId: S, expectedEntries: [{entryId: E, revision: 1}]};
    await expect(
      service.confirm(
        ExecutionAuthority.agent(W, 'reader', ['documents.read']),
        input,
      ),
    ).rejects.toMatchObject({code: 'operation_not_authorized'});
    await expect(
      service.confirm(ExecutionAuthority.owner(W), {
        ...input,
        expectedEntries: [{entryId: E, revision: 2}],
      }),
    ).rejects.toMatchObject({code: 'stale_document_publication'});
    await expect(
      service.confirm(ExecutionAuthority.owner(W), input),
    ).resolves.toMatchObject({
      status: 'published',
      publication: {origin: 'manual'},
    });
    await expect(
      service.confirm(
        ExecutionAuthority.agent(W, 'writer', ['agent.split']),
        input,
      ),
    ).resolves.toMatchObject({
      status: 'published',
      publication: {origin: 'external_agent'},
    });
  });
});

it('keeps a newly accepted manual draft out of knowledge until confirmation', () => {
  const r = record();
  r.value.publication = {
    origin: 'manual',
    confirmedAt: '2040-01-01T00:00:00Z',
    entries: [],
  };
  expect(unpublishedSnapshots([r], [], [entry()]).has(P)).toBe(true);
});

it('allows receipt admission during a task but preserves a later manual content edit for confirmation', async () => {
  let r = record();
  r.value.publication = {
    origin: 'manual',
    confirmedAt: '2040-01-02T00:00:00Z',
    entries: [],
  };
  const repository = {
    withLock: <T>(_id: string, fn: () => Promise<T>) => fn(),
    save: (_id: string, _version: number, value: IntakeRecord['value']) => {
      r = {...r, value};
      return Promise.resolve(true);
    },
  } as unknown as DocumentIntakeRepository;
  const intake = {
    publicSnapshot: () => Promise.resolve({}),
    record: () => Promise.resolve(r),
  } as unknown as DocumentIntakeService;
  const raw = {
    loadCurrentEntries: () => Promise.resolve([entry()]),
  } as unknown as InformationEntryRepositoryPort;
  const service = new DocumentPublicationService(
    W,
    repository,
    intake,
    raw,
    () => Promise.resolve([]),
  );
  await expect(service.completeTask(task('running'))).resolves.toMatchObject({
    status: 'published',
  });
  r.value.publication = {
    origin: 'manual',
    draft: true,
    confirmedAt: '2040-01-02T00:00:00Z',
    entries: [],
  };
  await expect(service.completeTask(task('running'))).rejects.toMatchObject({
    code: 'document_manual_confirmation_required',
  });
});
