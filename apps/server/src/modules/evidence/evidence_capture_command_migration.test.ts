import {readFile} from 'node:fs/promises';

import {describe, expect, it} from 'vitest';

const MIGRATION_URL = new URL(
  '../../../migrations/000005_create_evidence_capture_command.sql',
  import.meta.url,
);

describe('evidence capture command migration', () => {
  it('adds only the workspace-scoped durable idempotency ledger', async () => {
    const sql = await readFile(MIGRATION_URL, 'utf8');

    expect(sql).toContain('CREATE TABLE struinfo.evidence_capture_command');
    expect(sql).toContain(
      'PRIMARY KEY (workspace_id, command_idempotency_key)',
    );
    expect(sql).toContain('REFERENCES struinfo.workspace (workspace_id)');
    expect(sql).toContain("request_sha256 ~ '^[0-9a-f]{64}$'");
    expect(sql).not.toMatch(/ON\s+DELETE\s+CASCADE/iu);
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|GRANT|ROLE)\b/iu);
  });
});
