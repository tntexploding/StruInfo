import {describe, expect, it} from 'vitest';

import {
  deterministicEntryTagOriginVersion,
  extractDeterministicEntryTagCandidates,
} from './information_entry_deterministic_tags.js';

describe('deterministic Entry tags', () => {
  it('uses exclusions, alias chains and excludes link domains by default', () => {
    const result = extractDeterministicEntryTagCandidates(
      '# Synthetic note\n[synthetic cli](https://example.invalid/tool) uses `Node.js` and **TypeScript**.',
      {
        enabled: true,
        includeLinkDomains: false,
        excludedKeywords: ['TypeScript'],
      },
      {
        aliases: [
          {source: 'synthetic cli', canonical: 'Synthetic CLI'},
          {source: 'Synthetic CLI', canonical: 'CLI Tool'},
        ],
      },
    );

    expect(result).toEqual([
      {displayValue: 'Synthetic note', normalizedValue: 'synthetic note'},
      {displayValue: 'CLI Tool', normalizedValue: 'cli tool'},
      {displayValue: 'Node.js', normalizedValue: 'node.js'},
    ]);
  });

  it('is disabled explicitly and derives a stable per-claim origin', () => {
    expect(
      extractDeterministicEntryTagCandidates(
        '**Synthetic**',
        {enabled: false, includeLinkDomains: true, excludedKeywords: []},
        {aliases: []},
      ),
    ).toEqual([]);
    expect(
      deterministicEntryTagOriginVersion(
        '11111111-1111-4111-8111-111111111111',
        3,
      ),
    ).toBe(
      'struinfo.entry-tags.deterministic.v1:11111111-1111-4111-8111-111111111111:3',
    );
  });
});
