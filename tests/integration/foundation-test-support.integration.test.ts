import {readFile} from 'node:fs/promises';

import {describe, expect, it} from 'vitest';

import {
  FiniteSequenceIdSource,
  FixedClock,
  ScriptedJsonHttpTransport,
  healthLiveApiFixture,
  healthNotReadyApiFixture,
  healthReadyApiFixture,
} from '../../packages/test_support/src/index.js';

async function readFixture(name: string): Promise<unknown> {
  const fixtureUrl = new URL(`../fixtures/foundation/${name}`, import.meta.url);
  return JSON.parse(await readFile(fixtureUrl, 'utf8')) as unknown;
}

async function readContractExample(name: string): Promise<unknown> {
  const contractUrl = new URL(
    `../../packages/contracts/openapi/examples/${name}`,
    import.meta.url,
  );
  return JSON.parse(await readFile(contractUrl, 'utf8')) as unknown;
}

describe('deterministic foundation test support', () => {
  it('keeps tracked JSON fixtures byte-independent and contract-exact', async () => {
    const cases = [
      ['health-live-api.json', healthLiveApiFixture],
      ['health-ready-api.json', healthReadyApiFixture],
      ['health-not-ready-api.json', healthNotReadyApiFixture],
    ] as const;

    for (const [name, expected] of cases) {
      const fixture = await readFixture(name);
      expect(fixture).toStrictEqual(expected);
      expect(fixture).toStrictEqual(await readContractExample(name));
    }
  });

  it('replays a deterministic not-ready to ready sequence without live I/O', async () => {
    const clock = new FixedClock('2026-08-09T01:02:03.004Z');
    const ids = new FiniteSequenceIdSource([
      'health-attempt-001',
      'health-attempt-002',
    ]);
    const request = {
      method: 'GET',
      url: 'http://struinfo.test/health/ready',
      headers: {accept: 'application/json'},
    } as const;
    const transport = new ScriptedJsonHttpTransport([
      {
        id: 'readiness-transition',
        request,
        responses: [
          {status: 503, body: healthNotReadyApiFixture},
          {status: 200, body: healthReadyApiFixture},
        ],
      },
    ]);

    const observations = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      observations.push({
        id: ids.nextId(),
        observedAt: clock.nowIso(),
        response: await transport.send(request),
      });
    }

    expect(observations).toStrictEqual([
      {
        id: 'health-attempt-001',
        observedAt: '2026-08-09T01:02:03.004Z',
        response: {status: 503, body: healthNotReadyApiFixture},
      },
      {
        id: 'health-attempt-002',
        observedAt: '2026-08-09T01:02:03.004Z',
        response: {status: 200, body: healthReadyApiFixture},
      },
    ]);
    expect(() => {
      ids.assertFullyConsumed();
    }).not.toThrow();
    expect(() => {
      transport.assertConsumed();
    }).not.toThrow();
  });
});
