import {execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

// Creates its own empty database; never accepts an instance URL or loads .env.
const container = 'struinfo-p1-test-' + randomUUID();
const output = await mkdtemp(join(tmpdir(), 'struinfo-p1-'));
const docker = (...args: string[]) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
let created = false;
try {
  docker(
    'run',
    '--detach',
    '--name',
    container,
    '--publish',
    '127.0.0.1::5432',
    '--env',
    'POSTGRES_DB=struinfo_p1_test',
    '--env',
    'POSTGRES_USER=struinfo_test',
    '--env',
    'POSTGRES_PASSWORD=synthetic-test-only',
    'postgres:18.6',
  );
  created = true;
  const port = docker('port', container, '5432/tcp').split(':').at(-1);
  if (!port || !/^\d+$/u.test(port))
    throw new Error('Temporary PostgreSQL port missing');
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try {
      docker(
        'exec',
        container,
        'pg_isready',
        '-U',
        'struinfo_test',
        '-d',
        'struinfo_p1_test',
      );
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!ready) throw new Error('Temporary PostgreSQL did not start');
  const child = spawn(
    process.execPath,
    [
      resolve('node_modules/vitest/vitest.mjs'),
      'run',
      '--config',
      'vitest.config.ts',
      'apps/server/src/application/document_publication.postgres.test.ts',
    ],
    {
      env: {
        ...process.env,
        STRUINFO_P1_TEST_PORT: port,
        STRUINFO_P1_TEST_CONTAINER: container,
        STRUINFO_P1_TEST_ROOT: output,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let log = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk: Buffer) => {
      log += chunk.toString();
      process.stdout.write(chunk);
    });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      resolve(code ?? 1);
    });
  });
  await writeFile(join(output, 'acceptance.log'), log);
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      {
        scope: 'synthetic_empty_postgres',
        exitCode,
        modelCalls: 0,
        productionChanged: false,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write('P1 evidence: ' + output + '\n');
  process.exitCode = exitCode;
} finally {
  if (created) docker('rm', '--force', '--volumes', container);
}
