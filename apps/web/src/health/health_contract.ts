import {HealthContractError} from './health_client.js';

export const HEALTH_READINESS_PATH = 'health/ready';

const HEALTH_ROLES = ['api', 'scheduler', 'worker', 'all'] as const;
const RESPONSE_KEYS = [
  'schema_version',
  'service',
  'role',
  'status',
  'checks',
] as const;
const CHECK_KEYS = ['database'] as const;

export type HealthRole = (typeof HEALTH_ROLES)[number];

export interface ReadyHealthResponse {
  readonly schema_version: '1';
  readonly service: 'struinfo';
  readonly role: HealthRole;
  readonly status: 'ready';
  readonly checks: {readonly database: 'ready'};
}

export interface NotReadyHealthResponse {
  readonly schema_version: '1';
  readonly service: 'struinfo';
  readonly role: HealthRole;
  readonly status: 'not_ready';
  readonly checks: {readonly database: 'not_ready'};
}

export type HealthReadiness = ReadyHealthResponse | NotReadyHealthResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function isHealthRole(value: unknown): value is HealthRole {
  return (
    typeof value === 'string' &&
    HEALTH_ROLES.some((healthRole) => healthRole === value)
  );
}

export function parseHealthReadiness(value: unknown): HealthReadiness {
  if (!isRecord(value) || !hasExactKeys(value, RESPONSE_KEYS)) {
    throw new HealthContractError(
      'Operational health response has unexpected top-level fields.',
    );
  }

  const {checks, role, schema_version, service, status} = value;
  if (
    schema_version !== '1' ||
    service !== 'struinfo' ||
    !isHealthRole(role) ||
    !isRecord(checks) ||
    !hasExactKeys(checks, CHECK_KEYS)
  ) {
    throw new HealthContractError(
      'Operational health response does not match schema version 1.',
    );
  }

  if (status === 'ready' && checks.database === 'ready') {
    return {
      schema_version,
      service,
      role,
      status,
      checks: {database: checks.database},
    };
  }

  if (status === 'not_ready' && checks.database === 'not_ready') {
    return {
      schema_version,
      service,
      role,
      status,
      checks: {database: checks.database},
    };
  }

  throw new HealthContractError(
    'Readiness and database states do not form a supported contract pair.',
  );
}
