import {createHash} from 'node:crypto';
import type {Dirent} from 'node:fs';
import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {TextDecoder} from 'node:util';

import {MigrationFailure} from './migration_log.js';

export const MIGRATION_FILE_PATTERN =
  /^(\d{6})_([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\.sql$/u;
export const MIGRATION_NAME_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;

export type MigrationDirectoryEntryKind =
  'directory' | 'file' | 'other' | 'symbolic_link';

export interface MigrationDirectoryEntry {
  readonly name: string;
  readonly kind: MigrationDirectoryEntryKind;
}

export interface MigrationFileSystem {
  readDirectory(root: string): Promise<readonly MigrationDirectoryEntry[]>;
  readFile(root: string, name: string): Promise<Uint8Array>;
}

export interface DiscoveredMigration {
  readonly version: string;
  readonly name: string;
  readonly filename: string;
  readonly checksum: string;
  readonly sourceBytes: Uint8Array;
  readonly sql: string;
}

export class NodeMigrationFileSystem implements MigrationFileSystem {
  public async readDirectory(
    root: string,
  ): Promise<readonly MigrationDirectoryEntry[]> {
    const entries = await readdir(root, {withFileTypes: true});
    return entries.map((entry) => ({
      name: entry.name,
      kind: classifyEntry(entry),
    }));
  }

  public async readFile(root: string, name: string): Promise<Uint8Array> {
    return Uint8Array.from(await readFile(join(root, name)));
  }
}

export async function discoverMigrations(
  roots: readonly string[],
  fileSystem: MigrationFileSystem,
): Promise<readonly DiscoveredMigration[]> {
  const root = selectMigrationRoot(roots);
  let entries: readonly MigrationDirectoryEntry[];
  try {
    entries = await fileSystem.readDirectory(root);
  } catch {
    throw new MigrationFailure({
      event: 'migration_root_unreadable',
      outcome: 'failed',
    });
  }

  if (entries.length === 0) {
    throw new MigrationFailure({
      event: 'migration_root_empty',
      outcome: 'failed',
    });
  }

  const parsedEntries = entries.map(parseDirectoryEntry);
  rejectDuplicateVersions(parsedEntries);
  parsedEntries.sort((left, right) =>
    left.version < right.version ? -1 : left.version > right.version ? 1 : 0,
  );

  const migrations: DiscoveredMigration[] = [];
  for (const entry of parsedEntries) {
    let sourceBytes: Uint8Array;
    try {
      sourceBytes = Uint8Array.from(
        await fileSystem.readFile(root, entry.filename),
      );
    } catch {
      throw new MigrationFailure({
        event: 'migration_file_unreadable',
        version: entry.version,
        name: entry.name,
        outcome: 'failed',
      });
    }

    const checksum = createHash('sha256').update(sourceBytes).digest('hex');
    let sql: string;
    try {
      sql = new TextDecoder('utf-8', {fatal: true}).decode(sourceBytes);
    } catch {
      throw new MigrationFailure({
        event: 'migration_file_utf8_invalid',
        version: entry.version,
        name: entry.name,
        checksum,
        outcome: 'failed',
      });
    }

    migrations.push(
      Object.freeze({
        ...entry,
        checksum,
        sourceBytes,
        sql,
      }),
    );
  }

  return Object.freeze(migrations);
}

function selectMigrationRoot(roots: readonly string[]): string {
  const root = roots.at(0);
  if (root === undefined || root.trim() === '') {
    throw new MigrationFailure({
      event: 'migration_root_missing',
      outcome: 'failed',
    });
  }
  if (roots.length !== 1) {
    throw new MigrationFailure({
      event: 'migration_root_ambiguous',
      outcome: 'failed',
    });
  }
  return root;
}

function parseDirectoryEntry(
  entry: Readonly<MigrationDirectoryEntry>,
): Readonly<{version: string; name: string; filename: string}> {
  if (entry.kind !== 'file') {
    throw new MigrationFailure({
      event: 'migration_file_not_regular',
      name: entry.name,
      outcome: 'failed',
    });
  }

  const match = MIGRATION_FILE_PATTERN.exec(entry.name);
  const version = match?.[1];
  const name = match?.[2];
  if (version === undefined || name === undefined) {
    throw new MigrationFailure({
      event: 'migration_file_name_invalid',
      name: entry.name,
      outcome: 'failed',
    });
  }

  return {version, name, filename: entry.name};
}

function rejectDuplicateVersions(
  entries: readonly Readonly<{version: string; name: string}>[],
): void {
  const versions = new Set<string>();
  for (const entry of entries) {
    if (versions.has(entry.version)) {
      throw new MigrationFailure({
        event: 'migration_version_duplicate',
        version: entry.version,
        outcome: 'failed',
      });
    }
    versions.add(entry.version);
  }
}

function classifyEntry(entry: Dirent): MigrationDirectoryEntryKind {
  if (entry.isFile()) {
    return 'file';
  }
  if (entry.isDirectory()) {
    return 'directory';
  }
  if (entry.isSymbolicLink()) {
    return 'symbolic_link';
  }
  return 'other';
}
