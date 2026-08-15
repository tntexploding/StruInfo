import {
  admitTm2Environment,
  auditClosedPgConfig,
  decodeTm2Url,
  TM2_ROLE_IDENTITIES,
  TM2_URL_ENVIRONMENT_NAMES,
  type AcceptedTm2Environment,
  type Tm2AdmissionCode,
  type Tm2PgConfig,
  type Tm2Role,
} from './environment_oracle.js';

type Tm2EnvironmentVariable = (typeof TM2_URL_ENVIRONMENT_NAMES)[number];
type ProductRole = Exclude<Tm2Role, 'admin'>;

export type Tm2EnvironmentNotReadyCode =
  | Tm2AdmissionCode
  | 'tm2_endpoint_mismatch'
  | 'tm2_connection_unavailable'
  | 'tm2_session_identity'
  | 'tm2_database_identity'
  | 'tm2_server_endpoint'
  | 'tm2_server_version'
  | 'tm2_server_encoding'
  | 'tm2_server_settings'
  | 'tm2_role_prerequisite'
  | 'tm2_role_membership'
  | 'tm2_database_ownership'
  | 'tm2_runtime_ownership'
  | 'tm2_database_not_fresh'
  | 'tm2_environment_probe_unavailable';

export type Tm2AdmissionFailureCode =
  | 'tm2_product_accepted_prohibited_url'
  | 'tm2_product_rejected_admitted_url'
  | 'tm2_product_decoder_failure'
  | 'tm2_product_config_projection_mismatch'
  | 'tm2_admission_probe_failure'
  | 'tm2_admission_environment_not_isolated'
  | 'tm2_admission_poison_fixture_invalid'
  | 'tm2_admission_channel_invalid'
  | 'tm2_admission_child_failure'
  | 'tm2_admission_child_timeout'
  | 'tm2_admission_child_termination_failure'
  | 'tm2_mandatory_child_missing'
  | 'tm2_mandatory_child_failure'
  | 'tm2_mandatory_failure'
  | 'tm2_mandatory_child_timeout'
  | 'tm2_mandatory_child_termination_failure'
  | 'tm2_harness_failure';

export interface Tm2AdmittedOutcome {
  readonly status: 'admitted';
  readonly code: 'tm2_environment_admitted';
}

export interface Tm2NotReadyOutcome {
  readonly status: 'not_ready';
  readonly code: Tm2EnvironmentNotReadyCode;
  readonly variable?: Tm2EnvironmentVariable;
}

export interface Tm2AdmissionFailedOutcome {
  readonly status: 'failed';
  readonly code: Tm2AdmissionFailureCode;
}

export type Tm2AdmissionPreflightOutcome =
  Tm2AdmittedOutcome | Tm2NotReadyOutcome | Tm2AdmissionFailedOutcome;

export interface Tm2AdmissionSessionObservation {
  readonly role: Tm2Role;
  readonly sessionUser: string;
  readonly currentUser: string;
  readonly roleSetting: string;
  readonly databaseName: string;
  readonly serverAddress: string | null;
  readonly serverPort: number | null;
  readonly serverVersionNumber: number;
  readonly serverEncoding: string;
  readonly clientEncoding: string;
  readonly timeZone: string;
  readonly standardConformingStrings: string;
}

export interface Tm2AdmissionRoleObservation {
  readonly role: Tm2Role;
  readonly name: string;
  readonly canLogin: boolean;
  readonly superuser: boolean;
  readonly createRole: boolean;
  readonly createDatabase: boolean;
  readonly replication: boolean;
  readonly bypassRowLevelSecurity: boolean;
}

export interface Tm2AdmissionEnvironmentObservation {
  readonly sessions: Readonly<Record<Tm2Role, Tm2AdmissionSessionObservation>>;
  readonly roles: readonly Tm2AdmissionRoleObservation[];
  readonly directMembershipCount: number;
  readonly databaseOwner: string;
  readonly runtimeOwnedNonTemporarySchemaCount: number;
  readonly runtimeOwnedProjectObjectCount: number;
  readonly runtimeSetRoleCount: number;
  readonly projectSchemaCount: number;
}

export interface Tm2AdmissionConnectionConfigs {
  readonly admin: Readonly<Tm2PgConfig>;
  readonly migration: Readonly<Tm2PgConfig>;
  readonly runtime: Readonly<Tm2PgConfig>;
}

export interface Tm2AdmissionDependencies {
  decodeProductConfig(role: ProductRole, input: unknown): unknown;
  isProductConfigError(error: unknown): boolean;
  inspectEnvironment(
    admission: AcceptedTm2Environment,
    configs: Tm2AdmissionConnectionConfigs,
  ): Promise<Tm2AdmissionEnvironmentObservation>;
}

