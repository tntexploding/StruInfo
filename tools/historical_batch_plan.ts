import {
  historyIdentity,
  type HistoryArticle,
} from '../apps/server/src/modules/subscriptions/source_history.js';

export interface BatchSource {
  subscriptionId: string;
  label: string;
  limit: number;
  previouslyAccepted: number;
}
export interface Candidate extends HistoryArticle {
  exclusion?: string;
  existingSnapshotId?: string;
  completeness: 'unchecked' | 'complete' | 'incomplete' | 'unavailable';
}
export interface BatchManifest {
  format: string;
  id: string;
  workspaceId: string;
  from: string;
  to: string;
  batchSize: number;
  sources: BatchSource[];
  articles: (Candidate & {batch: number})[];
  excluded: {id: string; url: string; subscriptionId: string; reason: string}[];
  reserve: Candidate[];
  task: {
    maxEntries: number;
    maxRelations: number;
    maxRelationCandidates: number;
    maxModelCalls: number;
  };
}
export interface PreparationInput {
  id: string;
  workspaceId: string;
  from: string;
  to: string;
  batchSize: number;
  sources: BatchSource[];
  candidates: Candidate[];
  previouslyReviewedUrls: string[];
  task: BatchManifest['task'];
}

function validDay(day: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/u.test(day) &&
    Number.isFinite(Date.parse(day)) &&
    new Date(day).toISOString().startsWith(day)
  );
}

/** Freeze a date-stratified selection; confirmed prior acceptances consume cap. */
export function prepareManifest(input: PreparationInput): BatchManifest {
  if (
    !/^[a-zA-Z0-9_-]{1,30}$/u.test(input.id) ||
    !validDay(input.from) ||
    !validDay(input.to) ||
    input.from > input.to ||
    !Number.isInteger(input.batchSize) ||
    input.batchSize < 1 ||
    input.batchSize > 5000
  )
    throw new Error('invalid_batch_configuration');
  const sourceIds = new Set(input.sources.map((s) => s.subscriptionId));
  if (
    sourceIds.size !== input.sources.length ||
    sourceIds.size < 1 ||
    sourceIds.size > 32
  )
    throw new Error('invalid_batch_sources');
  for (const s of input.sources)
    if (
      !Number.isInteger(s.limit) ||
      s.limit < 1 ||
      s.limit > 5000 ||
      !Number.isInteger(s.previouslyAccepted) ||
      s.previouslyAccepted < 0 ||
      s.previouslyAccepted > s.limit
    )
      throw new Error('invalid_cumulative_source_cap');
  const seen = new Set(input.previouslyReviewedUrls.map(historyIdentity));
  const prior = new Set(seen);
  const excluded: BatchManifest['excluded'] = [];
  const eligible: Candidate[] = [];
  const ids = new Set<string>();
  for (const row of [...input.candidates].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    if (
      !sourceIds.has(row.subscriptionId) ||
      !/^[a-f0-9]{64}$/u.test(row.id) ||
      ids.has(row.id)
    )
      throw new Error('invalid_candidate_identity');
    ids.add(row.id);
    const key = historyIdentity(row.url);
    const day = row.publishedAt?.slice(0, 10);
    let reason: string | undefined;
    if (prior.has(key) || row.existingSnapshotId)
      reason = 'previously_received_or_reviewed';
    else if (row.exclusion) reason = row.exclusion;
    else if (row.access === 'restricted') reason = 'restricted';
    else if (row.completeness === 'incomplete') reason = 'incomplete';
    else if (row.completeness === 'unavailable') reason = 'needs_fetch_review';
    else if (!day || !validDay(day)) reason = 'unknown_publication_date';
    else if (day < input.from || day > input.to) reason = 'outside_date_range';
    else if (seen.has(key)) reason = 'duplicate_url';
    if (reason)
      excluded.push({
        id: row.id,
        url: row.url,
        subscriptionId: row.subscriptionId,
        reason,
      });
    else {
      seen.add(key);
      eligible.push(row);
    }
  }
  const selected: Candidate[][] = [],
    reserve: Candidate[] = [];
  for (const source of input.sources) {
    const pool = eligible
      .filter((r) => r.subscriptionId === source.subscriptionId)
      .sort(
        (a, b) =>
          (a.publishedAt ?? '').localeCompare(b.publishedAt ?? '') ||
          a.id.localeCompare(b.id),
      );
    const remaining = source.limit - source.previouslyAccepted;
    // Evenly spaced ranks cover older and newer writing when a source exceeds its cap.
    const indices = new Set(
      Array.from({length: Math.min(remaining, pool.length)}, (_, i) =>
        Math.floor(
          ((i + 0.5) * pool.length) / Math.min(remaining, pool.length),
        ),
      ),
    );
    selected.push(pool.filter((_, i) => indices.has(i)));
    reserve.push(...pool.filter((_, i) => !indices.has(i)));
  }
  const articles: BatchManifest['articles'] = [];
  for (let round = 0; selected.some((rows) => rows.length > round); round++)
    for (const rows of selected) {
      const row = rows[round];
      if (row)
        articles.push({
          ...row,
          batch: Math.floor(articles.length / input.batchSize) + 1,
        });
    }
  const manifest: BatchManifest = {
    format: 'struinfo.historical-batch.v1',
    id: input.id,
    workspaceId: input.workspaceId,
    from: input.from,
    to: input.to,
    batchSize: input.batchSize,
    sources: input.sources,
    task: input.task,
    articles,
    reserve,
    excluded,
  };
  validateManifest(manifest);
  return manifest;
}

