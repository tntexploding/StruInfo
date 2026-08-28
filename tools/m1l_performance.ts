import {createHash} from 'node:crypto';
import {arch, platform} from 'node:os';
import {performance} from 'node:perf_hooks';

import {
  deriveEvidenceBlobId,
  materializeMarkdownEvidence,
  parseMarkdownStructure,
} from '../apps/server/src/modules/evidence/markdown/index.js';
import {
  buildInformationEntryAssociationProjection,
  buildInformationEntryKnowledgeGraph,
  cosineSimilarityBasisPoints,
  prepareInformationEntrySearchProjection,
  prepareSplitInformationEntries,
  searchCurrentInformationEntries,
  type CurrentInformationEntry,
  type InformationEntryAssociationRepositorySnapshot,
  type InformationEntrySearchItem,
} from '../apps/server/src/modules/entries/index.js';
import {
  SourceConnectorRegistry,
  type SourceConnectorDocument,
} from '../apps/server/src/modules/subscriptions/index.js';

export const M1L_PERFORMANCE_REPORT_SCHEMA =
  'struinfo.m1l-performance-report.v1' as const;

export interface M1lPerformanceIterations {
  readonly import: number;
  readonly split: number;
  readonly indexProjection: number;
  readonly associationProjection: number;
  readonly lexicalSearch: number;
  readonly semanticSearch: number;
  readonly hybridSearch: number;
  readonly associationTraversal: number;
  readonly knowledgeGraph: number;
  readonly subscriptionBatch: number;
}

export interface M1lPerformanceWorkloadOptions {
  readonly markdownSections: number;
  readonly entryCount: number;
  readonly associationGroupSize: number;
  readonly embeddingDimensions: number;
  readonly connectorDocuments: number;
  readonly warmupIterations: number;
  readonly iterations: Readonly<M1lPerformanceIterations>;
}

export interface M1lPerformanceMeasurement {
  readonly operation: string;
  readonly iterations: number;
  readonly minimumMilliseconds: number;
  readonly medianMilliseconds: number;
  readonly p95Milliseconds: number;
  readonly maximumMilliseconds: number;
  readonly totalMilliseconds: number;
}

export interface M1lPerformanceReport {
  readonly schemaVersion: typeof M1L_PERFORMANCE_REPORT_SCHEMA;
  readonly runtime: Readonly<{
    node: string;
    platform: string;
    architecture: string;
  }>;
  readonly workloadSha256: string;
  readonly workload: Readonly<{
    markdownSections: number;
    markdownBytes: number;
    entryCount: number;
    associationProjectionCount: number;
    indexPostingCount: number;
    embeddingDimensions: number;
    connectorDocuments: number;
  }>;
  readonly measurements: readonly Readonly<M1lPerformanceMeasurement>[];
}

export const M1L_STANDARD_PERFORMANCE_WORKLOAD: Readonly<M1lPerformanceWorkloadOptions> =
  Object.freeze({
    markdownSections: 192,
    entryCount: 800,
    associationGroupSize: 40,
    embeddingDimensions: 96,
    connectorDocuments: 64,
    warmupIterations: 1,
    iterations: Object.freeze({
      import: 3,
      split: 12,
      indexProjection: 5,
      associationProjection: 4,
      lexicalSearch: 20,
      semanticSearch: 20,
      hybridSearch: 20,
      associationTraversal: 15,
      knowledgeGraph: 20,
      subscriptionBatch: 20,
    }),
  });

export const M1L_SMOKE_PERFORMANCE_WORKLOAD: Readonly<M1lPerformanceWorkloadOptions> =
  Object.freeze({
    markdownSections: 12,
    entryCount: 48,
    associationGroupSize: 12,
    embeddingDimensions: 12,
    connectorDocuments: 4,
    warmupIterations: 0,
    iterations: Object.freeze({
      import: 1,
      split: 1,
      indexProjection: 1,
      associationProjection: 1,
      lexicalSearch: 1,
      semanticSearch: 1,
      hybridSearch: 1,
      associationTraversal: 1,
      knowledgeGraph: 1,
      subscriptionBatch: 1,
    }),
  });

/**
 * Runs one repository-owned, data-free performance workload. Elapsed time is
 * evidence for comparison on the same machine, never a correctness verdict.
 */
