import {describe, expect, it} from 'vitest';

import {
  KNOWLEDGE_WRITE_KINDS,
  knowledgeKindForNewWrite,
  knowledgeKindsForSearch,
} from './knowledge_kind_options.js';

describe('knowledge kind presentation', () => {
  it('offers the six owner-facing kinds for new writes', () => {
    expect(KNOWLEDGE_WRITE_KINDS).toEqual([
      'concept',
      'assertion',
      'event',
      'method',
      'resource',
      'other',
    ]);
  });

  it.each(['entity', 'framework', 'work'] as const)(
    'maps the legacy %s kind to resource for a new write',
    (kind) => {
      expect(knowledgeKindForNewWrite(kind)).toBe('resource');
    },
  );

  it('searches resource across the legacy and current stored values', () => {
    expect(knowledgeKindsForSearch('resource')).toEqual([
      'entity',
      'framework',
      'resource',
      'work',
    ]);
    expect(knowledgeKindsForSearch('other')).toEqual(['other']);
  });
});
