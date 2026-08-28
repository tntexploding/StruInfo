# ADR 0023: Deterministic Entry Exploration Policy

- Status: Accepted
- Implementation: Complete (M1G-1, 2026-08-25)
- Date: 2026-08-25
- Owners: Main Agent / product owner
- Scope: M1G-1

## Context

M1F-1 through M1F-3 completed local lexical retrieval, bounded Association
traversal, result comparison and optional evidence-bounded AI synthesis. Those
features answer an expressed query, but they do not provide the independent,
user-controlled exploration budget required by the product requirements. The
owner has now selected M1G-1 as the next narrow product boundary.

The active workspace is intentionally data-free and there is not yet enough
real behavior evidence to justify a learned `PreferenceProfile`. Existing
current Entry records and Association projections do, however, provide a
deterministic and explainable basis for a first exploration lane. This lane can
be useful without adding a model, vector index, background task or second
retrieval stack.

## Decision

### Exploration is separate from ordinary search

M1G-1 adds an independent exploration-candidate operation. It MUST NOT insert
candidates into ordinary Query results, change their scores or ordering, alter
their cursor, or call the operation automatically while the user types or
changes filters. The owner explicitly chooses a visible current result as the
anchor and requests candidates. Disabling exploration or setting its share to
zero produces no candidates and leaves every existing Query behavior unchanged.

The public route is `POST /api/v1/entries/exploration/candidates`. Its request
contains the visible anchor Entry identity, the current page's Entry identities,
the current page result count and the explicit current privacy scope. It does
not contain user prose, a Provider prompt, a random seed or client-authored
candidate scores.

### Versioned external policy

`ExplorationPolicy` is distinct from future `PreferenceProfile` and from the
existing Association scoring policy. It is stored in the workspace-scoped
external review-preferences file and therefore remains outside Git, the
application package and PostgreSQL domain state. The existing personal-data
package carries it as part of that preference record; old preference files and
packages load the disabled default.

The first policy has an optimistic revision and the following user-controlled
fields:

- `enabled`;
- `resultShare`, from 0 through 50 percent of the current page size; and
- independent inclusion switches for `neighbor_expansion`, `cross_domain` and
  `serendipity`.

The default is disabled. Saving an equal value is unchanged; saving against a
stale revision is rejected. Updating tag shortcuts, automatic-keyword settings,
vocabulary aliases or Association weights without an exploration field MUST
preserve the current exploration policy.

### Closed deterministic candidate classes

The server first applies the requested public, include-private or private-only
visibility scope to current Entries and loads the Association snapshot under
the same scope. Blocked Associations and stale projections are excluded by the
existing Association read boundary. Only direct visible neighbors of the anchor
can become M1G-1 candidates.

Each candidate receives exactly one primary reason:

1. `cross_domain` when both endpoints have a primary domain and those domains
   differ;
2. `serendipity` when the endpoints come from different Snapshots, the current
   projection has text-term evidence and has no content-keyword similarity; or
3. `neighbor_expansion` for every remaining direct visible Association.

This order is part of the contract. It prevents an attractive label from being
selected by arbitrary UI logic and avoids presenting an unrelated random row as
serendipity. Manual-only graph edges remain valid neighborhood expansion but do
not fabricate projection evidence.

Within each enabled reason bucket, candidates are ordered by effective
Association score descending and then Entry UUID ascending. The final bounded
list uses a fixed round-robin over neighbor expansion, cross-domain connection
and serendipity so one high-volume category cannot erase the others. The limit
is `ceil(currentPageResultCount * resultShare / 100)`, bounded to 12 and zero
when the policy is disabled, the share is zero or the page is empty. Current
page Entries and the anchor are excluded.

Every returned item contains the current Entry, primary reason, effective score,
candidate basis, manual override action when present, and whether its source
Snapshot differs from the anchor. The UI explains these facts as navigation
signals, not factual relations, AI recommendations, semantic equivalence or
truth claims.

### Privacy and side effects

Privacy filtering happens before anchor lookup, Association inspection,
classification, counting and candidate selection. A private anchor is therefore
not observable without explicit `includePrivate`; `onlyPrivate` is valid only
with that opt-in. The operation reads no Blob bytes and sends no content to any
Provider.

Candidate generation is read-only. It creates no Entry revision, Association
projection or override, graph edge, ProcessingRun, proposal, search history or
behavior profile. The policy write is the only persistent M1G-1 action.

### Query interaction

The Query page presents exploration after ordinary results in a visually
separate panel. It shows the disabled, loading, empty, error and ready states;
policy controls remain subordinate to the primary search form. Candidate cards
show a text reason, effective score, local evidence basis and exact-source
action. Changing the selected anchor, result page or privacy/query scope
invalidates an earlier candidate response. A request identity prevents a slower
old response from overwriting the current scope.

The UI exposes only the three reasons that the current data can actually prove.
`foundational_gap`, `emerging_signal` and `viewpoint_diversity` remain future
policy categories because the current Entry model has no accepted ontology,
trend window or viewpoint semantics from which to derive them honestly.

## Rejected or deferred alternatives

### Learned preference profile

Deferred. The data-free workspace has no authorized behavioral sample. M1G-1
must not infer interests from synthetic fixtures or silently treat manual scores
as a trained profile.

### Random, vector or AI recommendations

Rejected for this slice. Random rows are not explainable exploration; vectors
or Provider ranking would add a new retrieval authority without current need.

### Mixing exploration into normal ranking

Rejected. It would make exact counts, pagination and match reasons depend on a
personal policy and would make disabling exploration difficult to prove.

### Foundation, trend and viewpoint claims

Deferred. They need separately accepted data and semantics. Names alone are not
evidence that an Entry fills a foundation gap, is emerging or represents a
different viewpoint.

## Consequences

- The owner gets a visible, reversible first exploration capability with no AI
  or real-data prerequisite.
- Normal Query remains deterministic and backward-compatible.
- The policy travels with external personal data without adding a database
  migration or Bundle section.
- Candidate reasons are limited to facts that current Entry and Association
  records can prove.
- Later preference learning may propose a separate `PreferenceProfile`, but it
  cannot overwrite this policy or reduce its configured share implicitly.

## Acceptance boundary

M1G-1 is complete when synthetic focused tests prove:

1. disabled and zero-share policies return no candidates and do not alter
   ordinary search results;
2. the three reason classes, stable bucket ordering, round-robin selection and
   12-item bound;
3. blocked, stale, current-page and invisible private candidates are excluded
   before counting;
4. policy optimistic revision, equal-write replay, backward-compatible defaults
   and preservation across unrelated preference writes;
5. personal-data-package round-trip of the exploration policy;
6. public API input rejection, not-found anchor and repository failure states;
7. Query-page policy editing, explicit generation, stale-response isolation,
   exact-source action and responsive loading/error/empty/ready presentation;
8. no migration, dependency, Provider call, product-data fixture or application
   artifact leak.
