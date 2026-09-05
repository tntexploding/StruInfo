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
  process.exitCode =
    report.event === 'm2_p5c_operational_status' &&
    report.outcome === 'attention'
      ? 1
      : (report.event === 'm2_p0a_ingest_executed' ||
            report.event === 'm2_p0b_enrichment_executed' ||
            report.event === 'm2_p0c_exception_adjudicated' ||
            report.event === 'm2_p2g_type_completion_applied' ||
            report.event === 'm2_p4_type_learning_result_applied' ||
            report.event === 'm2_p4_type_learning_activated' ||
            report.event === 'm2_p0g_pipeline_started' ||
            report.event === 'm2_p0g_pipeline_advanced' ||
            report.event === 'm2_p0g_pipeline_status') &&
          (report.outcome === 'failed' || report.outcome === 'stale')
        ? 1
        : 0;
}

void main();