export function validateManifest(m: BatchManifest): void {
  if (
    m.format !== 'struinfo.historical-batch.v1' ||
    !/^[a-zA-Z0-9_-]{1,30}$/u.test(m.id) ||
    !/^[a-f0-9-]{36}$/u.test(m.workspaceId) ||
    !validDay(m.from) ||
    !validDay(m.to) ||
    m.from > m.to ||
    !Number.isInteger(m.batchSize) ||
    m.batchSize < 1 ||
    m.batchSize > 5000
  )
    throw new Error('invalid_manifest');
  const t = m.task;
  if (
    ![
      t.maxEntries,
      t.maxRelations,
      t.maxRelationCandidates,
      t.maxModelCalls,
    ].every(Number.isInteger) ||
    t.maxEntries < 1 ||
    t.maxEntries > 64 ||
    t.maxRelations < 0 ||
    t.maxRelations > 8 ||
    t.maxRelationCandidates < 0 ||
    t.maxRelationCandidates > 24 ||
    t.maxModelCalls < 1 ||
    t.maxModelCalls > 64
  )
    throw new Error('invalid_task_limits');
  const seen = new Set<string>(),
    ids = new Set<string>();
  if (
    new Set(m.sources.map((s) => s.subscriptionId)).size !== m.sources.length ||
    m.sources.length > 32
  )
    throw new Error('invalid_batch_sources');
  for (const [index, a] of m.articles.entries()) {
    const identity = historyIdentity(a.url);
    if (
      !/^[a-f0-9]{64}$/u.test(a.id) ||
      ids.has(a.id) ||
      seen.has(identity) ||
      !m.sources.some((s) => s.subscriptionId === a.subscriptionId) ||
      a.batch !== Math.floor(index / m.batchSize) + 1 ||
      !a.publishedAt ||
      a.publishedAt.slice(0, 10) < m.from ||
      a.publishedAt.slice(0, 10) > m.to ||
      a.access === 'restricted' ||
      a.exclusion ||
      a.existingSnapshotId ||
      !['complete', 'unchecked'].includes(a.completeness)
    )
      throw new Error('invalid_selected_article');
    ids.add(a.id);
    seen.add(identity);
  }
  for (const source of m.sources)
    if (
      !Number.isInteger(source.limit) ||
      source.limit < 1 ||
      source.limit > 5000 ||
      !Number.isInteger(source.previouslyAccepted) ||
      source.previouslyAccepted < 0 ||
      source.previouslyAccepted +
        m.articles.filter((a) => a.subscriptionId === source.subscriptionId)
          .length >
        source.limit
    )
      throw new Error('cumulative_source_cap_exceeded');
}
