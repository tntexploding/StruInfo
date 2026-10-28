import {describe, expect, it, vi} from 'vitest';
import {DocumentQueue, documentQueueApplySchema} from './document_queue.js';
import type {AgentCommandDependencies} from './agent_commands.js';
import {ExecutionAuthority} from './execution_authority.js';
import {OperationError} from './operation_error.js';
import type {AgentTask} from './agent_task_contract.js';
import type {IntakeRecord} from './document_intake_contract.js';
const id = (n: number) =>
  '00000000-0000-4000-8000-' + n.toString().padStart(12, '0');
const owner = ExecutionAuthority.owner(id(1));
const document = (n: number, entryCount = 0, source = n) => ({
  snapshotId: id(n),
  sourceKey: 'Synthetic ' + String(source),
  canonicalUri: 'https://example.test/' + String(source),
  capturedAt: '2040-01-01T00:00:00.000Z',
  entryCount,
});
const record = (
  n: number,
  value: Partial<IntakeRecord['value']>,
): IntakeRecord => ({
  snapshotId: id(n),
  version: 1,
  updatedAt: '2040-01-01T00:00:00.000Z',
  value: {
    decision: 'admitted',
    origin: 'manual',
    reason: '',
    preparation: 'received',
    ...value,
  },
});
function task(n: number, status = 'paused', calls = 1) {
  return {
    taskId: id(n + 100),
    version: 2,
    createdAt: '2040-01-01T00:00:00.000Z',
    runtimeStatus: 'idle',
    request: {kind: 'document', snapshotId: id(n), maxModelCalls: 4},
    state: {
      workflow: 'confirmed-content-v1',
      status,
      phase: 'tags',
      calls,
      steps: [],
      errorCode:
        status === 'failed' ? 'model_call_budget_exhausted' : 'intake_held',
    },
  } as unknown as AgentTask & {runtimeStatus: string};
}
function fixture(
  docs = [document(2)],
  records: IntakeRecord[] = [],
  tasks: AgentTask[] = [],
) {
  const deps = {
    documents: {list: vi.fn(() => Promise.resolve({documents: docs}))},
    intake: {list: () => Promise.resolve(records)},
    tasks: {
      latestDocuments: () => Promise.resolve(tasks),
      start: vi.fn(() => Promise.resolve({taskId: id(200)})),
      control: vi.fn(() => Promise.resolve({taskId: id(201)})),
      restart: vi.fn(() => Promise.resolve({taskId: id(202)})),
    },
    ingestion: {
      status: () =>
        Promise.resolve({
          modelConfigured: true,
          policy: {
            settings: {
              maxEntries: 64,
              maxRelations: 4,
              maxModelCalls: 24,
              intake: {fetchFullText: true},
            },
          },
        }),
    },
  };
  return {
    deps,
    queue: new DocumentQueue(
      owner,
      deps as unknown as AgentCommandDependencies,
    ),
  };
}
describe('owner document queue', () => {
  it('separates fresh, continuing and exhausted work, excluding held and duplicate evidence', async () => {
    const f = fixture(
      [
        document(2),
        document(3),
        document(4, 1),
        document(5),
        document(6),
        document(7, 1),
        document(8, 0, 7),
        document(9),
        document(10, 0, 9),
      ],
      [record(5, {receipt: 'pending'}), record(6, {receipt: 'rejected'})],
      [task(3), task(4, 'failed', 4)],
    );
    const status = await f.queue.status();
    expect(status.items.filter((i) => i.action === 'start')).toHaveLength(2);
    expect(
      status.items
        .filter((i) => i.action === 'resume')
        .map((i) => i.snapshotId),
    ).toEqual([id(3)]);
    expect(
      status.items
        .filter((i) => i.action === 'restart')
        .map((i) => i.snapshotId),
    ).toEqual([id(4)]);
    expect(status.held).toBe(1);
    expect(status.duplicates).toBe(2);
  });
  it('uses the canonical receipt and does not recreate historical successful or cancelled tasks', async () => {
    const f = fixture(
      [document(2), document(3), document(4)],
      [record(8, {preparedSnapshotId: id(2)})],
      [task(8), task(3, 'succeeded'), task(4, 'cancelled')],
    );
    const result = await f.queue.status();
    expect(result.items).toHaveLength(2);
    expect(result.items.find((item) => item.action === 'resume')).toMatchObject(
      {
        snapshotId: id(8),
        taskId: id(108),
        action: 'resume',
      },
    );
  });
  it('reports per-item conflicts without losing valid admissions and uses the saved budgets', async () => {
    const f = fixture(
      [document(2), document(3)],
      [record(3, {receipt: 'accepted'})],
    );
    const result = await f.queue.apply({
      action: 'start',
      items: [
        {snapshotId: id(2), expectedVersion: 0},
        {snapshotId: id(3), expectedVersion: 0},
      ],
    });
    expect(result.queued).toHaveLength(1);
    expect(result.failed).toEqual([
      {snapshotId: id(3), code: 'document_queue_changed'},
    ]);
    expect(f.deps.tasks.start).toHaveBeenCalledWith(
      owner,
      expect.stringContaining('backlog-'),
      expect.objectContaining({
        maxEntries: 64,
        maxModelCalls: 24,
        intake: {fetchFullText: true},
      }),
    );
  });
  it('limits batch size and rejects duplicate snapshots and external writes', async () => {
    expect(
      documentQueueApplySchema.safeParse({
        action: 'start',
        items: Array.from({length: 33}, (_, i) => ({
          snapshotId: id(i + 2),
          expectedVersion: 0,
        })),
      }).success,
    ).toBe(false);
    expect(
      documentQueueApplySchema.safeParse({
        action: 'resume',
        items: [
          {snapshotId: id(2), expectedVersion: 0},
          {snapshotId: id(2), expectedVersion: 0},
        ],
      }).success,
    ).toBe(false);
    const f = fixture();
    const agent = ExecutionAuthority.agent(id(1), 'synthetic', []);
    await expect(
      new DocumentQueue(
        agent,
        f.deps as unknown as AgentCommandDependencies,
      ).status(),
    ).rejects.toMatchObject({code: 'operation_not_authorized'});
  });
});

