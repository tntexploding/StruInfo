import {Buffer} from 'node:buffer';

import {describe, expect, it, vi} from 'vitest';

import {SourceSubscriptionReaderError} from '../../modules/subscriptions/index.js';
import type {ReviewGitSourceSubscription} from '../../storage/review_preferences_store.js';
import {GithubGitSourceSubscriptionReader} from './github_git_source_subscription_reader.js';

const COMMIT_SHA = 'a'.repeat(40);

describe('GithubGitSourceSubscriptionReader', () => {
  it('resolves an exact commit and reads one UTF-8 Markdown file', async () => {
    const source = Buffer.from('# Synthetic\n', 'utf8');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{sha: COMMIT_SHA}]))
      .mockResolvedValueOnce(
        jsonResponse({
          type: 'file',
          encoding: 'base64',
          size: source.byteLength,
          content: source.toString('base64'),
        }),
      );
    const reader = new GithubGitSourceSubscriptionReader({
      fetch: fetchMock,
      timeoutMs: 1_000,
    });

    const result = await reader.read(subscription());

    expect(new TextDecoder().decode(result.sourceUtf8)).toBe('# Synthetic\n');
    expect(result.commitSha).toBe(COMMIT_SHA);
    expect(result.canonicalUri).toBe(
      `https://github.com/example/project/blob/${COMMIT_SHA}/docs/source.md`,
    );
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      'repos/example/project/commits?',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      `contents/docs/source.md?ref=${COMMIT_SHA}`,
    );
  });

  it('maps missing and malformed sources to stable reader errors', async () => {
    const missing = new GithubGitSourceSubscriptionReader({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('{}', {status: 404})),
    });
    await expect(missing.read(subscription())).rejects.toMatchObject({
      name: 'SourceSubscriptionReaderError',
      code: 'source_not_found',
    });

    const malformed = new GithubGitSourceSubscriptionReader({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse([{sha: COMMIT_SHA}]))
        .mockResolvedValueOnce(
          jsonResponse({
            type: 'file',
            encoding: 'base64',
            size: 2,
            content: '***',
          }),
        ),
    });
    await expect(malformed.read(subscription())).rejects.toBeInstanceOf(
      SourceSubscriptionReaderError,
    );
  });

  it('receives a directory in pinned batches, limits concurrency and skips an unchanged commit', async () => {
    const files = Array.from({length: 70}, (_, index) => ({
      path: `docs/${String(index).padStart(3, '0')}.md`,
      type: 'blob',
      mode: '100644',
      size: 4,
      sha: index.toString(16).padStart(40, '0'),
    }));
    let active = 0;
    let peak = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/commits?')) return jsonResponse([{sha: COMMIT_SHA}]);
      if (url.includes('/git/trees/'))
        return jsonResponse({
          truncated: false,
          tree: [
            ...files,
            {
              path: 'README.md',
              type: 'blob',
              mode: '100644',
              size: 4,
              sha: COMMIT_SHA,
            },
            {
              path: 'docs/link.md',
              type: 'blob',
              mode: '120000',
              size: 4,
              sha: COMMIT_SHA,
            },
          ],
        });
      expect(url).toContain(`/${COMMIT_SHA}/docs/`);
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return new Response('# A\n');
    });
    const reader = new GithubGitSourceSubscriptionReader({fetch: fetcher});
    const source = {...subscription(), repositoryPath: 'docs/'};
    const first = await reader.readDirectory(source);
    expect(first.status).toBe('changed');
    if (first.status !== 'changed') throw new Error('expected documents');
    expect(first.documents).toHaveLength(64);
    expect(peak).toBe(4);
    fetcher.mockClear();
    const second = await reader.readDirectory({
      ...source,
      cursor: {connectorCursor: first.cursor},
    });
    expect(second.status).toBe('changed');
    if (second.status !== 'changed') throw new Error('expected documents');
    expect(second.documents).toHaveLength(6);
    expect(second.documents[0]?.externalId).toBe('docs/064.md');
    expect(
      fetcher.mock.calls.some(([url]) =>
        (url instanceof Request ? url.url : String(url)).includes('/commits?'),
      ),
    ).toBe(false);
    fetcher.mockClear();
    expect(
      await reader.readDirectory({
        ...source,
        cursor: {connectorCursor: second.cursor},
      }),
    ).toMatchObject({status: 'unchanged'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('downloads only changed Markdown blobs and rejects a truncated tree', async () => {
    const prior = 'b'.repeat(40);
    const source = {
      ...subscription(),
      repositoryPath: 'docs/',
      cursor: {
        connectorCursor: Buffer.from(
          JSON.stringify({version: 1, completed: prior}),
        ).toString('base64url'),
      },
    };
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/commits?'))
        return Promise.resolve(jsonResponse([{sha: COMMIT_SHA}]));
      if (url.includes('/git/trees/'))
        return Promise.resolve(
          jsonResponse({
            truncated: false,
            tree: [
              {
                path: 'docs/old.md',
                type: 'blob',
                mode: '100644',
                size: 4,
                sha: prior,
              },
              {
                path: 'docs/change.md',
                type: 'blob',
                mode: '100644',
                size: 4,
                sha: url.includes(prior) ? prior : COMMIT_SHA,
              },
            ],
          }),
        );
      expect(url).toContain('/docs/change.md');
      return Promise.resolve(new Response('# A\n'));
    });
    const reader = new GithubGitSourceSubscriptionReader({fetch: fetcher});
    const result = await reader.readDirectory(source);
    expect(result.status === 'changed' && result.documents.length).toBe(1);
    fetcher.mockImplementation((input) =>
      Promise.resolve(
        (input instanceof Request ? input.url : String(input)).includes(
          '/commits?',
        )
          ? jsonResponse([{sha: COMMIT_SHA}])
          : jsonResponse({tree: [], truncated: true}),
      ),
    );
    await expect(reader.readDirectory(source)).rejects.toMatchObject({
      code: 'source_too_large',
    });
  });
});

function subscription(): Readonly<ReviewGitSourceSubscription> {
  return Object.freeze({
    subscriptionId: '22222222-2222-4222-8222-222222222222',
    label: 'Synthetic',
    enabled: false,
    repositoryUri: 'https://github.com/example/project',
    repositoryRef: 'main',
    repositoryPath: 'docs/source.md',
    profile: 'commonmark-v1',
    sourceAlias: 'synthetic',
    isPrivate: false,
    intervalMinutes: 1_440,
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
}
