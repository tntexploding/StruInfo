import {createHash} from 'node:crypto';
import {arch, platform} from 'node:os';
import {performance} from 'node:perf_hooks';

import {
  buildIncrementalInformationEntryAssociationProjection,
  DETERMINISTIC_ENTRY_TAG_RULE_VERSION,
  extractDeterministicEntryTagCandidates,
  type CurrentInformationEntry,
} from '../apps/server/src/modules/entries/index.js';
import {
  DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
  DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
} from '../apps/server/src/storage/review_preferences_store.js';

export const M2_P0B_PERFORMANCE_REPORT_SCHEMA =
  'struinfo.m2-p0b-performance-report.v1' as const;

export interface M2P0bPerformanceWorkloadOptions {
  readonly entryCount: number;
  readonly entriesPerSnapshot: number;
  readonly associationGroupSize: number;
}

export interface M2P0bPerformanceReport {
  readonly schemaVersion: typeof M2_P0B_PERFORMANCE_REPORT_SCHEMA;
  readonly evidenceScope: 'synthetic_core_only';
  readonly runtime: Readonly<{
    node: string;
    platform: string;
    architecture: string;
  }>;
  readonly workloadSha256: string;
  readonly workload: Readonly<{
    entryCount: number;
    snapshotCount: number;
    extractedCandidateCount: number;
    taggedEntryCount: number;
    associationProjectionCount: number;
  }>;
  readonly measurements: Readonly<{
    deterministicTaggingMilliseconds: number;
    incrementalAssociationMilliseconds: number;
    totalCoreMilliseconds: number;
    throughputEntriesPerSecond: number;
    projected15000CoreSeconds: number;
    projected15000CoreHours: number;
  }>;
  readonly limitation: string;
}

export const M2_P0B_STANDARD_PERFORMANCE_WORKLOAD: Readonly<M2P0bPerformanceWorkloadOptions> =
  Object.freeze({
    entryCount: 15_000,
    entriesPerSnapshot: 30,
    associationGroupSize: 30,
  });

export const M2_P0B_SMOKE_PERFORMANCE_WORKLOAD: Readonly<M2P0bPerformanceWorkloadOptions> =
  Object.freeze({
    entryCount: 120,
    entriesPerSnapshot: 12,
    associationGroupSize: 12,
  });

/**
 * Measures only the deterministic in-memory rules used by M2-P0B. It does not
 * include PostgreSQL, Blob I/O, CLI orchestration, retries or human review and
 * therefore cannot prove the 15,000 Entry / 4–6 hour end-to-end target.
 */
export function runM2P0bPerformanceWorkload(
  options: Readonly<M2P0bPerformanceWorkloadOptions> = M2_P0B_STANDARD_PERFORMANCE_WORKLOAD,
): Readonly<M2P0bPerformanceReport> {
  assertOptions(options);
  const entries = syntheticEntries(options);
  const taggingStarted = performance.now();
  let extractedCandidateCount = 0;
  const taggedEntries = entries.map((entry) => {
    const candidates = extractDeterministicEntryTagCandidates(
      entry.value.body,
      DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
      DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
      10,
    );
    if (candidates.length === 0) {
      throw new Error('Synthetic deterministic tagging produced no candidate.');
    }
    extractedCandidateCount += candidates.length;
    return Object.freeze({
      ...entry,
      revision: 2,
      revisionId: uuid('6', numericId(entry.entryId)),
      value: Object.freeze({
        ...entry.value,
        contentKeywords: Object.freeze(
          candidates.map((candidate) =>
            Object.freeze({
              ...candidate,
              origin: 'rule' as const,
              originVersion: DETERMINISTIC_ENTRY_TAG_RULE_VERSION,
            }),
          ),
        ),
      }),
    });
  });
  const deterministicTaggingMilliseconds = performance.now() - taggingStarted;

  const associationStarted = performance.now();
  const projections = buildIncrementalInformationEntryAssociationProjection(
    taggedEntries,
    taggedEntries.map((entry) => entry.entryId),
  );
  const incrementalAssociationMilliseconds =
    performance.now() - associationStarted;
  const totalCoreMilliseconds =
    deterministicTaggingMilliseconds + incrementalAssociationMilliseconds;
  const throughputEntriesPerSecond =
    totalCoreMilliseconds === 0
      ? 0
      : (options.entryCount * 1_000) / totalCoreMilliseconds;
  const projected15000CoreHours =
    throughputEntriesPerSecond === 0
      ? 0
      : 15_000 / throughputEntriesPerSecond / 3_600;
  const projected15000CoreSeconds = projected15000CoreHours * 3_600;

  return Object.freeze({
    schemaVersion: M2_P0B_PERFORMANCE_REPORT_SCHEMA,
    evidenceScope: 'synthetic_core_only' as const,
    runtime: Object.freeze({
      node: process.version,
      platform: platform(),
      architecture: arch(),
    }),
    workloadSha256: sha256(
      JSON.stringify({
        associationGroupSize: options.associationGroupSize,
        entriesPerSnapshot: options.entriesPerSnapshot,
        entryCount: options.entryCount,
        schemaVersion: 'struinfo.m2-p0b-workload.v1',
      }),
    ),
    workload: Object.freeze({
      entryCount: options.entryCount,
      snapshotCount: Math.ceil(options.entryCount / options.entriesPerSnapshot),
      extractedCandidateCount,
      taggedEntryCount: taggedEntries.length,
      associationProjectionCount: projections.length,
    }),
    measurements: Object.freeze({
      deterministicTaggingMilliseconds: round(deterministicTaggingMilliseconds),
      incrementalAssociationMilliseconds: round(
        incrementalAssociationMilliseconds,
      ),
      totalCoreMilliseconds: round(totalCoreMilliseconds),
      throughputEntriesPerSecond: round(throughputEntriesPerSecond),
      projected15000CoreSeconds: round(projected15000CoreSeconds),
      projected15000CoreHours: round(projected15000CoreHours, 6),
    }),
    limitation:
      'Synthetic in-memory core evidence only; this report is not an end-to-end 15,000 Entry / 4–6 hour acceptance result.',
  });
}

