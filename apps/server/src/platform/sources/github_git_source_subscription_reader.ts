import {Buffer} from 'node:buffer';

import {
  SourceSubscriptionReaderError,
  type GitSourceSubscriptionRead,
  type GitSourceSubscriptionReaderPort,
} from '../../modules/subscriptions/index.js';
import type {ReviewGitSourceSubscription} from '../../storage/review_preferences_store.js';

const SHA1 = /^[0-9a-f]{40}$/u;
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface GithubGitSourceSubscriptionReaderOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export class GithubGitSourceSubscriptionReader implements GitSourceSubscriptionReaderPort {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  public constructor(
    options: Readonly<GithubGitSourceSubscriptionReaderOptions> = {},
  ) {
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 20_000;
  }

  public async read(
    subscription: Readonly<ReviewGitSourceSubscription>,
  ): Promise<Readonly<GitSourceSubscriptionRead>> {
    const repository = parseRepository(subscription.repositoryUri);
    const path = subscription.repositoryPath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const query = new URLSearchParams({
      sha: subscription.repositoryRef,
      path: subscription.repositoryPath,
      per_page: '1',
    });
    const commits = await this.#readJson(
      `https://api.github.com/repos/${repository}/commits?${query.toString()}`,
    );
    if (!Array.isArray(commits) || commits.length < 1) {
      throw new SourceSubscriptionReaderError('source_not_found');
    }
    const first: unknown = commits[0];
    if (
      !isRecord(first) ||
      typeof first.sha !== 'string' ||
      !SHA1.test(first.sha)
    ) {
      throw new SourceSubscriptionReaderError('source_invalid');
    }
    const content = await this.#readJson(
      `https://api.github.com/repos/${repository}/contents/${path}?ref=${encodeURIComponent(first.sha)}`,
    );
    if (!isRecord(content)) {
      throw new SourceSubscriptionReaderError('source_invalid');
    }
    const contentSize = content.size;
    if (
      typeof contentSize === 'number' &&
      Number.isSafeInteger(contentSize) &&
      contentSize > MAX_SOURCE_BYTES
    ) {
      throw new SourceSubscriptionReaderError('source_too_large');
    }
    if (
      content.type !== 'file' ||
      content.encoding !== 'base64' ||
      typeof content.content !== 'string' ||
      typeof contentSize !== 'number' ||
      !Number.isSafeInteger(contentSize) ||
      contentSize < 1
    ) {
      throw new SourceSubscriptionReaderError('source_invalid');
    }
    const compact = content.content.replace(/[\r\n]/gu, '');
    const bytes = Buffer.from(compact, 'base64');
    if (
      bytes.byteLength !== contentSize ||
      bytes.toString('base64') !== compact ||
      bytes.byteLength > MAX_SOURCE_BYTES
    ) {
      throw new SourceSubscriptionReaderError('source_invalid');
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    } catch {
      throw new SourceSubscriptionReaderError('source_invalid');
    }
    if (text.length === 0 || text.includes('\u0000')) {
      throw new SourceSubscriptionReaderError('source_invalid');
    }
    return Object.freeze({
      commitSha: first.sha,
      sourceUtf8: Uint8Array.from(bytes),
      canonicalUri: `https://github.com/${repository}/blob/${first.sha}/${path}`,
    });
  }

  async #readJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => {
      controller.abort();
    }, this.#timeoutMs);
    try {
      const response = await this.#fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: Object.freeze({
          Accept: 'application/vnd.github+json',
          'User-Agent': 'StruInfo-local/1',
          'X-GitHub-Api-Version': '2022-11-28',
        }),
      });
      if (response.status === 404) {
        throw new SourceSubscriptionReaderError('source_not_found');
      }
      if (!response.ok) {
        throw new SourceSubscriptionReaderError('source_unavailable');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_RESPONSE_BYTES) {
        throw new SourceSubscriptionReaderError('source_too_large');
      }
      let source: string;
      try {
        source = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
      } catch {
        throw new SourceSubscriptionReaderError('source_invalid');
      }
      try {
        return JSON.parse(source) as unknown;
      } catch {
        throw new SourceSubscriptionReaderError('source_invalid');
      }
    } catch (error) {
      if (error instanceof SourceSubscriptionReaderError) throw error;
      throw new SourceSubscriptionReaderError('source_unavailable');
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
}

function parseRepository(uri: string): string {
  const parsed = new URL(uri);
  const segments = parsed.pathname.split('/').filter(Boolean);
  const owner = segments[0];
  const repository = segments[1];
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'github.com' ||
    segments.length !== 2 ||
    owner === undefined ||
    repository === undefined
  ) {
    throw new SourceSubscriptionReaderError('source_invalid');
  }
  return `${owner}/${repository}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
