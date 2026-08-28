import {lstat, mkdir, realpath, stat} from 'node:fs/promises';
import {isAbsolute, join, parse, relative, resolve, sep} from 'node:path';

export const LOCAL_DATA_AREA_NAMES = [
  'blobs',
  'uploads',
  'exports',
  'backups',
  'preferences',
] as const;

export type LocalDataAreaName = (typeof LOCAL_DATA_AREA_NAMES)[number];

export interface LocalDataRootLayout {
  readonly root: string;
  readonly areaRoots: Readonly<Record<LocalDataAreaName, string>>;
}

export type LocalDataRootErrorCode =
  'root_invalid' | 'area_name_invalid' | 'area_unavailable' | 'area_unsafe';

export class LocalDataRootError extends Error {
  public readonly code: LocalDataRootErrorCode;

  public constructor(code: LocalDataRootErrorCode, message: string) {
    super(message);
    this.name = 'LocalDataRootError';
    this.code = code;
  }
}

const SAFE_DIRECTORY_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

export async function initializeLocalDataRoot(
  configuredRoot: string,
): Promise<Readonly<LocalDataRootLayout>> {
  const root = await canonicalDataRoot(configuredRoot);
  const areaRoots = Object.freeze({
    blobs: await ensurePrivateSubdirectory(root, 'blobs'),
    uploads: await ensurePrivateSubdirectory(root, 'uploads'),
    exports: await ensurePrivateSubdirectory(root, 'exports'),
    backups: await ensurePrivateSubdirectory(root, 'backups'),
    preferences: await ensurePrivateSubdirectory(root, 'preferences'),
  });
  return Object.freeze({root, areaRoots});
}

export async function ensurePrivateSubdirectory(
  parentRoot: string,
  name: string,
): Promise<string> {
  validateDirectorySegment(name);
  const canonicalParent = await canonicalDirectory(
    parentRoot,
    'area_unavailable',
    'The parent data area is unavailable.',
  );
  const candidate = join(canonicalParent, name);
  try {
    await mkdir(candidate, {mode: 0o700});
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) {
      throw new LocalDataRootError(
        'area_unavailable',
        'A required external data area could not be created.',
      );
    }
  }

  const directory = await inspectPrivateSubdirectory(canonicalParent, name);
  if (directory === undefined) {
    throw new LocalDataRootError(
      'area_unavailable',
      'A required external data area is unavailable.',
    );
  }
  return directory;
}

export async function findPrivateSubdirectory(
  parentRoot: string,
  name: string,
): Promise<string | undefined> {
  validateDirectorySegment(name);
  const canonicalParent = await canonicalDirectory(
    parentRoot,
    'area_unavailable',
    'The parent data area is unavailable.',
  );
  return inspectPrivateSubdirectory(canonicalParent, name);
}

async function inspectPrivateSubdirectory(
  canonicalParent: string,
  name: string,
): Promise<string | undefined> {
  const candidate = join(canonicalParent, name);

  let status: Awaited<ReturnType<typeof lstat>>;
  try {
    status = await lstat(candidate);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return undefined;
    }
    throw new LocalDataRootError(
      'area_unavailable',
      'A required external data area is unavailable.',
    );
  }
  if (status.isSymbolicLink() || !status.isDirectory()) {
    throw new LocalDataRootError(
      'area_unsafe',
      'External data areas must be ordinary directories, not files or links.',
    );
  }

  const canonicalChild = await canonicalDirectory(
    candidate,
    'area_unavailable',
    'A required external data area is unavailable.',
  );
  if (!pathContains(canonicalParent, canonicalChild)) {
    throw new LocalDataRootError(
      'area_unsafe',
      'An external data area resolved outside its configured parent.',
    );
  }
  return canonicalChild;
}

function validateDirectorySegment(name: string): void {
  if (!SAFE_DIRECTORY_SEGMENT_PATTERN.test(name)) {
    throw new LocalDataRootError(
      'area_name_invalid',
      'Internal data-area names must use a safe filesystem segment.',
    );
  }
}

async function canonicalDataRoot(configuredRoot: string): Promise<string> {
  if (!isAbsolute(configuredRoot)) {
    throw new LocalDataRootError(
      'root_invalid',
      'The external data root must be an absolute filesystem path.',
    );
  }
  const root = await canonicalDirectory(
    configuredRoot,
    'root_invalid',
    'The external data root must identify an existing directory.',
  );
  if (root === parse(root).root) {
    throw new LocalDataRootError(
      'root_invalid',
      'The external data root cannot be a filesystem root.',
    );
  }
  return root;
}

async function canonicalDirectory(
  path: string,
  code: LocalDataRootErrorCode,
  message: string,
): Promise<string> {
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(path);
    if (!(await stat(canonicalPath)).isDirectory()) {
      throw new Error('not a directory');
    }
  } catch {
    throw new LocalDataRootError(code, message);
  }
  return canonicalPath;
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

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === code
  );
}
