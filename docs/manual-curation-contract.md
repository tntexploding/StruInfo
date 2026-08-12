# Manual Classification and Intake Contract

- Contract ID: `C-SLICE-A-CURATION-r1`
- Status: Frozen implementation contract; acceptance requires the named TM1
  gate
- Date: 2026-08-12
- Baseline: `8f4518a4a5f246c222acae3bb50dbc2ab1f25589`
- Upstream evidence contract:
  [`C-SLICE-A-EVIDENCE-r2`](source-evidence-storage-contract.md)
- Upstream parser contract:
  [`C-SLICE-A-MARKDOWN-r2`](deterministic-markdown-structure-contract.md)
- Migration reservation: `000003_create_manual_curation_schema.sql`

## Purpose

This contract freezes the first durable control-layer boundary after evidence
capture and deterministic Markdown parsing.
It lets the user classify an exact captured document or evidence Fragment,
choose how that material should be handled, and optionally record independent
assessment dimensions without AI, preferences, browser transport, or formal
knowledge writes.

The slice answers three different questions with different records:

1. `ContentClassification`: what kind of material is this?
2. `IntakeDecision`: what should happen to this exact captured version now?
3. `Assessment`: how does this exact target rate on one named dimension?

No answer implies either of the other two.
Classifying a target never chooses an intake action, a score never chooses an
action, and an intake action never creates or revises formal knowledge.

## Scope and deferred boundaries

Revision 1 includes:

- workspace-owned, user-created content-classification terms with immutable
  revisions;
- exact Snapshot or Fragment curation targets;
- append-only classification-assignment, intake-decision, and assessment
  revisions with explicit current pointers;
- an A0 manual command boundary with atomic idempotency and optimistic
  concurrency;
- stable system action, feedback-reason, and assessment-dimension protocols;
- closed TypeScript input, fixed budgets, deterministic identity, safe errors,
  and a pure state-transition boundary; and
- a forward PostgreSQL migration plus static contract tests.

The classification rows in revision 1 apply only to evidence targets owned by
this contract. Classification of future `KnowledgeItem` identities remains a
separate knowledge-core command and migration concern; it may reuse the same
workspace vocabulary only after that later contract freezes the cross-module
read boundary.

Revision 1 does not include:

- `PreferenceProfile`, `ExplorationPolicy`, attention-allocation policy, learned
  rules, thresholds, recommendation ranking, or automatic intake;
- AI, OCR, model proposals, processing plans, `KnowledgeChangeSet`, formal
  knowledge, relations, search, or RAG;
- HTTP, WebSocket, browser state, authentication, CSRF, external clients, or
  public API DTOs;
- network fetching, a real weekly-source import, or secondary-source capture;
- a formal workspace-bundle curation section;
- real PostgreSQL execution, runtime grants, transaction/concurrency proof, or
  container parity; or
- deletion, retention, backup, or workspace-removal execution.

Those capabilities require later contracts and their named gates.
Their absence is not a failure of this pure/manual slice.

## Authority and module ownership

The `curation` application module owns this contract.
It does not own evidence or formal knowledge.

Revision 1 implements only automation level A0.
Every accepted mutation has the fixed origin `manual_user` and is constructed
by the trusted application boundary after user authorization.
`manual_user` is not a field accepted from an untrusted request body, source
document, model output, rule, or adapter.

The pure module receives a trusted execution context separately from the
untrusted business request:

```ts
export interface ManualCurationContext {
  readonly effectiveWorkspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly authority: 'manual_user';
}
```

This context is an application input, not proof that HTTP authentication has
already passed.
The future transport boundary must derive it from the authenticated session and
must not let a body field choose workspace or authority.

Manual authority can replace current classifications, decisions, and
assessments through new revisions.
It cannot mutate history, bypass workspace/evidence validation, turn an intake
decision into a knowledge write, or convert a source or AI proposal into a user
command.

## Exact curation targets

Revision 1 curates an immutable evidence version, never a moving Resource.

