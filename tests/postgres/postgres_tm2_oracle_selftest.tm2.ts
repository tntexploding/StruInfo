import {spawn} from 'node:child_process';
import {isIP} from 'node:net';
import {types} from 'node:util';

import {describe, expect, it, vi} from 'vitest';

import {PostgresConnectionConfigError} from '../../apps/server/src/platform/database/postgresql/index.js';

import {
  classifyTm2HarnessOutcome,
  decodeClosedTm2EnvironmentObservation,
  decodeTm2AdmissionChannel,
  runTm2AdmissionPreflight,
  Tm2AdmissionProbeError,
  type Tm2AdmissionDependencies,
  type Tm2AdmissionEnvironmentObservation,
} from '../../apps/server/test_support/postgres_tm2/admission_outcome.js';
import {
  isTm2OperationalConnectionError,
  TM2_OPERATIONAL_ERROR_MAX_DEPTH,
  TM2_OPERATIONAL_ERROR_MAX_MEMBERS,
} from '../../apps/server/test_support/postgres_tm2/admission_child.js';
import {
  createTm2ChildProcessPort,
  failureCodeForBoundedChild,
  runTm2BoundedChild,
  SYSTEM_TM2_DEADLINE,
  TM2_ADMISSION_CHILD_DEADLINE_MS,
  TM2_CHILD_REAP_DEADLINE_MS,
  TM2_MANDATORY_CHILD_DEADLINE_MS,
  type Tm2ChildOutputPort,
  type Tm2ChildProcessPort,
  type Tm2DeadlinePort,
} from '../../apps/server/test_support/postgres_tm2/bounded_child.js';
import {
  admitTm2Environment,
  auditClosedPgConfig,
  createPoisonPgPassLine,
  decodeTm2Url,
  deriveWorkspaceLockKnownAnswer,
  sanitizePgEnvironment,
  TM2_PASSWORD_KNOWN_ANSWERS,
  type AcceptedTm2Url,
  type Tm2AdmissionCode,
  type Tm2Role,
} from '../../apps/server/test_support/postgres_tm2/environment_oracle.js';
import {
  auditTm2MandatoryLedger,
  TM2_FAMILIES,
  TM2_MANDATORY_LEDGER,
} from '../../apps/server/test_support/postgres_tm2/mandatory_ledger.js';
import {
  auditTm2MandatoryExecution,
  auditTm2MandatoryReportSource,
  normalizeTm2ReportSuitePath,
  readAndAuditTm2MandatoryReport,
  TM2_MANDATORY_REPORT_MAX_BYTES,
  TM2_MANDATORY_SUITE_PATH,
  TM2_SELFTEST_SUITE_PATH,
  type Tm2MandatoryReportIo,
} from '../../apps/server/test_support/postgres_tm2/mandatory_report_oracle.js';
import {
  auditCatalogSummary,
  TM2_BUSINESS_TABLES,
  TM2_CATALOG_CARDINALITIES,
  TM2_MIGRATION_IDENTITIES,
  TM2_RUNTIME_GRANT_CARDINALITIES,
  TM2_RUNTIME_POINTER_UPDATES,
} from '../../apps/server/test_support/postgres_tm2/semantic_oracle.js';
import {
  isLockBlockedObservation,
  Tm2Barrier,
  withTm2Deadline,
} from '../../apps/server/test_support/postgres_tm2/concurrency_oracle.js';
import {
  executeTm2MandatoryCase,
  getPostgresTm2PublicFacade,
} from '../../apps/server/test_support/postgres_tm2/public_facade.js';

function accepted(
  role: Tm2Role,
  password = 'synthetic%40secret',
): AcceptedTm2Url {
  const result = decodeTm2Url(
    role,
    `postgres://${
      role === 'migration' ? 'struinfo_tm2_migrator' : `struinfo_tm2_${role}`
    }:${password}@127.0.0.1:5432/struinfo_tm2`,
  );
  if (result.status !== 'accepted') {
    throw new Error(`SYNTHETIC_URL_REJECTED:${result.code}`);
  }
  return result;
}

function expectRejected(
  role: Tm2Role,
  url: unknown,
  code: Tm2AdmissionCode,
): void {
  expect(decodeTm2Url(role, url)).toEqual({status: 'not_ready', role, code});
}

function parsePgPassLine(line: string): readonly string[] {
  const fields: string[] = [];
  let field = '';
  let escaped = false;
  for (const character of line) {
    if (escaped) {
      field += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === ':') {
      fields.push(field);
      field = '';
    } else {
      field += character;
    }
  }
  if (escaped) {
    throw new Error('SYNTHETIC_PGPASS_ESCAPE_INCOMPLETE');
  }
  fields.push(field);
  return Object.freeze(fields);
}

function acceptedFromInput(role: Exclude<Tm2Role, 'admin'>, input: unknown) {
  const result = decodeTm2Url(role, input);
  if (result.status !== 'accepted') {
    throw new PostgresConnectionConfigError();
  }
  return result.config;
}

function admittedObservation(): Tm2AdmissionEnvironmentObservation {
  const sessions = Object.fromEntries(
    (['admin', 'migration', 'runtime'] as const).map((role) => [
      role,
      Object.freeze({
        role,
        sessionUser:
          role === 'migration'
            ? 'struinfo_tm2_migrator'
            : `struinfo_tm2_${role}`,
        currentUser:
          role === 'migration'
            ? 'struinfo_tm2_migrator'
            : `struinfo_tm2_${role}`,
        roleSetting: 'none',
        databaseName: 'struinfo_tm2',
        serverAddress: '127.0.0.1',
        serverPort: 5432,
        serverVersionNumber: 180_000,
        serverEncoding: 'UTF8',
        clientEncoding: 'UTF8',
        timeZone: 'UTC',
        standardConformingStrings: 'on',
      }),
    ]),
  ) as Tm2AdmissionEnvironmentObservation['sessions'];
  return Object.freeze({
    sessions,
    roles: Object.freeze([
      Object.freeze({
        role: 'admin' as const,
        name: 'struinfo_tm2_admin',
        canLogin: true,
        superuser: true,
        createRole: false,
        createDatabase: false,
        replication: false,
        bypassRowLevelSecurity: false,
      }),
      Object.freeze({
        role: 'migration' as const,
        name: 'struinfo_tm2_migrator',
        canLogin: true,
        superuser: false,
        createRole: false,
        createDatabase: false,
        replication: false,
        bypassRowLevelSecurity: false,
      }),
      Object.freeze({
        role: 'runtime' as const,
        name: 'struinfo_tm2_runtime',
        canLogin: true,
        superuser: false,
        createRole: false,
        createDatabase: false,
        replication: false,
        bypassRowLevelSecurity: false,
      }),
    ]),
    directMembershipCount: 0,
    databaseOwner: 'struinfo_tm2_admin',
    runtimeOwnedNonTemporarySchemaCount: 0,
    runtimeOwnedProjectObjectCount: 0,
    runtimeSetRoleCount: 0,
    projectSchemaCount: 0,
  });
}

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? {-readonly [Key in keyof T]: DeepMutable<T[Key]>}
    : T;

function mutableAdmittedObservation(): DeepMutable<Tm2AdmissionEnvironmentObservation> {
  return structuredClone(
    admittedObservation(),
  ) as DeepMutable<Tm2AdmissionEnvironmentObservation>;
}

function admissionDependencies(
  inspectEnvironment: (
    admission: Parameters<Tm2AdmissionDependencies['inspectEnvironment']>[0],
    configs: Parameters<Tm2AdmissionDependencies['inspectEnvironment']>[1],
  ) => Promise<Tm2AdmissionEnvironmentObservation>,
): Tm2AdmissionDependencies {
  return {
    decodeProductConfig: acceptedFromInput,
    isProductConfigError(error) {
      return (
        !types.isProxy(error) &&
        isNativeErrorOracle(error) &&
        error instanceof PostgresConnectionConfigError
      );
    },
    async inspectEnvironment(admission, configs) {
      return Object.freeze({
        observation: await inspectEnvironment(admission, configs),
      });
    },
  };
}

function formalSyntheticEnvironment() {
  return {
    STRUIINFO_TM2_ADMIN_DATABASE_URL:
      'postgres://struinfo_tm2_admin:a@127.0.0.1/struinfo_tm2',
    STRUIINFO_TM2_MIGRATION_DATABASE_URL:
      'postgres://struinfo_tm2_migrator:b@127.0.0.1/struinfo_tm2',
    STRUIINFO_TM2_RUNTIME_DATABASE_URL:
      'postgres://struinfo_tm2_runtime:c@127.0.0.1/struinfo_tm2',
  };
}

function throwUnknown(value: unknown): never {
  const iterator = (function* syntheticThrower() {
    yield undefined;
  })();
  iterator.next();
  iterator.throw(value);
  throw new Error('SYNTHETIC_THROW_DID_NOT_PROPAGATE');
}

async function rejectUnknown(value: unknown): Promise<never> {
  await Promise.resolve();
  return throwUnknown(value);
}

class FakeDeadline implements Tm2DeadlinePort {
  readonly scheduledDelays: number[] = [];
  readonly cancelledDelays: number[] = [];
  readonly #entries = new Map<
    object,
    {readonly delayMs: number; readonly callback: () => void}
  >();
  #nextId = 0;
  public cancelThrows = false;

