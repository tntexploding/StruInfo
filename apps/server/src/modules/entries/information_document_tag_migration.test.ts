import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'apps/server/migrations/000009_create_information_document_tags.sql',
  ),
  'utf8',
);

describe('Information Document tag migration', () => {
  it('adds only versioned Document tag state bound to the canonical Snapshot', () => {
    const tables = [
      ...migration.matchAll(/CREATE TABLE\s+struinfo\.([a-z_]+)/gu),
    ].map((match) => match[1]);
    expect(tables).toEqual([
      'information_document_tag_set',
      'information_document_tag_revision',
      'information_document_tag_value',
    ]);
    expect(migration).toContain(
      'REFERENCES struinfo.snapshot (workspace_id, resource_id, snapshot_id)',
    );
    expect(migration).toContain('current_revision_id uuid NOT NULL');
    expect(migration).toContain(
      "CHECK (revision_kind IN ('aggregate', 'manual'))",
    );
    expect(migration).toContain('full_text_occurrences integer NOT NULL');
    expect(migration).toContain('entry_coverage_count integer NOT NULL');
    expect(migration).not.toMatch(/ON\s+DELETE\s+CASCADE/iu);
    expect(migration).not.toMatch(/\b(json|jsonb|trigger|seed)\b/iu);
  });
});
