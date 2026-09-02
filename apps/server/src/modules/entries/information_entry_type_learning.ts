import {createHash} from 'node:crypto';

import {encodeCanonicalJson} from '../../serialization/canonical_json.js';
import {
  ENTRY_TYPE_KEYWORDS,
  type CurrentInformationEntry,
  type EntryTypeKeyword,
} from './information_entry_contract.js';

export const ENTRY_TYPE_LEARNING_FEATURE_VERSION =
  'struinfo.entry-type-learning.features.v1';
export const ENTRY_TYPE_LEARNING_MODEL_FORMAT =
  'struinfo.entry-type-learning-model';
export const ENTRY_TYPE_LEARNING_MODEL_VERSION = 1;
export const MAXIMUM_ENTRY_TYPE_TRUSTED_EXAMPLES = 1_024;
export const MAXIMUM_ENTRY_TYPE_MODEL_FEATURES_PER_TYPE = 128;
export const MAXIMUM_ENTRY_TYPE_LEARNING_CANDIDATES = 100;

export type LearnedEntryTypeKeyword = Exclude<EntryTypeKeyword, 'other'>;
export type EntryTypeTrustedExampleAuthority = 'manual' | 'codex_accepted';

export interface EntryTypeTrustedExample {
  readonly entryId: string;
  readonly entryRevision: number;
  readonly snapshotId: string;
  readonly typeKeyword: LearnedEntryTypeKeyword;
  readonly authority: EntryTypeTrustedExampleAuthority;
}

export interface EntryTypeModelFeatureWeight {
  readonly feature: string;
  readonly weight: number;
}

export interface EntryTypeClassModel {
  readonly keyword: LearnedEntryTypeKeyword;
  readonly minimumScore: number;
  readonly minimumMargin: number;
  readonly features: readonly Readonly<EntryTypeModelFeatureWeight>[];
}

export interface EntryTypeLearningEvaluationByType {
  readonly keyword: LearnedEntryTypeKeyword;
  readonly expectedCount: number;
  readonly assignedCount: number;
  readonly correctCount: number;
  readonly precisionBasisPoints: number;
  readonly recallBasisPoints: number;
}

export interface EntryTypeLearningEvaluation {
  readonly trainingCount: number;
  readonly validationCount: number;
  readonly assignedCount: number;
  readonly correctCount: number;
  readonly precisionBasisPoints: number;
  readonly coverageBasisPoints: number;
  readonly activationEligible: boolean;
  readonly byType: readonly Readonly<EntryTypeLearningEvaluationByType>[];
}

export interface EntryTypeLearningModel {
  readonly format: typeof ENTRY_TYPE_LEARNING_MODEL_FORMAT;
  readonly version: typeof ENTRY_TYPE_LEARNING_MODEL_VERSION;
  readonly featureVersion: typeof ENTRY_TYPE_LEARNING_FEATURE_VERSION;
  readonly trainingDigest: string;
  readonly classes: readonly Readonly<EntryTypeClassModel>[];
  readonly evaluation: Readonly<EntryTypeLearningEvaluation>;
}

export interface EntryTypeLearningState {
  readonly trustedExamples: readonly Readonly<EntryTypeTrustedExample>[];
  readonly candidateModel?: Readonly<EntryTypeLearningModel>;
  readonly activeModel?: Readonly<EntryTypeLearningModel>;
}

export interface EntryTypeLearningCandidate {
  readonly entry: Readonly<CurrentInformationEntry>;
  readonly reason:
    | 'missing_type'
    | 'other_type'
    | 'untrusted_existing_type'
    | 'model_disagreement'
    | 'model_low_margin';
}

export interface EntryTypeLearningPrediction {
  readonly keyword: LearnedEntryTypeKeyword;
  readonly score: number;
  readonly runnerUpScore: number;
  readonly minimumScore: number;
  readonly minimumMargin: number;
  readonly matchedFeatures: readonly string[];
}

export const DEFAULT_ENTRY_TYPE_LEARNING_STATE: Readonly<EntryTypeLearningState> =
  Object.freeze({trustedExamples: Object.freeze([])});

