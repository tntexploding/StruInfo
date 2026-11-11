import {access, readFile, writeFile, realpath} from 'node:fs/promises';
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
  attachManifest,
  type BatchStatus,
  type HistoryCommand,
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
async function main(): Promise<void> {
  const {values, positionals} = parseArgs({
    allowPositionals: true,
    options: {
      input: {type: 'string'},
      out: {type: 'string'},
      manifest: {type: 'string'},
      session: {type: 'string'},
      batch: {type: 'string'},
      origin: {type: 'string'},
      'data-root': {type: 'string'},
      execute: {type: 'boolean', default: false},
      'retry-failed': {type: 'boolean', default: false},
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
    !action ||
    !['status', 'pause', 'resume', 'capture', 'run'].includes(action) ||
    !values.origin ||
    Boolean(values.session) === Boolean(values.manifest)
  )
    throw new Error('use_origin_and_either_session_or_manifest');
  const origin = new URL(values.origin);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) ||
    !['https:', 'http:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('local_owner_origin_required');
  const call: HistoryCommand = async <T>(
    operation: string,
    input: unknown = {},
  ) => {
    const response = await fetch(
      new URL('/api/v1/ingestion/commands', origin),
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Origin: origin.origin},
        body: JSON.stringify({operation, input}),
        signal: AbortSignal.timeout(120000),
      },
    );
    const value = (await response.json()) as {
      result?: T;
      error?: {code: string};
    };
    if (!response.ok || value.result === undefined)
      throw new Error(value.error?.code ?? 'owner_api_failed');
    return value.result;
  };
  let sessionId = values.session,
    manifest: BatchManifest | undefined,
    expectedBudget: string | undefined;
  if (values.manifest) {
    const path = await external(values.manifest);
    manifest = await read<BatchManifest>(path);
    const manifestId = manifest.id;
    validateManifest(manifest);
    const workspaceResponse = await fetch(
      new URL('/api/v1/workspace', origin),
      {signal: AbortSignal.timeout(30000)},
    );
    const workspace = (await workspaceResponse.json()) as {
      workspaceId?: string;
    };
    if (!workspaceResponse.ok || workspace.workspaceId !== manifest.workspaceId)
      throw new Error('runtime_workspace_mismatch');
    const batch = Number(values.batch ?? 1);
    if (!manifest.articles.some((a) => a.batch === batch))
      throw new Error('batch_not_found');
    expectedBudget = manifest.id + '-' + String(batch);
    const known = (await call<BatchStatus>('history_status')).sessions.find(
      (s) => s.batchKey === expectedBudget,
    );
    sessionId = known?.sessionId;
    if (['run', 'capture'].includes(action)) {
      if (!values.execute) throw new Error('explicit_execute_required');
      if (
        await access(join(dirname(path), 'runner.lock')).then(
          () => true,
          () => false,
        )
      )
        throw new Error('legacy_runner_lock_exists');
      const old = await read<{
        format: string;
        manifestId: string;
        articles: Record<
          string,
          {status: string; snapshotId?: string; taskId?: string}
        >;
      }>(
        await external(
          join(dirname(path), 'batch-' + String(batch) + '.progress.json'),
        ),
      ).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return undefined;
      });
      if (
        old &&
        (old.format !== 'struinfo.historical-progress.v1' ||
          old.manifestId !== manifest.id)
      )
        throw new Error('batch_progress_mismatch');
      const owned: Record<string, string | null> = {};
      for (const a of manifest.articles) {
        const prior = old?.articles[a.id];
        if (
          a.batch === batch &&
          prior &&
          prior.status !== 'existing' &&
          (prior.status === 'importing' || prior.snapshotId)
        )
          owned[a.id] = prior.snapshotId ?? null;
      }
      sessionId = await attachManifest(manifest, batch, call, owned);
      if (old && !known?.plan) {
        const control = await read<{
          manifestId: string;
          batch: number;
          paused: boolean;
        }>(
          await external(
            join(dirname(path), 'batch-' + String(batch) + '.control.json'),
          ),
        ).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          return {manifestId, batch, paused: true};
        });
        if (
          control.manifestId !== manifest.id ||
          control.batch !== batch ||
          typeof control.paused !== 'boolean'
        )
          throw new Error('invalid_batch_control');
        if (control.paused) {
          process.stdout.write(
            JSON.stringify({
              sessionId,
              work: null,
              status: 'legacy_pause_preserved',
            }) + '\n',
          );
          return;
        }
      }
    }
    if (!sessionId && action === 'status') {
      process.stdout.write(
        JSON.stringify({
          batchKey: expectedBudget,
          status: 'prepared',
          submitted: false,
        }) + '\n',
      );
      return;
    }
  }
  if (!sessionId) throw new Error('history_session_not_found');
  const status = () => call<BatchStatus>('history_status', {sessionId});
  const current = await status(),
    s = current.sessions[0];
  if (!s) throw new Error('history_session_not_found');
  if (action === 'status') {
    process.stdout.write(JSON.stringify(s) + '\n');
    return;
  }
  if (action === 'pause') {
    await call('history_run', {sessionId, action: 'pause'});
  } else {
    if (!s.plan) throw new Error('history_selection_required');
    if (['run', 'capture'].includes(action) && !values.execute)
      throw new Error('explicit_execute_required');
    const process =
      action === 'run' ||
      (action === 'resume' && s.plan.processing !== undefined);
    if (
      action === 'resume' &&
      !s.plan.pending &&
      !s.plan.processing &&
      !(values['retry-failed'] && s.plan.failed)
    )
      throw new Error('nothing_to_resume');
    await call(
      'history_run',
      process
        ? {
            sessionId,
            planId: s.plan.planId,
            action: 'process',
            retryFailed: values['retry-failed'],
            budgetId:
              expectedBudget ??
              s.plan.processing?.budgetId ??
              current.budget?.batchId,
            ...(manifest ? {maxModelCalls: manifest.task.maxModelCalls} : {}),
            ...(manifest?.format === 'struinfo.historical-batch.v1' &&
            manifest.task.maxEntries
              ? {legacyEntryLimit: manifest.task.maxEntries}
              : {}),
          }
        : {
            sessionId,
            planId: s.plan.planId,
            action: 'import',
            retryFailed: values['retry-failed'],
          },
    );
  }
  let last = '';
  for (;;) {
    const row = (await status()).sessions[0];
    if (!row) throw new Error('history_session_not_found');
    const line = JSON.stringify(row);
    if (line !== last) process.stdout.write(line + '\n');
    last = line;
    if (
      !['capture', 'run'].includes(action) ||
      !row.work ||
      row.plan?.processing?.wait === 'budget_wait'
    )
      break;
    await delay(3000);
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    (error instanceof Error ? error.message : 'batch_failed') + '\n',
  );
  process.exitCode = 1;
});
