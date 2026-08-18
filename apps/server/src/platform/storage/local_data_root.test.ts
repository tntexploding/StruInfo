import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, parse} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {
  ensurePrivateSubdirectory,
  initializeLocalDataRoot,
  LOCAL_DATA_AREA_NAMES,
  LocalDataRootError,
} from './local_data_root.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0).reverse()) {
    rmSync(root, {recursive: true, force: true});
  }
});

describe('initializeLocalDataRoot', () => {
  it('creates the five fixed external data areas and returns canonical paths', async () => {
    const root = createTemporaryRoot();

    const layout = await initializeLocalDataRoot(root);

    expect(layout.root).toBe(await realpath(root));
    expect(Object.keys(layout.areaRoots).sort()).toEqual(
      [...LOCAL_DATA_AREA_NAMES].sort(),
    );
    for (const area of LOCAL_DATA_AREA_NAMES) {
      const areaRoot = layout.areaRoots[area];
      expect(areaRoot).toBe(await realpath(join(root, area)));
      const status = lstatSync(areaRoot);
      expect(status.isDirectory()).toBe(true);
      expect(status.isSymbolicLink()).toBe(false);
    }
    expect(Object.isFrozen(layout)).toBe(true);
    expect(Object.isFrozen(layout.areaRoots)).toBe(true);
  });

  it('reopens an existing valid layout idempotently', async () => {
    const root = createTemporaryRoot();

    const first = await initializeLocalDataRoot(root);
    const second = await initializeLocalDataRoot(root);

    expect(second).toEqual(first);
  });

  it('rejects relative and filesystem-root data locations', async () => {
    await expect(
      initializeLocalDataRoot('relative-data'),
    ).rejects.toMatchObject({
      code: 'root_invalid',
    });

    const root = createTemporaryRoot();
    await expect(
      initializeLocalDataRoot(parse(root).root),
    ).rejects.toMatchObject({code: 'root_invalid'});
  });

  it('rejects a reserved area occupied by a regular file without echoing the path', async () => {
    const root = createTemporaryRoot();
    const occupiedPath = join(root, 'uploads');
    writeFileSync(occupiedPath, 'synthetic occupied area', {encoding: 'utf8'});

    const error = await captureDataRootError(() =>
      initializeLocalDataRoot(root),
    );

    expect(error.code).toBe('area_unsafe');
    expect(error.message).not.toContain(root);
    expect(error.message).not.toContain(occupiedPath);
  });

  it('rejects a reserved area implemented as a symlink or junction', async () => {
    const root = createTemporaryRoot();
    const linkedTarget = join(root, 'linked-target');
    mkdirSync(linkedTarget);
    symlinkSync(
      linkedTarget,
      join(root, 'backups'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(initializeLocalDataRoot(root)).rejects.toMatchObject({
      code: 'area_unsafe',
    });
  });
});

describe('ensurePrivateSubdirectory', () => {
  it.each(['../escape', 'nested/path', '', '.hidden', 'UpperCase'])(
    'rejects unsafe internal directory segment %j',
    async (name) => {
      const root = createTemporaryRoot();

      await expect(ensurePrivateSubdirectory(root, name)).rejects.toMatchObject(
        {code: 'area_name_invalid'},
      );
      expect(lstatSync(root).isDirectory()).toBe(true);
    },
  );
});

function createTemporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'struinfo-data-root-'));
  temporaryRoots.push(root);
  return root;
}

async function captureDataRootError(
  operation: () => Promise<unknown>,
): Promise<LocalDataRootError> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof LocalDataRootError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected local data-root initialization to fail.');
}
