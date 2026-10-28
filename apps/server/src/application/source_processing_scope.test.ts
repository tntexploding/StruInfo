import {describe, expect, it} from 'vitest';
import {
  sourceProcessingInstructions,
  withSourceProcessing,
} from './source_processing_scope.js';

describe('frozen source processing guidance', () => {
  it('isolates concurrent document scopes and restores the parent context', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withSourceProcessing({tags: 'source A'}, async () => {
      await barrier;
      expect(sourceProcessingInstructions('tags')).toContain('source A');
      expect(sourceProcessingInstructions('relations')).toBe('');
      await withSourceProcessing(undefined, () => {
        expect(sourceProcessingInstructions('tags')).toBe('');
        return Promise.resolve();
      });
      expect(sourceProcessingInstructions('tags')).toContain('source A');
    });
    await withSourceProcessing({tags: 'source B'}, async () => {
      release();
      await first;
      expect(sourceProcessingInstructions('tags')).toContain('source B');
    });
    expect(sourceProcessingInstructions('tags')).toBe('');
  });
});
