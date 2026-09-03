import {statfs} from 'node:fs/promises';

import type {M2P5cFilesystemObservation} from '../../operations/m2_p5c_operational_status.js';

/** Reads aggregate filesystem capacity without exposing the configured path. */
export async function observeLocalFilesystemCapacity(
  root: string,
): Promise<Readonly<M2P5cFilesystemObservation>> {
  const status = await statfs(root, {bigint: true});
  const totalBytes = status.bsize * status.blocks;
  const availableBytes = status.bsize * status.bavail;
  if (totalBytes <= 0n || availableBytes < 0n || availableBytes > totalBytes) {
    throw new Error('The external data filesystem capacity is unavailable.');
  }
  const availablePercentBasisPoints = Number(
    (availableBytes * 10_000n) / totalBytes,
  );
  return Object.freeze({
    totalBytes: totalBytes.toString(10),
    availableBytes: availableBytes.toString(10),
    availablePercentBasisPoints,
  });
}
