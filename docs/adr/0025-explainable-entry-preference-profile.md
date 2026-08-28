# ADR 0025: Explainable Entry Preference Profile

- Status: Accepted
- Implementation: M1G-3A through M1G-3D complete
- Date: 2026-08-25
- Owners: Main Agent / product owner
- Scope: M1G-3

## Context

M1G-1 added an independent, default-off exploration policy and M1G-2 added the
first exact source subscription. The next unmet MVP-1 boundary is a readable
`PreferenceProfile` derived from the owner's explicit Entry annotations. The
current product stores usefulness and interest separately and already has
content, type and domain tags, but it does not turn those observations into a
portable rule set or show how such rules would evaluate existing Entries.

The active workspace is intentionally data-free. M1G-3 therefore cannot claim
that a profile predicts the owner's real preferences, improves a real metric or
is ready to make automatic decisions. It can establish the closed data model,
deterministic suggestion logic, trial surface and takeover boundary using only
synthetic fixtures. Automatic routing, automatic Entry writes and AI-generated
profiles remain later decisions.

## Proposed decision

### One local profile with two independent dimensions

M1G-3 introduces one workspace-scoped `EntryPreferenceProfile` in the external
personal preference file. It has an optimistic revision, a default-off enabled
state and at most 64 ordered rules. Every rule contains:

- a stable rule identity;
- exactly one dimension: `usefulness` or `interest`;
- exactly one feature kind: `content_keyword`, `type` or `domain`;
- one normalized feature identity and an owner-visible display value;
- one effect: `prefer` or `deprioritize`; and
- an integer weight from 1 through 5.

Usefulness and interest never collapse into one total preference score. A rule
cannot change the Entry's stored human score, privacy, tags, text, Association,
graph edge or query rank. `ExplorationPolicy` and Association weights remain
separate records and separate consumers.

### Deterministic suggestions from explicit samples

Suggestions are generated locally and only after an explicit request. The
input is the current Entry set after privacy filtering. An Entry contributes to
one dimension only when that dimension has an explicit human score:

- scores 4 and 5 are positive observations;
- score 3 is neutral evidence; and
- scores 1 and 2 are negative observations.

For each normalized content keyword, type identity or domain identity, the
service counts positive, neutral and negative observations independently for
usefulness and interest. A candidate is emitted only when the feature has at
least three rated observations and one side has at least two more observations
than the opposite side. The majority side determines `prefer` or
`deprioritize`. Neutral observations are displayed but do not vote for either
side. Candidates are capped at 64 and ordered by dimension, feature kind and
unsigned normalized UTF-8 identity so the same snapshot yields the same result.

Suggestions contain aggregate counts and current Entry identities only for the
request-local explanation. They are not saved as rules until the owner adds or
accepts them. The profile does not store Entry bodies, source URLs, sample
identities, behavior history, model output or rejected candidates.

### Read-only trial evaluation

The owner can trial either the saved profile or an unsaved draft against the
current visible Entry set. Each result contains the Entry identity, current
revision, its existing manual scores, matched rules and two independent signed
rule totals. A positive or negative total is only a rule-match summary; it is
not a probability, semantic score, factual reliability score or replacement
for the owner's assessment.

Trial evaluation is read-only and bounded. It returns at most 100 Entries in a
stable order, never changes normal Query matching or pagination, and does not
create a `ProcessingRun`. A stale draft revision, malformed rule or changed
Entry revision must be visible rather than silently evaluated under another
state.

### Privacy and ownership

Public-only is the default suggestion and trial scope. Including private
Entries requires an explicit current request and remains entirely local; no
Provider is called. A rule derived from a private annotation is still personal
data and therefore stays in the external preference file and personal-data
package. It never enters Git, application assets, logs or synthetic fixtures.

Old preference files and packages load a revision-zero, disabled, empty
profile. Profile writes use the same external workspace selection and
optimistic-update boundary as current Association, exploration and source
subscription preferences. The implementation must also serialize sibling
preference writers so a profile save cannot overwrite an independently updated
subscription cursor or another policy field.

### Product surface

Tags owns the profile because it already owns explicit ratings and the three
tag dimensions. A secondary panel will:

- explain that rules are local and do not make automatic decisions;
- list, add, edit, remove, enable and disable profile rules;
- generate deterministic candidate rules on demand;
- show aggregate evidence for each candidate before acceptance; and
- run a bounded trial showing separate usefulness and interest matches.

