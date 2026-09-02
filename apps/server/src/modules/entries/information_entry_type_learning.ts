import {createHash} from 'node:crypto';

import {encodeCanonicalJson} from '../../serialization/canonical_json.js';
import {
  ENTRY_TYPE_KEYWORDS,
  type CurrentInformationEntry,
  type EntryTypeKeyword,
} from './information_entry_contract.js';

export const ENTRY_TYPE_LEARNING_FEATURE_VERSION =
  'struinfo.entry-type-learning.features.v2';
const LEGACY_ENTRY_TYPE_LEARNING_FEATURE_VERSION =
  'struinfo.entry-type-learning.features.v1';
export const ENTRY_TYPE_LEARNING_MODEL_FORMAT =
  'struinfo.entry-type-learning-model';
export const ENTRY_TYPE_LEARNING_MODEL_VERSION = 1;
export const ENTRY_TYPE_LEARNING_ACTIVATION_POLICY_VERSION =
  'struinfo.entry-type-learning.activation.v3';
const LEGACY_ENTRY_TYPE_LEARNING_ACTIVATION_POLICY_VERSION =
  'struinfo.entry-type-learning.activation.v2';
export const MAXIMUM_ENTRY_TYPE_TRUSTED_EXAMPLES = 1_024;
export const MAXIMUM_ENTRY_TYPE_MODEL_FEATURES_PER_TYPE = 128;
export const MAXIMUM_ENTRY_TYPE_LEARNING_CANDIDATES = 100;
export const MINIMUM_ENTRY_TYPE_CLASS_EXAMPLES = 8;
export const MINIMUM_ENTRY_TYPE_CLASS_SNAPSHOTS = 6;
export const MINIMUM_ENTRY_TYPE_SUPPORTED_CLASSES = 4;

const MINIMUM_ENTRY_TYPE_TRAINING_EXAMPLES = 6;
const MINIMUM_ENTRY_TYPE_TRAINING_SNAPSHOTS = 4;
const MINIMUM_ENTRY_TYPE_VALIDATION_EXAMPLES = 2;
const MINIMUM_ENTRY_TYPE_VALIDATION_SNAPSHOTS = 2;
const MINIMUM_ENTRY_TYPE_VALIDATION_COVERAGE_BASIS_POINTS = 1_500;
const MINIMUM_ENTRY_TYPE_PROJECTION_POPULATION = 20;
const MINIMUM_ENTRY_TYPE_PROJECTION_COVERAGE_BASIS_POINTS = 1_500;
const MINIMUM_ENTRY_TYPE_PROJECTED_CLASSES = 3;
const MAXIMUM_ENTRY_TYPE_PROJECTED_CLASS_SHARE_BASIS_POINTS = 5_000;
const MAXIMUM_ENTRY_TYPE_TRAINING_EXAMPLES_PER_CLASS = 64;
const MAXIMUM_ENTRY_TYPE_FEATURE_WEIGHT = 8_000;
const DISABLED_ENTRY_TYPE_SCORE = 2_000_000;
const ENTRY_TYPE_CROSS_VALIDATION_FOLD_COUNT = 3;
const ENTRY_TYPE_TARGET_PRECISION_BASIS_POINTS = 9_200;
const MINIMUM_ENTRY_TYPE_FEATURE_EXAMPLES = 2;
const MINIMUM_ENTRY_TYPE_FEATURE_SNAPSHOTS = 2;
const MAXIMUM_ENTRY_TYPE_BODY_CODE_POINTS = 4_096;
const MAXIMUM_ENTRY_TYPE_BODY_TOKENS = 96;
const MAXIMUM_ENTRY_TYPE_BODY_TOKEN_FEATURES = 48;
const MAXIMUM_ENTRY_TYPE_BODY_PHRASE_FEATURES = 64;
const MAXIMUM_ENTRY_TYPE_BODY_NGRAM_FEATURES = 64;
const MAXIMUM_ENTRY_TYPE_MISCLASSIFICATION_SAMPLES = 64;

export type LearnedEntryTypeKeyword = Exclude<EntryTypeKeyword, 'other'>;
export type EntryTypeTrustedExampleAuthority = 'manual' | 'codex_accepted';
type EntryTypeLearningFeatureVersion =
  | typeof ENTRY_TYPE_LEARNING_FEATURE_VERSION
  | typeof LEGACY_ENTRY_TYPE_LEARNING_FEATURE_VERSION;
type EntryTypeLearningActivationPolicyVersion =
  | typeof ENTRY_TYPE_LEARNING_ACTIVATION_POLICY_VERSION
  | typeof LEGACY_ENTRY_TYPE_LEARNING_ACTIVATION_POLICY_VERSION;

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
  readonly trustedExampleCount: number;
  readonly trustedSnapshotCount: number;
  readonly trainingExampleCount: number;
  readonly trainingSnapshotCount: number;
  readonly validationSnapshotCount: number;
  readonly supported: boolean;
  readonly expectedCount: number;
  readonly assignedCount: number;
  readonly correctCount: number;
  readonly precisionBasisPoints: number;
  readonly recallBasisPoints: number;
}

export interface EntryTypeLearningProjectionByType {
  readonly keyword: LearnedEntryTypeKeyword;
  readonly assignedCount: number;
  readonly shareBasisPoints: number;
}

export interface EntryTypeLearningProjection {
  readonly includePrivate: boolean;
  readonly populationCount: number;
  readonly assignedCount: number;
  readonly assignedClassCount: number;
  readonly coverageBasisPoints: number;
  readonly maximumClassShareBasisPoints: number;
  readonly projectionDigest: string;
  readonly byType: readonly Readonly<EntryTypeLearningProjectionByType>[];
}

export interface EntryTypeLearningConfusionCell {
  readonly expectedTypeKeyword: LearnedEntryTypeKeyword;
  readonly predictedTypeKeyword: LearnedEntryTypeKeyword | 'unassigned';
  readonly count: number;
}

export interface EntryTypeLearningMisclassification {
  readonly entryId: string;
  readonly entryRevision: number;
  readonly snapshotId: string;
  readonly expectedTypeKeyword: LearnedEntryTypeKeyword;
  readonly predictedTypeKeyword: LearnedEntryTypeKeyword;
  readonly score: number;
  readonly margin: number;
}

export interface EntryTypeLearningEvaluation {
  readonly activationPolicyVersion?: EntryTypeLearningActivationPolicyVersion;
  readonly trainingCount: number;
  readonly validationCount: number;
  readonly assignedCount: number;
  readonly correctCount: number;
  readonly precisionBasisPoints: number;
  readonly coverageBasisPoints: number;
  readonly supportedClassCount: number;
  readonly crossValidationFoldCount?: number;
  readonly targetPrecisionBasisPoints?: number;
  readonly confusionMatrix?: readonly Readonly<EntryTypeLearningConfusionCell>[];
  readonly misclassifications?: readonly Readonly<EntryTypeLearningMisclassification>[];
  readonly projection?: Readonly<EntryTypeLearningProjection>;
  readonly activationEligible: boolean;
  readonly byType: readonly Readonly<EntryTypeLearningEvaluationByType>[];
}

