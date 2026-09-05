import {createInterface} from 'node:readline';
import {createReadStream} from 'node:fs';

import {
  buildInformationEntryClassificationContext,
  classifyInformationEntryDeterministically,
  DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY,
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TYPE_KEYWORDS,
  type CurrentInformationEntry,
  type EntryDomainKeyword,
  type EntryTypeKeyword,
} from '../apps/server/src/modules/entries/index.js';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000000';

interface EvaluationRow {
  readonly entryId: string;
  readonly snapshotId: string;
  readonly titlePath: string;
  readonly body: string;
  readonly typeKeyword: EntryTypeKeyword | null;
  readonly contentKeywords: readonly string[];
  readonly domains: readonly EntryDomainKeyword[];
}

const options = parseArguments(process.argv.slice(2));
const entries = await loadEntries(options.inputPath);
const context = buildInformationEntryClassificationContext(
  entries,
  options.neighborPolicy,
);
const type = evaluateTypes(entries, context);
const domain = evaluateDomains(entries, context);

process.stdout.write(
  `${JSON.stringify(
    {
      event: 'm2_p3_classification_evaluated',
      mode: 'read_only',
      entryCount: entries.length,
      referenceEntryCount: context.referenceEntryCount,
      neighborPolicy: options.neighborPolicy,
      type,
      domain,
    },
    null,
    2,
  )}\n`,
);

function evaluateTypes(
  values: readonly Readonly<CurrentInformationEntry>[],
  context: ReturnType<typeof buildInformationEntryClassificationContext>,
) {
  const existing = values.filter(
    (entry) =>
      entry.value.typeKeyword !== undefined &&
      entry.value.typeKeyword !== 'other',
  );
  const missing = values.filter(
    (entry) => entry.value.typeKeyword === undefined,
  );
  let existingPredicted = 0;
  let existingExact = 0;
  let existingNeighborPredicted = 0;
  let existingNeighborExact = 0;
  let missingPredicted = 0;
  let missingNeighborPredicted = 0;
  const byPrediction = new Map<EntryTypeKeyword, number>();
  for (const entry of values) {
    const classification = classify(entry, context);
    const predicted = classification.typeKeyword;
    if (entry.value.typeKeyword === undefined) {
      if (predicted !== undefined) {
        missingPredicted += 1;
        byPrediction.set(predicted, (byPrediction.get(predicted) ?? 0) + 1);
        if (
          classification.diagnostics.type.evidenceSource ===
          'neighbor_consensus'
        ) {
          missingNeighborPredicted += 1;
        }
      }
    } else if (entry.value.typeKeyword !== 'other' && predicted !== undefined) {
      existingPredicted += 1;
      if (predicted === entry.value.typeKeyword) existingExact += 1;
      if (
        classification.diagnostics.type.evidenceSource === 'neighbor_consensus'
      ) {
        existingNeighborPredicted += 1;
        if (predicted === entry.value.typeKeyword) {
          existingNeighborExact += 1;
        }
      }
    }
  }
  return Object.freeze({
    existingCount: existing.length,
    existingPredicted,
    existingExact,
    selectiveExactBasisPoints: basisPoints(existingExact, existingPredicted),
    existingPredictionCoverageBasisPoints: basisPoints(
      existingPredicted,
      existing.length,
    ),
    existingNeighborPredicted,
    existingNeighborExact,
    existingNeighborExactBasisPoints: basisPoints(
      existingNeighborExact,
      existingNeighborPredicted,
    ),
    missingCount: missing.length,
    missingPredicted,
    missingPredictionCoverageBasisPoints: basisPoints(
      missingPredicted,
      missing.length,
    ),
    missingNeighborPredicted,
    projectedTotalCoverageBasisPoints: basisPoints(
      values.length - missing.length + missingPredicted,
      values.length,
    ),
    byPrediction: Object.freeze(
      ENTRY_TYPE_KEYWORDS.map((keyword) =>
        Object.freeze({keyword, count: byPrediction.get(keyword) ?? 0}),
      ),
    ),
  });
}

