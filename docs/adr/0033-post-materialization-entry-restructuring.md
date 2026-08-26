# ADR 0033: Post-materialization InformationEntry Restructuring

- Status: Accepted
- Implementation: M1H-2A and M1H-2B complete
- Date: 2026-08-26
- Owners: Main Agent / product owner
- Scope: M1H-2A/B

## Context

M1E-4 made manual grouping complete before a Snapshot received its first Entry
set. Once Entries had been materialized, however, an owner could revise their
annotations but could not correct a mistaken boundary, merge two overly small
Entries or split one oversized Entry. Reimporting the source would duplicate
immutable evidence and silently abandoning tags or relationships would break
the five-step product flow.

M1H-2 closes this reachable editing gap without making Snapshot or Fragment
mutable and without restoring the retired Curation/Knowledge runtime.

## Decision

### M1H-2A: preview before authority

The Split page loads the current Entry partition as ordered Fragment or
half-open Unicode-scalar ranges and reuses the existing manual grouping editor.
Editing the draft invalidates any earlier preview. A new preview operation
validates a complete source-order partition and returns one bounded impact
summary:

- inserted, revised, unchanged and retired current Entry counts;
- successor/predecessor lineage;
- annotation fields that need acknowledgement;
- manual/AI graph relationships that transfer or collapse; and
- relationship destination conflicts that block application.

Preview is read-only. It freezes the exact current Entry and override revisions
into a plan digest. Private source or a relationship touching a private endpoint
requires explicit current-request private scope before content or relationship
planning.

### M1H-2B: one atomic structure replacement

Apply must submit the exact preview digest and the complete partition. Under the
workspace advisory transaction lock, the repository verifies current Entry,
relationship and Document-tag versions, retires the previous current structure,
writes successors and lineage, transfers eligible overrides, recalculates
Document tags and replaces the visible-scope Association projection. Any stale
version rolls back the whole operation.

Forward migration `000021` adds `is_current_structure` to `information_entry`
and a partial unique `(workspace_id, snapshot_id, document_order)` identity for
current rows. Retired Entry rows and their exact evidence children remain in the
database as historical lineage endpoints; ordinary reads, search, tags,
Associations, graph and automation operate only on current-structure rows.

### Identity and annotation rules

- an unchanged exact evidence range keeps its Entry identity;
- a changed, split or merged range receives a deterministic successor identity;
- a single predecessor preserves its current annotations;
- a merge combines unique content keywords;
- equal type, domain and score values are preserved; conflicting values are
  cleared and require explicit owner acknowledgement; and
- no source body is accepted from the browser—the server always reconstructs it
  from immutable local Fragment text.

### Relationship rules

Pair-specific override and Formal Knowledge graph metadata transfer to the
successor with greatest exact evidence overlap. UUID tie-breaks are stable.
Directional graph metadata is inverted when the canonical low/high endpoint
order changes. A relationship whose endpoints collapse into one successor is
reported and requires acknowledgement; incompatible values at one destination
block apply. Calculated Association projections are rebuilt, not migrated as
facts, and an ordinary public restructure leaves unrelated private projections
untouched.

### Carrying data forward

Entry Bundle v4 adds `is_current_structure` to the existing eight-table Entry
section. V1–v3 remain readable and upgrade every historical exported Entry to a
current row because those formats predate restructuring. No new Bundle table is
required, so the complete personal-data package remains 60 workspace tables.

## Consequences

- The manual five-step flow can now correct Entry structure after tags and
  relationships exist.
- Snapshot/Fragment evidence remains immutable and exact source return remains
  valid for both retired and current Entry identities.
- Search and graph surfaces show only the replacement current structure.
- Application is deliberately explicit and preview-first; it is not available
  to AutomationPolicy or an AI proposal.
- One migration is added, with no dependency, Provider, real fixture or
  repository-owned personal file.

## Alternatives Considered

- **Delete old Entries and recreate them:** rejected because lineage, external
  references and owner relationships would become untraceable.
- **Edit Snapshot or Fragment text:** rejected because evidence is immutable.
- **Copy every old relationship to every successor:** rejected because splits
  would manufacture unsupported graph assertions.
- **Make restructuring an automatic route action:** rejected because structural
  replacement remains owner authority.
- **Keep multiple active structures:** rejected because ordinary query and
  document aggregation need one unambiguous current partition.

## Validation

- pure domain tests cover no-op round trips, complete partitions, merge lineage,
  annotation review, relationship collapse and directional transfer;
- migration and PostgreSQL adapter tests cover current-row identity, workspace
  locking, stale rejection, atomic replacement and privacy-scoped projection
  rebuild;
- API/client/Web tests bind preview, exact-plan apply and the Split workbench;
- Bundle tests cover Entry v1–v3 upgrade to v4; and
- the ordinary quality gate covers formatting, lint, TypeScript, unit and
  integration tests, build and artifact isolation.

## Explicitly Deferred

- source reordering, saved pre-split source edits and replaceable parser rules;
- bulk restructuring across multiple documents;
- automatic or Provider-authorized structural replacement;
- a retired-structure history browser and one-click rollback UI; and
- owner-data, production PostgreSQL/container and release validation.

## References

- [ADR 0016](0016-manual-entry-fragment-grouping.md)
- [ADR 0017](0017-manual-within-fragment-entry-boundaries.md)
- [ADR 0032](0032-deterministic-entry-tag-and-association-actions.md)
- [Product requirements](../product-requirements.md)
- [Roadmap](../roadmap.md)
