import {describe, expect, it} from 'vitest';

import type {
  CurrentInformationEntry,
  InformationEntryRepositoryPort,
} from '../entries/index.js';
import type {
  EntryAutomationWorkItem,
  EntryAutomationWorkItemState,
  EntryAutomationWorkQueueRepositoryPort,
  ProcessingRunWriteOutcome,
} from './index.js';
import {
  listEntryAutomationWorkQueue,
  updateEntryAutomationWorkItem,
} from './entry_automation_work_queue_service.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

describe('Entry automation work queue service', () => {
  it('hides private work by default and exposes stale routing facts', async () => {
    const repository = new MemoryQueue([workItem(1), workItem(2)]);
    const entries = new MemoryEntries([
      entry(1, {revision: 2}),
      entry(2, {isPrivate: true}),
    ]);

    const publicResult = await listEntryAutomationWorkQueue(
      {repository, entries},
      WORKSPACE_ID,
      false,
    );
    const privateResult = await listEntryAutomationWorkQueue(
      {repository, entries},
      WORKSPACE_ID,
      true,
    );

    expect(publicResult).toMatchObject({
      status: 'complete',
      items: [{entryId: entryId(1), stale: true}],
    });
    expect(
      privateResult.status === 'complete' && privateResult.items,
    ).toHaveLength(2);
  });

  it('updates only the requested owner state with optimistic versioning', async () => {
    const repository = new MemoryQueue([workItem(1)]);
    const entries = new MemoryEntries([entry(1)]);

    const applied = await updateEntryAutomationWorkItem(
      {repository, entries},
      {
        workspaceId: WORKSPACE_ID,
        runId: RUN_ID,
        claimOrdinal: 0,
        expectedVersion: 1,
        state: 'completed',
        includePrivate: false,
      },
    );
    const stale = await updateEntryAutomationWorkItem(
      {repository, entries},
      {
        workspaceId: WORKSPACE_ID,
        runId: RUN_ID,
        claimOrdinal: 0,
        expectedVersion: 1,
        state: 'dismissed',
        includePrivate: false,
      },
    );

    expect(applied).toMatchObject({
      status: 'applied',
      item: {state: 'completed', version: 2},
    });
    expect(stale).toEqual({status: 'stale'});
    expect(entries.values[0]?.revision).toBe(1);
  });
});

class MemoryQueue implements EntryAutomationWorkQueueRepositoryPort {
  public items: EntryAutomationWorkItem[];

  public constructor(items: readonly EntryAutomationWorkItem[]) {
    this.items = [...items];
  }

  public listWorkItems(): Promise<
    readonly Readonly<EntryAutomationWorkItem>[]
  > {
    return Promise.resolve(Object.freeze([...this.items]));
  }

  public loadWorkItem(
    _workspaceId: string,
    runId: string,
    claimOrdinal: number,
  ): Promise<Readonly<EntryAutomationWorkItem> | undefined> {
    return Promise.resolve(
      this.items.find(
        (item) => item.runId === runId && item.claimOrdinal === claimOrdinal,
      ),
    );
  }

  public updateWorkItem(
    _workspaceId: string,
    runId: string,
    claimOrdinal: number,
    expectedVersion: number,
    state: EntryAutomationWorkItemState,
  ): Promise<ProcessingRunWriteOutcome> {
    const index = this.items.findIndex(
      (item) => item.runId === runId && item.claimOrdinal === claimOrdinal,
    );
    const current = this.items[index];
    if (current === undefined) return Promise.resolve('not_found');
    if (current.version !== expectedVersion) return Promise.resolve('stale');
    if (current.state === state) return Promise.resolve('unchanged');
    const withoutResolution = {...current};
    delete withoutResolution.resolvedAt;
    this.items[index] = {
      ...withoutResolution,
      state,
      version: current.version + 1,
      updatedAt: '2040-01-02T04:00:00.000Z',
      ...(state === 'pending' ? {} : {resolvedAt: '2040-01-02T04:00:00.000Z'}),
    };
    return Promise.resolve('applied');
  }
}

class MemoryEntries implements InformationEntryRepositoryPort {
  public constructor(
    public readonly values: readonly Readonly<CurrentInformationEntry>[],
  ) {}

  public materializeEntries(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  public reviseEntry(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  public loadCurrentEntries(): Promise<
    readonly Readonly<CurrentInformationEntry>[]
  > {
    return Promise.resolve(this.values);
  }
}

function workItem(ordinal: number): EntryAutomationWorkItem {
  return {
    workspaceId: WORKSPACE_ID,
    runId: RUN_ID,
    claimOrdinal: ordinal - 1,
    entryId: entryId(ordinal),
    entryRevision: 1,
    entryRevisionId: revisionId(ordinal, 1),
    route: ordinal === 1 ? 'advance_candidate' : 'manual_review',
    reason: ordinal === 1 ? 'advance_threshold_met' : 'threshold_not_met',
    state: 'pending',
    version: 1,
    createdAt: '2040-01-02T03:04:05.000Z',
    updatedAt: '2040-01-02T03:04:05.000Z',
  };
}

function entry(
  ordinal: number,
  options: Readonly<{revision?: number; isPrivate?: boolean}> = {},
): CurrentInformationEntry {
  const revision = options.revision ?? 1;
  return {
    workspaceId: WORKSPACE_ID,
    entryId: entryId(ordinal),
    resourceId: '33333333-3333-4333-8333-333333333333',
    snapshotId: '44444444-4444-4444-8444-444444444444',
    revision,
    revisionId: revisionId(ordinal, revision),
    sourceKey: 'synthetic',
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: {
      documentOrder: ordinal - 1,
      titlePath: `Synthetic ${String(ordinal)}`,
      body: `Synthetic body ${String(ordinal)}`,
      bodySha256: ordinal.toString(16).padStart(64, '0'),
      chunkMode: 'split',
      splitRuleVersion: 'synthetic.v1',
      isPrivate: options.isPrivate === true,
      contentKeywords: Object.freeze([]),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze([]),
    },
  };
}

function entryId(ordinal: number): string {
  return `55555555-5555-4555-8555-${ordinal.toString().padStart(12, '0')}`;
}

function revisionId(ordinal: number, revision: number): string {
  return `66666666-6666-4666-8666-${(ordinal * 10 + revision)
    .toString()
    .padStart(12, '0')}`;
}
