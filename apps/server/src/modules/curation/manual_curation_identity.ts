import {createHash} from 'node:crypto';

import {encodeCanonicalJson} from '../../serialization/canonical_json.js';
import {
  deriveUuidV5,
  UUID_PATTERN,
} from '../evidence/markdown/markdown_identity.js';
import {
  type ApplyManualCurationRequest,
  type AssessmentDimension,
  type ManualCurationContext,
  MANUAL_CURATION_COMMAND_SCHEMA_VERSION,
  type PutContentClassificationTermRequest,
} from './manual_curation_contract.js';

export {UUID_PATTERN};

export const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

const MAXIMUM_COMMAND_PROJECTION_BYTES = 1_048_576;

export function deriveCurationTargetId(
  workspaceId: string,
  target:
    | Readonly<{kind: 'snapshot'; snapshotId: string}>
    | Readonly<{kind: 'fragment'; fragmentId: string}>,
): string {
  assertCanonicalUuid(workspaceId);
  assertCanonicalUuid(
    target.kind === 'snapshot' ? target.snapshotId : target.fragmentId,
  );
  const name =
    target.kind === 'snapshot'
      ? `struinfo:curation-target:v1:snapshot:${target.snapshotId}`
      : `struinfo:curation-target:v1:fragment:${target.fragmentId}`;
  return deriveUuidV5(workspaceId, name);
}

export function deriveVocabularyTermRevisionId(
  termId: string,
  revisionNumber: number,
): string {
  assertCanonicalUuid(termId);
  assertPositiveRevision(revisionNumber);
  return deriveUuidV5(
    termId,
    `struinfo:vocabulary-term-revision:v1:${String(revisionNumber)}`,
  );
}

export function deriveClassificationAssignmentId(
  targetId: string,
  termId: string,
): string {
  assertCanonicalUuid(targetId);
  assertCanonicalUuid(termId);
  return deriveUuidV5(
    targetId,
    `struinfo:classification-assignment:v1:${termId}`,
  );
}

export function deriveClassificationAssignmentRevisionId(
  assignmentId: string,
  revisionNumber: number,
): string {
  assertCanonicalUuid(assignmentId);
  assertPositiveRevision(revisionNumber);
  return deriveUuidV5(
    assignmentId,
    `struinfo:classification-assignment-revision:v1:${String(revisionNumber)}`,
  );
}

export function deriveIntakeDecisionId(targetId: string): string {
  assertCanonicalUuid(targetId);
  return deriveUuidV5(targetId, 'struinfo:intake-decision:v1');
}

export function deriveIntakeDecisionRevisionId(
  decisionId: string,
  revisionNumber: number,
): string {
  assertCanonicalUuid(decisionId);
  assertPositiveRevision(revisionNumber);
  return deriveUuidV5(
    decisionId,
    `struinfo:intake-decision-revision:v1:${String(revisionNumber)}`,
  );
}

export function deriveAssessmentId(
  targetId: string,
  dimension: AssessmentDimension,
): string {
  assertCanonicalUuid(targetId);
  return deriveUuidV5(targetId, `struinfo:assessment:v1:${dimension}`);
}

export function deriveAssessmentRevisionId(
  assessmentId: string,
  revisionNumber: number,
): string {
  assertCanonicalUuid(assessmentId);
  assertPositiveRevision(revisionNumber);
  return deriveUuidV5(
    assessmentId,
    `struinfo:assessment-revision:v1:${String(revisionNumber)}`,
  );
}

export function createTermCommandProjection(
  context: ManualCurationContext,
  request: PutContentClassificationTermRequest,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: MANUAL_CURATION_COMMAND_SCHEMA_VERSION,
    authority: context.authority,
    commandKind: 'put_content_classification_term',
    workspaceId: context.effectiveWorkspaceId,
    request,
  });
}

export function createTargetCommandProjection(
  context: ManualCurationContext,
  request: ApplyManualCurationRequest,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: MANUAL_CURATION_COMMAND_SCHEMA_VERSION,
    authority: context.authority,
    commandKind: 'apply_manual_curation',
    workspaceId: context.effectiveWorkspaceId,
    request,
  });
}

export function digestCommandProjection(
  projection: Readonly<Record<string, unknown>>,
): string {
  return createHash('sha256')
    .update(encodeCanonicalJson(projection, MAXIMUM_COMMAND_PROJECTION_BYTES))
    .digest('hex');
}

export function encodeCommandProjection(
  projection: Readonly<Record<string, unknown>>,
): Uint8Array {
  return encodeCanonicalJson(projection, MAXIMUM_COMMAND_PROJECTION_BYTES);
}

function assertCanonicalUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error('Manual curation UUID input is not canonical.');
  }
}

function assertPositiveRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error('Manual curation revision input is invalid.');
  }
}
