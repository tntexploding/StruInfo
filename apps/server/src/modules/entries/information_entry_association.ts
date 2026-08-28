import type {CurrentInformationEntry} from './information_entry_contract.js';
import {
  type InformationEntryAssociationAction,
  type InformationEntryAssociationBasis,
  type InformationEntryAssociationOverrideValue,
  type InformationEntryAssociationPolicy,
  type InformationEntryAssociationProjection,
  type InformationEntryAssociationRepositorySnapshot,
  type InformationEntryAssociationView,
} from './information_entry_association_contract.js';
import {informationEntrySearchKey} from './information_entry.js';

export const INFORMATION_ENTRY_ASSOCIATION_POLICY: Readonly<InformationEntryAssociationPolicy> =
  Object.freeze({
    revision: 0,
    version: 'struinfo.entry-association.local-index.v1',
    contentWeight: 65,
    typeWeight: 15,
    domainWeight: 20,
    threshold: 1_100,
    candidateLimit: 12,
    adjustmentStep: 1_500,
  });

const SCORE_SCALE = 10_000;
const MAXIMUM_INDEX_BUCKET = 64;
const MAXIMUM_TEXT_TERMS = 256;
const STRUCTURAL_TERMS = new Set([
  'com',
  'github',
  'http',
  'https',
  'jpeg',
  'jpg',
  'markdown',
  'md',
  'net',
  'org',
  'png',
  'www',
]);

interface EntryFeatures {
  readonly entry: Readonly<CurrentInformationEntry>;
  readonly contentKeywords: ReadonlySet<string>;
  readonly textTerms: ReadonlySet<string>;
  readonly typeIdentity?: string;
  readonly domainIdentities: ReadonlySet<string>;
  readonly indexKeys: ReadonlySet<string>;
}

interface ScoredCandidate {
  readonly candidateIndex: number;
  readonly contentSimilarity: number;
  readonly typeSimilarity: number;
  readonly domainSimilarity: number;
  readonly baseScore: number;
  readonly candidateBasis: readonly InformationEntryAssociationBasis[];
}

export interface InformationEntryAssociationReadIndex {
  list(entryId: string): readonly Readonly<InformationEntryAssociationView>[];
}

interface InformationEntryAssociationReadSource {
  readonly entriesById: ReadonlyMap<string, Readonly<CurrentInformationEntry>>;
  readonly projections: ReadonlyMap<
    string,
    Readonly<InformationEntryAssociationProjection>
  >;
  readonly overrides: ReadonlyMap<
    string,
    Readonly<InformationEntryAssociationRepositorySnapshot['overrides'][number]>
  >;
  readonly pairKeys: readonly string[];
}

const EMPTY_ASSOCIATION_VIEWS: readonly Readonly<InformationEntryAssociationView>[] =
  Object.freeze([]);