  public schedule(delayMs: number, callback: () => void): object {
    const handle = Object.freeze({id: this.#nextId});
    this.#nextId += 1;
    this.scheduledDelays.push(delayMs);
    this.#entries.set(handle, {delayMs, callback});
    return handle;
  }

  public cancel(handle: object): void {
    const entry = this.#entries.get(handle);
    if (entry !== undefined) {
      this.cancelledDelays.push(entry.delayMs);
    }
    this.#entries.delete(handle);
    if (this.cancelThrows) {
      throw new Error('SYNTHETIC_DEADLINE_CANCEL_FAILURE');
    }
  }

  public fire(delayMs: number): void {
    const entry = [...this.#entries.entries()].find(
      ([, candidate]) => candidate.delayMs === delayMs,
    );
    if (entry === undefined) {
      throw new Error('SYNTHETIC_DEADLINE_NOT_REGISTERED');
    }
    this.#entries.delete(entry[0]);
    entry[1].callback();
  }

  public get activeCount(): number {
    return this.#entries.size;
  }
}

class FakeChild implements Tm2ChildProcessPort {
  readonly killCalls: NodeJS.Signals[] = [];
  readonly cleanupCalls: string[] = [];
  readonly #errorListeners = new Set<(error: unknown) => void>();
  readonly #closeListeners = new Set<
    (exitCode: number | null, signal: NodeJS.Signals | null) => void
  >();
  public killResult = true;
  public killThrows = false;
  public closeDuringKill = false;
  public offErrorThrows = false;
  public offCloseThrows = false;
  public destroyStdinThrows = false;
  public destroyStdoutThrows = false;
  public destroyStderrThrows = false;
  public unrefThrows = false;

  public onError(listener: (error: unknown) => void): void {
    this.#errorListeners.add(listener);
  }

  public offError(listener: (error: unknown) => void): void {
    this.cleanupCalls.push('offError');
    this.#errorListeners.delete(listener);
    if (this.offErrorThrows) {
      throw new Error('SYNTHETIC_OFF_ERROR_FAILURE');
    }
  }

  public onClose(
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): void {
    this.#closeListeners.add(listener);
  }

  public offClose(
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): void {
    this.cleanupCalls.push('offClose');
    this.#closeListeners.delete(listener);
    if (this.offCloseThrows) {
      throw new Error('SYNTHETIC_OFF_CLOSE_FAILURE');
    }
  }

  public kill(signal: NodeJS.Signals): boolean {
    this.killCalls.push(signal);
    if (this.closeDuringKill) {
      this.emitClose(null, 'SIGKILL');
    }
    if (this.killThrows) {
      throw new Error('SYNTHETIC_KILL_FAILURE');
    }
    return this.killResult;
  }

  public destroyStdin(): void {
    this.cleanupCalls.push('destroyStdin');
    if (this.destroyStdinThrows) {
      throw new Error('SYNTHETIC_STDIN_DESTROY_FAILURE');
    }
  }

  public destroyStdout(): void {
    this.cleanupCalls.push('destroyStdout');
    if (this.destroyStdoutThrows) {
      throw new Error('SYNTHETIC_STDOUT_DESTROY_FAILURE');
    }
  }

  public destroyStderr(): void {
    this.cleanupCalls.push('destroyStderr');
    if (this.destroyStderrThrows) {
      throw new Error('SYNTHETIC_STDERR_DESTROY_FAILURE');
    }
  }

  public unref(): void {
    this.cleanupCalls.push('unref');
    if (this.unrefThrows) {
      throw new Error('SYNTHETIC_UNREF_FAILURE');
    }
  }

  public emitError(error: unknown): void {
    for (const listener of [...this.#errorListeners]) {
      listener(error);
    }
  }

  public emitClose(
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    for (const listener of [...this.#closeListeners]) {
      listener(exitCode, signal);
    }
  }

  public get listenerCount(): number {
    return this.#errorListeners.size + this.#closeListeners.size;
  }
}

class FakeOutput implements Tm2ChildOutputPort {
  readonly stops: boolean[] = [];
  public destroyCalls = 0;
  public value = 'synthetic-child-output';
  public stopThrows = false;
  public destroyThrows = false;
  #stopped = false;

  public append(value: string): void {
    if (!this.#stopped) {
      this.value += value;
    }
  }

  public stop(discard: boolean): void {
    this.#stopped = true;
    this.stops.push(discard);
    if (discard) {
      this.value = '';
    }
    if (this.stopThrows) {
      throw new Error('SYNTHETIC_OUTPUT_STOP_FAILURE');
    }
  }

  public destroy(): void {
    this.destroyCalls += 1;
    if (this.destroyThrows) {
      throw new Error('SYNTHETIC_OUTPUT_DESTROY_FAILURE');
    }
  }
}

interface SyntheticJsonAssertion {
  ancestorTitles: string[];
  failureMessages: string[];
  fullName: string;
  meta: Record<string, never>;
  status: string;
  tags: string[];
  title: string;
}

interface SyntheticJsonSuite {
  assertionResults: SyntheticJsonAssertion[];
  endTime: number;
  message: string;
  name: string;
  startTime: number;
  status: string;
}

interface SyntheticJsonReport {
  numFailedTests: number;
  numFailedTestSuites: number;
  numPassedTests: number;
  numPassedTestSuites: number;
  numPendingTests: number;
  numPendingTestSuites: number;
  numTodoTests: number;
  numTotalTests: number;
  numTotalTestSuites: number;
  snapshot: Readonly<Record<string, unknown>>;
  startTime: number;
  success: boolean;
  testResults: SyntheticJsonSuite[];
}

function syntheticAssertion(
  title: string,
  status = 'passed',
): SyntheticJsonAssertion {
  return {
    ancestorTitles: ['Synthetic PostgreSQL TM2 suite'],
    failureMessages: status === 'passed' ? [] : ['synthetic-redacted'],
    fullName: `Synthetic PostgreSQL TM2 suite ${title}`,
    meta: {},
    status,
    tags: [],
    title,
  };
}

function createSyntheticMandatoryReport(
  repositoryRoot = '/synthetic/repository',
): SyntheticJsonReport {
  const separator = repositoryRoot.includes('\\') ? '\\' : '/';
  const withRoot = (relative: string): string =>
    `${repositoryRoot}${separator}${relative.replaceAll('/', separator)}`;
  const mandatoryAssertions = Array.from({length: 488}, (_, index) => {
    const id = `PG-TM2-${String(index + 1).padStart(3, '0')}`;
    return syntheticAssertion(`${id} synthetic-vector-${String(index + 1)}`);
  });
  const selftestAssertions = [syntheticAssertion('synthetic oracle selftest')];
  const testResults: SyntheticJsonSuite[] = [
    {
      assertionResults: mandatoryAssertions,
      endTime: 2,
      message: '',
      name: withRoot(TM2_MANDATORY_SUITE_PATH),
      startTime: 1,
      status: 'passed',
    },
    {
      assertionResults: selftestAssertions,
      endTime: 2,
      message: '',
      name: withRoot(TM2_SELFTEST_SUITE_PATH),
      startTime: 1,
      status: 'passed',
    },
  ];
  return {
    numFailedTests: 0,
    numFailedTestSuites: 0,
    numPassedTests: 489,
    numPassedTestSuites: 2,
    numPendingTests: 0,
    numPendingTestSuites: 0,
    numTodoTests: 0,
    numTotalTests: 489,
    numTotalTestSuites: 2,
    snapshot: {
      added: 0,
      didUpdate: false,
      failure: false,
      filesAdded: 0,
      filesRemoved: 0,
      filesRemovedList: [],
      filesUnmatched: 0,
      filesUpdated: 0,
      matched: 0,
      total: 0,
      unchecked: 0,
      uncheckedKeysByFile: [],
      unmatched: 0,
      updated: 0,
    },
    startTime: 1,
    success: true,
    testResults,
  };
}

function refreshSyntheticReportCounts(report: SyntheticJsonReport): void {
  const assertions = report.testResults.reduce(
    (count, suite) => count + suite.assertionResults.length,
    0,
  );
  report.numTotalTests = assertions;
  report.numPassedTests = report.testResults.reduce(
    (count, suite) =>
      count +
      suite.assertionResults.filter(
        (assertion) => assertion.status === 'passed',
      ).length,
    0,
  );
  report.numFailedTests = assertions - report.numPassedTests;
  report.numTotalTestSuites = report.testResults.length;
  report.numPassedTestSuites = report.testResults.filter(
    (suite) => suite.status === 'passed',
  ).length;
  report.numFailedTestSuites =
    report.numTotalTestSuites - report.numPassedTestSuites;
  report.success =
    report.numFailedTests === 0 && report.numFailedTestSuites === 0;
}

function syntheticOperationalError(code = 'ECONNREFUSED'): Error {
  const error = new Error('synthetic-redacted');
  Object.defineProperty(error, 'code', {
    value: code,
    enumerable: true,
    configurable: true,
  });
  return error;
}

function createPrototypeForgery(prototype: object): object {
  const target: object = {};
  Object.setPrototypeOf(target, prototype);
  return target;
}

interface TestErrorConstructorWithIdentity extends ErrorConstructor {
  isError(value: unknown): value is Error;
}

function isNativeErrorOracle(value: unknown): value is Error {
  return (Error as TestErrorConstructorWithIdentity).isError(value);
}

function createTrapCountingProxy<T extends object>(
  target: T,
  recordTrap: () => void,
): T {
  return new Proxy(target, {
    get(): unknown {
      recordTrap();
      return undefined;
    },
    getOwnPropertyDescriptor(candidate, key) {
      recordTrap();
      return Reflect.getOwnPropertyDescriptor(candidate, key);
    },
    getPrototypeOf(): object | null {
      recordTrap();
      return null;
    },
    ownKeys(): (string | symbol)[] {
      recordTrap();
      return [];
    },
  });
}

describe('Test-owned PostgreSQL TM2 environment oracle', () => {
  it('decodes each frozen password exactly once', () => {
    for (const vector of TM2_PASSWORD_KNOWN_ANSWERS) {
      expect(accepted('admin', vector.serialized).config.password).toBe(
        vector.decoded,
      );
    }
  });

  it('preserves literal plus and does not normalize or decode twice', () => {
    expect(accepted('admin', 'J%CC%8C').config.password).toBe('J\u030c');
    expect(accepted('admin', '%2525').config.password).toBe('%25');
    expect(accepted('admin', 'synthetic+secret').config.password).toBe(
      'synthetic+secret',
    );
  });

  it('rejects missing and explicit-empty passwords before connection', () => {
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin@127.0.0.1/struinfo_tm2',
      'tm2_url_password_missing',
    );
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin:@127.0.0.1/struinfo_tm2',
      'tm2_url_password_empty',
    );
  });

  it('rejects malformed percent and invalid UTF-8 password vectors', () => {
    for (const password of [
      '%',
      '%0',
      '%GG',
      '%C0%AF',
      '%E2%82',
      '%ED%A0%80',
      '%F4%90%80%80',
    ]) {
      expectRejected(
        'admin',
        `postgres://struinfo_tm2_admin:${password}@127.0.0.1/struinfo_tm2`,
        'tm2_url_percent_encoding',
      );
    }
  });

  it('rejects raw and decoded NUL, control, DEL, and lone surrogate vectors', () => {
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin:synthetic%00secret@127.0.0.1/struinfo_tm2',
      'tm2_url_unicode',
    );
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin:synthetic secret@127.0.0.1/struinfo_tm2',
      'tm2_url_raw_character',
    );
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin:synthetic\u007fsecret@127.0.0.1/struinfo_tm2',
      'tm2_url_raw_character',
    );
    expectRejected(
      'admin',
      `postgres://struinfo_tm2_admin:synthetic${String.fromCharCode(0xd800)}secret@127.0.0.1/struinfo_tm2`,
      'tm2_url_unicode',
    );
  });