```ts
export type CurationTargetRef =
  | Readonly<{kind: 'snapshot'; snapshotId: string}>
  | Readonly<{kind: 'fragment'; fragmentId: string}>;
```

- A Snapshot target represents the complete exact captured version.
- A Fragment target represents one exact immutable locator and selected-text
  digest.
- A Resource, URL, DocumentNode, parser local key, heading label, filesystem
  path, or current-version alias is not a curation target.
- Any valid Fragment can be selected manually.
  The Markdown profile's `intakeTargetNodeKeys` is only a deterministic proposal
  for useful targets; it is not a durable decision or authorization.
- A new Snapshot creates different target identities.
  Classifications, decisions, and assessments do not silently inherit across
  source versions.
- Copying a prior decision to a new Snapshot is a later explicit command or
  policy action and must retain its own authorization and audit record.

The target ID is derived with the RFC 9562 UUIDv5 implementation already used by
the evidence module:

```text
snapshot target name = struinfo:curation-target:v1:snapshot:<snapshot_id>
fragment target name = struinfo:curation-target:v1:fragment:<fragment_id>
namespace            = effective workspace UUID
```

One natural target produces one `curation_target` row.
Its `current_version` starts at 0 and advances by one for each applied target
command, not for an unchanged command or exact replay.

## Content-classification vocabulary

Content classifications are workspace data, not program enums or release
defaults.
The migration creates no terms and the application seeds no labels.

`VocabularyTerm` has a caller-supplied stable UUID and immutable revisions.
The UUID is its stable key; display names and hierarchy are revision data.

```ts
export type VocabularyTermLifecycle = 'active' | 'retired';

export interface PutContentClassificationTermRequest {
  readonly termId: string;
  readonly expectedRevision: number;
  readonly value: Readonly<{
    displayName: string;
    description?: string;
    parentTermId?: string;
    lifecycle: VocabularyTermLifecycle;
  }>;
}
```

- `expectedRevision` is 0 when creating a term and otherwise equals the current
  revision number.
- Creating a previously unseen term with lifecycle `retired` is invalid; a term
  first enters the vocabulary as `active` and can be retired by a later
  revision. This returns `invalid_state` at `request.value.lifecycle`.
- A successful semantic change appends exactly one revision and advances the
  current pointer with compare-and-set.
- A new command key whose value equals the current value returns `unchanged` and
  appends nothing.
- A term can be renamed, reparented, retired, or reactivated through a new
  revision.
- Parent terms exist and are active in the same workspace.
  Self-parenting and direct or indirect cycles fail closed.
- Retiring a term does not delete or rewrite its assignments or descendants;
  active descendants under a retired parent remain valid historical/current
  terms, while any later reparent operation must choose an active parent.
- A retired term cannot receive a new `assign_classification` operation.
  Removing an existing assignment remains allowed.
- A new command that assigns a retired term returns `term_retired` even when
  that assignment is already current. An exact replay of a successful command
  from before retirement still replays because command reconciliation occurs
  first.
- Duplicate display names are allowed because display text is not identity.
  The UI must disambiguate them by hierarchy and stable ID.
- Renaming a term does not append classification-assignment revisions.
  Historical assignment revisions retain the exact term revision used at the
  time; current displays may also show the term's current label.

Display names contain 1 through 120 Unicode code points and at most 512 UTF-8
bytes.
They contain no U+0000 or unpaired surrogate, are not all ECMAScript whitespace,
and have no leading or trailing ECMAScript whitespace.
Descriptions are optional. When present, they contain 1 through 2,000 code
points and at most 8,192 UTF-8 bytes, are not all ECMAScript whitespace, have no
leading or trailing ECMAScript whitespace, and follow the same scalar-value
restrictions. Empty or whitespace-only descriptions are rejected rather than
trimmed or stored.
Omitting a description or parent means no description or root placement in the
new immutable value; it is not a patch sentinel that preserves the old value.
Internal whitespace and Unicode normalization are preserved exactly.

## Manual target command