export async function runM1lPerformanceWorkload(
  options: Readonly<M1lPerformanceWorkloadOptions> = M1L_STANDARD_PERFORMANCE_WORKLOAD,
): Promise<Readonly<M1lPerformanceReport>> {
  assertOptions(options);
  const markdown = syntheticMarkdown(options.markdownSections);
  const sourceUtf8 = new TextEncoder().encode(markdown);
  const rawSha256 = sha256(sourceUtf8);
  const rawBlob = Object.freeze({
    workspaceId: WORKSPACE_ID,
    blobId: deriveEvidenceBlobId(WORKSPACE_ID, rawSha256),
    digestAlgorithm: 'sha256' as const,
    digest: rawSha256,
    byteLength: sourceUtf8.byteLength,
  });
  const parseInput = Object.freeze({
    workspaceId: WORKSPACE_ID,
    resourceId: RESOURCE_ID,
    snapshotId: SNAPSHOT_ID,
    rawBlob,
    profile: 'commonmark-v1' as const,
    sourceUtf8,
  });
  const splitSnapshot = syntheticSplitSnapshot(options.markdownSections);
  const entries = syntheticEntries(
    options.entryCount,
    options.associationGroupSize,
  );
  const preparedIndex = entries.map(prepareInformationEntrySearchProjection);
  const indexPostingCount = preparedIndex.reduce(
    (total, item) => total + item.postings.length,
    0,
  );
  const associationProjections =
    buildInformationEntryAssociationProjection(entries);
  const associationSnapshot: InformationEntryAssociationRepositorySnapshot =
    Object.freeze({
      projections: associationProjections,
      overrides: Object.freeze([]),
    });
  const targetIndex = Math.min(123, entries.length - 1);
  const targetEntry = entries[targetIndex];
  if (targetEntry === undefined)
    throw new Error('Synthetic target is missing.');
  const queryVector = syntheticVector(targetIndex, options.embeddingDimensions);
  const connectorRegistry = syntheticConnectorRegistry(
    options.connectorDocuments,
  );
  const measurements: M1lPerformanceMeasurement[] = [];

  measurements.push(
    await measure(
      'import.markdown.parse_and_materialize',
      options.warmupIterations,
      options.iterations.import,
      () => {
        const parsed = parseMarkdownStructure(parseInput);
        if (parsed.status !== 'parsed') {
          throw new Error('Synthetic Markdown was rejected.');
        }
        const materialized = materializeMarkdownEvidence({
          parsed: parsed.value,
          snapshot: Object.freeze({
            workspaceId: WORKSPACE_ID,
            resourceId: RESOURCE_ID,
            snapshotId: SNAPSHOT_ID,
            rawSha256,
            rawBlob,
            canonicalContentSha256: parsed.value.normalizedTextSha256,
            canonicalizationVersion: parsed.value.textNormalizationVersion,
            mediaType: 'text/markdown',
            capturedAt: SYNTHETIC_CAPTURED_AT,
          }),
          mediaPolicy: 'external_reference_only',
          sourceUtf8,
        });
        if (
          materialized.status !== 'materialized' ||
          materialized.value.structure.fragments.length <
            options.markdownSections
        ) {
          throw new Error('Synthetic Markdown materialization was incomplete.');
        }
      },
    ),
  );
  measurements.push(
    await measure(
      'split.section.materialization',
      options.warmupIterations,
      options.iterations.split,
      () => {
        const rows = prepareSplitInformationEntries(splitSnapshot);
        if (rows.length !== options.markdownSections) {
          throw new Error('Synthetic split result was incomplete.');
        }
      },
    ),
  );
  measurements.push(
    await measure(
      'search_index.local_projection',
      options.warmupIterations,
      options.iterations.indexProjection,
      () => {
        const projected = entries.map(prepareInformationEntrySearchProjection);
        if (projected.length !== entries.length) {
          throw new Error('Synthetic search projection was incomplete.');
        }
      },
    ),
  );
  measurements.push(
    await measure(
      'association.projection_rebuild',
      options.warmupIterations,
      options.iterations.associationProjection,
      () => {
        if (
          buildInformationEntryAssociationProjection(entries).length !==
          associationProjections.length
        ) {
          throw new Error('Synthetic association projection changed.');
        }
      },
    ),
  );
  measurements.push(
    await measure(
      'query.lexical_substring',
      options.warmupIterations,
      options.iterations.lexicalSearch,
      () => {
        const result = searchCurrentInformationEntries(entries, {
          text: `needle-${targetIndex.toString().padStart(4, '0')}`,
          textMode: 'substring',
          retrievalMode: 'lexical',
          includePrivate: false,
          onlyPrivate: false,
          limit: 20,
        });
        assertSearchContains(result.items, targetEntry.entryId);
      },
    ),
  );
  measurements.push(
    await measure(
      'query.semantic_cosine',
      options.warmupIterations,
      options.iterations.semanticSearch,
      () => {
        const semantic = semanticMatches(
          entries,
          queryVector,
          options.embeddingDimensions,
        );
        const result = searchCurrentInformationEntries(
          entries,
          {
            text: 'synthetic semantic request',
            textMode: 'substring',
            retrievalMode: 'semantic',
            includePrivate: false,
            onlyPrivate: false,
            limit: 20,
          },
          EMPTY_ASSOCIATIONS,
          semantic,
        );
        if (result.items.length === 0) {
          throw new Error('Synthetic semantic result was empty.');
        }
      },
    ),
  );
  measurements.push(
    await measure(
      'query.hybrid',
      options.warmupIterations,
      options.iterations.hybridSearch,
      () => {
        const semantic = semanticMatches(
          entries,
          queryVector,
          options.embeddingDimensions,
        );
        const result = searchCurrentInformationEntries(
          entries,
          {
            text: `needle-${targetIndex.toString().padStart(4, '0')}`,
            textMode: 'substring',
            retrievalMode: 'hybrid',
            includePrivate: false,
            onlyPrivate: false,
            limit: 20,
          },
          EMPTY_ASSOCIATIONS,
          semantic,
        );
        assertSearchContains(result.items, targetEntry.entryId);
      },
    ),
  );
  measurements.push(
    await measure(
      'query.association_two_hop',
      options.warmupIterations,
      options.iterations.associationTraversal,
      () => {
        const result = searchCurrentInformationEntries(
          entries,
          {
            association: Object.freeze({
              entryId: targetEntry.entryId,
              maximumDepth: 2,
              minimumScore: 1,
            }),
            includePrivate: false,
            onlyPrivate: false,
            limit: 100,
          },
          associationSnapshot,
        );
        if (result.items.length === 0) {
          throw new Error('Synthetic association traversal was empty.');
        }
      },
    ),
  );
  measurements.push(
    await measure(
      'knowledge_graph.bounded_neighborhood',
      options.warmupIterations,
      options.iterations.knowledgeGraph,
      () => {
        const graph = buildInformationEntryKnowledgeGraph(
          targetEntry.entryId,
          entries,
          associationSnapshot,
          12,
        );
        if (graph === undefined || graph.nodes.length < 2) {
          throw new Error('Synthetic graph was incomplete.');
        }
      },
    ),
  );
  measurements.push(
    await measure(
      'subscription.connector_batch_validation',
      options.warmupIterations,
      options.iterations.subscriptionBatch,
      async () => {
        const result = await connectorRegistry.read(
          'plugin.synthetic-performance.v1',
          Object.freeze({
            subscriptionId: SUBSCRIPTION_ID,
            configuration: Object.freeze({configurationRef: 'synthetic'}),
          }),
        );
        if (
          result.status !== 'changed' ||
          result.documents.length !== options.connectorDocuments
        ) {
          throw new Error('Synthetic connector result was incomplete.');
        }
      },
    ),
  );

  return Object.freeze({
    schemaVersion: M1L_PERFORMANCE_REPORT_SCHEMA,
    runtime: Object.freeze({
      node: process.version,
      platform: platform(),
      architecture: arch(),
    }),
    workloadSha256: sha256(
      new TextEncoder().encode(JSON.stringify(canonicalOptions(options))),
    ),
    workload: Object.freeze({
      markdownSections: options.markdownSections,
      markdownBytes: sourceUtf8.byteLength,
      entryCount: entries.length,
      associationProjectionCount: associationProjections.length,
      indexPostingCount,
      embeddingDimensions: options.embeddingDimensions,
      connectorDocuments: options.connectorDocuments,
    }),
    measurements: Object.freeze(measurements),
  });
}

