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
