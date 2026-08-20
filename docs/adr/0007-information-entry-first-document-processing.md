# ADR 0007: Information-Entry-First Document Processing

- Status: Accepted
- Date: 2026-08-20
- Decision owners: Project owner and maintainers
- Supersedes: The product-layer interpretation of ADR 0005 that made routine
  document units pass through `KnowledgeItem` before they became searchable;
  ADR 0005 remains authoritative for formal semantic knowledge
- Superseded by:

## Context and Constraints

M1C proved the complete local path from source evidence through manual review,
formal knowledge writes, and deterministic search. Direct owner use then showed
that most weekly-source units are already short, useful information records.
Requiring every reviewed unit to become a formal `KnowledgeItem` adds type,
epistemic-role, review-state, and change-set decisions before the user can search
or connect the material. Those decisions are valuable for claims, durable
concepts, and typed semantic relations, but they are unnecessary ceremony for
ordinary document entries.

The owner has selected the processing model in
[`document-entry-processing-guidelines.md`](../document-entry-processing-guidelines.md):
documents produce source-bound information entries, entries receive three
independent keyword dimensions, document tags aggregate from the full document,
and selective associations support search and discovery. Formal knowledge
remains available where semantic identity, revision history, claims, or typed
relations are actually needed.

The existing evidence, curation, knowledge, privacy, external-data, and
non-AI invariants remain valuable and already contain real workspace data. The
redirection must preserve them without a destructive rewrite or a second Blob
store. It must also avoid turning AI, vectors, a new database, or an exhaustive
new certification cycle into a prerequisite.

## Decision

Add a canonical `InformationEntry` layer between immutable document evidence
and optional formal semantic knowledge.

- `Resource`, `Snapshot`, `DocumentNode`, `Fragment`, and external Blob bytes
  remain the evidence and document-structure truth. Entry does not replace or
  mutate them.
- `InformationEntry` supplies a stable, workspace-scoped identity bound to one
  immutable Snapshot. `InformationEntryRevision` stores the current body,
  title path, document order, exact evidence inputs, body hash, split-rule
  version, `chunk_mode`, and `visibility`. Entry changes append a revision and
  advance a current pointer; the original Snapshot remains immutable.
- Split, merge, and boundary changes retain explicit lineage between Entry
  revisions. The first implementation may create only one-to-one section
  entries and one whole-document entry, but its schema and command boundary
  must not require destructive replacement when manual split/merge arrives.
- Every current Entry has three independent annotation dimensions:
  free content keywords, exactly one system type keyword, and one primary plus
  at most two secondary domain keywords. Content-keyword spelling,
  normalization, and source location are retained. Type/domain `other` values
  keep their dimension-specific custom display name as workspace data.
- Document tags are versioned aggregate results. Full text is the primary
  input; Entry keyword frequency and coverage are supporting evidence. Expanded
  search fields remain rebuildable projections rather than duplicated truth.
- `AssociationProjection` is rebuildable and records content, type, and domain
  contributions plus algorithm identity. `AssociationOverride` is normative,
  versioned user control that can strengthen, weaken, block, or restore an
  association without being erased by recomputation.
- Entry associations mean “possibly related.” They do not create formal
  `KnowledgeRelation` semantics such as `supports`, `contradicts`, or `part_of`.
- Entry becomes the primary unit for ordinary document browsing, keyword
  editing, deterministic text/keyword/source search, and related-item
  discovery. `KnowledgeItem` remains the formal semantic layer for durable
  concepts, claims, methods, synthesized records, explicit semantic relations,
  and other cases that benefit from ADR 0005's stronger change model.
- Existing `KnowledgeItem` and relation rows remain valid and searchable. No
  migration rewrites them into Entry rows. Existing curation decisions remain
  historical user decisions and may guide a user-invoked Entry build, but they
  are not silently reinterpreted as Entry annotations.
- The complete Entry path works without AI. Deterministic parsing, manual
  annotation, indexed candidate generation, local text similarity, structured
  filtering, and explainable ranking are the baseline. AI, embeddings, and RAG
  may create proposals or derived recall channels later.
- Privacy filtering occurs before counts, candidate generation, association
  traversal, sorting, and pagination. A private Snapshot creates only private
  Entries; an association with a private endpoint remains outside the ordinary
  scope. Explicit `includePrivate` is still required for each read action.