async function measure(
  operation: string,
  warmups: number,
  iterations: number,
  execute: () => void | Promise<void>,
): Promise<Readonly<M1lPerformanceMeasurement>> {
  for (let index = 0; index < warmups; index += 1) await execute();
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    await execute();
    samples.push(performance.now() - started);
  }
  const ordered = [...samples].sort((left, right) => left - right);
  return Object.freeze({
    operation,
    iterations,
    minimumMilliseconds: roundMilliseconds(ordered[0] ?? 0),
    medianMilliseconds: roundMilliseconds(percentile(ordered, 0.5)),
    p95Milliseconds: roundMilliseconds(percentile(ordered, 0.95)),
    maximumMilliseconds: roundMilliseconds(ordered.at(-1) ?? 0),
    totalMilliseconds: roundMilliseconds(
      samples.reduce((total, value) => total + value, 0),
    ),
  });
}

function syntheticMarkdown(sectionCount: number): string {
  const sections = Array.from({length: sectionCount}, (_, index) => {
    const ordinal = index.toString().padStart(4, '0');
    return [
      `## Synthetic section ${ordinal}`,
      '',
      `Synthetic paragraph ${ordinal} describes bounded entry processing.`,
      '',
      `- deterministic token ${ordinal}`,
      `- local evidence ${ordinal}`,
    ].join('\n');
  });
  return `# Synthetic M1L document\n\n${sections.join('\n\n')}\n`;
}

