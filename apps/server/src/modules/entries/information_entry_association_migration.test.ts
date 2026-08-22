import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'apps/server/migrations/000010_create_information_entry_associations.sql',
  ),
  'utf8',
);

describe('Information Entry association migration', () => {
  it('separates rebuildable projections from versioned manual overrides', () => {
    const tables = [
      ...migration.matchAll(/CREATE TABLE\s+struinfo\.([a-z_]+)/gu),
    ].map((match) => match[1]);
    expect(tables).toEqual([
      'information_entry_association_projection',
      'information_entry_association_override',
      'information_entry_association_override_revision',
    ]);
    expect(migration).toContain('content_similarity integer NOT NULL');
    expect(migration).toContain('algorithm_version text NOT NULL');
    expect(migration).toContain(
      "CHECK (action IN ('enhance', 'weaken', 'block', 'restore'))",
    );
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(migration).not.toMatch(/ON\s+DELETE\s+CASCADE/iu);
    expect(migration).not.toMatch(/\b(json|jsonb|trigger|seed)\b/iu);
  });
});
