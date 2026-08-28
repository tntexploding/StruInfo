import {describe, expect, it} from 'vitest';

import {formatBasisPointPercentage} from './information_entry_score.js';

describe('Information Entry score presentation', () => {
  it('renders basis-point scores as ordinary percentages', () => {
    expect(formatBasisPointPercentage(0)).toBe('0%');
    expect(formatBasisPointPercentage(2545)).toBe('25.4%');
    expect(formatBasisPointPercentage(10_000)).toBe('100%');
  });
});
