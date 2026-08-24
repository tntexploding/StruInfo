import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'apps/server/migrations/000015_create_ai_association_proposals.sql',
  ),
  'utf8',
);

describe('AI association proposal migration', () => {
  it('adds one typed payload table and the visible AI graph origin', () => {
    expect(migration).toContain(
      "graph_origin IN ('association', 'user', 'ai')",
    );
    expect(
      [...migration.matchAll(/CREATE TABLE struinfo\.([a-z_]+)/gu)].map(
        (match) => match[1],
      ),
    ).toEqual(['processing_association_proposal']);
    expect(migration).toContain('expected_override_revision integer NOT NULL');
    expect(migration).toContain('relation_label varchar(80) NOT NULL');
    expect(migration).not.toMatch(/\b(?:json|jsonb|vector|embedding)\b/iu);
    expect(migration).not.toMatch(/ON\s+DELETE\s+CASCADE/iu);
    expect(migration).not.toMatch(/\b(?:GRANT|ROLE|SEED|TRIGGER)\b/iu);
  });
});
