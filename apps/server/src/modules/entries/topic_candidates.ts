import type {CurrentInformationEntry} from './information_entry_contract.js';
import type {RelatedInformationEntry} from './information_entry_search_index_contract.js';
import {
  equivalentTermIds,
  type AnnotationVocabulary,
} from './structured_annotations.js';
import {
  TOPIC_RULE_VERSION,
  type TopicScope,
  type TopicCandidate,
  type TopicInput,
  type TopicRecord,
  topicPair,
} from './content_topics.js';
export function topicLabels(
  entry: CurrentInformationEntry,
  vocabulary: AnnotationVocabulary,
) {
  const a = entry.value.annotations;
  if (a?.inputBodySha256 !== entry.value.bodySha256) return [];
  return a.labels
    .flatMap((l) => {
      const role =
        a.dimensions.find((d) => d.id === l.dimensionId)?.role ?? 'custom';
      if (role === 'form') return [];
      return [
        {
          id:
            [...equivalentTermIds(l.term.id, vocabulary)].sort()[0] ??
            l.term.id,
          label: l.term.label,
          role,
          ...('evidence' in l && entry.value.body.includes(l.evidence.quote)
            ? {evidence: l.evidence.quote}
            : {}),
        },
      ];
    })
    .slice(0, 24);
}
function publisher(entry: CurrentInformationEntry) {
  try {
    return new URL(entry.canonicalUri ?? '').hostname || entry.sourceKey;
  } catch {
    return entry.sourceKey;
  }
}
/** Only neighbors of this seed are computed. Model topics never enter these statistics. */
export function selectTopicCandidates(
  entries: readonly CurrentInformationEntry[],
  vocabulary: AnnotationVocabulary,
  scope: TopicScope,
  similarities: ReadonlyMap<string, number> = new Map(),
) {
  const visible = entries.filter((e) => !e.value.isPrivate);
  const seed = visible.find((e) => e.entryId === scope.entryId);
  if (!seed) throw new Error('topic_entry_unavailable');
  const labels = new Map(
    visible.map((e) => [e.entryId, topicLabels(e, vocabulary)]),
  );
  const seedLabels = labels.get(seed.entryId) ?? [];
  const seedTerms = new Set(seedLabels.map((l) => l.id));
  const df = new Map<string, Set<string>>();
  const cooccur = new Map<string, Set<string>>();
  const uniqueBodies = new Set<string>();
  for (const e of visible) {
    if (uniqueBodies.has(e.value.bodySha256)) continue;
    uniqueBodies.add(e.value.bodySha256);
    const ls = labels.get(e.entryId) ?? [];
    for (const l of ls) {
      const docs = df.get(l.id) ?? new Set<string>();
      docs.add(e.snapshotId);
      df.set(l.id, docs);
    }
    // One independent reading unit must carry both terms. At most one vote per publisher.
    for (const a of ls.filter((l) => seedTerms.has(l.id)))
      for (const b of ls) {
        if (a.id === b.id) continue;
        const key = topicPair(a.id, b.id),
          samples = cooccur.get(key) ?? new Set<string>();
        samples.add(publisher(e));
        cooccur.set(key, samples);
      }
  }
  const neighbors = new Map<string, number>();
  for (const a of seedTerms) {
    const next = [...cooccur.entries()]
      .filter(([k]) => k.split(':').includes(a))
      .map(([k, s]) => ({
        id: k.split(':').find((t) => t !== a) ?? '',
        n: s.size,
      }))
      .sort((x, y) => y.n - x.n || x.id.localeCompare(y.id))
      .slice(0, 4);
    for (const n of next)
      neighbors.set(n.id, Math.max(n.n, neighbors.get(n.id) ?? 0));
  }
  const conditions = new Set(
    seedLabels.filter((l) => l.role === 'condition').map((l) => l.id),
  );
  const candidates: TopicCandidate[] = [];
  const docCount = new Set(visible.map((e) => e.snapshotId)).size;
  for (const e of visible) {
    if (
      e.entryId === seed.entryId ||
      e.snapshotId === seed.snapshotId ||
      e.value.bodySha256 === seed.value.bodySha256
    )
      continue;
    if (
      scope.publishedFrom &&
      (!e.publishedAt || e.publishedAt < scope.publishedFrom)
    )
      continue;
    if (
      scope.publishedTo &&
      (!e.publishedAt || e.publishedAt > scope.publishedTo)
    )
      continue;
    const ls = labels.get(e.entryId) ?? [];
    const otherConditions = ls.filter((l) => l.role === 'condition');
    if (
      !scope.crossConditions &&
      conditions.size &&
      otherConditions.length &&
      !otherConditions.some((l) => conditions.has(l.id))
    )
      continue;
    const common = ls.filter((l) => seedTerms.has(l.id));
    const near = ls.filter((l) => !seedTerms.has(l.id) && neighbors.has(l.id));
    const weighted = common.reduce(
      (s, l) =>
        s +
        Math.log(1 + docCount / (df.get(l.id)?.size ?? 1)) *
          (l.role === 'domain' ? 0.3 : 1),
      0,
    );
    const samples = Math.max(0, ...near.map((l) => neighbors.get(l.id) ?? 0));
    const score =
      weighted + Math.min(0.8, near.length * 0.12) * (samples < 2 ? 0.25 : 1);
    const similarity = similarities.get(e.entryId);
    const vectorCandidate = similarity !== undefined && similarity >= 7200;
    if (!common.length && !near.length && !vectorCandidate) continue;
    const meaningful = common.filter(
      (l) => !['domain', 'condition', 'form'].includes(l.role),
    );
    const labelCandidate =
      meaningful.some((l) => ['entity', 'issue'].includes(l.role)) ||
      new Set(meaningful.map((l) => l.id)).size >= 2 ||
      near.filter(
        (l) =>
          !['domain', 'condition', 'form'].includes(l.role) &&
          (neighbors.get(l.id) ?? 0) >= 2,
      ).length >= 2;
    const eligibleForAi = labelCandidate || vectorCandidate;
    candidates.push({
      entryId: e.entryId,
      revision: e.revision,
      title: e.value.titlePath,
      source: publisher(e),
      score: Math.round((score + (similarity ?? 0) / 10000) * 1000) / 1000,
      ...(similarity === undefined ? {} : {semanticSimilarity: similarity}),
      labelCandidate,
      reasons: [
        ...(similarity === undefined
          ? []
          : [`正文相似度 ${(similarity / 100).toFixed(1)}%`]),
        ...(!eligibleForAi
          ? ['仅供本地候选：缺少共同对象、议题或多个有效标签。']
          : []),
        ...(common.length
          ? ['共同标注：' + common.map((l) => l.label).join('、')]
          : []),
        ...(near.length
          ? ['相关标注：' + near.map((l) => l.label).join('、')]
          : []),
      ],
      samples,
      uncertain: true,
      eligibleForAi,
    });
  }
  const selected: TopicCandidate[] = [],
    sources = new Map<string, number>(),
    docs = new Set<string>(),
    bodies = new Set([seed.value.bodySha256]);
  let vectorOnly = 0;
  for (const c of candidates.sort(
    (a, b) =>
      Number(b.labelCandidate) - Number(a.labelCandidate) ||
      Number(b.eligibleForAi) - Number(a.eligibleForAi) ||
      b.score - a.score ||
      a.entryId.localeCompare(b.entryId),
  )) {
    if (c.eligibleForAi && !c.labelCandidate && vectorOnly >= 2) continue;
    const e = required(visible.find((v) => v.entryId === c.entryId));
    if (
      (sources.get(c.source) ?? 0) >= 2 ||
      docs.has(e.snapshotId) ||
      bodies.has(e.value.bodySha256)
    )
      continue;
    selected.push(c);
    if (c.eligibleForAi && !c.labelCandidate) vectorOnly += 1;
    sources.set(c.source, (sources.get(c.source) ?? 0) + 1);
    docs.add(e.snapshotId);
    bodies.add(e.value.bodySha256);
    if (selected.length >= scope.candidateLimit - 1) break;
  }
  return {seed, candidates: scope.candidateLimit === 1 ? [] : selected};
}
export function prepareTopicInput(
  entries: readonly CurrentInformationEntry[],
  vocabulary: AnnotationVocabulary,
  scope: TopicScope,
  topics: readonly TopicRecord[],
  protectedPairs: readonly string[],
  similarities: ReadonlyMap<string, RelatedInformationEntry> = new Map(),
) {
  const {seed, candidates} = selectTopicCandidates(
    entries,
    vocabulary,
    scope,
    new Map([...similarities].map(([id, match]) => [id, match.score])),
  );
  const ids = [
    seed.entryId,
    ...candidates.filter((c) => c.eligibleForAi).map((c) => c.entryId),
  ];
  const input: TopicInput = {
    ruleVersion: TOPIC_RULE_VERSION,
    scope,
    vocabularyRevision: vocabulary.revision,
    entries: ids.map((id) => {
      const e = required(entries.find((v) => v.entryId === id));
      return {
        entryId: e.entryId,
        revision: e.revision,
        snapshotId: e.snapshotId,
        source: publisher(e),
        publishedAt: e.publishedAt ?? null,
        title: e.value.titlePath,
        body: e.value.body,
        evidenceRanges:
          id === seed.entryId
            ? ids.flatMap((candidateId) => {
                const match = similarities.get(candidateId);
                return match ? [match.sourcePassage] : [];
              })
            : similarities.has(id)
              ? [required(similarities.get(id)).passage]
              : [],
        labels: topicLabels(e, vocabulary),
      };
    }),
    topics: topics
      .flatMap((t) => {
        if (t.value.kind !== 'topic') return [];
        const current = (m: {entryId: string; revision: number}) =>
          ids.includes(m.entryId) &&
          entries.some(
            (e) => e.entryId === m.entryId && e.revision === m.revision,
          );
        const members = t.value.members.filter(
          (m) =>
            current(m) ||
            (m.decision === 'excluded' && ids.includes(m.entryId)),
        );
        if (
          new Set(
            members
              .filter((m) => m.decision !== 'excluded')
              .map((m) => m.entryId),
          ).size < 2
        )
          return [];
        return [
          {
            id: t.id,
            version: t.version,
            value: {
              ...t.value,
              members,
              relations: t.value.relations.filter(
                (r) => current(r.from) && current(r.to),
              ),
              summary: '',
              summaryVersions: [],
            },
          },
        ];
      })
      .sort(
        (a, b) =>
          b.value.members.length - a.value.members.length ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 8),
    protectedPairs: [...protectedPairs].sort().slice(0, 512),
  };
  return {input, candidates};
}

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error('Missing synthetic or selected entry');
  return value;
}
