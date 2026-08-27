import {materializeExternalSecretEnvironment} from '../config/external_secret_environment.js';
import {loadRuntimeConfig} from '../config/external_runtime_config.js';
import {
  decodeM1mMaintenanceRequest,
  executeM1mMaintenance,
  M1mMaintenanceError,
  type M1mMaintenanceReport,
  type M1mMaintenanceRuntimePort,
} from '../operations/m1m_maintenance.js';
import {createM1mMaintenanceRuntime} from '../operations/m1m_maintenance_runtime.js';

async function main(): Promise<void> {
  let runtime: M1mMaintenanceRuntimePort | undefined;
  let report: Readonly<M1mMaintenanceReport> | undefined;
  let failureCode: string | undefined;
  try {
    const request = decodeM1mMaintenanceRequest(process.argv.slice(2));
    const environment = materializeExternalSecretEnvironment(process.env);
    const config = loadRuntimeConfig('api', environment);
    runtime = await createM1mMaintenanceRuntime(config);
    report = await executeM1mMaintenance(request, runtime);
  } catch (error) {
    failureCode =
      error instanceof M1mMaintenanceError
        ? `m1m_${error.code}`
        : 'm1m_maintenance_failed';
  }

  if (runtime !== undefined) {
    try {
      await runtime.close();
    } catch {
      failureCode = 'm1m_maintenance_close_failed';
      report = undefined;
    }
  }

  if (failureCode !== undefined || report === undefined) {
    process.stdout.write(
      `${JSON.stringify({
        event: 'm1m_maintenance_failed',
        outcome: 'failed',
        code: failureCode ?? 'm1m_maintenance_failed',
      })}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = 0;
}

void main();
