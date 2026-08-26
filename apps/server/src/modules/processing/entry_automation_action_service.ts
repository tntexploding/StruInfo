import {
  buildInformationEntryAssociationProjection,
  deriveInformationEntryRevisionId,
  extractDeterministicEntryTagCandidates,
  INFORMATION_ENTRY_ASSOCIATION_POLICY,
  type InformationEntryAssociationPolicy,
  type InformationEntryAssociationRepositoryPort,
  type InformationEntryRepositoryPort,
} from '../entries/index.js';
import {
  DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES,
  DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
  DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
  type ReviewPreferencesStore,
} from '../../storage/review_preferences_store.js';
import type {
  EntryAutomationActionRepositoryPort,
  EntryAutomationWorkQueueItem,
  EntryAutomationWorkQueueRepositoryPort,
  ExecuteEntryAutomationActionResult,
  ExecuteEntryAutomationRunActionsResult,
} from './entry_automation_work_queue_contract.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAXIMUM_CONTENT_KEYWORDS = 32;

export interface EntryAutomationActionDependencies {
  readonly repository: EntryAutomationActionRepositoryPort;
  readonly workQueue: EntryAutomationWorkQueueRepositoryPort;
  readonly entries: InformationEntryRepositoryPort;
  readonly associations: InformationEntryAssociationRepositoryPort;
  readonly preferences: ReviewPreferencesStore;
}

export async function executeEntryAutomationWorkItemAction(
  dependencies: Readonly<EntryAutomationActionDependencies>,
  request: Readonly<{
    workspaceId: string;
    runId: string;
    claimOrdinal: number;
    expectedVersion: number;
    includePrivate: boolean;
    operation: 'apply' | 'undo';
  }>,
): Promise<Readonly<ExecuteEntryAutomationActionResult>> {
  if (!validRequest(request)) return Object.freeze({status: 'invalid_request'});
  try {
    const existing = await loadItem(dependencies, request);
    if (existing === undefined) return Object.freeze({status: 'not_found'});
    if (existing.action === undefined) {
      return Object.freeze({status: 'not_enabled'});
    }
    if (existing.action.version !== request.expectedVersion) {
      return Object.freeze({status: 'stale'});
    }
    if (existing.entry.value.isPrivate && !request.includePrivate) {
      return Object.freeze({status: 'not_found'});
    }
    return request.operation === 'apply'
      ? await applyAction(dependencies, request, existing)
      : await undoAction(dependencies, request, existing);
  } catch {
    return Object.freeze({status: 'failed'});
  }
}

export async function executeEntryAutomationRunActions(
  dependencies: Readonly<EntryAutomationActionDependencies>,
  request: Readonly<{
    workspaceId: string;
    runId: string;
    includePrivate: boolean;
  }>,
): Promise<Readonly<ExecuteEntryAutomationRunActionsResult>> {
  if (
    !CANONICAL_UUID.test(request.workspaceId) ||
    !CANONICAL_UUID.test(request.runId) ||
    typeof request.includePrivate !== 'boolean'
  ) {
    return Object.freeze({status: 'failed'});
  }
  try {
    const workItems = await dependencies.repository.listRunWorkItems(
      request.workspaceId,
      request.runId,
    );
    let appliedCount = 0;
    let unchangedCount = 0;
    for (const workItem of workItems) {
      if (workItem.action === undefined) continue;
      if (workItem.action.state === 'applied') {
        unchangedCount += 1;
        continue;
      }
      if (
        workItem.action.state !== 'pending' &&
        workItem.action.state !== 'tags_applied'
      ) {
        return Object.freeze({status: 'failed'});
      }
      const result = await executeEntryAutomationWorkItemAction(dependencies, {
        workspaceId: request.workspaceId,
        runId: request.runId,
        claimOrdinal: workItem.claimOrdinal,
        expectedVersion: workItem.action.version,
        includePrivate: request.includePrivate,
        operation: 'apply',
      });
      if (result.status === 'applied') appliedCount += 1;
      else if (result.status === 'unchanged') unchangedCount += 1;
      else return Object.freeze({status: 'failed'});
    }
    return Object.freeze({status: 'complete', appliedCount, unchangedCount});
  } catch {
    return Object.freeze({status: 'failed'});
  }
}

