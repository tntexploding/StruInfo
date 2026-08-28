# Manual Classification and Intake Contract

- Contract ID: `C-SLICE-A-CURATION-r3`
- Status: Frozen implementation contract; acceptance requires the named TM1
  gate
- Date: 2026-08-12
- Baseline: `417bab760d42d1ebb2a04859ff23174a54ab651a`
- Supersedes: `C-SLICE-A-CURATION-r2`
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

Revision 3 carries forward revision 2's closed parent-lifecycle, UUID, result,
receipt, issue-path, and budget protocols. It removes three unreachable UTF-8
byte ceilings found by independent test preparation: within the existing valid
Unicode-scalar and code-point ceilings, display names can occupy at most 480
UTF-8 bytes and descriptions or notes at most 8,000, so the former 512/8,192
checks could never reject a value. It also makes the already-frozen
collection-length-first rule explicit for the ten-value feedback-reason
protocol. This changes no accepted input, table, migration reservation,
feature scope, automation authority, or persisted command schema version.

## Scope and deferred boundaries

Revision 3 includes:

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

The classification rows in revision 3 apply only to evidence targets owned by
this contract. Classification of future `KnowledgeItem` identities remains a
separate knowledge-core command and migration concern; it may reuse the same
workspace vocabulary only after that later contract freezes the cross-module
read boundary.

Revision 3 does not include:

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

Revision 3 implements only automation level A0.
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

Revision 3 curates an immutable evidence version, never a moving Resource.

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
- On term creation, a supplied parent exists and is active in the same
  workspace. On term revision, that requirement applies only when
  `parentTermId` changes from its current exact presence/value to a supplied
  parent. Changing to root has no parent lifecycle to validate.
  Self-parenting and direct or indirect cycles fail closed on creation or an
  actual parent change.
- Retiring a term does not delete or rewrite its assignments or descendants;
  active descendants under a retired parent remain valid historical/current
  terms. Preserving an existing parent link never revalidates the parent's
  active lifecycle. A later reparent to a supplied parent must choose an active
  parent.
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

Display names contain 1 through 120 Unicode code points.
They contain no U+0000 or unpaired surrogate, are not all ECMAScript whitespace,
and have no leading or trailing ECMAScript whitespace.
Descriptions are optional. When present, they contain 1 through 2,000 code
points, are not all ECMAScript whitespace, have no leading or trailing
ECMAScript whitespace, and follow the same scalar-value restrictions. Empty or
whitespace-only descriptions are rejected rather than trimmed or stored.
Omitting a description or parent means no description or root placement in the
new immutable value; it is not a patch sentinel that preserves the old value.
Internal whitespace and Unicode normalization are preserved exactly.

Assuming shape, identifier, command-key reconciliation, primary-term lookup,
and expected revision have already succeeded, a term whose stored parent is now
retired follows this closed table:

| Requested transition                                       | Result                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| Exact current value, including the same parent             | `unchanged`                                                    |
| Rename and/or description change, same parent              | `applied`                                                      |
| Active to retired, same parent                             | `applied`                                                      |
| Retired to active, same parent                             | `applied`                                                      |
| Any of the above plus removal of the parent to become root | `applied`                                                      |
| Create with a retired parent                               | `rejected` / `invalid_parent` at `request.value.parentTermId`  |
| Change from any current parent/root to a retired parent    | `rejected` / `invalid_parent` at `request.value.parentTermId`  |
| Change to a missing, cross-workspace, or self parent       | `rejected` / `invalid_parent` at `request.value.parentTermId`  |
| Change to an active parent that creates a cycle            | `rejected` / `hierarchy_cycle` at `request.value.parentTermId` |

Reactivation under the same retired parent is deliberate: it preserves an
already accepted topology rather than introducing a new reference. Exact
same-key replay still precedes this table and returns the stored receipt.

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
3; unresolved work is represented explicitly by `needs_review` rather than by
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

Revision 3 defines no total, average, weight, threshold, admission formula,
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
When present, each contains 1 through 2,000 Unicode code points, no U+0000 or
unpaired surrogate, is not all ECMAScript whitespace, and has no leading or
trailing ECMAScript whitespace. The boundary
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
- Classification order has no semantic meaning in revision 3.
- Adding, removing, renaming, retiring, or reactivating a classification never
  changes the target's intake decision or assessments.
