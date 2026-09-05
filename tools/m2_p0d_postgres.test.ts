import {createHash} from 'node:crypto';

import {describe, expect, it} from 'vitest';

import {extractDeterministicEntryTagCandidates} from '../apps/server/src/modules/entries/index.js';
import {
  deriveEvidenceBlobId,
  parseMarkdownStructure,
} from '../apps/server/src/modules/evidence/index.js';
import {
  DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
  DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
} from '../apps/server/src/storage/review_preferences_store.js';
import {
  createM2P0dSyntheticMarkdown,
  M2_P0D_SMOKE_WORKLOAD,
  M2_P0D_STANDARD_WORKLOAD,
  parseM2P0dArguments,
} from './m2_p0d_postgres.js';

describe('M2-P0D disposable PostgreSQL workload', () => {
  it('freezes full and smoke workloads without accepting arbitrary options', () => {
    expect(parseM2P0dArguments([])).toBe(M2_P0D_STANDARD_WORKLOAD);
    expect(parseM2P0dArguments(['--full'])).toBe(M2_P0D_STANDARD_WORKLOAD);
    expect(parseM2P0dArguments(['--smoke'])).toBe(M2_P0D_SMOKE_WORKLOAD);
    expect(parseM2P0dArguments(['--', '--smoke'])).toBe(M2_P0D_SMOKE_WORKLOAD);
    expect(
      M2_P0D_STANDARD_WORKLOAD.snapshotCount *
        M2_P0D_STANDARD_WORKLOAD.entriesPerSnapshot,
    ).toBe(15_000);
    expect(() => parseM2P0dArguments(['--snapshots', '1'])).toThrow();
  });

  it('creates exactly the requested weekly intake targets', () => {
    const markdown = createM2P0dSyntheticMarkdown(1, {
      entriesPerSnapshot: 8,
      noTagEvery: 4,
    });
    const bytes = new TextEncoder().encode(markdown);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const parsed = parseMarkdownStructure({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      resourceId: '22222222-2222-4222-8222-000000000001',
      snapshotId: '33333333-3333-4333-8333-000000000001',
      rawBlob: {
        workspaceId: '11111111-1111-4111-8111-111111111111',
        blobId: deriveEvidenceBlobId(
          '11111111-1111-4111-8111-111111111111',
          digest,
        ),
        digestAlgorithm: 'sha256',
        digest,
        byteLength: bytes.byteLength,
      },
      profile: 'ruanyf-weekly-v1',
      sourceUtf8: bytes,
    });

    expect(parsed.status).toBe('parsed');
    if (parsed.status !== 'parsed') return;
    expect(parsed.value.intakeTargetNodeKeys).toHaveLength(8);
  });

  it('keeps deterministic-tag and exception fixtures distinct', () => {
    const markdown = createM2P0dSyntheticMarkdown(1, {
      entriesPerSnapshot: 4,
      noTagEvery: 4,
    });
    const tagged = /本条只用于基准[^\n]+/u.exec(markdown)?.[0];
    const untagged = /这是一段完全合成[^\n]+/u.exec(markdown)?.[0];
    expect(tagged).toBeDefined();
    expect(untagged).toBeDefined();
    expect(
      extractDeterministicEntryTagCandidates(
        `合成条目\n${tagged ?? ''}`,
        DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
        DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
        10,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      extractDeterministicEntryTagCandidates(
        `内容\n${untagged ?? ''}`,
        DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
        DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
        10,
      ),
    ).toEqual([]);
    expect(markdown).not.toMatch(/ruanyf|weekly|C:\\Users/iu);
  });
});
