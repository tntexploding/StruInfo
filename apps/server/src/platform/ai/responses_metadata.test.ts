import {describe, expect, it} from 'vitest';
import {responseMetadata} from './responses_metadata.js';

describe('model display metadata', () => {
  it('normalizes ordinary line breaks without changing source bodies', () => {
    expect(responseMetadata('  Short\r\nsummary\ttext  ', 80)).toBe(
      'Short summary text',
    );
    expect(responseMetadata('😀'.repeat(80), 80)).toBe('😀'.repeat(80));
  });
  it('still rejects malformed, empty, oversized or control-containing metadata', () => {
    for (const value of [null, 12, '', 'a'.repeat(81), 'hidden\u0000text']) {
      expect(responseMetadata(value, 80)).toBeUndefined();
    }
  });
});
