import {
  access,
  readFile,
  writeFile,
  rename,
  unlink,
  realpath,
} from 'node:fs/promises';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {
  prepareManifest,
  validateManifest,
  type BatchManifest,
  type PreparationInput,
} from './historical_batch_plan.js';
import {
  advanceBatch,
  BatchApiError,
  type BatchProgress,
  type BatchPorts,
} from './historical_batch_runner.js';

async function external(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('absolute_external_path_required');
  const parent = await realpath(dirname(path));
  let folder = parent;
  for (;;) {
    const inGit = await access(join(folder, '.git')).then(
      () => true,
      () => false,
    );
    if (inGit) throw new Error('batch_files_must_stay_outside_git');
    const up = dirname(folder);
    if (up === folder) break;
    folder = up;
  }
  const repo = await realpath(fileURLToPath(new URL('..', import.meta.url)));
  if (
    !relative(repo, parent).startsWith('..') &&
    !isAbsolute(relative(repo, parent))
  )
    throw new Error('batch_files_must_stay_outside_git');
  const resolved = await realpath(path).catch(() =>
    resolve(parent, path.split(/[\\/]/u).at(-1) ?? ''),
  );
  if (dirname(resolved) !== parent)
    throw new Error('batch_file_link_not_allowed');
  return resolved;
}
async function read<T>(path: string): Promise<T> {
  return JSON.parse(
    (await readFile(path, 'utf8')).replace(/^\uFEFF/u, ''),
  ) as T;
}
async function save(path: string, value: unknown): Promise<void> {
  const temporary = path + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temporary, path);
}
function errorCode(error: unknown): string {
  return error instanceof BatchApiError
    ? error.code
    : error instanceof Error
      ? error.message
      : 'batch_failed';
}

