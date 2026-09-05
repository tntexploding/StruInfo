import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {observeLocalFilesystemCapacity} from './local_filesystem_capacity.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true})));
});

describe('local filesystem capacity observation', () => {
  it('returns decimal byte counts without exposing the observed path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'struinfo-capacity-'));
    roots.push(root);

    const result = await observeLocalFilesystemCapacity(root);

    expect(result.totalBytes).toMatch(/^[1-9][0-9]*$/u);
    expect(result.availableBytes).toMatch(/^(0|[1-9][0-9]*)$/u);
    expect(BigInt(result.availableBytes)).toBeLessThanOrEqual(
      BigInt(result.totalBytes),
    );
    expect(result.availablePercentBasisPoints).toBeGreaterThanOrEqual(0);
    expect(result.availablePercentBasisPoints).toBeLessThanOrEqual(10_000);
    expect(JSON.stringify(result)).not.toContain(root);
    expect(Object.isFrozen(result)).toBe(true);
  });
});
