import {createHash} from 'node:crypto';

import {
  MARKDOWN_TEXT_NORMALIZATION_VERSION,
  deriveEvidenceBlobId,
  materializeMarkdownEvidence,
  parseMarkdownStructure,
  validateEvidenceCapture,
  type CaptureEvidenceInput,
  type ValidatedCaptureEvidence,
} from '../src/modules/evidence/index.js';

export const SYNTHETIC_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
export const SYNTHETIC_RESOURCE_ID = '00000000-0000-4000-8000-000000000002';
export const SYNTHETIC_SNAPSHOT_ID = '00000000-0000-4000-8000-000000000003';

export function createSyntheticEvidenceCapture(
  source = '# Synthetic\n\n## 工具\n\n1、Synthetic entry\n\nSynthetic body.\n\n' +
    '![Synthetic diagram](https://example.invalid/diagram.png)\n',
): ValidatedCaptureEvidence {
  const capture = createSyntheticEvidenceInput(source);
  const validated = validateEvidenceCapture(capture);
  if (validated.status !== 'validated') {
    throw new Error('Synthetic evidence capture did not validate.');
  }
  return validated.value;
}

export function createSyntheticEvidenceInput(
  source = '# Synthetic\n\n## 工具\n\n1、Synthetic entry\n\nSynthetic body.\n\n' +
    '![Synthetic diagram](https://example.invalid/diagram.png)\n',
): CaptureEvidenceInput {
  const sourceUtf8 = new TextEncoder().encode(source);
  const rawDigest = createHash('sha256').update(sourceUtf8).digest('hex');
  const rawBlob = {
    workspaceId: SYNTHETIC_WORKSPACE_ID,
    blobId: deriveEvidenceBlobId(SYNTHETIC_WORKSPACE_ID, rawDigest),
    digestAlgorithm: 'sha256' as const,
    digest: rawDigest,
    byteLength: sourceUtf8.byteLength,
  };
  const parsed = parseMarkdownStructure({
    workspaceId: SYNTHETIC_WORKSPACE_ID,
    resourceId: SYNTHETIC_RESOURCE_ID,
    snapshotId: SYNTHETIC_SNAPSHOT_ID,
    rawBlob,
    profile: 'ruanyf-weekly-v1',
    sourceUtf8,
  });
  if (parsed.status !== 'parsed') {
    throw new Error('Synthetic Markdown did not parse.');
  }
  const snapshot = {
    workspaceId: SYNTHETIC_WORKSPACE_ID,
    snapshotId: SYNTHETIC_SNAPSHOT_ID,
    resourceId: SYNTHETIC_RESOURCE_ID,
    rawSha256: rawDigest,
    rawBlob,
    canonicalContentSha256: parsed.value.normalizedTextSha256,
    canonicalizationVersion: MARKDOWN_TEXT_NORMALIZATION_VERSION,
    mediaType: 'text/markdown',
    capturedAt: '2040-01-02T03:04:05Z',
  };
  const materialized = materializeMarkdownEvidence({
    parsed: parsed.value,
    snapshot,
    mediaPolicy: 'external_reference_only',
    sourceUtf8,
  });
  if (materialized.status !== 'materialized') {
    throw new Error('Synthetic Markdown did not materialize.');
  }
  const blobs = new Map([
    [rawBlob.blobId, {...rawBlob, mediaType: 'text/markdown'}],
    [materialized.value.textBlob.blobId, materialized.value.textBlob],
  ]);
  return {
    workspaceId: SYNTHETIC_WORKSPACE_ID,
    commandIdempotencyKey: 'synthetic-evidence-command',
    blobs: [...blobs.values()],
    resource: {
      workspaceId: SYNTHETIC_WORKSPACE_ID,
      resourceId: SYNTHETIC_RESOURCE_ID,
      resourceKind: 'git_file',
      sourceKey: 'git:synthetic/weekly/issue.md',
      canonicalUri: 'https://example.invalid/synthetic/issue.md',
    },
    gitResource: {
      workspaceId: SYNTHETIC_WORKSPACE_ID,
      resourceId: SYNTHETIC_RESOURCE_ID,
      canonicalRepositoryUri: 'https://example.invalid/synthetic/repository',
      repositoryRelativePath: 'docs/issue.md',
    },
    snapshot,
    gitObservations: [
      {
        workspaceId: SYNTHETIC_WORKSPACE_ID,
        observationId: '00000000-0000-4000-8000-000000000004',
        resourceId: SYNTHETIC_RESOURCE_ID,
        snapshotId: SYNTHETIC_SNAPSHOT_ID,
        repositoryRef: 'refs/heads/main',
        commit: {algorithm: 'sha1', digest: 'a'.repeat(40)},
        blobObject: {algorithm: 'sha1', digest: 'b'.repeat(40)},
        observedAt: '2040-01-02T03:04:05Z',
      },
    ],
    structure: materialized.value.structure,
    mediaAssets: materialized.value.mediaAssets,
    mediaUsages: materialized.value.mediaUsages,
  };
}
