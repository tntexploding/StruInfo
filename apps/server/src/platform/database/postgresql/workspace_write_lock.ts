import {createHash} from 'node:crypto';

import type {PostgresClientBoundary} from './postgres_pool.js';
import {PostgresAdapterError} from './postgres_values.js';

export const WORKSPACE_WRITE_LOCK_VERSION =
  'struinfo:workspace-write-lock:v1' as const;
export const ACQUIRE_WORKSPACE_WRITE_LOCK_SQL =
  'SELECT pg_advisory_xact_lock($1::bigint)' as const;
export const READ_WORKSPACE_SQL =
  'SELECT workspace_id FROM struinfo.workspace WHERE workspace_id = $1' as const;

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function deriveWorkspaceWriteLockKey(workspaceId: string): string {
  if (!CANONICAL_UUID.test(workspaceId)) {
    throw new PostgresAdapterError();
  }
  const digest = createHash('sha256')
    .update(`${WORKSPACE_WRITE_LOCK_VERSION}:${workspaceId}`, 'utf8')
    .digest();
  const unsigned = digest.readBigUInt64BE(0);
  const signed = unsigned >= 1n << 63n ? unsigned - (1n << 64n) : unsigned;
  return signed.toString(10);
}

export async function acquireWorkspaceWriteLock(
  client: PostgresClientBoundary,
  workspaceId: string,
): Promise<void> {
  await client.query(ACQUIRE_WORKSPACE_WRITE_LOCK_SQL, [
    deriveWorkspaceWriteLockKey(workspaceId),
  ]);
  const workspace = await client.query<Readonly<{workspace_id: unknown}>>(
    READ_WORKSPACE_SQL,
    [workspaceId],
  );
  if (
    workspace.rows.length !== 1 ||
    workspace.rows[0]?.workspace_id !== workspaceId
  ) {
    throw new PostgresAdapterError();
  }
}
