import {spawn} from 'node:child_process';
import {chmod, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {
  classifyTm2HarnessOutcome,
  decodeTm2AdmissionChannel,
  type Tm2AdmissionFailureCode,
  type Tm2AdmissionPreflightOutcome,
  type Tm2HarnessOutcome,
} from '../../apps/server/test_support/postgres_tm2/admission_outcome.js';
import {
  createTm2ChildProcessPort,
  failureCodeForBoundedChild,
  runTm2BoundedChild,
  SYSTEM_TM2_DEADLINE,
  TM2_ADMISSION_CHILD_DEADLINE_MS,
  TM2_CHILD_REAP_DEADLINE_MS,
  TM2_MANDATORY_CHILD_DEADLINE_MS,
  type Tm2BoundedChildResult,
  type Tm2ChildOutputPort,
} from '../../apps/server/test_support/postgres_tm2/bounded_child.js';
import {
  admitTm2Environment,
  createPoisonPgPassLine,
  sanitizePgEnvironment,
  type AcceptedTm2Environment,
} from '../../apps/server/test_support/postgres_tm2/environment_oracle.js';
import {
  auditTm2MandatoryExecution,
  readAndAuditTm2MandatoryReport,
} from '../../apps/server/test_support/postgres_tm2/mandatory_report_oracle.js';

interface AdmissionChildResult {
  readonly process: Tm2BoundedChildResult;
  readonly stdout: string;
}

interface RunnerDecision {
  readonly outcome: Tm2HarnessOutcome;
  readonly mandatoryCount?: number;
}

function emit(record: Readonly<Record<string, unknown>>): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function spawnFailedResult(): Tm2BoundedChildResult {
  return Object.freeze({
    status: 'spawn_failed',
    confirmedClosed: false,
    safeToDeleteTaskRoot: true,
  });
}

const NO_CHILD_OUTPUT: Tm2ChildOutputPort = Object.freeze({
  stop(discard: boolean): void {
    void discard;
  },
  destroy(): void {
    return;
  },
});

async function runChild(
  environment: NodeJS.ProcessEnv,
  reportPath: string,
): Promise<Tm2BoundedChildResult> {
  const vitestEntry = join(
    process.cwd(),
    'node_modules',
    'vitest',
    'vitest.mjs',
  );
  try {
    const child = spawn(
      process.execPath,
      [
        vitestEntry,
        'run',
        '--config',
        'vitest.postgres.config.ts',
        '--pool=threads',
        '--reporter=json',
        `--outputFile=${reportPath}`,
      ],
      {
        cwd: process.cwd(),
        env: environment,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    return await runTm2BoundedChild({
      child: createTm2ChildProcessPort(child),
      deadline: SYSTEM_TM2_DEADLINE,
      deadlineMs: TM2_MANDATORY_CHILD_DEADLINE_MS,
      reapDeadlineMs: TM2_CHILD_REAP_DEADLINE_MS,
      output: NO_CHILD_OUTPUT,
    });
  } catch {
    return spawnFailedResult();
  }
}

async function runAdmissionChild(
  environment: NodeJS.ProcessEnv,
): Promise<AdmissionChildResult> {
  const tsxEntry = join(
    process.cwd(),
    'node_modules',
    'tsx',
    'dist',
    'cli.mjs',
  );
  try {
    const child = spawn(
      process.execPath,
      [tsxEntry, 'tests/postgres/run_postgres_tm2_admission.ts'],
      {
        cwd: process.cwd(),
        env: environment,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      },
    );
    const output = child.stdout;
    output.setEncoding('utf8');
    let stdout = '';
    const onData = (chunk: string): void => {
      if (stdout.length <= 16_384) {
        stdout += chunk;
      }
    };
    output.on('data', onData);
    const result = await runTm2BoundedChild({
      child: createTm2ChildProcessPort(child),
      deadline: SYSTEM_TM2_DEADLINE,
      deadlineMs: TM2_ADMISSION_CHILD_DEADLINE_MS,
      reapDeadlineMs: TM2_CHILD_REAP_DEADLINE_MS,
      output: {
        stop(discard: boolean): void {
          output.removeListener('data', onData);
          if (discard) {
            stdout = '';
          }
        },
        destroy(): void {
          output.destroy();
        },
      },
    });
    return {process: result, stdout};
  } catch {
    return {process: spawnFailedResult(), stdout: ''};
  }
}

function failedAdmission(
  code: Tm2AdmissionFailureCode,
): Tm2AdmissionPreflightOutcome {
  return Object.freeze({status: 'failed', code});
}

function getAcceptedConfigurations(admission: AcceptedTm2Environment) {
  return [
    admission.admin.config,
    admission.migration.config,
    admission.runtime.config,
  ] as const;
}

async function createIsolatedCredentialRoots(
  root: string,
  admission: AcceptedTm2Environment | undefined,
): Promise<{
  readonly home: string;
  readonly userProfile: string;
  readonly appData: string;
}> {
  const home = join(root, 'home');
  const userProfile = join(root, 'user-profile');
  const appData = join(root, 'app-data');
  const windowsPgDirectory = join(appData, 'postgresql');
  await Promise.all([
    mkdir(home, {recursive: true}),
    mkdir(userProfile, {recursive: true}),
    mkdir(windowsPgDirectory, {recursive: true}),
  ]);
  if (admission !== undefined) {
    const contents = `${getAcceptedConfigurations(admission)
      .map(createPoisonPgPassLine)
      .join('\n')}\n`;
    const posixPath = join(home, '.pgpass');
    const windowsPath = join(windowsPgDirectory, 'pgpass.conf');
    await Promise.all([
      writeFile(posixPath, contents, {encoding: 'utf8', mode: 0o600}),
      writeFile(windowsPath, contents, {encoding: 'utf8'}),
    ]);
    await chmod(posixPath, 0o600);
  }
  return {home, userProfile, appData};
}

function admissionChannelIsConsistent(
  processResult: Extract<Tm2BoundedChildResult, {readonly status: 'completed'}>,
  outcome: Tm2AdmissionPreflightOutcome,
): boolean {
  const expectedExitCode =
    outcome.status === 'admitted' ? 0 : outcome.status === 'not_ready' ? 2 : 1;
  return (
    processResult.confirmedClosed &&
    processResult.signal === null &&
    processResult.exitCode === expectedExitCode
  );
}

function decisionForAdmission(
  admission: Tm2AdmissionPreflightOutcome,
): RunnerDecision {
  return Object.freeze({outcome: classifyTm2HarnessOutcome(admission)});
}

async function executeHarness(): Promise<RunnerDecision> {
  const syntaxAdmission = admitTm2Environment(process.env);
  if (
    syntaxAdmission.status === 'not_ready' &&
    syntaxAdmission.code === 'tm2_url_missing'
  ) {
    return decisionForAdmission({
      status: 'not_ready',
      code: syntaxAdmission.code,
      variable: syntaxAdmission.variable,
    });
  }

  const taskRoot = await mkdtemp(join(tmpdir(), 'struinfo-pg-tm2-'));
  let safeToDeleteTaskRoot = true;
  try {
    const roots = await createIsolatedCredentialRoots(
      taskRoot,
      syntaxAdmission.status === 'accepted' ? syntaxAdmission : undefined,
    );
    const childEnvironment = sanitizePgEnvironment(process.env, roots);
    delete childEnvironment.DATABASE_URL;
    delete childEnvironment.STRUIINFO_MIGRATION_DATABASE_URL;
    childEnvironment.STRUIINFO_TM2_ADMISSION_PREFLIGHT = '1';
    childEnvironment.STRUIINFO_TM2_POISON_ROOT = taskRoot;

    const admissionProcess = await runAdmissionChild(childEnvironment);
    safeToDeleteTaskRoot &&= admissionProcess.process.safeToDeleteTaskRoot;
    let admissionOutcome: Tm2AdmissionPreflightOutcome;
    if (admissionProcess.process.status !== 'completed') {
      admissionOutcome = failedAdmission(
        failureCodeForBoundedChild('admission', admissionProcess.process),
      );
    } else {
      admissionOutcome =
        decodeTm2AdmissionChannel(admissionProcess.stdout) ??
        failedAdmission('tm2_admission_channel_invalid');
      if (
        !admissionChannelIsConsistent(
          admissionProcess.process,
          admissionOutcome,
        )
      ) {
        admissionOutcome = failedAdmission('tm2_admission_channel_invalid');
      }
    }
    if (admissionOutcome.status !== 'admitted') {
      return decisionForAdmission(admissionOutcome);
    }
    if (syntaxAdmission.status !== 'accepted') {
      return decisionForAdmission(
        failedAdmission('tm2_admission_channel_invalid'),
      );
    }

    childEnvironment.STRUIINFO_MIGRATION_DATABASE_URL =
      process.env.STRUIINFO_TM2_MIGRATION_DATABASE_URL ?? '';
    childEnvironment.STRUIINFO_TM2_ADMISSION_PROVEN = '1';
    const reportPath = join(taskRoot, 'vitest-result.json');
    const child = await runChild(childEnvironment, reportPath);
    safeToDeleteTaskRoot &&= child.safeToDeleteTaskRoot;
    if (child.status !== 'completed') {
      return decisionForAdmission(
        failedAdmission(failureCodeForBoundedChild('mandatory', child)),
      );
    }

    const execution = await auditTm2MandatoryExecution(
      child,
      async () =>
        await readAndAuditTm2MandatoryReport(reportPath, process.cwd()),
    );
    if (execution.status === 'report_invalid') {
      return decisionForAdmission(
        failedAdmission('tm2_mandatory_report_invalid'),
      );
    }
    if (execution.status !== 'valid') {
      return Object.freeze({
        outcome: classifyTm2HarnessOutcome(admissionOutcome, child),
      });
    }
    return Object.freeze({
      outcome: classifyTm2HarnessOutcome(
        admissionOutcome,
        child,
        execution.mandatoryCount,
      ),
      mandatoryCount: execution.mandatoryCount,
    });
  } finally {
    if (safeToDeleteTaskRoot) {
      await rm(taskRoot, {recursive: true, force: false});
    }
  }
}

function emitDecision(decision: RunnerDecision): void {
  const outcome = decision.outcome;
  emit({
    event: outcome.event,
    outcome: outcome.outcome,
    ...(outcome.code === undefined ? {} : {code: outcome.code}),
    ...(outcome.variable === undefined ? {} : {variable: outcome.variable}),
    ...(decision.mandatoryCount === undefined
      ? {}
      : {mandatory: decision.mandatoryCount}),
  });
}

try {
  const decision = await executeHarness();
  emitDecision(decision);
  process.exitCode = decision.outcome.exitCode;
} catch {
  emit({
    event: 'postgres_tm2_failed',
    outcome: 'failed',
    code: 'tm2_harness_failure',
  });
  process.exitCode = 1;
}