  it('rejects non-local authorities, invalid ports, and endpoint overrides', () => {
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin:x@example.invalid/struinfo_tm2',
      'tm2_url_host',
    );
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin:x@127.0.0.1:0/struinfo_tm2',
      'tm2_url_port',
    );
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin:x@127.0.0.1/struinfo_tm2?sslmode=disable',
      'tm2_url_override',
    );
    expectRejected(
      'admin',
      'postgres://struinfo_tm2_admin:x@127.0.0.1/struinfo_tm2#fragment',
      'tm2_url_override',
    );
  });

  it('rejects empty, multiple, slash, backslash, and NUL database paths', () => {
    const vectors = [
      'postgres://struinfo_tm2_admin:x@127.0.0.1/',
      'postgres://struinfo_tm2_admin:x@127.0.0.1/a/b',
      'postgres://struinfo_tm2_admin:x@127.0.0.1/a%2Fb',
      'postgres://struinfo_tm2_admin:x@127.0.0.1/a%5Cb',
      'postgres://struinfo_tm2_admin:x@127.0.0.1/a%00b',
    ];
    for (const vector of vectors) {
      const result = decodeTm2Url('admin', vector);
      expect(result.status).toBe('not_ready');
      if (result.status === 'not_ready') {
        expect(['tm2_url_database', 'tm2_url_unicode']).toContain(result.code);
      }
    }
  });

  it('materializes an exact owned null-prototype eight-field config', () => {
    const config = accepted('runtime').config;
    expect(auditClosedPgConfig(config)).toEqual([]);
    expect(Object.getPrototypeOf(config)).toBeNull();
    expect(Reflect.ownKeys(config).sort()).toEqual([
      'application_name',
      'database',
      'host',
      'options',
      'password',
      'port',
      'ssl',
      'user',
    ]);
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 5432,
      database: 'struinfo_tm2',
      user: 'struinfo_tm2_runtime',
      password: 'synthetic@secret',
      ssl: false,
      application_name: 'struinfo-tm2-runtime',
      options: '-c role=none -c search_path=pg_catalog',
    });
    const password = Object.getOwnPropertyDescriptor(config, 'password');
    expect(password).toMatchObject({
      value: 'synthetic@secret',
      enumerable: true,
      writable: false,
    });
  });

  it('admits only a common endpoint with three exact distinct roles', () => {
    const environment = {
      STRUIINFO_TM2_ADMIN_DATABASE_URL:
        'postgres://struinfo_tm2_admin:a@localhost/struinfo_tm2',
      STRUIINFO_TM2_MIGRATION_DATABASE_URL:
        'postgres://struinfo_tm2_migrator:b@localhost/struinfo_tm2',
      STRUIINFO_TM2_RUNTIME_DATABASE_URL:
        'postgres://struinfo_tm2_runtime:c@localhost/struinfo_tm2',
    };
    expect(admitTm2Environment(environment).status).toBe('accepted');
    expect(
      admitTm2Environment({
        ...environment,
        STRUIINFO_TM2_RUNTIME_DATABASE_URL:
          'postgres://struinfo_tm2_runtime:c@localhost/other',
      }),
    ).toMatchObject({status: 'not_ready', code: 'tm2_endpoint_mismatch'});
  });

  it('reports each absent formal URL as NOT_READY without substituting another variable', () => {
    const environment: Record<string, string | undefined> = {
      STRUIINFO_TM2_ADMIN_DATABASE_URL:
        'postgres://struinfo_tm2_admin:a@localhost/struinfo_tm2',
      STRUIINFO_TM2_MIGRATION_DATABASE_URL:
        'postgres://struinfo_tm2_migrator:b@localhost/struinfo_tm2',
      STRUIINFO_TM2_RUNTIME_DATABASE_URL:
        'postgres://struinfo_tm2_runtime:c@localhost/struinfo_tm2',
    };
    for (const variable of Object.keys(environment)) {
      const candidate = {...environment, [variable]: undefined};
      expect(admitTm2Environment(candidate)).toEqual({
        status: 'not_ready',
        code: 'tm2_url_missing',
        variable,
      });
    }
  });

  it('accepts both schemes, all local host forms, and the inclusive port bounds', () => {
    const vectors = [
      {
        url: 'postgres://struinfo_tm2_admin:x@127.0.0.1:1/struinfo_tm2',
        authorityHost: '127.0.0.1',
        pgHost: '127.0.0.1',
      },
      {
        url: 'postgresql://struinfo_tm2_admin:x@localhost:65535/struinfo_tm2',
        authorityHost: 'localhost',
        pgHost: 'localhost',
      },
      {
        url: 'postgres://struinfo_tm2_admin:x@[::1]/struinfo_tm2',
        authorityHost: '[::1]',
        pgHost: '::1',
      },
    ];
    for (const vector of vectors) {
      const result = decodeTm2Url('admin', vector.url);
      expect(result.status).toBe('accepted');
      if (result.status === 'accepted') {
        expect(result.authorityHost).toBe(vector.authorityHost);
        expect(result.config.host).toBe(vector.pgHost);
      }
    }
    expect(isIP(vectors[2]?.pgHost ?? '')).toBe(6);
  });

  it('removes every case form of PG variables while preserving a sentinel', () => {
    const sanitized = sanitizePgEnvironment(
      {
        PATH: 'synthetic-path',
        PGPASSWORD: 'forbidden',
        pgservice: 'forbidden',
        PgOptions: 'forbidden',
        SYNTHETIC_SENTINEL: 'preserved',
      },
      {
        home: 'synthetic-home',
        userProfile: 'synthetic-profile',
        appData: 'synthetic-appdata',
      },
    );
    expect(Object.keys(sanitized).filter((key) => /^pg/i.test(key))).toEqual(
      [],
    );
    expect(sanitized.SYNTHETIC_SENTINEL).toBe('preserved');
    expect(sanitized).toMatchObject({
      HOME: 'synthetic-home',
      USERPROFILE: 'synthetic-profile',
      APPDATA: 'synthetic-appdata',
    });
  });

  it('creates a matching poison record without copying the explicit password', () => {
    const config = accepted('migration').config;
    const line = createPoisonPgPassLine(config);
    expect(line).toBe(
      '127.0.0.1:5432:struinfo_tm2:struinfo_tm2_migrator:synthetic-poison-password',
    );
    expect(line).not.toContain(config.password);
  });

  it('serializes the IPv6 pgpass endpoint from the unbracketed driver host', () => {
    const result = decodeTm2Url(
      'runtime',
      'postgres://struinfo_tm2_runtime:synthetic%40secret@[::1]/struinfo_tm2',
    );
    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(result.authorityHost).toBe('[::1]');
      expect(result.config.host).toBe('::1');
      expect(isIP(result.config.host)).toBe(6);
      const fields = parsePgPassLine(createPoisonPgPassLine(result.config));
      expect(fields).toEqual([
        '::1',
        '5432',
        'struinfo_tm2',
        'struinfo_tm2_runtime',
        'synthetic-poison-password',
      ]);
      expect(fields[0]).toBe(result.config.host);
    }
  });
});

