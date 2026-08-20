# Database Migrations and Roles

- Status: First-party runner and seven forward migrations implemented; the M1C
  `000001`–`000006` PostgreSQL 18 functional smoke passed
- Contract: `C-M0-S-r2`
- Database direction: PostgreSQL 18 with separate migration and runtime
  credentials

This document defines the operator and code boundary for forward migrations. It
does not contain role-creation SQL or passwords. The first-party runner and first
project-owned migrations are implemented. Formal runtime-grant and deployment
certification remains pending the separately admitted infrastructure gate.

## Role boundary

| Credential class | Configuration                      | Allowed purpose                                                                          | Explicitly forbidden                                                           |
| ---------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| migration        | `STRUIINFO_MIGRATION_DATABASE_URL` | Run reviewed forward DDL and update the migration ledger before ordinary roles start     | Falling back to `DATABASE_URL`; logging the value; serving application traffic |
| runtime          | `DATABASE_URL`                     | API, Scheduler, and Worker DML, sequence, and schema access needed by ordinary operation | Creating roles or schemas; running migration files; issuing application DDL    |

The migration entrypoint must require
`STRUIINFO_MIGRATION_DATABASE_URL`. Absence or invalidity is a visible nonzero
startup failure. It must never fall back to `DATABASE_URL`, and neither value may
appear in logs, errors, health responses, command output, or test snapshots.

API, Scheduler, Worker, and local combined entrypoints must not import or invoke
the migration runner. Application startup does not create roles, schemas,
extensions, or tables. Administrators provision credentials and run migrations
as separate operations.

## First-party runner contract

The separately executed runner uses these tracked paths:

```text
apps/server/src/entrypoints/migrate.ts
apps/server/src/platform/database/migrations/**
apps/server/migrations/000001_create_application_schema.sql
apps/server/migrations/000002_create_source_evidence_schema.sql
apps/server/migrations/000003_create_manual_curation_schema.sql
apps/server/migrations/000004_create_manual_knowledge_core.sql
apps/server/migrations/000005_create_evidence_capture_command.sql
apps/server/migrations/000006_add_private_document_visibility.sql
apps/server/migrations/000007_add_other_knowledge_kind.sql
```

The runner is first-party code over the already admitted `pg@8.22.0` driver.
`drizzle-orm@0.45.2` remains the runtime typed SQL mapper. `drizzle-kit` and any
replacement migration package are not admitted.

The implementation:

1. resolves exactly one `apps/server/migrations` root and discovers only regular,
   readable UTF-8 files named by six decimal digits, an underscore, a lowercase
   snake-case description, and `.sql`;
2. reject malformed names, duplicate versions, unreadable files, and an empty or
   ambiguous discovery root before applying anything;
3. order unapplied files lexically by the fixed-width version;
4. serializes concurrent runners on the owned connection with the two-key
   PostgreSQL advisory-lock identity `(1398035029, 1296648018)`, whose symbolic
   identity is ASCII `STRU` / `MIGR`;
5. store the exact SHA-256 of each committed file's bytes in
   `struinfo_meta.schema_migrations` and fail visibly if an applied file changes;
6. execute one unapplied migration and its ledger insert atomically in one
   transaction;
7. stop on the first failure, roll back that transaction, and leave later files
   unapplied;
8. make repeated invocation a no-op for exact already-applied versions;
9. releases that lock on the same connection and closes the connection on success
   and every reached failure path; and
10. emits newline-delimited JSON containing only `event`, `version`, `name`,
    `checksum`, and `outcome` when those fields apply. It never emits SQL contents,
    credentials, environment snapshots, raw driver errors, or stacks.

The runner bootstraps only `struinfo_meta` and its
`struinfo_meta.schema_migrations` ledger while holding the advisory lock. The
ledger columns are `version character(6)` as the primary key, `name text`,
`checksum character(64)`, and an `applied_at timestamp with time zone` defaulting
to the database current timestamp. Reconciliation requires every ledger version,
name, and lowercase SHA-256 checksum to match an exact committed file and rejects
missing applied files or non-linear historical gaps.

The first forward file creates only the project-owned `struinfo` application
schema. It does not create product tables, roles, grants, extensions, sequences,
or pg-boss/vendor objects.

The first product-table migration is reserved as
`000002_create_source_evidence_schema.sql` and must implement
[`C-SLICE-A-EVIDENCE-r2`](source-evidence-storage-contract.md). Revision 2 leaves
the migration bytes and database uniqueness model unchanged: portable
`source_key` and machine-path isolation are enforced by the closed application
boundary, not new DDL. Until a real PostgreSQL fixture passes its named
infrastructure gate, the migration remains reviewed static schema evidence
rather than executed-database evidence.

The next product-table migration is reserved as
`000003_create_manual_curation_schema.sql` and must implement
[`C-SLICE-A-CURATION-r3`](manual-curation-contract.md). It adds only the A0
manual evidence-target vocabulary, classification, intake-decision, assessment,
and command-history tables fixed by that contract. It does not seed personal
values or add formal knowledge, policy, AI, search, transport, grant, or
background-work tables. Until the same real PostgreSQL gate is admitted, its
DDL result is likewise static schema evidence only.