function evaluateDomains(
  values: readonly Readonly<CurrentInformationEntry>[],
  context: ReturnType<typeof buildInformationEntryClassificationContext>,
) {
  const existing = values.filter((entry) => entry.value.domains.length > 0);
  const missing = values.filter((entry) => entry.value.domains.length === 0);
  let existingPredicted = 0;
  let existingExactSet = 0;
  let existingOverlap = 0;
  let missingPredicted = 0;
  let missingNeighborPredicted = 0;
  let existingNeighborPredicted = 0;
  let existingNeighborExactSet = 0;
  let existingNeighborOverlap = 0;
  const byPrediction = new Map<EntryDomainKeyword, number>();
  for (const entry of values) {
    const classification = classify(entry, context);
    const predicted = classification.domains.map((domain) => domain.keyword);
    if (entry.value.domains.length === 0) {
      if (predicted.length > 0) {
        missingPredicted += 1;
        if (
          classification.diagnostics.domain.evidenceSource ===
          'neighbor_consensus'
        ) {
          missingNeighborPredicted += 1;
        }
        for (const keyword of predicted) {
          byPrediction.set(keyword, (byPrediction.get(keyword) ?? 0) + 1);
        }
      }
      continue;
    }
    if (predicted.length === 0) continue;
    existingPredicted += 1;
    const usedNeighbor =
      classification.diagnostics.domain.evidenceSource === 'neighbor_consensus';
    if (usedNeighbor) existingNeighborPredicted += 1;
    const expected = new Set(
      entry.value.domains
        .map((domain) => domain.keyword)
        .filter((keyword) => keyword !== 'other'),
    );
    const actual = new Set(predicted.filter((keyword) => keyword !== 'other'));
    if ([...actual].some((keyword) => expected.has(keyword))) {
      existingOverlap += 1;
      if (usedNeighbor) existingNeighborOverlap += 1;
    }
    if (
      actual.size === expected.size &&
      [...actual].every((keyword) => expected.has(keyword))
    ) {
      existingExactSet += 1;
      if (usedNeighbor) existingNeighborExactSet += 1;
    }
  }
  return Object.freeze({
    existingCount: existing.length,
    existingPredicted,
    existingExactSet,
    existingOverlap,
    selectiveExactSetBasisPoints: basisPoints(
      existingExactSet,
      existingPredicted,
    ),
    selectiveOverlapBasisPoints: basisPoints(
      existingOverlap,
      existingPredicted,
    ),
    existingNeighborPredicted,
    existingNeighborExactSet,
    existingNeighborOverlap,
    existingNeighborExactSetBasisPoints: basisPoints(
      existingNeighborExactSet,
      existingNeighborPredicted,
    ),
    existingNeighborOverlapBasisPoints: basisPoints(
      existingNeighborOverlap,
      existingNeighborPredicted,
    ),
    missingCount: missing.length,
    missingPredicted,
    missingPredictionCoverageBasisPoints: basisPoints(
      missingPredicted,
      missing.length,
    ),
    missingNeighborPredicted,
    projectedTotalCoverageBasisPoints: basisPoints(
      values.length - missing.length + missingPredicted,
      values.length,
    ),
    byPrediction: Object.freeze(
      ENTRY_DOMAIN_KEYWORDS.map((keyword) =>
        Object.freeze({keyword, count: byPrediction.get(keyword) ?? 0}),
      ),
    ),
  });
}

function classify(
  entry: Readonly<CurrentInformationEntry>,
  context: ReturnType<typeof buildInformationEntryClassificationContext>,
) {
  return classifyInformationEntryDeterministically({
    titlePath: entry.value.titlePath,
    body: entry.value.body,
    contentKeywords: entry.value.contentKeywords.map(
      (keyword) => keyword.displayValue,
    ),
    chunkMode: entry.value.chunkMode,
    neighborEvidence: context.evidenceFor(entry),
  });
}

async function loadEntries(
  path: string,
): Promise<readonly Readonly<CurrentInformationEntry>[]> {
  const result: CurrentInformationEntry[] = [];
  const lines = createInterface({
    input: createReadStream(path, {encoding: 'utf8'}),
    crlfDelay: Infinity,
  });
  let ordinal = 0;
  for await (const line of lines) {
    if (line.trim() === '') continue;
    const serialized = line.startsWith('{')
      ? line
      : Buffer.from(line, 'hex').toString('utf8');
    const row = decodeRow(JSON.parse(serialized) as unknown);
    ordinal += 1;
    result.push(toEntry(row, ordinal));
  }
  if (result.length === 0) throw new Error('evaluation_input_empty');
  return Object.freeze(result);
}

