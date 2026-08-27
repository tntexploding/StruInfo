import {existsSync, readFileSync, realpathSync, statSync} from 'node:fs';
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';

import {
  ConfigurationError,
  parseRuntimeConfig,
  type ProcessRole,
  type RuntimeConfig,
} from './runtime_config.js';

export const RUNTIME_CONFIG_PATH_VARIABLE = 'STRUIINFO_CONFIG_PATH';

const MAX_RUNTIME_CONFIG_BYTES = 64 * 1024;
const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const FILE_CONFIG_KEYS = [
  'STRUIINFO_DATA_ROOT',
  'STRUIINFO_WORKSPACE_ID',
  'STRUIINFO_HOST',
  'STRUIINFO_PORT',
  'STRUIINFO_HEALTH_HOST',
  'STRUIINFO_HEALTH_PORT',
  'STRUIINFO_SHUTDOWN_TIMEOUT_MS',
  'STRUIINFO_LOG_LEVEL',
  'STRUIINFO_OPENAI_MODEL',
  'STRUIINFO_OPENAI_EMBEDDING_MODEL',
] as const;
const FILE_CONFIG_KEY_SET = new Set<string>(FILE_CONFIG_KEYS);
const ENVIRONMENT_ONLY_KEYS = new Set([
  'DATABASE_URL',
  'OPENAI_API_KEY',
  'STRUIINFO_MIGRATION_DATABASE_URL',
  RUNTIME_CONFIG_PATH_VARIABLE,
]);

export interface RuntimeConfigLoadOptions {
  readonly additionalProtectedRoots?: readonly string[];
}

export function loadRuntimeConfig(
  role: ProcessRole,
  environment: Readonly<Record<string, string | undefined>>,
  options: Readonly<RuntimeConfigLoadOptions> = {},
): Readonly<RuntimeConfig> {
  const configPath = loadConfigPath(environment[RUNTIME_CONFIG_PATH_VARIABLE]);
  const protectedRoots = collectProtectedRoots(
    options.additionalProtectedRoots ?? [],
  );
  assertOutsideProtectedRoots(
    configPath,
    protectedRoots,
    'External runtime configuration',
  );

  const fileEnvironment = readExternalEnvironment(configPath);
  const mergedEnvironment = mergeRuntimeEnvironment(
    fileEnvironment,
    environment,
  );
  const parsed = parseRuntimeConfig(role, mergedEnvironment);
  const dataRoot = loadDataRoot(parsed.dataRoot);

  assertOutsideProtectedRoots(dataRoot, protectedRoots, 'STRUIINFO_DATA_ROOT');
  assertConfigurationAndDataAreSeparate(configPath, dataRoot);

  return Object.freeze({...parsed, dataRoot});
}

export function discoverProtectedApplicationRoots(
  startDirectory: string = MODULE_DIRECTORY,
): readonly string[] {
  const roots: string[] = [];
  let current = canonicalDirectory(startDirectory, 'Application directory');

  for (;;) {
    if (
      existsSync(join(current, 'package.json')) ||
      existsSync(join(current, '.git'))
    ) {
      addUniquePath(roots, current);
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  if (roots.length === 0) {
    roots.push(canonicalDirectory(startDirectory, 'Application directory'));
  }
  return Object.freeze(roots);
}

function loadConfigPath(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new ConfigurationError(
      `${RUNTIME_CONFIG_PATH_VARIABLE} is required.`,
    );
  }
  if (!isAbsolute(value)) {
    throw new ConfigurationError(
      `${RUNTIME_CONFIG_PATH_VARIABLE} must be an absolute filesystem path.`,
    );
  }

  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(value);
  } catch {
    throw new ConfigurationError(
      `${RUNTIME_CONFIG_PATH_VARIABLE} must identify an existing regular file.`,
    );
  }

  let status: ReturnType<typeof statSync>;
  try {
    status = statSync(canonicalPath);
  } catch {
    throw new ConfigurationError(
      `${RUNTIME_CONFIG_PATH_VARIABLE} must identify an existing regular file.`,
    );
  }
  if (!status.isFile()) {
    throw new ConfigurationError(
      `${RUNTIME_CONFIG_PATH_VARIABLE} must identify an existing regular file.`,
    );
  }
  if (status.size > MAX_RUNTIME_CONFIG_BYTES) {
    throw new ConfigurationError(
      'External runtime configuration exceeds the 64 KiB size limit.',
    );
  }
  return canonicalPath;
}