export function buildInformationEntryAssociationProjection(
  entries: readonly Readonly<CurrentInformationEntry>[],
  policy: Readonly<InformationEntryAssociationPolicy> = INFORMATION_ENTRY_ASSOCIATION_POLICY,
): readonly Readonly<InformationEntryAssociationProjection>[] {
  if (entries.length < 2) return Object.freeze([]);
  assertPolicy(policy);
  const workspaceId = entries[0]?.workspaceId;
  if (
    workspaceId === undefined ||
    entries.some((entry) => entry.workspaceId !== workspaceId)
  ) {
    throw new Error('Information Entry association workspace is invalid.');
  }

  const features = entries
    .map(createEntryFeatures)
    .sort((left, right) =>
      left.entry.entryId.localeCompare(right.entry.entryId),
    );
  const index = buildCandidateIndex(features);
  const selectedPairs = new Map<
    string,
    Readonly<InformationEntryAssociationProjection>
  >();

  for (const [sourceIndex, source] of features.entries()) {
    const candidateIndexes = new Set<number>();
    for (const key of source.indexKeys) {
      const bucket = index.get(key);
      if (bucket === undefined || bucket.length > MAXIMUM_INDEX_BUCKET)
        continue;
      for (const candidateIndex of bucket) {
        if (candidateIndex !== sourceIndex)
          candidateIndexes.add(candidateIndex);
      }
    }
    const candidates = [...candidateIndexes]
      .map((candidateIndex) =>
        scoreCandidate(
          source,
          features[candidateIndex],
          candidateIndex,
          policy,
        ),
      )
      .filter(
        (candidate): candidate is ScoredCandidate =>
          candidate !== undefined && candidate.baseScore >= policy.threshold,
      )
      .sort((left, right) =>
        left.baseScore !== right.baseScore
          ? right.baseScore - left.baseScore
          : (features[left.candidateIndex]?.entry.entryId.localeCompare(
              features[right.candidateIndex]?.entry.entryId ?? '',
            ) ?? 0),
      )
      .slice(0, policy.candidateLimit);

    for (const [rankIndex, candidate] of candidates.entries()) {
      const target = features[candidate.candidateIndex];
      if (target === undefined) continue;
      const projection = createProjection(
        source.entry,
        target.entry,
        candidate,
        rankIndex + 1,
        policy.version,
      );
      const pairKey = associationPairKey(
        projection.entryLowId,
        projection.entryHighId,
      );
      const previous = selectedPairs.get(pairKey);
      selectedPairs.set(
        pairKey,
        previous === undefined ||
          projection.baseScore > previous.baseScore ||
          (projection.baseScore === previous.baseScore &&
            projection.candidateRank < previous.candidateRank)
          ? projection
          : previous,
      );
    }
  }

  return Object.freeze(
    [...selectedPairs.values()].sort((left, right) =>
      left.entryLowId !== right.entryLowId
        ? left.entryLowId.localeCompare(right.entryLowId)
        : left.entryHighId.localeCompare(right.entryHighId),
    ),
  );
}

export function prepareInformationEntryAssociationOverride(
  action: InformationEntryAssociationAction,
  policy: Readonly<InformationEntryAssociationPolicy> = INFORMATION_ENTRY_ASSOCIATION_POLICY,
): Readonly<InformationEntryAssociationOverrideValue> {
  assertPolicy(policy);
  switch (action) {
    case 'enhance':
      return Object.freeze({
        action,
        manualAdjustment: policy.adjustmentStep,
        isBlocked: false,
      });
    case 'weaken':
      return Object.freeze({
        action,
        manualAdjustment: -policy.adjustmentStep,
        isBlocked: false,
      });
    case 'block':
      return Object.freeze({action, manualAdjustment: 0, isBlocked: true});
    case 'restore':
      return Object.freeze({action, manualAdjustment: 0, isBlocked: false});
  }
}

export function listInformationEntryAssociations(
  entryId: string,
  entries: readonly Readonly<CurrentInformationEntry>[],
  snapshot: Readonly<InformationEntryAssociationRepositorySnapshot>,
): readonly Readonly<InformationEntryAssociationView>[] {
  const source = prepareAssociationReadSource(entries, snapshot);
  return buildAssociationViews(entryId, source, source.pairKeys);
}

export function prepareInformationEntryAssociationReadIndex(
  entries: readonly Readonly<CurrentInformationEntry>[],
  snapshot: Readonly<InformationEntryAssociationRepositorySnapshot>,
): Readonly<InformationEntryAssociationReadIndex> {
  const source = prepareAssociationReadSource(entries, snapshot);
  const pairKeysByEntryId = new Map<string, string[]>();
  for (const pairKey of source.pairKeys) {
    const projection = source.projections.get(pairKey);
    const override = source.overrides.get(pairKey);
    const lowId = projection?.entryLowId ?? override?.entryLowId;
    const highId = projection?.entryHighId ?? override?.entryHighId;
    if (lowId === undefined || highId === undefined) continue;
    pushAssociationPairKey(pairKeysByEntryId, lowId, pairKey);
    pushAssociationPairKey(pairKeysByEntryId, highId, pairKey);
  }
  const cache = new Map<
    string,
    readonly Readonly<InformationEntryAssociationView>[]
  >();
  return Object.freeze({
    list(entryId: string) {
      const existing = cache.get(entryId);
      if (existing !== undefined) return existing;
      const views = buildAssociationViews(
        entryId,
        source,
        pairKeysByEntryId.get(entryId) ?? [],
      );
      cache.set(entryId, views);
      return views;
    },
  });
}

