import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'apps/server/migrations/000011_collapse_information_entry_current_state.sql',
  ),
  'utf8',
);

describe('Information Entry current-state migration', () => {
  it('keeps original evidence and only the current five-step product state', () => {
    expect(migration).toContain(
      'FROM struinfo.information_entry_revision AS revision',
    );
    expect(migration).toContain(
      'FROM struinfo.information_document_tag_revision AS revision',
    );
    expect(migration).toContain(
      'FROM struinfo.information_entry_association_override_revision AS revision',
    );
    expect(migration).toContain(
      'CHECK (usefulness_score IS NULL OR usefulness_score BETWEEN 1 AND 5)',
    );
    expect(migration).toContain(
      'CHECK (interest_score IS NULL OR interest_score BETWEEN 1 AND 5)',
    );
    expect(migration).toContain(
      "assessment.dimension IN ('information_density', 'current_interest')",
    );
    expect(migration).toContain(
      "assessment_revision.assessment_state = 'rated'",
    );
    expect(migration).toContain("'legacy-curation-import.v1'");
    expect(migration).toContain(
      'revision.revision_id = manual_override.current_revision_id',
    );
    expect(migration).not.toContain('manual_manual_override');
    expect(migration.indexOf('WITH ranked_legacy_scores')).toBeLessThan(
      migration.indexOf('DROP COLUMN revision_number'),
    );
    expect(migration.indexOf('SET CONSTRAINTS ALL IMMEDIATE')).toBeGreaterThan(
      migration.indexOf('WITH ranked_legacy_scores'),
    );
    expect(migration.indexOf('SET CONSTRAINTS ALL IMMEDIATE')).toBeLessThan(
      migration.indexOf(
        'ALTER TABLE struinfo.information_entry\n  ALTER COLUMN document_order SET NOT NULL',
      ),
    );
    expect(migration.indexOf('WITH legacy_keyword_candidates')).toBeLessThan(
      migration.indexOf('DROP COLUMN revision_number'),
    );
    expect(migration.match(/DROP COLUMN revision_number/gu)).toHaveLength(4);
    expect(migration.match(/DROP COLUMN revision_id/gu)).toHaveLength(4);
    expect(
      [...migration.matchAll(/DROP TABLE struinfo\.([a-z_]+)/gu)].map(
        (match) => match[1],
      ),
    ).toEqual([
      'information_entry_association_override_revision',
      'information_document_tag_revision',
      'information_entry_revision',
    ]);
    expect(migration).not.toContain('DROP TABLE struinfo.snapshot');
    expect(migration).not.toContain('DROP TABLE struinfo.knowledge_revision');
    expect(migration).not.toMatch(/ON\s+DELETE\s+CASCADE/iu);
    expect(migration).not.toMatch(/\b(json|jsonb|trigger|seed)\b/iu);
  });
});
