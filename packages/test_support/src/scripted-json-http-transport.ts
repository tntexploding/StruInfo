import {
  TestSupportError,
  testSupportErrorCodes,
  type TestSupportErrorCode,
} from './test-support-error.js';

export type JsonPrimitive = boolean | null | number | string;
export type JsonArray = readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;

export interface JsonHttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: JsonValue;
}

export interface JsonHttpResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: JsonValue;
}

export interface ScriptedJsonHttpExchange {
  readonly id: string;
  readonly request: JsonHttpRequest;
  readonly responses: readonly JsonHttpResponse[];
}

export type LiveNetworkFallback = (
  request: JsonHttpRequest,
) => Promise<JsonHttpResponse>;

export interface ScriptedJsonHttpConsumption {
  readonly id: string;
  readonly consumed: number;
  readonly expected: number;
}

interface ScriptState {
  readonly id: string;
  readonly requestFingerprint: string;
  readonly responses: readonly JsonHttpResponse[];
  consumed: number;
}

function invalidJson(
  code: TestSupportErrorCode,
  path: string,
  reason: string,
): never {
  throw new TestSupportError(
    code,
    `Invalid JSON value at ${path}: ${reason}.`,
    {
      path,
      reason,
    },
  );
}

function canonicalizeJson(
  value: unknown,
  code: TestSupportErrorCode,
  path: string,
  activeObjects = new WeakSet<object>(),
): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      invalidJson(code, path, 'number is not finite');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    return invalidJson(code, path, `unsupported ${typeof value}`);
  }
  if (activeObjects.has(value))
    return invalidJson(code, path, 'cycle detected');

  activeObjects.add(value);
  try {
    if (Array.isArray(value)) {
      const entries = value.map((entry, index) =>
        canonicalizeJson(
          entry,
          code,
          `${path}[${String(index)}]`,
          activeObjects,
        ),
      );
      return `[${entries.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidJson(code, path, 'object has an unsupported prototype');
    }

    const entries: string[] = [];
    const keys = Reflect.ownKeys(value).sort((left, right) =>
      String(left).localeCompare(String(right), 'en'),
    );
    for (const key of keys) {
      if (typeof key !== 'string') {
        return invalidJson(code, path, 'symbol key is not JSON');
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        return invalidJson(
          code,
          `${path}.${key}`,
          'member is not enumerable data',
        );
      }
      entries.push(
        `${JSON.stringify(key)}:${canonicalizeJson(
          descriptor.value,
          code,
          `${path}.${key}`,
          activeObjects,
        )}`,
      );
    }
    return `{${entries.join(',')}}`;
  } finally {
    activeObjects.delete(value);
  }
}

function normalizeHeaders(
  headers: Readonly<Record<string, string>> | undefined,
  code: TestSupportErrorCode,
  path: string,
): readonly (readonly [string, string])[] {
  if (headers === undefined) return [];

  const normalized = new Map<string, string>();
  for (const key of Reflect.ownKeys(headers)) {
    if (typeof key !== 'string') {
      throw new TestSupportError(
        code,
        `${path} contains a symbol header name.`,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(headers, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TestSupportError(
        code,
        `${path}.${key} must be a string data property.`,
      );
    }
    const normalizedName = key.toLowerCase();
    if (normalized.has(normalizedName)) {
      throw new TestSupportError(
        code,
        `${path} contains duplicate case-insensitive header names.`,
        {header: normalizedName},
      );
    }
    normalized.set(normalizedName, descriptor.value);
  }

  return [...normalized.entries()].sort(([left], [right]) =>
    left.localeCompare(right, 'en'),
  );
}

function requestFingerprint(
  request: JsonHttpRequest,
  code: TestSupportErrorCode,
  path: string,
): string {
  if (request.method.trim().length === 0 || request.url.trim().length === 0) {
    throw new TestSupportError(code, `${path} requires a method and URL.`);
  }

  const body = Object.hasOwn(request, 'body')
    ? canonicalizeJson(request.body, code, `${path}.body`)
    : '<absent>';
  return JSON.stringify({
    method: request.method.toUpperCase(),
    url: request.url,
    headers: normalizeHeaders(request.headers, code, `${path}.headers`),
    body,
  });
}

function cloneJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const arrayValue = value as JsonArray;
    return arrayValue.map((entry) => cloneJson(entry));
  }

  const objectValue = value as JsonObject;
  const clone: Record<string, JsonValue> = {};
  for (const key of Object.keys(objectValue)) {
    const entry = objectValue[key];
    if (entry === undefined)
      throw new Error('Validated JSON member is missing.');
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      value: cloneJson(entry),
      writable: true,
    });
  }
  return clone;
}

function cloneResponse(response: JsonHttpResponse): JsonHttpResponse {
  const clone: {
    status: number;
    headers?: Readonly<Record<string, string>>;
    body?: JsonValue;
  } = {status: response.status};

  if (response.headers !== undefined) clone.headers = {...response.headers};
  if (Object.hasOwn(response, 'body')) {
    if (response.body === undefined) {
      throw new TestSupportError(
        testSupportErrorCodes.scriptedHttpInvalidScript,
        'A scripted response body cannot be undefined.',
      );
    }
    clone.body = cloneJson(response.body);
  }
  return clone;
}

function validateResponse(
  response: JsonHttpResponse,
  exchangeId: string,
  responseIndex: number,
): JsonHttpResponse {
  if (
    !Number.isInteger(response.status) ||
    response.status < 100 ||
    response.status > 599
  ) {
    throw new TestSupportError(
      testSupportErrorCodes.scriptedHttpInvalidScript,
      'Scripted response status must be an integer from 100 through 599.',
      {exchangeId, responseIndex},
    );
  }

  normalizeHeaders(
    response.headers,
    testSupportErrorCodes.scriptedHttpInvalidScript,
    `script[${exchangeId}].responses[${String(responseIndex)}].headers`,
  );
  if (Object.hasOwn(response, 'body')) {
    canonicalizeJson(
      response.body,
      testSupportErrorCodes.scriptedHttpInvalidScript,
      `script[${exchangeId}].responses[${String(responseIndex)}].body`,
    );
  }
  return cloneResponse(response);
}

export class ScriptedJsonHttpTransport {
  readonly #states: ScriptState[];

  constructor(script: readonly ScriptedJsonHttpExchange[]) {
    const seenIds = new Set<string>();
    const fingerprints = new Map<string, string>();

    this.#states = script.map((exchange, exchangeIndex) => {
      if (exchange.id.trim().length === 0 || seenIds.has(exchange.id)) {
        throw new TestSupportError(
          testSupportErrorCodes.scriptedHttpInvalidScript,
          'Script exchange IDs must be non-empty and unique.',
          {exchangeId: exchange.id, exchangeIndex},
        );
      }
      if (exchange.responses.length === 0) {
        throw new TestSupportError(
          testSupportErrorCodes.scriptedHttpInvalidScript,
          'Every script exchange requires at least one response.',
          {exchangeId: exchange.id},
        );
      }
      seenIds.add(exchange.id);

      const fingerprint = requestFingerprint(
        exchange.request,
        testSupportErrorCodes.scriptedHttpInvalidScript,
        `script[${exchange.id}].request`,
      );
      const existingId = fingerprints.get(fingerprint);
      if (existingId !== undefined) {
        throw new TestSupportError(
          testSupportErrorCodes.scriptedHttpDuplicateMatch,
          'Two script exchanges match the same request.',
          {exchangeIds: [existingId, exchange.id]},
        );
      }
      fingerprints.set(fingerprint, exchange.id);

      return {
        id: exchange.id,
        requestFingerprint: fingerprint,
        responses: Object.freeze(
          exchange.responses.map((response, responseIndex) =>
            validateResponse(response, exchange.id, responseIndex),
          ),
        ),
        consumed: 0,
      };
    });
  }

  send(
    request: JsonHttpRequest,
    liveNetworkFallback?: LiveNetworkFallback,
  ): Promise<JsonHttpResponse> {
    const fingerprint = requestFingerprint(
      request,
      testSupportErrorCodes.scriptedHttpInvalidRequest,
      'request',
    );
    const matches = this.#states.filter(
      (state) => state.requestFingerprint === fingerprint,
    );

    if (matches.length > 1) {
      throw new TestSupportError(
        testSupportErrorCodes.scriptedHttpDuplicateMatch,
        'More than one script exchange matched a request.',
        {exchangeIds: matches.map((state) => state.id)},
      );
    }
    if (matches.length === 0) {
      if (liveNetworkFallback !== undefined) {
        throw new TestSupportError(
          testSupportErrorCodes.scriptedHttpLiveNetworkFallbackForbidden,
          'Scripted transport forbids live-network fallback.',
          {method: request.method.toUpperCase(), url: request.url},
        );
      }
      throw new TestSupportError(
        testSupportErrorCodes.scriptedHttpUnexpectedRequest,
        'No scripted exchange matched the request.',
        {method: request.method.toUpperCase(), url: request.url},
      );
    }

    const state = matches[0];
    if (state === undefined) {
      throw new Error('Script match invariant failed.');
    }
    const response = state.responses[state.consumed];
    if (response === undefined) {
      throw new TestSupportError(
        testSupportErrorCodes.scriptedHttpConsumptionExceeded,
        'A scripted request was consumed more times than declared.',
        {exchangeId: state.id, expected: state.responses.length},
      );
    }

    state.consumed += 1;
    return Promise.resolve(cloneResponse(response));
  }

  consumption(): readonly ScriptedJsonHttpConsumption[] {
    return this.#states.map((state) => ({
      id: state.id,
      consumed: state.consumed,
      expected: state.responses.length,
    }));
  }

  assertConsumed(): void {
    const outstanding = this.consumption().filter(
      (entry) => entry.consumed !== entry.expected,
    );
    if (outstanding.length !== 0) {
      throw new TestSupportError(
        testSupportErrorCodes.scriptedHttpUnconsumedRequests,
        'Scripted HTTP requests were not consumed the declared number of times.',
        {outstanding},
      );
    }
  }
}