const LEARNED_TYPES = ENTRY_TYPE_KEYWORDS.filter(
  (keyword): keyword is LearnedEntryTypeKeyword => keyword !== 'other',
);
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}+#._-]{1,31}/gu;

export function selectEntryTypeLearningCandidates(
  entries: readonly Readonly<CurrentInformationEntry>[],
  state: Readonly<EntryTypeLearningState>,
  input: Readonly<{includePrivate: boolean; limit: number}>,
): readonly Readonly<EntryTypeLearningCandidate>[] {
  if (
    typeof input.includePrivate !== 'boolean' ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAXIMUM_ENTRY_TYPE_LEARNING_CANDIDATES
  ) {
    return Object.freeze([]);
  }
  const trusted = new Set(
    state.trustedExamples.map(
      (example) =>
        `${example.entryId}\u0000${example.entryRevision.toString()}`,
    ),
  );
  const ranked = entries
    .filter((entry) => input.includePrivate || !entry.value.isPrivate)
    .filter(
      (entry) =>
        !trusted.has(`${entry.entryId}\u0000${entry.revision.toString()}`),
    )
    .map((entry) => {
      const prediction = predictEntryType(
        entry,
        state.activeModel ?? state.candidateModel,
      );
      const current = entry.value.typeKeyword;
      const reason: EntryTypeLearningCandidate['reason'] =
        current === undefined
          ? 'missing_type'
          : current === 'other'
            ? 'other_type'
            : prediction !== undefined && prediction.keyword !== current
              ? 'model_disagreement'
              : prediction === undefined && state.candidateModel !== undefined
                ? 'model_low_margin'
                : 'untrusted_existing_type';
      return Object.freeze({entry, reason});
    })
    .sort(
      (left, right) =>
        candidatePriority(left.reason) - candidatePriority(right.reason) ||
        stableHash(left.entry.snapshotId).localeCompare(
          stableHash(right.entry.snapshotId),
        ) ||
        left.entry.value.documentOrder - right.entry.value.documentOrder ||
        left.entry.entryId.localeCompare(right.entry.entryId),
    );

  const selected: Readonly<EntryTypeLearningCandidate>[] = [];
  const perSnapshot = new Map<string, Readonly<EntryTypeLearningCandidate>[]>();
  for (const candidate of ranked) {
    const bucket = perSnapshot.get(candidate.entry.snapshotId) ?? [];
    perSnapshot.set(candidate.entry.snapshotId, [...bucket, candidate]);
  }
  const snapshots = [...perSnapshot.keys()].sort((left, right) =>
    stableHash(left).localeCompare(stableHash(right)),
  );
  while (selected.length < input.limit) {
    let progressed = false;
    for (const snapshotId of snapshots) {
      const bucket = perSnapshot.get(snapshotId);
      const candidate = bucket?.shift();
      if (candidate === undefined) continue;
      selected.push(candidate);
      progressed = true;
      if (selected.length === input.limit) break;
    }
    if (!progressed) break;
  }
  return Object.freeze(selected);
}