function decodeRow(value: unknown): EvaluationRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('evaluation_input_invalid');
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.entryId !== 'string' ||
    typeof row.snapshotId !== 'string' ||
    typeof row.titlePath !== 'string' ||
    typeof row.body !== 'string' ||
    (row.typeKeyword !== null &&
      (typeof row.typeKeyword !== 'string' ||
        !ENTRY_TYPE_KEYWORDS.includes(row.typeKeyword as EntryTypeKeyword))) ||
    !Array.isArray(row.contentKeywords) ||
    !row.contentKeywords.every((item) => typeof item === 'string') ||
    !Array.isArray(row.domains) ||
    !row.domains.every(
      (item) =>
        typeof item === 'string' &&
        ENTRY_DOMAIN_KEYWORDS.includes(item as EntryDomainKeyword),
    )
  ) {
    throw new Error('evaluation_input_invalid');
  }
  return row as unknown as EvaluationRow;
}

function toEntry(
  row: Readonly<EvaluationRow>,
  ordinal: number,
): Readonly<CurrentInformationEntry> {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    entryId: row.entryId,
    resourceId: WORKSPACE_ID,
    snapshotId: row.snapshotId,
    revision: 1,
    revisionId: WORKSPACE_ID,
    sourceKey: 'redacted-evaluation-source',
    capturedAt: '2000-01-01T00:00:00.000Z',
    value: Object.freeze({
      documentOrder: ordinal,
      titlePath: row.titlePath,
      body: row.body,
      bodySha256: '0'.repeat(64),
      chunkMode: 'split' as const,
      splitRuleVersion: 'redacted-evaluation',
      isPrivate: false,
      ...(row.typeKeyword === null ? {} : {typeKeyword: row.typeKeyword}),
      contentKeywords: Object.freeze(
        row.contentKeywords.map((keyword) =>
          Object.freeze({
            displayValue: keyword,
            normalizedValue: keyword,
            origin: 'manual' as const,
            originVersion: 'redacted-evaluation',
          }),
        ),
      ),
      domains: Object.freeze(
        row.domains.map((keyword) =>
          Object.freeze({
            keyword,
            origin: 'manual' as const,
            originVersion: 'redacted-evaluation',
          }),
        ),
      ),
      fragmentIds: Object.freeze([]),
    }),
  });
}

function basisPoints(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator * 10_000) / denominator);
}

function parseArguments(arguments_: readonly string[]) {
  const values = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
  const options = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (
      name === undefined ||
      value === undefined ||
      !name.startsWith('--') ||
      options.has(name)
    ) {
      throw new Error('evaluation_arguments_invalid');
    }
    options.set(name, value);
  }
  const inputPath = options.get('--input');
  if (inputPath === undefined || inputPath.trim() === '') {
    throw new Error('usage: --input <ndjson-path>');
  }
  const known = new Set([
    '--input',
    '--min-references',
    '--min-consensus-bp',
    '--min-shared',
    '--min-similarity-bp',
    '--max-neighbors',
    '--max-keyword-fanout',
    '--evidence-score',
  ]);
  if ([...options.keys()].some((name) => !known.has(name))) {
    throw new Error('evaluation_arguments_invalid');
  }
  return Object.freeze({
    inputPath,
    neighborPolicy: Object.freeze({
      ...DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY,
      minimumReferenceCount: integerOption(
        options,
        '--min-references',
        DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY.minimumReferenceCount,
      ),
      minimumConsensusBasisPoints: integerOption(
        options,
        '--min-consensus-bp',
        DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY.minimumConsensusBasisPoints,
      ),
      minimumSharedKeywordCount: integerOption(
        options,
        '--min-shared',
        DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY.minimumSharedKeywordCount,
      ),
      minimumSimilarityBasisPoints: integerOption(
        options,
        '--min-similarity-bp',
        DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY.minimumSimilarityBasisPoints,
      ),
      maximumNeighbors: integerOption(
        options,
        '--max-neighbors',
        DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY.maximumNeighbors,
      ),
      maximumReferencesPerKeyword: integerOption(
        options,
        '--max-keyword-fanout',
        DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY.maximumReferencesPerKeyword,
      ),
      evidenceScore: integerOption(
        options,
        '--evidence-score',
        DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY.evidenceScore,
      ),
    }),
  });
}

function integerOption(
  options: ReadonlyMap<string, string>,
  name: string,
  defaultValue: number,
): number {
  const serialized = options.get(name);
  if (serialized === undefined) return defaultValue;
  const value = Number(serialized);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('evaluation_arguments_invalid');
  }
  return value;
}
