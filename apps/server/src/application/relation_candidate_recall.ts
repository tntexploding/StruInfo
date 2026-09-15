import type {CurrentInformationEntry} from '../modules/entries/index.js';
import type {RelationRecallPlan} from './document_intake_contract.js';

export interface RecallAlias {
  readonly source: string;
  readonly canonical: string;
}
export interface RelationCandidate {
  readonly entry: CurrentInformationEntry;
  readonly score: number;
  readonly reasons: readonly string[];
}

/** Search normalization does not rewrite stored labels or assert equivalence. */
export function recallKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]+/gu, ' ')
    .trim();
}

export function recallRelationCandidates(
  anchor: CurrentInformationEntry,
  entries: readonly CurrentInformationEntry[],
  plan: RelationRecallPlan | undefined,
  aliases: readonly RecallAlias[],
  limit: number,
  excludedIds: ReadonlySet<string> = new Set(),
): readonly RelationCandidate[] {
  if (anchor.value.isPrivate || limit <= 0) return [];
  const publicEntries = entries.filter((e) => !e.value.isPrivate);
  // A whole capture supersedes earlier fragments for recall, not in storage.
  const latestWhole = new Map<string, CurrentInformationEntry>();
  for (const entry of publicEntries) {
    if (!entry.canonicalUri || entry.value.chunkMode !== 'whole') continue;
    const previous = latestWhole.get(entry.canonicalUri);
    if (!previous || compareRecent(entry, previous) < 0)
      latestWhole.set(entry.canonicalUri, entry);
  }
  const corpus = publicEntries.filter((e) => {
    if (e.entryId === anchor.entryId || excludedIds.has(e.entryId))
      return false;
    if (e.snapshotId === anchor.snapshotId) return false;
    if (e.canonicalUri && e.canonicalUri === anchor.canonicalUri) return false;
    const whole = e.canonicalUri ? latestWhole.get(e.canonicalUri) : undefined;
    return !whole || whole.snapshotId === e.snapshotId;
  });
  const concepts = [...(plan?.concepts ?? [])];
  for (const keyword of anchor.value.contentKeywords) {
    const term = recallKey(keyword.displayValue);
    if (
      !concepts.some((c) =>
        [c.term, ...c.variants].some((v) => recallKey(v) === term),
      )
    )
      concepts.push({term: keyword.displayValue, variants: []});
  }
  const anchorWords = recallKey(
    [
      anchor.value.titlePath,
      readingWords(anchor.value.body),
      ...anchor.value.contentKeywords.map((k) => k.displayValue),
    ].join(' '),
  );
  const groups = concepts.map((concept) => {
    const terms = new Set(
      [concept.term, ...concept.variants]
        .map(recallKey)
        .filter(
          (t) =>
            t.length >= 2 &&
            (!/^[a-z]{2,3}$/u.test(t) || containsTerm(anchorWords, t)),
        ),
    );
    // Explicit aliases are undirected for retrieval, including bounded chains.
    let remainingPasses = aliases.length;
    while (remainingPasses-- > 0) {
      let changed = false;
      for (const alias of aliases) {
        const source = recallKey(alias.source),
          canonical = recallKey(alias.canonical);
        if (terms.has(source) || terms.has(canonical)) {
          if (!terms.has(source) || !terms.has(canonical)) changed = true;
          terms.add(source);
          terms.add(canonical);
        }
      }
      if (!changed) break;
    }
    return {
      label: concept.term,
      terms: [...terms].filter((t) => t.length >= 2),
    };
  });
  const documents = corpus.map((entry) => ({
    entry,
    tags: entry.value.contentKeywords.map((k) => recallKey(k.displayValue)),
    title: recallKey(entry.value.titlePath),
    body: recallKey(readingWords(entry.value.body)),
  }));
  const scores = new Map<
    string,
    {entry: CurrentInformationEntry; score: number; reasons: string[]}
  >();
  for (const group of groups) {
    const hits = documents.flatMap((doc) => {
      const tag = group.terms.find((t) =>
        doc.tags.some((k) => containsTerm(k, t)),
      );
      const title = group.terms.find((t) => containsTerm(doc.title, t));
      const body = group.terms.find((t) => containsTerm(doc.body, t));
      if (!tag && !title && !body) return [];
      return [
        {
          doc,
          weight: tag ? 5 : title ? 4 : 1,
          term: tag ?? title ?? body ?? '',
          channel: tag ? '标签' : title ? '标题' : '正文',
        },
      ];
    });
    const idf = Math.log(1 + documents.length / (1 + hits.length));
    for (const hit of hits) {
      const id = hit.doc.entry.entryId;
      const result = scores.get(id) ?? {
        entry: hit.doc.entry,
        score: 0,
        reasons: [],
      };
      result.score += hit.weight * idf;
      result.reasons.push(
        `${group.label} → ${hit.term}（${hit.channel}）`.slice(0, 230),
      );
      scores.set(id, result);
    }
  }
  const sorted = [...scores.values()].sort(
    (a, b) => b.score - a.score || compareRecent(a.entry, b.entry),
  );
  const seenSources = new Set<string>();
  return sorted
    .filter((candidate) => {
      const key = candidate.entry.canonicalUri ?? candidate.entry.snapshotId;
      if (seenSources.has(key)) return false;
      seenSources.add(key);
      return true;
    })
    .slice(0, limit)
    .map((c) => ({...c, reasons: c.reasons.slice(0, 12)}));
}

function readingWords(markdown: string): string {
  return markdown
    .replace(/\]\((?:\\.|[^)])*\)/gu, ']')
    .replace(/https?:\/\/[^\s)>]+/gu, '');
}

function containsTerm(text: string, term: string): boolean {
  let start = 0;
  for (;;) {
    const index = text.indexOf(term, start);
    if (index < 0) return false;
    const before = text[index - 1] ?? '',
      after = text[index + term.length] ?? '';
    // Short Latin tokens must not match the middle of unrelated words.
    if (
      (!/^[a-z0-9]/u.test(term) || !/[a-z0-9]/u.test(before)) &&
      (!/[a-z0-9]$/u.test(term) || !/[a-z0-9]/u.test(after))
    )
      return true;
    start = index + 1;
  }
}
function compareRecent(a: CurrentInformationEntry, b: CurrentInformationEntry) {
  return (
    b.capturedAt.localeCompare(a.capturedAt) ||
    a.entryId.localeCompare(b.entryId)
  );
}