One command applies an ordered, atomic patch to one exact target.

```ts
export interface ApplyManualCurationRequest {
  readonly target: CurationTargetRef;
  readonly expectedTargetVersion: number;
  readonly operations: readonly ManualCurationOperation[];
}

export type ManualCurationOperation =
  | Readonly<{
      kind: 'assign_classification';
      termId: string;
    }>
  | Readonly<{
      kind: 'remove_classification';
      termId: string;
    }>
  | Readonly<{
      kind: 'set_intake_decision';
      action: IntakeAction;
      reasonCodes: readonly IntakeFeedbackReason[];
      note?: string;
    }>
  | Readonly<{
      kind: 'set_assessment';
      dimension: AssessmentDimension;
      score: AssessmentScore;
      note?: string;
    }>
  | Readonly<{
      kind: 'clear_assessment';
      dimension: AssessmentDimension;
    }>;
```

The array contains 1 through 64 operations.
One command cannot mention the same classification term more than once, contain
more than one decision operation, or mention the same assessment dimension more
than once.
Those cases are `duplicate_operation`, not last-write-wins.
Business values stay in caller order for request-digest equality. After
duplicate detection, transition planning and persistence use fixed phases—term
IDs in ascending UUID order, then the optional decision, then dimensions in the
protocol order—so caller ordering cannot change the resulting domain rows or
lock order.

`expectedTargetVersion` and `expectedRevision` are safe non-negative integers
no greater than 2,147,483,647. An absent target has current version 0; an absent
term has current revision 0.

After applying a command, one target can have at most 64 currently assigned
classification terms.
The finite assessment protocol already limits current assessments to one per
dimension.

If a target has no current intake decision, `set_intake_decision` creates
decision revision 1. There is no `clear_intake_decision` operation in revision
1; unresolved work is represented explicitly by `needs_review` rather than by
deleting decision history.

## Intake actions and feedback

The stable actions are:

```ts
export type IntakeAction =
  'full' | 'split' | 'condense' | 'source_only' | 'ignore' | 'needs_review';
```

Their exact meanings are:

| Action         | Meaning in this slice                                                                  |
| -------------- | -------------------------------------------------------------------------------------- |
| `full`         | Eligible for a later whole-document or whole-unit processing plan                      |
| `split`        | Eligible for a later plan that creates multiple knowledge candidates                   |
| `condense`     | Eligible for a later compressed candidate while evidence stays intact                  |
| `source_only`  | Preserve evidence and control history; do not initiate knowledge processing            |
| `ignore`       | Do not initiate processing or proactive display; do not delete evidence                |
| `needs_review` | No processing authorization exists; keep the target in an explicit manual-review state |

`full`, `split`, and `condense` express intended processing shape only.
They do not authorize a formal knowledge change, merge, deletion, conflict
resolution, external data transfer, or model call.

The fixed feedback reasons are:

```ts
export type IntakeFeedbackReason =
  | 'already_known'
  | 'low_information_value'
  | 'high_noise_or_marketing'
  | 'unreliable_source'
  | 'insufficient_evidence'
  | 'temporarily_not_needed'
  | 'not_interested'
  | 'worth_exploring'
  | 'recommendation_direction_right_sample_wrong'
  | 'other';
```

Reason codes are an ordered, duplicate-free array with at most 10 members.
They are feedback, not classifications, scores, policy rules, or factual truth.
No action-to-reason combination is inferred or prohibited.
`other` requires a non-empty note, and a non-empty decision note is accepted
with any action or reason set.

An intake decision has one stable identity per target and immutable revisions.
A different action, reason sequence, or optional-note presence/value appends a
revision.
The latest revision is current.
There is no in-place update or delete.

## Independent assessments

Assessments are optional.
No row means the dimension has not been assessed; the application does not
invent a neutral score.

Scores are ordinal integers 0 through 4.
Higher means "more of the named property."
For `noise_marketing` and `cognitive_cost`, a higher score is therefore less
desirable; this direction must not be silently inverted.

