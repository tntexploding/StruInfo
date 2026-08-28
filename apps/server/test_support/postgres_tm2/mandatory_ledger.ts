export type Tm2CaseGroup =
  | 'environment'
  | 'migration'
  | 'catalog'
  | 'grant'
  | 'lifecycle'
  | 'transaction'
  | 'domain'
  | 'retrieval'
  | 'quality';

export interface Tm2FamilyDefinition {
  readonly key: string;
  readonly title: string;
  readonly start: number;
  readonly end: number;
  readonly group: Tm2CaseGroup;
}

export interface Tm2MandatoryCase {
  readonly id: `PG-TM2-${string}`;
  readonly number: number;
  readonly family: string;
  readonly familyTitle: string;
  readonly group: Tm2CaseGroup;
  readonly ordinal: number;
  readonly vectorId: string;
  readonly description: string;
}

export const TM2_FAMILIES: readonly Tm2FamilyDefinition[] = Object.freeze([
  Object.freeze({
    key: 'url-admission',
    title: 'closed URL, role, and strict credential admission',
    start: 1,
    end: 68,
    group: 'environment',
  }),
  Object.freeze({
    key: 'pg-config',
    title: 'exact eight-field pg configuration and credential binding',
    start: 69,
    end: 98,
    group: 'environment',
  }),
  Object.freeze({
    key: 'ambient-credential',
    title: 'poison profile and ambient PG environment isolation',
    start: 99,
    end: 112,
    group: 'environment',
  }),
  Object.freeze({
    key: 'session-identity',
    title: 'PostgreSQL 18 session and endpoint identity',
    start: 113,
    end: 130,
    group: 'environment',
  }),
  Object.freeze({
    key: 'role-closure',
    title: 'role attributes, membership, ownership, and SET ROLE closure',
    start: 131,
    end: 150,
    group: 'grant',
  }),
  Object.freeze({
    key: 'migration-runner',
    title: 'first-party migrations, ledger, concurrency, and rollback',
    start: 151,
    end: 168,
    group: 'migration',
  }),
  Object.freeze({
    key: 'catalog-tables',
    title: 'schema ownership and closed 35-table catalog',
    start: 169,
    end: 188,
    group: 'catalog',
  }),
  Object.freeze({
    key: 'catalog-constraints',
    title: 'keys, references, checks, indexes, and current pointers',
    start: 189,
    end: 216,
    group: 'catalog',
  }),
  Object.freeze({
    key: 'runtime-grants-allowed',
    title: 'allowed runtime SELECT, INSERT, and pointer updates',
    start: 217,
    end: 240,
    group: 'grant',
  }),
  Object.freeze({
    key: 'runtime-grants-forbidden',
    title: 'forbidden metadata, DML, TEMP, DDL, role, and extension operations',
    start: 241,
    end: 272,
    group: 'grant',
  }),
  Object.freeze({
    key: 'pool-lifecycle',
    title: 'single pool, acquisition, release, and shutdown lifecycle',
    start: 273,
    end: 286,
    group: 'lifecycle',
  }),
  Object.freeze({
    key: 'workspace-transaction',
    title: 'workspace lock, ordinary command lookup, lock order, and CAS',
    start: 287,
    end: 310,
    group: 'transaction',
  }),
  Object.freeze({
    key: 'curation-parity',
    title: 'manual curation public-result and persisted-row parity',
    start: 311,
    end: 332,
    group: 'domain',
  }),
  Object.freeze({
    key: 'knowledge-parity',
    title: 'knowledge change-set public-result and persisted-row parity',
    start: 333,
    end: 360,
    group: 'domain',
  }),
  Object.freeze({
    key: 'rollback',
    title: 'fault-point rollback and no false receipt',
    start: 361,
    end: 376,
    group: 'transaction',
  }),
  Object.freeze({
    key: 'command-concurrency',
    title: 'barrier-observed replay, conflict, and CAS concurrency',
    start: 377,
    end: 392,
    group: 'transaction',
  }),
  Object.freeze({
    key: 'hierarchy-concurrency',
    title: 'serialized hierarchy cycle prevention',
    start: 393,
    end: 402,
    group: 'transaction',
  }),
  Object.freeze({
    key: 'retrieval-completeness',
    title: 'repeatable-read five-array snapshot completeness',
    start: 403,
    end: 418,
    group: 'retrieval',
  }),
  Object.freeze({
    key: 'retrieval-parity',
    title: 'search, filters, ordering, cursor, and total-count parity',
    start: 419,
    end: 440,
    group: 'retrieval',
  }),
  Object.freeze({
    key: 'retrieval-snapshot',
    title: 'controlled writer versus repeatable-read snapshot',
    start: 441,
    end: 448,
    group: 'retrieval',
  }),
  Object.freeze({
    key: 'workspace-isolation',
    title: 'same stable identities isolated across workspaces',
    start: 449,
    end: 460,
    group: 'domain',
  }),
  Object.freeze({
    key: 'privacy',
    title:
      'secret, SQL parameter, private text, and driver-error non-disclosure',
    start: 461,
    end: 470,
    group: 'quality',
  }),
  Object.freeze({
    key: 'artifact-governance',
    title: 'dependency, license, import direction, and artifact boundary',
    start: 471,
    end: 480,
    group: 'quality',
  }),
  Object.freeze({
    key: 'quality-gates',
    title: 'mandatory ledger and repository quality gates',
    start: 481,
    end: 488,
    group: 'quality',
  }),
]);

