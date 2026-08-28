import {describe, expect, it} from 'vitest';

import {decodeCanonicalJson, encodeCanonicalJson} from './canonical_json.js';

const MAXIMUM_TEST_BYTES = 4096;

describe('canonical JSON', () => {
  it('sorts object keys and round-trips one deterministic UTF-8 encoding', () => {
    const encoded = encodeCanonicalJson(
      {zeta: '中文', alpha: {second: 2, first: 1}},
      MAXIMUM_TEST_BYTES,
    );

    expect(new TextDecoder().decode(encoded)).toBe(
      '{"alpha":{"first":1,"second":2},"zeta":"中文"}\n',
    );
    expect(decodeCanonicalJson(encoded, MAXIMUM_TEST_BYTES)).toEqual({
      alpha: {first: 1, second: 2},
      zeta: '中文',
    });
  });

  it('rejects duplicate members, reordered members, and extra whitespace', () => {
    const candidates = [
      '{"value":1,"value":2}\n',
      '{"zeta":1,"alpha":2}\n',
      '{"alpha":1 }\n',
    ];

    for (const candidate of candidates) {
      expect(() =>
        decodeCanonicalJson(
          new TextEncoder().encode(candidate),
          MAXIMUM_TEST_BYTES,
        ),
      ).toThrow(expect.objectContaining({code: 'non_canonical'}));
    }
  });

  it('rejects invalid UTF-8 and non-ordinary byte views', () => {
    const proxied = new Proxy(Uint8Array.from([123, 125, 10]), {});
    const shared = new Uint8Array(new SharedArrayBuffer(3));

    expect(() =>
      decodeCanonicalJson(Uint8Array.from([0xff]), MAXIMUM_TEST_BYTES),
    ).toThrow(expect.objectContaining({code: 'encoding_invalid'}));
    expect(() => decodeCanonicalJson(proxied, MAXIMUM_TEST_BYTES)).toThrow(
      expect.objectContaining({code: 'input_invalid'}),
    );
    expect(() => decodeCanonicalJson(shared, MAXIMUM_TEST_BYTES)).toThrow(
      expect.objectContaining({code: 'input_invalid'}),
    );
  });

  it('rejects accessors, proxies, sparse arrays, cycles, and non-finite numbers', () => {
    const accessorRecord = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => 1,
    });
    const sparse = new Array<unknown>(1);
    const cyclic: {self?: unknown} = {};
    cyclic.self = cyclic;
    const candidates: unknown[] = [
      accessorRecord,
      new Proxy({value: 1}, {}),
      sparse,
      cyclic,
      Number.NaN,
    ];

    for (const candidate of candidates) {
      expect(() => encodeCanonicalJson(candidate, MAXIMUM_TEST_BYTES)).toThrow(
        expect.objectContaining({code: 'input_invalid'}),
      );
    }
  });

  it('measures the complete encoded artifact at the inclusive boundary', () => {
    const encoded = encodeCanonicalJson({value: 'boundary'}, 4096);

    expect(() =>
      encodeCanonicalJson({value: 'boundary'}, encoded.byteLength),
    ).not.toThrow();
    expect(() =>
      encodeCanonicalJson({value: 'boundary'}, encoded.byteLength - 1),
    ).toThrow(expect.objectContaining({code: 'size_exceeded'}));
    expect(() => decodeCanonicalJson(encoded, encoded.byteLength - 1)).toThrow(
      expect.objectContaining({code: 'size_exceeded'}),
    );
  });
});
