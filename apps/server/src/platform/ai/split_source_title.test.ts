import {expect, it} from 'vitest';
import {splitSourceTitle} from './split_source_title.js';
const sections = [
  {
    ordinal: 0,
    text: '## Tools\n\nStarvine debugger\n[https://example.invalid/a](https://example.invalid/a)\n\nInspects queue state.',
  },
  {
    ordinal: 1,
    text: 'Moonrock profiler\n[Details](https://example.invalid/b)\n\nMeasures memory usage.',
  },
];
it('uses an item heading before its subheadings while excluding the publication title', () => {
  const input = [
    {
      ordinal: 0,
      text: '# Synthetic monthly issue\n\n# 1. Starvine adaptation\n\n## How does it work?\n\nA counter controls updates.',
    },
  ];
  expect(
    splitSourceTitle(input, {
      startOrdinal: 0,
      endOrdinal: 0,
      titlePath: 'Adaptation',
    }),
  ).toBe('1. Starvine adaptation');
});
it('binds a shifted title to its final source range instead of the neighbouring item', () => {
  expect(
    splitSourceTitle(sections, {
      startOrdinal: 0,
      endOrdinal: 0,
      titlePath: 'Moonrock profiler',
    }),
  ).toBe('Starvine debugger');
  expect(
    splitSourceTitle(sections, {
      startOrdinal: 1,
      endOrdinal: 1,
      titlePath: 'Other tool',
    }),
  ).toBe('Moonrock profiler');
});
it('does not take code, images, URLs or out-of-range headings as a title', () => {
  const input = [
    {
      ordinal: 0,
      text: '```md\n## Fake title\n```\n\n![Chart](https://example.invalid/image)\n\nSubstantive explanation.',
    },
    {ordinal: 1, text: '## Another item'},
  ];
  expect(
    splitSourceTitle(input, {
      startOrdinal: 0,
      endOrdinal: 0,
      titlePath: 'Explanation',
    }),
  ).toBe('Explanation');
});

it('retains question headings and never promotes a linked image label to a title', () => {
  expect(
    splitSourceTitle(
      [
        {
          ordinal: 0,
          text: '## How does Starvine cache work?\n\n[![Synthetic chart](https://example.invalid/chart)](https://example.invalid/image)\n\nA reference counter expires the cached value.',
        },
      ],
      {startOrdinal: 0, endOrdinal: 0, titlePath: 'Cache mechanism'},
    ),
  ).toBe('How does Starvine cache work?');
});
