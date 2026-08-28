import {createHash} from 'node:crypto';
import {TextEncoder} from 'node:util';

import {describe, expect, it} from 'vitest';

import {
  discoverMigrations,
  type MigrationDirectoryEntry,
  type MigrationDirectoryEntryKind,
  type MigrationFileSystem,
} from './migration_files.js';

const ROOT = 'synthetic-migration-root';

class SyntheticFileSystem implements MigrationFileSystem {
  public readonly directoryReads: string[] = [];
  public readonly fileReads: string[] = [];
  readonly #entries: readonly MigrationDirectoryEntry[] | Error;
  readonly #files: ReadonlyMap<string, Uint8Array | Error>;

  public constructor(options: {
    readonly entries: readonly MigrationDirectoryEntry[] | Error;
    readonly files?: ReadonlyMap<string, Uint8Array | Error>;
  }) {
    this.#entries = options.entries;
    this.#files = options.files ?? new Map();
  }

  public readDirectory(
    root: string,
  ): Promise<readonly MigrationDirectoryEntry[]> {
    this.directoryReads.push(root);
    return this.#entries instanceof Error
      ? Promise.reject(this.#entries)
      : Promise.resolve(this.#entries);
  }

  public readFile(_root: string, name: string): Promise<Uint8Array> {
    this.fileReads.push(name);
    const value = this.#files.get(name);
    if (value === undefined || value instanceof Error) {
      return Promise.reject(value ?? new Error('synthetic missing file'));
    }
    return Promise.resolve(Uint8Array.from(value));
  }
}

function entry(
  name: string,
  kind: MigrationDirectoryEntryKind = 'file',
): MigrationDirectoryEntry {
  return {name, kind};
}

function encoded(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe('discoverMigrations', () => {
  it('sorts valid fixed-width versions lexically', async () => {
    const fileSystem = new SyntheticFileSystem({
      entries: [
        entry('000010_tenth_step.sql'),
        entry('000002_second_step.sql'),
      ],
      files: new Map([
        ['000010_tenth_step.sql', encoded('SELECT 10;')],
        ['000002_second_step.sql', encoded('SELECT 2;')],
      ]),
    });

    const migrations = await discoverMigrations([ROOT], fileSystem);

    expect(migrations.map(({version}) => version)).toEqual([
      '000002',
      '000010',
    ]);
    expect(fileSystem.fileReads).toEqual([
      '000002_second_step.sql',
      '000010_tenth_step.sql',
    ]);
  });

  it('rejects a missing migration root selection', async () => {
    const fileSystem = new SyntheticFileSystem({entries: []});

    await expect(discoverMigrations([], fileSystem)).rejects.toMatchObject({
      record: {event: 'migration_root_missing', outcome: 'failed'},
    });
    expect(fileSystem.directoryReads).toEqual([]);
  });

  it('rejects an ambiguous migration root selection', async () => {
    const fileSystem = new SyntheticFileSystem({entries: []});

    await expect(
      discoverMigrations([ROOT, 'second-root'], fileSystem),
    ).rejects.toMatchObject({
      record: {event: 'migration_root_ambiguous', outcome: 'failed'},
    });
    expect(fileSystem.directoryReads).toEqual([]);
  });

  it('rejects a missing or unreadable directory', async () => {
    const fileSystem = new SyntheticFileSystem({
      entries: new Error('synthetic path and environment detail'),
    });

    await expect(discoverMigrations([ROOT], fileSystem)).rejects.toMatchObject({
      record: {event: 'migration_root_unreadable', outcome: 'failed'},
    });
  });

  it('rejects an empty directory', async () => {
    await expect(
      discoverMigrations([ROOT], new SyntheticFileSystem({entries: []})),
    ).rejects.toMatchObject({
      record: {event: 'migration_root_empty', outcome: 'failed'},
    });
  });

  it.each([
    '1_bad.sql',
    '000001-Bad.sql',
    '000001_Bad.sql',
    '000001_double__separator.sql',
    '000001_missing_extension',
    '.hidden',
  ])('rejects malformed filename %s', async (filename) => {
    await expect(
      discoverMigrations(
        [ROOT],
        new SyntheticFileSystem({entries: [entry(filename)]}),
      ),
    ).rejects.toMatchObject({
      record: {
        event: 'migration_file_name_invalid',
        name: filename,
        outcome: 'failed',
      },
    });
  });

  it('rejects duplicate versions before reading file content', async () => {
    const fileSystem = new SyntheticFileSystem({
      entries: [
        entry('000001_first_name.sql'),
        entry('000001_second_name.sql'),
      ],
    });

    await expect(discoverMigrations([ROOT], fileSystem)).rejects.toMatchObject({
      record: {
        event: 'migration_version_duplicate',
        version: '000001',
        outcome: 'failed',
      },
    });
    expect(fileSystem.fileReads).toEqual([]);
  });

  it.each([
    'directory',
    'symbolic_link',
    'other',
  ] satisfies readonly MigrationDirectoryEntryKind[])(
    'rejects a %s entry even when its name is valid',
    async (kind) => {
      await expect(
        discoverMigrations(
          [ROOT],
          new SyntheticFileSystem({
            entries: [entry('000001_valid_name.sql', kind)],
          }),
        ),
      ).rejects.toMatchObject({
        record: {
          event: 'migration_file_not_regular',
          name: '000001_valid_name.sql',
          outcome: 'failed',
        },
      });
    },
  );

  it('rejects unreadable files without exposing filesystem errors', async () => {
    const rawError = 'synthetic-private-path-detail';
    let failure: unknown;
    try {
      await discoverMigrations(
        [ROOT],
        new SyntheticFileSystem({
          entries: [entry('000001_unreadable.sql')],
          files: new Map([['000001_unreadable.sql', new Error(rawError)]]),
        }),
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      record: {
        event: 'migration_file_unreadable',
        version: '000001',
        name: 'unreadable',
        outcome: 'failed',
      },
    });
    expect(String(failure)).not.toContain(rawError);
  });

  it('rejects invalid UTF-8', async () => {
    await expect(
      discoverMigrations(
        [ROOT],
        new SyntheticFileSystem({
          entries: [entry('000001_invalid_utf8.sql')],
          files: new Map([
            ['000001_invalid_utf8.sql', Uint8Array.from([0xc3, 0x28])],
          ]),
        }),
      ),
    ).rejects.toMatchObject({
      record: {
        event: 'migration_file_utf8_invalid',
        version: '000001',
        name: 'invalid_utf8',
        outcome: 'failed',
      },
    });
  });

  it('hashes and preserves the exact original UTF-8 bytes', async () => {
    const originalBytes = encoded("SELECT '知识';\r\n");
    const normalizedBytes = encoded("SELECT '知识';\n");
    const expectedChecksum = createHash('sha256')
      .update(originalBytes)
      .digest('hex');
    const normalizedChecksum = createHash('sha256')
      .update(normalizedBytes)
      .digest('hex');
    const migrations = await discoverMigrations(
      [ROOT],
      new SyntheticFileSystem({
        entries: [entry('000001_exact_bytes.sql')],
        files: new Map([['000001_exact_bytes.sql', originalBytes]]),
      }),
    );

    expect(migrations[0]).toMatchObject({
      version: '000001',
      name: 'exact_bytes',
      filename: '000001_exact_bytes.sql',
      checksum: expectedChecksum,
      sql: "SELECT '知识';\r\n",
    });
    expect(migrations[0]?.checksum).not.toBe(normalizedChecksum);
    expect(migrations[0]?.sourceBytes).toEqual(originalBytes);
  });

  it('validates all directory metadata before reading any file', async () => {
    const fileSystem = new SyntheticFileSystem({
      entries: [entry('000001_valid.sql'), entry('unexpected.txt')],
      files: new Map([['000001_valid.sql', encoded('SELECT 1;')]]),
    });

    await expect(discoverMigrations([ROOT], fileSystem)).rejects.toMatchObject({
      record: {event: 'migration_file_name_invalid', outcome: 'failed'},
    });
    expect(fileSystem.fileReads).toEqual([]);
  });
});