Overview may report that a profile exists, but it must not fabricate a task or
claim learned quality. Import, Split, Associations, Query and Formal Knowledge
behavior remain unchanged in M1G-3.

## Explicitly deferred

### Automatic routing and downstream processing

Deferred to a later `AutomationPolicy` increment. M1G-3 does not automatically
split a new Snapshot, write tags, rebuild Associations, ignore an Entry, accept
an AI proposal or advance a subscription run beyond import.

### AI-generated profiles

Deferred. No Entry samples, ratings or profile rules are sent to OpenAI or a
second Provider. A future Provider proposal would require its own closed payload,
budget, disclosure and explicit acceptance boundary.

### Additional assessment dimensions

Deferred. Noise, uncertainty, factual reliability, novelty and exploration
value do not exist as current Entry annotations and must not be inferred from
usefulness or interest. Adding them requires a separate product decision.

### Behavior learning and hidden personalization

Rejected. Search history, clicks, dwell time and implicit behavior are not
recorded or treated as preference evidence.

## Implementation preparation

M1G-3 is split into four bounded work packages:

1. **M1G-3A — profile state:** add the closed profile decoder, default, external
   persistence, optimistic revision and personal-data-package compatibility;
2. **M1G-3B — suggestion and trial core:** implement deterministic aggregate
   suggestion and read-only evaluation over injected current Entry snapshots;
3. **M1G-3C — public boundary and Tags UI:** add narrow get/save/suggest/trial
   operations and the secondary profile panel without changing the main review
   loop; and
4. **M1G-3D — integration and boundary checks:** verify privacy-first behavior,
   sibling-preference write serialization, stale response protection, backward
   package reads, responsive UI and artifact isolation.

No database migration or new dependency is planned. If implementation proves
that current public repositories cannot provide a consistent Entry snapshot or
that safe sibling-preference serialization needs a materially different storage
model, stop and amend this ADR before adding a second persistence system.

## M1G-3A outcome

The first work package is implemented on the data-free baseline:

- `EntryPreferenceProfile` is a closed external preference record with a
  non-negative revision, default-off enabled state and at most 64 ordered rules;
- every rule has a canonical UUID, one usefulness/interest dimension, one
  content/type/domain feature, a canonical NFC plus ASCII-lower feature
  identity, an owner-visible value, one prefer/deprioritize effect and weight
  1 through 5;
- duplicate rule identities and duplicate dimension/feature identities are
  rejected, and decoded state is copied into owned frozen containers;
- old preference files and old personal-data-package sections load the disabled
  revision-zero empty Profile, while new packages carry the Profile without a
  migration or section-version break; and
- the existing review, Association policy, exploration policy, source
  subscription and workspace-restore writers pass the Profile through rather
  than silently resetting it.

No public Profile mutation endpoint exists in M1G-3A. The stored revision is the
future optimistic-write token; the public expected-revision command belongs to
M1G-3C. Cross-writer serialization under concurrent external preference writes
and its final integration proof were assigned to and completed by M1G-3D.

## M1G-3B outcome

The second work package is implemented as a pure local core over injected
current Entry snapshots:

- suggestion input is privacy-filtered before counting and only an explicitly
  present usefulness or interest score contributes to its own dimension;
- content, type and domain features are counted independently, with positive,
  neutral and negative Entry identities returned only in the request-local
  explanation;
- the accepted three-observation and two-vote-margin thresholds are enforced,
  and the suggested weight is the absolute positive-versus-negative margin
  capped at 5;
- candidate display values and output order are deterministic; candidates are
  capped at 64 after dimension, feature-kind and unsigned UTF-8 identity
  ordering;
- saved and unsaved Profile inputs use the same closed decoder and trial a
  stable Entry-ID order with at most 100 results, returning matched rules and
  separate signed usefulness and interest totals; and
- malformed Profiles, stale Profile revisions and explicitly supplied stale
  Entry revision ledgers return distinct visible outcomes instead of being
  silently evaluated.

A disabled Profile can be trialled deliberately, but trial does not enable it.
Neither suggestions nor trials write preferences, Entry state, Query state,
Associations, graph edges or Processing records. M1G-3B adds no HTTP route, Web
surface, Provider call, migration or dependency. M1G-3C owns the public
commands and Tags secondary panel; M1G-3D completes sibling-writer
serialization and the final integration checks.

