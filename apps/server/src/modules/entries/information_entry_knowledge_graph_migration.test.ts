import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'apps/server/migrations/000012_add_entry_knowledge_graph_edges.sql',
  ),
  'utf8',
);

describe('Information Entry knowledge graph migration', () => {
  it('adds only the minimal user graph metadata to the existing override identity', () => {
    expect(migration).toContain(
      'ALTER TABLE struinfo.information_entry_association_override',
    );
    expect(migration).toContain('ADD COLUMN graph_origin text');
    expect(migration).toContain('ADD COLUMN graph_label text');
    expect(migration).toContain('ADD COLUMN graph_direction text');
    expect(migration).toContain("graph_origin IN ('association', 'user')");
    expect(migration).toContain(
      "graph_direction IN ('symmetric', 'low_to_high', 'high_to_low')",
    );
    expect(migration).toContain('char_length(graph_label) <= 80');
    expect(migration).toContain(
      '(graph_origin IS NULL AND graph_label IS NULL AND graph_direction IS NULL)',
    );
    expect(migration).not.toMatch(/CREATE\s+TABLE/iu);
    expect(migration).not.toMatch(/\b(json|jsonb|trigger|seed|grant|role)\b/iu);
  });
});