```ts
export type AssessmentScore = 0 | 1 | 2 | 3 | 4;

export type AssessmentDimension =
  | 'information_density'
  | 'breadth'
  | 'depth'
  | 'novelty'
  | 'current_interest'
  | 'neighborhood_expansion'
  | 'cross_domain_connection'
  | 'foundational_gap'
  | 'emerging_signal'
  | 'viewpoint_source_diversity'
  | 'serendipity'
  | 'noise_marketing'
  | 'cognitive_cost'
  | 'traceability'
  | 'source_reliability'
  | 'extraction_confidence'
  | 'identity_confidence'
  | 'corroboration'
  | 'freshness';
```

The dimensions remain in these groups:

| Group                | Dimensions                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Information value    | `information_density`, `breadth`, `depth`, `novelty`                                                                                    |
| Current preference   | `current_interest`                                                                                                                      |
| Exploration value    | `neighborhood_expansion`, `cross_domain_connection`, `foundational_gap`, `emerging_signal`, `viewpoint_source_diversity`, `serendipity` |
| Noise and cost       | `noise_marketing`, `cognitive_cost`                                                                                                     |
| Reliability evidence | `traceability`, `source_reliability`, `extraction_confidence`, `identity_confidence`, `corroboration`, `freshness`                      |

Revision 1 defines no total, average, weight, threshold, admission formula,
ranking formula, preference model, or exploration policy.
Changing one assessment cannot mutate another dimension or the intake decision.

One stable Assessment exists per target and dimension.
`set_assessment` appends a `rated` revision when its score or optional-note
presence/value changes.
`clear_assessment` appends a `cleared` revision and leaves no current score while
retaining history.
`clear_assessment` carries no note; an already absent or already cleared
dimension is semantically unchanged.

Decision and assessment notes are optional personal workspace data.
When present, each contains 1 through 2,000 Unicode code points and at most
8,192 UTF-8 bytes, no U+0000 or unpaired surrogate, is not all ECMAScript
whitespace, and has no leading or trailing ECMAScript whitespace. The boundary
rejects rather than trims empty, whitespace-only, or padded notes.
Errors, logs, metrics, and ordinary command receipts never echo notes, labels,
descriptions, source text, or target content.

## Classification-assignment behavior

One stable assignment exists per target and term.
Its immutable revisions have state `assigned` or `removed` and bind the exact
term revision used by the command.

- Assigning an unassigned active term appends `assigned`.
- Removing an assigned term appends `removed`.
- Assigning an already assigned term or removing an already removed/absent term
  is semantically unchanged.
- Classification order has no semantic meaning in revision 1.
- Adding, removing, renaming, retiring, or reactivating a classification never
  changes the target's intake decision or assessments.
- Changing the intake decision or an assessment never adds or removes a
  classification.

Semantic equality is exact protocol equality: strings, optional-field
presence, reason order, scores, lifecycle, and parent ID are compared exactly
after validation. The boundary performs no case folding, trimming, Unicode
normalization, locale collation, or implicit reason sorting.

## Stable identities

All derived identities use RFC 9562 UUIDv5 and lowercase canonical UUID text.
The fixed names are:

```text
term revision:
  namespace = term_id
  name      = struinfo:vocabulary-term-revision:v1:<revision_number>

classification assignment:
  namespace = target_id
  name      = struinfo:classification-assignment:v1:<term_id>

classification assignment revision:
  namespace = assignment_id
  name      = struinfo:classification-assignment-revision:v1:<revision_number>

intake decision:
  namespace = target_id
  name      = struinfo:intake-decision:v1

intake decision revision:
  namespace = decision_id
  name      = struinfo:intake-decision-revision:v1:<revision_number>

assessment:
  namespace = target_id
  name      = struinfo:assessment:v1:<dimension>

assessment revision:
  namespace = assessment_id
  name      = struinfo:assessment-revision:v1:<revision_number>
```

