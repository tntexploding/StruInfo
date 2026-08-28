import {readFile} from 'node:fs/promises';

import {describe, expect, it} from 'vitest';

const MIGRATION_URL = new URL(
  '../../../migrations/000006_add_private_document_visibility.sql',
  import.meta.url,
);

describe('private document visibility migration', () => {
  it('adds only the three persisted privacy facts with a public default', async () => {
    const sql = await readFile(MIGRATION_URL, 'utf8');

    expect(sql).toMatch(
      /ALTER TABLE struinfo\.resource\s+ADD COLUMN is_private boolean NOT NULL DEFAULT false;/u,
    );
    expect(sql).toMatch(
      /ALTER TABLE struinfo\.knowledge_revision\s+ADD COLUMN is_private boolean NOT NULL DEFAULT false;/u,
    );
    expect(sql).toMatch(
      /ALTER TABLE struinfo\.knowledge_relation_revision\s+ADD COLUMN is_private boolean NOT NULL DEFAULT false;/u,
    );
    expect(sql).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE\s+TABLE|DROP|GRANT|REVOKE)\b/iu,
    );
  });
});