- Changing the intake decision or an assessment never adds or removes a
  classification.

Semantic equality is exact protocol equality: strings, optional-field
presence, reason order, scores, lifecycle, and parent ID are compared exactly
after validation. The boundary performs no case folding, trimming, Unicode
normalization, locale collation, or implicit reason sorting.

## Canonical UUID boundary

Every UUID string crossing the pure boundary has exactly this lowercase,
hyphenated text shape:

```text
^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$
```

This rule applies to `context.effectiveWorkspaceId`, `request.termId`, an
included `request.value.parentTermId`, either target-branch ID, every
classification-operation `termId`, and every UUID in the closed repository
snapshot consumed by the planner. Uppercase hex, braces, a `urn:uuid:` prefix,
missing hyphens, leading/trailing whitespace, and all other spellings are
rejected; the boundary never trims or normalizes them.

Request UUIDs are validated before request-digest construction, UUID sorting,
workspace lookup, semantic comparison, or UUIDv5 derivation. An invalid request
UUID returns `invalid_identifier` at its exact declared field path. Thus
PostgreSQL's ability to parse multiple textual spellings cannot create a second
request identity for one logical UUID. UUIDs produced by the application also
use this shape; UUIDv5 outputs additionally carry their RFC 9562 version and
variant bits.

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

| Budget                                | Inclusive limit |
| ------------------------------------- | --------------: |
| Command operations                    |              64 |
| Current classifications on one target |              64 |
| Feedback reasons on one decision      |              10 |
| Display-name Unicode code points      |             120 |
| Description Unicode code points       |           2,000 |
| Note Unicode code points              |           2,000 |
| Idempotency-key ASCII characters      |             200 |
| Revision number / target version      |   2,147,483,647 |

The admitted text values consist only of valid Unicode scalar values. One such
value occupies at most four UTF-8 bytes, so the code-point limits imply hard
maxima of 480 UTF-8 bytes for a display name and 8,000 UTF-8 bytes for a
description or note. No separate text-byte budget or byte-budget issue token
exists because it could not reject an otherwise admitted value.

Although the feedback protocol currently has exactly ten distinct reason
values and requires a duplicate-free admitted result, the raw array length is
checked before any element or duplicate check. An 11-element raw array
therefore deterministically returns the `feedback_reasons` limit issue without
requiring eleven valid distinct protocol values.

The boundary does not use filesystem, network, environment, clock, randomness,
AI, locale-sensitive collation, or database capability.
It may use the existing canonical JSON and cryptographic identity utilities.
No new production dependency is authorized by this contract.

## Result and error contract

The two command kinds expose separate, closed discriminated result unions.
Receipt fields are nested under `receipt`; rejected results contain only one
`issue`. No result object, receipt, or issue accepts additional properties.

