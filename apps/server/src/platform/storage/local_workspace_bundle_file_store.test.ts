import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {LocalWorkspaceBundleFileStore} from './local_workspace_bundle_file_store.js';

const roots: string[] = [];
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const EXPORTED_AT = '2040-01-02T03:04:05.000Z';

afterEach(() => {
  for (const root of roots.splice(0).reverse()) {
    rmSync(root, {recursive: true, force: true});
  }
});

describe('LocalWorkspaceBundleFileStore', () => {
  it('atomically writes and reads a direct-child external personal-data file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'struinfo-bundle-files-'));
    roots.push(root);
    const store = new LocalWorkspaceBundleFileStore(root);
    const bytes = new TextEncoder().encode('{"synthetic":true}\n');

    const stored = await store.write(WORKSPACE_ID, EXPORTED_AT, bytes);

    expect(stored.fileName).toMatch(/\.personal-data\.json$/u);
    expect(stored.byteLength).toBe(bytes.byteLength);
    await expect(store.read(stored.fileName)).resolves.toEqual(bytes);
  });

  it('rejects traversal and reports a missing safe file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'struinfo-bundle-files-'));
    roots.push(root);
    const store = new LocalWorkspaceBundleFileStore(root);

    await expect(
      store.read('../outside.workspace-bundle.json'),
    ).rejects.toEqual(expect.objectContaining({code: 'file_name_invalid'}));
    await expect(store.read('missing.workspace-bundle.json')).rejects.toEqual(
      expect.objectContaining({code: 'file_not_found'}),
    );
    await expect(store.read('missing.personal-data.json')).rejects.toEqual(
      expect.objectContaining({code: 'file_not_found'}),
    );
  });

  it('lists current workspace backups newest first and ignores unrelated files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'struinfo-bundle-files-'));
    roots.push(root);
    const store = new LocalWorkspaceBundleFileStore(root);
    const first = await store.write(
      WORKSPACE_ID,
      '2040-01-02T03:04:05.000Z',
      new Uint8Array([1]),
    );
    const second = await store.write(
      WORKSPACE_ID,
      '2040-01-03T03:04:05.000Z',
      new Uint8Array([1, 2]),
    );
    await store.write(
      '22222222-2222-4222-8222-222222222222',
      '2040-01-04T03:04:05.000Z',
      new Uint8Array([1, 2, 3]),
    );
    writeFileSync(join(root, 'operator-note.txt'), 'synthetic');
    writeFileSync(
      join(
        root,
        `${WORKSPACE_ID}-20401399030405000-33333333-3333-4333-8333-333333333333.personal-data.json`,
      ),
      'synthetic',
    );

    await expect(store.list(WORKSPACE_ID, 10)).resolves.toEqual({
      totalCount: 2,
      entries: [
        {
          fileName: second.fileName,
          exportedAt: '2040-01-03T03:04:05.000Z',
          byteLength: 2,
        },
        {
          fileName: first.fileName,
          exportedAt: '2040-01-02T03:04:05.000Z',
          byteLength: 1,
        },
      ],
    });
  });

  it('previews retention without deleting any backup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'struinfo-bundle-files-'));
    roots.push(root);
    const store = new LocalWorkspaceBundleFileStore(root);
    const first = await store.write(
      WORKSPACE_ID,
      '2040-01-01T03:04:05.000Z',
      new Uint8Array([1]),
    );
    const second = await store.write(
      WORKSPACE_ID,
      '2040-01-02T03:04:05.000Z',
      new Uint8Array([2]),
    );
    const third = await store.write(
      WORKSPACE_ID,
      '2040-01-03T03:04:05.000Z',
      new Uint8Array([3]),
    );

    await expect(store.previewRetention(WORKSPACE_ID, 2)).resolves.toEqual({
      keepLatest: 2,
      totalCount: 3,
      retainedCount: 2,
      removalCandidateCount: 1,
      removalCandidates: [first.fileName],
      truncated: false,
    });
    await expect(store.read(second.fileName)).resolves.toEqual(
      new Uint8Array([2]),
    );
    await expect(store.read(third.fileName)).resolves.toEqual(
      new Uint8Array([3]),
    );
    await expect(store.read(first.fileName)).resolves.toEqual(
      new Uint8Array([1]),
    );
  });
});
