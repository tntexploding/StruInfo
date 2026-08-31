# Database Migrations and Roles

- Status: First-party runner and twenty-nine forward migrations implemented;
  M1M queue preparation and operator-managed runtime grant boundary available
- Contract: `C-M0-S-r2`
- Database direction: PostgreSQL 18 with separate migration and runtime
  credentials

This document defines the operator and code boundary for forward migrations. It
does not contain role-creation SQL or passwords. The first-party runner and first
project-owned migrations are implemented. The checked-in runtime-grant script is
an executable operator baseline; formal target-environment and deployment
certification remains pending the unified release review.

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
apps/server/migrations/000008_create_information_entry_core.sql
apps/server/migrations/000009_create_information_document_tags.sql
apps/server/migrations/000010_create_information_entry_associations.sql
apps/server/migrations/000011_collapse_information_entry_current_state.sql
apps/server/migrations/000012_add_entry_knowledge_graph_edges.sql
apps/server/migrations/000013_create_processing_runs_and_proposals.sql
apps/server/migrations/000014_create_ai_tag_proposals.sql
apps/server/migrations/000015_create_ai_association_proposals.sql
apps/server/migrations/000016_create_ai_split_proposals.sql
apps/server/migrations/000017_add_information_entry_fragment_ranges.sql
apps/server/migrations/000018_create_entry_automation_execution.sql
apps/server/migrations/000019_create_entry_automation_work_queue.sql
apps/server/migrations/000020_create_entry_automation_actions.sql
apps/server/migrations/000021_add_information_entry_structure_lifecycle.sql
apps/server/migrations/000022_create_information_document_working_copies.sql
apps/server/migrations/000023_add_remote_document_resource_kind.sql
apps/server/migrations/000024_add_information_entry_graph_semantics.sql
apps/server/migrations/000025_create_information_entry_search_index.sql
apps/server/migrations/000026_create_bulk_ingestion_batches.sql
apps/server/migrations/000027_create_bulk_ingestion_enrichment.sql
apps/server/migrations/000028_create_bulk_ingestion_adjudications.sql
apps/server/migrations/000029_add_bulk_ingestion_classification_exception.sql
apps/server/migrations/000030_refine_bulk_ingestion_classification_exceptions.sql
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

`000008_create_information_entry_core.sql` is the additive Entry-first document
processing increment accepted by ADR 0007. It adds stable Entry identities,
append-only revisions, exact Fragment inputs, independent content/type/domain
keywords and future split/merge lineage. Entry bodies remain bound to one
Snapshot and privacy is stored on every revision so ordinary reads can exclude
private content before matching. The migration does not seed a user's documents,
keywords or preferences, does not rewrite M1C Knowledge rows, and does not add a
new database extension or AI dependency. The ordinary runtime needs the typed
SELECT/INSERT and current-pointer UPDATE authority used by the Entry repository;
it still must not receive migration-ledger, generic DDL, historical UPDATE or
DELETE authority.

`000009_create_information_document_tags.sql` adds only the versioned aggregate
view owned by M1D-2: one tag-set identity per canonical Snapshot, immutable tag
revisions, and ordered tag values carrying full-text occurrence and current-Entry
coverage counts. A manual edit is a separate revision kind; it does not rewrite
Entry keywords or source evidence. The migration stores no document bytes,
personal vocabulary, preference, seed, AI output, JSON payload, trigger, role, or
grant. Ordinary runtime access remains limited to typed SELECT/INSERT and the
single current-pointer UPDATE used by the Document-tag repository.

`000010_create_information_entry_associations.sql` adds M1D-3 selective
association state without changing Entry or formal Knowledge identities. The
rebuildable projection stores an ordered Entry pair, both endpoint revision
identities, separate content/type/domain scores, the versioned policy identity,
candidate basis and rank. Independent override identities and append-only
override revisions record enhance, weaken, block and restore decisions; a
projection rebuild never deletes or rewrites that manual history. Ordinary
runtime access is limited to typed SELECT, scoped projection replacement,
override-revision INSERT and the override current-pointer UPDATE. The migration
stores no source bytes, personal vocabulary, seed, AI output, vector, extension,
JSON payload, trigger, role or grant, and it does not create a formal
`KnowledgeRelation`.

