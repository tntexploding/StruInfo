import {describe, expect, it} from 'vitest';

import {
  deriveInformationEntryRevisionId,
  type CurrentInformationEntry,
  type InformationEntryAssociationRepositoryPort,
  type InformationEntryRepositoryPort,
} from '../entries/index.js';
import {
  createReviewPreferences,
  type ReviewPreferencesStore,
} from '../../storage/review_preferences_store.js';
import {
  executeEntryAutomationWorkItemAction,
  type EntryAutomationAction,
  type EntryAutomationActionKeyword,
  type EntryAutomationActionRepositoryPort,
  type EntryAutomationActionWriteOutcome,
  type EntryAutomationWorkItem,
  type EntryAutomationWorkQueueRepositoryPort,
} from './index.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const ENTRY_ID = '33333333-3333-4333-8333-333333333333';

describe('Entry automation actions', () => {
  it('adds deterministic rule tags, rebuilds projections and safely undoes only its own tags', async () => {
    const entries = new MemoryEntries();
    const repository = new MemoryActions(entries);
    const associations = new MemoryAssociations();
    const preferences = memoryPreferences();
    const dependencies = {
      repository,
      workQueue: repository,
      entries,
      associations,
      preferences,
    };

    const applied = await executeEntryAutomationWorkItemAction(dependencies, {
      workspaceId: WORKSPACE_ID,
      runId: RUN_ID,
      claimOrdinal: 0,
      expectedVersion: 1,
      includePrivate: false,
      operation: 'apply',
    });

    expect(applied.status).toBe('applied');
    expect(entries.current.value.contentKeywords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayValue: 'Alpha Utility',
          origin: 'rule',
        }),
      ]),
    );
    expect(repository.action.state).toBe('applied');
    expect(associations.rebuilds).toBe(1);

    const undone = await executeEntryAutomationWorkItemAction(dependencies, {
      workspaceId: WORKSPACE_ID,
      runId: RUN_ID,
      claimOrdinal: 0,
      expectedVersion: repository.action.version,
      includePrivate: false,
      operation: 'undo',
    });

    expect(undone.status).toBe('applied');
    expect(entries.current.value.contentKeywords).toEqual([]);
    expect(repository.action.state).toBe('undone');
    expect(associations.rebuilds).toBe(2);
  });
});

class MemoryEntries implements InformationEntryRepositoryPort {
  public current: CurrentInformationEntry = currentEntry();

  public materializeEntries(): Promise<
    Readonly<{outcome: 'existing'; createdCount: 0}>
  > {
    return Promise.resolve(
      Object.freeze({outcome: 'existing', createdCount: 0}),
    );
  }

  public reviseEntry(): Promise<'unchanged'> {
    return Promise.resolve('unchanged');
  }

  public loadCurrentEntries(): Promise<
    readonly Readonly<CurrentInformationEntry>[]
  > {
    return Promise.resolve(Object.freeze([this.current]));
  }
}

