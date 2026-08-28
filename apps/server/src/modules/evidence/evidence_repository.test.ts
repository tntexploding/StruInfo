import {describe, expect, it, vi} from 'vitest';

import {createSyntheticEvidenceInput} from '../../../test_support/synthetic_evidence_capture.js';
import {
  EvidenceRepositoryError,
  computeEvidenceCaptureRequestSha256,
  executeCaptureEvidence,
  type EvidenceCaptureRepositoryRequest,
  type EvidenceRepositoryPort,
} from './index.js';

class CapturingRepository implements EvidenceRepositoryPort {
  public readonly requests: EvidenceCaptureRepositoryRequest[] = [];

  public constructor(
    private readonly outcome: 'created' | 'existing' | 'conflict' = 'created',
  ) {}

  public saveCapture(
    request: Readonly<EvidenceCaptureRepositoryRequest>,
  ): Promise<Readonly<{status: 'created' | 'existing' | 'conflict'}>> {
    this.requests.push(request);
    return Promise.resolve(Object.freeze({status: this.outcome}));
  }
}

describe('evidence repository application boundary', () => {
  it('validates, hashes, and persists one immutable capture', async () => {
    const repository = new CapturingRepository();
    const capture = createSyntheticEvidenceInput();

    await expect(executeCaptureEvidence(repository, capture)).resolves.toEqual({
      status: 'created',
      workspaceId: capture.workspaceId,
      commandIdempotencyKey: capture.commandIdempotencyKey,
    });
    expect(repository.requests).toHaveLength(1);
    expect(repository.requests[0]?.requestSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(repository.requests[0]?.capture.structure).not.toHaveProperty(
      'normalizedTextUtf8',
    );
  });

  it('uses a stable payload digest independent of command key and array order', () => {
    const capture = createSyntheticEvidenceInput();
    const reordered = {
      ...capture,
      commandIdempotencyKey: 'another-synthetic-command',
      blobs: [...capture.blobs].reverse(),
      gitObservations: [...capture.gitObservations].reverse(),
      structure: {
        ...capture.structure,
        nodes: [...capture.structure.nodes].reverse(),
        fragments: [...capture.structure.fragments].reverse(),
      },
    };

    expect(computeEvidenceCaptureRequestSha256(reordered)).toBe(
      computeEvidenceCaptureRequestSha256(capture),
    );
  });

  it('does not call persistence when validation fails', async () => {
    const repository = new CapturingRepository();

    await expect(executeCaptureEvidence(repository, {})).resolves.toMatchObject(
      {status: 'validation_failed'},
    );
    expect(repository.requests).toHaveLength(0);
  });

  it('maps durable conflicts and repository availability failures', async () => {
    const capture = createSyntheticEvidenceInput();
    await expect(
      executeCaptureEvidence(new CapturingRepository('conflict'), capture),
    ).resolves.toMatchObject({
      status: 'conflict',
      code: 'immutable_content_conflict',
    });

    const unavailable: EvidenceRepositoryPort = {
      saveCapture: vi.fn(() =>
        Promise.reject(new EvidenceRepositoryError('unavailable')),
      ),
    };
    await expect(executeCaptureEvidence(unavailable, capture)).resolves.toEqual(
      {status: 'persistence_failed', code: 'unavailable'},
    );
  });
});
