import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {startRoleRuntime} from '../../apps/server/src/composition/start_role_runtime.js';
import {parseRuntimeConfig} from '../../apps/server/src/config/runtime_config.js';
import {
  StandardOutputSink,
  StructuredLogger,
  SystemClock,
} from '../../apps/server/src/logging/structured_logger.js';

const DATABASE_VARIABLE = 'STRUIINFO_M1C_BROWSER_DATABASE_URL';
const PORT_VARIABLE = 'STRUIINFO_M1C_BROWSER_PORT';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

async function main(): Promise<void> {
  const databaseUrl = process.env[DATABASE_VARIABLE];
  if (databaseUrl === undefined || databaseUrl === '') {
    process.stderr.write(
      `${JSON.stringify({
        event: 'm1c_browser_fixture_not_ready',
        variable: DATABASE_VARIABLE,
      })}\n`,
    );
    process.exitCode = 2;
    return;
  }

  const taskRoot = mkdtempSync(join(tmpdir(), 'struinfo-m1c-browser-'));
  const dataRoot = join(taskRoot, 'workspace-data');
  mkdirSync(dataRoot, {recursive: true});
  process.once('exit', () => {
    rmSync(taskRoot, {force: true, recursive: true});
  });

  const config = parseRuntimeConfig('api', {
    DATABASE_URL: databaseUrl,
    STRUIINFO_DATA_ROOT: dataRoot,
    STRUIINFO_WORKSPACE_ID: WORKSPACE_ID,
    STRUIINFO_HOST: '127.0.0.1',
    STRUIINFO_PORT: process.env[PORT_VARIABLE] ?? '4175',
    STRUIINFO_LOG_LEVEL: 'info',
  });
  const logger = new StructuredLogger({
    minimumLevel: config.logLevel,
    role: config.role,
    clock: new SystemClock(),
    sink: new StandardOutputSink(),
    secrets: [databaseUrl],
  });
  await startRoleRuntime(config, logger);
  process.stdout.write(
    `${JSON.stringify({
      event: 'm1c_browser_fixture_ready',
      host: config.host,
      port: config.port,
      workspaceId: config.workspaceId,
    })}\n`,
  );
}

try {
  await main();
} catch {
  process.stderr.write(
    `${JSON.stringify({event: 'm1c_browser_fixture_failed'})}\n`,
  );
  process.exitCode = 1;
}
