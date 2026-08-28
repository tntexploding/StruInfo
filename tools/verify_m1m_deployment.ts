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
  readonly rootPackage: string;
  readonly projectLicense: string;
  readonly dockerignore: string;
  readonly dockerfile: string;
  readonly compose: string;
  readonly maintenanceCompose: string;
  readonly runtimeExample: string;
  readonly runtimeGrants: string;
  readonly productionOperations: string;
}

export function validateM1mDeploymentSources(
  sources: Readonly<M1mDeploymentSources>,
): void {
  validateRootStartScripts(sources.rootPackage);
  requireAll(sources.projectLicense, [
    'MIT License',
    'Permission is hereby granted, free of charge',
    'THE SOFTWARE IS PROVIDED "AS IS"',
  ]);
  requireAll(sources.dockerignore, [
    '.git',
    '.agents',
    'node_modules',
    '**/node_modules',
    'backups',
    'exports',
    'workspace-data',
  ]);

  requireAll(sources.dockerfile, [
    'FROM node:24-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build',
    'FROM node:24-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS runtime',
    'RUN --network=none pnpm run build',
    'RUN --network=none pnpm --offline --config.trust-lockfile=true --config.inject-workspace-packages=true --filter @struinfo/server deploy --prod --no-optional /runtime-server',
    'COPY --from=build --chown=10001:10001 /workspace/LICENSE /opt/struinfo/LICENSE',
    'ARG STRUIINFO_VERSION=0.1.0',
    'org.opencontainers.image.version="${STRUIINFO_VERSION}"',
    'rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v1.22.22',
    'rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg',
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

  requireAll(sources.productionOperations, [
    'corepack pnpm run start:all',
    'corepack pnpm run start:all:built',
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
    rootPackage: read('package.json'),
    projectLicense: read('LICENSE'),
    dockerignore: read('.dockerignore'),
    dockerfile: read('Dockerfile'),
    compose: read('compose.production.yaml'),
    maintenanceCompose: read('compose.maintenance.yaml'),
    runtimeExample: read('deploy/runtime.container.env.example'),
    runtimeGrants: read('deploy/postgresql/apply-runtime-grants.sql'),
    productionOperations: read('docs/production-operations.md'),
  });
}

const REQUIRED_START_SCRIPTS = Object.freeze({
  'start:api':
    'tsx --tsconfig apps/server/tsconfig.json apps/server/src/entrypoints/api.ts',
  'start:scheduler':
    'tsx --tsconfig apps/server/tsconfig.json apps/server/src/entrypoints/scheduler.ts',
  'start:worker':
    'tsx --tsconfig apps/server/tsconfig.json apps/server/src/entrypoints/worker.ts',
  'start:all':
    'tsx --tsconfig apps/server/tsconfig.json apps/server/src/entrypoints/all.ts',
  'start:all:built': 'node apps/server/dist/entrypoints/all.js',
} as const);

function validateRootStartScripts(source: string): void {
  let decoded: unknown;
  try {
    decoded = JSON.parse(source);
  } catch {
    throw new M1mDeploymentError('The root package manifest is invalid JSON.');
  }
  if (!isRecord(decoded) || !isRecord(decoded.scripts)) {
    throw new M1mDeploymentError(
      'The root package manifest is missing its scripts record.',
    );
  }
  if (
    decoded.license !== 'MIT' ||
    decoded.version !== '0.1.0' ||
    !Array.isArray(decoded.files) ||
    !decoded.files.includes('LICENSE')
  ) {
    throw new M1mDeploymentError(
      'The root package manifest must publish the selected MIT license.',
    );
  }
  const scripts = decoded.scripts;
  for (const [name, command] of Object.entries(REQUIRED_START_SCRIPTS)) {
    if (scripts[name] !== command) {
      throw new M1mDeploymentError(
        `The root package manifest is missing the required ${name} command.`,
      );
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
