import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

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
