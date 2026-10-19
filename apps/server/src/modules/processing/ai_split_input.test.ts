import {expect, it} from 'vitest';
import {splitReadingPackets, splitInputPackets} from './ai_split_input.js';
import {assertProcessingSplitProposalPayload} from './processing.js';
import {
  orderedSectionFragments,
  providerSections,
} from './ai_split_proposal_service.js';
import {prepareAiSplitInformationEntries} from '../entries/information_entry.js';

it('keeps quote and list markers through exact source ranges, including non-BMP text', () => {
  const text =
    '# Digest\n\n1、First independent item\n\n> Quoted 🔬 evidence.\n\n2、Second independent item\n\n- Complete source detail.\n';
  const structureId = '44444444-4444-4444-8444-444444444444';
  const whole = {
    fragmentId: '55555555-5555-4555-8555-555555555555',
    structureId,
    nodeKind: 'document',
    selectedText: text,
    codePointRange: {start: 0, end: Array.from(text).length},
  };
  const leaves = [
    '# Digest',
    '1、First independent item',
    'Quoted 🔬 evidence.',
    '2、Second independent item',
    'Complete source detail.',
  ].map((selectedText, i) => ({
    fragmentId: '60000000-0000-4000-8000-' + String(i).padStart(12, '0'),
    structureId,
    nodeKind: i === 0 ? 'heading' : 'paragraph',
    selectedText,
    codePointRange: {
      start: Array.from(text.slice(0, text.indexOf(selectedText))).length,
      end: Array.from(
        text.slice(0, text.indexOf(selectedText) + selectedText.length),
      ).length,
    },
  }));
  const snapshot = {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    resourceId: '22222222-2222-4222-8222-222222222222',
    snapshotId: '33333333-3333-4333-3333-333333333333',
    structures: [
      {structureId, normalizedText: text, fragments: [whole, ...leaves]},
    ],
  };
  const picked = orderedSectionFragments(snapshot);
  expect(picked).toEqual([whole]);
  const packets = splitInputPackets(picked, snapshot);
  expect(packets).toHaveLength(5);
  expect(packets.flatMap((p) => p.map((f) => f.selectedText)).join('')).toBe(
    text,
  );
  const cut = packets[3]?.[0]?.codePointRange.start ?? -1;
  const groups = [
    {
      titlePath: 'First item with preface',
      fragmentIds: [whole.fragmentId],
      fragmentRanges: [{startCodePoint: 0, endCodePoint: cut}],
    },
    {
      titlePath: 'Second item',
      fragmentIds: [whole.fragmentId],
      fragmentRanges: [
        {startCodePoint: cut, endCodePoint: Array.from(text).length},
      ],
    },
  ];
  const rows = prepareAiSplitInformationEntries(snapshot, groups);
  expect(rows).toHaveLength(2);
  expect(rows?.map((r) => r.value.body).join('')).toBe(text);
  const payload = {
    providerModel: 'synthetic',
    promptVersion: 'synthetic',
    splitRuleVersion: 'struinfo.entry-split.ai-group.v1' as const,
    entries: groups,
  };
  expect(() => {
    assertProcessingSplitProposalPayload(payload);
  }).not.toThrow();
  const broken = groups.map((g, i) => ({
    ...g,
    fragmentRanges: [
      {
        startCodePoint: i ? cut + 1 : 0,
        endCodePoint: i ? Array.from(text).length : cut,
      },
    ],
  }));
  expect(() => {
    assertProcessingSplitProposalPayload({...payload, entries: broken});
  }).toThrow();
  expect(prepareAiSplitInformationEntries(snapshot, broken)).toBeUndefined();
});

it('exposes paragraph choices within chapters while keeping tables together', () => {
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
    [texts[0]],
    [texts[1]],
    [texts[2]],
    [texts[3]],
    texts.slice(4, 6),
    [texts[6]],
    [texts[7]],
  ]);
  expect(packets.flat()).toEqual(fragments);
  expect(providerSections(fragments).map((s) => s.ordinal)).toEqual([
    0, 1, 2, 3, 4, 5, 6,
  ]);
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
  expect(providerSections(picked)).toHaveLength(1);
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

// A long digest must keep independent numbered starts available to the model.
it('retains item boundaries beyond 128 evidence blocks without enlarging the model packet limit', () => {
  const texts = ['# Synthetic digest', '## Tools'];
  for (let item = 1; item <= 30; item++)
    texts.push(
      String(item) + '、Synthetic tool',
      'Purpose.',
      'Implementation.',
      'Evidence.',
      'Limitations.',
    );
  let offset = 0;
  const fragments = texts.map((selectedText, i) => {
    const f = {
      fragmentId: String(i),
      structureId: 's',
      nodeKind: selectedText.startsWith('#') ? 'heading' : 'paragraph',
      codePointRange: {start: offset, end: offset + selectedText.length},
      selectedText,
    };
    offset += selectedText.length + 2;
    return f;
  });
  const packets = splitReadingPackets(fragments);
  expect(fragments.length).toBeGreaterThan(128);
  expect(packets).toHaveLength(32);
  expect(packets.slice(2).every((p) => p.length === 5)).toBe(true);
  expect(packets.flat()).toEqual(fragments);
});

it('keeps unnumbered linked company starts available in a large monthly collection', () => {
  const texts = ['# Synthetic monthly roundup', '## Instruments'];
  for (let item = 1; item <= 30; item++)
    texts.push(
      `[Synthetic company ${String(item)}](https://example.invalid/${String(item)})`,
      'A complete independent transaction.',
      'Its amount.',
      'Its terms.',
      'Its context.',
    );
  const fragments = texts.map((selectedText, i) => ({
    fragmentId: String(i),
    structureId: 's',
    nodeKind: selectedText.startsWith('#') ? 'heading' : 'paragraph',
    codePointRange: {start: i * 100, end: i * 100 + selectedText.length},
    selectedText,
  }));
  const packets = splitReadingPackets(fragments);
  expect(packets).toHaveLength(32);
  expect(packets.slice(2).every((p) => p.length === 5)).toBe(true);
  expect(packets.flat()).toEqual(fragments);
});

it('preserves code blocks and image-caption units without hiding following unnumbered tools', () => {
  const texts = [
    '## Tools',
    '[Tool A](https://example.invalid/a)',
    'It measures drift.',
    '```text\n## Not a chapter\n1. Not a story\n```',
    '![Diagram](https://example.invalid/a.png)',
    'Figure 1: The complete mechanism.',
    '[Tool B](https://example.invalid/b)',
    'It measures pressure.',
  ];
  const fragments = texts.map((selectedText, i) => ({
    fragmentId: String(i),
    structureId: 's',
    nodeKind: i === 3 ? 'code' : 'paragraph',
    codePointRange: {start: i * 100, end: i * 100 + selectedText.length},
    selectedText,
  }));
  const packets = splitReadingPackets(fragments);
  expect(packets.flat()).toEqual(fragments);
  expect(packets.find((p) => p[0]?.selectedText.startsWith('!['))).toEqual(
    fragments.slice(4, 6),
  );
  expect(packets.some((p) => p[0] === fragments[6])).toBe(true);
  expect(packets.find((p) => p[0] === fragments[3])).toEqual([fragments[3]]);
});