describe('Test-owned PostgreSQL TM2 admission outcome channel', () => {
  it('decodes every new fail-closed harness code and rejects unknown codes', () => {
    const codes = [
      'tm2_product_decoder_failure',
      'tm2_admission_probe_failure',
      'tm2_admission_child_timeout',
      'tm2_admission_child_termination_failure',
      'tm2_mandatory_child_failure',
      'tm2_mandatory_child_timeout',
      'tm2_mandatory_child_termination_failure',
      'tm2_mandatory_report_invalid',
      'tm2_harness_failure',
    ] as const;
    for (const code of codes) {
      expect(
        decodeTm2AdmissionChannel(JSON.stringify({status: 'failed', code})),
      ).toEqual({status: 'failed', code});
    }
    expect(
      decodeTm2AdmissionChannel(
        JSON.stringify({status: 'failed', code: 'tm2_unknown_failure'}),
      ),
    ).toBeUndefined();
  });

  it('accepts only closed own operational codes without invoking accessors or proxies', () => {
    expect(isTm2OperationalConnectionError(syntheticOperationalError())).toBe(
      true,
    );
    expect(
      isTm2OperationalConnectionError(syntheticOperationalError('UNKNOWN')),
    ).toBe(false);

    const inherited = new Error('synthetic-redacted');
    const inheritedPrototype = Object.create(Error.prototype) as object;
    Object.defineProperty(inheritedPrototype, 'code', {
      value: 'ECONNREFUSED',
      enumerable: true,
    });
    Object.setPrototypeOf(inherited, inheritedPrototype);
    expect(isTm2OperationalConnectionError(inherited)).toBe(false);

    let getterCalls = 0;
    const accessor = new Error('synthetic-redacted');
    Object.defineProperty(accessor, 'code', {
      get() {
        getterCalls += 1;
        return 'ECONNREFUSED';
      },
      enumerable: true,
    });
    expect(isTm2OperationalConnectionError(accessor)).toBe(false);
    expect(getterCalls).toBe(0);

    let trapCalls = 0;
    const proxied = new Proxy(syntheticOperationalError(), {
      get(target, key, receiver) {
        trapCalls += 1;
        void target;
        void key;
        void receiver;
        return undefined;
      },
      getOwnPropertyDescriptor(target, key) {
        trapCalls += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      getPrototypeOf(target) {
        trapCalls += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        trapCalls += 1;
        return Reflect.ownKeys(target);
      },
    });
    expect(isTm2OperationalConnectionError(proxied)).toBe(false);
    expect(trapCalls).toBe(0);
  });

  it('rejects prototype-forged Error identities before descriptors, getters, or proxy traps', () => {
    const forged = createPrototypeForgery(Error.prototype);
    Object.defineProperty(forged, 'code', {
      value: 'ECONNREFUSED',
      enumerable: true,
    });
    expect(isNativeErrorOracle(forged)).toBe(false);
    expect(isTm2OperationalConnectionError(forged)).toBe(false);

    let getterCalls = 0;
    const accessorForgery = createPrototypeForgery(Error.prototype);
    Object.defineProperty(accessorForgery, 'code', {
      get() {
        getterCalls += 1;
        return 'ECONNREFUSED';
      },
      enumerable: true,
    });
    expect(isTm2OperationalConnectionError(accessorForgery)).toBe(false);
    expect(getterCalls).toBe(0);

    let trapCalls = 0;
    const proxiedForgery = createTrapCountingProxy(forged, () => {
      trapCalls += 1;
    });
    expect(isTm2OperationalConnectionError(proxiedForgery)).toBe(false);
    expect(trapCalls).toBe(0);

    class SyntheticNativeOperationalError extends Error {}
    const nativeSubclass = new SyntheticNativeOperationalError(
      'synthetic-redacted',
    );
    Object.defineProperty(nativeSubclass, 'code', {
      value: 'ECONNREFUSED',
      enumerable: true,
    });
    expect(isNativeErrorOracle(nativeSubclass)).toBe(true);
    expect(isTm2OperationalConnectionError(nativeSubclass)).toBe(true);
  });

  it('decodes AggregateError members descriptor-first and never trusts its top-level code', () => {
    const topLevelShortcut = new AggregateError([
      syntheticOperationalError('UNKNOWN'),
    ]);
    Object.defineProperty(topLevelShortcut, 'code', {
      value: 'ECONNREFUSED',
      enumerable: true,
    });
    expect(isTm2OperationalConnectionError(topLevelShortcut)).toBe(false);

    const allOperational = new AggregateError([
      syntheticOperationalError('ECONNREFUSED'),
      syntheticOperationalError('57P03'),
    ]);
    expect(isTm2OperationalConnectionError(allOperational)).toBe(true);
    expect(
      isTm2OperationalConnectionError(
        new AggregateError([
          syntheticOperationalError(),
          syntheticOperationalError('UNKNOWN'),
        ]),
      ),
    ).toBe(false);

    let elementGetterCalls = 0;
    const accessorElements: unknown[] = [];
    Object.defineProperty(accessorElements, '0', {
      get() {
        elementGetterCalls += 1;
        return syntheticOperationalError();
      },
      enumerable: true,
      configurable: true,
    });
    accessorElements.length = 1;
    const accessorAggregate = new AggregateError([]);
    Object.defineProperty(accessorAggregate, 'errors', {
      value: accessorElements,
      enumerable: false,
      configurable: true,
    });
    expect(isTm2OperationalConnectionError(accessorAggregate)).toBe(false);
    expect(elementGetterCalls).toBe(0);
  });

  it('rejects prototype-forged AggregateError identities before member access or proxy traps', () => {
    const forged = createPrototypeForgery(AggregateError.prototype);
    Object.defineProperty(forged, 'errors', {
      value: [syntheticOperationalError()],
    });
    expect(isNativeErrorOracle(forged)).toBe(false);
    expect(isTm2OperationalConnectionError(forged)).toBe(false);

    let getterCalls = 0;
    const accessorForgery = createPrototypeForgery(AggregateError.prototype);
    Object.defineProperty(accessorForgery, 'errors', {
      get() {
        getterCalls += 1;
        return [syntheticOperationalError()];
      },
    });
    expect(isTm2OperationalConnectionError(accessorForgery)).toBe(false);
    expect(getterCalls).toBe(0);

    let trapCalls = 0;
    const proxiedForgery = createTrapCountingProxy(forged, () => {
      trapCalls += 1;
    });
    expect(isTm2OperationalConnectionError(proxiedForgery)).toBe(false);
    expect(trapCalls).toBe(0);
  });

  it('rejects hostile AggregateError containers and members with zero proxy traps', () => {
    let arrayTrapCalls = 0;
    const proxiedArray = new Proxy([syntheticOperationalError()], {
      get(target, key, receiver) {
        arrayTrapCalls += 1;
        void target;
        void key;
        void receiver;
        return undefined;
      },
      getOwnPropertyDescriptor(target, key) {
        arrayTrapCalls += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      getPrototypeOf(target) {
        arrayTrapCalls += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        arrayTrapCalls += 1;
        return Reflect.ownKeys(target);
      },
    });
    const proxiedErrors = new AggregateError([]);
    Object.defineProperty(proxiedErrors, 'errors', {value: proxiedArray});
    expect(isTm2OperationalConnectionError(proxiedErrors)).toBe(false);
    expect(arrayTrapCalls).toBe(0);

    let memberTrapCalls = 0;
    const proxiedMember = new Proxy(syntheticOperationalError(), {
      get(target, key, receiver) {
        memberTrapCalls += 1;
        void target;
        void key;
        void receiver;
        return undefined;
      },
      getOwnPropertyDescriptor(target, key) {
        memberTrapCalls += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      getPrototypeOf(target) {
        memberTrapCalls += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        memberTrapCalls += 1;
        return Reflect.ownKeys(target);
      },
    });
    expect(
      isTm2OperationalConnectionError(new AggregateError([proxiedMember])),
    ).toBe(false);
    expect(memberTrapCalls).toBe(0);

    const sparse = new Array<unknown>(2);
    sparse[0] = syntheticOperationalError();
    const sparseAggregate = new AggregateError([]);
    Object.defineProperty(sparseAggregate, 'errors', {value: sparse});
    expect(isTm2OperationalConnectionError(sparseAggregate)).toBe(false);

    const extra = [syntheticOperationalError()];
    Object.defineProperty(extra, 'extra', {value: true, enumerable: true});
    const extraAggregate = new AggregateError([]);
    Object.defineProperty(extraAggregate, 'errors', {value: extra});
    expect(isTm2OperationalConnectionError(extraAggregate)).toBe(false);

    const symbol = [syntheticOperationalError()];
    Object.defineProperty(symbol, Symbol('synthetic'), {value: true});
    const symbolAggregate = new AggregateError([]);
    Object.defineProperty(symbolAggregate, 'errors', {value: symbol});
    expect(isTm2OperationalConnectionError(symbolAggregate)).toBe(false);
  });

  it('bounds AggregateError cycles, nesting depth, and total members', () => {
    const selfCycle = new AggregateError([]);
    Object.defineProperty(selfCycle, 'errors', {value: [selfCycle]});
    expect(isTm2OperationalConnectionError(selfCycle)).toBe(false);

    const first = new AggregateError([]);
    const second = new AggregateError([]);
    Object.defineProperty(first, 'errors', {value: [second]});
    Object.defineProperty(second, 'errors', {value: [first]});
    expect(isTm2OperationalConnectionError(first)).toBe(false);

    let nested: unknown = syntheticOperationalError();
    for (let depth = 0; depth <= TM2_OPERATIONAL_ERROR_MAX_DEPTH; depth += 1) {
      nested = new AggregateError([nested]);
    }
    expect(isTm2OperationalConnectionError(nested)).toBe(false);

    const overBudget = Array.from(
      {length: TM2_OPERATIONAL_ERROR_MAX_MEMBERS + 1},
      () => syntheticOperationalError(),
    );
    expect(
      isTm2OperationalConnectionError(new AggregateError(overBudget)),
    ).toBe(false);
  });

  it('classifies a syntax-valid unreachable endpoint as NOT_READY with exit 2', async () => {
    const outcome = await runTm2AdmissionPreflight(
      formalSyntheticEnvironment(),
      admissionDependencies(() =>
        Promise.reject(
          new Tm2AdmissionProbeError(
            'tm2_connection_unavailable',
            'STRUIINFO_TM2_ADMIN_DATABASE_URL',
          ),
        ),
      ),
    );
    expect(outcome).toEqual({
      status: 'not_ready',
      code: 'tm2_connection_unavailable',
      variable: 'STRUIINFO_TM2_ADMIN_DATABASE_URL',
    });
    expect(classifyTm2HarnessOutcome(outcome)).toMatchObject({
      exitCode: 2,
      outcome: 'not_ready',
    });
  });

  it('accepts only branded native admission probe errors and freezes classification', async () => {
    const forged = createPrototypeForgery(Tm2AdmissionProbeError.prototype);
    Object.defineProperty(forged, 'code', {
      value: 'tm2_connection_unavailable',
      configurable: true,
      writable: true,
    });
    Object.defineProperty(forged, 'variable', {
      value: 'STRUIINFO_TM2_ADMIN_DATABASE_URL',
      configurable: true,
      writable: true,
    });
    expect(isNativeErrorOracle(forged)).toBe(false);
    const forgedOutcome = await runTm2AdmissionPreflight(
      formalSyntheticEnvironment(),
      admissionDependencies(() => rejectUnknown(forged)),
    );
    expect(forgedOutcome).toEqual({
      status: 'failed',
      code: 'tm2_admission_probe_failure',
    });
    Reflect.set(forged, 'code', 'tm2_environment_probe_unavailable');
    expect(forgedOutcome).toEqual({
      status: 'failed',
      code: 'tm2_admission_probe_failure',
    });

    const nativeButUnbranded = new Error('synthetic-redacted');
    Object.setPrototypeOf(nativeButUnbranded, Tm2AdmissionProbeError.prototype);
    Object.defineProperty(nativeButUnbranded, 'code', {
      value: 'tm2_connection_unavailable',
    });
    Object.defineProperty(nativeButUnbranded, 'variable', {
      value: 'STRUIINFO_TM2_ADMIN_DATABASE_URL',
    });
    expect(isNativeErrorOracle(nativeButUnbranded)).toBe(true);
    await expect(
      runTm2AdmissionPreflight(
        formalSyntheticEnvironment(),
        admissionDependencies(() => rejectUnknown(nativeButUnbranded)),
      ),
    ).resolves.toEqual({
      status: 'failed',
      code: 'tm2_admission_probe_failure',
    });

    let trapCalls = 0;
    const proxiedForgery = createTrapCountingProxy(forged, () => {
      trapCalls += 1;
    });
    const proxyOutcome = await runTm2AdmissionPreflight(
      formalSyntheticEnvironment(),
      admissionDependencies(() => rejectUnknown(proxiedForgery)),
    );
    expect(proxyOutcome).toEqual({
      status: 'failed',
      code: 'tm2_admission_probe_failure',
    });
    expect(trapCalls).toBe(0);

    const genuine = new Tm2AdmissionProbeError(
      'tm2_connection_unavailable',
      'STRUIINFO_TM2_ADMIN_DATABASE_URL',
    );
    expect(isNativeErrorOracle(genuine)).toBe(true);
    const genuineOutcome = await runTm2AdmissionPreflight(
      formalSyntheticEnvironment(),
      admissionDependencies(() => Promise.reject(genuine)),
    );
    expect(genuineOutcome).toEqual({
      status: 'not_ready',
      code: 'tm2_connection_unavailable',
      variable: 'STRUIINFO_TM2_ADMIN_DATABASE_URL',
    });
  });

  it('classifies PostgreSQL version and session/role admission drift as NOT_READY', async () => {
    const oldVersion = admittedObservation();
    const versionOutcome = await runTm2AdmissionPreflight(
      formalSyntheticEnvironment(),
      admissionDependencies(() =>
        Promise.resolve({
          ...oldVersion,
          sessions: {
            ...oldVersion.sessions,
            runtime: {
              ...oldVersion.sessions.runtime,
              serverVersionNumber: 170_000,
            },
          },
        }),
      ),
    );
    expect(versionOutcome).toMatchObject({
      status: 'not_ready',
      code: 'tm2_server_version',
      variable: 'STRUIINFO_TM2_RUNTIME_DATABASE_URL',
    });

    const wrongSession = admittedObservation();
    const sessionOutcome = await runTm2AdmissionPreflight(
      formalSyntheticEnvironment(),
      admissionDependencies(() =>
        Promise.resolve({
          ...wrongSession,
          sessions: {
            ...wrongSession.sessions,
            migration: {
              ...wrongSession.sessions.migration,
              currentUser: 'synthetic_wrong_role',
            },
          },
        }),
      ),
    );
    expect(sessionOutcome).toMatchObject({
      status: 'not_ready',
      code: 'tm2_session_identity',
      variable: 'STRUIINFO_TM2_MIGRATION_DATABASE_URL',
    });

    const wrongOwnership = admittedObservation();
    const ownershipOutcome = await runTm2AdmissionPreflight(
      formalSyntheticEnvironment(),
      admissionDependencies(() =>
        Promise.resolve({
          ...wrongOwnership,
          runtimeOwnedProjectObjectCount: 1,
        }),
      ),
    );
    expect(ownershipOutcome).toMatchObject({
      status: 'not_ready',
      code: 'tm2_runtime_ownership',
    });
  });

  it('keeps admitted mandatory failure as FAIL and success as PASS', async () => {
    const admission = await runTm2AdmissionPreflight(
      formalSyntheticEnvironment(),
      admissionDependencies(() => Promise.resolve(admittedObservation())),
    );
    expect(admission).toEqual({
      status: 'admitted',
      code: 'tm2_environment_admitted',
    });
    expect(
      classifyTm2HarnessOutcome(admission, {exitCode: 1, signal: null}),
    ).toEqual({
      exitCode: 1,
      event: 'postgres_tm2_failed',
      outcome: 'failed',
      code: 'tm2_mandatory_failure',
    });
    expect(
      classifyTm2HarnessOutcome(admission, {exitCode: 0, signal: null}),
    ).toEqual({
      exitCode: 1,
      event: 'postgres_tm2_failed',
      outcome: 'failed',
      code: 'tm2_mandatory_report_invalid',
    });
    expect(
      classifyTm2HarnessOutcome(admission, {exitCode: 0, signal: null}, 488),
    ).toEqual({
      exitCode: 0,
      event: 'postgres_tm2_complete',
      outcome: 'pass',
    });
  });

  it('classifies product decoder disagreement as candidate FAIL', async () => {
    const environment = formalSyntheticEnvironment();
    environment.STRUIINFO_TM2_RUNTIME_DATABASE_URL += '?sslmode=disable';
    const outcome = await runTm2AdmissionPreflight(environment, {
      decodeProductConfig(role, input) {
        if (role === 'runtime') {
          return accepted('runtime').config;
        }
        return acceptedFromInput(role, input);
      },
      isProductConfigError(error) {
        return (
          !types.isProxy(error) &&
          isNativeErrorOracle(error) &&
          error instanceof PostgresConnectionConfigError
        );
      },
      inspectEnvironment() {
        return Promise.resolve({observation: admittedObservation()});
      },
    });
    expect(outcome).toEqual({
      status: 'failed',
      code: 'tm2_product_accepted_prohibited_url',
    });
    expect(classifyTm2HarnessOutcome(outcome).exitCode).toBe(1);
  });

  it('accepts only the public config error as a prohibited URL rejection', async () => {
    const environment = formalSyntheticEnvironment();
    environment.STRUIINFO_TM2_RUNTIME_DATABASE_URL += '?sslmode=disable';
    const outcome = await runTm2AdmissionPreflight(
      environment,
      admissionDependencies(() => Promise.resolve(admittedObservation())),
    );
    expect(outcome).toEqual({
      status: 'not_ready',
      code: 'tm2_url_override',
      variable: 'STRUIINFO_TM2_RUNTIME_DATABASE_URL',
    });
    expect(classifyTm2HarnessOutcome(outcome).exitCode).toBe(2);
  });

  it('rejects prototype-forged product configuration errors without invoking the predicate or proxy traps', async () => {
    const environment = formalSyntheticEnvironment();
    environment.STRUIINFO_TM2_RUNTIME_DATABASE_URL += '?sslmode=disable';
    const forged = createPrototypeForgery(
      PostgresConnectionConfigError.prototype,
    );
    expect(isNativeErrorOracle(forged)).toBe(false);
    let predicateCalls = 0;
    const dependencies = admissionDependencies(() =>
      Promise.resolve(admittedObservation()),
    );
    const forgedOutcome = await runTm2AdmissionPreflight(environment, {
      ...dependencies,
      decodeProductConfig(role, input) {
        if (role === 'runtime') {
          return throwUnknown(forged);
        }
        return dependencies.decodeProductConfig(role, input);
      },
      isProductConfigError(error) {
        predicateCalls += 1;
        return dependencies.isProductConfigError(error);
      },
    });
    expect(forgedOutcome).toEqual({
      status: 'failed',
      code: 'tm2_product_decoder_failure',
    });
    expect(predicateCalls).toBe(0);
    Reflect.set(forged, 'syntheticMutation', true);
    expect(forgedOutcome).toEqual({
      status: 'failed',
      code: 'tm2_product_decoder_failure',
    });

    let trapCalls = 0;
    const proxiedForgery = createTrapCountingProxy(forged, () => {
      trapCalls += 1;
    });
    const proxyOutcome = await runTm2AdmissionPreflight(environment, {
      ...dependencies,
      decodeProductConfig(role, input) {
        if (role === 'runtime') {
          return throwUnknown(proxiedForgery);
        }
        return dependencies.decodeProductConfig(role, input);
      },
    });
    expect(proxyOutcome).toEqual({
      status: 'failed',
      code: 'tm2_product_decoder_failure',
    });
    expect(trapCalls).toBe(0);
  });

  it('fails closed when a prohibited URL triggers a TypeError', async () => {
    const environment = formalSyntheticEnvironment();
    environment.STRUIINFO_TM2_RUNTIME_DATABASE_URL += '?sslmode=disable';
    const dependencies = admissionDependencies(() =>
      Promise.resolve(admittedObservation()),
    );
    const outcome = await runTm2AdmissionPreflight(environment, {
      ...dependencies,
      decodeProductConfig(role, input) {
        if (role === 'runtime') {
          throw new TypeError('synthetic-sensitive-decoder-text');
        }
        return dependencies.decodeProductConfig(role, input);
      },
    });
    expect(outcome).toEqual({
      status: 'failed',
      code: 'tm2_product_decoder_failure',
    });
    expect(classifyTm2HarnessOutcome(outcome).exitCode).toBe(1);
  });

  it('fails closed when an admitted URL triggers any decoder exception', async () => {
    for (const thrown of [
      new PostgresConnectionConfigError(),
      new TypeError('synthetic-sensitive-decoder-text'),
      new Error('synthetic-sensitive-decoder-text'),
      'synthetic-sensitive-decoder-text',
    ]) {
      const dependencies = admissionDependencies(() =>
        Promise.resolve(admittedObservation()),
      );
      const outcome = await runTm2AdmissionPreflight(
        formalSyntheticEnvironment(),
        {
          ...dependencies,
          decodeProductConfig(role, input) {
            if (role === 'runtime') {
              return throwUnknown(thrown);
            }
            return dependencies.decodeProductConfig(role, input);
          },
        },
      );
      expect(outcome).toEqual({
        status: 'failed',
        code:
          thrown instanceof PostgresConnectionConfigError
            ? 'tm2_product_rejected_admitted_url'
            : 'tm2_product_decoder_failure',
      });
      expect(classifyTm2HarnessOutcome(outcome).exitCode).toBe(1);
      expect(JSON.stringify(outcome)).not.toContain('sensitive');
    }
  });

  it('fails closed on unknown probe errors and malformed observations', async () => {
    const sensitiveCanary = 'synthetic-sensitive-probe-text';
    for (const thrown of [
      new Error(sensitiveCanary),
      new TypeError(sensitiveCanary),
      sensitiveCanary,
    ]) {
      const outcome = await runTm2AdmissionPreflight(
        formalSyntheticEnvironment(),
        admissionDependencies(() => rejectUnknown(thrown)),
      );
      const encoded = JSON.stringify(outcome);
      expect(outcome).toEqual({
        status: 'failed',
        code: 'tm2_admission_probe_failure',
      });
      expect(classifyTm2HarnessOutcome(outcome).exitCode).toBe(1);
      expect(encoded).not.toContain(sensitiveCanary);
      expect(encoded).not.toContain('sensitive-probe');
      expect(decodeTm2AdmissionChannel(encoded)).toEqual(outcome);
    }
    const malformed = await runTm2AdmissionPreflight(
      formalSyntheticEnvironment(),
      admissionDependencies(() =>
        Promise.resolve({} as Tm2AdmissionEnvironmentObservation),
      ),
    );
    expect(malformed).toEqual({
      status: 'failed',
      code: 'tm2_admission_probe_failure',
    });
    expect(
      decodeTm2AdmissionChannel(
        '{"status":"failed","code":"tm2_admission_probe_failure","unexpected":"synthetic"}',
      ),
    ).toBeUndefined();
  });

  it('rejects proxied environment observations at every container with zero traps', async () => {
    const locations = ['root', 'sessions', 'session', 'roles', 'role'] as const;
    for (const location of locations) {
      const source = mutableAdmittedObservation();
      let traps = 0;
      const proxied = <T extends object>(target: T): T =>
        new Proxy(target, {
          get(candidate, key, receiver) {
            traps += 1;
            void candidate;
            void key;
            void receiver;
            return undefined;
          },
          getOwnPropertyDescriptor(candidate, key) {
            traps += 1;
            return Reflect.getOwnPropertyDescriptor(candidate, key);
          },
          getPrototypeOf(candidate) {
            traps += 1;
            return Reflect.getPrototypeOf(candidate);
          },
          ownKeys(candidate) {
            traps += 1;
            return Reflect.ownKeys(candidate);
          },
        });
      let hostile: Tm2AdmissionEnvironmentObservation;
      switch (location) {
        case 'root':
          hostile = proxied(source);
          break;
        case 'sessions':
          hostile = {...source, sessions: proxied(source.sessions)};
          break;
        case 'session':
          hostile = {
            ...source,
            sessions: {
              ...source.sessions,
              runtime: proxied(source.sessions.runtime),
            },
          };
          break;
        case 'roles':
          hostile = {...source, roles: proxied([...source.roles])};
          break;
        case 'role': {
          const firstRole = source.roles[0];
          if (firstRole === undefined) {
            throw new Error('SYNTHETIC_ROLE_OBSERVATION_MISSING');
          }
          hostile = {
            ...source,
            roles: [proxied(firstRole), ...source.roles.slice(1)],
          };
          break;
        }
      }
      const dependencies =
        location === 'root'
          ? {
              ...admissionDependencies(() =>
                Promise.resolve(admittedObservation()),
              ),
              inspectEnvironment: () => Promise.resolve({observation: hostile}),
            }
          : admissionDependencies(() => Promise.resolve(hostile));
      const outcome = await runTm2AdmissionPreflight(
        formalSyntheticEnvironment(),
        dependencies,
      );
      expect(outcome, location).toEqual({
        status: 'failed',
        code: 'tm2_admission_probe_failure',
      });
      expect(traps, location).toBe(0);
    }
  });

  it('rejects observation accessors, sparse arrays, symbols, and extra keys without invocation', async () => {
    let getterCalls = 0;
    const accessor = mutableAdmittedObservation();
    Object.defineProperty(accessor, 'projectSchemaCount', {
      get() {
        getterCalls += 1;
        return 0;
      },
      enumerable: true,
      configurable: true,
    });
    const sparse = mutableAdmittedObservation();
    const sparseRoles = new Array<
      Tm2AdmissionEnvironmentObservation['roles'][number]
    >(3);
    const firstSparseRole = sparse.roles[0];
    const thirdSparseRole = sparse.roles[2];
    if (firstSparseRole === undefined || thirdSparseRole === undefined) {
      throw new Error('SYNTHETIC_ROLE_OBSERVATION_MISSING');
    }
    sparseRoles[0] = firstSparseRole;
    sparseRoles[2] = thirdSparseRole;
    sparse.roles = sparseRoles;

    const withSymbol = mutableAdmittedObservation();
    Object.defineProperty(withSymbol.sessions, Symbol('synthetic'), {
      value: true,
    });
    const withExtra =
      mutableAdmittedObservation() as DeepMutable<Tm2AdmissionEnvironmentObservation> & {
        syntheticExtra?: boolean;
      };
    withExtra.syntheticExtra = true;

    for (const observation of [accessor, sparse, withSymbol, withExtra]) {
      const outcome = await runTm2AdmissionPreflight(
        formalSyntheticEnvironment(),
        admissionDependencies(() => Promise.resolve(observation)),
      );
      expect(outcome).toEqual({
        status: 'failed',
        code: 'tm2_admission_probe_failure',
      });
    }
    expect(getterCalls).toBe(0);
  });

  it('projects a valid observation into owned frozen data without inherited setter calls', async () => {
    const source = mutableAdmittedObservation();
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'databaseOwner',
    );
    let setterCalls = 0;
    Object.defineProperty(Object.prototype, 'databaseOwner', {
      set() {
        setterCalls += 1;
      },
      configurable: true,
    });
    try {
      const owned = decodeClosedTm2EnvironmentObservation(source);
      expect(owned).toBeDefined();
      expect(Object.getPrototypeOf(owned)).toBeNull();
      expect(Object.getPrototypeOf(owned?.sessions)).toBeNull();
      expect(Object.isFrozen(owned)).toBe(true);
      expect(Object.isFrozen(owned?.roles)).toBe(true);
      expect(setterCalls).toBe(0);

      source.databaseOwner = 'synthetic_mutated_owner';
      source.sessions.runtime.currentUser = 'synthetic_mutated_runtime';
      const firstRole = source.roles[0];
      if (firstRole === undefined) {
        throw new Error('SYNTHETIC_ROLE_OBSERVATION_MISSING');
      }
      source.roles[0] = {...firstRole, canLogin: false};
      expect(owned?.databaseOwner).toBe('struinfo_tm2_admin');
      expect(owned?.sessions.runtime.currentUser).toBe('struinfo_tm2_runtime');
      expect(owned?.roles[0]?.canLogin).toBe(true);

      const outcome = await runTm2AdmissionPreflight(
        formalSyntheticEnvironment(),
        admissionDependencies(() =>
          Promise.resolve(mutableAdmittedObservation()),
        ),
      );
      expect(outcome).toEqual({
        status: 'admitted',
        code: 'tm2_environment_admitted',
      });
    } finally {
      if (originalDescriptor === undefined) {
        delete (Object.prototype as {databaseOwner?: unknown}).databaseOwner;
      } else {
        Object.defineProperty(
          Object.prototype,
          'databaseOwner',
          originalDescriptor,
        );
      }
    }
    expect(setterCalls).toBe(0);
  });
});

describe('Test-owned PostgreSQL TM2 bounded child seam', () => {
  it('freezes independent finite execution and reap deadlines', () => {
    expect(TM2_ADMISSION_CHILD_DEADLINE_MS).toBe(60_000);
    expect(TM2_MANDATORY_CHILD_DEADLINE_MS).toBe(1_800_000);
    expect(TM2_CHILD_REAP_DEADLINE_MS).toBe(10_000);
    expect(TM2_MANDATORY_CHILD_DEADLINE_MS).toBeGreaterThan(
      TM2_ADMISSION_CHILD_DEADLINE_MS,
    );
  });

  it('clears the deadline and never kills a normally closed child', async () => {
    const child = new FakeChild();
    const deadline = new FakeDeadline();
    const output = new FakeOutput();
    const resultPromise = runTm2BoundedChild({
      child,
      deadline,
      deadlineMs: TM2_ADMISSION_CHILD_DEADLINE_MS,
      reapDeadlineMs: TM2_CHILD_REAP_DEADLINE_MS,
      output,
    });
    expect(deadline.scheduledDelays).toEqual([60_000]);
    child.emitClose(0, null);
    await expect(resultPromise).resolves.toEqual({
      status: 'completed',
      exitCode: 0,
      signal: null,
      confirmedClosed: true,
      safeToDeleteTaskRoot: true,
    });
    expect(child.killCalls).toEqual([]);
    expect(child.listenerCount).toBe(0);
    expect(deadline.activeCount).toBe(0);
    expect(output.stops).toEqual([false]);
  });

  it('cleans up and fails safely on a child spawn error', async () => {
    const child = new FakeChild();
    const deadline = new FakeDeadline();
    const output = new FakeOutput();
    const resultPromise = runTm2BoundedChild({
      child,
      deadline,
      deadlineMs: TM2_ADMISSION_CHILD_DEADLINE_MS,
      reapDeadlineMs: TM2_CHILD_REAP_DEADLINE_MS,
      output,
    });
    child.emitError(new Error('synthetic-sensitive-child-error'));
    const result = await resultPromise;
    expect(result).toEqual({
      status: 'spawn_failed',
      confirmedClosed: false,
      safeToDeleteTaskRoot: true,
    });
    if (result.status !== 'completed') {
      const code = failureCodeForBoundedChild('admission', result);
      expect(code).toBe('tm2_admission_child_failure');
      expect(classifyTm2HarnessOutcome({status: 'failed', code}).exitCode).toBe(
        1,
      );
    }
    expect(JSON.stringify(result)).not.toContain('sensitive');
    expect(child.listenerCount).toBe(0);
    expect(deadline.activeCount).toBe(0);
    expect(output.stops).toEqual([true]);
  });

  it('kills and reaps a hung admission child as FAIL', async () => {
    const child = new FakeChild();
    const deadline = new FakeDeadline();
    const output = new FakeOutput();
    const resultPromise = runTm2BoundedChild({
      child,
      deadline,
      deadlineMs: TM2_ADMISSION_CHILD_DEADLINE_MS,
      reapDeadlineMs: TM2_CHILD_REAP_DEADLINE_MS,
      output,
    });
    deadline.fire(TM2_ADMISSION_CHILD_DEADLINE_MS);
    expect(child.killCalls).toEqual(['SIGKILL']);
    expect(deadline.scheduledDelays).toEqual([60_000, 10_000]);
    child.emitClose(null, 'SIGKILL');
    const result = await resultPromise;
    expect(result).toEqual({
      status: 'timed_out',
      confirmedClosed: true,
      safeToDeleteTaskRoot: true,
    });
    if (result.status !== 'completed') {
      const code = failureCodeForBoundedChild('admission', result);
      expect(code).toBe('tm2_admission_child_timeout');
      expect(classifyTm2HarnessOutcome({status: 'failed', code}).exitCode).toBe(
        1,
      );
    }
    expect(output.value).toBe('');
    expect(output.stops).toEqual([true]);
    expect(child.listenerCount).toBe(0);
    expect(deadline.activeCount).toBe(0);
  });

  it('kills and reaps a hung mandatory child as FAIL', async () => {
    const child = new FakeChild();
    const deadline = new FakeDeadline();
    const output = new FakeOutput();
    const resultPromise = runTm2BoundedChild({
      child,
      deadline,
      deadlineMs: TM2_MANDATORY_CHILD_DEADLINE_MS,
      reapDeadlineMs: TM2_CHILD_REAP_DEADLINE_MS,
      output,
    });
    deadline.fire(TM2_MANDATORY_CHILD_DEADLINE_MS);
    child.emitClose(null, 'SIGKILL');
    const result = await resultPromise;
    expect(result).toEqual({
      status: 'timed_out',
      confirmedClosed: true,
      safeToDeleteTaskRoot: true,
    });
    if (result.status !== 'completed') {
      const code = failureCodeForBoundedChild('mandatory', result);
      expect(code).toBe('tm2_mandatory_child_timeout');
      expect(classifyTm2HarnessOutcome({status: 'failed', code}).exitCode).toBe(
        1,
      );
    }
    expect(child.killCalls).toEqual(['SIGKILL']);
    expect(child.listenerCount).toBe(0);
    expect(deadline.activeCount).toBe(0);
  });

  it('fails closed when termination cannot be reaped', async () => {
    const child = new FakeChild();
    const deadline = new FakeDeadline();
    const output = new FakeOutput();
    const resultPromise = runTm2BoundedChild({
      child,
      deadline,
      deadlineMs: TM2_ADMISSION_CHILD_DEADLINE_MS,
      reapDeadlineMs: TM2_CHILD_REAP_DEADLINE_MS,
      output,
    });
    deadline.fire(TM2_ADMISSION_CHILD_DEADLINE_MS);
    deadline.fire(TM2_CHILD_REAP_DEADLINE_MS);
    const result = await resultPromise;
    expect(result).toEqual({
      status: 'termination_failed',
      confirmedClosed: false,
      safeToDeleteTaskRoot: false,
    });
    if (result.status !== 'completed') {
      expect(failureCodeForBoundedChild('admission', result)).toBe(
        'tm2_admission_child_termination_failure',
      );
    }
    expect(child.listenerCount).toBe(0);
    expect(deadline.activeCount).toBe(0);
  });

  it('fails closed when child termination reports failure before close', async () => {
    const child = new FakeChild();
    child.killResult = false;
    const deadline = new FakeDeadline();
    const output = new FakeOutput();
    const resultPromise = runTm2BoundedChild({
      child,
      deadline,
      deadlineMs: TM2_MANDATORY_CHILD_DEADLINE_MS,
      reapDeadlineMs: TM2_CHILD_REAP_DEADLINE_MS,
      output,
    });
    deadline.fire(TM2_MANDATORY_CHILD_DEADLINE_MS);
    child.emitClose(null, 'SIGKILL');
    const result = await resultPromise;
    expect(result).toEqual({
      status: 'termination_failed',
      confirmedClosed: true,
      safeToDeleteTaskRoot: true,
    });
    if (result.status !== 'completed') {
      expect(failureCodeForBoundedChild('mandatory', result)).toBe(
        'tm2_mandatory_child_termination_failure',
      );
    }
    expect(child.killCalls).toEqual(['SIGKILL']);
    expect(child.listenerCount).toBe(0);
    expect(deadline.activeCount).toBe(0);
  });

  it('detaches when kill returns false and the child never closes', async () => {
    const child = new FakeChild();
    child.killResult = false;
    const deadline = new FakeDeadline();
    const output = new FakeOutput();
    const resultPromise = runTm2BoundedChild({
      child,
      deadline,
      deadlineMs: TM2_MANDATORY_CHILD_DEADLINE_MS,
      reapDeadlineMs: TM2_CHILD_REAP_DEADLINE_MS,
      output,
    });
    deadline.fire(TM2_MANDATORY_CHILD_DEADLINE_MS);
    deadline.fire(TM2_CHILD_REAP_DEADLINE_MS);
    await expect(resultPromise).resolves.toEqual({
      status: 'termination_failed',
      confirmedClosed: false,
      safeToDeleteTaskRoot: false,
    });
    expect(child.killCalls).toEqual(['SIGKILL']);
    expect(child.cleanupCalls).toContain('unref');
    expect(child.listenerCount).toBe(0);
    expect(deadline.activeCount).toBe(0);
  });

  it('ignores late close and output after a timeout result is frozen', async () => {
    const child = new FakeChild();
    const deadline = new FakeDeadline();
    const output = new FakeOutput();
    const resultPromise = runTm2BoundedChild({
      child,
      deadline,
      deadlineMs: TM2_MANDATORY_CHILD_DEADLINE_MS,
      reapDeadlineMs: TM2_CHILD_REAP_DEADLINE_MS,
      output,
    });
    deadline.fire(TM2_MANDATORY_CHILD_DEADLINE_MS);
    child.emitClose(null, 'SIGKILL');
    const result = await resultPromise;
    output.append('synthetic-late-report');
    child.emitClose(0, null);
    expect(result).toEqual({
      status: 'timed_out',
      confirmedClosed: true,
      safeToDeleteTaskRoot: true,
    });
    if (result.status !== 'completed') {
      expect(failureCodeForBoundedChild('mandatory', result)).toBe(
        'tm2_mandatory_child_timeout',
      );
    }
    expect(child.listenerCount).toBe(0);
    expect(deadline.activeCount).toBe(0);
    expect(output.stops).toEqual([true]);
    expect(output.value).toBe('');
  });

  it('records a timeout-period error but waits for confirmed close before settling', async () => {
    const child = new FakeChild();
    const deadline = new FakeDeadline();
    const output = new FakeOutput();
    let settled = false;
    const resultPromise = runTm2BoundedChild({
      child,
      deadline,
      deadlineMs: TM2_ADMISSION_CHILD_DEADLINE_MS,
      reapDeadlineMs: TM2_CHILD_REAP_DEADLINE_MS,
      output,
    }).then((result) => {
      settled = true;
      return result;
    });
    deadline.fire(TM2_ADMISSION_CHILD_DEADLINE_MS);
    child.emitError(new Error('synthetic-redacted'));
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emitClose(null, 'SIGKILL');
    await expect(resultPromise).resolves.toEqual({
      status: 'termination_failed',
      confirmedClosed: true,
      safeToDeleteTaskRoot: true,
    });
  });

  it('detaches after reap failure and marks the task root unsafe to delete', async () => {
    const child = new FakeChild();
    const deadline = new FakeDeadline();
    const output = new FakeOutput();
    const resultPromise = runTm2BoundedChild({
      child,
      deadline,
      deadlineMs: TM2_MANDATORY_CHILD_DEADLINE_MS,
      reapDeadlineMs: TM2_CHILD_REAP_DEADLINE_MS,
      output,
    });
    deadline.fire(TM2_MANDATORY_CHILD_DEADLINE_MS);
    child.emitError(new Error('synthetic-redacted'));
    deadline.fire(TM2_CHILD_REAP_DEADLINE_MS);
    const result = await resultPromise;
    expect(result).toEqual({
      status: 'termination_failed',
      confirmedClosed: false,
      safeToDeleteTaskRoot: false,
    });
    expect(child.cleanupCalls).toEqual(
      expect.arrayContaining([
        'destroyStdin',
        'destroyStdout',
        'destroyStderr',
        'offError',
        'offClose',
        'unref',
      ]),
    );
    expect(output.destroyCalls).toBe(1);
    child.emitClose(0, null);
    expect(result.safeToDeleteTaskRoot).toBe(false);
  });

  it('handles kill false, kill throw, and synchronous close without a double settlement', async () => {
    const scenarios = [
      {killResult: false, killThrows: false, closeDuringKill: false},
      {killResult: true, killThrows: true, closeDuringKill: false},
      {killResult: true, killThrows: false, closeDuringKill: true},
    ] as const;
    for (const scenario of scenarios) {
      const child = new FakeChild();
      child.killResult = scenario.killResult;
      child.killThrows = scenario.killThrows;
      child.closeDuringKill = scenario.closeDuringKill;
      const deadline = new FakeDeadline();
      const output = new FakeOutput();
      const resultPromise = runTm2BoundedChild({
        child,
        deadline,
        deadlineMs: TM2_ADMISSION_CHILD_DEADLINE_MS,
        reapDeadlineMs: TM2_CHILD_REAP_DEADLINE_MS,
        output,
      });
      deadline.fire(TM2_ADMISSION_CHILD_DEADLINE_MS);
      if (!scenario.closeDuringKill) {
        child.emitClose(null, 'SIGKILL');
      }
      const result = await resultPromise;
      expect(result.confirmedClosed).toBe(true);
      expect(result.safeToDeleteTaskRoot).toBe(true);
      expect(result.status).toBe(
        scenario.closeDuringKill ? 'timed_out' : 'termination_failed',
      );
      child.emitClose(0, null);
      expect(child.listenerCount).toBe(0);
      expect(deadline.activeCount).toBe(0);
    }
  });

  it('attempts every reap cleanup independently when several cleanup operations throw', async () => {
    const child = new FakeChild();
    child.offErrorThrows = true;
    child.offCloseThrows = true;
    child.destroyStdinThrows = true;
    child.destroyStdoutThrows = true;
    child.destroyStderrThrows = true;
    child.unrefThrows = true;
    const deadline = new FakeDeadline();
    deadline.cancelThrows = true;
    const output = new FakeOutput();
    output.stopThrows = true;
    output.destroyThrows = true;
    const resultPromise = runTm2BoundedChild({
      child,
      deadline,
      deadlineMs: TM2_ADMISSION_CHILD_DEADLINE_MS,
      reapDeadlineMs: TM2_CHILD_REAP_DEADLINE_MS,
      output,
    });
    deadline.fire(TM2_ADMISSION_CHILD_DEADLINE_MS);
    deadline.fire(TM2_CHILD_REAP_DEADLINE_MS);
    await expect(resultPromise).resolves.toEqual({
      status: 'termination_failed',
      confirmedClosed: false,
      safeToDeleteTaskRoot: false,
    });
    expect(output.stops).toEqual([true]);
    expect(output.destroyCalls).toBe(1);
    expect(child.cleanupCalls).toEqual(
      expect.arrayContaining([
        'destroyStdin',
        'destroyStdout',
        'destroyStderr',
        'offError',
        'offClose',
        'unref',
      ]),
    );
    expect(child.listenerCount).toBe(0);
    expect(deadline.activeCount).toBe(0);
  });

  it('kills and observes close for a real short-lived Node helper child', async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 1000)'],
      {stdio: 'ignore', windowsHide: true},
    );
    const result = await runTm2BoundedChild({
      child: createTm2ChildProcessPort(child),
      deadline: SYSTEM_TM2_DEADLINE,
      deadlineMs: 50,
      reapDeadlineMs: 2_000,
      output: {
        stop(): void {
          return;
        },
        destroy(): void {
          return;
        },
      },
    });
    expect(result).toEqual({
      status: 'timed_out',
      confirmedClosed: true,
      safeToDeleteTaskRoot: true,
    });
    expect(child.killed).toBe(true);
  });
});