function syntheticSplitSnapshot(sectionCount: number) {
  let start = 0;
  const fragments = Array.from({length: sectionCount}, (_, index) => {
    const ordinal = index.toString().padStart(4, '0');
    const selectedText = `## Synthetic ${ordinal}\n\nBody needle-${ordinal}.`;
    const codePointLength = Array.from(selectedText).length;
    const fragment = Object.freeze({
      fragmentId: uuid('7', index + 1),
      structureId: STRUCTURE_ID,
      nodeKind: 'section',
      codePointRange: Object.freeze({start, end: start + codePointLength}),
      selectedText,
    });
    start += codePointLength + 2;
    return fragment;
  });
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    resourceId: RESOURCE_ID,
    snapshotId: SPLIT_SNAPSHOT_ID,
    structures: Object.freeze([
      Object.freeze({
        structureId: STRUCTURE_ID,
        fragments: Object.freeze(fragments),
      }),
    ]),
  });
}

function syntheticEntries(
  count: number,
  groupSize: number,
): readonly Readonly<CurrentInformationEntry>[] {
  return Object.freeze(
    Array.from({length: count}, (_, index) => {
      const ordinal = index.toString().padStart(4, '0');
      const group = Math.floor(index / groupSize)
        .toString()
        .padStart(4, '0');
      const groupKeyword = `cluster-${group}`;
      return Object.freeze({
        workspaceId: WORKSPACE_ID,
        entryId: uuid('2', index + 1),
        resourceId: uuid('3', Math.floor(index / 100) + 1),
        snapshotId: uuid('4', Math.floor(index / 20) + 1),
        revision: 1,
        revisionId: uuid('5', index + 1),
        sourceKey: `synthetic:performance:${Math.floor(index / 20).toString()}`,
        capturedAt: `2040-01-${((index % 28) + 1).toString().padStart(2, '0')}T00:00:00.000Z`,
        value: Object.freeze({
          documentOrder: index % 20,
          titlePath: `Synthetic entry ${ordinal} ${groupKeyword}`,
          body: [
            `Synthetic body needle-${ordinal}.`,
            `This entry belongs to ${groupKeyword} and exercises bounded retrieval.`,
            'Local evidence remains deterministic and contains no owner material.',
          ].join(' '),
          bodySha256: sha256Text(`synthetic-entry-${ordinal}`),
          chunkMode: 'split' as const,
          splitRuleVersion: 'struinfo.synthetic-performance.v1',
          isPrivate: false,
          typeKeyword: 'knowledge_explanation' as const,
          contentKeywords: Object.freeze([
            Object.freeze({
              displayValue: groupKeyword,
              normalizedValue: groupKeyword,
              origin: 'rule' as const,
              originVersion: 'struinfo.synthetic-performance.v1',
            }),
            Object.freeze({
              displayValue: `topic-${ordinal}`,
              normalizedValue: `topic-${ordinal}`,
              origin: 'rule' as const,
              originVersion: 'struinfo.synthetic-performance.v1',
            }),
          ]),
          domains: Object.freeze([
            Object.freeze({
              keyword: 'engineering_computing' as const,
              origin: 'rule' as const,
              originVersion: 'struinfo.synthetic-performance.v1',
            }),
          ]),
          fragmentIds: Object.freeze([uuid('8', index + 1)]),
        }),
      });
    }),
  );
}