export interface EntryTypeLearningModel {
  readonly format: typeof ENTRY_TYPE_LEARNING_MODEL_FORMAT;
  readonly version: typeof ENTRY_TYPE_LEARNING_MODEL_VERSION;
  readonly featureVersion: EntryTypeLearningFeatureVersion;
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
  readonly targetTypeKeyword?: LearnedEntryTypeKeyword;
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

interface EntryTypeLearningRow {
  readonly example: Readonly<EntryTypeTrustedExample>;
  readonly entry: Readonly<CurrentInformationEntry>;
  readonly features: ReadonlySet<string>;
}

interface EntryTypeSupport {
  readonly exampleCount: number;
  readonly snapshotCount: number;
}

interface RankedEntryTypeLearningCandidate extends EntryTypeLearningCandidate {
  readonly uncertainty: number;
  readonly samplingStratum: string;
}

interface EntryTypeClassThreshold {
  readonly minimumScore: number;
  readonly minimumMargin: number;
}

interface EntryTypeCrossValidationOutcome {
  readonly row: Readonly<EntryTypeLearningRow>;
  readonly scores: readonly Readonly<ReturnType<typeof scoreClass>>[];
}

interface EntryTypeFeatureSupport {
  exampleCount: number;
  readonly snapshotIds: Set<string>;
}

interface RankedEntryTypeLearningRow {
  readonly row: Readonly<EntryTypeLearningRow>;
  readonly difficulty: number;
  readonly margin: number;
  readonly expectedScore: number;
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
  const trustedByType = supportByType(state.trustedExamples);
  const trustedSnapshotsByType = new Map(
    LEARNED_TYPES.map((keyword) => [
      keyword,
      new Set(
        state.trustedExamples
          .filter((example) => example.typeKeyword === keyword)
          .map((example) => example.snapshotId),
      ),
    ]),
  );
  const rankingModel = samplingModel(state);
  const ranked: RankedEntryTypeLearningCandidate[] = entries
    .filter((entry) => input.includePrivate || !entry.value.isPrivate)
    .filter(
      (entry) =>
        !trusted.has(`${entry.entryId}\u0000${entry.revision.toString()}`),
    )
    .map((entry) => {
      const scores = scoreEntryTypeClasses(entry, rankingModel);
      const prediction = predictionFromScores(scores);
      const first = scores[0];
      const second = scores[1];
      const current = entry.value.typeKeyword;
      const reason: EntryTypeLearningCandidate['reason'] =
        current === undefined
          ? rankingModel !== undefined && prediction === undefined
            ? 'model_low_margin'
            : 'missing_type'
          : current === 'other'
            ? 'other_type'
            : prediction !== undefined && prediction.keyword !== current
              ? 'model_disagreement'
              : prediction === undefined && rankingModel !== undefined
                ? 'model_low_margin'
                : 'untrusted_existing_type';
      const targetTypeKeyword = isLearnedType(current)
        ? current
        : first !== undefined && first.score > 0
          ? first.keyword
          : undefined;
      return Object.freeze({
        entry,
        reason,
        ...(targetTypeKeyword === undefined ? {} : {targetTypeKeyword}),
        uncertainty:
          first === undefined
            ? Number.MAX_SAFE_INTEGER
            : Math.max(0, first.score - (second?.score ?? 0)),
        samplingStratum: bootstrapSamplingStratum(entry),
      });
    })
    .sort(
      (left, right) =>
        candidatePriority(left.reason) - candidatePriority(right.reason) ||
        left.uncertainty - right.uncertainty ||
        stableHash(left.entry.snapshotId).localeCompare(
          stableHash(right.entry.snapshotId),
        ) ||
        left.entry.value.documentOrder - right.entry.value.documentOrder ||
        left.entry.entryId.localeCompare(right.entry.entryId),
    );

  const selected: RankedEntryTypeLearningCandidate[] = [];
  const selectedIds = new Set<string>();
  const deficits = new Map(
    LEARNED_TYPES.map((keyword) => [
      keyword,
      Math.max(
        0,
        MINIMUM_ENTRY_TYPE_CLASS_EXAMPLES -
          (trustedByType.get(keyword)?.exampleCount ?? 0),
      ),
    ]),
  );
  const calibrationBudget = Math.min(
    input.limit,
    Math.floor((input.limit * 3) / 4),
    [...deficits.values()].reduce((total, value) => total + value, 0),
  );
  const calibrationBuckets = new Map(
    LEARNED_TYPES.map((keyword) => [
      keyword,
      orderCandidatesBySnapshot(
        ranked.filter(
          (candidate) =>
            candidate.entry.value.typeKeyword === keyword &&
            (deficits.get(keyword) ?? 0) > 0,
        ),
        trustedSnapshotsByType.get(keyword) ?? new Set<string>(),
      ),
    ]),
  );
  const calibrationCounts = new Map(
    LEARNED_TYPES.map((keyword) => [keyword, 0]),
  );
  while (selected.length < calibrationBudget) {
    let progressed = false;
    for (const keyword of LEARNED_TYPES) {
      if (
        (calibrationCounts.get(keyword) ?? 0) >= (deficits.get(keyword) ?? 0)
      ) {
        continue;
      }
      const candidate = calibrationBuckets.get(keyword)?.shift();
      if (candidate === undefined || selectedIds.has(candidate.entry.entryId))
        continue;
      selected.push(candidate);
      selectedIds.add(candidate.entry.entryId);
      calibrationCounts.set(keyword, (calibrationCounts.get(keyword) ?? 0) + 1);
      progressed = true;
      if (selected.length === calibrationBudget) break;
    }
    if (!progressed) break;
  }

  const remainingGroups = new Map<string, RankedEntryTypeLearningCandidate[]>();
  for (const candidate of ranked) {
    if (selectedIds.has(candidate.entry.entryId)) continue;
    const key =
      candidate.targetTypeKeyword === undefined
        ? `stratum:${candidate.samplingStratum}`
        : `type:${candidate.targetTypeKeyword}`;
    const bucket = remainingGroups.get(key) ?? [];
    remainingGroups.set(key, [...bucket, candidate]);
  }
  for (const [key, bucket] of remainingGroups) {
    remainingGroups.set(key, orderCandidatesBySnapshot(bucket));
  }
  const groupKeys = [...remainingGroups.keys()].sort((left, right) => {
    const leftType = left.startsWith('type:')
      ? (left.slice(5) as LearnedEntryTypeKeyword)
      : undefined;
    const rightType = right.startsWith('type:')
      ? (right.slice(5) as LearnedEntryTypeKeyword)
      : undefined;
    return (
      (rightType === undefined ? 0 : (deficits.get(rightType) ?? 0)) -
        (leftType === undefined ? 0 : (deficits.get(leftType) ?? 0)) ||
      left.localeCompare(right)
    );
  });
  while (selected.length < input.limit) {
    let progressed = false;
    for (const key of groupKeys) {
      const candidate = remainingGroups.get(key)?.shift();
      if (candidate === undefined) continue;
      selected.push(candidate);
      selectedIds.add(candidate.entry.entryId);
      progressed = true;
      if (selected.length === input.limit) break;
    }
    if (!progressed) break;
  }
  return Object.freeze(
    selected.map((candidate) =>
      Object.freeze({
        entry: candidate.entry,
        reason: candidate.reason,
        ...(candidate.targetTypeKeyword === undefined
          ? {}
          : {targetTypeKeyword: candidate.targetTypeKeyword}),
      }),
    ),
  );
}

export function trainEntryTypeLearningModel(
  examples: readonly Readonly<EntryTypeTrustedExample>[],
  entries: readonly Readonly<CurrentInformationEntry>[],
  input: Readonly<{includePrivate: boolean}> = Object.freeze({
    includePrivate: false,
  }),
): Readonly<EntryTypeLearningModel> | undefined {
  const entryById = new Map(entries.map((entry) => [entry.entryId, entry]));
  const rows: readonly Readonly<EntryTypeLearningRow>[] = examples
    .map((example) => {
      const entry = entryById.get(example.entryId);
      return entry?.revision === example.entryRevision &&
        entry.snapshotId === example.snapshotId &&
        (input.includePrivate || !entry.value.isPrivate)
        ? Object.freeze({example, entry, features: featuresForEntry(entry)})
        : undefined;
    })
    .filter((row) => row !== undefined);
  if (rows.length < 4) return undefined;

  const allSupport = supportByType(rows.map((row) => row.example));
  const supportedTypes = new Set(
    LEARNED_TYPES.filter((keyword) =>
      hasFullClassSupport(allSupport.get(keyword)),
    ),
  );
  const folds = buildCrossValidationFolds(rows, supportedTypes);
  if (folds.length < 2) return undefined;
  const crossValidationOutcomes = crossValidateRows(
    rows,
    supportedTypes,
    folds,
  );
  const thresholds = calibrateClassThresholds(
    crossValidationOutcomes,
    supportedTypes,
  );
  const trainingRows = selectHardRowsPerType(rows, supportedTypes);
  const trainingSupport = supportByType(trainingRows.map((row) => row.example));
  const validationSupport = supportByType(rows.map((row) => row.example));
  const classes = buildClasses(trainingRows, supportedTypes, thresholds);
  const projection = projectEntryTypes(classes, entries, input.includePrivate);
  const evaluation = evaluateCrossValidatedRows(
    crossValidationOutcomes,
    thresholds,
    trainingRows.length,
    allSupport,
    trainingSupport,
    validationSupport,
    supportedTypes,
    projection,
    folds.length,
  );
  const digestRows = rows
    .map((row) => ({...row.example}))
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
  return predictionFromScores(scoreEntryTypeClasses(entry, model));
}

export function isEntryTypeLearningModelActivationEligible(
  model: Readonly<EntryTypeLearningModel> | undefined,
): boolean {
  if (
    model?.featureVersion !== ENTRY_TYPE_LEARNING_FEATURE_VERSION ||
    model.evaluation.activationPolicyVersion !==
      ENTRY_TYPE_LEARNING_ACTIVATION_POLICY_VERSION ||
    !model.evaluation.activationEligible ||
    model.evaluation.supportedClassCount <
      MINIMUM_ENTRY_TYPE_SUPPORTED_CLASSES ||
    model.evaluation.precisionBasisPoints < 9_200 ||
    model.evaluation.coverageBasisPoints <
      MINIMUM_ENTRY_TYPE_VALIDATION_COVERAGE_BASIS_POINTS ||
    model.evaluation.crossValidationFoldCount !==
      ENTRY_TYPE_CROSS_VALIDATION_FOLD_COUNT ||
    model.evaluation.targetPrecisionBasisPoints !==
      ENTRY_TYPE_TARGET_PRECISION_BASIS_POINTS ||
    model.evaluation.confusionMatrix === undefined ||
    model.evaluation.misclassifications === undefined
  ) {
    return false;
  }
  const supported = model.evaluation.byType.filter((item) => item.supported);
  const projection = model.evaluation.projection;
  return (
    supported.length === model.evaluation.supportedClassCount &&
    supported.every(
      (item) =>
        item.trustedExampleCount >= MINIMUM_ENTRY_TYPE_CLASS_EXAMPLES &&
        item.trustedSnapshotCount >= MINIMUM_ENTRY_TYPE_CLASS_SNAPSHOTS &&
        item.trainingExampleCount >= MINIMUM_ENTRY_TYPE_TRAINING_EXAMPLES &&
        item.trainingSnapshotCount >= MINIMUM_ENTRY_TYPE_TRAINING_SNAPSHOTS &&
        item.expectedCount >= MINIMUM_ENTRY_TYPE_VALIDATION_EXAMPLES &&
        item.validationSnapshotCount >=
          MINIMUM_ENTRY_TYPE_VALIDATION_SNAPSHOTS &&
        item.assignedCount >= MINIMUM_ENTRY_TYPE_VALIDATION_EXAMPLES &&
        item.precisionBasisPoints >= ENTRY_TYPE_TARGET_PRECISION_BASIS_POINTS,
    ) &&
    projection !== undefined &&
    projection.populationCount >= MINIMUM_ENTRY_TYPE_PROJECTION_POPULATION &&
    projection.coverageBasisPoints >=
      MINIMUM_ENTRY_TYPE_PROJECTION_COVERAGE_BASIS_POINTS &&
    projection.assignedClassCount >=
      Math.min(
        MINIMUM_ENTRY_TYPE_PROJECTED_CLASSES,
        model.evaluation.supportedClassCount,
      ) &&
    projection.maximumClassShareBasisPoints <=
      MAXIMUM_ENTRY_TYPE_PROJECTED_CLASS_SHARE_BASIS_POINTS
  );
}

export function entryTypeLearningModelsEqual(
  left: Readonly<EntryTypeLearningModel> | undefined,
  right: Readonly<EntryTypeLearningModel> | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  const leftBytes = encodeCanonicalJson(left, 2 * 1024 * 1024);
  const rightBytes = encodeCanonicalJson(right, 2 * 1024 * 1024);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    leftBytes.every((value, index) => value === rightBytes[index])
  );
}