it('does not bypass a current inbox decision using an older capture of the same source', async () => {
  const f = fixture(
    [document(2), document(3, 0, 2)],
    [record(2, {receipt: 'pending'})],
  );
  const status = await f.queue.status();
  expect(status.items).toEqual([]);
  expect(status.held).toBe(2);
});

it('cancels held, over-capacity and running work without model access or admitting documents', async () => {
  const overCapacity = task(2, 'failed');
  overCapacity.state.errorCode = 'ai_split_input_unsupported';
  const active = {...task(4, 'running'), runtimeStatus: 'running'};
  const f = fixture(
    [document(2), document(3), document(4), document(5), document(6)],
    [
      record(3, {receipt: 'accepted', decision: 'held'}),
      record(4, {
        publication: {
          draft: true,
          origin: 'manual',
          confirmedAt: '2040-01-01T00:00:00Z',
          entries: [],
        },
      }),
    ],
    [overCapacity, task(3), active, task(5, 'succeeded'), task(6, 'cancelled')],
  );
  const queue = new DocumentQueue(owner, {
    ...f.deps,
    ingestion: undefined,
  } as unknown as AgentCommandDependencies);
  const status = await queue.status();
  const items = status.items.filter((item) => item.action === 'cancel');
  expect(items.map((item) => item.snapshotId).sort()).toEqual([
    id(2),
    id(3),
    id(4),
  ]);
  expect(status.items.some((item) => item.action === 'resume')).toBe(false);
  expect(items.find((item) => item.snapshotId === id(2))).toMatchObject({
    errorCode: 'ai_split_input_unsupported',
    taskStatus: 'failed',
  });
  const result = await queue.apply({
    action: 'cancel',
    items: items.map(({snapshotId, taskId, expectedVersion}) => ({
      snapshotId,
      taskId,
      expectedVersion,
    })),
  });
  expect(result.cancelled).toHaveLength(3);
  expect(result.queued).toEqual([]);
  expect(result.failed).toEqual([]);
  expect(f.deps.tasks.control).toHaveBeenCalledTimes(3);
  expect(f.deps.tasks.control).toHaveBeenCalledWith(
    owner,
    id(104),
    2,
    'cancel',
  );
  expect(f.deps.tasks.start).not.toHaveBeenCalled();
  expect(f.deps.tasks.restart).not.toHaveBeenCalled();
});

it('keeps cancellation version-checked and reports partial conflicts', async () => {
  const f = fixture(
    [document(2), document(3), document(4)],
    [],
    [task(2), task(3), task(4)],
  );
  f.deps.tasks.control.mockRejectedValueOnce(
    new OperationError('conflict', 'stale_task_version'),
  );
  const result = await f.queue.apply({
    action: 'cancel',
    items: [
      {snapshotId: id(2), taskId: id(102), expectedVersion: 1},
      {snapshotId: id(3), taskId: id(103), expectedVersion: 2},
      {snapshotId: id(4), taskId: id(104), expectedVersion: 2},
    ],
  });
  expect(result.failed).toEqual([
    {snapshotId: id(2), code: 'document_queue_changed'},
    {snapshotId: id(3), code: 'stale_task_version'},
  ]);
  expect(result.cancelled).toEqual([{snapshotId: id(4), taskId: id(201)}]);
  expect(f.deps.tasks.control).toHaveBeenCalledTimes(2);
  expect(f.deps.tasks.start).not.toHaveBeenCalled();
});

it('keeps cancellation owner-only even for agents with model and task grants', async () => {
  const f = fixture([document(2)], [], [task(2)]);
  const agent = ExecutionAuthority.agent(id(1), 'synthetic', [
    'documents.read',
    'processing.read',
    'tasks.control',
    'models.use',
  ]);
  await expect(
    new DocumentQueue(
      agent,
      f.deps as unknown as AgentCommandDependencies,
    ).apply({
      action: 'cancel',
      items: [{snapshotId: id(2), taskId: id(102), expectedVersion: 2}],
    }),
  ).rejects.toMatchObject({code: 'operation_not_authorized'});
  expect(f.deps.tasks.control).not.toHaveBeenCalled();
});

it('keeps rejected and blocked idle history out of current cancellation and attention counts', async () => {
  const f = fixture(
    [document(2), document(3), document(4, 0, 2), document(5)],
    [
      record(2, {receipt: 'rejected'}),
      record(3, {decision: 'blocked'}),
      record(5, {receipt: 'accepted', decision: 'held'}),
    ],
    [task(2), task(3, 'failed'), task(5)],
  );
  const result = await f.queue.status();
  expect(result.items).toMatchObject([{snapshotId: id(5), action: 'cancel'}]);
  expect(result.held).toBe(1);
  expect(f.deps.tasks.control).not.toHaveBeenCalled();
});

it('still allows stopping an active writer after its document is rejected', async () => {
  const f = fixture(
    [document(2), document(3)],
    [record(2, {receipt: 'rejected'}), record(3, {decision: 'blocked'})],
    [{...task(2), runtimeStatus: 'running'}, task(3, 'queued')],
  );
  const result = await f.queue.status();
  expect(result.items.map((item) => [item.snapshotId, item.action])).toEqual([
    [id(3), 'cancel'],
    [id(2), 'cancel'],
  ]);
  expect(result.held).toBe(0);
});