```ts
export type CurationCommandStatus =
  'applied' | 'replayed' | 'unchanged' | 'rejected';

export type CurationOriginalOutcome = 'applied' | 'unchanged';

export interface PutContentClassificationTermReceipt<
  Outcome extends CurationOriginalOutcome = CurationOriginalOutcome,
> {
  readonly workspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly commandKind: 'put_content_classification_term';
  readonly termId: string;
  readonly resultingRevision: number;
  readonly originalOutcome: Outcome;
}

export interface ApplyManualCurationReceipt<
  Outcome extends CurationOriginalOutcome = CurationOriginalOutcome,
> {
  readonly workspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly commandKind: 'apply_manual_curation';
  readonly targetId: string;
  readonly resultingVersion: number;
  readonly originalOutcome: Outcome;
}

export type PutContentClassificationTermResult =
  | Readonly<{
      status: 'applied';
      receipt: PutContentClassificationTermReceipt<'applied'>;
    }>
  | Readonly<{
      status: 'unchanged';
      receipt: PutContentClassificationTermReceipt<'unchanged'>;
    }>
  | Readonly<{
      status: 'replayed';
      receipt: PutContentClassificationTermReceipt;
    }>
  | CurationRejectedResult;

export type ApplyManualCurationResult =
  | Readonly<{
      status: 'applied';
      receipt: ApplyManualCurationReceipt<'applied'>;
    }>
  | Readonly<{
      status: 'unchanged';
      receipt: ApplyManualCurationReceipt<'unchanged'>;
    }>
  | Readonly<{
      status: 'replayed';
      receipt: ApplyManualCurationReceipt;
    }>
  | CurationRejectedResult;

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

export type CurationBudgetName =
  | 'command_operations'
  | 'current_classifications'
  | 'feedback_reasons'
  | 'display_name_code_points'
  | 'description_code_points'
  | 'note_code_points'
  | 'idempotency_key_characters'
  | 'revision_number'
  | 'target_version';

export type CurationOperationIndex =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23
  | 24
  | 25
  | 26
  | 27
  | 28
  | 29
  | 30
  | 31
  | 32
  | 33
  | 34
  | 35
  | 36
  | 37
  | 38
  | 39
  | 40
  | 41
  | 42
  | 43
  | 44
  | 45
  | 46
  | 47
  | 48
  | 49
  | 50
  | 51
  | 52
  | 53
  | 54
  | 55
  | 56
  | 57
  | 58
  | 59
  | 60
  | 61
  | 62
  | 63;

export type CurationReasonIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type CurationIssuePath =
  | 'context'
  | 'context.effectiveWorkspaceId'
  | 'context.commandIdempotencyKey'
  | 'context.authority'
  | 'request'
  | 'request.termId'
  | 'request.expectedRevision'
  | 'request.value'
  | 'request.value.displayName'
  | 'request.value.description'
  | 'request.value.parentTermId'
  | 'request.value.lifecycle'
  | 'request.target'
  | 'request.target.kind'
  | 'request.target.snapshotId'
  | 'request.target.fragmentId'
  | 'request.expectedTargetVersion'
  | 'request.operations'
  | `request.operations[${CurationOperationIndex}]`
  | `request.operations[${CurationOperationIndex}].kind`
  | `request.operations[${CurationOperationIndex}].termId`
  | `request.operations[${CurationOperationIndex}].action`
  | `request.operations[${CurationOperationIndex}].reasonCodes`
  | `request.operations[${CurationOperationIndex}].reasonCodes[${CurationReasonIndex}]`
  | `request.operations[${CurationOperationIndex}].note`
  | `request.operations[${CurationOperationIndex}].dimension`
  | `request.operations[${CurationOperationIndex}].score`
  | 'state'
  | 'persistence';

export type CurationIssue =
  | Readonly<{
      code: 'limit_exceeded';
      path: CurationIssuePath;
      budget: CurationBudgetName;
    }>
  | Readonly<{
      code: Exclude<CurationIssueCode, 'limit_exceeded'>;
      path: CurationIssuePath;
    }>;

export type CurationRejectedResult = Readonly<{
  status: 'rejected';
  issue: CurationIssue;
}>;
```

Every successful result has exactly `status` and `receipt`. Every receipt has
exactly the six fields declared for its command kind. A term receipt always uses
`termId` and `resultingRevision`; a target receipt always uses `targetId` and
`resultingVersion`. Neither substitutes `targetVersion`, `version`, `outcome`,
or another alias. All receipt UUIDs use canonical UUID text and resulting
revision/version values include 0 only where the target-version rules permit
it.

An exact replay returns status `replayed` while preserving the stored original
outcome (`applied` or `unchanged`) as a separate receipt field. The command row
stores that original outcome; it never rewrites it to `replayed`.

Every rejected result has exactly `status: 'rejected'` and `issue`; it has no
receipt, mutation plan, partial value, or result identity. A non-budget issue
has exactly `code` and `path`. A `limit_exceeded` issue additionally and always
has the closed `budget` field. Issues never echo an input value, source text,
private label/note, URI, filesystem path, rendered object, database text,
stack, or credential.
Every result, receipt, and issue returned by the boundary is deeply frozen.

In a dynamic issue path, `i` and `j` are rendered as zero-based unsigned decimal
indices with no leading zero except the value 0. A missing or unexpected field
uses the declared field path when one exists; an unknown extra key uses its
nearest declared container path so attacker-controlled key text is never
echoed. Any malformed or inconsistent closed repository snapshot uses `state`
rather than exposing repository values or internal row layout.

A non-record, custom prototype, Proxy, symbol, cycle, dangerous key, sparse
array, or unknown extra property reports its nearest declared container. A
missing required property, own accessor, inherited accessor for a declared
property, or invalid property value reports that declared property. These rules
remove any choice between, for example, `request` and `request.termId`, and all
paths start with `context`, `request`, `state`, or `persistence`; they never use
a `$` prefix.

