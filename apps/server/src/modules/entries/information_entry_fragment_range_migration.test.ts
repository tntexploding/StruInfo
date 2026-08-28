import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'apps/server/migrations/000017_add_information_entry_fragment_ranges.sql',
  ),
  'utf8',
);

describe('InformationEntry Fragment range migration', () => {
  it('adds one typed optional child table without rewriting evidence', () => {
    expect(
      [...migration.matchAll(/CREATE TABLE struinfo\.([a-z_]+)/gu)].map(
        (match) => match[1],
      ),
    ).toEqual(['information_entry_fragment_range']);
    expect(migration).toContain(
      'REFERENCES struinfo.information_entry_fragment_input',
    );
    expect(migration).toContain('CHECK (start_code_point >= 0)');
    expect(migration).toContain('CHECK (end_code_point > start_code_point)');
    expect(migration).not.toMatch(/\b(?:json|jsonb|vector|embedding)\b/iu);
    expect(migration).not.toMatch(/ON\s+DELETE\s+CASCADE/iu);
    expect(migration).not.toMatch(
      /UPDATE\s+struinfo\.(?:snapshot|fragment)\b/iu,
    );
  });
});
