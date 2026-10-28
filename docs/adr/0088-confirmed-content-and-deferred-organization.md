# ADR 0088: Confirmed content and deferred organization

- Status: Accepted by owner; P1 implementation
- Date: 2026-10-23
- Plan: [Content-system refactor](../content-system-refactor-plan.md)
- Predecessor: [ADR 0085](0085-document-publication-lifecycle.md)

## Decision

Basic publication saves an immutable reading version. It does not wait for topic
grouping or relationship generation. A document can have an editable draft and a
confirmed version at the same time. Query, RAG, graph input and new report selection
use the confirmed version. Rejection, withdrawal and privacy checks still apply.

Reuse resource identity, immutable snapshots, evidence fragments and editable
Entries. A publication identifies the logical document by its intake root snapshot,
the selected source snapshot, and the exact Entry identities and revisions. It
freezes reading text, annotation provenance and fragment/range references. Source
identity remains a resource; connector strategies and cross-capture logical identity
belong to P2. Existing fragments are source evidence, not additional articles.

Receive time and source publication time are separate. Event time and last verified
time are nullable and remain unknown in this manual P1 path. Confirmation time is
stored separately. No timestamp is inferred from another. P4 extends annotation
dimensions; P1 preserves current types, domains, keywords and their origins.

Migration 000040 adds immutable publication versions, an active version pointer and
one organization work record per version. Confirmation checks the complete current
Entry set and the intake version under the existing workspace write lock. Updating
the intake confirmation, saving the reading version, advancing the pointer and
recording pending organization work share one PostgreSQL transaction. A failed
transaction leaves all four unchanged. Reconfirmation of identical content reuses
the version and its work record.

Organization has its own version-checked pending/running/succeeded/failed/paused
states. A newer publication supersedes unfinished work for an older version. Its
failure does not change the publication pointer or hide confirmed reading. P1 stores
deferred work and exposes its state; P5 implements the authorized worker and topic
results. Pending work is not permission to call a model. Existing permission, price,
retry and budget checks remain the dispatch boundary.

The existing `document_publish` application use case serves owner HTTP and MCP.
`document_publication_status` exposes the confirmed version, draft flag and separate
organization status with document-read authority. Search and entry reads hydrate
confirmed content. Workbench reads and edits continue to use drafts.

## Compatibility and scope

For documents with new publication records, this decision supersedes ADR 0085's
requirement that query hydrate editable rows matching confirmation. Historical
documents without those records retain ADR 0085's visibility rules. There is one
publication service, with legacy read fallback; no bulk conversion of old knowledge.

Previously saved internal AI tasks retain their original sequence, checkpoints and
call allowance. This P1 increment does not reorder those tasks or introduce a second
AI executor. Completing an old task can save a confirmed version through the same
service. The new source-processing pipeline is delivered in P2–P5.

Processing Bundle v16 includes all three tables. Versions 1–15 upgrade with empty
publication tables, without inventing confirmation. Restore pauses pending/running
organization work and preserves both draft and confirmed content. Full database
backups retain the same records. An older binary must not open the upgraded database;
rollback uses its original image and verified database backup at the P7 cutover.

The running private instance is unchanged. P1 uses disposable databases, external
temporary blobs and synthetic text; it does not call models or import real material.

## Verification

`pnpm test:publication` creates an isolated PostgreSQL 18 container, applies all
migrations and restricted runtime grants, then exercises real application use cases,
HTTP and MCP. It removes that container on exit and prints the temporary evidence
directory. The scenarios cover import idempotency, confirmation, stale versions,
draft isolation, failed organization, transaction rollback, privacy, grants, restart
and export/restore. Ordinary unit tests also retain the legacy publication cases.
