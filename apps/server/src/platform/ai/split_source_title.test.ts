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

it('prefers the source heading to a later external guide or formula', () => {
  for (const body of [
    '## 2. A compact adaptation method\n\nThe update uses two factors.\n\nImplement the method from scratch\n[Read the external guide](https://example.invalid/guide)',
    '## A dependency risk\n\nThe dependency changes the available choices.\n\nthen: dependency = 0\nhttps://example.invalid/example',
  ]) {
    expect(
      splitSourceTitle([{ordinal: 0, text: body}], {
        startOrdinal: 0,
        endOrdinal: 0,
        titlePath: 'Generated title',
      }),
    ).toBe(body.split('\n')[0]?.replace(/^## /u, ''));
  }
});

it('does not promote a late external caption when no source heading exists', () => {
  expect(
    splitSourceTitle(
      [
        {
          ordinal: 0,
          text: 'The article explains a cache policy.\n\nAn external implementation\nhttps://example.invalid/guide',
        },
      ],
      {startOrdinal: 0, endOrdinal: 0, titlePath: 'Cache policy'},
    ),
  ).toBe('Cache policy');
});

it('skips an internal-link contents outline and keeps the actual article heading', () => {
  const body =
    '# Synthetic issue\n\n# Today\n\n- [Valve design](https://example.invalid/issue#valve): Pressure control.\n\n- [Archives](https://example.invalid/issue#archive): Earlier issues.\n\n# Valve design ( permalink )\n\nA relief valve opens at a calibrated pressure.';
  expect(
    splitSourceTitle([{ordinal: 0, text: body}], {
      startOrdinal: 0,
      endOrdinal: 0,
      titlePath: 'Incorrect generated title',
    }),
  ).toBe('Valve design');
});

it('keeps a source-backed article title when the range also includes a cover', () => {
  const text =
    '# Synthetic weekly\n\n## Cover\n\n![Harbour](https://example.invalid/photo)\n\nAn evening at the harbour.\n\n## Attention and interruptions\n\nRepeated interruptions make sustained work harder.\n\n## News';
  expect(
    splitSourceTitle([{ordinal: 0, text}], {
      startOrdinal: 0,
      endOrdinal: 0,
      titlePath: 'Attention and interruptions',
    }),
  ).toBe('Attention and interruptions');
});

it.each(['4、', '4. ', '4) '])(
  'uses a numbered item name, not the next category at the end: %s',
  (prefix) => {
    const text = `${prefix}[Starvine checker](https://example.invalid/checker)\n\nThe checker compares queue counters.\n\n## Resources`;
    expect(
      splitSourceTitle([{ordinal: 0, text}], {
        startOrdinal: 0,
        endOrdinal: 0,
        titlePath: 'Tools: Starvine checker',
      }),
    ).toBe('Starvine checker');
  },
);

it('ignores an empty trailing heading without overriding the supplied subject', () => {
  expect(
    splitSourceTitle(
      [
        {
          ordinal: 0,
          text: 'A valve releases excess pressure.\n\n## Next topic',
        },
      ],
      {startOrdinal: 0, endOrdinal: 0, titlePath: 'Pressure relief'},
    ),
  ).toBe('Pressure relief');
});

it('preserves an accurate category prefix but rejects a neighbouring category', () => {
  const input = [
    {ordinal: 0, text: '## Tools'},
    {
      ordinal: 1,
      text: '4、[Starvine checker](https://example.invalid/checker)\n\nThe checker compares queue counters.\n\n## Resources',
    },
  ];
  expect(
    splitSourceTitle(input, {
      startOrdinal: 1,
      endOrdinal: 1,
      titlePath: 'Tools: Starvine checker',
    }),
  ).toBe('Tools: Starvine checker');
  expect(
    splitSourceTitle(input, {
      startOrdinal: 1,
      endOrdinal: 1,
      titlePath: 'Resources: Starvine checker',
    }),
  ).toBe('Starvine checker');
});

it('does not promote a subheading or later external title that matches the model', () => {
  for (const titlePath of ['Limitations', 'Complete external guide']) {
    expect(
      splitSourceTitle(
        [
          {
            ordinal: 0,
            text: '## Queue control\n\nA queue uses bounded retries.\n\n### Limitations\n\nRetries stop at the fixed budget.\n\n[Complete external guide](https://example.invalid/guide)',
          },
        ],
        {startOrdinal: 0, endOrdinal: 0, titlePath},
      ),
    ).toBe('Queue control');
  }
});
