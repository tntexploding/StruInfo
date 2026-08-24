import {
  PROCESSING_PRIVACY_SCOPES,
  PROCESSING_PROPOSAL_KINDS,
  PROCESSING_RUN_ORIGINS,
  PROCESSING_RUN_STATUSES,
  PROCESSING_STAGES,
  type ProcessingAssociationProposalPayload,
  type ProcessingSplitProposalPayload,
  type ProcessingProposalAppend,
  type ProcessingTagProposalPayload,
  type ProcessingRunCreate,
  type ProcessingRunProgressWrite,
  type ProcessingRunStatus,
} from './processing_contract.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function assertProcessingRunCreate(
  value: Readonly<ProcessingRunCreate>,
): void {
  uuid(value.workspaceId);
  uuid(value.runId);
  boundedText(value.idempotencyKey, 200);
  member(value.origin, PROCESSING_RUN_ORIGINS);
  member(value.privacyScope, PROCESSING_PRIVACY_SCOPES);
  member(value.initialStage, PROCESSING_STAGES);
  optionalText(value.initialStep, 240);
  optionalUuid(value.targetSnapshotId);
  if (
    (value.origin === 'ai') !== (value.providerKey !== undefined) ||
    (value.providerKey !== undefined && !isBoundedText(value.providerKey, 120))
  ) {
    fail();
  }
}

export function assertProcessingRunProgress(
  value: Readonly<ProcessingRunProgressWrite>,
): void {
  uuid(value.workspaceId);
  uuid(value.runId);
  positiveInteger(value.expectedVersion);
  member(value.status, PROCESSING_RUN_STATUSES);
  member(value.currentStage, PROCESSING_STAGES);
  optionalText(value.currentStep, 240);
  nonNegativeInteger(value.completedUnits);
  if (value.totalUnits !== undefined) {
    positiveInteger(value.totalUnits);
    if (value.completedUnits > value.totalUnits) fail();
  }
  if (
    (value.status === 'failed') !== (value.errorCode !== undefined) ||
    (value.errorCode !== undefined && !isBoundedText(value.errorCode, 120))
  ) {
    fail();
  }
}

export function assertProcessingProposalAppend(
  value: Readonly<ProcessingProposalAppend>,
): void {
  uuid(value.workspaceId);
  uuid(value.proposalId);
  uuid(value.runId);
  nonNegativeInteger(value.ordinal);
  member(value.stage, PROCESSING_STAGES);
  member(value.kind, PROCESSING_PROPOSAL_KINDS);
  boundedText(value.summary, 240);
  const fragmentIds = value.fragmentIds.map(uuid);
  if (
    fragmentIds.some((item, index) => item !== value.fragmentIds[index]) ||
    new Set(fragmentIds).size !== fragmentIds.length
  ) {
    fail();
  }
  if (value.kind === 'split') {
    if (
      value.stage !== 'split' ||
      value.targetSnapshotId === undefined ||
      value.targetEntryId !== undefined ||
      value.relatedEntryId !== undefined
    ) {
      fail();
    }
    if (value.tagPayload !== undefined) fail();
    if (value.associationPayload !== undefined) fail();
    uuid(value.targetSnapshotId);
    if (value.splitPayload !== undefined) {
      assertProcessingSplitProposalPayload(value.splitPayload);
      const payloadIds = value.splitPayload.entries.flatMap(
        (entry) => entry.fragmentIds,
      );
      if (
        payloadIds.length !== value.fragmentIds.length ||
        payloadIds.some(
          (fragmentId, index) => fragmentId !== value.fragmentIds[index],
        )
      )
        fail();
    }
    return;
  }
  if (value.kind === 'tags') {
    if (
      value.stage !== 'tags' ||
      value.targetSnapshotId !== undefined ||
      value.targetEntryId === undefined ||
      value.relatedEntryId !== undefined
    ) {
      fail();
    }
    uuid(value.targetEntryId);
    if (value.tagPayload !== undefined) {
      assertProcessingTagProposalPayload(value.tagPayload);
    }
    if (value.associationPayload !== undefined) fail();
    if (value.splitPayload !== undefined) fail();
    return;
  }
  if (
    value.stage !== 'associations' ||
    value.targetSnapshotId !== undefined ||
    value.targetEntryId === undefined ||
    value.relatedEntryId === undefined ||
    value.targetEntryId === value.relatedEntryId
  ) {
    fail();
  }
  if (value.tagPayload !== undefined) fail();
  if (value.splitPayload !== undefined) fail();
  uuid(value.targetEntryId);
  uuid(value.relatedEntryId);
  if (value.associationPayload !== undefined) {
    assertProcessingAssociationProposalPayload(value.associationPayload);
  }
}