export function trainEntryTypeLearningModel(
  examples: readonly Readonly<EntryTypeTrustedExample>[],
  entries: readonly Readonly<CurrentInformationEntry>[],
): Readonly<EntryTypeLearningModel> | undefined {
  const entryById = new Map(entries.map((entry) => [entry.entryId, entry]));
  const rows = examples
    .map((example) => {
      const entry = entryById.get(example.entryId);
      return entry?.revision === example.entryRevision &&
        entry.snapshotId === example.snapshotId
        ? Object.freeze({example, entry, features: featuresForEntry(entry)})
        : undefined;
    })
    .filter((row) => row !== undefined);
  if (rows.length < 4) return undefined;

  const validationSnapshots = selectValidationSnapshots(
    rows.map((row) => row.entry.snapshotId),
  );
  const trainingRows = rows.filter(
    (row) => !validationSnapshots.has(row.entry.snapshotId),
  );
  const validationRows = rows.filter((row) =>
    validationSnapshots.has(row.entry.snapshotId),
  );
  if (trainingRows.length < 2 || validationRows.length < 1) return undefined;

  const calibrationClasses = buildClasses(trainingRows);
  const evaluation = evaluateRows(
    calibrationClasses,
    validationRows,
    trainingRows.length,
  );
  const classes = buildClasses(rows, calibrationClasses);
  const digestRows = examples
    .map((example) => ({...example}))
    .sort(
      (left, right) =>
        left.entryId.localeCompare(right.entryId) ||
        left.entryRevision - right.entryRevision,
    );
  return Object.freeze({
    format: ENTRY_TYPE_LEARNING_MODEL_FORMAT,
    version: ENTRY_TYPE_LEARNING_MODEL_VERSION,
    featureVersion: ENTRY_TYPE_LEARNING_FEATURE_VERSION,
    trainingDigest: createHash('sha256')
      .update(encodeCanonicalJson(digestRows, 2 * 1024 * 1024))
      .digest('hex'),
    classes,
    evaluation,
  });
}

export function predictEntryType(
  entry: Readonly<CurrentInformationEntry>,
  model: Readonly<EntryTypeLearningModel> | undefined,
): Readonly<EntryTypeLearningPrediction> | undefined {
  if (model === undefined) return undefined;
  const features = featuresForEntry(entry);
  const ranked = model.classes
    .map((classModel) => scoreClass(classModel, features))
    .sort(
      (left, right) =>
        right.score - left.score || left.keyword.localeCompare(right.keyword),
    );
  const first = ranked[0];
  const second = ranked[1];
  if (
    first === undefined ||
    first.score < first.minimumScore ||
    first.score - (second?.score ?? 0) < first.minimumMargin
  ) {
    return undefined;
  }
  return Object.freeze({
    keyword: first.keyword,
    score: first.score,
    runnerUpScore: second?.score ?? 0,
    minimumScore: first.minimumScore,
    minimumMargin: first.minimumMargin,
    matchedFeatures: first.matchedFeatures,
  });
}

export function decodeEntryTypeLearningState(
  value: unknown,
): Readonly<EntryTypeLearningState> | undefined {
  if (
    !isRecord(value) ||
    !closedKeys(value, ['trustedExamples'], ['candidateModel', 'activeModel'])
  ) {
    return undefined;
  }
  const trustedExamples = decodeTrustedExamples(value.trustedExamples);
  const candidateModel =
    value.candidateModel === undefined
      ? undefined
      : decodeEntryTypeLearningModel(value.candidateModel);
  const activeModel =
    value.activeModel === undefined
      ? undefined
      : decodeEntryTypeLearningModel(value.activeModel);
  if (
    trustedExamples === undefined ||
    (value.candidateModel !== undefined && candidateModel === undefined) ||
    (value.activeModel !== undefined && activeModel === undefined)
  ) {
    return undefined;
  }
  return cloneEntryTypeLearningState({
    trustedExamples,
    ...(candidateModel === undefined ? {} : {candidateModel}),
    ...(activeModel === undefined ? {} : {activeModel}),
  });
}

export function cloneEntryTypeLearningState(
  state: Readonly<EntryTypeLearningState>,
): Readonly<EntryTypeLearningState> {
  return Object.freeze({
    trustedExamples: Object.freeze(
      state.trustedExamples.map((example) => Object.freeze({...example})),
    ),
    ...(state.candidateModel === undefined
      ? {}
      : {candidateModel: cloneModel(state.candidateModel)}),
    ...(state.activeModel === undefined
      ? {}
      : {activeModel: cloneModel(state.activeModel)}),
  });
}

