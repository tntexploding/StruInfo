import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'apps/server/migrations/000008_create_information_entry_core.sql',
  ),
  'utf8',
);

describe('InformationEntry migration', () => {
  it('adds only the six Entry tables and keeps source, revision, and privacy facts explicit', () => {
    const tables = [
      ...migration.matchAll(/CREATE TABLE\s+struinfo\.([a-z_]+)/gu),
    ].map((match) => match[1]);
    expect(tables).toEqual([
      'information_entry',
      'information_entry_revision',
      'information_entry_fragment_input',
      'information_entry_content_keyword',
      'information_entry_domain_keyword',
      'information_entry_lineage',
    ]);
    expect(migration).toContain(
      'REFERENCES struinfo.snapshot (workspace_id, resource_id, snapshot_id)',
    );
    expect(migration).toContain(
      'REFERENCES struinfo.fragment (workspace_id, fragment_id)',
    );
    expect(migration).toMatch(
      /FOREIGN KEY \(workspace_id, entry_id, previous_revision_id\)[\s\S]*?REFERENCES struinfo\.information_entry_revision \([\s\S]*?workspace_id,[\s\S]*?entry_id,[\s\S]*?revision_id[\s\S]*?\)/u,
    );
    expect(migration).toContain('is_private boolean NOT NULL');
    expect(migration).toContain("CHECK (chunk_mode IN ('split', 'whole'))");
    expect(migration).not.toMatch(/ON\s+DELETE\s+CASCADE/iu);
    expect(migration).not.toMatch(/\b(json|jsonb|trigger|seed)\b/iu);
  });
});