Revision numbers start at 1, increase without gaps for one stable identity, and
must fit a signed 32-bit positive integer.
The caller supplies only `termId`; every other domain ID is derived.
Caller-supplied IDs, labels, notes, scores, and command keys never select another
workspace.

## Idempotency, concurrency, and atomicity

The command identity is
`(effective_workspace_id, command_idempotency_key)` across both public command
kinds.
The key is 1 through 200 ASCII characters from `[A-Za-z0-9._:-]`.

The application constructs a canonical, versioned request projection containing
the fixed manual origin, command kind, effective workspace, target or term,
expected version, and exact ordered business values. `commandKind` is
`put_content_classification_term` or `apply_manual_curation`.
It stores the lowercase SHA-256 of that projection, not the private text itself,
in the command row.
The projection envelope is a closed object with
`schemaVersion: 'struinfo.manual-curation-command.v1'` followed by
`authority`, `commandKind`, `workspaceId`, and `request`; `request` uses the
field and array order declared by the TypeScript types above, with absent
optional fields omitted. The existing canonical JSON encoder provides the
actual object-key ordering and UTF-8 bytes before SHA-256.

The rules are:

1. The same command key and equal projection replays the original receipt,
   including its original result version, even if current state later advances.
2. The same command key with a different projection returns
   `idempotency_conflict` and changes nothing.
3. A new key with an expected version different from current state returns
   `stale_revision` and changes nothing.
4. A new key whose requested state already equals current state returns
   `unchanged`, records a replayable receipt, and appends no domain revision.
5. An applied target command appends only changed classification, decision, or
   assessment revisions and advances the target version exactly once.
6. A command is all-or-nothing.
   It never returns or persists a partial set of operations.
7. Command receipt, appended revisions, current pointers, and target/term
   compare-and-set update commit in one PostgreSQL transaction.

For term commands, the resulting version is the current term revision number;
a request for a term that does not yet exist creates revision 1 and cannot be
semantically unchanged. For target commands, the resulting version is
`curation_target.current_version`, including 0 when the first accepted command
is semantically unchanged. That accepted command still creates the stable
target row so its receipt can retain a real workspace-first reference; it
creates no assignment, decision, or assessment revision.

Only a successfully applied or semantically unchanged command claims an
idempotency key and stores a replayable receipt. A rejected command does not
claim its key. After correcting the cause, a caller may retry the same key or
use a new one; retrying the same well-formed request is safe because any
uncertain successful commit is found by the stored key before state validation.

Term hierarchy writes serialize on the owning workspace row before reading and
revalidating the hierarchy, so two individually acyclic concurrent reparents
cannot commit a cycle. A target command locks every referenced term identity in
ascending UUID order and revalidates its current revision and lifecycle before
inserting assignment revisions. The pure planner receives the corresponding
closed state; real lock, transaction, and race proof remains TM2.

Idempotency reconciliation occurs before optimistic-version checking so an exact
retry can replay after later commands have advanced the aggregate.
No command accepts caller timestamps.
Database time is audit metadata and is excluded from command equality and
deterministic IDs.

## Closed input and fixed budgets

Every untrusted request is inspected before reading values.
Accepted containers are ordinary own-data-property records and dense ordinary
arrays with declared fields only.
The boundary rejects custom prototypes, class instances, Proxy objects, own
accessors, inherited accessors for any declared field, symbols, sparse arrays,
extra properties, cycles, `__proto__`, `prototype`, and `constructor` keys
without executing caller-owned code. It does not reject ordinary records merely
because the standard `Object.prototype` contains unrelated built-in members.

Decoded output and successful plans are deeply frozen.
Input arrays and records are copied into owned ordinary containers; later caller
mutation cannot change a prepared command or plan.

Budgets are fixed and cannot be raised per request:

| Budget                                 | Inclusive limit |
| -------------------------------------- | --------------: |
| Command operations                     |              64 |
| Current classifications on one target  |              64 |
| Feedback reasons on one decision       |              10 |
| Display-name code points / UTF-8 bytes |       120 / 512 |
| Description code points / UTF-8 bytes  |   2,000 / 8,192 |
| Note code points / UTF-8 bytes         |   2,000 / 8,192 |
| Idempotency-key ASCII characters       |             200 |
| Revision number / target version       |   2,147,483,647 |

