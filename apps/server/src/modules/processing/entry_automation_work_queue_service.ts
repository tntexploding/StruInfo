import type {InformationEntryRepositoryPort} from '../entries/index.js';
import {
  ENTRY_AUTOMATION_WORK_ITEM_STATES,
  type EntryAutomationWorkQueueItem,
  type EntryAutomationWorkQueueRepositoryPort,
  type EntryAutomationWorkItemState,
  type ListEntryAutomationWorkQueueResult,
  type UpdateEntryAutomationWorkItemResult,
} from './entry_automation_work_queue_contract.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAXIMUM_QUEUE_ITEMS = 100;

export interface EntryAutomationWorkQueueDependencies {
  readonly repository: EntryAutomationWorkQueueRepositoryPort;
  readonly entries: InformationEntryRepositoryPort;
}

export async function listEntryAutomationWorkQueue(
  dependencies: Readonly<EntryAutomationWorkQueueDependencies>,
  workspaceId: string,
  includePrivate: boolean,
): Promise<Readonly<ListEntryAutomationWorkQueueResult>> {
  if (
    !CANONICAL_UUID.test(workspaceId) ||
    typeof includePrivate !== 'boolean'
  ) {
    return Object.freeze({status: 'invalid_request'});
  }
  const [workItems, entries] = await Promise.all([
    dependencies.repository.listWorkItems(workspaceId, MAXIMUM_QUEUE_ITEMS),
    dependencies.entries.loadCurrentEntries(workspaceId, true),
  ]);
  const currentById = new Map(entries.map((entry) => [entry.entryId, entry]));
  const items: EntryAutomationWorkQueueItem[] = [];
  for (const workItem of workItems) {
    const entry = currentById.get(workItem.entryId);
    if (entry === undefined || (!includePrivate && entry.value.isPrivate)) {
      continue;
    }
    items.push(
      Object.freeze({
        ...workItem,
        stale: isWorkItemStale(workItem, entry.revision, entry.revisionId),
        entry,
      }),
    );
  }
  return Object.freeze({
    status: 'complete',
    includePrivate,
    items: Object.freeze(items),
  });
}

export async function updateEntryAutomationWorkItem(
  dependencies: Readonly<EntryAutomationWorkQueueDependencies>,
  request: Readonly<{
    workspaceId: string;
    runId: string;
    claimOrdinal: number;
    expectedVersion: number;
    state: EntryAutomationWorkItemState;
    includePrivate: boolean;
  }>,
): Promise<Readonly<UpdateEntryAutomationWorkItemResult>> {
  if (
    !CANONICAL_UUID.test(request.workspaceId) ||
    !CANONICAL_UUID.test(request.runId) ||
    !Number.isSafeInteger(request.claimOrdinal) ||
    request.claimOrdinal < 0 ||
    !Number.isSafeInteger(request.expectedVersion) ||
    request.expectedVersion < 1 ||
    !ENTRY_AUTOMATION_WORK_ITEM_STATES.includes(request.state) ||
    typeof request.includePrivate !== 'boolean'
  ) {
    return Object.freeze({status: 'invalid_request'});
  }
  const existing = await dependencies.repository.loadWorkItem(
    request.workspaceId,
    request.runId,
    request.claimOrdinal,
  );
  if (existing === undefined) return Object.freeze({status: 'not_found'});
  const entries = await dependencies.entries.loadCurrentEntries(
    request.workspaceId,
    true,
  );
  const entry = entries.find(
    (candidate) => candidate.entryId === existing.entryId,
  );
  if (
    entry === undefined ||
    (!request.includePrivate && entry.value.isPrivate)
  ) {
    return Object.freeze({status: 'not_found'});
  }
  const outcome = await dependencies.repository.updateWorkItem(
    request.workspaceId,
    request.runId,
    request.claimOrdinal,
    request.expectedVersion,
    request.state,
  );
  if (outcome === 'not_found') return Object.freeze({status: 'not_found'});
  if (outcome === 'stale') return Object.freeze({status: 'stale'});
  if (outcome !== 'applied' && outcome !== 'unchanged') {
    return Object.freeze({status: 'stale'});
  }
  const current = await dependencies.repository.loadWorkItem(
    request.workspaceId,
    request.runId,
    request.claimOrdinal,
  );
  if (current === undefined) return Object.freeze({status: 'not_found'});
  return Object.freeze({
    status: outcome,
    item: Object.freeze({
      ...current,
      stale: isWorkItemStale(current, entry.revision, entry.revisionId),
      entry,
    }),
  });
}

function isWorkItemStale(
  item: Readonly<{
    entryRevision: number;
    entryRevisionId: string;
    action?: Readonly<{
      resultEntryRevision?: number;
      resultEntryRevisionId?: string;
    }>;
  }>,
  currentRevision: number,
  currentRevisionId: string,
): boolean {
  return (
    currentRevision !==
      (item.action?.resultEntryRevision ?? item.entryRevision) ||
    currentRevisionId !==
      (item.action?.resultEntryRevisionId ?? item.entryRevisionId)
  );
}