- Canonical Entry and control rows live in workspace-scoped PostgreSQL. Original
  documents, media, preferences, exports, and all user-owned resource files
  remain in the external boundaries established by ADR 0006. No active user
  data becomes a source module, fixture, migration seed, or package asset.

The first delivery increment is a narrow vertical slice, not the complete
association system. It materializes Entry rows from an existing Snapshot,
allows the owner to assign the three keyword dimensions, and searches the
persisted current Entries with source return and privacy scope through the
existing local server and Web application. Document aggregation, automatic
association scoring, manual association overrides, split/merge editing, and
performance projections follow as separate M1D increments.

## Alternatives Considered

### Continue making every reviewed Fragment a KnowledgeItem

This reuses the completed M1C path but preserves the workflow friction that
caused the redirection. It also conflates a source-bound document unit with a
formal semantic identity. Rejected as the primary path; it remains available
for formalization when useful.

### Rename Fragment to Entry and add keywords directly to evidence

Fragment is an immutable evidence anchor and can represent headings, text
ranges, or other structural material. User split/merge choices and annotations
must evolve without rewriting evidence. Rejected.

### Store entries only as search documents or vector chunks

This is quick to prototype but loses canonical identities, revisions, manual
overrides, privacy semantics, and deterministic rebuildability. Rejected.

### Replace the formal knowledge model

Existing versioned knowledge and typed relations already solve a different,
deeper problem and contain accepted data. Removing them would destroy useful
capability and create an unnecessary migration. Rejected.

## Consequences

- Ordinary source material becomes searchable and connectable with fewer
  decisions than the M1C knowledge-write queue required.
- Evidence, Entry, and formal Knowledge have explicit and different purposes;
  the UI must not present them as interchangeable labels.
- PostgreSQL gains new workspace-scoped Entry tables in a forward migration.
  Existing tables and data remain untouched.
- The product will temporarily expose both Entry search and formal Knowledge
  search. A later unified search screen may federate them while preserving
  result type and provenance.
- Type and domain keyword vocabularies are universal protocol values, while
  custom `other` names and content keywords are user data.
- Association computation can evolve or be rebuilt without losing user
  overrides.
- The completed M1C code remains a stable advanced path and migration source,
  but new product effort moves to M1D instead of extending the routine
  Fragment-to-Knowledge queue.

## Security, Privacy, and Licensing

This decision adds no dependency and authorizes no network, AI, or external
data transfer. Entry text comes only from already admitted workspace evidence.
Private content retains the current explicit opt-in boundary and is not exposed
to ordinary logs, reports, exports, associations, or AI proposals.

Actual Entry bodies, keywords, custom labels, associations, and documents are
personal workspace data. They must not enter Git, tests, documentation,
application artifacts, or container images. Tracked tests use synthetic,
value-free records only.

## Migration and Rollback

Introduce the Entry schema through forward migration `000008`; do not edit
`000001` through `000007`. The first materialization command is idempotent for
the same workspace, Snapshot, chunk mode, and algorithm version. Later rebuilds
append or replace derived projections without rewriting the source Snapshot.

Existing M1C data requires no automatic conversion. The owner can invoke a
workspace operation to build Entries from selected existing Snapshots. If the
new product path is rolled back, the application can stop exposing Entry routes
while leaving the additive tables intact; evidence and formal knowledge remain
usable through the frozen M1C application.

## Validation

- Apply all eight migrations to a disposable PostgreSQL database and
  materialize synthetic split Entries from an existing Snapshot.
- Repeat the same command and prove no duplicate Entry or revision is created.
- Assign content, type, and primary/secondary domain keywords, then read the
  exact current Entry back through the public application boundary.
- Search by body and each keyword dimension without AI, return the exact
  Snapshot/Fragment source, and explain which field matched.
- Prove public search cannot count, reveal, or traverse private Entries, while
  an explicit private-scope request can return them.
- Prove existing KnowledgeItem search and editing continue to work unchanged.
- Build the application artifact and verify that test code, source documents,
  personal keywords, and external workspace files are absent.

## References

- [Document-entry processing guidelines](../document-entry-processing-guidelines.md)
- [Product requirements](../product-requirements.md)
- [Knowledge core architecture](../knowledge-core-architecture.md)
- [Roadmap](../roadmap.md)
- [ADR 0005](0005-versioned-knowledge-core-and-ai-optional-operations.md)
- [ADR 0006](0006-external-configuration-and-personal-data-isolation.md)