async function main(): Promise<void> {
  const {values, positionals} = parseArgs({
    allowPositionals: true,
    options: {
      input: {type: 'string'},
      out: {type: 'string'},
      manifest: {type: 'string'},
      batch: {type: 'string'},
      origin: {type: 'string'},
      'data-root': {type: 'string'},
      execute: {type: 'boolean', default: false},
    },
  });
  const action = positionals[0];
  if (action === 'prepare') {
    if (!values.input || !values.out)
      throw new Error('prepare_requires_input_and_out');
    const input = await read<PreparationInput>(await external(values.input));
    const manifest = prepareManifest(input),
      output = await external(values.out);
    await writeFile(output, JSON.stringify(manifest, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx',
    });
    process.stdout.write(
      JSON.stringify({
        selected: manifest.articles.length,
        batches: Math.ceil(manifest.articles.length / manifest.batchSize),
        excluded: manifest.excluded.length,
        reserve: manifest.reserve.length,
        executionStarted: false,
      }) + '\n',
    );
    return;
  }
  if (
    !values.manifest ||
    !['status', 'pause', 'resume', 'run'].includes(action ?? '')
  )
    throw new Error(
      'usage_prepare_status_pause_resume_run_with_external_manifest',
    );
  const path = await external(values.manifest),
    manifest = await read<BatchManifest>(path);
  validateManifest(manifest);
  const batch = Number(values.batch ?? 1);
  if (!manifest.articles.some((a) => a.batch === batch))
    throw new Error('batch_not_found');
  const folder = dirname(path),
    progressPath = await external(
      join(folder, `batch-${String(batch)}.progress.json`),
    ),
    controlPath = await external(
      join(folder, `batch-${String(batch)}.control.json`),
    );
  const progress: BatchProgress = await read<BatchProgress>(progressPath).catch(
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return {
        format: 'struinfo.historical-progress.v1' as const,
        manifestId: manifest.id,
        articles: {},
      };
    },
  );
  if (action === 'status') {
    const counts: Record<string, number> = {};
    for (const row of manifest.articles.filter((a) => a.batch === batch)) {
      const status = progress.articles[row.id]?.status ?? 'pending';
      counts[status] = (counts[status] ?? 0) + 1;
    }
    process.stdout.write(
      JSON.stringify({manifestId: manifest.id, batch, counts}) + '\n',
    );
    return;
  }
  if (action === 'pause' || action === 'resume') {
    await save(controlPath, {
      manifestId: manifest.id,
      batch,
      paused: action === 'pause',
    });
    process.stdout.write(
      JSON.stringify({
        batch,
        paused: action === 'pause',
        note: 'The runner observes this control; resume does not start a runner.',
      }) + '\n',
    );
    return;
  }
  if (!values.execute) throw new Error('explicit_execute_required');
  if (!values.origin || !values['data-root'])
    throw new Error('run_requires_origin_and_data_root');
  const origin = new URL(values.origin);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) ||
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('local_owner_origin_required');
  const budgetPath = await external(
    join(
      values['data-root'],
      'exports',
      `${manifest.workspaceId}.ai-batch-budget.json`,
    ),
  );
  const workspaceResponse = await fetch(new URL('/api/v1/workspace', origin), {
    signal: AbortSignal.timeout(30_000),
  });
  const workspace = (await workspaceResponse.json()) as {workspaceId?: string};
  if (!workspaceResponse.ok || workspace.workspaceId !== manifest.workspaceId)
    throw new Error('runtime_workspace_mismatch');
  const lockPath = await external(join(folder, 'runner.lock'));
  try {
    await writeFile(
      lockPath,
      JSON.stringify({pid: process.pid, manifestId: manifest.id, batch}),
      {flag: 'wx'},
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error('runner_lock_exists_check_previous_process', {
        cause: error,
      });
    throw error;
  }
  const ports: BatchPorts = {
    call: async <T>(operation: string, input: unknown = {}) => {
      const channel = operation.startsWith('task') ? 'ai-tasks' : 'ingestion';
      const response = await fetch(
        new URL(`/api/v1/${channel}/commands`, origin),
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json', Origin: origin.origin},
          body: JSON.stringify({operation, input}),
          signal: AbortSignal.timeout(100_000),
        },
      );
      const result = (await response.json()) as {
        result?: T;
        error?: {code?: string};
      };
      if (!response.ok || !('result' in result))
        throw new BatchApiError(result.error?.code ?? 'owner_api_failed');
      return result.result;
    },
    save: (value) => save(progressPath, value),
    paused: async () => {
      const control = await read<{
        manifestId: string;
        batch: number;
        paused: boolean;
      }>(controlPath).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return {manifestId: manifest.id, batch, paused: true};
      });
      if (
        control.manifestId !== manifest.id ||
        control.batch !== batch ||
        typeof control.paused !== 'boolean'
      )
        throw new Error('invalid_batch_control');
      return control.paused;
    },
    budget: async () => {
      const budget = await read<
        Awaited<ReturnType<BatchPorts['budget']>> & {format: string}
      >(budgetPath);
      if (
        budget.format !== 'struinfo.ai-batch-budget.v1' ||
        typeof budget.paused !== 'boolean'
      )
        throw new Error('invalid_batch_budget');
      return budget;
    },
  };
  let last = '';
  try {
    for (;;) {
      const result = await advanceBatch(manifest, progress, batch, ports);
      if (result !== last)
        process.stdout.write(
          JSON.stringify({
            at: new Date().toISOString(),
            batch,
            status: result,
          }) + '\n',
        );
      last = result;
      if (['paused', 'settled', 'budget_wait'].includes(result)) break;
      await delay(result === 'dispatch_wait' ? 30_000 : 5000);
    }
  } finally {
    await unlink(lockPath);
  }
}

// Importing planning/runner modules is side-effect free; only this CLI performs IO.
void main().catch((error: unknown) => {
  process.stderr.write(errorCode(error) + '\n');
  process.exitCode = 1;
});