A present field with the wrong primitive/container type is `invalid_shape` at
that declared field. After type admission, a UUID-shaped field uses
`invalid_identifier` for non-canonical text, a text field uses `invalid_text`
for its declared content rules, and a correctly typed but unsupported enum,
number, or cross-field state uses `invalid_state`. This type-first rule applies
to every scenario in the table below.

The complete issue mapping is:

| Scenario                                                                                       | Code                   | Path                                                                                                   | Budget                       |
| ---------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------- |
| Invalid container, density, own-property, declared-field, or branch shape                      | `invalid_shape`        | Nearest declared `context`, `request`, value, target, operations, operation, or reason container/field | Absent                       |
| Invalid workspace, term, parent, Snapshot, Fragment, or operation-term UUID in context/request | `invalid_identifier`   | Its exact declared UUID field                                                                          | Absent                       |
| Empty or lexically invalid command key                                                         | `invalid_identifier`   | `context.commandIdempotencyKey`                                                                        | Absent                       |
| Invalid closed repository snapshot container, relation, or value shape                         | `invalid_shape`        | `state`                                                                                                | Absent                       |
| Non-canonical UUID in a closed repository snapshot                                             | `invalid_identifier`   | `state`                                                                                                | Absent                       |
| Invalid Unicode scalar, whitespace form, or empty present text                                 | `invalid_text`         | Exact display-name, description, or note field                                                         | Absent                       |
| Authority is not `manual_user`                                                                 | `invalid_state`        | `context.authority`                                                                                    | Absent                       |
| Unknown target, operation, lifecycle, action, reason, or dimension protocol value              | `invalid_state`        | Exact discriminator/enum field; a reason uses `request.operations[i].reasonCodes[j]`                   | Absent                       |
| Expected revision/version is not a safe non-negative integer                                   | `invalid_state`        | `request.expectedRevision` or `request.expectedTargetVersion`                                          | Absent                       |
| After lookup shows the primary term is absent, its create request uses lifecycle `retired`     | `invalid_state`        | `request.value.lifecycle`                                                                              | Absent                       |
| Operations array is empty                                                                      | `invalid_state`        | `request.operations`                                                                                   | Absent                       |
| Assessment score is not an integer 0 through 4                                                 | `invalid_state`        | `request.operations[i].score`                                                                          | Absent                       |
| Decision repeats a reason code                                                                 | `invalid_state`        | `request.operations[i].reasonCodes[j]` for the later occurrence                                        | Absent                       |
| Decision includes `other` without a present valid note                                         | `invalid_state`        | `request.operations[i].note`                                                                           | Absent                       |
| More than 64 operations                                                                        | `limit_exceeded`       | `request.operations`                                                                                   | `command_operations`         |
| Result would contain more than 64 current classifications                                      | `limit_exceeded`       | `request.operations`                                                                                   | `current_classifications`    |
| More than 10 decision reasons                                                                  | `limit_exceeded`       | `request.operations[i].reasonCodes`                                                                    | `feedback_reasons`           |
| Display name exceeds 120 code points                                                           | `limit_exceeded`       | `request.value.displayName`                                                                            | `display_name_code_points`   |
| Description exceeds 2,000 code points                                                          | `limit_exceeded`       | `request.value.description`                                                                            | `description_code_points`    |
| Decision or assessment note exceeds 2,000 code points                                          | `limit_exceeded`       | `request.operations[i].note`                                                                           | `note_code_points`           |
| Command key exceeds 200 ASCII characters                                                       | `limit_exceeded`       | `context.commandIdempotencyKey`                                                                        | `idempotency_key_characters` |
| Requested or next term revision exceeds its limit                                              | `limit_exceeded`       | `request.expectedRevision`                                                                             | `revision_number`            |
| Requested or next target version exceeds its limit                                             | `limit_exceeded`       | `request.expectedTargetVersion`                                                                        | `target_version`             |
| Later operation repeats a classification term, decision, or assessment dimension               | `duplicate_operation`  | `request.operations[i]` for the later occurrence                                                       | Absent                       |
| Target is missing or belongs to another workspace                                              | `target_not_found`     | `request.target`                                                                                       | Absent                       |
| Updated primary term is missing                                                                | `term_not_found`       | `request.termId`                                                                                       | Absent                       |
| Referenced classification term is missing or cross-workspace                                   | `term_not_found`       | `request.operations[i].termId`                                                                         | Absent                       |
| A new assignment references a retired term, including an already-current assignment            | `term_retired`         | `request.operations[i].termId`                                                                         | Absent                       |
| New or changed parent is missing, cross-workspace, retired, or self                            | `invalid_parent`       | `request.value.parentTermId`                                                                           | Absent                       |
| New or changed parent would create a cycle                                                     | `hierarchy_cycle`      | `request.value.parentTermId`                                                                           | Absent                       |
| Primary optimistic revision/version differs                                                    | `stale_revision`       | `request.expectedRevision` or `request.expectedTargetVersion`                                          | Absent                       |
| Existing command key has a different request digest                                            | `idempotency_conflict` | `context.commandIdempotencyKey`                                                                        | Absent                       |
| Adapter cannot atomically commit a prepared accepted command                                   | `persistence_failed`   | `persistence`                                                                                          | Absent                       |

