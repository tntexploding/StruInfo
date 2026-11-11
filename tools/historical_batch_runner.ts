import type {BatchManifest} from './historical_batch_plan.js';

export interface HistoryBatch {
  sessionId: string;
  batchKey?: string;
  work?: 'scan' | 'import' | 'process' | null;
  problem?: string;
  plan?: {
    planId: string;
    selected: number;
    pending: number;
    imported: number;
    existing: number;
    failed: number;
    submitted?: number;
    processing?: {budgetId: string; state: string; wait?: string};
  } | null;
}
export interface BatchStatus {
  sessions: HistoryBatch[];
  budget?: {batchId: string; paused: boolean; remainingCny: number} | null;
}
export type HistoryCommand = <T>(
  operation: string,
  input?: unknown,
) => Promise<T>;

export async function attachManifest(
  m: BatchManifest,
  batch: number,
  call: HistoryCommand,
  legacyOwned: Record<string, string | null> = {},
) {
  const rows = m.articles.filter((a) => a.batch === batch);
  if (!rows.length) throw new Error('batch_not_found');
  const key = m.id + '-' + String(batch);
  const {sessionId} = await call<{sessionId: string}>('history_restore', {
    batchKey: key,
    ...(Object.keys(legacyOwned).length ? {legacyOwned} : {}),
    articles: rows.map(
      ({
        subscriptionId,
        url,
        title,
        publishedAt,
        dateInferred,
        titleFromUrl,
        access,
      }) => ({
        subscriptionId,
        url,
        title,
        publishedAt,
        dateInferred,
        titleFromUrl,
        access,
      }),
    ),
  });
  const plan = await call<{planId: string; sessionId: string}>(
    'history_prepare_import',
    {sessionId, ids: rows.map((r) => r.id), from: m.from, to: m.to},
  );
  return plan.sessionId;
}