function syntheticEntries(
  options: Readonly<M2P0bPerformanceWorkloadOptions>,
): readonly Readonly<CurrentInformationEntry>[] {
  return Object.freeze(
    Array.from({length: options.entryCount}, (_, index) => {
      const group = Math.floor(index / options.associationGroupSize)
        .toString()
        .padStart(4, '0');
      const ordinal = index.toString().padStart(5, '0');
      const snapshotOrdinal =
        Math.floor(index / options.entriesPerSnapshot) + 1;
      const body = [
        `Synthetic batch entry ${ordinal}`,
        `This bounded fixture explains **cluster-${group}** with \`Tool-${ordinal}\`.`,
        'It contains no owner material, network response or personal preference.',
      ].join('\n');
      return Object.freeze({
        workspaceId: WORKSPACE_ID,
        entryId: uuid('2', index + 1),
        resourceId: uuid('3', snapshotOrdinal),
        snapshotId: uuid('4', snapshotOrdinal),
        revision: 1,
        revisionId: uuid('5', index + 1),
        sourceKey: `synthetic:m2-p0b:${snapshotOrdinal.toString()}`,
        capturedAt: '2040-01-01T00:00:00.000Z',
        value: Object.freeze({
          documentOrder: index % options.entriesPerSnapshot,
          titlePath: `Synthetic batch entry ${ordinal}`,
          body,
          bodySha256: sha256(body),
          chunkMode: 'split' as const,
          splitRuleVersion: 'struinfo.synthetic-m2-p0b.v1',
          isPrivate: false,
          contentKeywords: Object.freeze([]),
          domains: Object.freeze([]),
          fragmentIds: Object.freeze([uuid('8', index + 1)]),
        }),
      });
    }),
  );
}

function assertOptions(
  options: Readonly<M2P0bPerformanceWorkloadOptions>,
): void {
  if (
    !Number.isSafeInteger(options.entryCount) ||
    options.entryCount < 2 ||
    options.entryCount > 50_000 ||
    !Number.isSafeInteger(options.entriesPerSnapshot) ||
    options.entriesPerSnapshot < 1 ||
    options.entriesPerSnapshot > 500 ||
    !Number.isSafeInteger(options.associationGroupSize) ||
    options.associationGroupSize < 2 ||
    options.associationGroupSize > 64 ||
    options.associationGroupSize > options.entryCount
  ) {
    throw new Error('M2-P0B performance workload options are invalid.');
  }
}

function numericId(id: string): number {
  return Number.parseInt(id.slice(-12), 10);
}

function uuid(prefix: string, ordinal: number): string {
  return `${prefix.repeat(8)}-${prefix.repeat(4)}-4${prefix.repeat(3)}-8${prefix.repeat(3)}-${ordinal.toString().padStart(12, '0')}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
