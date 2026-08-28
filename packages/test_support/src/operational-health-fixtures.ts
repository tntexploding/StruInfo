import type {JsonValue} from './scripted-json-http-transport.js';

export const operationalHealthRoles = [
  'api',
  'scheduler',
  'worker',
  'all',
] as const;

export type OperationalHealthRole = (typeof operationalHealthRoles)[number];

export const healthLiveApiFixture = {
  schema_version: '1',
  service: 'struinfo',
  role: 'api',
  status: 'ok',
} as const satisfies JsonValue;

export const healthReadyApiFixture = {
  schema_version: '1',
  service: 'struinfo',
  role: 'api',
  status: 'ready',
  checks: {database: 'ready'},
} as const satisfies JsonValue;

export const healthNotReadyApiFixture = {
  schema_version: '1',
  service: 'struinfo',
  role: 'api',
  status: 'not_ready',
  checks: {database: 'not_ready'},
} as const satisfies JsonValue;

export function createHealthLiveFixture(role: OperationalHealthRole) {
  return {
    schema_version: '1',
    service: 'struinfo',
    role,
    status: 'ok',
  } as const;
}

export function createHealthReadyFixture(role: OperationalHealthRole) {
  return {
    schema_version: '1',
    service: 'struinfo',
    role,
    status: 'ready',
    checks: {database: 'ready'},
  } as const;
}

export function createHealthNotReadyFixture(role: OperationalHealthRole) {
  return {
    schema_version: '1',
    service: 'struinfo',
    role,
    status: 'not_ready',
    checks: {database: 'not_ready'},
  } as const;
}
