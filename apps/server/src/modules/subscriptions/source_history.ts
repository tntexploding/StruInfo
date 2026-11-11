import type {SourceConnectorDocument} from './source_connector.js';
export interface HistoryArticle {
  id: string;
  subscriptionId: string;
  url: string;
  title: string;
  titleFromUrl?: boolean;
  publishedAt?: string;
  dateInferred?: boolean;
  access: 'public' | 'restricted' | 'unknown';
}
export interface HistoryPage {
  url: string;
  kind: 'feed' | 'robots' | 'sitemap' | 'html' | 'substack' | 'wordpress';
  page?: number;
}
export interface HistoryPageResult {
  articles: Omit<HistoryArticle, 'id' | 'subscriptionId'>[];
  next: HistoryPage[];
  method: string;
  replaceQueue?: boolean;
}
export interface SourceHistoryReader {
  read(page: HistoryPage, base: string): Promise<HistoryPageResult>;
  article(article: HistoryArticle): Promise<{
    document: SourceConnectorDocument;
    title: string;
    access: HistoryArticle['access'];
  }>;
}

export function historyUrl(value: string, base: string): string | undefined {
  try {
    const url = new URL(value, base),
      root = new URL(base);
    if (
      url.hostname.replace(/^www\./u, '') !==
      root.hostname.replace(/^www\./u, '')
    )
      return undefined;
    if (url.protocol === 'http:') url.protocol = 'https:';
    url.hash = '';
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.href.length > 2000 ||
      Array.from(value).some((c) => (c.codePointAt(0) ?? 0) <= 32)
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
export function historyIdentity(value: string): string {
  const url = new URL(value);
  url.protocol = 'https:';
  url.hostname = url.hostname.replace(/^www\./u, '');
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/u.test(key)) url.searchParams.delete(key);
  return url.href.replace(/\/$/u, '');
}

export interface HistorySourceState {
  subscriptionId: string;
  label: string;
  base: string;
  queue: HistoryPage[];
  seen: Set<string>;
  pageFingerprints: Set<string>;
  methods: Set<string>;
  failed: {page: HistoryPage; code: string}[];
  busy: boolean;
  rateLimited: boolean;
  count: number;
  limited: boolean;
  custom: boolean;
}
export interface HistoryItemResult {
  id: string;
  status: 'imported' | 'existing' | 'failed';
  snapshotId?: string;
  code?: string;
  job?: {
    receiptVersion?: number;
    taskId?: string;
    pausedVersion?: number;
    finished?: boolean;
    reason?: string;
  };
}
export interface HistoryProcessing {
  budgetId: string;
  maxModelCalls: number;
  state: 'running' | 'paused' | 'finished';
  wait?: string;
  legacyEntryLimit?: number;
}
export interface HistorySession {
  id: string;
  batchKey?: string;
  legacyOwned?: Record<string, string | null>;
  touched: number;
  parts: number;
  sources: Map<string, HistorySourceState>;
  articles: Map<string, HistoryArticle>;
  selection?: {
    text?: string;
    perSourceLimit?: number | undefined;
    from?: string | undefined;
    to?: string | undefined;
  };
  work?: 'scan' | 'import' | 'process';
  problem?: string;
  plan?: {
    id: string;
    background?: boolean;
    processing?: HistoryProcessing;
    ids: Set<string>;
    from: string | undefined;
    to: string | undefined;
    results: Map<string, HistoryItemResult>;
  };
}
export interface HistoryCheckpointStore {
  load(): Promise<HistorySession[]>;
  save(
    session: HistorySession,
    changed: readonly HistoryArticle[],
  ): Promise<void>;
  remove(id: string): Promise<void>;
}
