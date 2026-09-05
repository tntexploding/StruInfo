import {
  M2P0dWorkloadError,
  parseM2P0dArguments,
  runM2P0dPostgresWorkload,
} from './m2_p0d_postgres.js';

try {
  const options = parseM2P0dArguments(process.argv.slice(2));
  const report = await runM2P0dPostgresWorkload(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      event: 'm2_p0d_postgres_failed',
      code:
        error instanceof M2P0dWorkloadError ? error.code : 'execution_failed',
      ...(error instanceof M2P0dWorkloadError &&
      error.migrationEvent !== undefined
        ? {migrationEvent: error.migrationEvent}
        : {}),
      ...(error instanceof M2P0dWorkloadError &&
      error.migrationVersion !== undefined
        ? {migrationVersion: error.migrationVersion}
        : {}),
      ...(error instanceof M2P0dWorkloadError && error.failureName !== undefined
        ? {failureName: error.failureName}
        : {}),
      ...(error instanceof M2P0dWorkloadError && error.failureCode !== undefined
        ? {failureCode: error.failureCode}
        : {}),
      ...(error instanceof M2P0dWorkloadError &&
      error.failureBoundary !== undefined
        ? {failureBoundary: error.failureBoundary}
        : {}),
    })}\n`,
  );
  process.exitCode = 1;
}