`000011_collapse_information_entry_current_state.sql` implements ADR 0008. It
copies each pointer-selected Entry, Document-tag set and association override
into its stable current row, removes noncurrent ordinary-edit children, rewires
their current inputs/tags to stable identities and drops the three obsolete
ordinary revision tables. It retains the existing revision number and revision
UUID as optimistic-concurrency tokens. Immutable Snapshot/Fragment evidence,
Curation command records and formal KnowledgeItem/KnowledgeRelation revisions
are untouched. Association projections keep endpoint version tokens so a stale
projection remains detectable and rebuildable. The migration adds no seed,
personal value, AI output, dependency, role, grant or database extension.

`000012_add_entry_knowledge_graph_edges.sql` implements the minimal M1E-2 edge metadata without a new graph store. It adds nullable, closed-enum `graph_origin` and `graph_direction` plus a bounded `graph_label` to the current association override. All three fields are either absent together for legacy automatic similarity behavior or present together for a user-created/user-edited relation. The typed repository remains the only product writer; operator-managed least-privilege roles need the corresponding column INSERT/UPDATE rights but no DDL, generic SQL, new dependency, seed or source data.

`000013` through `000016` add the closed ProcessingRun/proposal envelope and the typed tags, association and split proposal payloads accepted by ADR 0012 through ADR 0015. They store no Provider secret, prompt transcript, raw response or arbitrary JSON; ordinary writes remain behind the typed Processing repositories.

`000017_add_information_entry_fragment_ranges.sql` stores optional one-to-one half-open Unicode scalar ranges for manual Entry inputs. Missing rows continue to mean the complete immutable Fragment.

`000018` through `000020` add typed automation-run claims, the independent owner work queue and explicitly authorized deterministic action state. These are audit/control facts, not copied Entry bodies or generic workflow payloads.

`000021_add_information_entry_structure_lifecycle.sql` adds the current-structure fact used by preview-first Entry restructuring. Retired Entry rows and lineage remain intact while ordinary reads select the unique current structure.

`000022_create_information_document_working_copies.sql` adds one current pre-split working-copy row per source Snapshot. Editing rows contain one bounded UTF-8 draft; confirmation clears the draft and records the immutable derived Resource/Snapshot. The source Evidence foreign key remains authoritative, no original row is updated, and runtime access is limited to the typed SELECT/INSERT/UPDATE/DELETE operations used by this repository.

`000023_add_remote_document_resource_kind.sql` extends only the closed Resource
kind check with `remote_document`. It lets RSS/API/Web/connector capture reuse
the existing Evidence and Blob boundary without adding remote bytes, secrets,
subscription state, Provider payloads or generic crawler configuration to the
database.

`000024_add_information_entry_graph_semantics.sql` extends current graph
overrides with the closed semantic kind, verification status and bounded owner
note used by M1J. Existing graph overrides are deterministically upgraded;
automatic similarity projections remain rebuildable calculations rather than
verified factual assertions. Runtime access stays behind the typed graph
override repository.

`000025_create_information_entry_search_index.sql` adds two disposable derived
tables for M1K: one current Entry-bound search projection with an optional
standard `double precision[]` embedding, and one title/body/tag term-posting
table. Both are fully rebuildable from current public Entries and are therefore
excluded from personal-data packages. The migration adds no `pgvector` or other
extension, source text, Provider secret, prompt, personal seed, role or grant;
operators grant only the typed SELECT and scoped replacement operations used by
the search-index repository.

`000026_create_bulk_ingestion_batches.sql` adds two typed M2-P0A control tables:
one current batch header and one ordered Snapshot item table. They store only
workspace-scoped identities, digests, privacy facts, counts, execution state,
attempts and stable error codes. Each execution attempt references the existing
`processing_run`; each item references an immutable Snapshot. They do not store
source text, Entry bodies, Provider payloads, prompts, credentials or arbitrary
JSON. Runtime grants permit the narrow insert/update/read state machine but do
not broaden schema or migration authority.

