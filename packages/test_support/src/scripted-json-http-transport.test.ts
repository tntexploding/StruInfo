/// <reference lib="dom" />

import {describe, expect, it, vi} from 'vitest';

import {
  ScriptedJsonHttpTransport,
  type JsonObject,
  type JsonValue,
} from './scripted-json-http-transport.js';
import {testSupportErrorCodes} from './test-support-error.js';

const readyResponse = {
  status: 200,
  headers: {'content-type': 'application/json'},
  body: {
    schema_version: '1',
    service: 'struinfo',
    role: 'api',
    status: 'ready',
    checks: {database: 'ready'},
  },
} as const;

describe('ScriptedJsonHttpTransport', () => {
  it('matches canonical JSON requests and returns independent response copies', async () => {
    const transport = new ScriptedJsonHttpTransport([
      {
        id: 'ready-check',
        request: {
          method: 'GET',
          url: 'http://struinfo.test/health/ready',
          headers: {Accept: 'application/json', 'X-Probe': 'synthetic'},
          body: {second: [2, 3], first: 1},
        },
        responses: [readyResponse, readyResponse],
      },
    ]);

    const first = await transport.send({
      method: 'get',
      url: 'http://struinfo.test/health/ready',
      headers: {'x-probe': 'synthetic', accept: 'application/json'},
      body: {first: 1, second: [2, 3]},
    });
    const firstBody = first.body as {checks: {database: string}};
    firstBody.checks.database = 'mutated';

    const second = await transport.send({
      method: 'GET',
      url: 'http://struinfo.test/health/ready',
      headers: {ACCEPT: 'application/json', 'X-PROBE': 'synthetic'},
      body: {second: [2, 3], first: 1},
    });

    expect(second).toEqual(readyResponse);
    expect(transport.consumption()).toEqual([
      {id: 'ready-check', consumed: 2, expected: 2},
    ]);
    expect(() => {
      transport.assertConsumed();
    }).not.toThrow();
  });

  it('preserves an own __proto__ JSON field without changing the clone prototype', async () => {
    const parsedBody: unknown = JSON.parse(
      '{"__proto__":{"polluted":"no"},"ordinary":"preserved"}',
    );
    const sourceBody = parsedBody as JsonValue;
    const sourceRecord = sourceBody as JsonObject;
    expect(Object.hasOwn(sourceRecord, '__proto__')).toBe(true);
    expect(Reflect.getPrototypeOf(sourceRecord)).toBe(Object.prototype);

    const request = {method: 'GET', url: 'http://struinfo.test/special-key'};
    const transport = new ScriptedJsonHttpTransport([
      {
        id: 'special-key',
        request,
        responses: [{status: 200, body: sourceBody}],
      },
    ]);

    const response = await transport.send(request);
    const clonedBody = response.body;
    if (
      clonedBody === undefined ||
      clonedBody === null ||
      typeof clonedBody !== 'object' ||
      Array.isArray(clonedBody)
    ) {
      throw new Error('Expected a cloned JSON object response body.');
    }

    const clonedRecord = clonedBody as JsonObject;
    expect(Object.hasOwn(clonedRecord, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(clonedRecord, '__proto__')).toEqual({
      configurable: true,
      enumerable: true,
      value: {polluted: 'no'},
      writable: true,
    });
    expect(Reflect.getPrototypeOf(clonedRecord)).toBe(Object.prototype);
    expect(clonedRecord.polluted).toBeUndefined();
    expect(JSON.stringify(clonedRecord)).toBe(
      '{"__proto__":{"polluted":"no"},"ordinary":"preserved"}',
    );
  });

  it('fails explicitly on an unexpected request', () => {
    const transport = new ScriptedJsonHttpTransport([]);

    expect(() =>
      transport.send({method: 'GET', url: 'http://struinfo.test/unexpected'}),
    ).toThrow(
      expect.objectContaining({
        code: testSupportErrorCodes.scriptedHttpUnexpectedRequest,
      }),
    );
  });

  it('rejects duplicate script matches during construction', () => {
    expect(
      () =>
        new ScriptedJsonHttpTransport([
          {
            id: 'first',
            request: {method: 'GET', url: 'http://struinfo.test/health/live'},
            responses: [readyResponse],
          },
          {
            id: 'second',
            request: {method: 'get', url: 'http://struinfo.test/health/live'},
            responses: [readyResponse],
          },
        ]),
    ).toThrow(
      expect.objectContaining({
        code: testSupportErrorCodes.scriptedHttpDuplicateMatch,
      }),
    );
  });

  it('forbids live-network fallback without invoking it', () => {
    const transport = new ScriptedJsonHttpTransport([]);
    const fallback = vi.fn(() => Promise.resolve(readyResponse));

    expect(() =>
      transport.send(
        {method: 'GET', url: 'https://live-network.invalid/health'},
        fallback,
      ),
    ).toThrow(
      expect.objectContaining({
        code: testSupportErrorCodes.scriptedHttpLiveNetworkFallbackForbidden,
      }),
    );
    expect(fallback).not.toHaveBeenCalled();
  });

  it('fails when a request is consumed more often than scripted', async () => {
    const request = {method: 'GET', url: 'http://struinfo.test/health/ready'};
    const transport = new ScriptedJsonHttpTransport([
      {id: 'one-shot', request, responses: [readyResponse]},
    ]);
    await transport.send(request);

    expect(() => transport.send(request)).toThrow(
      expect.objectContaining({
        code: testSupportErrorCodes.scriptedHttpConsumptionExceeded,
      }),
    );
  });

  it('fails when requests remain unconsumed or under-consumed', async () => {
    const request = {method: 'GET', url: 'http://struinfo.test/health/ready'};
    const transport = new ScriptedJsonHttpTransport([
      {
        id: 'twice',
        request,
        responses: [readyResponse, readyResponse],
      },
    ]);
    await transport.send(request);

    expect(() => {
      transport.assertConsumed();
    }).toThrow(
      expect.objectContaining({
        code: testSupportErrorCodes.scriptedHttpUnconsumedRequests,
        details: {
          outstanding: [{id: 'twice', consumed: 1, expected: 2}],
        },
      }),
    );
  });

  it.each([
    {
      name: 'empty exchange IDs',
      script: [
        {
          id: '',
          request: {method: 'GET', url: 'x'},
          responses: [readyResponse],
        },
      ],
    },
    {
      name: 'empty response sequences',
      script: [
        {id: 'empty', request: {method: 'GET', url: 'x'}, responses: []},
      ],
    },
    {
      name: 'out-of-range status',
      script: [
        {
          id: 'status',
          request: {method: 'GET', url: 'x'},
          responses: [{status: 600}],
        },
      ],
    },
  ])('rejects invalid scripts: $name', ({script}) => {
    expect(() => new ScriptedJsonHttpTransport(script)).toThrow(
      expect.objectContaining({
        code: testSupportErrorCodes.scriptedHttpInvalidScript,
      }),
    );
  });

  it('distinguishes an absent body from an explicit null body', () => {
    const transport = new ScriptedJsonHttpTransport([
      {
        id: 'null-body',
        request: {
          method: 'POST',
          url: 'http://struinfo.test/health',
          body: null,
        },
        responses: [readyResponse],
      },
    ]);

    expect(() =>
      transport.send({method: 'POST', url: 'http://struinfo.test/health'}),
    ).toThrow(
      expect.objectContaining({
        code: testSupportErrorCodes.scriptedHttpUnexpectedRequest,
      }),
    );
  });
});