Collection length and its collection budget are checked before visiting array
elements. Within an admitted array, validation visits indices in ascending
order; within each declared record or tagged branch, it visits fields in their
TypeScript declaration order. For operations, the boundary validates the
operation container and `kind`, then validates the identity needed for duplicate
detection: canonical `termId` for a classification, the single decision slot,
or a valid `dimension` for an assessment. It next checks whether that identity
was already mentioned and validates the remaining fields in declaration order.
Reason enum and duplicate checks likewise visit reason indices in ascending
order.

Identifier lexical validity precedes its length budget. Numeric type,
finiteness, safe-integer form, and non-negativity precede the inclusive numeric
budget; a safe non-negative integer above 2,147,483,647 is `limit_exceeded`.
Unicode scalar/text validity precedes the code-point budget. The first failing
issue under these rules is returned.

After the common closed-shape and request-local checks (which do not presume
whether a term already exists), term-command precedence is:

1. exact command replay or idempotency conflict;
2. workspace-scoped primary-term lookup;
3. expected term revision;
4. for an absent term, rejection of requested lifecycle `retired`;
5. exact current-value comparison, returning `unchanged` before any unchanged
   parent link is lifecycle-checked;
6. for creation or an actual `parentTermId` change only, parent existence,
   workspace, active lifecycle, self-parent, and cycle checks;
7. next-revision budget validation; and
8. atomic persistence.

An absent primary term with expected revision greater than 0 is
`term_not_found`; an existing primary term with expected revision 0 is
`stale_revision`. Rename, description change, retirement, and reactivation under
the same retired parent therefore reach semantic planning rather than
`invalid_parent`.

After the same common checks, target-command precedence is:

1. exact command replay or idempotency conflict;
2. workspace-scoped evidence-target and current-target lookup;
3. expected target version;
4. referenced-term existence and current lifecycle checks in ascending UUID
   order, followed by resulting-classification-count validation;
5. semantic delta calculation;
6. next-target-version budget validation when the delta is nonempty; and
7. atomic persistence.

Consequently, a new assignment command for a retired term returns
`term_retired` even if that assignment is already current, while an exact
same-key successful command still replays before current lifecycle checks.
An unchanged command at the maximum revision/version remains `unchanged`; only
a nonempty delta that would exceed the next-value budget is rejected.

Cross-workspace evidence targets resolve as `target_not_found`, and
cross-workspace primary or assignment terms resolve as `term_not_found`.
A cross-workspace parent follows the closed parent table and resolves as
`invalid_parent`. None of these outcomes reveals whether the ID exists in
another workspace.

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
responsible for closed input, exact code-point budgets, hierarchy cycle
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
   stale revision handling, the complete retired-parent transition table,
   concurrent-cycle serialization, and cycle rejection;
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
   after later state advances, plus rejected-key reuse and rejection of every
   non-canonical UUID spelling before digesting or UUIDv5 derivation;
8. hostile records, arrays, accessors, inherited setters, Proxy objects,
   dangerous keys, Unicode edge cases, all fixed budgets, deep freeze, safe
   issue shape, both exact discriminated result/receipt unions, the complete
   code/path/budget mapping, and non-echoing errors;
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
