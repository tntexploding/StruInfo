import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

const MIGRATION_PATH =
  'apps/server/migrations/000024_add_information_entry_graph_semantics.sql';

describe('Information Entry graph semantics migration', () => {
  it('adds closed semantic, verification and note columns without a new graph table', () => {
    const migration = readFileSync(MIGRATION_PATH, 'utf8');

    expect(migration).toContain('ADD COLUMN graph_semantic_kind text');
    expect(migration).toContain('ADD COLUMN graph_verification_status text');
    expect(migration).toContain('ADD COLUMN graph_note text');
    expect(migration).toContain("'source_checked'");
    expect(migration).toContain("'needs_review'");
    expect(migration).toContain("'contradicts'");
    expect(migration).toContain('char_length(graph_note) <= 500');
    expect(migration).not.toContain('CREATE TABLE');
  });
});
