import {existsSync, readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {
  KNOWLEDGE_TM1_LEDGER,
  type KnowledgeTm1LedgerRow,
} from '../../../test_support/manual_knowledge_tm1_oracle.js';
import {
  MANUAL_KNOWLEDGE_TABLES,
  auditManualKnowledgeSql,
  createSyntheticManualKnowledgeSql,
  replaceExecutableTokenSequence,
  tokenizeManualKnowledgeSql,
} from '../../../test_support/manual_knowledge_sql_lexical.js';

const migrationUrl = new URL(
  '../../../migrations/000004_create_manual_knowledge_core.sql',
  import.meta.url,
);

const itemCurrentPointer = [
  'foreign',
  'key',
  '(',
  'workspace_id',
  ',',
  'item_id',
  ',',
  'current_revision',
  ',',
  'current_revision_id',
  ')',
  'references',
  'struinfo',
  '.',
  'knowledge_revision',
  '(',
  'workspace_id',
  ',',
  'item_id',
  ',',
  'revision_number',
  ',',
  'revision_id',
  ')',
] as const;

const eventUnique = [
  'unique',
  '(',
  'workspace_id',
  ',',
  'change_set_id',
  ')',
] as const;

function requireMigrationSql(row: KnowledgeTm1LedgerRow): string {
  const exists = existsSync(migrationUrl);
  expect(
    exists,
    `${row.id} expected-red until 000004 is integrated from Backend`,
  ).toBe(true);
  if (!exists) {
    throw new Error(
      `${row.id} missing 000004_create_manual_knowledge_core.sql.`,
    );
  }
  return readFileSync(migrationUrl, 'utf8');
}

function expectFinding(sql: string, code: string): void {
  const actual = auditManualKnowledgeSql(sql).map((finding) => finding.code);
  expect(actual, `expected ${code}; received ${actual.join(',')}`).toContain(
    code,
  );
}

function auditIntegratedMigration(row: KnowledgeTm1LedgerRow): void {
  expect(auditManualKnowledgeSql(requireMigrationSql(row)), row.id).toEqual([]);
}

function evaluateMigrationRow(row: KnowledgeTm1LedgerRow): void {
  const reference = createSyntheticManualKnowledgeSql();
  expect(
    auditManualKnowledgeSql(reference),
    `${row.id} Test-owned reference`,
  ).toEqual([]);
  switch (row.ordinal) {
    case 207: {
      const regexTokens = tokenizeManualKnowledgeSql(
        "CHECK (synthetic_value ~ '^[a-z]+$')",
      );
      expect(
        regexTokens.filter((token) => token.kind === 'operator'),
      ).toMatchObject([{kind: 'operator', value: '~'}]);
      expect(() =>
        tokenizeManualKnowledgeSql("CHECK (synthetic_value @ 'synthetic')"),
      ).toThrow(/Unsupported SQL character/u);
      expect(MANUAL_KNOWLEDGE_TABLES).toHaveLength(13);
      expectFinding(
        `${reference}\n\nCREATE TABLE struinfo.synthetic_extra (` +
          'workspace_id uuid NOT NULL, synthetic_id uuid NOT NULL, ' +
          'PRIMARY KEY (workspace_id, synthetic_id));',
        'table_set',
      );
      break;
    }
    case 208: {
      const weakened = replaceExecutableTokenSequence(
        reference,
        itemCurrentPointer,
        'FOREIGN KEY (item_id, current_revision, current_revision_id) ' +
          'REFERENCES struinfo.knowledge_revision ' +
          '(item_id, revision_number, revision_id)',
      );
      expectFinding(weakened, 'workspace_foreign_key');
      expectFinding(
        `${weakened}\nALTER TABLE struinfo.knowledge_item ` +
          'ADD CONSTRAINT synthetic_redundant_current_fk ' +
          'FOREIGN KEY (workspace_id, item_id, current_revision, current_revision_id) ' +
          'REFERENCES struinfo.knowledge_revision ' +
          '(workspace_id, item_id, revision_number, revision_id);',
        'constraint_set',
      );
      break;
    }
    case 209: {
      const lifecycle = [
        'check',
        '(',
        'epistemic_role',
        'in',
        '(',
        'string:source_excerpt',
        ',',
        'string:source_claim',
        ',',
        'string:summary',
        ',',
        'string:inference',
        ',',
        'string:user_assertion',
        ')',
        ')',
        ',',
        'check',
        '(',
        'review_state',
        'in',
        '(',
        'string:draft',
        ',',
        'string:pending_review',
        ',',
        'string:confirmed',
        ',',
        'string:disputed',
        ',',
        'string:rejected',
        ',',
        'string:withdrawn',
        ')',
        ')',
      ];
      const weakened = replaceExecutableTokenSequence(
        reference,
        lifecycle,
        "CHECK (epistemic_role IN ('source_excerpt', 'source_claim', " +
          "'summary', 'inference', 'user_assertion')), " +
          "CHECK (review_state IN ('draft', 'pending_review', 'confirmed', " +
          "'disputed', 'rejected', 'withdrawn', 'synthetic_illegal'))",
      );
      expectFinding(weakened, 'required_semantic');
      expectFinding(
        `${weakened}\n-- CHECK (review_state IN ('draft', 'pending_review', ` +
          "'confirmed', 'disputed', 'rejected', 'withdrawn'))",
        'required_semantic',
      );
      break;
    }
    case 210: {
      const weakened = replaceExecutableTokenSequence(
        reference,
        itemCurrentPointer,
        'FOREIGN KEY (workspace_id, item_id, current_revision, current_revision_id) ' +
          'REFERENCES struinfo.knowledge_revision ' +
          '(workspace_id, item_id, revision_number)',
      );
      expectFinding(weakened, 'required_semantic');
      break;
    }
    case 211: {
      const weakened = replaceExecutableTokenSequence(
        reference,
        eventUnique,
        'CHECK (change_set_id IS NOT NULL)',
      );
      expectFinding(weakened, 'required_semantic');
      break;
    }
    case 212:
      expectFinding(
        `${reference}\nCREATE TRIGGER synthetic_trigger AFTER INSERT ` +
          'ON struinfo.knowledge_item EXECUTE FUNCTION synthetic();',
        'unsupported_statement',
      );
      expectFinding(
        `${reference}\nINSERT INTO struinfo.knowledge_item VALUES ('synthetic');`,
        'unsupported_statement',
      );
      expectFinding(
        replaceExecutableTokenSequence(
          reference,
          itemCurrentPointer,
          'FOREIGN KEY (workspace_id, item_id, current_revision, current_revision_id) ' +
            'REFERENCES struinfo.knowledge_revision ' +
            '(workspace_id, item_id, revision_number, revision_id) ON DELETE CASCADE',
        ),
        'cascade',
      );
      break;
    case 213: {
      const weakened = replaceExecutableTokenSequence(
        reference,
        eventUnique,
        "CHECK ('UNIQUE (workspace_id, change_set_id)' <> '')",
      );
      const decoy = `${weakened}\n-- UNIQUE (workspace_id, change_set_id)`;
      expectFinding(decoy, 'required_semantic');
      expect(
        tokenizeManualKnowledgeSql(decoy).some(
          (token) => token.kind === 'string' && token.value.includes('UNIQUE'),
        ),
      ).toBe(true);
      expectFinding(
        replaceExecutableTokenSequence(
          reference,
          ['body', 'text'],
          'body jsonb',
        ),
        'json_column',
      );
      expectFinding(
        replaceExecutableTokenSequence(
          reference,
          ['body', 'text'],
          'body "TEXT"',
        ),
        'unsupported_statement',
      );
      expectFinding(
        `${reference}\nCREATE INDEX synthetic_bad_lookup ` +
          'ON struinfo.knowledge_revision (workspace_id, title);',
        'performance_index',
      );
      expectFinding(
        `${reference}\nCREATE UNIQUE INDEX synthetic_extra_unique ` +
          'ON struinfo.knowledge_revision (workspace_id, item_id);',
        'unexpected_material_index',
      );
      break;
    }
    case 214: {
      const renamed = replaceExecutableTokenSequence(
        reference,
        eventUnique,
        'CONSTRAINT synthetic_event_unique UNIQUE (workspace_id, change_set_id)',
      );
      const reordered = renamed.split('\n\n').reverse().join('\n\n');
      expect(auditManualKnowledgeSql(reordered)).toEqual([]);
      expect(
        auditManualKnowledgeSql(
          `${reordered}\nCREATE INDEX synthetic_lookup ` +
            'ON struinfo.knowledge_revision (workspace_id, item_id);',
        ),
      ).toEqual([]);
      break;
    }
    default:
      throw new RangeError(`${row.id} is not a migration row.`);
  }
  auditIntegratedMigration(row);
}

describe('manual knowledge independent static migration TM1', () => {
  const migrationRows = KNOWLEDGE_TM1_LEDGER.filter(
    (row) => row.layer === 'migration',
  );
  it.each(migrationRows)('$id $title', (row) => {
    evaluateMigrationRow(row);
  });
});
