import {Buffer} from 'node:buffer';
import {z} from 'zod';

import {
  SourceSubscriptionReaderError,
  type GitSourceSubscriptionRead,
  type GitSourceSubscriptionReaderPort,
} from '../../modules/subscriptions/index.js';
import {
  MAX_SOURCE_CONNECTOR_DOCUMENTS,
  type SourceConnectorDocument,
  type SourceConnectorReadResult,
} from '../../modules/subscriptions/source_connector.js';
import type {ReviewGitSourceSubscription} from '../../storage/review_preferences_store.js';

const SHA1 = /^[0-9a-f]{40}$/u;
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const directoryCursor = z
  .object({
    version: z.literal(1),
    completed: z.string().regex(SHA1).optional(),
    pending: z.string().regex(SHA1).optional(),
    after: z.string().min(1).max(500).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.pending) === Boolean(v.after));
interface GitFile {
  path: string;
  sha: string;
  size: number;
}

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

  public async readDirectory(
    subscription: Readonly<ReviewGitSourceSubscription>,
  ): Promise<Readonly<SourceConnectorReadResult>> {
    const repository = parseRepository(subscription.repositoryUri);
    const prefix = subscription.repositoryPath;
    if (!prefix.endsWith('/'))
      throw new SourceSubscriptionReaderError('source_invalid');
    let previous: z.infer<typeof directoryCursor>;
    try {
      previous =
        subscription.cursor && 'connectorCursor' in subscription.cursor
          ? directoryCursor.parse(
              JSON.parse(
                Buffer.from(
                  subscription.cursor.connectorCursor,
                  'base64url',
                ).toString('utf8'),
              ) as unknown,
            )
          : {version: 1};
    } catch {
      throw new SourceSubscriptionReaderError('source_invalid');
    }
    let commit = previous.pending;
    if (!commit) {
      const query = new URLSearchParams({
        sha: subscription.repositoryRef,
        path: prefix,
        per_page: '1',
      });
      const commits = await this.#readJson(
        `https://api.github.com/repos/${repository}/commits?${query}`,
      );
      const first: unknown = Array.isArray(commits) ? commits[0] : undefined;
      if (
        !isRecord(first) ||
        typeof first.sha !== 'string' ||
        !SHA1.test(first.sha)
      )
        throw new SourceSubscriptionReaderError('source_not_found');
      commit = first.sha;
    }
    const encode = (value: z.infer<typeof directoryCursor>) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    if (commit === previous.completed)
      return {status: 'unchanged', cursor: encode(previous)};
    const files = await this.#tree(repository, commit, prefix);
    const prior = previous.completed
      ? await this.#tree(repository, previous.completed, prefix)
      : [];
    const previousFiles = new Map(prior.map((file) => [file.path, file.sha]));
    const changed = files.filter(
      (file) =>
        previousFiles.get(file.path) !== file.sha &&
        (!previous.after || file.path > previous.after),
    );
    const batch = changed.slice(0, MAX_SOURCE_CONNECTOR_DOCUMENTS);
    const target = commit;
    const documents = new Array<SourceConnectorDocument>(batch.length);
    let next = 0;
    // Read a small number in parallel. GitHub API is used only for commit/tree metadata.
    const workers = await Promise.allSettled(
      Array.from({length: Math.min(4, batch.length)}, async () => {
        while (next < batch.length) {
          const index = next++;
          const file = batch[index];
          if (!file) continue;
          const path = file.path.split('/').map(encodeURIComponent).join('/');
          const bytes = await this.#readBytes(
            `https://raw.githubusercontent.com/${repository}/${target}/${path}`,
            MAX_SOURCE_BYTES,
          );
          if (bytes.byteLength !== file.size)
            throw new SourceSubscriptionReaderError('source_invalid');
          try {
            const content = new TextDecoder('utf-8', {fatal: true}).decode(
              bytes,
            );
            if (!content || content.includes('\u0000'))
              throw new Error('invalid_text');
          } catch {
            throw new SourceSubscriptionReaderError('source_invalid');
          }
          documents[index] = {
            externalId: file.path,
            version: file.sha,
            canonicalUri: `https://github.com/${repository}/blob/${target}/${path}`,
            sourceUtf8: bytes,
            mediaType: 'text/markdown',
            profile: subscription.profile,
          };
        }
      }),
    );
    const failed = workers.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (failed) throw failed.reason;
    const last = batch.at(-1);
    const cursor = encode(
      changed.length > batch.length && last
        ? {
            version: 1,
            ...(previous.completed ? {completed: previous.completed} : {}),
            pending: target,
            after: last.path,
          }
        : {version: 1, completed: target},
    );
    return documents.length
      ? {status: 'changed', cursor, documents}
      : {status: 'unchanged', cursor};
  }

  async #tree(
    repository: string,
    commit: string,
    prefix: string,
  ): Promise<GitFile[]> {
    const result = await this.#readJson(
      `https://api.github.com/repos/${repository}/git/trees/${commit}?recursive=1`,
      8 * 1024 * 1024,
    );
    if (!isRecord(result) || !Array.isArray(result.tree))
      throw new SourceSubscriptionReaderError('source_invalid');
    if (result.truncated !== false)
      throw new SourceSubscriptionReaderError('source_too_large');
    const files: GitFile[] = [];
    for (const value of result.tree as unknown[]) {
      if (
        !isRecord(value) ||
        value.type !== 'blob' ||
        !['100644', '100755'].includes(String(value.mode)) ||
        typeof value.path !== 'string' ||
        !value.path.startsWith(prefix) ||
        !/\.(md|markdown)$/iu.test(value.path)
      )
        continue;
      if (
        value.path.length > 500 ||
        value.path.split('/').some((s) => s === '.' || s === '..') ||
        typeof value.sha !== 'string' ||
        !SHA1.test(value.sha) ||
        typeof value.size !== 'number' ||
        !Number.isSafeInteger(value.size) ||
        value.size < 1
      )
        throw new SourceSubscriptionReaderError('source_invalid');
      if (value.size > MAX_SOURCE_BYTES)
        throw new SourceSubscriptionReaderError('source_too_large');
      files.push({path: value.path, sha: value.sha, size: value.size});
    }
    return files.sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
  }

  async #readJson(url: string, maximum = MAX_RESPONSE_BYTES): Promise<unknown> {
    const bytes = await this.#readBytes(url, maximum);
    try {
      return JSON.parse(
        new TextDecoder('utf-8', {fatal: true}).decode(bytes),
      ) as unknown;
    } catch {
      throw new SourceSubscriptionReaderError('source_invalid');
    }
  }

  async #readBytes(url: string, maximum: number): Promise<Uint8Array> {
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
      if (!response.body)
        throw new SourceSubscriptionReaderError('source_invalid');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maximum) {
            await reader.cancel();
            throw new SourceSubscriptionReaderError('source_too_large');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      return Uint8Array.from(Buffer.concat(chunks));
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
