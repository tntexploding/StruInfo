# Database Migrations and Roles

- Status: M0-S operator contract; implementation pending Backend ownership
- Contract: `C-M0-S-r2`
- Database direction: PostgreSQL 18 with separate migration and runtime
  credentials

This document defines the operator and code boundary for forward migrations. It
does not contain migration SQL, role-creation SQL, passwords, or an implemented
runner. Real PostgreSQL execution remains pending the separately admitted
infrastructure gate.

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

The later Backend task owns these paths and the migration-sequence lock:

```text
apps/server/src/entrypoints/migrate.ts
apps/server/src/platform/database/migrations/**
apps/server/migrations/000001_<snake_case_name>.sql
```

The runner is first-party code over the already admitted `pg@8.22.0` driver.
`drizzle-orm@0.45.2` remains the runtime typed SQL mapper. `drizzle-kit` and any
replacement migration package are not admitted.

The implementation must:

1. discover only committed UTF-8 `.sql` files whose names begin with one unique,
   zero-padded version and a snake-case description;
2. reject malformed names, duplicate versions, unreadable files, and an empty or
   ambiguous discovery root before applying anything;
3. order unapplied files lexically by the fixed-width version;
4. serialize concurrent runners with one documented, project-stable PostgreSQL
   advisory-lock identity;
5. store the exact SHA-256 of each committed file's bytes in
   `struinfo_meta.schema_migrations` and fail visibly if an applied file changes;
6. execute one unapplied migration and its ledger insert atomically in one
   transaction;
7. stop on the first failure, roll back that transaction, and leave later files
   unapplied;
8. make repeated invocation a no-op for exact already-applied versions;
9. close the database connection and release owned resources on success or
   failure; and
10. expose only safe structured status, never SQL contents, credentials, or raw
    driver stacks.

The ledger itself is infrastructure metadata. Business modules and ordinary
runtime roles do not write it.

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

The Backend and Test owners must add deterministic tests for ordering, malformed
and duplicate versions, lock serialization, checksum drift, transaction rollback,
repeat invocation, startup cleanup, secret redaction, and proof that runtime
entrypoints never issue DDL.

Those tests may first use injected PostgreSQL boundaries. They must not be
described as real PostgreSQL coverage. Exact PostgreSQL 18 and pgvector execution,
runtime grants, migration interruption, and Windows/Linux parity remain pending
`M0-S-CONTAINER-MAINT-001` or another separately admitted infrastructure fixture.
