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
export const ENTRY_TYPE_LEARNING_ACTIVATION_POLICY_VERSION =
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

export interface EntryTypeLearningEvaluation {
  readonly activationPolicyVersion?: typeof ENTRY_TYPE_LEARNING_ACTIVATION_POLICY_VERSION;
  readonly trainingCount: number;
  readonly validationCount: number;
  readonly assignedCount: number;
  readonly correctCount: number;
  readonly precisionBasisPoints: number;
  readonly coverageBasisPoints: number;
  readonly supportedClassCount: number;
  readonly projection?: Readonly<EntryTypeLearningProjection>;
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
  const initiallySupported = new Set(
    LEARNED_TYPES.filter((keyword) =>
      hasFullClassSupport(allSupport.get(keyword)),
    ),
  );
  const validationSnapshots = selectValidationSnapshots(
    rows,
    initiallySupported,
  );
  const trainingRows = rows.filter(
    (row) => !validationSnapshots.has(row.entry.snapshotId),
  );
  const validationRows = rows.filter((row) =>
    validationSnapshots.has(row.entry.snapshotId),
  );
  if (trainingRows.length < 2 || validationRows.length < 1) return undefined;

  const trainingSupport = supportByType(trainingRows.map((row) => row.example));
  const validationSupport = supportByType(
    validationRows.map((row) => row.example),
  );
  const supportedTypes = new Set(
    LEARNED_TYPES.filter(
      (keyword) =>
        hasFullClassSupport(allSupport.get(keyword)) &&
        hasTrainingClassSupport(trainingSupport.get(keyword)) &&
        hasValidationClassSupport(validationSupport.get(keyword)),
    ),
  );
  const calibrationClasses = buildClasses(
    limitRowsPerType(trainingRows),
    supportedTypes,
  );
  const classes = buildClasses(
    limitRowsPerType(rows),
    supportedTypes,
    calibrationClasses,
  );
  const projection = projectEntryTypes(classes, entries, input.includePrivate);
  const evaluation = evaluateRows(
    calibrationClasses,
    validationRows,
    trainingRows.length,
    allSupport,
    trainingSupport,
    validationSupport,
    supportedTypes,
    projection,
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
    model?.evaluation.activationPolicyVersion !==
      ENTRY_TYPE_LEARNING_ACTIVATION_POLICY_VERSION ||
    !model.evaluation.activationEligible ||
    model.evaluation.supportedClassCount <
      MINIMUM_ENTRY_TYPE_SUPPORTED_CLASSES ||
    model.evaluation.precisionBasisPoints < 9_200 ||
    model.evaluation.coverageBasisPoints <
      MINIMUM_ENTRY_TYPE_VALIDATION_COVERAGE_BASIS_POINTS
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
        item.precisionBasisPoints >= 8_500,
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

function samplingModel(
  state: Readonly<EntryTypeLearningState>,
): Readonly<EntryTypeLearningModel> | undefined {
  if (
    state.candidateModel?.evaluation.activationPolicyVersion ===
    ENTRY_TYPE_LEARNING_ACTIVATION_POLICY_VERSION
  ) {
    return state.candidateModel;
  }
  return state.activeModel?.evaluation.activationPolicyVersion ===
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
  const features = featuresForEntry(entry);
  return Object.freeze(
    model.classes
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

function hasTrainingClassSupport(
  support: Readonly<EntryTypeSupport> | undefined,
): boolean {
  return (
    (support?.exampleCount ?? 0) >= MINIMUM_ENTRY_TYPE_TRAINING_EXAMPLES &&
    (support?.snapshotCount ?? 0) >= MINIMUM_ENTRY_TYPE_TRAINING_SNAPSHOTS
  );
}

function hasValidationClassSupport(
  support: Readonly<EntryTypeSupport> | undefined,
): boolean {
  return (
    (support?.exampleCount ?? 0) >= MINIMUM_ENTRY_TYPE_VALIDATION_EXAMPLES &&
    (support?.snapshotCount ?? 0) >= MINIMUM_ENTRY_TYPE_VALIDATION_SNAPSHOTS
  );
}

function limitRowsPerType(
  rows: readonly Readonly<EntryTypeLearningRow>[],
): readonly Readonly<EntryTypeLearningRow>[] {
  return Object.freeze(
    LEARNED_TYPES.flatMap((keyword) =>
      rows
        .filter((row) => row.example.typeKeyword === keyword)
        .sort(
          (left, right) =>
            stableHash(left.entry.snapshotId).localeCompare(
              stableHash(right.entry.snapshotId),
            ) ||
            left.entry.value.documentOrder - right.entry.value.documentOrder ||
            left.entry.entryId.localeCompare(right.entry.entryId),
        )
        .slice(0, MAXIMUM_ENTRY_TYPE_TRAINING_EXAMPLES_PER_CLASS),
    ),
  );
}

function buildClasses(
  rows: readonly Readonly<EntryTypeLearningRow>[],
  supportedTypes: ReadonlySet<LearnedEntryTypeKeyword>,
  calibration?: readonly Readonly<EntryTypeClassModel>[],
): readonly Readonly<EntryTypeClassModel>[] {
  const allFeatures = new Set<string>();
  for (const row of rows)
    for (const feature of row.features) allFeatures.add(feature);
  return Object.freeze(
    LEARNED_TYPES.map((keyword) => {
      if (!supportedTypes.has(keyword)) {
        return Object.freeze({
          keyword,
          minimumScore: DISABLED_ENTRY_TYPE_SCORE,
          minimumMargin: DISABLED_ENTRY_TYPE_SCORE,
          features: Object.freeze([]),
        });
      }
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
          const positiveRate =
            positive.length === 0
              ? 0
              : Math.floor((positiveCount * 10_000) / positive.length);
          const negativeRate =
            negative.length === 0
              ? 0
              : Math.floor((negativeCount * 10_000) / negative.length);
          return Object.freeze({
            feature,
            weight: Math.min(
              MAXIMUM_ENTRY_TYPE_FEATURE_WEIGHT,
              positiveRate - negativeRate,
            ),
          });
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
  rows: readonly Readonly<EntryTypeLearningRow>[],
  trainingCount: number,
  allSupport: ReadonlyMap<LearnedEntryTypeKeyword, EntryTypeSupport>,
  trainingSupport: ReadonlyMap<LearnedEntryTypeKeyword, EntryTypeSupport>,
  validationSupport: ReadonlyMap<LearnedEntryTypeKeyword, EntryTypeSupport>,
  supportedTypes: ReadonlySet<LearnedEntryTypeKeyword>,
  projection: Readonly<EntryTypeLearningProjection>,
): Readonly<EntryTypeLearningEvaluation> {
  const model = Object.freeze({
    format: ENTRY_TYPE_LEARNING_MODEL_FORMAT,
    version: ENTRY_TYPE_LEARNING_MODEL_VERSION,
    featureVersion: ENTRY_TYPE_LEARNING_FEATURE_VERSION,
    trainingDigest: '0'.repeat(64),
    classes,
    evaluation: {
      trainingCount: 0,
      validationCount: 0,
      assignedCount: 0,
      correctCount: 0,
      precisionBasisPoints: 0,
      coverageBasisPoints: 0,
      supportedClassCount: 0,
      activationEligible: false,
      byType: Object.freeze([]),
    },
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
  const coverageBasisPoints = basisPoints(assignedCount, rows.length);
  const supportedClassCount = supportedTypes.size;
  const activationEligible =
    supportedClassCount >= MINIMUM_ENTRY_TYPE_SUPPORTED_CLASSES &&
    rows.length >=
      supportedClassCount * MINIMUM_ENTRY_TYPE_VALIDATION_EXAMPLES &&
    assignedCount >= 1 &&
    precisionBasisPoints >= 9_200 &&
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
          item.precisionBasisPoints >= 8_500,
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
    validationCount: rows.length,
    assignedCount,
    correctCount,
    precisionBasisPoints,
    coverageBasisPoints,
    supportedClassCount,
    projection,
    activationEligible,
    byType: Object.freeze(byType),
  });
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

function selectValidationSnapshots(
  rows: readonly Readonly<EntryTypeLearningRow>[],
  supportedTypes: ReadonlySet<LearnedEntryTypeKeyword>,
): ReadonlySet<string> {
  const selected = new Set<string>();
  for (const keyword of LEARNED_TYPES) {
    if (!supportedTypes.has(keyword)) continue;
    const snapshots = [
      ...new Set(
        rows
          .filter((row) => row.example.typeKeyword === keyword)
          .map((row) => row.entry.snapshotId),
      ),
    ].sort((left, right) => stableHash(left).localeCompare(stableHash(right)));
    for (const snapshotId of snapshots.slice(
      0,
      MINIMUM_ENTRY_TYPE_VALIDATION_SNAPSHOTS,
    )) {
      selected.add(snapshotId);
    }
  }
  if (selected.size > 0) return selected;
  const unique = [...new Set(rows.map((row) => row.entry.snapshotId))].sort(
    (left, right) => stableHash(left).localeCompare(stableHash(right)),
  );
  return new Set(unique.slice(0, Math.max(1, Math.floor(unique.length / 5))));
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
      ['activationPolicyVersion', 'supportedClassCount', 'projection'],
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
  if (
    supportedClassCount === undefined ||
    (value.projection !== undefined && projection === undefined) ||
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
    ...(projection === undefined ? {} : {projection}),
    activationEligible: value.activationEligible,
    byType: Object.freeze(byType),
  });
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