async function applyAction(
  dependencies: Readonly<EntryAutomationActionDependencies>,
  request: Readonly<{
    workspaceId: string;
    runId: string;
    claimOrdinal: number;
    expectedVersion: number;
    includePrivate: boolean;
  }>,
  existing: Readonly<EntryAutomationWorkQueueItem>,
): Promise<Readonly<ExecuteEntryAutomationActionResult>> {
  const action = existing.action;
  if (action === undefined) return Object.freeze({status: 'not_enabled'});
  if (action.state === 'applied') {
    return Object.freeze({status: 'unchanged', item: existing});
  }
  if (action.state !== 'pending' && action.state !== 'tags_applied') {
    return Object.freeze({status: 'stale'});
  }
  let changed = false;
  if (action.state === 'pending') {
    const preferences = await dependencies.preferences.load(
      request.workspaceId,
    );
    const candidates = action.deterministicTagsEnabled
      ? extractDeterministicEntryTagCandidates(
          existing.entry.value.body,
          preferences.automaticKeywords ??
            DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
          preferences.vocabulary ?? DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
        )
      : Object.freeze([]);
    const existingIdentities = new Set(
      existing.entry.value.contentKeywords.map(
        (keyword) => keyword.normalizedValue,
      ),
    );
    const capacity = Math.max(
      0,
      MAXIMUM_CONTENT_KEYWORDS - existing.entry.value.contentKeywords.length,
    );
    const keywords = candidates
      .filter((candidate) => !existingIdentities.has(candidate.normalizedValue))
      .slice(0, capacity);
    const resultEntryRevisionId = deriveInformationEntryRevisionId(
      existing.entry.entryId,
      existing.entry.revision + 1,
    );
    const outcome = await dependencies.repository.applyAction({
      ...request,
      resultEntryRevisionId:
        keywords.length === 0
          ? existing.entry.revisionId
          : resultEntryRevisionId,
      keywords,
    });
    if (outcome === 'not_found') return Object.freeze({status: 'not_found'});
    if (outcome === 'not_enabled') {
      return Object.freeze({status: 'not_enabled'});
    }
    if (outcome !== 'applied' && outcome !== 'unchanged') {
      return Object.freeze({status: 'stale'});
    }
    changed = outcome === 'applied';
  }

  const afterTags = await loadItem(dependencies, request);
  if (afterTags?.action === undefined) {
    return Object.freeze({status: 'failed'});
  }
  if (afterTags.action.state === 'applied') {
    return Object.freeze({
      status: changed ? 'applied' : 'unchanged',
      item: afterTags,
    });
  }
  if (afterTags.action.state !== 'tags_applied') {
    return Object.freeze({status: 'stale'});
  }
  const projectedCount = afterTags.action.rebuildAssociationsEnabled
    ? await rebuildAssociations(
        dependencies,
        request.workspaceId,
        request.includePrivate,
      )
    : undefined;
  const completed = await dependencies.repository.completeAction({
    workspaceId: request.workspaceId,
    runId: request.runId,
    claimOrdinal: request.claimOrdinal,
    expectedVersion: afterTags.action.version,
    state: 'applied',
    ...(projectedCount === undefined
      ? {}
      : {associationProjectionCount: projectedCount}),
  });
  if (completed !== 'applied' && completed !== 'unchanged') {
    return Object.freeze({status: 'stale'});
  }
  const item = await loadItem(dependencies, request);
  return item === undefined
    ? Object.freeze({status: 'failed'})
    : Object.freeze({status: 'applied', item});
}

async function undoAction(
  dependencies: Readonly<EntryAutomationActionDependencies>,
  request: Readonly<{
    workspaceId: string;
    runId: string;
    claimOrdinal: number;
    expectedVersion: number;
    includePrivate: boolean;
  }>,
  existing: Readonly<EntryAutomationWorkQueueItem>,
): Promise<Readonly<ExecuteEntryAutomationActionResult>> {
  const action = existing.action;
  if (action === undefined) return Object.freeze({status: 'not_enabled'});
  if (action.state === 'undone') {
    return Object.freeze({status: 'unchanged', item: existing});
  }
  if (action.state !== 'applied' && action.state !== 'undo_pending') {
    return Object.freeze({status: 'stale'});
  }
  if (action.state === 'applied') {
    const resultEntryRevisionId = deriveInformationEntryRevisionId(
      existing.entry.entryId,
      existing.entry.revision + 1,
    );
    const outcome = await dependencies.repository.beginUndo({
      ...request,
      resultEntryRevisionId:
        action.addedTagCount === 0
          ? existing.entry.revisionId
          : resultEntryRevisionId,
    });
    if (outcome === 'not_found') return Object.freeze({status: 'not_found'});
    if (outcome !== 'applied' && outcome !== 'unchanged') {
      return Object.freeze({status: 'stale'});
    }
  }
  const afterUndo = await loadItem(dependencies, request);
  if (afterUndo?.action === undefined) {
    return Object.freeze({status: 'failed'});
  }
  if (afterUndo.action.state === 'undone') {
    return Object.freeze({status: 'unchanged', item: afterUndo});
  }
  if (afterUndo.action.state !== 'undo_pending') {
    return Object.freeze({status: 'stale'});
  }
  const projectedCount = afterUndo.action.rebuildAssociationsEnabled
    ? await rebuildAssociations(
        dependencies,
        request.workspaceId,
        request.includePrivate,
      )
    : undefined;
  const completed = await dependencies.repository.completeAction({
    workspaceId: request.workspaceId,
    runId: request.runId,
    claimOrdinal: request.claimOrdinal,
    expectedVersion: afterUndo.action.version,
    state: 'undone',
    ...(projectedCount === undefined
      ? {}
      : {associationProjectionCount: projectedCount}),
  });
  if (completed !== 'applied' && completed !== 'unchanged') {
    return Object.freeze({status: 'stale'});
  }
  const item = await loadItem(dependencies, request);
  return item === undefined
    ? Object.freeze({status: 'failed'})
    : Object.freeze({status: 'applied', item});
}

