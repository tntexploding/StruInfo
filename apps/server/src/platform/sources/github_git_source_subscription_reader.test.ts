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
    routeAfterImport: false,
    intervalMinutes: 1_440,
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
}