export class Tm2AdmissionProbeError extends Error {
  public readonly code:
    'tm2_connection_unavailable' | 'tm2_environment_probe_unavailable';
  public readonly variable: Tm2EnvironmentVariable | undefined;

  public constructor(
    code: 'tm2_connection_unavailable' | 'tm2_environment_probe_unavailable',
    variable?: Tm2EnvironmentVariable,
  ) {
    super(code);
    this.name = 'Tm2AdmissionProbeError';
    this.code = code;
    this.variable = variable;
  }
}

export interface Tm2ChildProcessObservation {
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export interface Tm2HarnessOutcome {
  readonly exitCode: 0 | 1 | 2;
  readonly event:
    'postgres_tm2_complete' | 'postgres_tm2_failed' | 'postgres_tm2_not_ready';
  readonly outcome: 'pass' | 'failed' | 'not_ready';
  readonly code?: Tm2EnvironmentNotReadyCode | Tm2AdmissionFailureCode;
  readonly variable?: Tm2EnvironmentVariable;
}

const ROLE_VARIABLES: Readonly<Record<Tm2Role, Tm2EnvironmentVariable>> =
  Object.freeze({
    admin: 'STRUIINFO_TM2_ADMIN_DATABASE_URL',
    migration: 'STRUIINFO_TM2_MIGRATION_DATABASE_URL',
    runtime: 'STRUIINFO_TM2_RUNTIME_DATABASE_URL',
  });

const NOT_READY_CODES = new Set<Tm2EnvironmentNotReadyCode>([
  'tm2_url_missing',
  'tm2_url_not_string',
  'tm2_url_whitespace',
  'tm2_url_raw_character',
  'tm2_url_scheme',
  'tm2_url_authority',
  'tm2_url_username',
  'tm2_url_password_missing',
  'tm2_url_password_empty',
  'tm2_url_password_decoded_empty',
  'tm2_url_percent_encoding',
  'tm2_url_unicode',
  'tm2_url_host',
  'tm2_url_port',
  'tm2_url_database',
  'tm2_url_override',
  'tm2_endpoint_mismatch',
  'tm2_connection_unavailable',
  'tm2_session_identity',
  'tm2_database_identity',
  'tm2_server_endpoint',
  'tm2_server_version',
  'tm2_server_encoding',
  'tm2_server_settings',
  'tm2_role_prerequisite',
  'tm2_role_membership',
  'tm2_database_ownership',
  'tm2_runtime_ownership',
  'tm2_database_not_fresh',
  'tm2_environment_probe_unavailable',
]);

const FAILURE_CODES = new Set<Tm2AdmissionFailureCode>([
  'tm2_product_accepted_prohibited_url',
  'tm2_product_rejected_admitted_url',
  'tm2_product_decoder_failure',
  'tm2_product_config_projection_mismatch',
  'tm2_admission_probe_failure',
  'tm2_admission_environment_not_isolated',
  'tm2_admission_poison_fixture_invalid',
  'tm2_admission_channel_invalid',
  'tm2_admission_child_failure',
  'tm2_admission_child_timeout',
  'tm2_admission_child_termination_failure',
  'tm2_mandatory_child_missing',
  'tm2_mandatory_child_failure',
  'tm2_mandatory_failure',
  'tm2_mandatory_child_timeout',
  'tm2_mandatory_child_termination_failure',
  'tm2_harness_failure',
]);

const CONFIG_KEYS = [
  'application_name',
  'database',
  'host',
  'options',
  'password',
  'port',
  'ssl',
  'user',
] as const;

function notReady(
  code: Tm2EnvironmentNotReadyCode,
  variable?: Tm2EnvironmentVariable,
): Tm2NotReadyOutcome {
  return Object.freeze({
    status: 'not_ready',
    code,
    ...(variable === undefined ? {} : {variable}),
  });
}

function failed(code: Tm2AdmissionFailureCode): Tm2AdmissionFailedOutcome {
  return Object.freeze({status: 'failed', code});
}

function admitted(): Tm2AdmittedOutcome {
  return Object.freeze({
    status: 'admitted',
    code: 'tm2_environment_admitted',
  });
}

function readsAsProductConfigError(
  dependencies: Tm2AdmissionDependencies,
  error: unknown,
): boolean {
  try {
    return dependencies.isProductConfigError(error);
  } catch {
    return false;
  }
}

function readClosedDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
): ReadonlyMap<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return undefined;
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== 'string') ||
    JSON.stringify([...keys].sort()) !==
      JSON.stringify([...expectedKeys].sort())
  ) {
    return undefined;
  }
  const fields = new Map<string, unknown>();
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      return undefined;
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function readDenseArray(value: unknown): readonly unknown[] | undefined {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return undefined;
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return undefined;
  }
  const result: unknown[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !('value' in descriptor)) {
      return undefined;
    }
    result.push(descriptor.value);
  }
  if (Reflect.ownKeys(value).length !== result.length + 1) {
    return undefined;
  }
  return result;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isSessionObservation(value: unknown, role: Tm2Role): boolean {
  const fields = readClosedDataRecord(value, [
    'role',
    'sessionUser',
    'currentUser',
    'roleSetting',
    'databaseName',
    'serverAddress',
    'serverPort',
    'serverVersionNumber',
    'serverEncoding',
    'clientEncoding',
    'timeZone',
    'standardConformingStrings',
  ]);
  if (fields === undefined) {
    return false;
  }
  const serverAddress = fields.get('serverAddress');
  const serverPort = fields.get('serverPort');
  return (
    fields.get('role') === role &&
    typeof fields.get('sessionUser') === 'string' &&
    typeof fields.get('currentUser') === 'string' &&
    typeof fields.get('roleSetting') === 'string' &&
    typeof fields.get('databaseName') === 'string' &&
    (serverAddress === null || typeof serverAddress === 'string') &&
    (serverPort === null || isFiniteInteger(serverPort)) &&
    isFiniteInteger(fields.get('serverVersionNumber')) &&
    typeof fields.get('serverEncoding') === 'string' &&
    typeof fields.get('clientEncoding') === 'string' &&
    typeof fields.get('timeZone') === 'string' &&
    typeof fields.get('standardConformingStrings') === 'string'
  );
}