function featuresForEntry(
  entry: Readonly<CurrentInformationEntry>,
): ReadonlySet<string> {
  const features = new Set<string>();
  features.add(`chunk:${entry.value.chunkMode}`);
  const length = Array.from(entry.value.body).length;
  features.add(
    `length:${length < 160 ? 'tiny' : length < 600 ? 'short' : length < 2_000 ? 'medium' : 'long'}`,
  );
  for (const keyword of entry.value.contentKeywords.slice(0, 32)) {
    const normalized = normalizeFeatureValue(keyword.normalizedValue);
    if (normalized.length > 0) features.add(`keyword:${normalized}`);
  }
  const title = entry.value.titlePath
    .normalize('NFKC')
    .toLocaleLowerCase('und');
  let tokenCount = 0;
  for (const match of title.matchAll(TOKEN_PATTERN)) {
    const token = normalizeFeatureValue(match[0]);
    if (token.length > 0) features.add(`title:${token}`);
    tokenCount += 1;
    if (tokenCount >= 24) break;
  }
  const text = `${entry.value.titlePath}\n${entry.value.body.slice(0, 8_000)}`;
  if (/```|`[^`]+`|\b(?:npm|pnpm|pip|cargo|docker)\b/iu.test(text))
    features.add('shape:code');
  if (/^(?:\s*[-*+]\s|\s*\d+[.)]\s)/mu.test(text)) features.add('shape:list');
  if (/[?？]/u.test(text)) features.add('shape:question');
  if (/\bhttps?:\/\//iu.test(text)) features.add('shape:url');
  if (/(?:我|我们|本人|\bI\b|\bmy\b|\bwe\b)/iu.test(text))
    features.add('voice:first_person');
  if (
    /(?:请|务必|步骤|首先|然后|运行|安装|配置|\bmust\b|\binstall\b|\bconfigure\b)/iu.test(
      text,
    )
  )
    features.add('voice:instruction');
  return features;
}

function buildClasses(
  rows: readonly Readonly<{
    example: Readonly<EntryTypeTrustedExample>;
    features: ReadonlySet<string>;
  }>[],
  calibration?: readonly Readonly<EntryTypeClassModel>[],
): readonly Readonly<EntryTypeClassModel>[] {
  const allFeatures = new Set<string>();
  for (const row of rows)
    for (const feature of row.features) allFeatures.add(feature);
  return Object.freeze(
    LEARNED_TYPES.map((keyword) => {
      const positive = rows.filter(
        (row) => row.example.typeKeyword === keyword,
      );
      const negative = rows.filter(
        (row) => row.example.typeKeyword !== keyword,
      );
      const weights = [...allFeatures]
        .map((feature) => {
          const positiveCount = positive.filter((row) =>
            row.features.has(feature),
          ).length;
          const negativeCount = negative.filter((row) =>
            row.features.has(feature),
          ).length;
          const positiveRate = Math.floor(
            ((positiveCount + 1) * 10_000) / (positive.length + 2),
          );
          const negativeRate = Math.floor(
            ((negativeCount + 1) * 10_000) / (negative.length + 2),
          );
          return Object.freeze({feature, weight: positiveRate - negativeRate});
        })
        .filter((weight) => weight.weight >= 500)
        .sort(
          (left, right) =>
            right.weight - left.weight ||
            left.feature.localeCompare(right.feature),
        )
        .slice(0, MAXIMUM_ENTRY_TYPE_MODEL_FEATURES_PER_TYPE);
      const calibrated = calibration?.find((item) => item.keyword === keyword);
      const provisional = Object.freeze({
        keyword,
        minimumScore: 500,
        minimumMargin: 250,
        features: Object.freeze(weights),
      });
      if (calibrated !== undefined) {
        return Object.freeze({
          ...provisional,
          minimumScore: calibrated.minimumScore,
          minimumMargin: calibrated.minimumMargin,
        });
      }
      const positiveScores = positive
        .map((row) => scoreClass(provisional, row.features).score)
        .filter((score) => score > 0)
        .sort((left, right) => left - right);
      return Object.freeze({
        ...provisional,
        minimumScore: Math.max(
          500,
          Math.floor(percentile(positiveScores, 20) / 2),
        ),
        minimumMargin: Math.max(
          250,
          Math.floor(percentile(positiveScores, 20) / 5),
        ),
      });
    }),
  );
}

function evaluateRows(
  classes: readonly Readonly<EntryTypeClassModel>[],
  rows: readonly Readonly<{
    example: Readonly<EntryTypeTrustedExample>;
    entry: Readonly<CurrentInformationEntry>;
  }>[],
  trainingCount: number,
): Readonly<EntryTypeLearningEvaluation> {
  const model = Object.freeze({
    format: ENTRY_TYPE_LEARNING_MODEL_FORMAT,
    version: ENTRY_TYPE_LEARNING_MODEL_VERSION,
    featureVersion: ENTRY_TYPE_LEARNING_FEATURE_VERSION,
    trainingDigest: '0'.repeat(64),
    classes,
    evaluation: {} as EntryTypeLearningEvaluation,
  });
  const outcomes = rows.map((row) => ({
    expected: row.example.typeKeyword,
    predicted: predictEntryType(row.entry, model)?.keyword,
  }));
  const assignedCount = outcomes.filter(
    (outcome) => outcome.predicted !== undefined,
  ).length;
  const correctCount = outcomes.filter(
    (outcome) => outcome.predicted === outcome.expected,
  ).length;
  const byType = LEARNED_TYPES.map((keyword) => {
    const expected = outcomes.filter((outcome) => outcome.expected === keyword);
    const assigned = outcomes.filter(
      (outcome) => outcome.predicted === keyword,
    );
    const correct = assigned.filter((outcome) => outcome.expected === keyword);
    return Object.freeze({
      keyword,
      expectedCount: expected.length,
      assignedCount: assigned.length,
      correctCount: correct.length,
      precisionBasisPoints: basisPoints(correct.length, assigned.length),
      recallBasisPoints: basisPoints(correct.length, expected.length),
    });
  });
  const precisionBasisPoints = basisPoints(correctCount, assignedCount);
  const activationEligible =
    rows.length >= 2 &&
    assignedCount >= 1 &&
    precisionBasisPoints >= 9_200 &&
    byType.every(
      (item) => item.assignedCount === 0 || item.precisionBasisPoints >= 8_500,
    );
  return Object.freeze({
    trainingCount,
    validationCount: rows.length,
    assignedCount,
    correctCount,
    precisionBasisPoints,
    coverageBasisPoints: basisPoints(assignedCount, rows.length),
    activationEligible,
    byType: Object.freeze(byType),
  });
}

function scoreClass(
  model: Readonly<EntryTypeClassModel>,
  features: ReadonlySet<string>,
) {
  const matched = model.features.filter((feature) =>
    features.has(feature.feature),
  );
  return Object.freeze({
    keyword: model.keyword,
    score: matched.reduce((total, feature) => total + feature.weight, 0),
    minimumScore: model.minimumScore,
    minimumMargin: model.minimumMargin,
    matchedFeatures: Object.freeze(
      matched.map((feature) => feature.feature).slice(0, 12),
    ),
  });
}

function selectValidationSnapshots(
  snapshotIds: readonly string[],
): ReadonlySet<string> {
  const unique = [...new Set(snapshotIds)].sort((left, right) =>
    stableHash(left).localeCompare(stableHash(right)),
  );
  const validationCount = Math.max(1, Math.floor(unique.length / 5));
  return new Set(unique.slice(-validationCount));
}

function decodeTrustedExamples(
  value: unknown,
): readonly Readonly<EntryTypeTrustedExample>[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > MAXIMUM_ENTRY_TYPE_TRUSTED_EXAMPLES
  )
    return undefined;
  const result: EntryTypeTrustedExample[] = [];
  const identities = new Set<string>();
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !closedKeys(
        candidate,
        ['entryId', 'entryRevision', 'snapshotId', 'typeKeyword', 'authority'],
        [],
      )
    )
      return undefined;
    if (
      !CANONICAL_UUID.test(candidate.entryId as string) ||
      !Number.isSafeInteger(candidate.entryRevision) ||
      (candidate.entryRevision as number) < 1 ||
      !CANONICAL_UUID.test(candidate.snapshotId as string) ||
      !LEARNED_TYPES.includes(
        candidate.typeKeyword as LearnedEntryTypeKeyword,
      ) ||
      (candidate.authority !== 'manual' &&
        candidate.authority !== 'codex_accepted')
    )
      return undefined;
    const identity = `${candidate.entryId as string}\u0000${(candidate.entryRevision as number).toString()}`;
    if (identities.has(identity)) return undefined;
    identities.add(identity);
    result.push(
      Object.freeze({
        entryId: candidate.entryId as string,
        entryRevision: candidate.entryRevision as number,
        snapshotId: candidate.snapshotId as string,
        typeKeyword: candidate.typeKeyword as LearnedEntryTypeKeyword,
        authority: candidate.authority,
      }),
    );
  }
  return Object.freeze(result);
}