const namedVectors = new Map<number, string>([
  [1, 'postgres-scheme'],
  [2, 'postgresql-scheme'],
  [3, 'ipv4-loopback'],
  [4, 'ipv6-loopback'],
  [5, 'localhost'],
  [6, 'default-port-5432'],
  [7, 'explicit-port-lower-bound'],
  [8, 'explicit-port-upper-bound'],
  [9, 'leading-whitespace-rejected'],
  [10, 'trailing-whitespace-rejected'],
  [11, 'raw-control-rejected'],
  [12, 'raw-del-rejected'],
  [13, 'wrong-username-rejected'],
  [14, 'missing-username-rejected'],
  [15, 'malformed-username-percent-rejected'],
  [16, 'invalid-username-utf8-rejected'],
  [17, 'admin-explicit-password'],
  [18, 'migration-explicit-password'],
  [19, 'runtime-explicit-password'],
  [20, 'admin-missing-password-rejected'],
  [21, 'migration-missing-password-rejected'],
  [22, 'runtime-missing-password-rejected'],
  [23, 'admin-empty-password-rejected'],
  [24, 'migration-empty-password-rejected'],
  [25, 'runtime-empty-password-rejected'],
  [26, 'decoded-empty-postcondition'],
  [27, 'percent-at-decoded-once'],
  [28, 'literal-plus-preserved'],
  [29, 'percent-plus-decoded-once'],
  [30, 'percent-25-decoded-once'],
  [31, 'bare-percent-rejected'],
  [32, 'short-percent-rejected'],
  [33, 'nonhex-percent-rejected'],
  [34, 'overlong-utf8-rejected'],
  [35, 'truncated-utf8-rejected'],
  [36, 'encoded-surrogate-rejected'],
  [37, 'out-of-range-scalar-rejected'],
  [38, 'decoded-nul-rejected'],
  [39, 'raw-high-surrogate-rejected'],
  [40, 'raw-low-surrogate-rejected'],
  [41, 'decoded-nonscalar-rejected'],
  [42, 'no-unicode-normalization'],
  [43, 'no-case-conversion'],
  [44, 'no-second-percent-decode'],
  [45, 'port-zero-rejected'],
  [46, 'port-overflow-rejected'],
  [47, 'nondigit-port-rejected'],
  [48, 'empty-port-rejected'],
  [49, 'empty-database-rejected'],
  [50, 'multiple-database-segments-rejected'],
  [51, 'encoded-slash-database-rejected'],
  [52, 'encoded-backslash-database-rejected'],
  [53, 'encoded-nul-database-rejected'],
  [54, 'query-host-rejected'],
  [55, 'query-port-rejected'],
  [56, 'query-user-rejected'],
  [57, 'query-database-rejected'],
  [58, 'query-dbname-rejected'],
  [59, 'query-options-rejected'],
  [60, 'query-service-rejected'],
  [61, 'query-ssl-rejected'],
  [62, 'unknown-query-rejected'],
  [63, 'fragment-rejected'],
  [64, 'unix-socket-rejected'],
  [65, 'multi-host-rejected'],
  [66, 'keyword-value-form-rejected'],
  [67, 'same-endpoint-required'],
  [68, 'three-fixed-roles-distinct'],
  [69, 'config-null-prototype'],
  [70, 'config-exact-eight-fields'],
  [71, 'config-own-data-properties'],
  [72, 'config-no-symbol-fields'],
  [73, 'config-no-connection-string'],
  [74, 'config-no-unknown-fields'],
  [75, 'admin-password-own-nonempty'],
  [76, 'migration-password-own-nonempty'],
  [77, 'runtime-password-own-nonempty'],
  [78, 'admin-pg-password-identical'],
  [79, 'migration-pg-password-identical'],
  [80, 'runtime-pg-password-identical'],
  [81, 'password-function-forbidden'],
  [82, 'null-password-forbidden'],
  [83, 'undefined-password-forbidden'],
  [84, 'host-projection-exact'],
  [85, 'port-projection-exact'],
  [86, 'database-projection-exact'],
  [87, 'user-projection-exact'],
  [88, 'ssl-false-exact'],
  [89, 'admin-application-name-exact'],
  [90, 'migration-application-name-exact'],
  [91, 'runtime-application-name-exact'],
  [92, 'startup-options-exact'],
  [93, 'caller-mutation-isolated'],
  [94, 'descriptor-mutation-isolated'],
  [95, 'projection-does-not-read-inherited'],
  [96, 'projection-does-not-run-accessor'],
  [97, 'pg-connection-parameters-preserve-password'],
  [98, 'raw-url-never-passed-to-pg'],
  [99, 'isolated-home-root'],
  [100, 'isolated-userprofile-root'],
  [101, 'isolated-appdata-root'],
  [102, 'posix-poison-file-syntax'],
  [103, 'windows-poison-file-syntax'],
  [104, 'poison-file-negative-control'],
  [105, 'poison-present-explicit-password-wins'],
  [106, 'poison-changed-explicit-password-wins'],
  [107, 'poison-removed-explicit-password-wins'],
  [108, 'pgpassfile-removed'],
  [109, 'uppercase-pg-environment-removed'],
  [110, 'lowercase-pg-environment-removed'],
  [111, 'mixedcase-pg-environment-removed'],
  [112, 'non-pg-environment-preserved'],
  [287, 'workspace-lock-sha256-known-answer'],
  [288, 'workspace-lock-bigint-known-answer'],
  [289, 'workspace-lock-sent-as-decimal-string'],
  [290, 'workspace-row-ordinary-select'],
  [291, 'curation-command-ordinary-select'],
  [292, 'knowledge-command-ordinary-select'],
  [441, 'repeatable-read-read-only-begin'],
  [442, 'reader-first-barrier'],
  [443, 'writer-commit-observed'],
  [444, 'reader-snapshot-not-mixed'],
  [445, 'reader-commit-before-return'],
  [446, 'reader-client-release'],
  [447, 'reader-failure-rollback'],
  [448, 'reader-deadline-bounded'],
]);