function readExternalEnvironment(
  configPath: string,
): Readonly<Record<string, string | undefined>> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(configPath);
  } catch {
    throw new ConfigurationError(
      'External runtime configuration could not be read.',
    );
  }
  if (bytes.byteLength > MAX_RUNTIME_CONFIG_BYTES) {
    throw new ConfigurationError(
      'External runtime configuration exceeds the 64 KiB size limit.',
    );
  }

  let source: string;
  try {
    source = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    throw new ConfigurationError(
      'External runtime configuration must be valid UTF-8.',
    );
  }

  let parsed: ReturnType<typeof parseEnv>;
  try {
    parsed = parseEnv(source);
  } catch {
    throw new ConfigurationError(
      'External runtime configuration has invalid dotenv syntax.',
    );
  }

  for (const key of Object.keys(parsed)) {
    if (ENVIRONMENT_ONLY_KEYS.has(key)) {
      throw new ConfigurationError(
        `${key} must be supplied through the process environment, not the external runtime configuration file.`,
      );
    }
    if (!FILE_CONFIG_KEY_SET.has(key)) {
      throw new ConfigurationError(
        'External runtime configuration contains an unsupported key.',
      );
    }
  }
  return Object.freeze(parsed);
}

function mergeRuntimeEnvironment(
  fileEnvironment: Readonly<Record<string, string | undefined>>,
  processEnvironment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  const merged: Record<string, string | undefined> = {
    DATABASE_URL: processEnvironment.DATABASE_URL,
    OPENAI_API_KEY: processEnvironment.OPENAI_API_KEY,
  };
  for (const key of FILE_CONFIG_KEYS) {
    merged[key] = processEnvironment[key] ?? fileEnvironment[key];
  }
  return Object.freeze(merged);
}

function loadDataRoot(value: string): string {
  const canonicalPath = canonicalDirectory(value, 'STRUIINFO_DATA_ROOT');
  if (canonicalPath === parse(canonicalPath).root) {
    throw new ConfigurationError(
      'STRUIINFO_DATA_ROOT cannot be a filesystem root.',
    );
  }
  return canonicalPath;
}

function canonicalDirectory(value: string, name: string): string {
  if (!isAbsolute(value)) {
    throw new ConfigurationError(
      `${name} must be an absolute filesystem path.`,
    );
  }

  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(value);
  } catch {
    throw new ConfigurationError(
      `${name} must identify an existing directory.`,
    );
  }

  try {
    if (!statSync(canonicalPath).isDirectory()) {
      throw new ConfigurationError(
        `${name} must identify an existing directory.`,
      );
    }
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError(
      `${name} must identify an existing directory.`,
    );
  }
  return canonicalPath;
}

function collectProtectedRoots(
  additionalRoots: readonly string[],
): readonly string[] {
  const roots = [...discoverProtectedApplicationRoots()];
  for (const additionalRoot of additionalRoots) {
    addUniquePath(
      roots,
      canonicalDirectory(additionalRoot, 'Protected application directory'),
    );
  }
  return Object.freeze(roots);
}

function addUniquePath(paths: string[], candidate: string): void {
  if (!paths.some((path) => pathsAreEqual(path, candidate))) {
    paths.push(candidate);
  }
}

function assertOutsideProtectedRoots(
  candidate: string,
  protectedRoots: readonly string[],
  name: string,
): void {
  if (protectedRoots.some((root) => pathContains(root, candidate))) {
    throw new ConfigurationError(
      `${name} must be outside the source, Git, and installed application directories.`,
    );
  }
}

function assertConfigurationAndDataAreSeparate(
  configPath: string,
  dataRoot: string,
): void {
  const configDirectory = dirname(configPath);
  if (
    pathContains(dataRoot, configPath) ||
    pathContains(configDirectory, dataRoot)
  ) {
    throw new ConfigurationError(
      'External runtime configuration and STRUIINFO_DATA_ROOT must use separate directory trees.',
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

function pathsAreEqual(first: string, second: string): boolean {
  return pathContains(first, second) && pathContains(second, first);
}
