import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {createLocalStorageServices} from './local_storage_services.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0).reverse()) {
    rmSync(root, {recursive: true, force: true});
  }
});

describe('createLocalStorageServices', () => {
  it('returns an operational Blob port backed by the initialized external root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'struinfo-storage-services-'));
    temporaryRoots.push(root);
    const services = await createLocalStorageServices(root);
    const bytes = new TextEncoder().encode('synthetic storage service');

    const identity = await services.blobStore.put(bytes);

    await expect(services.blobStore.read(identity)).resolves.toEqual(bytes);
    await expect(
      services.reviewPreferences.load('11111111-1111-4111-8111-111111111111'),
    ).resolves.toMatchObject({quickTags: []});
    expect(Object.isFrozen(services)).toBe(true);
  });
});