async function rebuildAssociations(
  dependencies: Readonly<EntryAutomationActionDependencies>,
  workspaceId: string,
  includePrivate: boolean,
): Promise<number> {
  const [entries, preferences] = await Promise.all([
    dependencies.entries.loadCurrentEntries(workspaceId, includePrivate),
    dependencies.preferences.load(workspaceId),
  ]);
  const value =
    preferences.associationPolicy ??
    DEFAULT_REVIEW_ASSOCIATION_POLICY_PREFERENCES;
  const policy: Readonly<InformationEntryAssociationPolicy> = Object.freeze({
    ...INFORMATION_ENTRY_ASSOCIATION_POLICY,
    revision: value.revision,
    contentWeight: value.contentWeight,
    typeWeight: value.typeWeight,
    domainWeight: value.domainWeight,
    threshold: value.threshold,
  });
  const projections = buildInformationEntryAssociationProjection(
    entries,
    policy,
  );
  return dependencies.associations.replaceAssociationProjections(
    workspaceId,
    projections,
    includePrivate,
  );
}

async function loadItem(
  dependencies: Readonly<EntryAutomationActionDependencies>,
  request: Readonly<{
    workspaceId: string;
    runId: string;
    claimOrdinal: number;
    includePrivate: boolean;
  }>,
): Promise<Readonly<EntryAutomationWorkQueueItem> | undefined> {
  const [workItem, entries] = await Promise.all([
    dependencies.workQueue.loadWorkItem(
      request.workspaceId,
      request.runId,
      request.claimOrdinal,
    ),
    dependencies.entries.loadCurrentEntries(request.workspaceId, true),
  ]);
  if (workItem === undefined) return undefined;
  const entry = entries.find(
    (candidate) => candidate.entryId === workItem.entryId,
  );
  if (
    entry === undefined ||
    (!request.includePrivate && entry.value.isPrivate)
  ) {
    return undefined;
  }
  return Object.freeze({
    ...workItem,
    stale: isEntryAutomationWorkItemStale(workItem, entry),
    entry,
  });
}

function isEntryAutomationWorkItemStale(
  workItem: Readonly<{
    entryRevision: number;
    entryRevisionId: string;
    action?: Readonly<{
      resultEntryRevision?: number;
      resultEntryRevisionId?: string;
    }>;
  }>,
  entry: Readonly<EntryAutomationWorkQueueItem['entry']>,
): boolean {
  const revision =
    workItem.action?.resultEntryRevision ?? workItem.entryRevision;
  const revisionId =
    workItem.action?.resultEntryRevisionId ?? workItem.entryRevisionId;
  return entry.revision !== revision || entry.revisionId !== revisionId;
}

function validRequest(
  request: Readonly<{
    workspaceId: string;
    runId: string;
    claimOrdinal: number;
    expectedVersion: number;
    includePrivate: boolean;
    operation: string;
  }>,
): boolean {
  return (
    CANONICAL_UUID.test(request.workspaceId) &&
    CANONICAL_UUID.test(request.runId) &&
    Number.isSafeInteger(request.claimOrdinal) &&
    request.claimOrdinal >= 0 &&
    Number.isSafeInteger(request.expectedVersion) &&
    request.expectedVersion >= 1 &&
    typeof request.includePrivate === 'boolean' &&
    (request.operation === 'apply' || request.operation === 'undo')
  );
}