function predictionFromScores(
  ranked: ReturnType<typeof scoreEntryTypeClasses>,
): Readonly<EntryTypeLearningPrediction> | undefined {
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
  featureVersion: EntryTypeLearningFeatureVersion = ENTRY_TYPE_LEARNING_FEATURE_VERSION,
): ReadonlySet<string> {
  const features = baseFeaturesForEntry(entry);
  if (featureVersion === LEGACY_ENTRY_TYPE_LEARNING_FEATURE_VERSION) {
    return features;
  }
  const body = Array.from(
    entry.value.body.normalize('NFKC').toLocaleLowerCase('und'),
  )
    .slice(0, MAXIMUM_ENTRY_TYPE_BODY_CODE_POINTS)
    .join('');
  const tokens: string[] = [];
  for (const match of body.matchAll(TOKEN_PATTERN)) {
    const token = normalizeFeatureValue(match[0]);
    if (token.length > 1) tokens.push(token);
    if (tokens.length >= MAXIMUM_ENTRY_TYPE_BODY_TOKENS) break;
  }
  addEvenlySampledFeatures(
    features,
    [...new Set(tokens)].map((token) => `body:token:${token}`),
    MAXIMUM_ENTRY_TYPE_BODY_TOKEN_FEATURES,
  );
  addEvenlySampledFeatures(
    features,
    tokens.slice(1).flatMap((token, index) => {
      const previous = tokens[index];
      return previous === undefined ? [] : [`body:phrase:${previous} ${token}`];
    }),
    MAXIMUM_ENTRY_TYPE_BODY_PHRASE_FEATURES,
  );
  const ngrams: string[] = [];
  for (const segment of body.split(/[^\p{L}\p{N}+#]+/u)) {
    const characters = Array.from(segment);
    for (let index = 0; index + 3 <= characters.length; index += 1) {
      ngrams.push(`body:ngram:${characters.slice(index, index + 3).join('')}`);
    }
  }
  addEvenlySampledFeatures(
    features,
    [...new Set(ngrams)],
    MAXIMUM_ENTRY_TYPE_BODY_NGRAM_FEATURES,
  );
  return features;
}

function baseFeaturesForEntry(
  entry: Readonly<CurrentInformationEntry>,
): Set<string> {
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

function addEvenlySampledFeatures(
  target: Set<string>,
  values: readonly string[],
  limit: number,
): void {
  if (values.length <= limit) {
    for (const value of values) target.add(value);
    return;
  }
  for (let index = 0; index < limit; index += 1) {
    const selected = values[Math.floor((index * values.length) / limit)];
    if (selected !== undefined) target.add(selected);
  }
}

function samplingModel(
  state: Readonly<EntryTypeLearningState>,
): Readonly<EntryTypeLearningModel> | undefined {
  const candidate = state.candidateModel;
  if (
    candidate?.featureVersion === ENTRY_TYPE_LEARNING_FEATURE_VERSION &&
    candidate.evaluation.activationPolicyVersion ===
      ENTRY_TYPE_LEARNING_ACTIVATION_POLICY_VERSION
  ) {
    return candidate;
  }
  return state.activeModel?.featureVersion ===
    ENTRY_TYPE_LEARNING_FEATURE_VERSION &&
    state.activeModel.evaluation.activationPolicyVersion ===
      ENTRY_TYPE_LEARNING_ACTIVATION_POLICY_VERSION
    ? state.activeModel
    : undefined;
}

function scoreEntryTypeClasses(
  entry: Readonly<CurrentInformationEntry>,
  model: Readonly<EntryTypeLearningModel> | undefined,
) {
  if (model === undefined)
    return Object.freeze([]) as readonly ReturnType<typeof scoreClass>[];
  return scoreClassesFromFeatures(
    model.classes,
    featuresForEntry(entry, model.featureVersion),
  );
}

function scoreClassesFromFeatures(
  classes: readonly Readonly<EntryTypeClassModel>[],
  features: ReadonlySet<string>,
) {
  return Object.freeze(
    classes
      .map((classModel) => scoreClass(classModel, features))
      .sort(
        (left, right) =>
          right.score - left.score || left.keyword.localeCompare(right.keyword),
      ),
  );
}

function orderCandidatesBySnapshot(
  candidates: readonly RankedEntryTypeLearningCandidate[],
  alreadyRepresented: ReadonlySet<string> = new Set<string>(),
): RankedEntryTypeLearningCandidate[] {
  const buckets = new Map<string, RankedEntryTypeLearningCandidate[]>();
  for (const candidate of candidates) {
    const bucket = buckets.get(candidate.entry.snapshotId) ?? [];
    bucket.push(candidate);
    buckets.set(candidate.entry.snapshotId, bucket);
  }
  for (const bucket of buckets.values()) {
    bucket.sort(
      (left, right) =>
        candidatePriority(left.reason) - candidatePriority(right.reason) ||
        left.uncertainty - right.uncertainty ||
        left.entry.value.documentOrder - right.entry.value.documentOrder ||
        left.entry.entryId.localeCompare(right.entry.entryId),
    );
  }
  const snapshots = [...buckets.keys()].sort(
    (left, right) =>
      Number(alreadyRepresented.has(left)) -
        Number(alreadyRepresented.has(right)) ||
      stableHash(left).localeCompare(stableHash(right)),
  );
  const ordered: RankedEntryTypeLearningCandidate[] = [];
  while (ordered.length < candidates.length) {
    let progressed = false;
    for (const snapshotId of snapshots) {
      const candidate = buckets.get(snapshotId)?.shift();
      if (candidate === undefined) continue;
      ordered.push(candidate);
      progressed = true;
    }
    if (!progressed) break;
  }
  return ordered;
}

function bootstrapSamplingStratum(
  entry: Readonly<CurrentInformationEntry>,
): string {
  const features = featuresForEntry(entry);
  for (const feature of [
    'shape:code',
    'voice:instruction',
    'voice:first_person',
    'shape:question',
    'shape:list',
    'shape:url',
    'length:long',
    'length:medium',
    'length:short',
    'length:tiny',
  ]) {
    if (features.has(feature)) return feature;
  }
  return `chunk:${entry.value.chunkMode}`;
}

function supportByType(
  examples: readonly Readonly<EntryTypeTrustedExample>[],
): ReadonlyMap<LearnedEntryTypeKeyword, Readonly<EntryTypeSupport>> {
  const snapshots = new Map(
    LEARNED_TYPES.map((keyword) => [keyword, new Set<string>()]),
  );
  const counts = new Map(LEARNED_TYPES.map((keyword) => [keyword, 0]));
  for (const example of examples) {
    counts.set(example.typeKeyword, (counts.get(example.typeKeyword) ?? 0) + 1);
    snapshots.get(example.typeKeyword)?.add(example.snapshotId);
  }
  return new Map(
    LEARNED_TYPES.map((keyword) => [
      keyword,
      Object.freeze({
        exampleCount: counts.get(keyword) ?? 0,
        snapshotCount: snapshots.get(keyword)?.size ?? 0,
      }),
    ]),
  );
}

function hasFullClassSupport(
  support: Readonly<EntryTypeSupport> | undefined,
): boolean {
  return (
    (support?.exampleCount ?? 0) >= MINIMUM_ENTRY_TYPE_CLASS_EXAMPLES &&
    (support?.snapshotCount ?? 0) >= MINIMUM_ENTRY_TYPE_CLASS_SNAPSHOTS
  );
}

function selectHardRowsPerType(
  rows: readonly Readonly<EntryTypeLearningRow>[],
  supportedTypes: ReadonlySet<LearnedEntryTypeKeyword>,
): readonly Readonly<EntryTypeLearningRow>[] {
  const provisionalClasses = buildClasses(
    rows,
    supportedTypes,
    rawClassThresholds(supportedTypes),
  );
  return Object.freeze(
    LEARNED_TYPES.flatMap((keyword) => {
      const ranked = rows
        .filter((row) => row.example.typeKeyword === keyword)
        .map((row): RankedEntryTypeLearningRow => {
          const scores = scoreClassesFromFeatures(
            provisionalClasses,
            row.features,
          );
          const expectedScore =
            scores.find((score) => score.keyword === keyword)?.score ?? 0;
          const competitorScore =
            scores.find((score) => score.keyword !== keyword)?.score ?? 0;
          const first = scores[0];
          return Object.freeze({
            row,
            difficulty:
              first !== undefined &&
              first.keyword !== keyword &&
              first.score >= expectedScore
                ? 0
                : expectedScore === 0
                  ? 1
                  : expectedScore <= competitorScore
                    ? 2
                    : 3,
            margin: expectedScore - competitorScore,
            expectedScore,
          });
        })
        .sort(compareRankedLearningRows);
      if (ranked.length <= MAXIMUM_ENTRY_TYPE_TRAINING_EXAMPLES_PER_CLASS) {
        return ranked.map((item) => item.row);
      }
      const hardBudget = Math.floor(
        (MAXIMUM_ENTRY_TYPE_TRAINING_EXAMPLES_PER_CLASS * 3) / 4,
      );
      const selected = ranked.slice(0, hardBudget);
      const selectedIds = new Set(
        selected.map(
          (item) =>
            `${item.row.example.entryId}\u0000${item.row.example.entryRevision.toString()}`,
        ),
      );
      const selectedSnapshots = new Set(
        selected.map((item) => item.row.entry.snapshotId),
      );
      for (const item of ranked) {
        if (selected.length >= MAXIMUM_ENTRY_TYPE_TRAINING_EXAMPLES_PER_CLASS)
          break;
        const identity = `${item.row.example.entryId}\u0000${item.row.example.entryRevision.toString()}`;
        if (
          selectedIds.has(identity) ||
          selectedSnapshots.has(item.row.entry.snapshotId)
        )
          continue;
        selected.push(item);
        selectedIds.add(identity);
        selectedSnapshots.add(item.row.entry.snapshotId);
      }
      for (const item of ranked) {
        if (selected.length >= MAXIMUM_ENTRY_TYPE_TRAINING_EXAMPLES_PER_CLASS)
          break;
        const identity = `${item.row.example.entryId}\u0000${item.row.example.entryRevision.toString()}`;
        if (selectedIds.has(identity)) continue;
        selected.push(item);
        selectedIds.add(identity);
      }
      return selected.map((item) => item.row);
    }),
  );
}

function compareRankedLearningRows(
  left: Readonly<RankedEntryTypeLearningRow>,
  right: Readonly<RankedEntryTypeLearningRow>,
): number {
  return (
    left.difficulty - right.difficulty ||
    left.margin - right.margin ||
    left.expectedScore - right.expectedScore ||
    stableHash(left.row.entry.snapshotId).localeCompare(
      stableHash(right.row.entry.snapshotId),
    ) ||
    left.row.entry.value.documentOrder - right.row.entry.value.documentOrder ||
    left.row.entry.entryId.localeCompare(right.row.entry.entryId)
  );
}

function buildClasses(
  rows: readonly Readonly<EntryTypeLearningRow>[],
  supportedTypes: ReadonlySet<LearnedEntryTypeKeyword>,
  thresholds: ReadonlyMap<
    LearnedEntryTypeKeyword,
    Readonly<EntryTypeClassThreshold>
  >,
): readonly Readonly<EntryTypeClassModel>[] {
  const supportByFeature = new Map<
    string,
    Map<LearnedEntryTypeKeyword, EntryTypeFeatureSupport>
  >();
  const snapshotsByType = new Map(
    LEARNED_TYPES.map((keyword) => [keyword, new Set<string>()]),
  );
  for (const row of rows) {
    snapshotsByType.get(row.example.typeKeyword)?.add(row.entry.snapshotId);
    for (const feature of row.features) {
      let byType = supportByFeature.get(feature);
      if (byType === undefined) {
        byType = new Map();
        supportByFeature.set(feature, byType);
      }
      let support = byType.get(row.example.typeKeyword);
      if (support === undefined) {
        support = {exampleCount: 0, snapshotIds: new Set<string>()};
        byType.set(row.example.typeKeyword, support);
      }
      support.exampleCount += 1;
      support.snapshotIds.add(row.entry.snapshotId);
    }
  }
  return Object.freeze(
    LEARNED_TYPES.map((keyword) => {
      const threshold = thresholds.get(keyword);
      if (!supportedTypes.has(keyword) || threshold === undefined) {
        return Object.freeze({
          keyword,
          minimumScore: DISABLED_ENTRY_TYPE_SCORE,
          minimumMargin: DISABLED_ENTRY_TYPE_SCORE,
          features: Object.freeze([]),
        });
      }
      const positiveSnapshotCount = snapshotsByType.get(keyword)?.size ?? 0;
      const negativeSnapshots = new Set(
        rows
          .filter((row) => row.example.typeKeyword !== keyword)
          .map((row) => row.entry.snapshotId),
      );
      const weights = [...supportByFeature.entries()]
        .map(([feature, byType]) => {
          const positive = byType.get(keyword);
          if (
            (positive?.exampleCount ?? 0) <
              MINIMUM_ENTRY_TYPE_FEATURE_EXAMPLES ||
            (positive?.snapshotIds.size ?? 0) <
              MINIMUM_ENTRY_TYPE_FEATURE_SNAPSHOTS
          ) {
            return undefined;
          }
          const negativeFeatureSnapshots = new Set<string>();
          for (const [otherKeyword, support] of byType) {
            if (otherKeyword === keyword) continue;
            for (const snapshotId of support.snapshotIds) {
              negativeFeatureSnapshots.add(snapshotId);
            }
          }
          const positiveRate = basisPoints(
            positive?.snapshotIds.size ?? 0,
            positiveSnapshotCount,
          );
          const negativeRate = basisPoints(
            negativeFeatureSnapshots.size,
            negativeSnapshots.size,
          );
          const observedDifference = positiveRate - negativeRate;
          const reliabilityBasisPoints = Math.min(
            10_000,
            Math.floor(
              ((positive?.snapshotIds.size ?? 0) * 10_000) /
                (MINIMUM_ENTRY_TYPE_FEATURE_SNAPSHOTS * 2),
            ),
          );
          const regularizedWeight = Math.floor(
            (observedDifference * reliabilityBasisPoints) / 10_000,
          );
          return Object.freeze({
            feature,
            weight: Math.min(
              MAXIMUM_ENTRY_TYPE_FEATURE_WEIGHT,
              regularizedWeight,
            ),
          });
        })
        .filter(
          (weight): weight is Readonly<EntryTypeModelFeatureWeight> =>
            weight !== undefined && weight.weight >= 500,
        )
        .sort(
          (left, right) =>
            right.weight - left.weight ||
            left.feature.localeCompare(right.feature),
        )
        .slice(0, MAXIMUM_ENTRY_TYPE_MODEL_FEATURES_PER_TYPE);
      return Object.freeze({
        keyword,
        minimumScore: threshold.minimumScore,
        minimumMargin: threshold.minimumMargin,
        features: Object.freeze(weights),
      });
    }),
  );
}

function crossValidateRows(
  rows: readonly Readonly<EntryTypeLearningRow>[],
  supportedTypes: ReadonlySet<LearnedEntryTypeKeyword>,
  folds: readonly ReadonlySet<string>[],
): readonly Readonly<EntryTypeCrossValidationOutcome>[] {
  const outcomes: EntryTypeCrossValidationOutcome[] = [];
  for (const validationSnapshots of folds) {
    const trainingRows = rows.filter(
      (row) => !validationSnapshots.has(row.entry.snapshotId),
    );
    const validationRows = rows.filter((row) =>
      validationSnapshots.has(row.entry.snapshotId),
    );
    const trainingSupport = supportByType(
      trainingRows.map((row) => row.example),
    );
    const foldTypes = new Set(
      [...supportedTypes].filter((keyword) =>
        hasCrossValidationTrainingSupport(trainingSupport.get(keyword)),
      ),
    );
    const selectedTrainingRows = selectHardRowsPerType(trainingRows, foldTypes);
    const classes = buildClasses(
      selectedTrainingRows,
      foldTypes,
      rawClassThresholds(foldTypes),
    );
    for (const row of validationRows) {
      outcomes.push(
        Object.freeze({
          row,
          scores: scoreClassesFromFeatures(classes, row.features),
        }),
      );
    }
  }
  return Object.freeze(
    outcomes.sort(
      (left, right) =>
        left.row.entry.entryId.localeCompare(right.row.entry.entryId) ||
        left.row.entry.revision - right.row.entry.revision,
    ),
  );
}

function hasCrossValidationTrainingSupport(
  support: Readonly<EntryTypeSupport> | undefined,
): boolean {
  return (
    (support?.exampleCount ?? 0) >= 4 &&
    (support?.snapshotCount ?? 0) >= MINIMUM_ENTRY_TYPE_TRAINING_SNAPSHOTS
  );
}

function buildCrossValidationFolds(
  rows: readonly Readonly<EntryTypeLearningRow>[],
  supportedTypes: ReadonlySet<LearnedEntryTypeKeyword>,
): readonly ReadonlySet<string>[] {
  const snapshotRows = new Map<string, EntryTypeLearningRow[]>();
  for (const row of rows) {
    const bucket = snapshotRows.get(row.entry.snapshotId) ?? [];
    bucket.push(row);
    snapshotRows.set(row.entry.snapshotId, bucket);
  }
  const foldCount = Math.min(
    ENTRY_TYPE_CROSS_VALIDATION_FOLD_COUNT,
    snapshotRows.size,
  );
  if (foldCount < 2) return Object.freeze([]);
  const folds = Array.from({length: foldCount}, () => new Set<string>());
  const typeCounts = Array.from(
    {length: foldCount},
    () => new Map(LEARNED_TYPES.map((keyword) => [keyword, 0])),
  );
  const orderedSnapshots = [...snapshotRows.entries()].sort(
    ([leftId, leftRows], [rightId, rightRows]) => {
      const leftTypes = new Set(
        leftRows
          .map((row) => row.example.typeKeyword)
          .filter((keyword) => supportedTypes.has(keyword)),
      );
      const rightTypes = new Set(
        rightRows
          .map((row) => row.example.typeKeyword)
          .filter((keyword) => supportedTypes.has(keyword)),
      );
      return (
        rightTypes.size - leftTypes.size ||
        rightRows.length - leftRows.length ||
        stableHash(leftId).localeCompare(stableHash(rightId))
      );
    },
  );
  for (const [snapshotId, snapshotEntries] of orderedSnapshots) {
    const representedTypes = new Set(
      snapshotEntries
        .map((row) => row.example.typeKeyword)
        .filter((keyword) => supportedTypes.has(keyword)),
    );
    const targetFold = Array.from(
      {length: foldCount},
      (_, index) => index,
    ).sort((left, right) => {
      const leftTypeCount = [...representedTypes].reduce(
        (total, keyword) => total + (typeCounts[left]?.get(keyword) ?? 0),
        0,
      );
      const rightTypeCount = [...representedTypes].reduce(
        (total, keyword) => total + (typeCounts[right]?.get(keyword) ?? 0),
        0,
      );
      return (
        leftTypeCount - rightTypeCount ||
        (folds[left]?.size ?? 0) - (folds[right]?.size ?? 0) ||
        left - right
      );
    })[0];
    if (targetFold === undefined) continue;
    folds[targetFold]?.add(snapshotId);
    for (const keyword of representedTypes) {
      const counts = typeCounts[targetFold];
      counts?.set(keyword, (counts.get(keyword) ?? 0) + 1);
    }
  }
  return Object.freeze(
    folds.filter((fold) => fold.size > 0).map((fold) => new Set([...fold])),
  );
}

function rawClassThresholds(
  supportedTypes: ReadonlySet<LearnedEntryTypeKeyword>,
): ReadonlyMap<LearnedEntryTypeKeyword, Readonly<EntryTypeClassThreshold>> {
  return new Map(
    [...supportedTypes].map((keyword) => [
      keyword,
      Object.freeze({minimumScore: 1, minimumMargin: 0}),
    ]),
  );
}

function calibrateClassThresholds(
  outcomes: readonly Readonly<EntryTypeCrossValidationOutcome>[],
  supportedTypes: ReadonlySet<LearnedEntryTypeKeyword>,
): ReadonlyMap<LearnedEntryTypeKeyword, Readonly<EntryTypeClassThreshold>> {
  const result = new Map<
    LearnedEntryTypeKeyword,
    Readonly<EntryTypeClassThreshold>
  >();
  for (const keyword of supportedTypes) {
    const candidates = outcomes
      .map((outcome) => {
        const first = outcome.scores[0];
        const second = outcome.scores[1];
        if (first?.keyword !== keyword || first.score < 1) return undefined;
        return Object.freeze({
          score: first.score,
          margin: first.score - (second?.score ?? 0),
          correct: outcome.row.example.typeKeyword === keyword,
        });
      })
      .filter((candidate) => candidate !== undefined);
    const scoreThresholds = [
      ...new Set([1, ...candidates.map((candidate) => candidate.score)]),
    ].sort((left, right) => left - right);
    let best:
      | (EntryTypeClassThreshold & {
          readonly assignedCount: number;
          readonly precisionBasisPoints: number;
        })
      | undefined;
    for (const minimumScore of scoreThresholds) {
      const scoreEligible = candidates
        .filter((candidate) => candidate.score >= minimumScore)
        .sort(
          (left, right) =>
            right.margin - left.margin || right.score - left.score,
        );
      const consider = (
        minimumMargin: number,
        assignedCount: number,
        correctCount: number,
      ): void => {
        const precisionBasisPoints = basisPoints(correctCount, assignedCount);
        if (
          assignedCount < MINIMUM_ENTRY_TYPE_VALIDATION_EXAMPLES ||
          precisionBasisPoints < ENTRY_TYPE_TARGET_PRECISION_BASIS_POINTS
        )
          return;
        const proposed = Object.freeze({
          minimumScore,
          minimumMargin,
          assignedCount,
          precisionBasisPoints,
        });
        if (
          best === undefined ||
          proposed.assignedCount > best.assignedCount ||
          (proposed.assignedCount === best.assignedCount &&
            proposed.precisionBasisPoints > best.precisionBasisPoints) ||
          (proposed.assignedCount === best.assignedCount &&
            proposed.precisionBasisPoints === best.precisionBasisPoints &&
            proposed.minimumScore + proposed.minimumMargin <
              best.minimumScore + best.minimumMargin)
        ) {
          best = proposed;
        }
      };
      consider(
        0,
        scoreEligible.length,
        scoreEligible.filter((candidate) => candidate.correct).length,
      );
      let assignedCount = 0;
      let correctCount = 0;
      for (let index = 0; index < scoreEligible.length; index += 1) {
        const candidate = scoreEligible[index];
        if (candidate === undefined) continue;
        assignedCount += 1;
        if (candidate.correct) correctCount += 1;
        if (scoreEligible[index + 1]?.margin === candidate.margin) continue;
        consider(candidate.margin, assignedCount, correctCount);
      }
    }
    if (best !== undefined) {
      result.set(
        keyword,
        Object.freeze({
          minimumScore: best.minimumScore,
          minimumMargin: best.minimumMargin,
        }),
      );
    }
  }
  return result;
}

function predictFromCalibratedScores(
  scores: readonly Readonly<ReturnType<typeof scoreClass>>[],
  thresholds: ReadonlyMap<
    LearnedEntryTypeKeyword,
    Readonly<EntryTypeClassThreshold>
  >,
): Readonly<EntryTypeLearningPrediction> | undefined {
  const first = scores[0];
  const second = scores[1];
  if (first === undefined) return undefined;
  const threshold = thresholds.get(first.keyword);
  if (
    threshold === undefined ||
    first.score < threshold.minimumScore ||
    first.score - (second?.score ?? 0) < threshold.minimumMargin
  )
    return undefined;
  return Object.freeze({
    keyword: first.keyword,
    score: first.score,
    runnerUpScore: second?.score ?? 0,
    minimumScore: threshold.minimumScore,
    minimumMargin: threshold.minimumMargin,
    matchedFeatures: first.matchedFeatures,
  });
}

function evaluateCrossValidatedRows(
  crossValidationOutcomes: readonly Readonly<EntryTypeCrossValidationOutcome>[],
  thresholds: ReadonlyMap<
    LearnedEntryTypeKeyword,
    Readonly<EntryTypeClassThreshold>
  >,
  trainingCount: number,
  allSupport: ReadonlyMap<LearnedEntryTypeKeyword, EntryTypeSupport>,
  trainingSupport: ReadonlyMap<LearnedEntryTypeKeyword, EntryTypeSupport>,
  validationSupport: ReadonlyMap<LearnedEntryTypeKeyword, EntryTypeSupport>,
  supportedTypes: ReadonlySet<LearnedEntryTypeKeyword>,
  projection: Readonly<EntryTypeLearningProjection>,
  crossValidationFoldCount: number,
): Readonly<EntryTypeLearningEvaluation> {
  const outcomes = crossValidationOutcomes.map((outcome) => {
    const prediction = predictFromCalibratedScores(outcome.scores, thresholds);
    return Object.freeze({
      row: outcome.row,
      expected: outcome.row.example.typeKeyword,
      prediction,
      predicted: prediction?.keyword,
    });
  });
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
    const trusted = allSupport.get(keyword);
    const training = trainingSupport.get(keyword);
    const validation = validationSupport.get(keyword);
    return Object.freeze({
      keyword,
      trustedExampleCount: trusted?.exampleCount ?? 0,
      trustedSnapshotCount: trusted?.snapshotCount ?? 0,
      trainingExampleCount: training?.exampleCount ?? 0,
      trainingSnapshotCount: training?.snapshotCount ?? 0,
      validationSnapshotCount: validation?.snapshotCount ?? 0,
      supported: supportedTypes.has(keyword),
      expectedCount: expected.length,
      assignedCount: assigned.length,
      correctCount: correct.length,
      precisionBasisPoints: basisPoints(correct.length, assigned.length),
      recallBasisPoints: basisPoints(correct.length, expected.length),
    });
  });
  const precisionBasisPoints = basisPoints(correctCount, assignedCount);
  const coverageBasisPoints = basisPoints(assignedCount, outcomes.length);
  const supportedClassCount = supportedTypes.size;
  const confusionMatrix = buildConfusionMatrix(outcomes);
  const misclassifications = buildMisclassificationSamples(outcomes);
  const activationEligible =
    supportedClassCount >= MINIMUM_ENTRY_TYPE_SUPPORTED_CLASSES &&
    outcomes.length >=
      supportedClassCount * MINIMUM_ENTRY_TYPE_VALIDATION_EXAMPLES &&
    assignedCount >= 1 &&
    precisionBasisPoints >= ENTRY_TYPE_TARGET_PRECISION_BASIS_POINTS &&
    coverageBasisPoints >=
      MINIMUM_ENTRY_TYPE_VALIDATION_COVERAGE_BASIS_POINTS &&
    byType
      .filter((item) => item.supported)
      .every(
        (item) =>
          item.expectedCount >= MINIMUM_ENTRY_TYPE_VALIDATION_EXAMPLES &&
          item.validationSnapshotCount >=
            MINIMUM_ENTRY_TYPE_VALIDATION_SNAPSHOTS &&
          item.assignedCount >= MINIMUM_ENTRY_TYPE_VALIDATION_EXAMPLES &&
          item.precisionBasisPoints >= ENTRY_TYPE_TARGET_PRECISION_BASIS_POINTS,
      ) &&
    projection.populationCount >= MINIMUM_ENTRY_TYPE_PROJECTION_POPULATION &&
    projection.coverageBasisPoints >=
      MINIMUM_ENTRY_TYPE_PROJECTION_COVERAGE_BASIS_POINTS &&
    projection.assignedClassCount >=
      Math.min(MINIMUM_ENTRY_TYPE_PROJECTED_CLASSES, supportedClassCount) &&
    projection.maximumClassShareBasisPoints <=
      MAXIMUM_ENTRY_TYPE_PROJECTED_CLASS_SHARE_BASIS_POINTS;
  return Object.freeze({
    activationPolicyVersion: ENTRY_TYPE_LEARNING_ACTIVATION_POLICY_VERSION,
    trainingCount,
    validationCount: outcomes.length,
    assignedCount,
    correctCount,
    precisionBasisPoints,
    coverageBasisPoints,
    supportedClassCount,
    crossValidationFoldCount,
    targetPrecisionBasisPoints: ENTRY_TYPE_TARGET_PRECISION_BASIS_POINTS,
    confusionMatrix,
    misclassifications,
    projection,
    activationEligible,
    byType: Object.freeze(byType),
  });
}

function buildConfusionMatrix(
  outcomes: readonly Readonly<{
    expected: LearnedEntryTypeKeyword;
    predicted: LearnedEntryTypeKeyword | undefined;
  }>[],
): readonly Readonly<EntryTypeLearningConfusionCell>[] {
  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    const predicted = outcome.predicted ?? 'unassigned';
    const identity = `${outcome.expected}\u0000${predicted}`;
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  const predictedOrder = [...LEARNED_TYPES, 'unassigned'] as const;
  return Object.freeze(
    [...counts.entries()]
      .map(([identity, count]) => {
        const [expectedTypeKeyword, predictedTypeKeyword] =
          identity.split('\u0000');
        return Object.freeze({
          expectedTypeKeyword: expectedTypeKeyword as LearnedEntryTypeKeyword,
          predictedTypeKeyword: predictedTypeKeyword as
            LearnedEntryTypeKeyword | 'unassigned',
          count,
        });
      })
      .sort(
        (left, right) =>
          LEARNED_TYPES.indexOf(left.expectedTypeKeyword) -
            LEARNED_TYPES.indexOf(right.expectedTypeKeyword) ||
          predictedOrder.indexOf(left.predictedTypeKeyword) -
            predictedOrder.indexOf(right.predictedTypeKeyword),
      ),
  );
}

function buildMisclassificationSamples(
  outcomes: readonly Readonly<{
    row: Readonly<EntryTypeLearningRow>;
    expected: LearnedEntryTypeKeyword;
    prediction: Readonly<EntryTypeLearningPrediction> | undefined;
  }>[],
): readonly Readonly<EntryTypeLearningMisclassification>[] {
  return Object.freeze(
    outcomes
      .flatMap((outcome) => {
        const prediction = outcome.prediction;
        return prediction === undefined ||
          prediction.keyword === outcome.expected
          ? []
          : [
              Object.freeze({
                entryId: outcome.row.entry.entryId,
                entryRevision: outcome.row.entry.revision,
                snapshotId: outcome.row.entry.snapshotId,
                expectedTypeKeyword: outcome.expected,
                predictedTypeKeyword: prediction.keyword,
                score: prediction.score,
                margin: prediction.score - prediction.runnerUpScore,
              }),
            ];
      })
      .sort(
        (left, right) =>
          right.margin - left.margin ||
          right.score - left.score ||
          left.entryId.localeCompare(right.entryId),
      )
      .slice(0, MAXIMUM_ENTRY_TYPE_MISCLASSIFICATION_SAMPLES),
  );
}

function projectEntryTypes(
  classes: readonly Readonly<EntryTypeClassModel>[],
  entries: readonly Readonly<CurrentInformationEntry>[],
  includePrivate: boolean,
): Readonly<EntryTypeLearningProjection> {
  const model = Object.freeze({
    format: ENTRY_TYPE_LEARNING_MODEL_FORMAT,
    version: ENTRY_TYPE_LEARNING_MODEL_VERSION,
    featureVersion: ENTRY_TYPE_LEARNING_FEATURE_VERSION,
    trainingDigest: '0'.repeat(64),
    classes,
    evaluation: {} as EntryTypeLearningEvaluation,
  });
  const population = entries
    .filter((entry) => includePrivate || !entry.value.isPrivate)
    .filter((entry) => entry.value.typeKeyword === undefined)
    .map((entry) =>
      Object.freeze({
        entry,
        predicted: predictEntryType(entry, model)?.keyword,
      }),
    )
    .sort(
      (left, right) =>
        left.entry.entryId.localeCompare(right.entry.entryId) ||
        left.entry.revision - right.entry.revision,
    );
  const assignedCounts = new Map(LEARNED_TYPES.map((keyword) => [keyword, 0]));
  for (const item of population) {
    if (item.predicted === undefined) continue;
    assignedCounts.set(
      item.predicted,
      (assignedCounts.get(item.predicted) ?? 0) + 1,
    );
  }
  const assignedCount = [...assignedCounts.values()].reduce(
    (total, count) => total + count,
    0,
  );
  const byType = LEARNED_TYPES.map((keyword) => {
    const count = assignedCounts.get(keyword) ?? 0;
    return Object.freeze({
      keyword,
      assignedCount: count,
      shareBasisPoints: basisPoints(count, assignedCount),
    });
  });
  const digest = createHash('sha256');
  for (const item of population) {
    digest.update(item.entry.entryId, 'utf8');
    digest.update('\u0000');
    digest.update(item.entry.revision.toString(), 'utf8');
    digest.update('\u0000');
    digest.update(item.entry.revisionId, 'utf8');
    digest.update('\u0000');
    digest.update(item.predicted ?? '-', 'utf8');
    digest.update('\n');
  }
  return Object.freeze({
    includePrivate,
    populationCount: population.length,
    assignedCount,
    assignedClassCount: byType.filter((item) => item.assignedCount > 0).length,
    coverageBasisPoints: basisPoints(assignedCount, population.length),
    maximumClassShareBasisPoints: Math.max(
      0,
      ...byType.map((item) => item.shareBasisPoints),
    ),
    projectionDigest: digest.digest('hex'),
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
  const featureVersion =
    value.featureVersion === ENTRY_TYPE_LEARNING_FEATURE_VERSION
      ? ENTRY_TYPE_LEARNING_FEATURE_VERSION
      : value.featureVersion === LEGACY_ENTRY_TYPE_LEARNING_FEATURE_VERSION
        ? LEGACY_ENTRY_TYPE_LEARNING_FEATURE_VERSION
        : undefined;
  if (
    value.format !== ENTRY_TYPE_LEARNING_MODEL_FORMAT ||
    value.version !== ENTRY_TYPE_LEARNING_MODEL_VERSION ||
    featureVersion === undefined ||
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
    featureVersion,
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
      [
        'activationPolicyVersion',
        'supportedClassCount',
        'crossValidationFoldCount',
        'targetPrecisionBasisPoints',
        'confusionMatrix',
        'misclassifications',
        'projection',
      ],
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
  const activationPolicyVersion =
    value.activationPolicyVersion === undefined
      ? undefined
      : value.activationPolicyVersion ===
          ENTRY_TYPE_LEARNING_ACTIVATION_POLICY_VERSION
        ? ENTRY_TYPE_LEARNING_ACTIVATION_POLICY_VERSION
        : value.activationPolicyVersion ===
            LEGACY_ENTRY_TYPE_LEARNING_ACTIVATION_POLICY_VERSION
          ? LEGACY_ENTRY_TYPE_LEARNING_ACTIVATION_POLICY_VERSION
          : undefined;
  if (
    value.activationPolicyVersion !== undefined &&
    activationPolicyVersion === undefined
  )
    return undefined;
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
        [
          'trustedExampleCount',
          'trustedSnapshotCount',
          'trainingExampleCount',
          'trainingSnapshotCount',
          'validationSnapshotCount',
          'supported',
        ],
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
    const hardenedCounts = [
      'trustedExampleCount',
      'trustedSnapshotCount',
      'trainingExampleCount',
      'trainingSnapshotCount',
      'validationSnapshotCount',
    ] as const;
    if (
      hardenedCounts.some(
        (key) =>
          item[key] !== undefined &&
          !boundedInteger(item[key], 0, MAXIMUM_ENTRY_TYPE_TRUSTED_EXAMPLES),
      ) ||
      (item.supported !== undefined &&
        item.supported !== true &&
        item.supported !== false)
    )
      return undefined;
    seen.add(item.keyword as string);
    byType.push(
      Object.freeze({
        keyword: item.keyword as LearnedEntryTypeKeyword,
        trustedExampleCount:
          typeof item.trustedExampleCount === 'number'
            ? item.trustedExampleCount
            : 0,
        trustedSnapshotCount:
          typeof item.trustedSnapshotCount === 'number'
            ? item.trustedSnapshotCount
            : 0,
        trainingExampleCount:
          typeof item.trainingExampleCount === 'number'
            ? item.trainingExampleCount
            : 0,
        trainingSnapshotCount:
          typeof item.trainingSnapshotCount === 'number'
            ? item.trainingSnapshotCount
            : 0,
        validationSnapshotCount:
          typeof item.validationSnapshotCount === 'number'
            ? item.validationSnapshotCount
            : 0,
        supported: item.supported === true,
        expectedCount: item.expectedCount as number,
        assignedCount: item.assignedCount as number,
        correctCount: item.correctCount as number,
        precisionBasisPoints: item.precisionBasisPoints as number,
        recallBasisPoints: item.recallBasisPoints as number,
      }),
    );
  }
  const supportedClassCount =
    value.supportedClassCount === undefined
      ? 0
      : boundedInteger(value.supportedClassCount, 0, LEARNED_TYPES.length)
        ? value.supportedClassCount
        : undefined;
  const projection =
    value.projection === undefined
      ? undefined
      : decodeEntryTypeLearningProjection(value.projection);
  const crossValidationFoldCount =
    value.crossValidationFoldCount === undefined
      ? undefined
      : boundedInteger(
            value.crossValidationFoldCount,
            2,
            ENTRY_TYPE_CROSS_VALIDATION_FOLD_COUNT,
          )
        ? value.crossValidationFoldCount
        : undefined;
  const targetPrecisionBasisPoints =
    value.targetPrecisionBasisPoints === undefined
      ? undefined
      : boundedInteger(value.targetPrecisionBasisPoints, 1, 10_000)
        ? value.targetPrecisionBasisPoints
        : undefined;
  const confusionMatrix =
    value.confusionMatrix === undefined
      ? undefined
      : decodeConfusionMatrix(value.confusionMatrix, value.validationCount);
  const misclassifications =
    value.misclassifications === undefined
      ? undefined
      : decodeMisclassifications(value.misclassifications);
  const currentActivation =
    activationPolicyVersion === ENTRY_TYPE_LEARNING_ACTIVATION_POLICY_VERSION;
  if (
    supportedClassCount === undefined ||
    (value.projection !== undefined && projection === undefined) ||
    (value.crossValidationFoldCount !== undefined &&
      crossValidationFoldCount === undefined) ||
    (value.targetPrecisionBasisPoints !== undefined &&
      targetPrecisionBasisPoints === undefined) ||
    (value.confusionMatrix !== undefined && confusionMatrix === undefined) ||
    (value.misclassifications !== undefined &&
      misclassifications === undefined) ||
    (currentActivation &&
      (crossValidationFoldCount !== ENTRY_TYPE_CROSS_VALIDATION_FOLD_COUNT ||
        targetPrecisionBasisPoints !==
          ENTRY_TYPE_TARGET_PRECISION_BASIS_POINTS ||
        confusionMatrix === undefined ||
        misclassifications === undefined)) ||
    (activationPolicyVersion !== undefined &&
      (value.supportedClassCount === undefined ||
        projection === undefined ||
        byType.some(
          (item, index) =>
            ![
              'trustedExampleCount',
              'trustedSnapshotCount',
              'trainingExampleCount',
              'trainingSnapshotCount',
              'validationSnapshotCount',
              'supported',
            ].every((key) =>
              Object.hasOwn(
                (value.byType as readonly Record<string, unknown>[])[index] ??
                  {},
                key,
              ),
            ),
        ) ||
        byType.filter((item) => item.supported).length !== supportedClassCount))
  )
    return undefined;
  return Object.freeze({
    ...(activationPolicyVersion === undefined ? {} : {activationPolicyVersion}),
    trainingCount: value.trainingCount as number,
    validationCount: value.validationCount as number,
    assignedCount: value.assignedCount as number,
    correctCount: value.correctCount as number,
    precisionBasisPoints: value.precisionBasisPoints as number,
    coverageBasisPoints: value.coverageBasisPoints as number,
    supportedClassCount,
    ...(crossValidationFoldCount === undefined
      ? {}
      : {crossValidationFoldCount}),
    ...(targetPrecisionBasisPoints === undefined
      ? {}
      : {targetPrecisionBasisPoints}),
    ...(confusionMatrix === undefined ? {} : {confusionMatrix}),
    ...(misclassifications === undefined ? {} : {misclassifications}),
    ...(projection === undefined ? {} : {projection}),
    activationEligible: value.activationEligible,
    byType: Object.freeze(byType),
  });
}

function decodeConfusionMatrix(
  value: unknown,
  validationCount: unknown,
): readonly Readonly<EntryTypeLearningConfusionCell>[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > LEARNED_TYPES.length * (LEARNED_TYPES.length + 1) ||
    !boundedInteger(validationCount, 1, MAXIMUM_ENTRY_TYPE_TRUSTED_EXAMPLES)
  )
    return undefined;
  const cells: EntryTypeLearningConfusionCell[] = [];
  const identities = new Set<string>();
  let total = 0;
  for (const item of value) {
    if (
      !isRecord(item) ||
      !closedKeys(
        item,
        ['expectedTypeKeyword', 'predictedTypeKeyword', 'count'],
        [],
      ) ||
      !LEARNED_TYPES.includes(
        item.expectedTypeKeyword as LearnedEntryTypeKeyword,
      ) ||
      (item.predictedTypeKeyword !== 'unassigned' &&
        !LEARNED_TYPES.includes(
          item.predictedTypeKeyword as LearnedEntryTypeKeyword,
        )) ||
      !boundedInteger(item.count, 1, MAXIMUM_ENTRY_TYPE_TRUSTED_EXAMPLES)
    )
      return undefined;
    const identity = `${item.expectedTypeKeyword as string}\u0000${item.predictedTypeKeyword as string}`;
    if (identities.has(identity)) return undefined;
    identities.add(identity);
    total += item.count;
    cells.push(
      Object.freeze({
        expectedTypeKeyword:
          item.expectedTypeKeyword as LearnedEntryTypeKeyword,
        predictedTypeKeyword: item.predictedTypeKeyword as
          LearnedEntryTypeKeyword | 'unassigned',
        count: item.count,
      }),
    );
  }
  if (total !== validationCount) return undefined;
  return Object.freeze(cells);
}

function decodeMisclassifications(
  value: unknown,
): readonly Readonly<EntryTypeLearningMisclassification>[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > MAXIMUM_ENTRY_TYPE_MISCLASSIFICATION_SAMPLES
  )
    return undefined;
  const results: EntryTypeLearningMisclassification[] = [];
  const identities = new Set<string>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      !closedKeys(
        item,
        [
          'entryId',
          'entryRevision',
          'snapshotId',
          'expectedTypeKeyword',
          'predictedTypeKeyword',
          'score',
          'margin',
        ],
        [],
      ) ||
      typeof item.entryId !== 'string' ||
      !CANONICAL_UUID.test(item.entryId) ||
      !boundedInteger(item.entryRevision, 1, Number.MAX_SAFE_INTEGER) ||
      typeof item.snapshotId !== 'string' ||
      !CANONICAL_UUID.test(item.snapshotId) ||
      !LEARNED_TYPES.includes(
        item.expectedTypeKeyword as LearnedEntryTypeKeyword,
      ) ||
      !LEARNED_TYPES.includes(
        item.predictedTypeKeyword as LearnedEntryTypeKeyword,
      ) ||
      item.predictedTypeKeyword === item.expectedTypeKeyword ||
      !boundedInteger(item.score, 0, 2_000_000) ||
      !boundedInteger(item.margin, 0, 2_000_000)
    )
      return undefined;
    const identity = `${item.entryId}\u0000${item.entryRevision.toString()}`;
    if (identities.has(identity)) return undefined;
    identities.add(identity);
    results.push(
      Object.freeze({
        entryId: item.entryId,
        entryRevision: item.entryRevision,
        snapshotId: item.snapshotId,
        expectedTypeKeyword:
          item.expectedTypeKeyword as LearnedEntryTypeKeyword,
        predictedTypeKeyword:
          item.predictedTypeKeyword as LearnedEntryTypeKeyword,
        score: item.score,
        margin: item.margin,
      }),
    );
  }
  return Object.freeze(results);
}