function isRoleObservation(value: unknown): boolean {
  const fields = readClosedDataRecord(value, [
    'role',
    'name',
    'canLogin',
    'superuser',
    'createRole',
    'createDatabase',
    'replication',
    'bypassRowLevelSecurity',
  ]);
  if (fields === undefined) {
    return false;
  }
  return (
    (fields.get('role') === 'admin' ||
      fields.get('role') === 'migration' ||
      fields.get('role') === 'runtime') &&
    typeof fields.get('name') === 'string' &&
    [
      'canLogin',
      'superuser',
      'createRole',
      'createDatabase',
      'replication',
      'bypassRowLevelSecurity',
    ].every((key) => typeof fields.get(key) === 'boolean')
  );
}

function isClosedEnvironmentObservation(
  value: unknown,
): value is Tm2AdmissionEnvironmentObservation {
  const fields = readClosedDataRecord(value, [
    'sessions',
    'roles',
    'directMembershipCount',
    'databaseOwner',
    'runtimeOwnedNonTemporarySchemaCount',
    'runtimeOwnedProjectObjectCount',
    'runtimeSetRoleCount',
    'projectSchemaCount',
  ]);
  if (fields === undefined) {
    return false;
  }
  const sessions = readClosedDataRecord(fields.get('sessions'), [
    'admin',
    'migration',
    'runtime',
  ]);
  const roles = readDenseArray(fields.get('roles'));
  if (sessions === undefined || roles === undefined) {
    return false;
  }
  if (
    roles.length !== 3 ||
    !isSessionObservation(sessions.get('admin'), 'admin') ||
    !isSessionObservation(sessions.get('migration'), 'migration') ||
    !isSessionObservation(sessions.get('runtime'), 'runtime') ||
    !roles.every(isRoleObservation) ||
    typeof fields.get('databaseOwner') !== 'string'
  ) {
    return false;
  }
  return [
    'directMembershipCount',
    'runtimeOwnedNonTemporarySchemaCount',
    'runtimeOwnedProjectObjectCount',
    'runtimeSetRoleCount',
    'projectSchemaCount',
  ].every((key) => {
    const count = fields.get(key);
    return isFiniteInteger(count) && count >= 0;
  });
}

function isExactProductConfig(
  expected: Readonly<Tm2PgConfig>,
  observed: unknown,
): observed is Tm2PgConfig {
  if (
    auditClosedPgConfig(observed).length !== 0 ||
    typeof observed !== 'object' ||
    observed === null ||
    !Object.isFrozen(observed)
  ) {
    return false;
  }
  for (const key of CONFIG_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(observed, key);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      descriptor.enumerable !== true ||
      descriptor.configurable !== false ||
      descriptor.writable !== false ||
      !Object.is(descriptor.value, expected[key])
    ) {
      return false;
    }
  }
  return true;
}