function decodeEntryTypeLearningModel(
  value: unknown,
): Readonly<EntryTypeLearningModel> | undefined {
  if (
    !isRecord(value) ||
    !closedKeys(
      value,
      [
        'format',
        'version',
        'featureVersion',
        'trainingDigest',
        'classes',
        'evaluation',
      ],
      [],
    )
  )
    return undefined;
  if (
    value.format !== ENTRY_TYPE_LEARNING_MODEL_FORMAT ||
    value.version !== ENTRY_TYPE_LEARNING_MODEL_VERSION ||
    value.featureVersion !== ENTRY_TYPE_LEARNING_FEATURE_VERSION ||
    typeof value.trainingDigest !== 'string' ||
    !SHA256.test(value.trainingDigest) ||
    !Array.isArray(value.classes) ||
    value.classes.length !== LEARNED_TYPES.length
  )
    return undefined;
  const classes: EntryTypeClassModel[] = [];
  const seen = new Set<string>();
  for (const candidate of value.classes) {
    if (
      !isRecord(candidate) ||
      !closedKeys(
        candidate,
        ['keyword', 'minimumScore', 'minimumMargin', 'features'],
        [],
      )
    )
      return undefined;
    if (
      !LEARNED_TYPES.includes(candidate.keyword as LearnedEntryTypeKeyword) ||
      seen.has(candidate.keyword as string) ||
      !boundedInteger(candidate.minimumScore, 0, 2_000_000) ||
      !boundedInteger(candidate.minimumMargin, 0, 2_000_000) ||
      !Array.isArray(candidate.features) ||
      candidate.features.length > MAXIMUM_ENTRY_TYPE_MODEL_FEATURES_PER_TYPE
    )
      return undefined;
    seen.add(candidate.keyword as string);
    const features: EntryTypeModelFeatureWeight[] = [];
    const featureNames = new Set<string>();
    for (const feature of candidate.features) {
      if (
        !isRecord(feature) ||
        !closedKeys(feature, ['feature', 'weight'], []) ||
        typeof feature.feature !== 'string' ||
        feature.feature.length < 1 ||
        feature.feature.length > 160 ||
        featureNames.has(feature.feature) ||
        !boundedInteger(feature.weight, 1, 10_000)
      )
        return undefined;
      featureNames.add(feature.feature);
      features.push(
        Object.freeze({feature: feature.feature, weight: feature.weight}),
      );
    }
    classes.push(
      Object.freeze({
        keyword: candidate.keyword as LearnedEntryTypeKeyword,
        minimumScore: candidate.minimumScore,
        minimumMargin: candidate.minimumMargin,
        features: Object.freeze(features),
      }),
    );
  }
  const evaluation = decodeEvaluation(value.evaluation);
  if (evaluation === undefined) return undefined;
  return cloneModel({
    format: ENTRY_TYPE_LEARNING_MODEL_FORMAT,
    version: ENTRY_TYPE_LEARNING_MODEL_VERSION,
    featureVersion: ENTRY_TYPE_LEARNING_FEATURE_VERSION,
    trainingDigest: value.trainingDigest,
    classes,
    evaluation,
  });
}

