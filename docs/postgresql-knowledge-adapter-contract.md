# PostgreSQL Knowledge Adapter Parity Contract

- Contract ID: `C-SLICE-B-POSTGRES-r3`
- Status: Draft for independent Maintenance and Test re-review; implementation
  is blocked until this contract is accepted
- Date: 2026-08-15
- Supersedes: draft `C-SLICE-B-POSTGRES-r2`; retains its URL/session-identity,
  command-lookup, role-membership, and temporary-object closures and closes the
  explicit-password and ambient credential-fallback ambiguity
- Implementation baseline: `267d8cd151a36e5375143f2cc68d10ec451ecc3b`
- Accepted curation candidate:
  `ac03c18ce568b3d2d090104bbb41727aa22afe05`
- Accepted knowledge-write candidate:
  `f18c0346910de824ef20d074d88744c446946025`
- Accepted retrieval candidate:
  `dfaecb622515cc640802562485e715cc7da35cc8`
- Migration impact: none; migrations `000001` through `000004` remain exact,
  immutable inputs
- Dependency impact: none; only the admitted `pg@8.22.0`,
  `drizzle-orm@0.45.2`, and first-party code may be used
- Container impact: none; Compose, image selection, and Linux/container parity
  remain separately admitted gates

## Purpose

The accepted TM1 boundaries prove deterministic behavior over closed in-memory
repository snapshots. This contract freezes the smallest real PostgreSQL 18
increment that can prove those snapshots and transactions are truthful without
redefining the domain model.

The increment proves this transition:

```text
externally provisioned PostgreSQL 18
  + distinct migration and runtime credentials
  + immutable migrations 000001 through 000004
  -> actual PostgreSQL catalog and least-privilege runtime grants
  -> curation and knowledge command transactions
  -> complete current-knowledge read snapshot
  -> the already accepted pure planners and retrieval evaluator
  -> results equal to the fixed TM1 behavior
```

PostgreSQL is the source of business truth. It does not become a second
implementation of normalization, ranking, command identity, authorization, or
result semantics. The accepted pure boundaries continue to own those rules.

## Scope

Revision 1 includes:

- real PostgreSQL 18 execution of the first-party migration runner and tracked
  migrations `000001` through `000004`;
- catalog verification for the resulting `struinfo_meta` and `struinfo`
  schemas, 35 business tables, keys, checks, references, indexes, and deferrable
  current-pointer constraints;
- distinct migration/runtime identities and a closed runtime grant matrix;
- one PostgreSQL adapter for `ManualCurationRepositoryPort`;
- one PostgreSQL adapter for `ManualKnowledgeRepositoryPort`;
- one PostgreSQL adapter for
  `DeterministicKnowledgeSearchRepositoryPort`;
- real transaction, rollback, lock-order, idempotency, compare-and-set, and
  concurrent-command evidence;
- complete current-workspace retrieval loading followed by the accepted
  TypeScript evaluator; and
- an opt-in real-database test command that is separate from the existing
  non-container `verify` command.

The following remain outside revision 1:

- a source-evidence capture repository, Blob/database coordination, or real
  source import; PostgreSQL tests may seed only synthetic prerequisite Evidence
  rows through their separately supplied test-admin credential;
- workspace creation, account management, authentication, HTTP, WebSocket,
  browser, or frontend behavior;
- SQL query pushdown for matching, Unicode normalization, ranking, reasons, or
  pagination;
- aliases, classification-aware search, time filtering, recursive provenance,
  multi-hop relations, saved views, collections, trees, or search projections;
- `pg_trgm`, tokenization, pgvector, embeddings, AI, RAG, or natural-language
  synthesis;
- cross-request or cross-page consistent snapshots;
- event delivery, pg-boss work, scheduler behavior, or external integrations;
- Compose, Dockerfiles, image digests, Linux parity, production resource
  limits, backup/restore, release, or distribution; and
- performance acceptance beyond bounded completion of the fixed synthetic
  matrix.

No deferred capability may be represented as passed by this gate.

## Fixed migration identities

The runner reads the tracked files and records their exact lowercase SHA-256
values:

| Version | File                                       | SHA-256                                                            |
| ------- | ------------------------------------------ | ------------------------------------------------------------------ |
| 000001  | `000001_create_application_schema.sql`     | `99bc5217c7a678062777cecf09b13552363268add559ab759705035b358f62b5` |
| 000002  | `000002_create_source_evidence_schema.sql` | `aecfe896765b8d209080afc5c9f7466dab57ed8b7a19f8b8d44a575429628964` |
| 000003  | `000003_create_manual_curation_schema.sql` | `60c94270ef3c9de019593a8a54861c697c16189f6e65d8759553028aafba0eb1` |
| 000004  | `000004_create_manual_knowledge_core.sql`  | `2261d1d3d638139aea23abbc6c67aa6dceb60e8c52317a9a787b2450ea5e4f8f` |

TM2 must use the first-party runner rather than applying the four files through
another migration package or a test-only SQL concatenation. A second invocation
against the same database is an exact no-op. Two concurrent invocations
serialize on the accepted `(1398035029, 1296648018)` advisory lock and produce
one linear ledger without duplicate application.

Real PostgreSQL tests also use the runner's injected filesystem boundary with a
synthetic, in-memory failing migration to prove that its DDL and ledger insert
roll back together. They do not create, edit, or copy a tracked migration.

The actual catalog must agree with the existing independent TM1 semantic maps.
Catalog tests query `pg_catalog` and `information_schema`; they do not treat a
schema dump, migration hash, or product-owned expected map as a substitute for
semantic checks. PostgreSQL must accept all four migrations without warning
suppression or compatibility rewriting.

## External test environment

Real-database tests are explicitly opt-in and consume exactly these test-only
environment variables:

```text
STRUIINFO_TM2_ADMIN_DATABASE_URL
STRUIINFO_TM2_MIGRATION_DATABASE_URL
STRUIINFO_TM2_RUNTIME_DATABASE_URL
```

The admin URL is confined to Test-owned environment/catalog/grant/seed setup.
The migration URL is passed to the existing migration process as
`STRUIINFO_MIGRATION_DATABASE_URL`. The runtime URL is used only by the runtime
adapter test composition. Product modules do not read any TM2 variable.

The operator supplies one disposable UTF-8 database and three existing login
roles. The fixed test identities are `struinfo_tm2_admin`,
`struinfo_tm2_migrator`, and `struinfo_tm2_runtime`; production role names
remain operator-selected. The admin role is a disposable-fixture superuser able
to inspect the catalog, apply grants, and seed synthetic prerequisites; it
never enters an application process.

Before any `pg` client or pool exists, the production PostgreSQL platform
decoder maps the migration/runtime secret URL to an owned explicit connection
configuration. Test owns a separate implementation of the same frozen grammar
for environment admission and the admin connection; it must not import the
product decoder or its expected values. An accepted TM2 URL:

- uses the exact `postgres:` or `postgresql:` scheme and a local TCP authority
  hostname that WHATWG URL normalization renders as `127.0.0.1`, `[::1]`, or
  `localhost`;
- is byte-for-byte equal to its trimmed form, is a Unicode-scalar sequence, and
  contains no raw ASCII control, space, or DEL character; such bytes must be
  percent-encoded inside an allowed component;
- has one authority username whose decoded value is the fixed role for that
  variable;
- has an explicit, non-empty serialized authority password component whose
  decoded value is also non-empty and is treated only as an opaque secret;
- has an absent port or one decimal port in `1..65535`, with absence normalized
  to `5432`;
- has exactly one non-empty percent-decoded database path segment whose decoded
  value contains no slash, backslash, NUL, or invalid Unicode;
- contains no query string or fragment; this rejects `host`, `hostaddr`, `port`,
  `user`, `database`, `dbname`, `options`, `service`, SSL, or any other
  parameter override; and
- is not a Unix-socket, multi-host, service-file, or keyword/value connection
  form.

The serialized username, password, and sole database path segment returned by
the WHATWG URL parser are decoded independently and exactly once with strict
UTF-8 percent-decoding equivalent to `decodeURIComponent`. A literal `+`
remains `+`; `%2B` becomes `+`; `%40` becomes `@`; and `%2525` becomes `%25`,
not `%`. Form-urlencoding, a second decode, case conversion, and Unicode
normalization are forbidden. A malformed percent escape, invalid UTF-8, decoded
NUL, lone surrogate, or other non-Unicode-scalar result is rejected before any
`pg` client or pool exists. These rules apply equally to the product decoder and
the independent Test-owned decoder. The fixed synthetic password vector
`synthetic%40secret` therefore projects to `synthetic@secret`.