The boundary does not use filesystem, network, environment, clock, randomness,
AI, locale-sensitive collation, or database capability.
It may use the existing canonical JSON and cryptographic identity utilities.
No new production dependency is authorized by this contract.

## Result and error contract

Both command kinds return one of:

```ts
export type CurationCommandStatus =
  'applied' | 'replayed' | 'unchanged' | 'rejected';

export type CurationIssueCode =
  | 'invalid_shape'
  | 'invalid_identifier'
  | 'invalid_text'
  | 'invalid_state'
  | 'limit_exceeded'
  | 'duplicate_operation'
  | 'target_not_found'
  | 'term_not_found'
  | 'term_retired'
  | 'invalid_parent'
  | 'hierarchy_cycle'
  | 'stale_revision'
  | 'idempotency_conflict'
  | 'persistence_failed';

export interface CurationIssue {
  readonly code: CurationIssueCode;
  readonly path: string;
  readonly budget?: string;
}
```

Successful receipts contain only workspace ID, command key, command kind,
stable target or term ID, outcome, and the resulting target or term version.
They do not contain labels, descriptions, notes, reasons, scores, source text,
or database errors.

An exact replay returns status `replayed` while preserving the stored original
outcome (`applied` or `unchanged`) as a separate receipt field. The command row
stores that original outcome; it never rewrites it to `replayed`.

Rejected results contain no mutation plan or partial value.
Issues contain only declared fields and stable schema paths; they never echo an
input value, source text, private label/note, URI, filesystem path, rendered
object, database text, stack, or credential.

Validation and transition precedence is:

1. closed shape and fixed field set;
2. scalar, Unicode, identifier, enum, request-local state,
   duplicate-operation, and budget checks;
3. exact command replay or idempotency conflict;
4. workspace-scoped target or term lookup;
5. expected target/term revision;
6. referenced term/parent existence, lifecycle, state, and hierarchy checks;
7. semantic delta calculation; and
8. atomic persistence.

Cross-workspace references resolve as `target_not_found` or `term_not_found`.
The boundary does not reveal whether an ID exists in another workspace.

## PostgreSQL schema contract

Migration `000003_create_manual_curation_schema.sql` creates only these 11
tables in `struinfo`:

1. `curation_target`;
2. `vocabulary_term`;
3. `vocabulary_term_revision`;
4. `classification_assignment`;
5. `classification_assignment_revision`;
6. `intake_decision`;
7. `intake_decision_revision`;
8. `intake_decision_reason`;
9. `assessment`;
10. `assessment_revision`; and
11. `curation_command`.

The schema preserves these rules:

- every primary key, foreign key, lookup, unique identity, idempotency identity,
  and current-pointer resolution is workspace-first;
- `curation_target` is created by the first accepted target command even when
  that command is unchanged; it then remains at version 0 until the first
  applied target command;
- a `curation_target` has exactly one target branch: a Snapshot reference uses
  `(workspace_id, resource_id, snapshot_id)` and a Fragment reference uses
  `(workspace_id, fragment_id)`, with nullability consistent with target kind;
  two partial unique indexes enforce one target per exact Snapshot branch and
  one target per exact Fragment branch;
- target references use the existing immutable Snapshot or Fragment
  workspace-first keys and store only the parent `resource_id` needed by the
  Snapshot foreign key; they store no source body, selected text, URL, path,
  parser-local key, or other copied evidence metadata;
- current-pointer identity rows are mutable only by checked application
  compare-and-set; all term, assignment, decision, assessment, and reason
  history rows are append-only through ordinary ports;
- term revision ordinals, assignment natural identity, one decision per target,
  one assessment per target/dimension, and revision ordinals are unique in one
  workspace;
