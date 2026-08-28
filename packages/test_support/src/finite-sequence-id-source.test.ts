/// <reference lib="dom" />

import {describe, expect, it} from 'vitest';

import {FiniteSequenceIdSource} from './finite-sequence-id-source.js';
import {testSupportErrorCodes} from './test-support-error.js';

describe('FiniteSequenceIdSource', () => {
  it('returns the supplied sequence and exposes deterministic consumption', () => {
    const sourceIds = ['foundation-001', 'foundation-002'];
    const source = new FiniteSequenceIdSource(sourceIds);
    sourceIds[0] = 'mutated-after-construction';

    expect(source.nextId()).toBe('foundation-001');
    expect(source.consumedCount).toBe(1);
    expect(source.remainingCount).toBe(1);
    expect(source.nextId()).toBe('foundation-002');
    expect(source.consumedCount).toBe(2);
    expect(source.remainingCount).toBe(0);
    expect(() => {
      source.assertFullyConsumed();
    }).not.toThrow();
  });

  it('fails explicitly when the finite sequence is exhausted', () => {
    const source = new FiniteSequenceIdSource(['foundation-001']);
    source.nextId();

    expect(() => source.nextId()).toThrow(
      expect.objectContaining({
        code: testSupportErrorCodes.finiteIdSourceExhausted,
        details: {consumedCount: 1},
      }),
    );
  });

  it('fails when declared IDs remain unconsumed', () => {
    const source = new FiniteSequenceIdSource([
      'foundation-001',
      'foundation-002',
    ]);
    source.nextId();

    expect(() => {
      source.assertFullyConsumed();
    }).toThrow(
      expect.objectContaining({
        code: testSupportErrorCodes.finiteIdSourceUnconsumed,
        details: {consumedCount: 1, remainingCount: 1},
      }),
    );
  });

  it.each([[''], [' foundation-001'], ['foundation-001 ']])(
    'rejects invalid ID %j',
    (id) => {
      expect(() => new FiniteSequenceIdSource([id])).toThrow(
        expect.objectContaining({
          code: testSupportErrorCodes.finiteIdSourceInvalidId,
        }),
      );
    },
  );

  it('rejects duplicate IDs', () => {
    expect(
      () => new FiniteSequenceIdSource(['foundation-001', 'foundation-001']),
    ).toThrow(
      expect.objectContaining({
        code: testSupportErrorCodes.finiteIdSourceDuplicate,
      }),
    );
  });
});
