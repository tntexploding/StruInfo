export type MigrationLogEvent =
  | 'migration_applied'
  | 'migration_applied_file_missing'
  | 'migration_bootstrap_failed'
  | 'migration_bootstrap_rollback_failed'
  | 'migration_completed'
  | 'migration_connection_close_failed'
  | 'migration_connection_failed'
  | 'migration_credential_invalid'
  | 'migration_credential_missing'
  | 'migration_execution_failed'
  | 'migration_file_name_invalid'
  | 'migration_file_not_regular'
  | 'migration_file_unreadable'
  | 'migration_file_utf8_invalid'
  | 'migration_history_changed'
  | 'migration_history_non_linear'
  | 'migration_ledger_invalid'
  | 'migration_ledger_read_failed'
  | 'migration_lock_failed'
  | 'migration_logging_failed'
  | 'migration_rollback_failed'
  | 'migration_root_ambiguous'
  | 'migration_root_empty'
  | 'migration_root_missing'
  | 'migration_root_unreadable'
  | 'migration_transaction_failed'
  | 'migration_unlock_failed'
  | 'migration_version_duplicate';

export type MigrationOutcome = 'applied' | 'failed' | 'noop';

export interface MigrationLogRecord {
  readonly event: MigrationLogEvent;
  readonly version?: string;
  readonly name?: string;
  readonly checksum?: string;
  readonly outcome: MigrationOutcome;
}

export interface MigrationLogger {
  write(record: Readonly<MigrationLogRecord>): void;
}

export interface MigrationLogSink {
  writeLine(line: string): void;
}

export class JsonMigrationLogger implements MigrationLogger {
  readonly #sink: MigrationLogSink;

  public constructor(sink: MigrationLogSink) {
    this.#sink = sink;
  }

  public write(record: Readonly<MigrationLogRecord>): void {
    this.#sink.writeLine(JSON.stringify(copyLogRecord(record)));
  }
}

export class MigrationFailure extends Error {
  public readonly record: Readonly<MigrationLogRecord>;

  public constructor(record: Readonly<MigrationLogRecord>) {
    super(`Migration stopped safely at ${record.event}.`);
    this.name = 'MigrationFailure';
    this.record = Object.freeze(copyLogRecord(record));
  }
}

export function toMigrationFailure(
  error: unknown,
  fallback: Readonly<MigrationLogRecord>,
): MigrationFailure {
  return error instanceof MigrationFailure
    ? error
    : new MigrationFailure(fallback);
}

function copyLogRecord(
  record: Readonly<MigrationLogRecord>,
): MigrationLogRecord {
  return {
    event: record.event,
    ...(record.version === undefined ? {} : {version: record.version}),
    ...(record.name === undefined ? {} : {name: record.name}),
    ...(record.checksum === undefined ? {} : {checksum: record.checksum}),
    outcome: record.outcome,
  };
}
