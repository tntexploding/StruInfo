import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {patchReviewPreferences} from '../../storage/review_preferences_store.js';
import {LocalReviewPreferencesStore} from './local_review_preferences_store.js';

const roots: string[] = [];
const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';

afterEach(() => {
  for (const root of roots.splice(0).reverse()) {
    rmSync(root, {recursive: true, force: true});
  }
});

describe('LocalReviewPreferencesStore', () => {
  it('treats a missing external file as an empty workspace preference set', async () => {
    const {store} = createStore();

    await expect(store.load(WORKSPACE_A)).resolves.toEqual({
      format: 'struinfo.review-preferences',
      version: 1,
      workspaceId: WORKSPACE_A,
      quickTags: [],
      automaticKeywords: {
        enabled: true,
        includeLinkDomains: false,
        excludedKeywords: [],
      },
      vocabulary: {aliases: []},
      associationPolicy: {
        revision: 0,
        contentWeight: 65,
        typeWeight: 15,
        domainWeight: 20,
        threshold: 1_100,
      },
      explorationPolicy: {
        revision: 0,
        enabled: false,
        resultShare: 20,
        neighborExpansion: true,
        crossDomain: true,
        serendipity: true,
      },
      sourceSubscriptions: {
        revision: 0,
        subscriptions: [],
      },
      entryPreferenceProfile: {
        revision: 0,
        enabled: false,
        rules: [],
      },
      entryAutomationPolicy: {
        revision: 0,
        enabled: false,
        paused: false,
        profileRevision: 0,
        minimumMatchedRuleCount: 1,
        advanceThresholds: {
          usefulness: 3,
          interest: 3,
          requiredDimensions: 1,
        },
        deferThresholds: {
          usefulness: 3,
          interest: 3,
          requiredDimensions: 1,
        },
        budgets: {
          maximumEntriesPerRun: 100,
          maximumAdvanceCandidatesPerRun: 25,
          maximumDeferCandidatesPerRun: 25,
        },
        advanceActions: {
          deterministicTags: false,
          rebuildAssociations: false,
        },
        failureMode: 'pause',
      },
      entrySplitRuleProfile: {
        revision: 0,
        mode: 'one_section',
        minimumGroupCodePoints: 400,
        maximumGroupCodePoints: 4000,
        maximumFragmentsPerGroup: 8,
      },
    });
  });

  it('stores a versioned split rule in the external preference file', async () => {
    const {store} = createStore();

    await store.update(WORKSPACE_A, (current) =>
      Object.freeze({
        next: patchReviewPreferences(current, {
          entrySplitRuleProfile: Object.freeze({
            revision: 1,
            mode: 'merge_short_adjacent',
            minimumGroupCodePoints: 250,
            maximumGroupCodePoints: 2500,
            maximumFragmentsPerGroup: 6,
          }),
        }),
        result: undefined,
      }),
    );

    await expect(store.load(WORKSPACE_A)).resolves.toMatchObject({
      entrySplitRuleProfile: {
        revision: 1,
        mode: 'merge_short_adjacent',
        minimumGroupCodePoints: 250,
        maximumGroupCodePoints: 2500,
        maximumFragmentsPerGroup: 6,
      },
    });
  });

  it('round-trips connector cursors while upgrading legacy Git subscriptions', async () => {
    const {store} = createStore();

    await store.update(WORKSPACE_A, (current) =>
      Object.freeze({
        next: patchReviewPreferences(current, {
          sourceSubscriptions: Object.freeze({
            revision: 1,
            subscriptions: Object.freeze([
              Object.freeze({
                subscriptionId: '33333333-3333-4333-8333-333333333333',
                label: 'Synthetic legacy Git',
                enabled: false,
                repositoryUri: 'https://github.com/example/project',
                repositoryRef: 'main',
                repositoryPath: 'docs/source.md',
                profile: 'commonmark-v1' as const,
                sourceAlias: 'synthetic-git',
                isPrivate: false,
                routeAfterImport: false,
                intervalMinutes: 1_440,
              }),
              Object.freeze({
                kind: 'rss_atom' as const,
                subscriptionId: '44444444-4444-4444-8444-444444444444',
                label: 'Synthetic Feed',
                enabled: true,
                feedUrl: 'https://example.invalid/feed.xml',
                itemLimit: 12,
                sourceAlias: 'synthetic-feed',
                isPrivate: true,
                routeAfterImport: false,
                intervalMinutes: 60,
                cursor: Object.freeze({connectorCursor: 'synthetic-cursor'}),
              }),
              Object.freeze({
                kind: 'json_api' as const,
                subscriptionId: '55555555-5555-4555-8555-555555555555',
                label: 'Synthetic JSON API',
                enabled: false,
                endpointUrl: 'https://api.example.invalid/records',
                recordsPath: 'data.items',
                externalIdPath: 'id',
                titlePath: 'title',
                bodyPath: 'content.body',
                canonicalUriPath: 'url',
                recordLimit: 16,
                pageCursor: Object.freeze({
                  queryParameter: 'cursor',
                  responsePath: 'next_cursor',
                }),
                authentication: Object.freeze({
                  kind: 'bearer_env' as const,
                  variable: 'STRUIINFO_SYNTHETIC_API_TOKEN',
                }),
                sourceAlias: 'synthetic-json',
                isPrivate: false,
                routeAfterImport: false,
                intervalMinutes: 120,
                cursor: Object.freeze({
                  connectorCursor: 'synthetic-json-cursor',
                }),
              }),
            ]),
          }),
        }),
        result: undefined,
      }),
    );

    await expect(store.load(WORKSPACE_A)).resolves.toMatchObject({
      sourceSubscriptions: {
        revision: 1,
        subscriptions: [
          {kind: 'github_markdown', sourceAlias: 'synthetic-git'},
          {
            kind: 'rss_atom',
            feedUrl: 'https://example.invalid/feed.xml',
            itemLimit: 12,
            cursor: {connectorCursor: 'synthetic-cursor'},
          },
          {
            kind: 'json_api',
            endpointUrl: 'https://api.example.invalid/records',
            recordsPath: 'data.items',
            externalIdPath: 'id',
            pageCursor: {
              queryParameter: 'cursor',
              responsePath: 'next_cursor',
            },
            authentication: {
              kind: 'bearer_env',
              variable: 'STRUIINFO_SYNTHETIC_API_TOKEN',
            },
            cursor: {connectorCursor: 'synthetic-json-cursor'},
          },
        ],
      },
    });
  });

  it('saves human-readable tags outside the repository and isolates workspaces', async () => {
    const {root, store} = createStore();

    await store.save(WORKSPACE_A, ['实用工具', '命令行']);
    await store.save(
      WORKSPACE_A,
      ['命令行'],
      {
        enabled: false,
        includeLinkDomains: false,
        excludedKeywords: ['广告', '下载'],
      },
      {
        aliases: [{source: 'Synthetic CLI', canonical: '命令行'}],
      },
      {
        revision: 3,
        contentWeight: 50,
        typeWeight: 25,
        domainWeight: 25,
        threshold: 2_000,
      },
      {
        revision: 2,
        enabled: true,
        resultShare: 30,
        neighborExpansion: true,
        crossDomain: false,
        serendipity: true,
      },
      {
        revision: 1,
        subscriptions: [
          {
            subscriptionId: '33333333-3333-4333-8333-333333333333',
            label: 'Synthetic source',
            enabled: false,
            repositoryUri: 'https://github.com/example/project',
            repositoryRef: 'main',
            repositoryPath: 'docs/source.md',
            profile: 'commonmark-v1',
            sourceAlias: 'synthetic-source',
            isPrivate: false,
            routeAfterImport: false,
            intervalMinutes: 1_440,
          },
        ],
      },
      {
        revision: 2,
        enabled: true,
        rules: [
          {
            ruleId: '44444444-4444-4444-8444-444444444444',
            dimension: 'usefulness',
            featureKind: 'content_keyword',
            featureIdentity: 'postgresql',
            displayValue: 'PostgreSQL',
            effect: 'prefer',
            weight: 5,
          },
          {
            ruleId: '55555555-5555-4555-8555-555555555555',
            dimension: 'interest',
            featureKind: 'domain',
            featureIdentity: 'culture_arts',
            displayValue: '文化与艺术',
            effect: 'deprioritize',
            weight: 2,
          },
        ],
      },
      {
        revision: 3,
        enabled: true,
        paused: false,
        profileRevision: 2,
        minimumMatchedRuleCount: 2,
        advanceThresholds: {
          usefulness: 6,
          interest: 4,
          requiredDimensions: 2,
        },
        deferThresholds: {
          usefulness: 5,
          interest: 3,
          requiredDimensions: 1,
        },
        budgets: {
          maximumEntriesPerRun: 40,
          maximumAdvanceCandidatesPerRun: 10,
          maximumDeferCandidatesPerRun: 8,
        },
        failureMode: 'pause',
      },
    );

    await expect(store.load(WORKSPACE_A)).resolves.toMatchObject({
      workspaceId: WORKSPACE_A,
      quickTags: ['命令行'],
      automaticKeywords: {
        enabled: false,
        includeLinkDomains: false,
        excludedKeywords: ['广告', '下载'],
      },
      vocabulary: {
        aliases: [{source: 'Synthetic CLI', canonical: '命令行'}],
      },
      associationPolicy: {
        revision: 3,
        contentWeight: 50,
        typeWeight: 25,
        domainWeight: 25,
        threshold: 2_000,
      },
      explorationPolicy: {
        revision: 2,
        enabled: true,
        resultShare: 30,
        neighborExpansion: true,
        crossDomain: false,
        serendipity: true,
      },
      sourceSubscriptions: {
        revision: 1,
        subscriptions: [
          {
            subscriptionId: '33333333-3333-4333-8333-333333333333',
            repositoryUri: 'https://github.com/example/project',
            repositoryPath: 'docs/source.md',
          },
        ],
      },
      entryPreferenceProfile: {
        revision: 2,
        enabled: true,
        rules: [
          {
            ruleId: '44444444-4444-4444-8444-444444444444',
            dimension: 'usefulness',
            featureKind: 'content_keyword',
            featureIdentity: 'postgresql',
            displayValue: 'PostgreSQL',
            effect: 'prefer',
            weight: 5,
          },
          {
            ruleId: '55555555-5555-4555-8555-555555555555',
            dimension: 'interest',
            featureKind: 'domain',
            featureIdentity: 'culture_arts',
            displayValue: '文化与艺术',
            effect: 'deprioritize',
            weight: 2,
          },
        ],
      },
      entryAutomationPolicy: {
        revision: 3,
        enabled: true,
        paused: false,
        profileRevision: 2,
        minimumMatchedRuleCount: 2,
        advanceThresholds: {
          usefulness: 6,
          interest: 4,
          requiredDimensions: 2,
        },
        deferThresholds: {
          usefulness: 5,
          interest: 3,
          requiredDimensions: 1,
        },
        budgets: {
          maximumEntriesPerRun: 40,
          maximumAdvanceCandidatesPerRun: 10,
          maximumDeferCandidatesPerRun: 8,
        },
        failureMode: 'pause',
      },
    });
    await expect(store.load(WORKSPACE_B)).resolves.toMatchObject({
      workspaceId: WORKSPACE_B,
      quickTags: [],
    });
    const text = await readFile(
      join(root, `${WORKSPACE_A}.review-preferences.json`),
      'utf8',
    );
    expect(text).toContain('\n  "quickTags": [\n');
    expect(text).toContain('\n  "automaticKeywords": {\n');
    expect(text).toContain('\n  "vocabulary": {\n');
    expect(text).toContain('\n  "associationPolicy": {\n');
    expect(text).toContain('\n  "explorationPolicy": {\n');
    expect(text).toContain('\n  "sourceSubscriptions": {\n');
    expect(text).toContain('\n  "entryPreferenceProfile": {\n');
    expect(text).toContain('\n  "entryAutomationPolicy": {\n');
    expect(text).toContain('\n    "revision": 3,\n');
  });

  it('loads an existing v1 quick-tag file with safe keyword defaults', async () => {
    const {root, store} = createStore();
    writeFileSync(
      join(root, `${WORKSPACE_A}.review-preferences.json`),
      JSON.stringify({
        format: 'struinfo.review-preferences',
        version: 1,
        workspaceId: WORKSPACE_A,
        quickTags: ['synthetic'],
        vocabulary: {
          aliases: [{source: 'Legacy CLI', canonical: '命令行'}],
          links: [{left: 'Legacy', right: '旧值', kind: 'translation'}],
          knowledgeKinds: [{keyword: 'Legacy', knowledgeKind: 'work'}],
        },
      }),
      'utf8',
    );

    await expect(store.load(WORKSPACE_A)).resolves.toMatchObject({
      quickTags: ['synthetic'],
      automaticKeywords: {
        enabled: true,
        includeLinkDomains: false,
        excludedKeywords: [],
      },
      vocabulary: {
        aliases: [{source: 'Legacy CLI', canonical: '命令行'}],
      },
      associationPolicy: {
        revision: 0,
        contentWeight: 65,
        typeWeight: 15,
        domainWeight: 20,
        threshold: 1_100,
      },
      explorationPolicy: {
        revision: 0,
        enabled: false,
        resultShare: 20,
        neighborExpansion: true,
        crossDomain: true,
        serendipity: true,
      },
      sourceSubscriptions: {
        revision: 0,
        subscriptions: [],
      },
      entryPreferenceProfile: {
        revision: 0,
        enabled: false,
        rules: [],
      },
      entryAutomationPolicy: {
        revision: 0,
        enabled: false,
        paused: false,
      },
    });
  });

  it('serializes sibling preference updates without losing either field', async () => {
    const {store} = createStore();
    const profileUpdate = store.update(WORKSPACE_A, (current) => ({
      next: patchReviewPreferences(current, {
        entryPreferenceProfile: {
          revision: 1,
          enabled: true,
          rules: [
            {
              ruleId: '44444444-4444-4444-8444-444444444444',
              dimension: 'usefulness',
              featureKind: 'content_keyword',
              featureIdentity: 'postgresql',
              displayValue: 'PostgreSQL',
              effect: 'prefer',
              weight: 5,
            },
          ],
        },
      }),
      result: 'profile',
    }));
    const subscriptionUpdate = store.update(WORKSPACE_A, (current) => ({
      next: patchReviewPreferences(current, {
        sourceSubscriptions: {
          revision: 1,
          subscriptions: [
            {
              subscriptionId: '33333333-3333-4333-8333-333333333333',
              label: 'Synthetic source',
              enabled: false,
              repositoryUri: 'https://github.com/example/project',
              repositoryRef: 'main',
              repositoryPath: 'docs/source.md',
              profile: 'commonmark-v1',
              sourceAlias: 'synthetic-source',
              isPrivate: false,
              routeAfterImport: false,
              intervalMinutes: 1_440,
              cursor: {
                commitSha: '1'.repeat(40),
                sourceSha256: '2'.repeat(64),
              },
            },
          ],
        },
      }),
      result: 'subscription',
    }));

    await expect(
      Promise.all([profileUpdate, subscriptionUpdate]),
    ).resolves.toMatchObject([{result: 'profile'}, {result: 'subscription'}]);
    await expect(store.load(WORKSPACE_A)).resolves.toMatchObject({
      entryPreferenceProfile: {revision: 1, enabled: true},
      sourceSubscriptions: {
        revision: 1,
        subscriptions: [
          {
            subscriptionId: '33333333-3333-4333-8333-333333333333',
            cursor: {
              commitSha: '1'.repeat(40),
              sourceSha256: '2'.repeat(64),
            },
          },
        ],
      },
    });
  });

  it('rejects malformed or cross-workspace preference files', async () => {
    const {root, store} = createStore();
    writeFileSync(
      join(root, `${WORKSPACE_A}.review-preferences.json`),
      JSON.stringify({
        format: 'struinfo.review-preferences',
        version: 1,
        workspaceId: WORKSPACE_B,
        quickTags: ['synthetic'],
      }),
      'utf8',
    );

    await expect(store.load(WORKSPACE_A)).rejects.toMatchObject({
      code: 'preferences_invalid',
    });
    await expect(store.save(WORKSPACE_A, ['one', 'ONE'])).rejects.toMatchObject(
      {code: 'preferences_invalid'},
    );
  });

  it('rejects non-canonical or open preference profile rules', async () => {
    const {root, store} = createStore();
    writeFileSync(
      join(root, WORKSPACE_A + '.review-preferences.json'),
      JSON.stringify({
        format: 'struinfo.review-preferences',
        version: 1,
        workspaceId: WORKSPACE_A,
        quickTags: [],
        entryPreferenceProfile: {
          revision: 1,
          enabled: true,
          rules: [
            {
              ruleId: '44444444-4444-4444-8444-444444444444',
              dimension: 'usefulness',
              featureKind: 'content_keyword',
              featureIdentity: 'PostgreSQL',
              displayValue: 'PostgreSQL',
              effect: 'prefer',
              weight: 5,
              unknown: true,
            },
          ],
        },
      }),
      'utf8',
    );

    await expect(store.load(WORKSPACE_A)).rejects.toMatchObject({
      code: 'preferences_invalid',
    });
  });

  it('rejects malformed external automation policy state', async () => {
    const {root, store} = createStore();
    writeFileSync(
      join(root, WORKSPACE_A + '.review-preferences.json'),
      JSON.stringify({
        format: 'struinfo.review-preferences',
        version: 1,
        workspaceId: WORKSPACE_A,
        quickTags: [],
        entryAutomationPolicy: {
          revision: 1,
          enabled: true,
          paused: false,
          profileRevision: 1,
          minimumMatchedRuleCount: 1,
          advanceThresholds: {
            usefulness: 3,
            interest: 3,
            requiredDimensions: 1,
          },
          deferThresholds: {
            usefulness: 3,
            interest: 3,
            requiredDimensions: 1,
          },
          budgets: {
            maximumEntriesPerRun: 10,
            maximumAdvanceCandidatesPerRun: 11,
            maximumDeferCandidatesPerRun: 5,
          },
          failureMode: 'pause',
        },
      }),
      'utf8',
    );

    await expect(store.load(WORKSPACE_A)).rejects.toMatchObject({
      code: 'preferences_invalid',
    });
  });
});

function createStore(): Readonly<{
  root: string;
  store: LocalReviewPreferencesStore;
}> {
  const parent = mkdtempSync(join(tmpdir(), 'struinfo-review-prefs-'));
  roots.push(parent);
  const root = join(parent, 'preferences');
  mkdirSync(root);
  return {root, store: new LocalReviewPreferencesStore(root)};
}
