import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'apps/server/migrations/000013_create_processing_runs_and_proposals.sql',
  ),
  'utf8',
);

describe('Processing run and proposal migration', () => {
  it('adds exactly the provider-neutral run and typed proposal tables', () => {
    expect(
      [...migration.matchAll(/CREATE TABLE struinfo\.([a-z_]+)/gu)].map(
        (match) => match[1],
      ),
    ).toEqual([
      'processing_run',
      'processing_proposal',
      'processing_proposal_fragment_input',
    ]);
    expect(migration).toContain("CHECK (origin IN ('deterministic', 'ai'))");
    expect(migration).toContain(
      "CHECK (proposal_kind IN ('split', 'tags', 'association'))",
    );
    expect(migration).toContain(
      'REFERENCES struinfo.information_entry (workspace_id, entry_id)',
    );
    expect(migration).toContain(
      'REFERENCES struinfo.fragment (workspace_id, fragment_id)',
    );
    expect(migration).not.toMatch(
      /\b(?:json|jsonb|vector|embedding|provider_payload)\b/iu,
    );
    expect(migration).not.toMatch(/ON\s+DELETE\s+CASCADE/iu);
    expect(migration).not.toMatch(/\b(?:GRANT|ROLE|SEED|TRIGGER)\b/iu);
  });
});