export function assertProcessingSplitProposalPayload(
  value: Readonly<ProcessingSplitProposalPayload>,
): void {
  boundedText(value.providerModel, 120);
  boundedText(value.promptVersion, 120);
  const splitRuleVersion: unknown = value.splitRuleVersion;
  if (splitRuleVersion !== 'struinfo.entry-split.ai-group.v1') fail();
  if (
    !isArrayValue(value.entries) ||
    value.entries.length < 1 ||
    value.entries.length > 64
  )
    fail();
  const fragmentIds = new Set<string>();
  let inputCount = 0;
  for (const entry of value.entries) {
    boundedText(entry.titlePath, 200);
    if (
      !isArrayValue(entry.fragmentIds) ||
      entry.fragmentIds.length < 1 ||
      entry.fragmentIds.length > 64
    )
      fail();
    for (const fragmentId of entry.fragmentIds) {
      uuid(fragmentId);
      if (fragmentIds.has(fragmentId)) fail();
      fragmentIds.add(fragmentId);
      inputCount += 1;
    }
  }
  if (inputCount > 64) fail();
}
export function assertProcessingAssociationProposalPayload(
  value: Readonly<ProcessingAssociationProposalPayload>,
): void {
  positiveInteger(value.expectedEntryLowRevision);
  positiveInteger(value.expectedEntryHighRevision);
  nonNegativeInteger(value.expectedOverrideRevision);
  boundedText(value.providerModel, 120);
  boundedText(value.promptVersion, 120);
  boundedText(value.relationLabel, 80);
  member(value.direction, ['symmetric', 'low_to_high', 'high_to_low'] as const);
}

export function assertProcessingTagProposalPayload(
  value: Readonly<ProcessingTagProposalPayload>,
): void {
  positiveInteger(value.expectedEntryRevision);
  boundedText(value.providerModel, 120);
  boundedText(value.promptVersion, 120);
  member(value.typeKeyword, [
    'factual_material',
    'knowledge_explanation',
    'operating_guideline',
    'investigation_analysis',
    'argument',
    'personal_experience',
    'interactive_collaboration',
    'public_communication',
    'literary_creation',
    'other',
  ] as const);
  assertFixedOrOther(value.typeKeyword, value.typeCustomName);
  if (
    !isArrayValue(value.contentKeywords) ||
    value.contentKeywords.length < 1 ||
    value.contentKeywords.length > 12
  )
    fail();
  const keywordIdentities = new Set<string>();
  for (const keyword of value.contentKeywords) {
    boundedText(keyword.displayValue, 80);
    boundedText(keyword.normalizedValue, 80);
    if (keywordIdentities.has(keyword.normalizedValue)) fail();
    keywordIdentities.add(keyword.normalizedValue);
  }
  if (
    !isArrayValue(value.domains) ||
    value.domains.length < 1 ||
    value.domains.length > 3
  )
    fail();
  const domainIdentities = new Set<string>();
  for (const domain of value.domains) {
    member(domain.keyword, [
      'mathematics_formal',
      'nature_environment',
      'engineering_computing',
      'life_health',
      'society_public_affairs',
      'economy_business',
      'law_policy_governance',
      'humanities_history',
      'language_education',
      'culture_arts',
      'daily_life',
      'other',
    ] as const);
    assertFixedOrOther(domain.keyword, domain.customName);
    const identity = `${domain.keyword}:${domain.customName ?? ''}`;
    if (domainIdentities.has(identity)) fail();
    domainIdentities.add(identity);
  }
}

function isArrayValue(value: unknown): boolean {
  return Array.isArray(value);
}

export function canTransitionProcessingRun(
  current: ProcessingRunStatus,
  next: ProcessingRunStatus,
): boolean {
  if (current === 'queued') {
    return next === 'running' || next === 'cancelled';
  }
  if (current === 'running') {
    return (
      next === 'running' ||
      next === 'succeeded' ||
      next === 'failed' ||
      next === 'cancelled'
    );
  }
  return false;
}

function member<T extends string>(
  value: string,
  values: readonly T[],
): asserts value is T {
  if (!values.includes(value as T)) fail();
}

function assertFixedOrOther(
  keyword: string,
  customName: string | undefined,
): void {
  if (keyword === 'other') {
    if (customName === undefined) fail();
    boundedText(customName, 80);
    return;
  }
  if (customName !== undefined) fail();
}

function optionalUuid(value: string | undefined): void {
  if (value !== undefined) uuid(value);
}

function uuid(value: string): string {
  if (!CANONICAL_UUID.test(value)) fail();
  return value;
}

function optionalText(value: string | undefined, maximum: number): void {
  if (value !== undefined) boundedText(value, maximum);
}

function boundedText(value: string, maximum: number): void {
  if (!isBoundedText(value, maximum)) fail();
}

function isBoundedText(value: string, maximum: number): boolean {
  return (
    typeof value === 'string' &&
    value === value.trim().normalize('NFC') &&
    value.length > 0 &&
    Array.from(value).length <= maximum &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
      );
    })
  );
}

function positiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) fail();
}

function nonNegativeInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) fail();
}

function fail(): never {
  throw new Error('The processing run or proposal input is invalid.');
}