- revision tables use exact enum/range/nullability checks;
- decision reasons are ordered, duplicate-free child rows of one immutable
  decision revision rather than an array or JSON column;
- no table contains arbitrary `json`/`jsonb`, executable rules, model output,
  confidence aggregates, or user-defined protocol state;
- no foreign key uses `ON DELETE CASCADE`;
- ordinary B-tree indexes that serve the declared workspace-first lookups and
  foreign keys are allowed; they add no business semantics or search feature;
- no table or migration seeds a real or example personal term, decision, score,
  source, snapshot, note, preference, or policy; and
- no runtime role, grant, trigger, background task, outbox event, view, or
  search index is invented by this migration.

The 11 tables use this minimum closed relational shape; audit timestamps are
database-generated and do not participate in equality or deterministic IDs:

- `curation_target`: target ID, kind, parent Resource ID for a Snapshot branch,
  Snapshot ID or Fragment ID, current target version, and creation time;
- `vocabulary_term`: term ID, current revision number, current term-revision ID,
  and creation time;
- `vocabulary_term_revision`: stable term and revision IDs, ordinal, display
  name, optional description, optional parent term ID, lifecycle, and creation
  time;
- `classification_assignment`: assignment ID, target ID, term ID, current
  revision number, current assignment-revision ID, and creation time;
- `classification_assignment_revision`: stable assignment and revision IDs,
  ordinal, state, exact term-revision ID used, and creation time;
- `intake_decision`: decision ID, target ID, current revision number, current
  decision-revision ID, and creation time;
- `intake_decision_revision`: stable decision and revision IDs, ordinal, action,
  optional note, and creation time;
- `intake_decision_reason`: exact decision-revision ID, zero-based reason
  ordinal, and reason code;
- `assessment`: assessment ID, target ID, dimension, current revision number,
  current assessment-revision ID, and creation time;
- `assessment_revision`: stable assessment and revision IDs, ordinal, state,
  score required only when rated and null when cleared, note permitted only
  when rated, and creation time; and
- `curation_command`: command key, request SHA-256, command kind, fixed origin,
  optional target ID or term ID selected by kind, outcome, resulting version,
  and creation time.

Every listed identity, pointer, and reference is accompanied by
`workspace_id`; the shorthand above never removes that first key column.
Reason ordinals are contiguous from 0 in the exact request order; the
application validates completeness because ordinary SQL constraints alone do
not prove a gap-free child sequence.
Each committed term, assignment, decision, or assessment identity has a
non-null pointer to its own current revision. The implementation may insert the
identity and first revision in dependency-safe order inside one command
transaction, but the committed schema state never exposes a pointerless
identity. `curation_command` references exactly one target or term according to
command kind, and an accepted target command always has a target row.
Its persisted `outcome` is only `applied` or `unchanged`; `replayed` is a return
status reconstructed from the stored receipt, and rejected commands have no
row.

The database may enforce universal protocol checks, but the application remains
responsible for closed input, exact UTF-8/code-point budgets, hierarchy cycle
checks, deterministic IDs, command digest equality, first-error order, and
authorization context.

Migration files remain immutable and forward-only.
Rollback uses a separately reviewed compensation migration or consistent
PostgreSQL-plus-Blob restore; it never edits `000003` after application.

## Pure application and repository boundary

The implementation lives under `apps/server/src/modules/curation/` and exposes
plain TypeScript contracts and pure validation/transition functions.
Domain code does not import NestJS, PostgreSQL, Drizzle, pg-boss, filesystem,
network, environment, clock, AI, or browser modules.

The pure boundary must be able to:

- prepare both command kinds from closed input and trusted context;
- derive all non-term IDs and the canonical request digest;
- reconcile exact command replay versus idempotency conflict;
- validate a closed repository snapshot of current term/target state;
- calculate append-only row plans and current-pointer compare-and-set values;
- identify `applied`, `unchanged`, stale, missing, retired, and hierarchy-cycle
  results without I/O; and
- return no plan on any rejection.

