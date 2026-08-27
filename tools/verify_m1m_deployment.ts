import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export class M1mDeploymentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'M1mDeploymentError';
  }
}

export interface M1mDeploymentSources {
  readonly dockerfile: string;
  readonly compose: string;
  readonly maintenanceCompose: string;
  readonly runtimeExample: string;
  readonly runtimeGrants: string;
}

export function validateM1mDeploymentSources(
  sources: Readonly<M1mDeploymentSources>,
): void {
  requireAll(sources.dockerfile, [
    'FROM node:24-bookworm-slim AS build',
    'FROM node:24-bookworm-slim AS runtime',
    'pnpm --filter @struinfo/server deploy --prod --legacy /runtime-server',
    'USER 10001:10001',
    'CMD ["node", "dist/entrypoints/all.js"]',
  ]);
  rejectAny(sources.dockerfile, [/(?:^|\n)\s*ADD\s/iu, /COPY\s+\.\s+\./iu]);

  requireAll(sources.compose, [
    'read_only: true',
    'cap_drop:',
    '- ALL',
    'no-new-privileges:true',
    '127.0.0.1:${STRUIINFO_HTTP_PORT:-3000}:3000',
    'DATABASE_URL_FILE: /run/secrets/runtime_database_url',
    "fetch('http://127.0.0.1:3000/health/ready')",
    'profiles: [maintenance]',
  ]);
  if (
    !/^x-struinfo-common:[\s\S]*?^\s{2}read_only: true$/mu.test(sources.compose)
  ) {
    throw new M1mDeploymentError(
      'Every M1M container must inherit a read-only root filesystem.',
    );
  }
  rejectSecretAssignments(sources.compose);
  if (sources.compose.includes('migration_database_url')) {
    throw new M1mDeploymentError(
      'The ordinary application manifest must not request a migration secret.',
    );
  }

  requireAll(sources.maintenanceCompose, [
    'read_only: true',
    '- ALL',
    'no-new-privileges:true',
    'profiles: [maintenance]',
    'STRUIINFO_MIGRATION_DATABASE_URL_FILE: /run/secrets/migration_database_url',
    'command: [node, dist/entrypoints/migrate.js]',
    'command: [node, dist/entrypoints/prepare_queue.js]',
  ]);
  rejectSecretAssignments(sources.maintenanceCompose);

  const exampleLines = meaningfulLines(sources.runtimeExample);
  const allowedExampleKeys = new Set([
    'STRUIINFO_DATA_ROOT',
    'STRUIINFO_WORKSPACE_ID',
    'STRUIINFO_HOST',
    'STRUIINFO_PORT',
    'STRUIINFO_LOG_LEVEL',
    'STRUIINFO_SHUTDOWN_TIMEOUT_MS',
  ]);
  for (const line of exampleLines) {
    const separator = line.indexOf('=');
    if (separator <= 0 || !allowedExampleKeys.has(line.slice(0, separator))) {
      throw new M1mDeploymentError(
        'The container runtime example contains an undeclared key.',
      );
    }
  }
  requireAll(sources.runtimeExample, [
    'STRUIINFO_DATA_ROOT=/var/lib/struinfo',
    'STRUIINFO_HOST=0.0.0.0',
  ]);
  rejectSecretAssignments(sources.runtimeExample);

  requireAll(sources.runtimeGrants, [
    '\\set ON_ERROR_STOP on',
    'REVOKE ALL ON SCHEMA struinfo_meta FROM struinfo_tm2_runtime',
    'GRANT USAGE ON SCHEMA struinfo TO struinfo_tm2_runtime',
    'GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA struinfo TO struinfo_tm2_runtime',
    'GRANT USAGE ON SCHEMA pgboss TO struinfo_tm2_runtime',
    'REVOKE CREATE, TEMPORARY ON DATABASE',
    'FROM PUBLIC, struinfo_tm2_runtime',
  ]);
  rejectAny(sources.runtimeGrants, [
    /\bCREATE\s+ROLE\b/iu,
    /\bALTER\s+ROLE\b/iu,
    /\bPASSWORD\b/iu,
    /\bGRANT\s+ALL\s+(?:PRIVILEGES\s+)?ON\s+DATABASE\b/iu,
    /\bGRANT\s+CREATE\b/iu,
  ]);

  const joined = Object.values(sources).join('\n');
  rejectAny(joined, [
    /-----BEGIN [^-\r\n]*PRIVATE KEY-----/u,
    /\b(?:postgres|postgresql):\/\/[^\s/:@]+:[^\s/@]+@/iu,
    /\b[A-Za-z]:\\Users\\[^\\\s"']+\\/u,
  ]);
}

export function verifyM1mDeployment(repositoryRoot: string): void {
  const read = (relativePath: string) =>
    readFileSync(join(repositoryRoot, ...relativePath.split('/')), 'utf8');
  validateM1mDeploymentSources({
    dockerfile: read('Dockerfile'),
    compose: read('compose.production.yaml'),
    maintenanceCompose: read('compose.maintenance.yaml'),
    runtimeExample: read('deploy/runtime.container.env.example'),
    runtimeGrants: read('deploy/postgresql/apply-runtime-grants.sql'),
  });
}

function requireAll(source: string, required: readonly string[]): void {
  if (required.some((value) => !source.includes(value))) {
    throw new M1mDeploymentError(
      'The M1M deployment source is missing a required boundary.',
    );
  }
}

function rejectAny(source: string, patterns: readonly RegExp[]): void {
  if (patterns.some((pattern) => pattern.test(source))) {
    throw new M1mDeploymentError(
      'The M1M deployment source contains a forbidden boundary.',
    );
  }
}

function rejectSecretAssignments(source: string): void {
  rejectAny(source, [
    /(?:^|\n)\s*(?:DATABASE_URL|OPENAI_API_KEY|STRUIINFO_MIGRATION_DATABASE_URL)\s*:\s*[^\s$]/u,
    /(?:^|\n)\s*(?:DATABASE_URL|OPENAI_API_KEY|STRUIINFO_MIGRATION_DATABASE_URL)\s*=\s*\S+/u,
  ]);
}

function meaningfulLines(source: string): readonly string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function isMainModule(): boolean {
  const entryPath = process.argv[1];
  return (
    entryPath !== undefined &&
    import.meta.url === pathToFileURL(resolve(entryPath)).href
  );
}

if (isMainModule()) {
  try {
    verifyM1mDeployment(process.cwd());
    process.stdout.write('Verified M1M deployment source boundary.\n');
  } catch (error) {
    const message =
      error instanceof M1mDeploymentError
        ? error.message
        : 'M1M deployment verification failed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
