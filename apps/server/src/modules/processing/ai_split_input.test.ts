import {expect, it} from 'vitest';
import {splitReadingPackets} from './ai_split_input.js';
import {
  orderedSectionFragments,
  providerSections,
} from './ai_split_proposal_service.js';
import {prepareAiSplitInformationEntries} from '../entries/information_entry.js';

it('groups chapters and tables without changing evidence order or treating packets as Entries', () => {
  const texts = [
    '# Study',
    'Introduction.',
    '## Measurements',
    'The explanation.',
    '| Year | Value |',
    '| 2040 | 3 |',
    '## Conclusion',
    'The conclusion.',
  ];
  const fragments = texts.map((selectedText, i) => ({
    fragmentId: String(i),
    structureId: 's',
    nodeKind: selectedText.startsWith('#') ? 'heading' : 'paragraph',
    codePointRange: {start: i * 50, end: i * 50 + selectedText.length},
    selectedText,
  }));
  const packets = splitReadingPackets(fragments);
  expect(packets.map((p) => p.map((f) => f.selectedText))).toEqual([
    texts.slice(0, 2),
    texts.slice(2, 6),
    texts.slice(6),
  ]);
  expect(packets.flat()).toEqual(fragments);
  expect(providerSections(fragments).map((s) => s.ordinal)).toEqual([0, 1, 2]);
});

it('retains legacy independent section boundaries', () => {
  const fragments = [0, 1, 2].map((i) => ({
    fragmentId: String(i),
    structureId: 's',
    nodeKind: 'section',
    codePointRange: {start: i * 50, end: i * 50 + 10},
    selectedText: '# Independent item',
  }));
  expect(splitReadingPackets(fragments)).toHaveLength(3);
});

it('can use exact whole evidence for fragmented charts without invalidating older block proposals', () => {
  const texts = Array.from(
    {length: 180},
    (_, i) => `| Synthetic row ${String(i)} | 7 |`,
  );
  const text = texts.join('\n\n');
  let cursor = 0;
  const blocks = texts.map((selectedText, i) => {
    const fragment = {
      fragmentId: `60000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      structureId: '44444444-4444-4444-8444-444444444444',
      nodeKind: 'paragraph',
      codePointRange: {start: cursor, end: cursor + selectedText.length},
      selectedText,
    };
    cursor += selectedText.length + 2;
    return fragment;
  });
  const first = blocks[0];
  if (!first) throw new Error('missing synthetic block');
  const whole = {
    ...first,
    fragmentId: '70000000-0000-4000-8000-000000000000',
    nodeKind: 'document',
    codePointRange: {start: 0, end: text.length},
    selectedText: text,
  };
  const snapshot = {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    resourceId: '22222222-2222-4222-8222-222222222222',
    snapshotId: '33333333-3333-4333-8333-333333333333',
    structures: [
      {
        structureId: whole.structureId,
        normalizedText: text,
        fragments: [whole, ...blocks],
      },
    ],
  };
  const picked = orderedSectionFragments(snapshot);
  expect(picked).toEqual([whole]);
  const rows = prepareAiSplitInformationEntries(snapshot, [
    {titlePath: 'Complete chart article', fragmentIds: [whole.fragmentId]},
  ]);
  expect(rows?.[0]?.value.body).toBe(text);
  expect(rows?.[0]?.value.chunkMode).toBe('whole');
  expect(
    prepareAiSplitInformationEntries(snapshot, [
      {
        titlePath: 'Previous exact blocks',
        fragmentIds: blocks.map((f) => f.fragmentId),
      },
    ])?.[0]?.value.body,
  ).toBe(text);
});
