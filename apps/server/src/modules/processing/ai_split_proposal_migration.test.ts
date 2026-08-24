import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
const migration = readFileSync(
  resolve(
    process.cwd(),
    'apps/server/migrations/000016_create_ai_split_proposals.sql',
  ),
  'utf8',
);
describe('AI split proposal migration', () => {
  it('adds only three typed normalized payload tables', () => {
    expect(
      [...migration.matchAll(/CREATE TABLE struinfo\.([a-z_]+)/gu)].map(
        (match) => match[1],
      ),
    ).toEqual([
      'processing_split_proposal',
      'processing_split_proposal_entry',
      'processing_split_proposal_entry_fragment',
    ]);
    expect(migration).toContain(
      "split_rule_version = 'struinfo.entry-split.ai-group.v1'",
    );
    expect(migration).toContain(
      'REFERENCES struinfo.fragment (workspace_id, fragment_id)',
    );
    expect(migration).not.toMatch(/\b(?:json|jsonb|vector|embedding)\b/iu);
    expect(migration).not.toMatch(/ON\s+DELETE\s+CASCADE/iu);
  });
});
