import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';

const MIGRATION_URL = new URL(
  '../../../migrations/000018_create_entry_automation_execution.sql',
  import.meta.url,
);

describe('Entry automation execution migration', () => {
  it('adds only typed run metadata and recoverable routing claims', async () => {
    const migration = await readFile(MIGRATION_URL, 'utf8');

    expect(migration).toContain(
      'CREATE TABLE struinfo.processing_entry_automation_run',
    );
    expect(migration).toContain(
      'CREATE TABLE struinfo.processing_entry_automation_claim',
    );
    expect(migration).toContain(
      'REFERENCES struinfo.processing_run (workspace_id, run_id)',
    );
    expect(migration).toContain(
      'REFERENCES struinfo.information_entry (workspace_id, entry_id)',
    );
    expect(migration).toContain(
      "route IN ('advance_candidate', 'manual_review', 'defer_candidate')",
    );
    expect(migration).toContain(
      "status IN ('claimed', 'completed', 'compensated')",
    );
    expect(migration).not.toMatch(/\bjsonb?\b/iu);
    expect(migration).not.toMatch(/\btrigger\b/iu);
    expect(migration).not.toMatch(/ON DELETE CASCADE/iu);
  });
});
