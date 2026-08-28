import {readFile} from 'node:fs/promises';

import {describe, expect, it} from 'vitest';

const MIGRATION = new URL(
  '../../../migrations/000020_create_entry_automation_actions.sql',
  import.meta.url,
);

describe('M1H Entry automation action migration', () => {
  it('adds one typed, reversible action record without content payloads', async () => {
    const sql = await readFile(MIGRATION, 'utf8');

    expect(sql).toContain(
      'CREATE TABLE struinfo.processing_entry_automation_action',
    );
    expect(sql).toContain('deterministic_tags_enabled boolean NOT NULL');
    expect(sql).toContain('rebuild_associations_enabled boolean NOT NULL');
    expect(sql).toContain("'tags_applied'");
    expect(sql).toContain("'undo_pending'");
    expect(sql).toContain("'undone'");
    expect(sql).toContain(
      'REFERENCES struinfo.processing_entry_automation_claim',
    );
    expect(sql).not.toMatch(/\bjsonb?\b/iu);
    expect(sql).not.toMatch(/\b(body|source_text|provider_payload)\b/iu);
  });
});