The next product-table migration is reserved as
`000004_create_manual_knowledge_core.sql` and is governed by the frozen
[`C-SLICE-B-KNOWLEDGE-r3`](manual-knowledge-core-contract.md) contract.
Its fixed implementation candidate
`f18c0346910de824ef20d074d88744c446946025` passed formal TM1. The migration is
limited to the A0 manual change-set, versioned item/relation, typed provenance,
and payload-free committed-change event boundary declared there; it does not
authorize search projections, aliases, collections, AI, transport, event
delivery/consumers, roles, grants, background work, personal seeds, or by itself
make a real PostgreSQL claim.

`000005_create_evidence_capture_command.sql` is a narrow M1C forward addition.
It creates only `struinfo.evidence_capture_command`, keyed by workspace and
command idempotency key, and stores the canonical request SHA-256 needed to
distinguish equal replay from changed same-key input after restart. It contains
no source body, personal value, seed, role, grant, trigger, task, or mutable
receipt payload, and does not modify accepted migration bytes `000001`–`000004`.

`000006_add_private_document_visibility.sql` is the privacy-document increment.
It adds one immutable visibility fact to each relevant layer:

- `struinfo.resource.is_private` identifies an explicitly private source;
- `struinfo.knowledge_revision.is_private` records the propagated privacy of an
  immutable knowledge revision; and
- `struinfo.knowledge_relation_revision.is_private` records the propagated
  privacy of an immutable relation revision.

All three columns are `boolean NOT NULL DEFAULT false`, so existing workspaces
remain public by default. The migration adds no table, role, grant, seed,
personal value, body text, trigger, policy engine, or encryption claim. Full
private-document raw and normalized bytes continue to use the external Blob
store already referenced by Evidence rows. Runtime roles need INSERT authority
for the two new revision columns and the Resource column through the existing
typed repository paths; ordinary runtime still receives no migration or DDL
authority.

`000007_add_other_knowledge_kind.sql` is the owner-facing taxonomy compatibility
increment. It replaces only `knowledge_revision_kind_ck` so future revisions may
store `other`; all previously accepted values remain valid and no existing row is
rewritten. Entity, framework and work are merged only in presentation and search
filtering, not by destructive data migration. The runtime DML and role boundary do
not change.

The ledger itself is infrastructure metadata. Business modules and ordinary
runtime roles do not write it.

The application runtime does write the separate business command ledger in
`struinfo.evidence_capture_command`. An M1C runtime therefore needs the DML
privileges required by the Evidence, Curation, and Knowledge repository ports;
it still must not receive migration-ledger or DDL authority. The 2026-08-16
functional smoke used an explicitly disposable synthetic role with DML grants.
Production least-privilege grant automation remains a later operator deliverable
and the broad smoke grant must not be copied as a production recipe.

## Operator sequence

1. Back up the PostgreSQL truth and Blob set according to the current recovery
   procedure before a risky schema change.
2. Stop or drain application roles when the reviewed migration requires it.
3. Supply the migration credential only to `pnpm db:migrate`.
4. Inspect the non-secret version/checksum result and stop on any mismatch or
   failure.
5. Revoke the migration credential from the ordinary process environment.
6. Start API, Scheduler, and Worker with the runtime credential.
7. Confirm readiness only after the bounded runtime database check succeeds.

No automation may continue to application startup after a failed or uncertain
migration result.

## Rollback and recovery

Committed migrations are immutable and forward-only. Do not edit an applied
file or introduce mutable down migrations. Reversal uses one of:

- a separately reviewed forward compensation migration; or
- restoration of the consistent PostgreSQL-plus-Blob backup when compensation
  cannot preserve the required data contract.

A runner interruption must leave either the migration and ledger row committed
together or neither committed. An advisory-lock loss, checksum mismatch,
serialization failure, or unavailable database is a visible nonzero failure and
requires operator review before retry.

## Verification gates

Deterministic tests now cover credentials, discovery and exact-byte hashing,
stable lock use, ledger reconciliation, atomic transaction ordering, rollback and
first-error stop, repeat no-op behavior, resource cleanup, safe output, and the
ordinary runtime no-DDL/no-import boundary through injected filesystem,
PostgreSQL, logger, and process boundaries.

These synthetic tests are not real PostgreSQL coverage. Exact PostgreSQL 18 and
pgvector execution, runtime grants, real advisory-lock concurrency, migration
interruption, and Windows/Linux database parity remain pending
`M0-S-CONTAINER-MAINT-001` or another separately admitted infrastructure fixture.

Separately from that formal certification, the M1C functional smoke has now run
the first-party runner against PostgreSQL 18, applied `000001`–`000005`, observed
a second-run no-op, and completed two isolated workspace Evidence imports. This
does not claim production grant, container, Linux, or full TM2 parity.
An additional disposable PostgreSQL 18 run applied `000001`–`000006` from an
empty database and exercised private/public import, external raw and normalized
Blob reads, private item and endpoint-relation propagation, default exclusion,
explicit private retrieval, and separate full-document return. The functional
run used synthetic smoke privileges and therefore does not claim the formal
least-privilege runtime-grant, Linux, container-release, or full TM2 gate.

Draft [`C-SLICE-B-POSTGRES-r3`](postgresql-knowledge-adapter-contract.md)
defines the narrower non-container TM2 candidate for externally provisioned
PostgreSQL 18: its historical candidate covered migrations `000001` through
`000004`, curation/knowledge
transactions, complete current-knowledge reads, least-privilege runtime grants,
and parity with the accepted pure boundaries. Its implementation remains
blocked until independent Maintenance and Test contract review. Compose,
container images, pgvector, Linux parity, and production resource claims remain
outside that draft.