describe('Test-owned PostgreSQL TM2 mandatory report oracle', () => {
  it('accepts exactly 488 passed mandatory IDs and normalizes Windows and Unix suite paths', () => {
    for (const root of ['/synthetic/repository', 'C:\\synthetic\\repository']) {
      const report = createSyntheticMandatoryReport(root);
      expect(
        auditTm2MandatoryReportSource(JSON.stringify(report), root),
      ).toEqual({status: 'valid', mandatoryCount: 488});
    }
    expect(
      normalizeTm2ReportSuitePath(
        'C:\\synthetic\\repository\\tests\\postgres\\postgres_tm2_mandatory.tm2.ts',
        'C:\\synthetic\\repository',
      ),
    ).toBe(TM2_MANDATORY_SUITE_PATH);
    expect(
      normalizeTm2ReportSuitePath(
        '/synthetic/repository/tests/postgres/postgres_tm2_mandatory.tm2.ts',
        '/synthetic/repository',
      ),
    ).toBe(TM2_MANDATORY_SUITE_PATH);
  });

  it('rejects 487 rows, duplicate IDs, and unexpected IDs', () => {
    const missing = createSyntheticMandatoryReport();
    missing.testResults[0]?.assertionResults.pop();
    refreshSyntheticReportCounts(missing);

    const duplicate = createSyntheticMandatoryReport();
    const duplicateAssertion = duplicate.testResults[0]?.assertionResults[487];
    if (duplicateAssertion === undefined) {
      throw new Error('SYNTHETIC_REPORT_ASSERTION_MISSING');
    }
    duplicateAssertion.title = 'PG-TM2-001 synthetic-duplicate';
    duplicateAssertion.fullName =
      'Synthetic PostgreSQL TM2 suite PG-TM2-001 synthetic-duplicate';

    const unexpected = createSyntheticMandatoryReport();
    const unexpectedAssertion =
      unexpected.testResults[0]?.assertionResults[487];
    if (unexpectedAssertion === undefined) {
      throw new Error('SYNTHETIC_REPORT_ASSERTION_MISSING');
    }
    unexpectedAssertion.title = 'PG-TM2-489 synthetic-unexpected';
    unexpectedAssertion.fullName =
      'Synthetic PostgreSQL TM2 suite PG-TM2-489 synthetic-unexpected';

    for (const report of [missing, duplicate, unexpected]) {
      expect(
        auditTm2MandatoryReportSource(
          JSON.stringify(report),
          '/synthetic/repository',
        ),
      ).toEqual({status: 'invalid'});
    }
  });

  it('rejects a longer numeric suffix that masquerades as a mandatory ID', () => {
    const report = createSyntheticMandatoryReport();
    const assertion = report.testResults[0]?.assertionResults[0];
    if (assertion === undefined) {
      throw new Error('SYNTHETIC_REPORT_ASSERTION_MISSING');
    }
    assertion.title = 'PG-TM2-0010 synthetic-masquerade';
    assertion.fullName =
      'Synthetic PostgreSQL TM2 suite PG-TM2-0010 synthetic-masquerade';
    expect(
      auditTm2MandatoryReportSource(
        JSON.stringify(report),
        '/synthetic/repository',
      ),
    ).toEqual({status: 'invalid'});
  });

  it('rejects missing, duplicate, selftest-only, and path-masquerading mandatory suites', () => {
    const missing = createSyntheticMandatoryReport();
    missing.testResults = missing.testResults.slice(1);
    refreshSyntheticReportCounts(missing);

    const duplicate = createSyntheticMandatoryReport();
    const mandatorySuite = duplicate.testResults[0];
    if (mandatorySuite === undefined) {
      throw new Error('SYNTHETIC_REPORT_SUITE_MISSING');
    }
    duplicate.testResults.push(structuredClone(mandatorySuite));
    refreshSyntheticReportCounts(duplicate);

    const masquerading = createSyntheticMandatoryReport();
    const masqueradingSuite = masquerading.testResults[0];
    if (masqueradingSuite === undefined) {
      throw new Error('SYNTHETIC_REPORT_SUITE_MISSING');
    }
    masqueradingSuite.name =
      '/synthetic/repository/other/tests/postgres/postgres_tm2_mandatory.tm2.ts';

    for (const report of [missing, duplicate, masquerading]) {
      expect(
        auditTm2MandatoryReportSource(
          JSON.stringify(report),
          '/synthetic/repository',
        ),
      ).toEqual({status: 'invalid'});
    }
  });

  it('rejects every non-passed status and assertions with zero or two mandatory IDs', () => {
    for (const status of [
      'skipped',
      'pending',
      'todo',
      'disabled',
      'failed',
      'synthetic-unknown',
    ]) {
      const report = createSyntheticMandatoryReport();
      const assertion = report.testResults[0]?.assertionResults[0];
      if (assertion === undefined) {
        throw new Error('SYNTHETIC_REPORT_ASSERTION_MISSING');
      }
      assertion.status = status;
      refreshSyntheticReportCounts(report);
      expect(
        auditTm2MandatoryReportSource(
          JSON.stringify(report),
          '/synthetic/repository',
        ),
        status,
      ).toEqual({status: 'invalid'});
    }

    const zero = createSyntheticMandatoryReport();
    const zeroAssertion = zero.testResults[0]?.assertionResults[0];
    if (zeroAssertion === undefined) {
      throw new Error('SYNTHETIC_REPORT_ASSERTION_MISSING');
    }
    zeroAssertion.title = 'synthetic-no-id';
    zeroAssertion.fullName = 'Synthetic PostgreSQL TM2 suite synthetic-no-id';

    const two = createSyntheticMandatoryReport();
    const twoAssertion = two.testResults[0]?.assertionResults[0];
    if (twoAssertion === undefined) {
      throw new Error('SYNTHETIC_REPORT_ASSERTION_MISSING');
    }
    twoAssertion.title = 'PG-TM2-001 PG-TM2-002 synthetic-two-ids';
    twoAssertion.fullName =
      'Synthetic PostgreSQL TM2 suite PG-TM2-001 PG-TM2-002 synthetic-two-ids';

    for (const report of [zero, two]) {
      expect(
        auditTm2MandatoryReportSource(
          JSON.stringify(report),
          '/synthetic/repository',
        ),
      ).toEqual({status: 'invalid'});
    }
  });

  it('fails closed on malformed, missing, oversized, and schema-open reports', async () => {
    expect(auditTm2MandatoryReportSource('{', '/synthetic/repository')).toEqual(
      {status: 'invalid'},
    );

    const schemaOpen =
      createSyntheticMandatoryReport() as SyntheticJsonReport & {
        syntheticExtra?: boolean;
      };
    schemaOpen.syntheticExtra = true;
    expect(
      auditTm2MandatoryReportSource(
        JSON.stringify(schemaOpen),
        '/synthetic/repository',
      ),
    ).toEqual({status: 'invalid'});

    const missingRead = vi.fn<() => Promise<Uint8Array>>();
    const missingIo: Tm2MandatoryReportIo = {
      stat: () => Promise.reject(new Error('SYNTHETIC_MISSING_REPORT')),
      read: missingRead,
    };
    await expect(
      readAndAuditTm2MandatoryReport(
        'synthetic-report.json',
        '/synthetic/repository',
        missingIo,
      ),
    ).resolves.toEqual({status: 'invalid'});
    expect(missingRead).not.toHaveBeenCalled();

    const oversizedRead = vi.fn<() => Promise<Uint8Array>>();
    const oversizedIo: Tm2MandatoryReportIo = {
      stat: () =>
        Promise.resolve({
          size: TM2_MANDATORY_REPORT_MAX_BYTES + 1,
          isFile: () => true,
        }),
      read: oversizedRead,
    };
    await expect(
      readAndAuditTm2MandatoryReport(
        'synthetic-report.json',
        '/synthetic/repository',
        oversizedIo,
      ),
    ).resolves.toEqual({status: 'invalid'});
    expect(oversizedRead).not.toHaveBeenCalled();
  });

  it('never reads a report after timeout or nonzero child completion', async () => {
    const reader = vi.fn(() =>
      Promise.resolve({
        status: 'valid' as const,
        mandatoryCount: 488,
      }),
    );
    const timeout = await auditTm2MandatoryExecution(
      {
        status: 'timed_out',
        confirmedClosed: true,
        safeToDeleteTaskRoot: true,
      },
      reader,
    );
    expect(timeout).toEqual({
      status: 'child_not_completed',
      reportRead: false,
    });
    expect(reader).not.toHaveBeenCalled();

    const failed = await auditTm2MandatoryExecution(
      {
        status: 'completed',
        exitCode: 1,
        signal: null,
        confirmedClosed: true,
        safeToDeleteTaskRoot: true,
      },
      reader,
    );
    expect(failed).toEqual({status: 'child_failed', reportRead: false});
    expect(reader).not.toHaveBeenCalled();

    const valid = await auditTm2MandatoryExecution(
      {
        status: 'completed',
        exitCode: 0,
        signal: null,
        confirmedClosed: true,
        safeToDeleteTaskRoot: true,
      },
      reader,
    );
    expect(valid).toEqual({
      status: 'valid',
      mandatoryCount: 488,
      reportRead: true,
    });
    expect(reader).toHaveBeenCalledTimes(1);
  });
});

