# ADR 0008: Current Entry State and Portable Personal Data

- Status: Accepted
- Date: 2026-08-23
- Decision owners: Project owner and maintainers
- Supersedes: ADR 0007's append-only storage rules for routine Entry, Document-tag, and Association-override edits
- Superseded by: ADR 0009 for temporary legacy-runtime retention

## Context

Direct owner use showed that the five ordinary document-processing stages are one editing workflow, not five independent historical records. Keeping every intermediate Entry, Document-tag, and association-control revision duplicates the same short material and makes the ordinary path harder to understand. The immutable source Snapshot and Fragment graph already preserves the exact original evidence. Formal KnowledgeItem records have a different purpose and still need their stronger provenance and semantic revision model.

The owner also needs the external workspace to be genuinely portable. The old Workspace Bundle carried database rows and Blob identities, while Blob bytes and review/tag preferences had to exist separately. That is a useful database snapshot, but it is not a complete personal-data export.

Finally, the accepted five-page workflow hid useful review controls in a legacy page and exposed legacy processing-intent, rejection-reason, and manual-link controls that no longer belong in the Entry-first product.

## Decision

### Routine document state

The ordinary pipeline stores two canonical states:

1. immutable original evidence in Resource / Snapshot / Fragment and the external content-addressed Blob store; and
2. one current final database state for each InformationEntry, Document tag set, association projection, and association override.

Updates to the final state replace the previous final value transactionally. A monotonically increasing version and opaque version identity remain only for optimistic concurrency and stale-form protection. They do not point to retained historical value copies. Entry source identity, exact Fragment inputs, privacy, and lineage remain explicit.

This rule does not rewrite or weaken formal KnowledgeItem / KnowledgeRelation history. Formal knowledge remains append-only because it represents durable semantic assertions, synthesis, and typed relations rather than an ordinary document-editing workspace.

### Tags and review

The Tags page becomes the only routine manual annotation surface. It combines:

- independent five-position usefulness and interest assessments;
- editable deterministic content-keyword candidates;
- the existing content/type/domain dimensions;
- user-managed quick tags and exact exclusions; and
- deterministic case-insensitive de-duplication plus user-confirmed alias canonicalization, including bilingual aliases when the owner defines them.

No deterministic rule guesses that two different-language terms are synonyms. The user records that equivalence as an alias. Processing intent, intake action, judgment reasons, manual connection intent, and the old review page are removed from the current owner workflow. Existing historical curation rows may remain readable for compatibility but receive no new writes from this workflow.

### Formal knowledge page

Primary navigation adds 正式知识 after 查询. The first increment is an honest placeholder describing the boundary; its commands and interaction model will be accepted separately. Legacy formal-knowledge APIs remain available but are not presented as a finished new page.

### Personal-data package

New exports are personal-data packages, not database-only Bundles. A package contains, for one workspace:

- all canonical database sections;
- every referenced original/normalized Blob byte sequence with its digest and length; and
- the workspace's review/tag preferences, quick tags, deterministic extraction settings, exclusions, and alias rules.

The package remains an external file and never enters Git or the application artifact. Secrets and runtime connection configuration remain excluded. Restore validates all payload hashes before changing canonical state. Old Bundle v1 files remain importable: when embedded Blob or preference data is absent, the old requirement that referenced Blobs already exist remains in force and the current external preferences are left unchanged.

### Privacy search scope

Entry search exposes three explicit per-query scopes:

- public only (default);
- public and private; and
- private only.

Privacy is applied before counting, traversal, sorting, and pagination. The private-only choice is a visibility filter, not encryption or multi-user access control.

## Consequences

- Routine edits no longer grow duplicate Entry/tag/override history tables.
- Existing current M1D values are migrated in place; stale historical copies are intentionally discarded after the current values have been copied.
- Source evidence and formal knowledge history keep their existing guarantees.
- The Tags page is materially simpler and the old review vocabulary is reduced to quick tags, extraction settings, exclusions, and aliases.
- A new export can recreate the personal workspace without separately copying the Blob store or preference JSON.
- Export files can be larger because binary data is base64-encoded in the canonical package envelope. A configured package-size limit remains.

## Migration and Rollback

Forward migration 000011 copies the current rows selected by the existing pointers into current-state columns/tables, preserves version counters, rewires association constraints, and then removes obsolete historical Entry, Document-tag, and override rows/tables. It never edits migrations 000001 through 000010 and never modifies Snapshot, Fragment, Blob, Curation, or formal Knowledge rows.

The M2 Git/worktree backup created before this decision remains the whole-code rollback point. Personal workspace rollback uses a personal-data export created before applying 000011; a code rollback alone must never pretend it restored external user data.

## Validation

- Migrate synthetic multi-revision Entry/tag/override fixtures and prove only the former current values remain.
- Revise a current Entry twice and prove row counts remain stable while version tokens advance and stale writes are rejected.
- Verify useful/interesting scores and canonicalized tags round-trip through the public Tags workflow without an intake action or reason.
- Export to an empty external target and restore database rows, Blob bytes, and preferences without a pre-existing Blob store.
- Import an old Bundle v1 with its legacy external-Blob behavior.
- Prove public/include/private-only search counts and cursors are distinct.

## References

- [ADR 0006](0006-external-configuration-and-personal-data-isolation.md)
- [ADR 0007](0007-information-entry-first-document-processing.md)
- [Product requirements](../product-requirements.md)
- [Knowledge core architecture](../knowledge-core-architecture.md)
- [Roadmap](../roadmap.md)
