import type {
  CurrentInformationEntry,
  InformationEntryAutomationReason,
  InformationEntryAutomationRoute,
} from '../entries/index.js';
import type {ProcessingRunWriteOutcome} from './processing_contract.js';

export const ENTRY_AUTOMATION_WORK_ITEM_STATES = [
  'pending',
  'completed',
  'dismissed',
] as const;

export type EntryAutomationWorkItemState =
  (typeof ENTRY_AUTOMATION_WORK_ITEM_STATES)[number];

export const ENTRY_AUTOMATION_ACTION_STATES = [
  'pending',
  'tags_applied',
  'applied',
  'undo_pending',
  'undone',
  'cancelled',
] as const;

export type EntryAutomationActionState =
  (typeof ENTRY_AUTOMATION_ACTION_STATES)[number];

export interface EntryAutomationAction {
  readonly workspaceId: string;
  readonly runId: string;
  readonly claimOrdinal: number;
  readonly deterministicTagsEnabled: boolean;
  readonly rebuildAssociationsEnabled: boolean;
  readonly state: EntryAutomationActionState;
  readonly originVersion: string;
  readonly resultEntryRevision?: number;
  readonly resultEntryRevisionId?: string;
  readonly addedTagCount: number;
  readonly associationProjectionCount?: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

export interface EntryAutomationWorkItem {
  readonly workspaceId: string;
  readonly runId: string;
  readonly claimOrdinal: number;
  readonly entryId: string;
  readonly entryRevision: number;
  readonly entryRevisionId: string;
  readonly route: InformationEntryAutomationRoute;
  readonly reason: InformationEntryAutomationReason;
  readonly state: EntryAutomationWorkItemState;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resolvedAt?: string;
  readonly action?: Readonly<EntryAutomationAction>;
}

export interface EntryAutomationWorkQueueItem extends EntryAutomationWorkItem {
  readonly stale: boolean;
  readonly entry: Readonly<CurrentInformationEntry>;
}

export interface EntryAutomationWorkQueueRepositoryPort {
  listWorkItems(
    workspaceId: string,
    maximum: number,
  ): Promise<readonly Readonly<EntryAutomationWorkItem>[]>;

  loadWorkItem(
    workspaceId: string,
    runId: string,
    claimOrdinal: number,
  ): Promise<Readonly<EntryAutomationWorkItem> | undefined>;

  updateWorkItem(
    workspaceId: string,
    runId: string,
    claimOrdinal: number,
    expectedVersion: number,
    state: EntryAutomationWorkItemState,
  ): Promise<ProcessingRunWriteOutcome>;
}

export interface EntryAutomationActionKeyword {
  readonly displayValue: string;
  readonly normalizedValue: string;
}

export type EntryAutomationActionWriteOutcome =
  ProcessingRunWriteOutcome | 'not_enabled' | 'invalid_state';

export interface EntryAutomationActionRepositoryPort {
  listRunWorkItems(
    workspaceId: string,
    runId: string,
  ): Promise<readonly Readonly<EntryAutomationWorkItem>[]>;

  applyAction(
    input: Readonly<{
      workspaceId: string;
      runId: string;
      claimOrdinal: number;
      expectedVersion: number;
      includePrivate: boolean;
      resultEntryRevisionId: string;
      keywords: readonly Readonly<EntryAutomationActionKeyword>[];
    }>,
  ): Promise<EntryAutomationActionWriteOutcome>;

  completeAction(
    input: Readonly<{
      workspaceId: string;
      runId: string;
      claimOrdinal: number;
      expectedVersion: number;
      state: 'applied' | 'undone';
      associationProjectionCount?: number;
    }>,
  ): Promise<EntryAutomationActionWriteOutcome>;

  beginUndo(
    input: Readonly<{
      workspaceId: string;
      runId: string;
      claimOrdinal: number;
      expectedVersion: number;
      includePrivate: boolean;
      resultEntryRevisionId: string;
    }>,
  ): Promise<EntryAutomationActionWriteOutcome>;
}

export type ListEntryAutomationWorkQueueResult =
  | Readonly<{status: 'invalid_request'}>
  | Readonly<{
      status: 'complete';
      includePrivate: boolean;
      items: readonly Readonly<EntryAutomationWorkQueueItem>[];
    }>;

export type UpdateEntryAutomationWorkItemResult =
  | Readonly<{status: 'invalid_request'}>
  | Readonly<{status: 'not_found' | 'stale'}>
  | Readonly<{
      status: 'applied' | 'unchanged';
      item: Readonly<EntryAutomationWorkQueueItem>;
    }>;

export type ExecuteEntryAutomationActionResult =
  | Readonly<{
      status: 'invalid_request' | 'not_found' | 'stale' | 'not_enabled';
    }>
  | Readonly<{
      status: 'applied' | 'unchanged';
      item: Readonly<EntryAutomationWorkQueueItem>;
    }>
  | Readonly<{status: 'failed'}>;

export type ExecuteEntryAutomationRunActionsResult =
  | Readonly<{
      status: 'complete';
      appliedCount: number;
      unchangedCount: number;
    }>
  | Readonly<{status: 'failed'}>;
