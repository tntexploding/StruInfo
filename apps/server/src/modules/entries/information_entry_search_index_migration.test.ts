import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'apps/server/migrations/000025_create_information_entry_search_index.sql',
  ),
  'utf8',
);

describe('Information Entry search-index migration', () => {
  it('stores only rebuildable revision-bound projections and bounded term postings', () => {
    const tables = [
      ...migration.matchAll(/CREATE TABLE\s+struinfo\.([a-z_]+)/gu),
    ].map((match) => match[1]);
    expect(tables).toEqual([
      'information_entry_search_projection',
      'information_entry_term_posting',
    ]);
    expect(migration).toContain('entry_revision_id uuid NOT NULL');
    expect(migration).toContain('embedding double precision[]');
    expect(migration).toContain("field IN ('title', 'body', 'tags')");
    expect(migration).toContain('information_entry_term_posting_lookup_idx');
    expect(migration).not.toMatch(/ON\s+DELETE\s+CASCADE/iu);
    expect(migration).not.toMatch(/\b(json|jsonb|trigger|seed|extension)\b/iu);
  });
});
