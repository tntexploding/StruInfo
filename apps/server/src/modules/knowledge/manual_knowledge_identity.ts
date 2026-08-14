import {createHash} from 'node:crypto';

import {encodeCanonicalJson} from '../../serialization/canonical_json.js';
import {
  deriveUuidV5,
  UUID_PATTERN,
} from '../evidence/markdown/markdown_identity.js';
import {
  type ApplyManualKnowledgeChangeSetRequest,
  type ManualKnowledgeContext,
  MANUAL_KNOWLEDGE_COMMAND_SCHEMA_VERSION,
} from './manual_knowledge_contract.js';

export {UUID_PATTERN};

export const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

const MAXIMUM_COMMAND_PROJECTION_BYTES = 8 * 1_024 * 1_024;

export function deriveKnowledgeChangeSetId(
  workspaceId: string,
  commandIdempotencyKey: string,
): string {
  assertCanonicalUuid(workspaceId);
  return deriveUuidV5(
    workspaceId,
    `struinfo:knowledge-change-set:v1:${commandIdempotencyKey}`,
  );
}

export function deriveKnowledgeItemRevisionId(
  itemId: string,
  revisionNumber: number,
): string {
  assertCanonicalUuid(itemId);
  assertPositiveRevision(revisionNumber);
  return deriveUuidV5(
    itemId,
    `struinfo:knowledge-revision:v1:${String(revisionNumber)}`,
  );
}

export function deriveKnowledgeRelationRevisionId(
  relationId: string,
  revisionNumber: number,
): string {
  assertCanonicalUuid(relationId);
  assertPositiveRevision(revisionNumber);
  return deriveUuidV5(
    relationId,
    `struinfo:knowledge-relation-revision:v1:${String(revisionNumber)}`,
  );
}

export function deriveKnowledgeCommittedEventId(changeSetId: string): string {
  assertCanonicalUuid(changeSetId);
  return deriveUuidV5(
    changeSetId,
    'struinfo:knowledge-change-committed-event:v1',
  );
}

export function createManualKnowledgeCommandProjection(
  context: ManualKnowledgeContext,
  request: ApplyManualKnowledgeChangeSetRequest,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: MANUAL_KNOWLEDGE_COMMAND_SCHEMA_VERSION,
    authority: context.authority,
    operationOrigin: 'manual_user',
    commandKind: 'apply_manual_knowledge_change_set',
    workspaceId: context.effectiveWorkspaceId,
    request,
  });
}

export function encodeManualKnowledgeCommandProjection(
  context: ManualKnowledgeContext,
  request: ApplyManualKnowledgeChangeSetRequest,
): Uint8Array {
  return encodeCanonicalJson(
    createManualKnowledgeCommandProjection(context, request),
    MAXIMUM_COMMAND_PROJECTION_BYTES,
  );
}

export function digestManualKnowledgeCommandProjection(
  context: ManualKnowledgeContext,
  request: ApplyManualKnowledgeChangeSetRequest,
): string {
  return createHash('sha256')
    .update(encodeManualKnowledgeCommandProjection(context, request))
    .digest('hex');
}

function assertCanonicalUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error('Manual knowledge UUID input is not canonical.');
  }
}

function assertPositiveRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error('Manual knowledge revision input is invalid.');
  }
}