## M1G-3C outcome

The third work package connects the accepted state and pure core to one narrow
owner-facing boundary:

- the local API exposes one Profile read, one expected-revision save, one
  explicit deterministic suggestion request and one bounded read-only trial;
- saving preserves the currently loaded quick tags, automatic-keyword settings,
  vocabulary, Association policy, exploration policy and source subscriptions,
  while stale Profile revisions return a visible conflict;
- Tags keeps routine per-Entry review first and renders Profile management only
  as a secondary panel after the Entry results;
- the panel lists, edits, removes, adds, enables and disables draft rules,
  displays candidate counts and bounded Entry evidence, and copies a candidate
  into the draft only after an explicit owner action;
- public-only remains the default; including private Entries requires a separate
  current-panel checkbox for suggestion or trial and stays inside the local
  deterministic core; and
- draft trials show at most 100 Entries with existing scores, matched rules and
  separate usefulness/interest totals without first saving or enabling the
  Profile.

Only the explicit save operation writes the external personal preference file.
Candidate generation, evidence inspection and trial never write Entry, Query,
Association, graph or Processing state and never call a Provider. M1G-3C adds no
migration, dependency or real fixture. Concurrent serialization with other
preference writers, late-response protection under interactive races and final
browser/responsive/artifact checks are completed by M1G-3D.

## M1G-3D outcome

The final work package closes the integration boundary without adding another
data model:

- the external preference store now serializes all writes per workspace and
  exposes one atomic read-modify-write operation; Profile, quick-tag/vocabulary,
  Association-policy, exploration-policy and source-subscription configuration
  or cursor updates all apply against the latest sibling fields;
- Profile expected-revision checks and the other versioned policy checks happen
  inside that serialized operation, so a concurrent writer cannot pass a stale
  check and then replace a newer preference file;
- the Tags review control submits only the quick-tag, automatic-keyword and
  vocabulary fields it owns instead of echoing a cached Association policy;
- application-level loads/saves and panel-level suggestion/trial requests use
  monotonically increasing request identities. Changing privacy scope, changing
  or saving a draft, abandoning a draft or starting a newer request invalidates
  older responses;
- public-only remains the default service and browser scope. Private Entry
  inclusion is an explicit current request, filtering occurs before aggregate
  counts, and neither suggestion nor trial has a Provider dependency;
- legacy preference files and old personal-data-package sections still decode
  to the disabled revision-zero empty Profile; and
- synthetic browser checks cover late responses and horizontal overflow at
  320, 390, 768, 1024 and 1440 CSS pixels. The ordinary artifact verifier continues
  to exclude tests, test support, personal files and Profile examples from the
  application package.

M1G-3 is therefore complete. It still grants no automatic routing, automatic
Entry mutation, Provider-generated Profile, behavior tracking or Query-ranking
authority.

## Acceptance boundary

M1G-3 may be marked complete only when synthetic tests prove:

1. old preferences and personal-data packages load a disabled empty profile;
2. profile decoding, rule limits, expected revision and sibling-field
   preservation are closed;
3. usefulness and interest suggestions are calculated independently from only
   explicitly scored Entries;
4. contradictory or insufficient samples produce no candidate, while stable
   synthetic samples produce the frozen ordered candidates and counts;
5. accepting, editing or deleting a rule requires an explicit owner command;
6. draft and saved-profile trials return bounded, explainable matches without
   changing Entries, Query, Associations, graph or Processing state;
7. privacy filtering happens before sample counting and private scope never
   invokes a Provider;
8. Tags exposes honest empty, insufficient-sample, draft, stale, saved and trial
   states without displacing routine Entry review; and
9. the complete repository quality gate passes with no migration, dependency,
   real material, personal fixture or application-artifact leak.

## Consequences

- The owner can inspect and correct the first explicit preference model before
  it receives any automation authority.
- Existing ratings and three-dimensional tags gain a reusable local policy
  interpretation without changing their stored meaning.
- M1G-4 can later decide whether and how an `AutomationPolicy` consumes an
  enabled profile, with separate thresholds, budgets, pause and rollback.
- Real predictive quality and usability remain honestly unverified until the
  owner restores a material set after product development.
