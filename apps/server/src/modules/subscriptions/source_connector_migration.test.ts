import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'apps/server/migrations/000023_add_remote_document_resource_kind.sql',
  ),
  'utf8',
);

describe('Remote document resource-kind migration', () => {
  it('only widens the existing closed resource kind constraint', () => {
    expect(migration).toContain('DROP CONSTRAINT resource_kind_ck');
    expect(migration).toContain('ADD CONSTRAINT resource_kind_ck');
    expect(migration).toContain("'remote_document'");
    expect(migration).not.toMatch(/CREATE\s+(?:TABLE|SCHEMA|ROLE|EXTENSION)/iu);
    expect(migration).not.toMatch(
      /UPDATE\s+struinfo\.(?:snapshot|fragment|resource)\b/iu,
    );
    expect(migration).not.toMatch(/DELETE\s+FROM|TRUNCATE/iu);
  });
});