function prepareAssociationReadSource(
  entries: readonly Readonly<CurrentInformationEntry>[],
  snapshot: Readonly<InformationEntryAssociationRepositorySnapshot>,
): Readonly<InformationEntryAssociationReadSource> {
  const entriesById = new Map(entries.map((entry) => [entry.entryId, entry]));
  const projections = new Map(
    snapshot.projections
      .filter((projection) => projectionMatchesCurrent(projection, entriesById))
      .map((projection) => [
        associationPairKey(projection.entryLowId, projection.entryHighId),
        projection,
      ]),
  );
  const overrides = new Map(
    snapshot.overrides.map((override) => [
      associationPairKey(override.entryLowId, override.entryHighId),
      override,
    ]),
  );
  return Object.freeze({
    entriesById,
    projections,
    overrides,
    pairKeys: Object.freeze([
      ...new Set([...projections.keys(), ...overrides.keys()]),
    ]),
  });
}

function buildAssociationViews(
  entryId: string,
  source: Readonly<InformationEntryAssociationReadSource>,
  pairKeys: readonly string[],
): readonly Readonly<InformationEntryAssociationView>[] {
  if (!source.entriesById.has(entryId)) return EMPTY_ASSOCIATION_VIEWS;
  const views: InformationEntryAssociationView[] = [];
  for (const pairKey of pairKeys) {
    const projection = source.projections.get(pairKey);
    const override = source.overrides.get(pairKey);
    const lowId = projection?.entryLowId ?? override?.entryLowId;
    const highId = projection?.entryHighId ?? override?.entryHighId;
    if (lowId === undefined || highId === undefined) continue;
    if (entryId !== lowId && entryId !== highId) continue;
    if (
      projection === undefined &&
      override?.value.action === 'restore' &&
      override.value.graph === undefined
    ) {
      continue;
    }
    const relatedEntry = source.entriesById.get(
      entryId === lowId ? highId : lowId,
    );
    if (relatedEntry === undefined) continue;
    const isBlocked = override?.value.isBlocked === true;
    const effectiveScore = isBlocked
      ? 0
      : clampScore(
          (projection?.baseScore ?? 0) +
            (override?.value.manualAdjustment ?? 0),
        );
    views.push(
      Object.freeze({
        relatedEntry,
        ...(projection === undefined ? {} : {projection}),
        ...(override === undefined ? {} : {override}),
        effectiveScore,
        isBlocked,
      }),
    );
  }
  return Object.freeze(views.sort(compareAssociationViews));
}

export function orderedInformationEntryAssociationPair(
  firstEntryId: string,
  secondEntryId: string,
): Readonly<{entryLowId: string; entryHighId: string}> | undefined {
  if (firstEntryId === secondEntryId) return undefined;
  return firstEntryId.localeCompare(secondEntryId) < 0
    ? Object.freeze({entryLowId: firstEntryId, entryHighId: secondEntryId})
    : Object.freeze({entryLowId: secondEntryId, entryHighId: firstEntryId});
}

function createEntryFeatures(
  entry: Readonly<CurrentInformationEntry>,
): EntryFeatures {
  const contentKeywords = new Set(
    entry.value.contentKeywords.map((value) => value.normalizedValue),
  );
  const textTerms = buildTextTerms(
    `${entry.value.titlePath}\n${entry.value.body}`,
  );
  const typeIdentity =
    entry.value.typeKeyword === undefined
      ? undefined
      : entry.value.typeKeyword === 'other'
        ? entry.value.typeCustomName === undefined
          ? undefined
          : `other:${informationEntrySearchKey(entry.value.typeCustomName)}`
        : entry.value.typeKeyword;
  const domainIdentities = new Set(
    entry.value.domains.flatMap((domain) =>
      domain.keyword === 'other'
        ? domain.customName === undefined
          ? []
          : [`other:${informationEntrySearchKey(domain.customName)}`]
        : [domain.keyword],
    ),
  );
  const indexKeys = new Set<string>();
  for (const value of contentKeywords) indexKeys.add(`keyword:${value}`);
  for (const value of textTerms) indexKeys.add(`text:${value}`);
  if (typeIdentity !== undefined) indexKeys.add(`type:${typeIdentity}`);
  for (const value of domainIdentities) indexKeys.add(`domain:${value}`);
  return Object.freeze({
    entry,
    contentKeywords,
    textTerms,
    ...(typeIdentity === undefined ? {} : {typeIdentity}),
    domainIdentities,
    indexKeys,
  });
}

