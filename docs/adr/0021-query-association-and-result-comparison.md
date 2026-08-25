# ADR 0021: Query Association Navigation and Result Comparison

- Status: Accepted
- Date: 2026-08-24
- Owners: Main Agent / product owner
- Scope: M1F-2

## Context

M1F-1 completed explainable local lexical Entry retrieval. The same public
query already supports privacy-scoped one- or two-hop Association traversal,
but the Query page does not let the owner choose an Entry as the traversal
anchor. Its help text points to an action that exists only on the separate
Associations page and whose local state is not shared, so the supported query
capability is a reachable UI dead end.

The product requirements also assign ordinary result comparison to Query. The
current page shows one selected Entry at a time and therefore makes a simple
source, tag and content comparison unnecessarily indirect. Neither gap needs a
new search protocol, database table, Provider, saved-view format or global
state store.

## Decision

### Association navigation in Query

Query exposes an explicit local-association switch. When it is off, the current
search is unchanged. When the owner turns it on, the currently selected visible
Entry becomes the anchor for the existing Association filter. The owner may:

- disable traversal;
- replace the anchor with the currently selected result;
- choose one or two hops; and
- choose the existing minimum-score boundary.

The UI labels this as deterministic local Association traversal. It does not
describe the results as AI suggestions or semantic equivalence. Privacy remains
inside the existing query boundary and is applied before traversal, counting,
ordering and pagination.

### Query-bound comparison

Query can retain at most two selected search results for side-by-side
inspection. A comparison shows only already returned product facts:

- title, source, privacy state and current revision;
- local text-match mode and score when present;
- chunk mode, usefulness and interest as independent values;
- type, domains and content keywords; and
- the current body plus an exact-source action for each Entry.

It does not generate a combined score, winner, summary or inferred relation.
Comparison state is session-only and is bound to the current semantic query
scope. It may survive cursor pagination within that scope, but it becomes
invisible immediately when text, fields, filters, Association anchor or privacy
scope changes. It is never written to personal preferences, PostgreSQL or a
personal-data package.

### Implementation boundary

M1F-2 is a Query-owned frontend increment. It reuses the current public Entry
search response and Association filter and does not change server contracts,
database migrations, dependencies, ordering, cursor encoding or external data.
Query-specific actions and comparison rendering stay in focused Query
components instead of adding page modes to the shared Entry result component.

## Rejected or deferred alternatives

### A second search or graph API

Rejected. The current public search already returns the Entry, match reasons,
Association path and stable pagination required by this workflow.

### Persisted comparison lists or saved queries

Deferred. They would become external personal data and require explicit
lifecycles, import/export and workspace switching semantics. Direct use has not
yet demonstrated that need.

### AI summaries, semantic comparison or vectors

Deferred. M1F-2 compares visible records and deterministic Association paths;
it does not synthesize an answer, infer equivalence or introduce RAG.

## Consequences

- The Query page no longer sends the owner to another page to activate an
  already-supported Association filter.
- Two results can be compared across stable cursor pages without losing exact
  source access or mixing privacy scopes.
- The exhaustive Query page remains distinct from the bounded Formal Knowledge
  graph and from the Association policy/override editor.
- No migration, dependency, Provider call, real material or repository-owned
  personal data is introduced.

## Validation

Focused tests cover the query-scope binding, maximum-two selection behavior,
Association switch labels, comparison facts and exact-source controls. A
synthetic two-result run in real Chrome retained natural scrolling and no
horizontal overflow at 320, 390, 768, 1024 and 1440 CSS pixels; comparison was
single-column below 1024 and two-column at 1024 and 1440. The same run proved
that enabling Association traversal changes the query scope and clears the
comparison, and that returning to the previous query does not revive stale
records. Full repository verification passed with 94 unit files / 691 tests,
2 integration files / 4 tests, build and the 848-file artifact audit.

## Related decisions

- [ADR 0007](0007-information-entry-first-document-processing.md)
- [ADR 0008](0008-current-entry-state-and-portable-personal-data.md)
- [ADR 0011](0011-association-derived-formal-graph-edges.md)
- [ADR 0020](0020-explainable-lexical-entry-search.md)
