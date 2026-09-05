import type {
  CurrentInformationEntry,
  EntryDomainKeyword,
  EntryTypeKeyword,
} from './information_entry_contract.js';
import {
  DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY,
  type DeterministicEntryClassificationNeighborEvidence,
  type EntryClassificationNeighborEvidence,
  type EntryClassificationNeighborPolicy,
} from './information_entry_deterministic_classification.js';

type ClassifiedType = Exclude<EntryTypeKeyword, 'other'>;
type ClassifiedDomain = Exclude<EntryDomainKeyword, 'other'>;

interface ReferenceEntry {
  readonly entry: Readonly<CurrentInformationEntry>;
  readonly keywords: ReadonlySet<string>;
}

interface RankedReference extends ReferenceEntry {
  readonly sharedKeywordCount: number;
  readonly similarityBasisPoints: number;
}

export interface InformationEntryClassificationContext {
  readonly referenceEntryCount: number;
  evidenceFor(
    entry: Readonly<CurrentInformationEntry>,
  ): Readonly<DeterministicEntryClassificationNeighborEvidence>;
}

export function buildInformationEntryClassificationContext(
  entries: readonly Readonly<CurrentInformationEntry>[],
  policy: Readonly<EntryClassificationNeighborPolicy> = DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY,
): Readonly<InformationEntryClassificationContext> {
  const references = entries.map((entry) =>
    Object.freeze({entry, keywords: entryKeywords(entry)}),
  );
  const byKeyword = new Map<string, ReferenceEntry[]>();
  for (const reference of references) {
    for (const keyword of reference.keywords) {
      const bucket = byKeyword.get(keyword) ?? [];
      bucket.push(reference);
      byKeyword.set(keyword, bucket);
    }
  }
  const usableByKeyword = new Map<string, readonly ReferenceEntry[]>();
  for (const [keyword, bucket] of byKeyword) {
    if (bucket.length <= policy.maximumReferencesPerKeyword) {
      usableByKeyword.set(
        keyword,
        Object.freeze(
          [...bucket].sort((left, right) =>
            left.entry.entryId.localeCompare(right.entry.entryId),
          ),
        ),
      );
    }
  }

  return Object.freeze({
    referenceEntryCount: references.length,
    evidenceFor: (entry: Readonly<CurrentInformationEntry>) =>
      policy.enabled
        ? evidenceFor(entry, usableByKeyword, policy)
        : EMPTY_NEIGHBOR_EVIDENCE,
  });
}

const EMPTY_NEIGHBOR_EVIDENCE: Readonly<DeterministicEntryClassificationNeighborEvidence> =
  Object.freeze({domains: Object.freeze([])});

function evidenceFor(
  entry: Readonly<CurrentInformationEntry>,
  byKeyword: ReadonlyMap<string, readonly ReferenceEntry[]>,
  policy: Readonly<EntryClassificationNeighborPolicy>,
): Readonly<DeterministicEntryClassificationNeighborEvidence> {
  const keywords = entryKeywords(entry);
  if (keywords.size === 0) return EMPTY_NEIGHBOR_EVIDENCE;
  const sharedCounts = new Map<
    string,
    {reference: ReferenceEntry; count: number}
  >();
  for (const keyword of keywords) {
    for (const reference of byKeyword.get(keyword) ?? []) {
      if (
        reference.entry.entryId === entry.entryId ||
        reference.entry.value.isPrivate !== entry.value.isPrivate
      ) {
        continue;
      }
      const current = sharedCounts.get(reference.entry.entryId);
      sharedCounts.set(reference.entry.entryId, {
        reference,
        count: (current?.count ?? 0) + 1,
      });
    }
  }
  const ranked = [...sharedCounts.values()]
    .map(({reference, count}) => {
      const unionSize = keywords.size + reference.keywords.size - count;
      return Object.freeze({
        ...reference,
        sharedKeywordCount: count,
        similarityBasisPoints:
          unionSize === 0 ? 0 : Math.floor((count * 10_000) / unionSize),
      });
    })
    .filter(
      (reference) =>
        reference.sharedKeywordCount >= policy.minimumSharedKeywordCount &&
        reference.similarityBasisPoints >= policy.minimumSimilarityBasisPoints,
    )
    .sort(
      (left, right) =>
        right.sharedKeywordCount - left.sharedKeywordCount ||
        right.similarityBasisPoints - left.similarityBasisPoints ||
        left.entry.entryId.localeCompare(right.entry.entryId),
    );

  const typeReferences = ranked
    .filter(
      (reference) =>
        reference.entry.snapshotId !== entry.snapshotId &&
        reference.entry.value.typeKeyword !== undefined &&
        reference.entry.value.typeKeyword !== 'other',
    )
    .slice(0, policy.maximumNeighbors);
  const domainReferences = ranked
    .filter((reference) =>
      reference.entry.value.domains.some(
        (domain) => domain.keyword !== 'other',
      ),
    )
    .slice(0, policy.maximumNeighbors);
  const type = consensusType(typeReferences, policy);
  const domains = consensusDomains(domainReferences, policy);
  return Object.freeze({
    ...(type === undefined ? {} : {type}),
    domains,
  });
}

