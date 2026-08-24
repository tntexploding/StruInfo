import {deriveUuidV5} from '../entries/index.js';

export function deriveProcessingRunId(
  workspaceId: string,
  idempotencyKey: string,
): string {
  return deriveUuidV5(
    workspaceId,
    `struinfo:processing-run:v1:${idempotencyKey}`,
  );
}

export function deriveProcessingProposalId(
  runId: string,
  ordinal: number,
): string {
  return deriveUuidV5(
    runId,
    `struinfo:processing-proposal:v1:${ordinal.toString()}`,
  );
}
