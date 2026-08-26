import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'apps/server/migrations/000021_add_information_entry_structure_lifecycle.sql',
  ),
  'utf8',
);

describe('InformationEntry structure lifecycle migration', () => {
  it('adds only current-structure state and a scoped document-order identity', () => {
    expect(migration).toContain(
      'ADD COLUMN is_current_structure boolean NOT NULL DEFAULT true',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX information_entry_current_snapshot_order_uq',
    );
    expect(migration).toContain('WHERE is_current_structure');
    expect(migration).not.toMatch(/CREATE\s+TABLE/iu);
    expect(migration).not.toMatch(/DELETE\s+FROM/iu);
    expect(migration).not.toMatch(
      /UPDATE\s+struinfo\.(?:snapshot|fragment)\b/iu,
    );
    expect(migration).not.toMatch(
      /\b(?:json|jsonb|trigger|seed|grant|role)\b/iu,
    );
  });
});
