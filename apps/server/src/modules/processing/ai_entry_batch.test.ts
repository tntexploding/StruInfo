import {expect, it} from 'vitest';
import type {CurrentInformationEntry} from '../entries/index.js';
import {
  entryBatchCallEstimate,
  recallBatchEntrySize,
  MAXIMUM_RECALL_BATCH_CHARACTERS,
} from './ai_entry_batch.js';

it('reserves future tag metadata before accepting a collection at the batch size boundary', () => {
  const bare = {
    value: {
      titlePath: 'Synthetic',
      body: 'x'.repeat(13_500),
      contentKeywords: [],
    },
  } as unknown as CurrentInformationEntry;
  const tagged = {
    ...bare,
    value: {
      ...bare.value,
      contentKeywords: Array.from({length: 12}, () => ({
        displayValue: '"'.repeat(80),
        normalizedValue: '"'.repeat(80),
        origin: 'ai' as const,
        originVersion: 'synthetic',
      })),
    },
  };
  expect(recallBatchEntrySize(bare)).toBe(recallBatchEntrySize(tagged));
  for (const entry of [bare, tagged]) {
    expect(
      entryBatchCallEstimate(
        Array.from({length: 8}, () => entry),
        recallBatchEntrySize,
        MAXIMUM_RECALL_BATCH_CHARACTERS,
      ),
    ).toBe(2);
  }
});