function buildCandidateIndex(
  features: readonly EntryFeatures[],
): ReadonlyMap<string, readonly number[]> {
  const index = new Map<string, number[]>();
  for (const [entryIndex, entry] of features.entries()) {
    for (const key of entry.indexKeys) {
      const bucket = index.get(key) ?? [];
      bucket.push(entryIndex);
      index.set(key, bucket);
    }
  }
  return index;
}

function scoreCandidate(
  source: EntryFeatures,
  target: EntryFeatures | undefined,
  candidateIndex: number,
  policy: Readonly<InformationEntryAssociationPolicy>,
): ScoredCandidate | undefined {
  if (target === undefined) return undefined;
  const keywordIntersection = intersectionSize(
    source.contentKeywords,
    target.contentKeywords,
  );
  const textIntersection = intersectionSize(source.textTerms, target.textTerms);
  if (keywordIntersection === 0 && textIntersection === 0) return undefined;

  const keywordSimilarity = jaccard(
    source.contentKeywords,
    target.contentKeywords,
  );
  const textSimilarity = jaccard(source.textTerms, target.textTerms);
  const contentSimilarity =
    source.contentKeywords.size > 0 && target.contentKeywords.size > 0
      ? Math.round(keywordSimilarity * 0.75 + textSimilarity * 0.25)
      : textSimilarity;
  const typeSimilarity =
    source.typeIdentity !== undefined &&
    source.typeIdentity === target.typeIdentity
      ? SCORE_SCALE
      : 0;
  const domainSimilarity = jaccard(
    source.domainIdentities,
    target.domainIdentities,
  );
  const baseScore = Math.round(
    (contentSimilarity * policy.contentWeight +
      typeSimilarity * policy.typeWeight +
      domainSimilarity * policy.domainWeight) /
      100,
  );
  const candidateBasis: InformationEntryAssociationBasis[] = [];
  if (keywordIntersection > 0) {
    candidateBasis.push('content_keyword');
  }
  if (textIntersection > 0) {
    candidateBasis.push('text_term');
  }
  if (typeSimilarity > 0) candidateBasis.push('type_keyword');
  if (domainSimilarity > 0) candidateBasis.push('domain_keyword');
  return Object.freeze({
    candidateIndex,
    contentSimilarity,
    typeSimilarity,
    domainSimilarity,
    baseScore,
    candidateBasis: Object.freeze(candidateBasis),
  });
}

function createProjection(
  first: Readonly<CurrentInformationEntry>,
  second: Readonly<CurrentInformationEntry>,
  candidate: ScoredCandidate,
  candidateRank: number,
  algorithmVersion: string,
): Readonly<InformationEntryAssociationProjection> {
  const pair = orderedInformationEntryAssociationPair(
    first.entryId,
    second.entryId,
  );
  if (pair === undefined) throw new Error('Association endpoints are invalid.');
  const low = pair.entryLowId === first.entryId ? first : second;
  const high = pair.entryHighId === first.entryId ? first : second;
  return Object.freeze({
    workspaceId: first.workspaceId,
    entryLowId: low.entryId,
    entryHighId: high.entryId,
    entryLowRevision: low.revision,
    entryLowRevisionId: low.revisionId,
    entryHighRevision: high.revision,
    entryHighRevisionId: high.revisionId,
    contentSimilarity: candidate.contentSimilarity,
    typeSimilarity: candidate.typeSimilarity,
    domainSimilarity: candidate.domainSimilarity,
    baseScore: candidate.baseScore,
    algorithmVersion,
    candidateBasis: candidate.candidateBasis,
    candidateRank,
  });
}