class MemoryActions
  implements
    EntryAutomationActionRepositoryPort,
    EntryAutomationWorkQueueRepositoryPort
{
  public action: EntryAutomationAction = action('pending', 1, 0);
  readonly #entries: MemoryEntries;

  public constructor(entries: MemoryEntries) {
    this.#entries = entries;
  }

  public listWorkItems(): Promise<
    readonly Readonly<EntryAutomationWorkItem>[]
  > {
    return Promise.resolve(Object.freeze([this.item()]));
  }

  public listRunWorkItems(): Promise<
    readonly Readonly<EntryAutomationWorkItem>[]
  > {
    return this.listWorkItems();
  }

  public loadWorkItem(): Promise<Readonly<EntryAutomationWorkItem>> {
    return Promise.resolve(this.item());
  }

  public updateWorkItem(): Promise<'unchanged'> {
    return Promise.resolve('unchanged');
  }

  public applyAction(
    input: Readonly<{
      expectedVersion: number;
      resultEntryRevisionId: string;
      keywords: readonly Readonly<EntryAutomationActionKeyword>[];
    }>,
  ): Promise<EntryAutomationActionWriteOutcome> {
    if (input.expectedVersion !== this.action.version)
      return Promise.resolve('stale');
    const previous = this.#entries.current;
    const revision = previous.revision + (input.keywords.length === 0 ? 0 : 1);
    this.#entries.current = Object.freeze({
      ...previous,
      revision,
      revisionId: input.resultEntryRevisionId,
      value: Object.freeze({
        ...previous.value,
        contentKeywords: Object.freeze([
          ...previous.value.contentKeywords,
          ...input.keywords.map((keyword) =>
            Object.freeze({
              ...keyword,
              origin: 'rule' as const,
              originVersion: this.action.originVersion,
            }),
          ),
        ]),
      }),
    });
    this.action = action(
      'tags_applied',
      this.action.version + 1,
      input.keywords.length,
      revision,
      input.resultEntryRevisionId,
    );
    return Promise.resolve('applied');
  }

  public completeAction(
    input: Readonly<{
      expectedVersion: number;
      state: 'applied' | 'undone';
      associationProjectionCount?: number;
    }>,
  ): Promise<EntryAutomationActionWriteOutcome> {
    if (input.expectedVersion !== this.action.version)
      return Promise.resolve('stale');
    this.action = Object.freeze({
      ...this.action,
      state: input.state,
      version: this.action.version + 1,
      ...(input.associationProjectionCount === undefined
        ? {}
        : {associationProjectionCount: input.associationProjectionCount}),
    });
    return Promise.resolve('applied');
  }

  public beginUndo(
    input: Readonly<{
      expectedVersion: number;
      resultEntryRevisionId: string;
    }>,
  ): Promise<EntryAutomationActionWriteOutcome> {
    if (input.expectedVersion !== this.action.version)
      return Promise.resolve('stale');
    const previous = this.#entries.current;
    const revision =
      previous.revision + (this.action.addedTagCount === 0 ? 0 : 1);
    this.#entries.current = Object.freeze({
      ...previous,
      revision,
      revisionId: input.resultEntryRevisionId,
      value: Object.freeze({
        ...previous.value,
        contentKeywords: Object.freeze(
          previous.value.contentKeywords.filter(
            (keyword) => keyword.originVersion !== this.action.originVersion,
          ),
        ),
      }),
    });
    this.action = action(
      'undo_pending',
      this.action.version + 1,
      this.action.addedTagCount,
      revision,
      input.resultEntryRevisionId,
    );
    return Promise.resolve('applied');
  }

  private item(): Readonly<EntryAutomationWorkItem> {
    return Object.freeze({
      workspaceId: WORKSPACE_ID,
      runId: RUN_ID,
      claimOrdinal: 0,
      entryId: ENTRY_ID,
      entryRevision: 1,
      entryRevisionId: deriveInformationEntryRevisionId(ENTRY_ID, 1),
      route: 'advance_candidate',
      reason: 'advance_threshold_met',
      state: 'pending',
      version: 1,
      createdAt: '2040-01-01T00:00:00.000Z',
      updatedAt: '2040-01-01T00:00:00.000Z',
      action: this.action,
    });
  }
}

class MemoryAssociations implements InformationEntryAssociationRepositoryPort {
  public rebuilds = 0;

  public replaceAssociationProjections(): Promise<number> {
    this.rebuilds += 1;
    return Promise.resolve(0);
  }

  public loadAssociationSnapshot(): Promise<
    Readonly<{projections: []; overrides: []}>
  > {
    return Promise.resolve(Object.freeze({projections: [], overrides: []}));
  }

  public writeAssociationOverride(): Promise<'unchanged'> {
    return Promise.resolve('unchanged');
  }
}

function memoryPreferences(): ReviewPreferencesStore {
  const value = createReviewPreferences(
    WORKSPACE_ID,
    [],
    {enabled: true, includeLinkDomains: false, excludedKeywords: []},
    {aliases: [{source: 'Alpha Tool', canonical: 'Alpha Utility'}]},
  );
  return {
    load: () => Promise.resolve(value),
    save: () => Promise.resolve(value),
  };
}

function action(
  state: EntryAutomationAction['state'],
  version: number,
  addedTagCount: number,
  resultEntryRevision?: number,
  resultEntryRevisionId?: string,
): EntryAutomationAction {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    runId: RUN_ID,
    claimOrdinal: 0,
    deterministicTagsEnabled: true,
    rebuildAssociationsEnabled: true,
    state,
    originVersion: `struinfo.entry-tags.deterministic.v1:${RUN_ID}:0`,
    ...(resultEntryRevision === undefined ? {} : {resultEntryRevision}),
    ...(resultEntryRevisionId === undefined ? {} : {resultEntryRevisionId}),
    addedTagCount,
    version,
    createdAt: '2040-01-01T00:00:00.000Z',
    updatedAt: '2040-01-01T00:00:00.000Z',
  });
}

function currentEntry(): CurrentInformationEntry {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId: ENTRY_ID,
    resourceId: '44444444-4444-4444-8444-444444444444',
    snapshotId: '55555555-5555-4555-8555-555555555555',
    revision: 1,
    revisionId: deriveInformationEntryRevisionId(ENTRY_ID, 1),
    sourceKey: 'synthetic:m1h',
    capturedAt: '2040-01-01T00:00:00.000Z',
    value: Object.freeze({
      documentOrder: 0,
      titlePath: 'Synthetic utility',
      body: 'Synthetic utility\nUse **Alpha Tool** and `Node.js`.',
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split',
      splitRuleVersion: 'synthetic.v1',
      isPrivate: false,
      contentKeywords: Object.freeze([]),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze(['66666666-6666-4666-8666-666666666666']),
    }),
  });
}
