import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';

const MIGRATION_URL = new URL(
  '../../../migrations/000019_create_entry_automation_work_queue.sql',
  import.meta.url,
);

describe('Entry automation work queue migration', () => {
  it('adds one owner-state table and backfills successful routing claims', async () => {
    const migration = await readFile(MIGRATION_URL, 'utf8');

    expect(migration).toContain(
      'CREATE TABLE struinfo.processing_entry_automation_work_item',
    );
    expect(migration).toContain(
      'REFERENCES struinfo.processing_entry_automation_claim',
    );
    expect(migration).toContain(
      "state IN ('pending', 'completed', 'dismissed')",
    );
    expect(migration).toContain("claim.status = 'completed'");
    expect(migration).toContain("run.status = 'succeeded'");
    expect(migration).not.toMatch(/\bjsonb?\b/iu);
    expect(migration).not.toMatch(/ON DELETE CASCADE/iu);
  });
});
