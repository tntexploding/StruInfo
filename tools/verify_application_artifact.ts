import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import {isAbsolute, join, posix, relative, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

export const APPLICATION_ARTIFACT_MANIFEST_FORMAT =
  'struinfo.application-artifact-manifest';
export const APPLICATION_ARTIFACT_MANIFEST_VERSION = 1;

const MAXIMUM_PACK_DESCRIPTION_BYTES = 16 * 1024 * 1024;
const MAXIMUM_ARTIFACT_FILE_BYTES = 16 * 1024 * 1024;
const MAXIMUM_ARTIFACT_TOTAL_BYTES = 128 * 1024 * 1024;
const EXACT_ALLOWED_PATHS = new Set([
  'LICENSE',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'apps/server/package.json',
  'apps/web/dist/favicon.svg',
  'apps/web/dist/index.html',
  'apps/web/package.json',
  'package.json',
  'packages/contracts/package.json',
  'docs/dependencies/sbom/npm-closure.spdx.json',
]);
const REQUIRED_EXACT_PATHS = [
  'LICENSE',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'apps/server/dist/entrypoints/api.js',
  'apps/server/dist/entrypoints/all.js',
  'apps/server/dist/entrypoints/maintenance.js',
  'apps/server/dist/entrypoints/migrate.js',
  'apps/server/dist/entrypoints/prepare_queue.js',
  'apps/server/migrations/000001_create_application_schema.sql',
  'apps/server/package.json',
  'apps/web/dist/favicon.svg',
  'apps/web/dist/index.html',
  'apps/web/package.json',
  'package.json',
  'packages/contracts/json-schema/workspace-bundle.v1.schema.json',
  'packages/contracts/openapi/operational-health.v1.openapi.json',
  'packages/contracts/package.json',
  'docs/dependencies/sbom/npm-closure.spdx.json',
] as const;
const FORBIDDEN_PATH_SEGMENTS = new Set([
  '.agents',
  '.env',
  '.git',
  '.secrets',
  'backups',
  'exports',
  'local-data',
  'node_modules',
  'runtime',
  'snapshots',
  'uploads',
  'user-profiles',
  'workspace-data',
]);
const TEXT_AUDIT_PATH_PATTERNS = [
  /^apps\/server\/dist\//u,
  /^apps\/server\/migrations\//u,
  /^apps\/web\/dist\//u,
  /^packages\/contracts\/(?:json-schema|openapi)\//u,
  /(?:^|\/)package\.json$/u,
];

export interface ApplicationArtifactManifestEntry {
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface ApplicationArtifactManifest {
  readonly format: typeof APPLICATION_ARTIFACT_MANIFEST_FORMAT;
  readonly version: typeof APPLICATION_ARTIFACT_MANIFEST_VERSION;
  readonly source: 'pnpm-pack-dry-run';
  readonly files: readonly Readonly<ApplicationArtifactManifestEntry>[];
}

interface PnpmPackDescription {
  readonly name: string;
  readonly version: string;
  readonly files: readonly Readonly<{path: string}>[];
}

export class ApplicationArtifactError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ApplicationArtifactError';
  }
}

export function validateApplicationArtifactPaths(
  paths: readonly string[],
): readonly string[] {
  const normalizedPaths = [...paths].sort();
  const seen = new Set<string>();
  for (const path of normalizedPaths) {
    validateArchivePath(path);
    if (!isAllowedArtifactPath(path)) {
      throw new ApplicationArtifactError(
        'Candidate application artifact contains an undeclared path.',
      );
    }
    if (seen.has(path)) {
      throw new ApplicationArtifactError(
        'Candidate application artifact contains a duplicate path.',
      );
    }
    seen.add(path);
  }
  for (const requiredPath of REQUIRED_EXACT_PATHS) {
    if (!seen.has(requiredPath)) {
      throw new ApplicationArtifactError(
        'Candidate application artifact is missing a required path.',
      );
    }
  }
  if (
    !normalizedPaths.some((path) =>
      path.startsWith('docs/dependencies/licenses/npm/'),
    ) ||
    !normalizedPaths.some((path) =>
      path.startsWith('docs/dependencies/licenses/npm-source/'),
    ) ||
    !normalizedPaths.some((path) => path.startsWith('apps/web/dist/assets/'))
  ) {
    throw new ApplicationArtifactError(
      'Candidate application artifact is missing a required content class.',
    );
  }
  return Object.freeze(normalizedPaths);
}