`000027_create_bulk_ingestion_enrichment.sql` adds two typed M2-P0B control
tables: one current enrichment item per successful P0A batch item and one
bounded exception row per Entry revision that deterministic rules cannot settle.
They store only identities, rule digests, counters, state and stable exception
codes. They do not copy Entry bodies, source text, Provider payloads, prompts,
credentials or arbitrary JSON. Runtime grants permit the narrow read/insert/update
state machine; deterministic tag revisions and incremental Association replacement
continue through their existing typed repositories. The exception row references
the active stable `information_entry` identity; its frozen revision number and
revision ID are comparison facts used to derive current/stale state, not a foreign
key to the retired revision table removed by `000011`. The disposable M2-P0D
PostgreSQL run verifies this migration against the complete current migration chain.

`000028_create_bulk_ingestion_adjudications.sql` adds one typed M2-P0C current
decision table keyed by the existing exception identity. It stores only the
closed pending/accepted/manual-review/deferred state, an optimistic version and
timestamps. Current/stale Entry revision facts remain derived from the referenced
exception and current Entry row; the table does not copy Entry bodies, titles,
sources, Provider payloads, prompts, credentials or arbitrary JSON. Runtime
grants permit only the narrow read/insert/update state transition used by the
maintenance control plane.

`000029_add_bulk_ingestion_classification_exception.sql` changes only the
closed exception-code CHECK to admit `classification_incomplete`. It creates no
table and stores no source, tag, Provider or arbitrary payload. An explicit
M2-P1 refresh may delete stale exception and matching adjudication rows before
rebuilding them under the new rules; runtime DELETE remains limited to those two
processing tables and does not grant deletion of Entry or evidence rows.

`000030_refine_bulk_ingestion_classification_exceptions.sql` replaces only that
closed CHECK so new M2-P2 enrichment can distinguish `classification_no_signal`,
`classification_type_missing`, `classification_domain_missing` and
`classification_tied`. The legacy `classification_incomplete` value remains
valid for historical rows. The migration adds no table, column, payload or new
runtime privilege; the existing processing-table grants remain sufficient.

The ledger itself is infrastructure metadata. Business modules and ordinary
runtime roles do not write it.

The application runtime does write the separate business command ledger in
`struinfo.evidence_capture_command`. An M1C runtime therefore needs the DML
privileges required by the Evidence, Curation, and Knowledge repository ports;
it still must not receive migration-ledger or DDL authority. The 2026-08-16
functional smoke used an explicitly disposable synthetic role with DML grants.
M1M now supplies `deploy/postgresql/apply-runtime-grants.sql` as the reviewed
operator-managed baseline. It creates no role or password, revokes schema/database
creation and metadata access, and grants the typed table/queue DML needed by the
current runtime, including empty-workspace personal-data restore. Target PostgreSQL
18 execution and any environment-specific tightening still require deployment
review; the old broad smoke grant must not be copied as a production recipe.

## Operator sequence

1. Stop or drain application writes and run `pnpm maintenance -- backup` with
   the runtime credential.
2. Supply the migration credential only to `pnpm db:migrate` and inspect the
   non-secret version/checksum result.
3. With the same isolated migration credential, run `pnpm db:prepare-queue`.
4. As the database owner, apply
   `deploy/postgresql/apply-runtime-grants.sql`.
5. Revoke the migration credential from the ordinary process environment.
6. Run `pnpm maintenance -- preflight` with only the runtime credential.
7. Start API, Scheduler, and Worker with the runtime credential.
8. Confirm readiness only after the bounded runtime database check succeeds.

No automation may continue to application startup after a failed or uncertain
migration result.

Container equivalents and the clean-target restore procedure are documented in
[Production Operations](production-operations.md).

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

These synthetic tests are not real PostgreSQL coverage. Exact PostgreSQL 18,
runtime grants, real advisory-lock concurrency, migration
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
and parity with the accepted pure boundaries. That historical harness no longer
blocks current product development. Compose, container images, Linux parity and
production resource claims remain outside that draft.
