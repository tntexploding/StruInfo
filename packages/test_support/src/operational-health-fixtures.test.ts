/// <reference lib="dom" />

import {describe, expect, it} from 'vitest';

import {
  createHealthLiveFixture,
  createHealthNotReadyFixture,
  createHealthReadyFixture,
  healthLiveApiFixture,
  healthNotReadyApiFixture,
  healthReadyApiFixture,
  operationalHealthRoles,
} from './operational-health-fixtures.js';

describe('operational health fixtures', () => {
  it('matches the exact frozen API examples', () => {
    expect(healthLiveApiFixture).toStrictEqual({
      schema_version: '1',
      service: 'struinfo',
      role: 'api',
      status: 'ok',
    });
    expect(healthReadyApiFixture).toStrictEqual({
      schema_version: '1',
      service: 'struinfo',
      role: 'api',
      status: 'ready',
      checks: {database: 'ready'},
    });
    expect(healthNotReadyApiFixture).toStrictEqual({
      schema_version: '1',
      service: 'struinfo',
      role: 'api',
      status: 'not_ready',
      checks: {database: 'not_ready'},
    });
  });

  it.each(operationalHealthRoles)(
    'builds the exact role-specific fixtures for %s',
    (role) => {
      expect(createHealthLiveFixture(role)).toStrictEqual({
        schema_version: '1',
        service: 'struinfo',
        role,
        status: 'ok',
      });
      expect(createHealthReadyFixture(role)).toStrictEqual({
        schema_version: '1',
        service: 'struinfo',
        role,
        status: 'ready',
        checks: {database: 'ready'},
      });
      expect(createHealthNotReadyFixture(role)).toStrictEqual({
        schema_version: '1',
        service: 'struinfo',
        role,
        status: 'not_ready',
        checks: {database: 'not_ready'},
      });
    },
  );
});
