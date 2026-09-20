import {describe, it, expect, vi} from 'vitest';
import {PostgresAgentTaskRepository} from './postgres_agent_task_repository.js';
import type {PostgresPoolBoundary} from './postgres_pool.js';
const W = '00000000-0000-4000-8000-000000000001',
  T = '00000000-0000-4000-8000-000000000002';
describe('durable task repository', () => {
  it('releases a task lock even when an application action fails', async () => {
    const release = vi.fn();
    const query = vi.fn(() =>
      Promise.resolve({rows: [{locked: true}], rowCount: 1}),
    );
    const pool = {
      connect: () => Promise.resolve({query, release}),
    } as unknown as PostgresPoolBoundary;
    const repository = new PostgresAgentTaskRepository(pool);
    await expect(
      repository.withLock(W, T, () =>
        Promise.reject(new Error('synthetic failure')),
      ),
    ).rejects.toThrow('synthetic failure');
    expect(query.mock.calls).toHaveLength(2);
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('does not execute when another process holds the task lock', async () => {
    const action = vi.fn(() => Promise.resolve());
    const release = vi.fn(),
      query = vi.fn(() =>
        Promise.resolve({rows: [{locked: false}], rowCount: 1}),
      );
    const repository = new PostgresAgentTaskRepository({
      connect: () => Promise.resolve({query, release}),
    } as unknown as PostgresPoolBoundary);
    await expect(repository.withLock(W, T, action)).rejects.toMatchObject({
      code: 'task_busy',
    });
    expect(action).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalled();
  });
  it('uses versioned controls independently of progress and validates stored state', async () => {
    const query = vi.fn<
      (
        sql: string,
        values?: readonly unknown[],
      ) => Promise<{rows: never[]; rowCount: number}>
    >(() => Promise.resolve({rows: [], rowCount: 0}));
    const repository = new PostgresAgentTaskRepository({
      query,
    } as unknown as PostgresPoolBoundary);
    expect(await repository.control(W, T, 7, 'cancel')).toBe(false);
    expect(query.mock.calls[0]?.[1]).toEqual([W, T, 7, true, true]);
    await repository.control(W, T, 8, 'resume');
    expect(query.mock.calls[1]?.[1]).toEqual([W, T, 8, false, false]);
    await expect(
      repository.saveState(W, T, {
        status: 'running',
        phase: 'split',
        calls: 65,
        steps: [],
      }),
    ).rejects.toThrow();
  });
});

it('filters selected document history in SQL before limiting recent tasks', async () => {
  const query = vi.fn(() => Promise.resolve({rows: [], rowCount: 0}));
  const repository = new PostgresAgentTaskRepository({
    query,
  } as unknown as PostgresPoolBoundary);
  await repository.list(W, [T]);
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining(
      "request_text::jsonb->>'snapshotId'=ANY($2::text[])",
    ),
    [W, [T]],
  );
  expect(query).toHaveBeenCalledWith(
    expect.stringMatching(
      /WHERE workspace_id=\$1.*snapshotId.*ORDER BY.*LIMIT 100/u,
    ),
    [W, [T]],
  );
});

it('keeps unfinished overview tasks ahead of newer history before the page limit', async () => {
  const query = vi.fn(() => Promise.resolve({rows: [], rowCount: 0}));
  const repository = new PostgresAgentTaskRepository({
    query,
  } as unknown as PostgresPoolBoundary);
  await repository.list(W, undefined, true);
  expect(query).toHaveBeenCalledWith(
    expect.stringMatching(
      /WHERE workspace_id=\$1 ORDER BY CASE.*'running' THEN 0.*'paused' THEN 2.*LIMIT 100/u,
    ),
    [W],
  );
  await repository.list(W);
  expect(query).toHaveBeenLastCalledWith(
    expect.stringContaining('ORDER BY created_at DESC,task_id DESC LIMIT 100'),
    [W],
  );
});
