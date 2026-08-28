import {
  ConfigurationError,
  type ProcessRole,
} from '../config/runtime_config.js';
import {loadRuntimeConfig} from '../config/external_runtime_config.js';
import {materializeExternalSecretEnvironment} from '../config/external_secret_environment.js';
import {
  collectEnvironmentSecrets,
  StandardOutputSink,
  StructuredLogger,
  SystemClock,
} from '../logging/structured_logger.js';
import {startRoleRuntime} from './start_role_runtime.js';

export async function runProcess(role: ProcessRole): Promise<void> {
  const clock = new SystemClock();
  let config;
  let environment: Readonly<Record<string, string | undefined>>;
  try {
    environment = materializeExternalSecretEnvironment(process.env);
    config = loadRuntimeConfig(role, environment);
  } catch (error) {
    writeBootstrapFailure(role, error, clock);
    process.exitCode = 1;
    return;
  }

  const logger = new StructuredLogger({
    minimumLevel: config.logLevel,
    role,
    clock,
    sink: new StandardOutputSink(),
    secrets: collectEnvironmentSecrets(environment),
  });
  try {
    await startRoleRuntime(config, logger);
  } catch (error) {
    logger.write('error', 'startup_failed', {error});
    process.exitCode = 1;
  }
}

function writeBootstrapFailure(
  role: ProcessRole,
  error: unknown,
  clock: SystemClock,
): void {
  const message =
    error instanceof ConfigurationError
      ? error.message
      : 'Runtime configuration could not be loaded.';
  process.stderr.write(
    `${JSON.stringify({
      timestamp: clock.now().toISOString(),
      level: 'error',
      event: 'configuration_invalid',
      service: 'struinfo',
      role,
      message,
    })}\n`,
  );
}
