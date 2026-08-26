import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'apps/server/migrations/000022_create_information_document_working_copies.sql',
  ),
  'utf8',
);

describe('Information document working-copy migration', () => {
  it('adds one current-state table without changing immutable evidence', () => {
    expect(
      [...migration.matchAll(/CREATE TABLE struinfo\.([a-z_]+)/gu)].map(
        (match) => match[1],
      ),
    ).toEqual(['information_document_working_copy']);
    expect(migration).toContain(
      'PRIMARY KEY (workspace_id, source_snapshot_id)',
    );
    expect(migration).toContain("CHECK (state IN ('editing', 'committed'))");
    expect(migration).toContain('octet_length(draft_body) <= 1048576');
    expect(migration).toContain('UNIQUE (workspace_id, derived_snapshot_id)');
    expect(migration).not.toMatch(/ON\s+DELETE\s+CASCADE/iu);
    expect(migration).not.toMatch(/\b(?:json|jsonb|vector|embedding)\b/iu);
    expect(migration).not.toMatch(
      /UPDATE\s+struinfo\.(?:snapshot|fragment)\b/iu,
    );
  });
});
