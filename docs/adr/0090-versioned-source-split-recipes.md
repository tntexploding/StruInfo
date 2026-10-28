# ADR 0090: Versioned source splitting recipes

- Status: Accepted
- Date: 2026-10-24
- Scope: Content-system refactor P3

## Context

The same source can publish coherent articles, numbered digests and resource
directories. Repeating a model split for a stable format adds cost and variability.
A source-wide single rule can also fragment coherent reading when formats change.
P1 separates confirmed content from drafts; P2 preserves explicit source identity.

## Decision

Use bounded declarative recipes scoped to a subscription or one snapshot. Match
literal title conditions and supported structure patterns. Whole-document,
numbered, same-level-heading and described-directory templates calculate complete
ordered Unicode ranges. Fenced code is excluded from boundary detection; prefaces
and declared appendices remain attached. Plain links are not independent entries.

Recipes live in external personal preferences with optimistic catalog revisions.
Drafts require recorded trials and explicit owner enablement. Source recipes need
two successful distinct snapshots and a variant/exception trial; document recipes
need one successful trial. All retained outcomes must match owner expectations.
Trials verify program behavior; owner review establishes suitable reading units.
Enabled definitions are immutable. A tested replacement supersedes its predecessor
only when enabled. Paused definitions can be edited, incrementing revision and
clearing trials. No arbitrary generated code or regex is executed.

The optional model adapter proposes a draft from public text through existing
permission, concurrency and price gates. It cannot save or enable a recipe.
Read, preview and apply share application use cases across HTTP and MCP. External
apply requires the existing split grant; configuration remains owner-only.

New native document tasks freeze relevant enabled definitions and the engine
version. Deterministic matches skip only the split-model request. Remaining tag,
recall and relation calls are budgeted before materialization. Mismatch defaults
to an actionable hold; explicitly configured AI fallback uses the original task
allowance. Restart retains the frozen definition. Legacy tasks without this state
retain their behavior. Pausing a recipe affects future tasks, not queued authority.

Rules reuse the manual whole-fragment range validator and atomic empty-snapshot
materialization. A recoverable native write must match every original row and
revision; changed structure and working drafts are protected. Manual/Agent apply
stages a draft for explicit publication. Native task application does not create
a manual confirmation marker. P1 confirmed versions and deferred organization
remain separate; P3 does not introduce a topic worker or alter old publication.

No table or dependency is added. Optional preference and task JSON fields retain
legacy decoding and current personal bundle round trips. Private trial references
are filtered by the reader's explicit privacy scope.

## Alternatives

- Always model-split: retains per-document inference cost and format variance.
- One rule per source: cannot express multiple formats or one-document exceptions.
- Execute generated code: unnecessary execution authority and poor portability.
- Automatically enable from successful parsing: cannot validate semantic boundaries.

## Validation and limits

Synthetic tests cover source matching, Unicode coverage, code/appendices, format
drift, limits, privacy, catalog revisions, frozen tasks, persistence and model
output validation. Disposable PostgreSQL tests exercise preview, granted apply,
confirmation and query visibility. Browser tests cover owner controls and narrow
panels. These checks do not constitute live-source semantic acceptance. The
private instance, source policies and historical corpus are unchanged in P3.