function formatMandatoryId(number: number): `PG-TM2-${string}` {
  return `PG-TM2-${String(number).padStart(3, '0')}`;
}

function buildLedger(): readonly Tm2MandatoryCase[] {
  const ledger: Tm2MandatoryCase[] = [];
  for (const family of TM2_FAMILIES) {
    for (let number = family.start; number <= family.end; number += 1) {
      const ordinal = number - family.start + 1;
      const suffix = String(ordinal).padStart(3, '0');
      const vectorId = namedVectors.get(number) ?? `${family.key}-${suffix}`;
      ledger.push(
        Object.freeze({
          id: formatMandatoryId(number),
          number,
          family: family.key,
          familyTitle: family.title,
          group: family.group,
          ordinal,
          vectorId,
          description: `${family.title}: ${vectorId}`,
        }),
      );
    }
  }
  return Object.freeze(ledger);
}

export const TM2_MANDATORY_LEDGER = buildLedger();

export interface Tm2LedgerAudit {
  readonly total: number;
  readonly unique: number;
  readonly missing: readonly string[];
  readonly duplicate: readonly string[];
  readonly unexpected: readonly string[];
  readonly familyCount: number;
}

export function auditTm2MandatoryLedger(
  ledger: readonly Tm2MandatoryCase[] = TM2_MANDATORY_LEDGER,
): Tm2LedgerAudit {
  const counts = new Map<string, number>();
  for (const row of ledger) {
    counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  }
  const missing: string[] = [];
  for (let number = 1; number <= 488; number += 1) {
    const id = formatMandatoryId(number);
    if (!counts.has(id)) {
      missing.push(id);
    }
  }
  const duplicate: string[] = [];
  const unexpected: string[] = [];
  for (const [id, count] of counts) {
    if (count > 1) {
      duplicate.push(id);
    }
    if (
      !/^PG-TM2-(?:00[1-9]|0[1-9][0-9]|[1-3][0-9]{2}|4[0-7][0-9]|48[0-8])$/.test(
        id,
      )
    ) {
      unexpected.push(id);
    }
  }
  return Object.freeze({
    total: ledger.length,
    unique: counts.size,
    missing: Object.freeze(missing),
    duplicate: Object.freeze(duplicate),
    unexpected: Object.freeze(unexpected),
    familyCount: new Set(ledger.map((row) => row.family)).size,
  });
}

const startupAudit = auditTm2MandatoryLedger();
if (
  startupAudit.total !== 488 ||
  startupAudit.unique !== 488 ||
  startupAudit.missing.length !== 0 ||
  startupAudit.duplicate.length !== 0 ||
  startupAudit.unexpected.length !== 0
) {
  throw new Error('PG_TM2_MANDATORY_LEDGER_INVALID');
}