function decodeEntryTypeLearningProjection(
  value: unknown,
): Readonly<EntryTypeLearningProjection> | undefined {
  if (
    !isRecord(value) ||
    !closedKeys(
      value,
      [
        'includePrivate',
        'populationCount',
        'assignedCount',
        'assignedClassCount',
        'coverageBasisPoints',
        'maximumClassShareBasisPoints',
        'projectionDigest',
        'byType',
      ],
      [],
    ) ||
    (value.includePrivate !== true && value.includePrivate !== false) ||
    !boundedInteger(value.populationCount, 0, Number.MAX_SAFE_INTEGER) ||
    !boundedInteger(value.assignedCount, 0, Number.MAX_SAFE_INTEGER) ||
    !boundedInteger(value.assignedClassCount, 0, LEARNED_TYPES.length) ||
    !boundedInteger(value.coverageBasisPoints, 0, 10_000) ||
    !boundedInteger(value.maximumClassShareBasisPoints, 0, 10_000) ||
    typeof value.projectionDigest !== 'string' ||
    !SHA256.test(value.projectionDigest) ||
    !Array.isArray(value.byType) ||
    value.byType.length !== LEARNED_TYPES.length ||
    value.assignedCount > value.populationCount ||
    value.coverageBasisPoints !==
      basisPoints(value.assignedCount, value.populationCount)
  )
    return undefined;
  const byType: EntryTypeLearningProjectionByType[] = [];
  const seen = new Set<string>();
  for (const item of value.byType) {
    if (
      !isRecord(item) ||
      !closedKeys(item, ['keyword', 'assignedCount', 'shareBasisPoints'], []) ||
      !LEARNED_TYPES.includes(item.keyword as LearnedEntryTypeKeyword) ||
      seen.has(item.keyword as string) ||
      !boundedInteger(item.assignedCount, 0, Number.MAX_SAFE_INTEGER) ||
      !boundedInteger(item.shareBasisPoints, 0, 10_000) ||
      item.shareBasisPoints !==
        basisPoints(item.assignedCount, value.assignedCount)
    )
      return undefined;
    seen.add(item.keyword as string);
    byType.push(
      Object.freeze({
        keyword: item.keyword as LearnedEntryTypeKeyword,
        assignedCount: item.assignedCount,
        shareBasisPoints: item.shareBasisPoints,
      }),
    );
  }
  if (
    byType.reduce((total, item) => total + item.assignedCount, 0) !==
      value.assignedCount ||
    byType.filter((item) => item.assignedCount > 0).length !==
      value.assignedClassCount ||
    Math.max(0, ...byType.map((item) => item.shareBasisPoints)) !==
      value.maximumClassShareBasisPoints
  )
    return undefined;
  return Object.freeze({
    includePrivate: value.includePrivate,
    populationCount: value.populationCount,
    assignedCount: value.assignedCount,
    assignedClassCount: value.assignedClassCount,
    coverageBasisPoints: value.coverageBasisPoints,
    maximumClassShareBasisPoints: value.maximumClassShareBasisPoints,
    projectionDigest: value.projectionDigest,
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
      ...(model.evaluation.confusionMatrix === undefined
        ? {}
        : {
            confusionMatrix: Object.freeze(
              model.evaluation.confusionMatrix.map((item) =>
                Object.freeze({...item}),
              ),
            ),
          }),
      ...(model.evaluation.misclassifications === undefined
        ? {}
        : {
            misclassifications: Object.freeze(
              model.evaluation.misclassifications.map((item) =>
                Object.freeze({...item}),
              ),
            ),
          }),
      ...(model.evaluation.projection === undefined
        ? {}
        : {
            projection: Object.freeze({
              ...model.evaluation.projection,
              byType: Object.freeze(
                model.evaluation.projection.byType.map((item) =>
                  Object.freeze({...item}),
                ),
              ),
            }),
          }),
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
    'model_disagreement',
    'model_low_margin',
    'missing_type',
    'other_type',
    'untrusted_existing_type',
  ].indexOf(reason);
}

function isLearnedType(
  value: EntryTypeKeyword | undefined,
): value is LearnedEntryTypeKeyword {
  return value !== undefined && value !== 'other';
}

function stableHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeFeatureValue(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('und').trim().slice(0, 96);
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