export function assertNoForbiddenArtifactContent(
  path: string,
  bytes: Uint8Array,
): void {
  if (!TEXT_AUDIT_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    return;
  }
  let content: string;
  try {
    content = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    throw new ApplicationArtifactError(
      'A declared text artifact is not valid UTF-8.',
    );
  }
  if (
    /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*-----END [^-\r\n]*PRIVATE KEY-----/u.test(
      content,
    ) ||
    /\b(?:postgres|postgresql):\/\/[^\s/:@]+:[^\s/@]+@/iu.test(content) ||
    /(?:^|[\r\n])\s*(?:API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|PASSWORD|CLIENT_SECRET)\s*=\s*[^\s#]+/u.test(
      content,
    ) ||
    /\b[A-Za-z]:\\Users\\[^\\\s"']+\\/u.test(content)
  ) {
    throw new ApplicationArtifactError(
      'Candidate application artifact contains forbidden secret or local-path material.',
    );
  }
}

export function createApplicationArtifactManifest(
  repositoryRoot: string,
  paths: readonly string[],
): Readonly<ApplicationArtifactManifest> {
  const canonicalRoot = realpathSync(repositoryRoot);
  const validatedPaths = validateApplicationArtifactPaths(paths);
  let totalBytes = 0;
  const files = validatedPaths.map((path) => {
    const absolutePath = resolve(canonicalRoot, ...path.split('/'));
    if (!pathContains(canonicalRoot, absolutePath)) {
      throw new ApplicationArtifactError(
        'A candidate artifact path resolved outside the repository.',
      );
    }
    const status = lstatSync(absolutePath);
    if (status.isSymbolicLink() || !status.isFile()) {
      throw new ApplicationArtifactError(
        'Candidate artifact entries must be ordinary files.',
      );
    }
    if (status.size > MAXIMUM_ARTIFACT_FILE_BYTES) {
      throw new ApplicationArtifactError(
        'A candidate artifact file exceeds the audit byte limit.',
      );
    }
    totalBytes += status.size;
    if (totalBytes > MAXIMUM_ARTIFACT_TOTAL_BYTES) {
      throw new ApplicationArtifactError(
        'Candidate artifact contents exceed the audit byte limit.',
      );
    }
    const bytes = readFileSync(absolutePath);
    assertNoForbiddenArtifactContent(path, bytes);
    return Object.freeze({
      path,
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  });
  return Object.freeze({
    format: APPLICATION_ARTIFACT_MANIFEST_FORMAT,
    version: APPLICATION_ARTIFACT_MANIFEST_VERSION,
    source: 'pnpm-pack-dry-run' as const,
    files: Object.freeze(files),
  });
}

export function verifyApplicationArtifact(repositoryRoot: string): void {
  const description = readPnpmPackDescription(repositoryRoot);
  if (description.name !== 'struinfo' || description.version !== '0.1.0') {
    throw new ApplicationArtifactError(
      'pnpm enumerated an unexpected candidate package.',
    );
  }
  const manifest = createApplicationArtifactManifest(
    repositoryRoot,
    description.files.map((file) => file.path),
  );
  const buildRoot = join(repositoryRoot, 'build');
  mkdirSync(buildRoot, {recursive: true});
  const buildStatus = lstatSync(buildRoot);
  if (buildStatus.isSymbolicLink() || !buildStatus.isDirectory()) {
    throw new ApplicationArtifactError(
      'The generated build output directory is unsafe.',
    );
  }
  const manifestPath = join(buildRoot, 'application-artifact-manifest.json');
  if (existsSync(manifestPath)) {
    const manifestStatus = lstatSync(manifestPath);
    if (manifestStatus.isSymbolicLink() || !manifestStatus.isFile()) {
      throw new ApplicationArtifactError(
        'The generated artifact manifest target is unsafe.',
      );
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  process.stdout.write(
    `Verified ${String(manifest.files.length)} candidate application artifact files.\n`,
  );
}

function readPnpmPackDescription(repositoryRoot: string): PnpmPackDescription {
  const packageManagerEntry = process.env.npm_execpath;
  if (packageManagerEntry === undefined || !isAbsolute(packageManagerEntry)) {
    throw new ApplicationArtifactError(
      'Artifact verification must run through the pinned pnpm command.',
    );
  }
  const result = spawnSync(
    process.execPath,
    [
      packageManagerEntry,
      'pack',
      '--dry-run',
      '--json',
      '--skip-manifest-obfuscation',
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: MAXIMUM_PACK_DESCRIPTION_BYTES,
      windowsHide: true,
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw new ApplicationArtifactError(
      'pnpm could not enumerate the candidate application artifact.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout) as unknown;
  } catch {
    throw new ApplicationArtifactError(
      'pnpm returned an invalid candidate artifact description.',
    );
  }
  return parsePackDescription(parsed);
}

function parsePackDescription(value: unknown): PnpmPackDescription {
  if (!isRecord(value)) {
    throw invalidPackDescription();
  }
  const name = value.name;
  const version = value.version;
  const files = value.files;
  if (
    typeof name !== 'string' ||
    typeof version !== 'string' ||
    !isArray(files)
  ) {
    throw invalidPackDescription();
  }
  const parsedFiles = files.map((file) => {
    if (!isRecord(file) || typeof file.path !== 'string') {
      throw invalidPackDescription();
    }
    return Object.freeze({path: file.path});
  });
  return {name, version, files: Object.freeze(parsedFiles)};
}

function isAllowedArtifactPath(path: string): boolean {
  if (EXACT_ALLOWED_PATHS.has(path)) {
    return true;
  }
  if (
    path.includes('.test.') ||
    path.endsWith('.tsbuildinfo') ||
    path.endsWith('.env')
  ) {
    return false;
  }
  return (
    /^apps\/server\/dist\/[A-Za-z0-9_./-]+\.(?:js|js\.map|d\.ts|d\.ts\.map)$/u.test(
      path,
    ) ||
    /^apps\/server\/migrations\/[0-9]{6}_[a-z0-9_]+\.sql$/u.test(path) ||
    /^apps\/web\/dist\/assets\/[A-Za-z0-9_-]+\.(?:css|js)$/u.test(path) ||
    /^packages\/contracts\/(?:json-schema|openapi)\/[A-Za-z0-9_./-]+\.json$/u.test(
      path,
    ) ||
    /^docs\/dependencies\/licenses\/(?:npm|npm-source)\/.+$/u.test(path)
  );
}

function validateArchivePath(path: string): void {
  if (
    path === '' ||
    path.includes('\\') ||
    path.startsWith('/') ||
    posix.normalize(path) !== path ||
    path
      .split('/')
      .some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment.toLowerCase()))
  ) {
    throw new ApplicationArtifactError(
      'Candidate application artifact contains an unsafe path.',
    );
  }
}

function pathContains(parent: string, candidate: string): boolean {
  const pathFromParent = relative(resolve(parent), resolve(candidate));
  return (
    pathFromParent === '' ||
    (pathFromParent !== '..' &&
      !pathFromParent.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromParent))
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function invalidPackDescription(): ApplicationArtifactError {
  return new ApplicationArtifactError(
    'pnpm returned an invalid candidate artifact description.',
  );
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
    verifyApplicationArtifact(process.cwd());
  } catch (error) {
    const message =
      error instanceof ApplicationArtifactError
        ? error.message
        : 'Candidate application artifact verification failed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