function semanticMatches(
  entries: readonly Readonly<CurrentInformationEntry>[],
  queryVector: readonly number[],
  dimensions: number,
) {
  const matches = new Map<
    string,
    Readonly<{
      score: number;
      provider: string;
      model: string;
      indexVersion: string;
    }>
  >();
  for (const [index, entry] of entries.entries()) {
    const score = cosineSimilarityBasisPoints(
      queryVector,
      syntheticVector(index, dimensions),
    );
    if (score === 0) continue;
    matches.set(
      entry.entryId,
      Object.freeze({
        score,
        provider: 'synthetic-local',
        model: `synthetic-${dimensions.toString()}d`,
        indexVersion: 'struinfo.entry-search-index.v1',
      }),
    );
  }
  return matches;
}

function syntheticVector(index: number, dimensions: number): readonly number[] {
  const primary = index % dimensions;
  const secondary = (index * 7 + 3) % dimensions;
  return Object.freeze(
    Array.from({length: dimensions}, (_, dimension) =>
      dimension === primary ? 1 : dimension === secondary ? 0.25 : 0,
    ),
  );
}

function syntheticConnectorRegistry(documentCount: number) {
  const documents: readonly Readonly<SourceConnectorDocument>[] = Object.freeze(
    Array.from({length: documentCount}, (_, index) => {
      const ordinal = index.toString().padStart(4, '0');
      return Object.freeze({
        externalId: `synthetic-document-${ordinal}`,
        version: `synthetic-version-${ordinal}`,
        canonicalUri: `https://example.invalid/documents/${ordinal}`,
        mediaType: 'text/markdown',
        profile: 'commonmark-v1' as const,
        sourceUtf8: new TextEncoder().encode(
          `# Synthetic connector document ${ordinal}\n\nBounded local fixture.\n`,
        ),
      });
    }),
  );
  return new SourceConnectorRegistry([
    Object.freeze({
      connectorId: 'plugin.synthetic-performance.v1',
      descriptor: Object.freeze({
        displayName: 'Synthetic performance connector',
        origin: 'plugin' as const,
        configurationMode: 'external_reference' as const,
      }),
      read: () =>
        Promise.resolve(
          Object.freeze({
            status: 'changed' as const,
            cursor: 'synthetic-performance-cursor-v1',
            documents,
          }),
        ),
    }),
  ]);
}

function assertSearchContains(
  items: readonly Readonly<InformationEntrySearchItem>[],
  entryId: string,
): void {
  if (!items.some((item) => item.entry.entryId === entryId)) {
    throw new Error('Synthetic search omitted the expected Entry.');
  }
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index] ?? 0;
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function canonicalOptions(options: Readonly<M1lPerformanceWorkloadOptions>) {
  return Object.freeze({
    associationGroupSize: options.associationGroupSize,
    connectorDocuments: options.connectorDocuments,
    embeddingDimensions: options.embeddingDimensions,
    entryCount: options.entryCount,
    iterations: options.iterations,
    markdownSections: options.markdownSections,
    warmupIterations: options.warmupIterations,
  });
}

function assertOptions(options: Readonly<M1lPerformanceWorkloadOptions>): void {
  const values = [
    options.markdownSections,
    options.entryCount,
    options.associationGroupSize,
    options.embeddingDimensions,
    options.connectorDocuments,
  ];
  const iterationValues = Object.values(options.iterations);
  if (
    values.some((value) => !Number.isSafeInteger(value) || value < 1) ||
    options.associationGroupSize > 64 ||
    options.associationGroupSize > options.entryCount ||
    options.connectorDocuments > 64 ||
    !Number.isSafeInteger(options.warmupIterations) ||
    options.warmupIterations < 0 ||
    iterationValues.some(
      (value) => !Number.isSafeInteger(value) || value < 1 || value > 1_000,
    )
  ) {
    throw new Error('M1L performance workload options are invalid.');
  }
}

function uuid(prefix: string, ordinal: number): string {
  return `${prefix.repeat(8)}-${prefix.repeat(4)}-4${prefix.repeat(3)}-8${prefix.repeat(3)}-${ordinal.toString().padStart(12, '0')}`;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SNAPSHOT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SPLIT_SNAPSHOT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STRUCTURE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SUBSCRIPTION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SYNTHETIC_CAPTURED_AT = '2040-01-01T00:00:00.000Z';
const EMPTY_ASSOCIATIONS = Object.freeze({
  projections: Object.freeze([]),
  overrides: Object.freeze([]),
});