function classifyEnvironmentObservation(
  admission: AcceptedTm2Environment,
  observation: Tm2AdmissionEnvironmentObservation,
): Tm2AdmissionPreflightOutcome {
  const roles = ['admin', 'migration', 'runtime'] as const;
  for (const role of roles) {
    const session = observation.sessions[role];
    if (
      session.role !== role ||
      session.sessionUser !== TM2_ROLE_IDENTITIES[role] ||
      session.currentUser !== TM2_ROLE_IDENTITIES[role] ||
      session.roleSetting !== 'none'
    ) {
      return notReady('tm2_session_identity', ROLE_VARIABLES[role]);
    }
    if (session.databaseName !== admission[role].config.database) {
      return notReady('tm2_database_identity', ROLE_VARIABLES[role]);
    }
    if (
      session.serverVersionNumber < 180_000 ||
      session.serverVersionNumber >= 190_000
    ) {
      return notReady('tm2_server_version', ROLE_VARIABLES[role]);
    }
    if (
      session.serverEncoding !== 'UTF8' ||
      session.clientEncoding !== 'UTF8'
    ) {
      return notReady('tm2_server_encoding', ROLE_VARIABLES[role]);
    }
    if (session.standardConformingStrings !== 'on') {
      return notReady('tm2_server_settings', ROLE_VARIABLES[role]);
    }
  }

  const adminServerAddress = observation.sessions.admin.serverAddress;
  const adminServerPort = observation.sessions.admin.serverPort;
  if (
    adminServerAddress === null ||
    adminServerPort === null ||
    roles.some(
      (role) =>
        observation.sessions[role].serverAddress !== adminServerAddress ||
        observation.sessions[role].serverPort !== adminServerPort,
    )
  ) {
    return notReady('tm2_server_endpoint');
  }
  if (
    observation.sessions.admin.timeZone !==
      observation.sessions.migration.timeZone ||
    observation.sessions.migration.timeZone !==
      observation.sessions.runtime.timeZone
  ) {
    return notReady('tm2_server_settings');
  }

  const roleByName = new Map(
    observation.roles.map((role) => [role.name, role] as const),
  );
  if (roleByName.size !== 3) {
    return notReady('tm2_role_prerequisite');
  }
  for (const role of roles) {
    const observed = roleByName.get(TM2_ROLE_IDENTITIES[role]);
    if (observed?.role !== role || !observed.canLogin) {
      return notReady('tm2_role_prerequisite', ROLE_VARIABLES[role]);
    }
    if (role === 'admin') {
      if (!observed.superuser) {
        return notReady('tm2_role_prerequisite', ROLE_VARIABLES.admin);
      }
    } else if (
      observed.superuser ||
      observed.createRole ||
      observed.createDatabase ||
      observed.replication ||
      observed.bypassRowLevelSecurity
    ) {
      return notReady('tm2_role_prerequisite', ROLE_VARIABLES[role]);
    }
  }

  if (observation.directMembershipCount !== 0) {
    return notReady('tm2_role_membership');
  }
  if (
    observation.databaseOwner === TM2_ROLE_IDENTITIES.migration ||
    observation.databaseOwner === TM2_ROLE_IDENTITIES.runtime
  ) {
    return notReady('tm2_database_ownership');
  }
  if (
    observation.runtimeOwnedNonTemporarySchemaCount !== 0 ||
    observation.runtimeOwnedProjectObjectCount !== 0 ||
    observation.runtimeSetRoleCount !== 0
  ) {
    return notReady('tm2_runtime_ownership');
  }
  if (observation.projectSchemaCount !== 0) {
    return notReady('tm2_database_not_fresh');
  }
  return admitted();
}

