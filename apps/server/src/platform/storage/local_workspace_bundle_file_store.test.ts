import {mkdtempSync, rmSync} from 'node:fs';
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
});