describe('Test-owned PostgreSQL TM2 frozen ledger and semantic maps', () => {
  it('registers 488 continuous unique mandatory IDs in 24 families', () => {
    expect(auditTm2MandatoryLedger()).toEqual({
      total: 488,
      unique: 488,
      missing: [],
      duplicate: [],
      unexpected: [],
      familyCount: 24,
    });
    expect(TM2_MANDATORY_LEDGER[0]?.id).toBe('PG-TM2-001');
    expect(TM2_MANDATORY_LEDGER.at(-1)?.id).toBe('PG-TM2-488');
    expect(TM2_FAMILIES[0]?.start).toBe(1);
    expect(TM2_FAMILIES.at(-1)?.end).toBe(488);
  });

  it('freezes all four migration identities without using a schema dump hash', () => {
    expect(TM2_MIGRATION_IDENTITIES).toHaveLength(4);
    expect(TM2_MIGRATION_IDENTITIES.map((row) => row.version)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(
      TM2_MIGRATION_IDENTITIES.every((row) =>
        /^[0-9a-f]{64}$/.test(row.sha256),
      ),
    ).toBe(true);
  });

  it('freezes the closed 35-table catalog and material cardinalities', () => {
    expect(TM2_BUSINESS_TABLES).toHaveLength(35);
    expect(new Set(TM2_BUSINESS_TABLES).size).toBe(35);
    expect(
      auditCatalogSummary({
        tableNames: TM2_BUSINESS_TABLES,
        primaryKeys: 35,
        uniqueConstraints: 49,
        foreignKeys: 77,
        checks: 128,
        explicitIndexes: 8,
      }),
    ).toEqual([]);
    expect(TM2_CATALOG_CARDINALITIES.deferredCurrentPointerForeignKeys).toBe(
      10,
    );
  });

  it('freezes the exact runtime pointer-update and grant cardinalities', () => {
    expect(TM2_RUNTIME_POINTER_UPDATES).toHaveLength(7);
    expect(
      TM2_RUNTIME_POINTER_UPDATES.flatMap((row) => row.columns),
    ).toHaveLength(13);
    expect(TM2_RUNTIME_GRANT_CARDINALITIES).toEqual({
      selectTables: 35,
      insertColumns: 181,
      updateColumns: 13,
      updateTables: 7,
    });
  });

  it('independently reproduces the workspace advisory-lock known answer', () => {
    expect(
      deriveWorkspaceLockKnownAnswer('11111111-1111-4111-8111-111111111111'),
    ).toEqual({
      digest:
        '5a8f5bbb1115b7a070f4dbacc772b36b22141bd0900a271b1b3de14c4aac54f2',
      firstEightBytes: '5a8f5bbb1115b7a0',
      signedKey: '6525535244086785952',
    });
  });
});

describe('Test-owned PostgreSQL TM2 concurrency and binding seams', () => {
  it('uses a participant barrier rather than a fixed sleep as the ordering oracle', async () => {
    const barrier = new Tm2Barrier(2);
    const reached: string[] = [];
    const first = barrier.arrive().then(() => {
      reached.push('first');
    });
    expect(barrier.arrivals).toBe(1);
    const second = barrier.arrive().then(() => {
      reached.push('second');
    });
    await withTm2Deadline(Promise.all([first, second]), 1_000);
    expect(reached.sort()).toEqual(['first', 'second']);
  });

  it('recognizes an observed PostgreSQL lock wait without wall-clock inference', () => {
    expect(
      isLockBlockedObservation({
        applicationName: 'struinfo-tm2-runtime',
        waitEventType: 'Lock',
        waitEvent: 'advisory',
        transactionId: 'synthetic-transaction',
      }),
    ).toBe(true);
    expect(
      isLockBlockedObservation({
        applicationName: 'unrelated',
        waitEventType: 'Client',
        waitEvent: 'ClientRead',
        transactionId: undefined,
      }),
    ).toBe(false);
  });

  it('binds public product exports and executes non-database quality rows', async () => {
    const facade = getPostgresTm2PublicFacade();
    expect(facade.bindingStatus).toBe('bound');
    const environment = admitSyntheticEnvironment();
    for (const row of TM2_MANDATORY_LEDGER.slice(0, 68)) {
      await expect(
        executeTm2MandatoryCase(facade, row, {
          admission: environment,
          poisonRoot: 'synthetic-poison-root',
        }),
        row.id,
      ).resolves.toMatchObject({
        caseId: row.id,
        vectorId: row.vectorId,
      });
    }
    vi.stubEnv(
      'STRUIINFO_TM2_MIGRATION_DATABASE_URL',
      'postgres://struinfo_tm2_migrator:b@127.0.0.1/struinfo_tm2',
    );
    vi.stubEnv(
      'STRUIINFO_TM2_RUNTIME_DATABASE_URL',
      'postgres://struinfo_tm2_runtime:c@127.0.0.1/struinfo_tm2',
    );
    for (const row of TM2_MANDATORY_LEDGER.slice(68, 98)) {
      await expect(
        executeTm2MandatoryCase(facade, row, {
          admission: environment,
          poisonRoot: 'synthetic-poison-root',
        }),
        row.id,
      ).resolves.toMatchObject({caseId: row.id, vectorId: row.vectorId});
    }
    for (const row of [
      ...TM2_MANDATORY_LEDGER.slice(460, 470),
      ...TM2_MANDATORY_LEDGER.slice(480, 487),
    ]) {
      await expect(
        executeTm2MandatoryCase(facade, row, {
          admission: environment,
          poisonRoot: 'synthetic-poison-root',
        }),
        row.id,
      ).resolves.toMatchObject({caseId: row.id, vectorId: row.vectorId});
    }
    vi.unstubAllEnvs();
    await facade.close();
  });
});

function admitSyntheticEnvironment() {
  const result = admitTm2Environment({
    STRUIINFO_TM2_ADMIN_DATABASE_URL:
      'postgres://struinfo_tm2_admin:a@127.0.0.1/struinfo_tm2',
    STRUIINFO_TM2_MIGRATION_DATABASE_URL:
      'postgres://struinfo_tm2_migrator:b@127.0.0.1/struinfo_tm2',
    STRUIINFO_TM2_RUNTIME_DATABASE_URL:
      'postgres://struinfo_tm2_runtime:c@127.0.0.1/struinfo_tm2',
  });
  if (result.status !== 'accepted') {
    throw new Error(`SYNTHETIC_ENVIRONMENT_REJECTED:${result.code}`);
  }
  return result;
}