function consensusType(
  references: readonly Readonly<RankedReference>[],
  policy: Readonly<EntryClassificationNeighborPolicy>,
): Readonly<EntryClassificationNeighborEvidence<ClassifiedType>> | undefined {
  if (references.length < policy.minimumReferenceCount) return undefined;
  const counts = new Map<ClassifiedType, number>();
  for (const reference of references) {
    const keyword = reference.entry.value.typeKeyword;
    if (keyword !== undefined && keyword !== 'other') {
      counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
    }
  }
  const ordered = [...counts.entries()].sort(
    ([leftKeyword, leftCount], [rightKeyword, rightCount]) =>
      rightCount - leftCount || leftKeyword.localeCompare(rightKeyword),
  );
  const first = ordered[0];
  const second = ordered[1];
  if (first === undefined || first[1] === second?.[1]) return undefined;
  const consensusBasisPoints = Math.floor(
    (first[1] * 10_000) / references.length,
  );
  return consensusBasisPoints < policy.minimumConsensusBasisPoints
    ? undefined
    : Object.freeze({
        keyword: first[0],
        referenceCount: references.length,
        consensusBasisPoints,
        score: policy.evidenceScore,
      });
}

function consensusDomains(
  references: readonly Readonly<RankedReference>[],
  policy: Readonly<EntryClassificationNeighborPolicy>,
): readonly Readonly<EntryClassificationNeighborEvidence<ClassifiedDomain>>[] {
  if (references.length < policy.minimumReferenceCount) {
    return Object.freeze([]);
  }
  const counts = new Map<ClassifiedDomain, number>();
  for (const reference of references) {
    for (const domain of reference.entry.value.domains) {
      if (domain.keyword !== 'other') {
        counts.set(domain.keyword, (counts.get(domain.keyword) ?? 0) + 1);
      }
    }
  }
  return Object.freeze(
    [...counts.entries()]
      .map(([keyword, count]) =>
        Object.freeze({
          keyword,
          referenceCount: references.length,
          consensusBasisPoints: Math.floor(
            (count * 10_000) / references.length,
          ),
          score: policy.evidenceScore,
        }),
      )
      .filter(
        (candidate) =>
          candidate.consensusBasisPoints >= policy.minimumConsensusBasisPoints,
      )
      .sort(
        (left, right) =>
          right.consensusBasisPoints - left.consensusBasisPoints ||
          left.keyword.localeCompare(right.keyword),
      )
      .slice(0, 3),
  );
}

function entryKeywords(
  entry: Readonly<CurrentInformationEntry>,
): ReadonlySet<string> {
  return new Set(
    entry.value.contentKeywords
      .map((keyword) => normalizeKeyword(keyword.normalizedValue))
      .filter((keyword) => keyword.length > 0),
  );
}

function normalizeKeyword(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('und').trim();
}