function decodeEvaluation(
  value: unknown,
): Readonly<EntryTypeLearningEvaluation> | undefined {
  if (
    !isRecord(value) ||
    !closedKeys(
      value,
      [
        'trainingCount',
        'validationCount',
        'assignedCount',
        'correctCount',
        'precisionBasisPoints',
        'coverageBasisPoints',
        'activationEligible',
        'byType',
      ],
      [],
    ) ||
    !Array.isArray(value.byType) ||
    value.byType.length !== LEARNED_TYPES.length
  )
    return undefined;
  const counts = [
    'trainingCount',
    'validationCount',
    'assignedCount',
    'correctCount',
  ] as const;
  const points = ['precisionBasisPoints', 'coverageBasisPoints'] as const;
  if (
    counts.some(
      (key) =>
        !boundedInteger(value[key], 0, MAXIMUM_ENTRY_TYPE_TRUSTED_EXAMPLES),
    ) ||
    points.some((key) => !boundedInteger(value[key], 0, 10_000)) ||
    (value.activationEligible !== true && value.activationEligible !== false)
  )
    return undefined;
  const byType: EntryTypeLearningEvaluationByType[] = [];
  const seen = new Set<string>();
  for (const item of value.byType) {
    if (
      !isRecord(item) ||
      !closedKeys(
        item,
        [
          'keyword',
          'expectedCount',
          'assignedCount',
          'correctCount',
          'precisionBasisPoints',
          'recallBasisPoints',
        ],
        [],
      ) ||
      !LEARNED_TYPES.includes(item.keyword as LearnedEntryTypeKeyword) ||
      seen.has(item.keyword as string) ||
      ['expectedCount', 'assignedCount', 'correctCount'].some(
        (key) =>
          !boundedInteger(item[key], 0, MAXIMUM_ENTRY_TYPE_TRUSTED_EXAMPLES),
      ) ||
      ['precisionBasisPoints', 'recallBasisPoints'].some(
        (key) => !boundedInteger(item[key], 0, 10_000),
      )
    )
      return undefined;
    seen.add(item.keyword as string);
    byType.push(
      Object.freeze({
        keyword: item.keyword as LearnedEntryTypeKeyword,
        expectedCount: item.expectedCount as number,
        assignedCount: item.assignedCount as number,
        correctCount: item.correctCount as number,
        precisionBasisPoints: item.precisionBasisPoints as number,
        recallBasisPoints: item.recallBasisPoints as number,
      }),
    );
  }
  return Object.freeze({
    trainingCount: value.trainingCount as number,
    validationCount: value.validationCount as number,
    assignedCount: value.assignedCount as number,
    correctCount: value.correctCount as number,
    precisionBasisPoints: value.precisionBasisPoints as number,
    coverageBasisPoints: value.coverageBasisPoints as number,
    activationEligible: value.activationEligible,
    byType: Object.freeze(byType),
  });
}

function cloneModel(
  model: Readonly<EntryTypeLearningModel>,
): Readonly<EntryTypeLearningModel> {
  return Object.freeze({
    ...model,
    classes: Object.freeze(
      model.classes.map((item) =>
        Object.freeze({
          ...item,
          features: Object.freeze(
            item.features.map((feature) => Object.freeze({...feature})),
          ),
        }),
      ),
    ),
    evaluation: Object.freeze({
      ...model.evaluation,
      byType: Object.freeze(
        model.evaluation.byType.map((item) => Object.freeze({...item})),
      ),
    }),
  });
}

function candidatePriority(
  reason: EntryTypeLearningCandidate['reason'],
): number {
  return [
    'missing_type',
    'model_disagreement',
    'model_low_margin',
    'other_type',
    'untrusted_existing_type',
  ].indexOf(reason);
}

function stableHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeFeatureValue(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('und').trim().slice(0, 96);
}

function percentile(values: readonly number[], percentage: number): number {
  if (values.length === 0) return 0;
  return values[Math.floor(((values.length - 1) * percentage) / 100)] ?? 0;
}

function basisPoints(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.floor((numerator * 10_000) / denominator);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function closedKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}