Repository ports expose one transaction per command and only the lookups and
insert/CAS operations needed by that plan.
They do not expose update/delete methods for immutable history rows.
Real PostgreSQL adapters and runtime grants remain behind TM2, but the static
migration and pure boundary must agree exactly before TM1 can pass.

## Personal-data and artifact boundary

All real terms, labels, descriptions, classifications, decisions, reasons,
notes, scores, and command history are personal workspace data.
They belong in external PostgreSQL state and later workspace exports, never in
source code, runtime defaults, environment variables, migration seeds, tracked
fixtures, frontend mocks, logs, packages, or container images.

Tracked tests use generated, value-free identities and labels under reserved
synthetic contexts.
They do not copy Stage 0 decisions, real weekly prose, personal preferences, or
external data-root files.
The implementation and tests must not read `.agents/stage-0/**`.

The eventual workspace-bundle curation section must use a separately frozen
closed codec and preserve histories and stable IDs.
It is not authorized to serialize internal objects or secrets under this
contract.

## TM1 acceptance boundary

The fixed implementation candidate passes TM1 only when synthetic, value-free
tests prove all of the following:

1. the exact Snapshot/Fragment target union, workspace-first lookup, target
   UUIDv5 known answers, and no inheritance across Snapshots;
2. empty initial vocabulary, term create/revise/rename/reparent/retire/reactivate,
   invalid retired creation, exact revision IDs, duplicate display names,
   stale revision handling, concurrent-cycle serialization, and cycle
   rejection;
3. classification assign/remove history, retired-term behavior, maximum current
   count, exact term-revision binding, concurrent lifecycle revalidation, and
   no effect on decisions/assessments;
4. all six intake actions, all feedback reasons, `other` note requirement,
   immutable revisions, source preservation for `source_only`/`ignore`, and no
   formal-knowledge side effect;
5. all 19 assessment dimensions, score boundaries, clear history, group
   separation, absence-as-unassessed, and no aggregate or automatic action;
6. atomic mixed commands, duplicate-operation rejection, exact target-version
   increments, first-command version-0 target creation, unchanged behavior,
   stale commands, and no partial plan;
7. same-key equal replay, same-key conflict, different-key equal-state
   `unchanged`, canonical digest identity, and replay of the original receipt
   after later state advances, plus rejected-key reuse;
8. hostile records, arrays, accessors, inherited setters, Proxy objects,
   dangerous keys, Unicode edge cases, all fixed budgets, deep freeze, safe
   issue shape, and non-echoing errors;
9. poisoned filesystem, network, environment, clock, randomness, AI, and
   framework/database seams proving a pure non-AI domain boundary;
10. static DDL proof for exactly the 11 tables, workspace-first keys and
    references, target sum type, current pointers, enum/range checks,
    append-only-compatible history, no cascade, no arbitrary JSON, and no seed
    values;
11. no new dependency or license delta, no personal/real-source material, and
    no test helper, fixture, or ignored evidence in the application artifact;
    and
12. formatting, lint, strict type checking, focused tests, full repository
    tests, build, and application-artifact verification.

TM1 does not claim real PostgreSQL parsing, catalog constraints, transactions,
concurrency, runtime grants, container parity, authentication, browser behavior,
real source import, knowledge creation, preference learning, or AI behavior.
Those claims remain deferred to their named gates.

## References

- [Product requirements](product-requirements.md)
- [Roadmap](roadmap.md)
- [Knowledge core architecture](knowledge-core-architecture.md)
- [Workspace bundle contract](workspace-bundle-contract.md)
- [Database migrations and roles](database-migrations-and-roles.md)
- [Application artifact boundary](application-artifact-boundary.md)
- [ADR 0002](adr/0002-postgresql-persistence-and-durable-work.md)
- [ADR 0004](adr/0004-adaptive-knowledge-ingestion-and-policy-authorized-writes.md)
- [ADR 0005](adr/0005-versioned-knowledge-core-and-ai-optional-operations.md)
- [ADR 0006](adr/0006-external-configuration-and-personal-data-isolation.md)
