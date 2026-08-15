import {spawn} from 'node:child_process';
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {
  admitTm2Environment,
  createPoisonPgPassLine,
  sanitizePgEnvironment,
  type AcceptedTm2Environment,
} from '../../apps/server/test_support/postgres_tm2/environment_oracle.js';

interface ChildResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

type JsonRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function emit(record: Readonly<Record<string, unknown>>): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function collectFailedMandatoryIds(value: unknown, target: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFailedMandatoryIds(item, target);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  const status = value.status;
  if (status === 'failed' || status === 'fail') {
    for (const key of ['fullName', 'title', 'name']) {
      const candidate = value[key];
      if (typeof candidate === 'string') {
        for (const match of candidate.matchAll(/PG-TM2-[0-9]{3}/g)) {
          target.add(match[0]);
        }
      }
    }
  }
  for (const child of Object.values(value)) {
    collectFailedMandatoryIds(child, target);
  }
}

async function runChild(
  environment: NodeJS.ProcessEnv,
  reportPath: string,
): Promise<ChildResult> {
  const vitestEntry = join(
    process.cwd(),
    'node_modules',
    'vitest',
    'vitest.mjs',
  );
  const child = spawn(
    process.execPath,
    [
      vitestEntry,
      'run',
      '--config',
      'vitest.postgres.config.ts',
      '--reporter=json',
      `--outputFile=${reportPath}`,
    ],
    {
      cwd: process.cwd(),
      env: environment,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  return await new Promise<ChildResult>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => {
      resolve({exitCode, signal});
    });
  });
}

function getAcceptedConfigurations(admission: AcceptedTm2Environment) {
  return [
    admission.admin.config,
    admission.migration.config,
    admission.runtime.config,
  ] as const;
}

async function createIsolatedCredentialRoots(
  root: string,
  admission: AcceptedTm2Environment,
): Promise<{
  readonly home: string;
  readonly userProfile: string;
  readonly appData: string;
}> {
  const home = join(root, 'home');
  const userProfile = join(root, 'user-profile');
  const appData = join(root, 'app-data');
  const windowsPgDirectory = join(appData, 'postgresql');
  await Promise.all([
    mkdir(home, {recursive: true}),
    mkdir(userProfile, {recursive: true}),
    mkdir(windowsPgDirectory, {recursive: true}),
  ]);
  const contents = `${getAcceptedConfigurations(admission)
    .map(createPoisonPgPassLine)
    .join('\n')}\n`;
  const posixPath = join(home, '.pgpass');
  const windowsPath = join(windowsPgDirectory, 'pgpass.conf');
  await Promise.all([
    writeFile(posixPath, contents, {encoding: 'utf8', mode: 0o600}),
    writeFile(windowsPath, contents, {encoding: 'utf8'}),
  ]);
  await chmod(posixPath, 0o600);
  return {home, userProfile, appData};
}

async function main(): Promise<number> {
  const admission = admitTm2Environment(process.env);
  if (admission.status === 'not_ready') {
    emit({
      event: 'postgres_tm2_not_ready',
      outcome: 'not_ready',
      code: admission.code,
      variable: admission.variable,
    });
    return 2;
  }

  const taskRoot = await mkdtemp(join(tmpdir(), 'struinfo-pg-tm2-'));
  try {
    const roots = await createIsolatedCredentialRoots(taskRoot, admission);
    const childEnvironment = sanitizePgEnvironment(process.env, roots);
    delete childEnvironment.DATABASE_URL;
    childEnvironment.STRUIINFO_MIGRATION_DATABASE_URL =
      process.env.STRUIINFO_TM2_MIGRATION_DATABASE_URL ?? '';
    childEnvironment.STRUIINFO_TM2_ADMISSION_PROVEN = '1';
    childEnvironment.STRUIINFO_TM2_POISON_ROOT = taskRoot;
    const reportPath = join(taskRoot, 'vitest-result.json');
    const result = await runChild(childEnvironment, reportPath);

    if (result.exitCode === 0 && result.signal === null) {
      emit({
        event: 'postgres_tm2_complete',
        outcome: 'pass',
        mandatory: 488,
      });
      return 0;
    }

    const failedIds = new Set<string>();
    try {
      const report = JSON.parse(await readFile(reportPath, 'utf8')) as unknown;
      collectFailedMandatoryIds(report, failedIds);
    } catch {
      // A missing or malformed report is represented by a stable harness code.
    }
    emit({
      event: 'postgres_tm2_failed',
      outcome: 'failed',
      code: 'mandatory_failure',
      vectors: [...failedIds].sort(),
    });
    return 1;
  } finally {
    await rm(taskRoot, {recursive: true, force: false});
  }
}

try {
  process.exitCode = await main();
} catch {
  emit({
    event: 'postgres_tm2_failed',
    outcome: 'failed',
    code: 'harness_failure',
  });
  process.exitCode = 1;
}