The original URL is never passed to `pg` as a string or `connectionString`.
The decoder projects only `host`, `port`, `database`, `user`, `password`,
`ssl: false`, the role-specific non-secret `application_name`
`struinfo-tm2-admin`, `struinfo-tm2-migrator`, or `struinfo-tm2-runtime`, and
the exact startup option `-c role=none -c search_path=pg_catalog` into an owned
null-prototype configuration. `password` is an own data property containing the
exact decoded non-empty string; it must remain the same non-null string in the
`pg@8.22.0` connection parameters. No unknown field survives the projection.
The formal TM2 child processes receive a Test-owned sanitized environment with
no variable whose case-insensitive name begins with `PG`; they never inherit
libpq or node-postgres identity, session, password, SSL, or service defaults.

Formal Test proves the ambient-password boundary without reading or modifying a
real user profile. It starts the product in Test-owned isolated home and
application-data roots containing a matching, deliberately wrong synthetic
`.pgpass`/`pgpass.conf` entry. The explicit URL password must remain unchanged,
and changing or removing that poison entry must not change the projected
configuration or admitted connection result. Missing-password, explicit-empty,
decoded-empty, malformed-percent, invalid-UTF-8, and decoded-NUL vectors are
rejected before connection. A password function, `PGPASSFILE`, default profile
lookup, or any other fallback that can replace the explicit password is
forbidden.

TLS and a broader production connection grammar remain part of the later
deployment gate rather than an implicit behavior of this local parity gate.

All three decoded configurations have the same normalized hostname, effective
port, decoded database name, and transport settings; only the fixed username
and opaque password may differ. After connecting, every client queries
`session_user`, `current_user`, `current_setting('role')`,
`current_database()`, `inet_server_addr()`, and `inet_server_port()`. Admission
requires:

- `session_user = current_user =` the fixed role for that variable;
- `current_setting('role') = 'none'`;
- `current_database()` equals the decoded database name; and
- all three non-null server-address/server-port pairs are identical. A NAT or
  port-forward boundary means the server-side port need not equal the URL port.

Comparing only the URL authority or only `current_user` is forbidden. Tests
also require:

- all three fixed identities have `LOGIN`;
- migration and runtime have no direct role-membership row as a member in
  `pg_auth_members`; any row fails regardless of its `inherit_option`,
  `set_option`, or `admin_option`, so their recursive membership closure is
  empty;
- migration and runtime are not the database owner;
- runtime owns no non-temporary schema or project object;
- `server_version_num >= 180000 AND server_version_num < 190000`;
- `server_encoding = 'UTF8'`;
- `standard_conforming_strings = on`;
- no real or personal data in the database;
- neither `struinfo` nor `struinfo_meta` exists before the formal run's first
  migration invocation;
- `struinfo_tm2_admin` is superuser only for the disposable fixture;
- a migration role capable of owning the two project schemas and their objects;
- migration and runtime roles are not superusers and have no create-role,
  create-database, replication, or bypass-RLS attribute;
- no credential or connection URL in source, fixtures, logs, snapshots,
  errors, manifests, or test reports.

The test suite fails visibly when any URL is absent, malformed, points to an
unsupported server, resolves to the wrong or same role, or cannot satisfy the
required grant boundary. It never silently skips, substitutes an embedded
database, falls back to `DATABASE_URL`, or downloads/starts infrastructure.

Tests use unique synthetic workspace and command identities and do not delete,
drop, or reset an operator-supplied database. Initial migration/catalog
acceptance therefore runs against a newly provisioned disposable database.
Disposal remains an explicit operator action outside product code.

The root command authorized by this contract is:

```text
corepack pnpm run test:postgres
```

It is not added to `corepack pnpm run verify` until a later container/CI gate
provides the required service deterministically. Formal TM2 runs both commands
and reports them separately. Missing infrastructure is `NOT_READY`, not PASS,
FAIL, or SKIP.

## Role and grant boundary

Roles are provisioned outside application migrations. No tracked migration
creates a role, password, grant, default privilege, or policy.