export async function runTm2AdmissionPreflight(
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: Tm2AdmissionDependencies,
): Promise<Tm2AdmissionPreflightOutcome> {
  const productConfigs = new Map<ProductRole, Tm2PgConfig>();
  const entries = [
    ['STRUIINFO_TM2_ADMIN_DATABASE_URL', 'admin'],
    ['STRUIINFO_TM2_MIGRATION_DATABASE_URL', 'migration'],
    ['STRUIINFO_TM2_RUNTIME_DATABASE_URL', 'runtime'],
  ] as const;

  for (const [variable, role] of entries) {
    const input = environment[variable];
    const expected = decodeTm2Url(role, input);
    if (expected.status === 'not_ready') {
      if (role !== 'admin') {
        try {
          dependencies.decodeProductConfig(role, input);
          return failed('tm2_product_accepted_prohibited_url');
        } catch (error) {
          if (!readsAsProductConfigError(dependencies, error)) {
            return failed('tm2_product_decoder_failure');
          }
        }
      }
      return notReady(expected.code, variable);
    }
    if (role !== 'admin') {
      let observed: unknown;
      try {
        observed = dependencies.decodeProductConfig(role, input);
      } catch (error) {
        return failed(
          readsAsProductConfigError(dependencies, error)
            ? 'tm2_product_rejected_admitted_url'
            : 'tm2_product_decoder_failure',
        );
      }
      if (!isExactProductConfig(expected.config, observed)) {
        return failed('tm2_product_config_projection_mismatch');
      }
      productConfigs.set(role, observed);
    }
  }

  const admission = admitTm2Environment(environment);
  if (admission.status === 'not_ready') {
    return notReady(admission.code, admission.variable);
  }
  const migration = productConfigs.get('migration');
  const runtime = productConfigs.get('runtime');
  if (migration === undefined || runtime === undefined) {
    return failed('tm2_product_config_projection_mismatch');
  }

  let observation: Tm2AdmissionEnvironmentObservation;
  try {
    observation = await dependencies.inspectEnvironment(admission, {
      admin: admission.admin.config,
      migration,
      runtime,
    });
  } catch (error) {
    if (error instanceof Tm2AdmissionProbeError) {
      return notReady(error.code, error.variable);
    }
    return failed('tm2_admission_probe_failure');
  }
  try {
    if (!isClosedEnvironmentObservation(observation)) {
      return failed('tm2_admission_probe_failure');
    }
    return classifyEnvironmentObservation(admission, observation);
  } catch {
    return failed('tm2_admission_probe_failure');
  }
}

export function classifyTm2HarnessOutcome(
  admission: Tm2AdmissionPreflightOutcome,
  child?: Tm2ChildProcessObservation,
): Tm2HarnessOutcome {
  if (admission.status === 'not_ready') {
    return Object.freeze({
      exitCode: 2,
      event: 'postgres_tm2_not_ready',
      outcome: 'not_ready',
      code: admission.code,
      ...(admission.variable === undefined
        ? {}
        : {variable: admission.variable}),
    });
  }
  if (admission.status === 'failed') {
    return Object.freeze({
      exitCode: 1,
      event: 'postgres_tm2_failed',
      outcome: 'failed',
      code: admission.code,
    });
  }
  if (child === undefined) {
    return Object.freeze({
      exitCode: 1,
      event: 'postgres_tm2_failed',
      outcome: 'failed',
      code: 'tm2_mandatory_child_missing',
    });
  }
  if (child.exitCode === 0 && child.signal === null) {
    return Object.freeze({
      exitCode: 0,
      event: 'postgres_tm2_complete',
      outcome: 'pass',
    });
  }
  return Object.freeze({
    exitCode: 1,
    event: 'postgres_tm2_failed',
    outcome: 'failed',
    code: 'tm2_mandatory_failure',
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expected].sort())
  );
}

export function decodeTm2AdmissionChannel(
  source: string,
): Tm2AdmissionPreflightOutcome | undefined {
  const trimmed = source.trim();
  if (trimmed === '' || trimmed.includes('\n')) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(value) || typeof value.status !== 'string') {
    return undefined;
  }
  if (
    value.status === 'admitted' &&
    hasExactKeys(value, ['status', 'code']) &&
    value.code === 'tm2_environment_admitted'
  ) {
    return admitted();
  }
  if (
    value.status === 'failed' &&
    hasExactKeys(value, ['status', 'code']) &&
    typeof value.code === 'string' &&
    FAILURE_CODES.has(value.code as Tm2AdmissionFailureCode)
  ) {
    return failed(value.code as Tm2AdmissionFailureCode);
  }
  if (
    value.status === 'not_ready' &&
    typeof value.code === 'string' &&
    NOT_READY_CODES.has(value.code as Tm2EnvironmentNotReadyCode)
  ) {
    const variable = value.variable;
    if (variable === undefined && hasExactKeys(value, ['status', 'code'])) {
      return notReady(value.code as Tm2EnvironmentNotReadyCode);
    }
    if (
      typeof variable === 'string' &&
      TM2_URL_ENVIRONMENT_NAMES.includes(variable as Tm2EnvironmentVariable) &&
      hasExactKeys(value, ['status', 'code', 'variable'])
    ) {
      return notReady(
        value.code as Tm2EnvironmentNotReadyCode,
        variable as Tm2EnvironmentVariable,
      );
    }
  }
  return undefined;
}
