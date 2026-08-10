import {parseMigrationConfig} from './migration_config.js';
import type {MigrationFileSystem} from './migration_files.js';
import {
  MigrationFailure,
  type MigrationLogRecord,
  type MigrationLogger,
} from './migration_log.js';
import {executeMigrations} from './migration_runner.js';
import type {MigrationConnector} from './postgres_migration_connection.js';

export interface MigrationExitDecision {
  setExitCode(code: number): void;
}

export class NodeProcessExitDecision implements MigrationExitDecision {
  public setExitCode(code: number): void {
    process.exitCode = code;
  }
}

export async function runMigrationProcess(options: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly migrationRoots: readonly string[];
  readonly fileSystem: MigrationFileSystem;
  readonly connector: MigrationConnector;
  readonly logger: MigrationLogger;
  readonly exitDecision: MigrationExitDecision;
}): Promise<'failed' | 'succeeded'> {
  try {
    const config = parseMigrationConfig(options.environment);
    const result = await executeMigrations({
      config,
      migrationRoots: options.migrationRoots,
      fileSystem: options.fileSystem,
      connector: options.connector,
      logger: options.logger,
    });
    const logged = tryWrite(options.logger, {
      event: 'migration_completed',
      outcome: result.outcome,
    });
    options.exitDecision.setExitCode(logged ? 0 : 1);
    return logged ? 'succeeded' : 'failed';
  } catch (error) {
    const record: Readonly<MigrationLogRecord> =
      error instanceof MigrationFailure
        ? error.record
        : {event: 'migration_execution_failed', outcome: 'failed'};
    tryWrite(options.logger, record);
    options.exitDecision.setExitCode(1);
    return 'failed';
  }
}

function tryWrite(
  logger: MigrationLogger,
  record: Readonly<MigrationLogRecord>,
): boolean {
  try {
    logger.write(record);
    return true;
  } catch {
    return false;
  }
}
