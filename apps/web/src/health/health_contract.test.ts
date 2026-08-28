import {describe, expect, it} from 'vitest';

import {HealthContractError} from './health_client.js';
import {parseHealthReadiness} from './health_contract.js';
import {
  NOT_READY_HEALTH_FIXTURE,
  READY_HEALTH_FIXTURE,
} from './mock_health_client.js';

describe('parseHealthReadiness', () => {
  it('maps the exact ready and not-ready contract examples', () => {
    expect(parseHealthReadiness(READY_HEALTH_FIXTURE)).toEqual(
      READY_HEALTH_FIXTURE,
    );
    expect(parseHealthReadiness(NOT_READY_HEALTH_FIXTURE)).toEqual(
      NOT_READY_HEALTH_FIXTURE,
    );
  });

  it('does not interpret liveness as readiness', () => {
    expect(() =>
      parseHealthReadiness({
        schema_version: '1',
        service: 'struinfo',
        role: 'api',
        status: 'ok',
      }),
    ).toThrow(HealthContractError);
  });

  it('rejects mismatched readiness and database states', () => {
    expect(() =>
      parseHealthReadiness({
        ...READY_HEALTH_FIXTURE,
        checks: {database: 'not_ready'},
      }),
    ).toThrow(HealthContractError);
  });

  it('rejects invented business-state fields', () => {
    expect(() =>
      parseHealthReadiness({
        ...READY_HEALTH_FIXTURE,
        knowledge_status: 'ready',
      }),
    ).toThrow(HealthContractError);
  });
});
