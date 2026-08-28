import {readFile} from 'node:fs/promises';

import {describe, expect, it} from 'vitest';

const MIGRATION_URL = new URL(
  '../../../migrations/000007_add_other_knowledge_kind.sql',
  import.meta.url,
);

describe('knowledge kind simplification migration', () => {
  it('adds the other value without rewriting legacy knowledge rows', async () => {
    const sql = await readFile(MIGRATION_URL, 'utf8');

    expect(sql).toMatch(
      /ALTER TABLE struinfo\.knowledge_revision\s+DROP CONSTRAINT knowledge_revision_kind_ck;/u,
    );
    expect(sql).toMatch(
      /ADD CONSTRAINT knowledge_revision_kind_ck\s+CHECK \(\s*knowledge_kind IN \([\s\S]*'other'[\s\S]*\)\s*\);/u,
    );
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu);
  });
});