function buildTextTerms(value: string): ReadonlySet<string> {
  const normalized = informationEntrySearchKey(value);
  const terms = new Set<string>();
  for (const match of normalized.matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = match[0];
    if (STRUCTURAL_TERMS.has(token) || /^\p{N}+$/u.test(token)) continue;
    const codePoints = Array.from(token);
    if (/\p{Script=Han}/u.test(token)) {
      if (codePoints.length === 1) terms.add(`han:${token}`);
      for (let index = 0; index + 1 < codePoints.length; index += 1) {
        terms.add(`han:${codePoints.slice(index, index + 2).join('')}`);
        if (terms.size >= MAXIMUM_TEXT_TERMS) return terms;
      }
    } else if (codePoints.length >= 2 && codePoints.length <= 64) {
      terms.add(`word:${token}`);
    }
    if (terms.size >= MAXIMUM_TEXT_TERMS) return terms;
  }
  return terms;
}

function jaccard(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = intersectionSize(left, right);
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : Math.round((intersection * SCORE_SCALE) / union);
}

function intersectionSize(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  let result = 0;
  const [small, large] =
    left.size <= right.size ? [left, right] : [right, left];
  for (const value of small) {
    if (large.has(value)) result += 1;
  }
  return result;
}

function projectionMatchesCurrent(
  projection: Readonly<InformationEntryAssociationProjection>,
  entries: ReadonlyMap<string, Readonly<CurrentInformationEntry>>,
): boolean {
  const low = entries.get(projection.entryLowId);
  const high = entries.get(projection.entryHighId);
  return (
    low?.revision === projection.entryLowRevision &&
    low.revisionId === projection.entryLowRevisionId &&
    high?.revision === projection.entryHighRevision &&
    high.revisionId === projection.entryHighRevisionId
  );
}

function associationPairKey(entryLowId: string, entryHighId: string): string {
  return `${entryLowId}:${entryHighId}`;
}

function pushAssociationPairKey(
  pairKeysByEntryId: Map<string, string[]>,
  entryId: string,
  pairKey: string,
): void {
  const pairKeys = pairKeysByEntryId.get(entryId) ?? [];
  pairKeys.push(pairKey);
  pairKeysByEntryId.set(entryId, pairKeys);
}

function compareAssociationViews(
  left: Readonly<InformationEntryAssociationView>,
  right: Readonly<InformationEntryAssociationView>,
): number {
  return left.isBlocked !== right.isBlocked
    ? left.isBlocked
      ? 1
      : -1
    : left.effectiveScore !== right.effectiveScore
      ? right.effectiveScore - left.effectiveScore
      : left.relatedEntry.entryId.localeCompare(right.relatedEntry.entryId);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(SCORE_SCALE, value));
}

function assertPolicy(
  policy: Readonly<InformationEntryAssociationPolicy>,
): void {
  if (
    !Number.isSafeInteger(policy.revision) ||
    policy.revision < 0 ||
    !Number.isSafeInteger(policy.contentWeight) ||
    !Number.isSafeInteger(policy.typeWeight) ||
    !Number.isSafeInteger(policy.domainWeight) ||
    policy.contentWeight < 0 ||
    policy.typeWeight < 0 ||
    policy.domainWeight < 0 ||
    policy.contentWeight + policy.typeWeight + policy.domainWeight !== 100 ||
    !Number.isSafeInteger(policy.threshold) ||
    policy.threshold < 0 ||
    policy.threshold > SCORE_SCALE ||
    !Number.isSafeInteger(policy.candidateLimit) ||
    policy.candidateLimit < 1 ||
    policy.adjustmentStep < 1 ||
    policy.adjustmentStep > SCORE_SCALE ||
    policy.version.trim() === ''
  ) {
    throw new Error('Information Entry association policy is invalid.');
  }
}
