import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'apps/server/migrations/000014_create_ai_tag_proposals.sql',
  ),
  'utf8',
);

describe('AI tag proposal migration', () => {
  it('adds only the three typed proposal payload tables', () => {
    expect(
      [...migration.matchAll(/CREATE TABLE struinfo\.([a-z_]+)/gu)].map(
        (match) => match[1],
      ),
    ).toEqual([
      'processing_tag_proposal',
      'processing_tag_proposal_content_keyword',
      'processing_tag_proposal_domain',
    ]);
    expect(migration).toContain(
      'REFERENCES struinfo.processing_proposal (workspace_id, proposal_id)',
    );
    expect(migration).toContain('expected_entry_revision integer NOT NULL');
    expect(migration).toContain('provider_model varchar(120) NOT NULL');
    expect(migration).not.toMatch(/\b(?:json|jsonb|vector|embedding)\b/iu);
    expect(migration).not.toMatch(/ON\s+DELETE\s+CASCADE/iu);
    expect(migration).not.toMatch(/\b(?:GRANT|ROLE|SEED|TRIGGER)\b/iu);
  });
});