Before the first migration invocation, a Test-owned setup module uses only the
test-admin connection to revoke `CONNECT`, `CREATE`, and `TEMPORARY` on the
disposable database from `PUBLIC`, grant `CONNECT` to all three fixed roles,
and grant database `CREATE` only to the migration role. It also revokes `CREATE`
on the initially empty `public` schema from `PUBLIC`, migration, and runtime.
Migration and runtime must have no effective database `TEMPORARY` privilege;
runtime must have no effective `CREATE` on any non-temporary schema. After the
first-party runner succeeds, the same Test-owned boundary applies the exact
schema/table grant matrix below and inserts synthetic Evidence prerequisites.
The setup contains no password, URL, production role name, role creation,
schema creation, or real business value, and it is excluded from the
application artifact. Production grant automation remains a later operator
deliverable; this contract freezes its required semantics, not a deployment
script. The migration credential remains confined to the first-party migration
runner.

The migration role owns `struinfo_meta`, `struinfo`, their tables, constraints,
and indexes. It is used only by the migration command; synthetic fixture setup
uses the test-admin connection. Ordinary API, scheduler, worker, and combined
roles never receive its URL.

The runtime role has:

- `USAGE` on schema `struinfo`;
- `SELECT` on all 35 current `struinfo` business tables;
- column-level `INSERT` on every column declared by `000003`/`000004` for their
  11 curation and 13 knowledge tables except each table's database-generated
  `created_at` column; no other insert column is granted;
- column-level `UPDATE` only for:
  - `curation_target.current_version`;
  - `vocabulary_term.current_revision` and `current_term_revision_id`;
  - `classification_assignment.current_revision` and
    `current_assignment_revision_id`;
  - `intake_decision.current_revision` and `current_decision_revision_id`;
  - `assessment.current_revision` and `current_assessment_revision_id`;
  - `knowledge_item.current_revision` and `current_revision_id`; and
  - `knowledge_relation.current_revision` and `current_revision_id`.

It does not receive:

- any privilege on `struinfo_meta.schema_migrations`;
- `INSERT` on workspace or source-evidence tables under this contract;
- table-level `INSERT`/`UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, or
  `TRIGGER`;
- database `CREATE` or `TEMPORARY`, including `CREATE TEMP TABLE`;
- `CREATE` on either project schema;
- permission to create/alter/drop schemas, tables, roles, extensions, policies,
  functions, or indexes; or
- any direct or indirect role membership or ability to `SET ROLE` away from
  its authenticated identity.

Runtime grant tests attempt representative allowed and forbidden operations on
real PostgreSQL. They prove history, provenance, command, and event rows cannot
be updated or deleted, identity stable fields cannot be rewritten, and the
seven approved current-pointer/version updates remain possible only through
their named columns. They also prove persistent and temporary DDL fail under
the runtime identity. A permission error is expected evidence and must not be
weakened into an allowlist based only on application APIs.

## Production adapter boundary

Production adapters live below the domain modules under a PostgreSQL platform
boundary. The accepted curation and knowledge modules continue to import no
PostgreSQL, Drizzle, environment, framework, filesystem, network, clock,
randomness, or AI implementation.

The adapters:

- receive an injected narrow pool/client boundary and never read connection
  URLs themselves;
- use one acquired client for each command or read transaction and always
  release it;
- fully qualify every project table with `struinfo` or `struinfo_meta`;
- use parameterized values only; no caller value selects an identifier, SQL
  fragment, sort expression, or lock clause;
- use the admitted Drizzle PostgreSQL adapter for typed runtime row mapping and
  simple statements, while reviewed parameterized SQL remains permitted for
  transaction control, `FOR UPDATE`, catalog checks, and closed multi-table
  reads; `drizzle-kit` and generated migration state remain forbidden;
- include `workspace_id = $n` or the equivalent typed predicate in every
  business read, insert scope, lock, and compare-and-set operation; a complete
  workspace load never becomes a complete-database load;
- return owned plain records and dense arrays with absent optional fields
  omitted rather than converted to `null`;
- map PostgreSQL UUIDs to lowercase canonical text and signed 32-bit revision
  values to JavaScript numbers only after range checks;
- never return `pg` row objects, mutable buffers, driver dates, errors, SQL,
  connection details, row counts, or catalog values through a domain port;
- do not log private labels, notes, titles, bodies, relation keys, evidence
  identities, query text, SQL parameters, or driver exceptions; and
- add no generic query method, history update/delete method, cross-workspace
  selector, transaction escape hatch, or JSON persistence path to a domain
  port.

Composition constructs exactly one runtime `pg.Pool` per process and supplies
the same owned pool boundary to database readiness/lifecycle and the three
adapters. Refactoring `RuntimeDatabase` to accept that shared boundary is
allowed; exposing the raw pool to a domain module is not. An adapter must not
create a pool per request, create a second runtime pool, or close the
application-owned pool.

### Write transaction envelope

Curation and knowledge commands use explicit PostgreSQL transactions at
`READ COMMITTED`. Both first derive the same versioned workspace lock key in
application code. Given an already validated canonical workspace UUID `W`:

1. encode the exact UTF-8 text
   `struinfo:workspace-write-lock:v1:${W}`;
2. compute its SHA-256 digest with the Node.js standard library;
3. interpret digest bytes 0 through 7 as an unsigned big-endian 64-bit integer
   `U`;
4. set `K = U - 2^64` when `U >= 2^63`, otherwise set `K = U`; and
5. pass the signed integer `K` to `pg` as its base-10 string representation,
   never through a JavaScript `number`.

The transaction then acquires the documented transaction-scoped advisory lock:

```sql
SELECT pg_advisory_xact_lock($1::bigint)
```

For the synthetic workspace `11111111-1111-4111-8111-111111111111`, the exact
lock-name digest is
`5a8f5bbb1115b7a070f4dbacc772b36b22141bd0900a271b1b3de14c4aac54f2`;
its first eight bytes are `5a8f5bbb1115b7a0` and `K` is
`6525535244086785952`. TM2 independently reproduces this known answer without
importing the product helper. A 64-bit hash collision may conservatively
serialize two workspaces but cannot allow two commands in one workspace to
escape serialization. The adapter then uses an ordinary workspace-scoped
`SELECT` to prove the workspace exists.

This freezes the exact lock protocol that the upstream contracts deferred to
TM2. It preserves their required workspace-first serialization without granting
the runtime role `UPDATE` on `struinfo.workspace` merely to obtain a row lock.
The deliberate workspace-level serialization is accepted for the single-user
first version; finer locking may be introduced only after equivalent
concurrency tests and measured need.

Every transaction:

1. begins on one acquired runtime client;
2. derives and acquires the versioned workspace advisory lock, then fails
   safely if the exact workspace row does not exist;
3. performs the command-key lookup before optimistic revision checks using a
   workspace-scoped ordinary `SELECT` under the advisory lock, never a locking
   clause on an immutable command or change-set table;
4. acquires any additional existing identity locks in the fixed order below;
5. loads and maps one closed snapshot accepted by the corresponding pure
   decoder/planner;
6. invokes the already accepted planner through the public repository executor;
7. persists its exact plan in the already accepted port order;
8. verifies every compare-and-set affects exactly one row;
9. commits before returning the committed result; and
10. rolls back on every thrown callback, query, mapping, constraint, permission,
    timeout, connection, or row-count failure.

No rejected pure result writes a row. No failed transaction returns an applied,
unchanged, or replayed receipt. The public executor continues to collapse
database failures to its accepted non-echoing persistence result.

For Curation, the command-key lookup is an ordinary `SELECT` from
`struinfo.curation_command`. For Knowledge, it is an ordinary `SELECT` from
`struinfo.knowledge_change_set`. Both include `workspace_id` and the exact
idempotency key. Neither statement uses `FOR UPDATE`, `FOR NO KEY UPDATE`,
`FOR SHARE`, or `FOR KEY SHARE`; immutable command, change-set, operation,
event, history, and provenance tables are never row-locked. The preceding
workspace advisory lock supplies serialization. This rule must not be
implemented by expanding runtime `UPDATE` grants.

### Curation adapter

After the workspace lock and ordinary command-key lookup, a term command uses
the complete current term hierarchy for that workspace. A target command locks
all referenced existing term identities in ascending canonical UUID order, then
loads the requested Evidence target, current curation target, current
assignments, decision, assessments, current term revisions, and any stored
command receipt needed by the accepted `ManualCurationRepositorySnapshot`.

The adapter reconstructs decision reason arrays in stored ordinal order and
omits absent descriptions/parents/notes. It never treats a missing Evidence
target, term, target, decision, assignment, or assessment as a partial row.
The workspace lock makes non-existent identities stable against all accepted
curation and knowledge writers for the duration of the command.

Current-pointer and target-version compare-and-set statements include
`workspace_id`, stable identity, and expected version/revision in the predicate.
Zero or multiple affected rows are persistence failures and roll back the whole
command.

### Knowledge-write adapter

After the workspace lock and ordinary command-key lookup, existing identities
are locked in this order, each group ascending by canonical UUID with duplicates
removed:

1. primary KnowledgeItem identities;
2. primary KnowledgeRelation identities;
3. referenced endpoint KnowledgeItem identities not already locked;
4. the eligible curation target and current decision when that authorization
   branch is used.

Historical item/relation revision and Fragment lookups use the same transaction
snapshot but do not widen caller-selected identity sets. The adapter returns
exactly one of the two accepted repository closures:

- stored-command closure containing only the matching change set, its complete
  ordered operation receipt, and its single committed event; or
- new-command closure containing exactly the requested existing curation,
  Fragment, item, relation, current-revision, and historical-revision rows.

An entirely absent requested identity contributes no row. An existing identity
must never be omitted. Complete provenance for every returned current or
historical revision is loaded from its typed input tables in declared ordinal
order. The adapter does not inherit provenance, synthesize an empty array for an
unread table, or collapse item and relation derivations into an untyped record.

Item/relation current-pointer compare-and-set predicates include workspace,
stable identity, and expected revision. Exactly one affected row is required.
All change-set, operation, revision, provenance, pointer, and single event
writes commit or roll back together.

### Deterministic retrieval adapter

The first real retrieval adapter favors proof over premature optimization. It
starts one `REPEATABLE READ READ ONLY` transaction and loads the complete current
workspace state required by the five-array snapshot:

1. every KnowledgeItem identity and its current pointer;
2. exactly each listed item's current KnowledgeRevision;
3. every direct Fragment citation/derivation for those current revisions,
   joined to the same-workspace Resource/Snapshot/Fragment identity;
4. every KnowledgeRelation identity whose two endpoint items are in the loaded
   workspace; and
5. exactly each listed relation's current KnowledgeRelationRevision.

Arrays are sorted by the tuples frozen in `C-SLICE-B-RETRIEVAL-r3`. The adapter
loads withdrawn and rejected current rows; visibility and filter semantics stay
in the pure evaluator. It performs no SQL normalization, case folding,
substring matching, semantic filtering, ranking, reason construction,
pagination, or locale-dependent ordering.

The read transaction commits or rolls back before the port returns its owned
snapshot. Multiple SQL statements in one port call must observe one PostgreSQL
snapshot. Consistency between separate page requests remains deferred because
the accepted cursor contains no database snapshot identity.

This complete-load implementation is acceptable for the fixed corpus and first
single-user validation. Query pushdown may replace it only after a later real
PostgreSQL parity suite proves identical matches, total count, result order,
reasons, truncation, cursor, and empty-page behavior.

## Error and resource behavior

Adapters classify no SQLSTATE as a caller-domain rejection. Constraint,
serialization, deadlock, permission, timeout, network, pool, mapping, and
unexpected row-count failures all roll back and reach the existing safe
`persistence_failed` or `repository_failed` result. Logs may contain a stable
first-party event code and operation name, but never raw driver text or private
values.

Clients are released exactly once on success and every reached failure path.
Rollback failure does not cause a success result. Pool shutdown remains owned by
the existing runtime lifecycle. Tests bound concurrency and failure scenarios;
they do not use an unbounded wait or a sleep as proof of lock order.

## TM2 parity and concurrency matrix

Independent Test owns a mandatory row ledger. At minimum it proves:

1. closed URL projection, exact one-pass credential decoding, a required
   explicit non-empty password, poison-`.pgpass` isolation, sanitized ambient
   environment, PostgreSQL 18 identity, exact session/current users, actual
   endpoint identity, UTF-8 configuration, distinct roles, secret
   non-disclosure, and fail-closed environment admission;
2. real application of all four exact migrations, exact ledger rows, repeat
   no-op behavior, advisory-lock serialization, and real rollback of a synthetic
   failing migration;
3. actual catalog agreement for the 35 business tables and every material
   key/check/reference/current-pointer/index/no-cascade invariant already frozen
   by TM1;
4. empty migration/runtime role-membership closures, database/schema/object
   ownership, database `CONNECT`/`CREATE`/`TEMPORARY`, every allowed runtime
   SELECT/INSERT/current-pointer operation, and every forbidden metadata,
   evidence-write, stable-column update, history update, delete, truncate,
   persistent or temporary DDL, role, and extension operation;
5. curation term create/revise/reparent/retire/reactivate, target version 0,
   mixed target changes, unchanged, replay, conflict, stale revision, missing
   Evidence target, reason order, and exact database rows;
6. knowledge manual-edit and eligible-target authorization, mixed item/relation
   writes, complete provenance, unchanged, replay, conflict, stale revision,
   missing identities, exact event/receipt rows, and final current pointers;
7. retrieval browse/text/source/state/one-hop relation filters, complete result
   reasons, stable ordering, UUID ties, total count, pagination, and zero/empty
   continuation results equal to fixed independent known answers;
8. adapter completeness for wholly absent versus existing requested identities,
   all current items/relations, and every typed direct Fragment input;
9. one-transaction rollback after an early insert, a failed compare-and-set,
   an injected callback failure, and a real constraint or permission failure;
10. concurrent equal same-key commands resolve to one commit plus replay;
11. concurrent different-payload same-key commands resolve to one accepted
    command plus one idempotency conflict;
12. concurrent same-expected-revision changes resolve to one applied command
    plus one stale result without a partial loser plan;
13. two concurrent term reparents that would jointly form a cycle serialize so
    the second effective command is rejected and no committed cycle exists;
14. a multi-query retrieval load observes one repeatable-read snapshot while a
    concurrent writer commits;
15. workspace isolation with reused stable IDs in two synthetic workspaces;
16. connection acquisition, begin, commit, rollback, and release behavior on
    every injected and real failure path;
17. production import direction, parameterized SQL, no generic port escape,
    no new dependency/license delta, and no test helper in the application
    artifact; and
18. privacy, credentials, tracked-fixture, formatting, lint, strict typecheck,
    full unit/integration build, application-artifact, and opt-in PostgreSQL test
    gates.

The parity suite compares public command/search results and independently read
database state against Test-owned synthetic expected values. Importing product
SQL constants, row mappers, snapshot builders, normalization, digest, planner,
or ranking helpers into the independent oracle is forbidden.

## Acceptance and verdict rules

Contract review must close all material ambiguity before Backend or Test
implementation starts. Maintenance and Test Prep independently freeze:

- exact environment admission and role setup assumptions;
- the catalog/grant semantic map;
- adapter snapshot query closures and row mappings;
- lock and transaction ordering;
- concurrency barriers and expected outcomes;
- mandatory TM2 IDs and independent known answers; and
- the exact boundary between real PostgreSQL PASS and deferred container,
  query-pushdown, performance, transport, and AI claims.

Formal TM2 may report:

- `PASS` only when the fixed candidate passes the full non-database quality gate
  and every mandatory real-PostgreSQL row against one admitted PostgreSQL 18
  database;
- `FAIL` when the admitted candidate or database behavior violates the frozen
  contract; or
- `NOT_READY` when the three test URLs or admitted PostgreSQL 18 environment are
  unavailable or cannot be proven without changing the candidate.

Missing infrastructure is never converted to skipped tests or a reduced PASS.
Windows host execution proves the Windows development path only. Linux,
container-image, Compose, and cloud parity require their own later evidence.

## Personal-data and artifact boundary

All database rows used by tracked tests are synthetic and value-free. Tests do
not read `.agents/stage-0/**`, external data roots, real weekly content, personal
classification terms, notes, knowledge, preferences, credentials, exports, or
backups. Database URLs, passwords, and real production role names are not
persisted in snapshots, reports, manifests, or artifacts. The three fixed
synthetic TM2 role names are non-secret test protocol values.

Production adapters enter the candidate application artifact. PostgreSQL test
harnesses, grant fixtures, independent SQL/catalog oracles, database URLs, and
generated reports do not. No migration, role, grant, seed, or default contains a
personal or source-derived value.

## References

- [Product requirements](product-requirements.md)
- [Roadmap](roadmap.md)
- [Development outline](development-outline.md)
- [Knowledge core architecture](knowledge-core-architecture.md)
- [Database migrations and roles](database-migrations-and-roles.md)
- [Source evidence storage contract](source-evidence-storage-contract.md)
- [Manual curation contract](manual-curation-contract.md)
- [Manual knowledge core contract](manual-knowledge-core-contract.md)
- [Deterministic knowledge retrieval contract](deterministic-knowledge-retrieval-contract.md)
- [Runtime configuration](runtime-configuration.md)
- [Application artifact boundary](application-artifact-boundary.md)
- [ADR 0002](adr/0002-postgresql-persistence-and-durable-work.md)
- [ADR 0003](adr/0003-m0-s-engineering-foundation.md)
- [ADR 0005](adr/0005-versioned-knowledge-core-and-ai-optional-operations.md)
