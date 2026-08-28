# Manual Knowledge Core Contract

- Contract ID: `C-SLICE-B-KNOWLEDGE-r3`
- Status: Frozen implementation contract; acceptance requires the named TM1
  gate
- Date: 2026-08-14
- Upstream implementation baseline: `60964673b4b25f308dc0867e6cf0e1e5d678c063`
- Upstream evidence contract:
  [`C-SLICE-A-EVIDENCE-r2`](source-evidence-storage-contract.md)
- Upstream parser contract:
  [`C-SLICE-A-MARKDOWN-r2`](deterministic-markdown-structure-contract.md)
- Upstream curation contract:
  [`C-SLICE-A-CURATION-r3`](manual-curation-contract.md)
- Migration reservation: `000004_create_manual_knowledge_core.sql`

## Purpose

This contract freezes the first formal-knowledge write boundary after exact
source evidence, deterministic document structure, and manual curation.
It lets an authorized user turn one eligible Snapshot or Fragment, or an
explicit manual edit grounded in existing evidence/knowledge, into an atomic
set of knowledge-item and typed-relation revisions without AI, embeddings,
network access, browser transport, or a second write path.

The slice proves this transition:

```text
eligible exact evidence target
  or explicit manual edit
  -> one A0 manual command
  -> one atomic KnowledgeChangeSet
  -> stable KnowledgeItem / KnowledgeRelation identities
  -> immutable item / relation revisions
  -> exact Fragment provenance and historical-revision derivation
```

It deliberately stops before search projections and product transport.
The immediately following M1B retrieval increment will read this stable
canonical model and add deterministic exact, substring, source, state, and
relation retrieval. Search indexes remain rebuildable projections and are not
part of the database truth frozen here.

Revision 3 supersedes the unimplemented revision-2 candidate. Revision 2 closed
the input-ownership, numeric-revision, provenance-precedence, and
repository-projection ambiguities found by independent Maintenance and Test
review. Revision 3 only corrects its canonical-JSON capacity oracle by freezing
the independently maximized byte, value-count, and depth projections. It
changes no accepted ADR, table scope, dependency, authority level, protocol
branch, or deferred gate.

Independent Maintenance and Test re-review passed against fixed revision-3
commit `e25721491a263fb0ac5b98195acec9f88ef9f31e`. Backend and independent Test
implementation may now start from the accepted contract baseline. This freezes
the protocol for implementation; it does not pass TM1 or any deferred runtime
gate.

## Scope and deferred boundaries

Contract revision 3 includes:

- one A0 `manual_user` knowledge-change-set command;
- a closed authorization branch for either one current eligible
  intake-decision revision or an explicit A0 manual edit;
- stable caller-selected `KnowledgeItem` and `KnowledgeRelation` UUIDs;
- immutable, gap-free item and relation revisions with current pointers;
- closed system protocols for knowledge kind, epistemic role, review state,
  command origin, and operation kind;
- user-data relation-type keys without hard-coded personal vocabulary;
- exact Fragment citations, Fragment derivations, and historical item/relation
  revision derivations;
- atomic multi-operation create, revise, split, relate, correct, withdraw, and
  reactivate behavior through the same command;
- deterministic revision and change-set IDs, canonical request hashing,
  optimistic concurrency, and atomic idempotent replay;
- one typed, payload-free committed-change event in the same transaction;
- a forward PostgreSQL migration plus static SQL contract tests; and
- a pure application boundary plus a transaction-oriented repository port.

Contract revision 3 does not include:

- AI, OCR, embeddings, model proposals, processing runs, prompt/model identity,
  or automatic policy authority;
- `Candidate`, `ConflictCase`, merge redirects, destructive deletion, privacy
  erasure, or automatic conflict resolution;
- aliases, knowledge-target classification assignments, relation-type
  vocabulary records, collections, ordered membership, tree placement,
  `SavedView`, or workspace-bundle knowledge codecs;
- canonical event/valid-time fields, timeline projections, or temporal search;
- search projections, `pg_trgm`, token postings, ranking, relation traversal,
  RAG, or natural-language synthesis;
- Git/RSS/network fetching, real weekly import, secondary-source capture, or
  arbitrary file upload;
- HTTP, WebSocket, browser state, authentication, CSRF, external clients, or
  public API DTOs;
- event consumers, delivery attempts, acknowledgements, retry/dead-letter
  state, background publication, or an external event schema;
- real PostgreSQL parsing, catalog, transactions, locks, concurrency, runtime
  grants, Docker/Linux parity, backup, restore, or distribution readiness.

Those capabilities require later contracts and named gates. Their absence is
not a failure of this canonical write slice.

## Authority and module ownership

The `knowledge` application module exclusively owns formal knowledge writes.
Evidence, parser, curation, source, model, transport, and storage adapters never
insert or update knowledge tables directly.

Contract revision 3 implements only A0 manual authority:

```ts
export interface ManualKnowledgeContext {
  readonly effectiveWorkspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly authority: 'manual_user';
}
```

The trusted application boundary constructs this context after authorization.
`effectiveWorkspaceId`, `commandIdempotencyKey`, and `authority` are not accepted
from a business request body, source document, model output, import field, or
relation label. This contract does not claim that HTTP authentication exists.

The fixed operation origin is also `manual_user`. Authority answers who may
commit; operation origin answers which product path produced the change. They
are separate persisted fields even though this contract admits the same single
value for both.

## Closed authorization modes

Every command selects exactly one authorization branch:

```ts
export type KnowledgeSourceTargetRef =
  | Readonly<{kind: 'snapshot'; snapshotId: string}>
  | Readonly<{kind: 'fragment'; fragmentId: string}>;

export type ManualKnowledgeAuthorization =
  | Readonly<{
      kind: 'eligible_target';
      target: KnowledgeSourceTargetRef;
      expectedDecisionRevision: number;
    }>
  | Readonly<{kind: 'manual_edit'}>;
```

For `eligible_target`, the knowledge module derives the upstream curation target
ID and intake-decision ID using `C-SLICE-A-CURATION-r3`; callers cannot supply
either derived ID. At the transaction snapshot:

1. the target must exist in the effective workspace;
2. it must have a current intake decision;
3. the current decision revision must equal `expectedDecisionRevision`; and
4. its current action must be `full`, `split`, or `condense`.

`source_only`, `ignore`, and `needs_review` never authorize a knowledge command.
An eligible intake decision still does not commit anything automatically: the
current `manual_user` command is the explicit A0 write authority.

The three eligible actions authorize this command boundary; they do not infer
an operation count, knowledge kind, title, body, relation, or provenance shape.
`full` may still create several explicit items, while `split` may create one.
Only the submitted, validated operations determine the committed knowledge.

Changing classifications or assessments without changing the intake-decision
revision does not invalidate this authorization. Changing the decision does.
The committed change set stores the exact curation target, decision identity,
decision revision number, and decision-revision ID used at commit.

`manual_edit` records that the trusted A0 user deliberately edited formal
knowledge without claiming a current intake decision authorized the change. It
supports correction, withdrawal, reactivation, connection, and recomposition
when a source decision later changes. It does not make evidence optional, grant
AI or policy authority, or permit a second repository path. Its change set
stores the authorization kind and no curation target/decision identity.

Fragment provenance under `eligible_target` is bounded by the target:

- a Fragment target admits only that exact Fragment; and
- a Snapshot target admits any exact Fragment whose Resource and Snapshot
  identity matches that target.

Under `manual_edit`, a Fragment input may name any exact Fragment in the same
workspace. Formal-revision derivations under either branch may refer to any
exact historical item or relation revision in that workspace because that
revision already retains its own provenance. For `eligible_target`, those
derivations are additional context rather than a substitute for grounding:
every operation must cite or derive from at least one Fragment admitted by that
target.
No cross-workspace target, Fragment, item, relation, or revision is observable
through a distinct error.

## Closed command contract

Contract revision 3 exposes one command:

```ts
export interface ApplyManualKnowledgeChangeSetRequest {
  readonly authorization: Readonly<ManualKnowledgeAuthorization>;
  readonly operations: readonly ManualKnowledgeOperation[];
}

export type ManualKnowledgeOperation =
  Readonly<PutKnowledgeItemOperation> | Readonly<PutKnowledgeRelationOperation>;
```

An operation array is ordered for audit and receipt identity. Its semantic
effects are planned as one set: relation endpoints may name items created by
any item operation in the same command, regardless of operation order.

### Item operation

```ts
export type KnowledgeKind =
  | 'entity'
  | 'concept'
  | 'assertion'
  | 'event'
  | 'method'
  | 'framework'
  | 'resource'
  | 'work';

export type EpistemicRole =
  | 'source_excerpt'
  | 'source_claim'
  | 'summary'
  | 'inference'
  | 'user_assertion';

export type KnowledgeReviewState =
  | 'draft'
  | 'pending_review'
  | 'confirmed'
  | 'disputed'
  | 'rejected'
  | 'withdrawn';

export interface KnowledgeItemRevisionValue {
  readonly knowledgeKind: KnowledgeKind;
  readonly epistemicRole: EpistemicRole;
  readonly reviewState: KnowledgeReviewState;
  readonly title: string;
  readonly body?: string;
}

export interface PutKnowledgeItemOperation {
  readonly kind: 'put_item';
  readonly itemId: string;
  readonly expectedRevision: number;
  readonly value: Readonly<KnowledgeItemRevisionValue>;
  readonly provenance: Readonly<KnowledgeProvenanceInput>;
}
```

`KnowledgeItem` carries only stable identity, workspace, creation audit, and its
current revision pointer. Every listed value field and every provenance input
belongs to the immutable `KnowledgeRevision`.

Knowledge kind is structural, epistemic role states how the content was formed,
and review state states its lifecycle. None implies another. For example, an
`assertion` can be a `source_claim`, `inference`, or `user_assertion`; a
`confirmed` record is not automatically objective truth.

Creation uses `expectedRevision: 0` and produces revision 1. An existing item
requires its exact current positive revision. The first revision cannot be
`rejected` or `withdrawn`; those states require a previous visible revision.
Later manual revisions may move between any review states, including explicit
withdrawal and reactivation. History is never rewritten or deleted.

Equal titles, bodies, or kinds do not establish item identity and do not merge
items. A caller deliberately selects one stable item UUID; later duplicate or
merge workflows remain separate high-impact commands.

### Relation operation

```ts
export interface KnowledgeRelationRevisionValue {
  readonly subjectItemId: string;
  readonly relationTypeKey: string;
  readonly objectItemId: string;
  readonly epistemicRole: Exclude<EpistemicRole, 'source_excerpt'>;
  readonly reviewState: KnowledgeReviewState;
  readonly qualifier?: string;
}

export interface PutKnowledgeRelationOperation {
  readonly kind: 'put_relation';
  readonly relationId: string;
  readonly expectedRevision: number;
  readonly value: Readonly<KnowledgeRelationRevisionValue>;
  readonly provenance: Readonly<KnowledgeProvenanceInput>;
}
```

Direction is always `subjectItemId -> objectItemId`; there is no independent
direction flag. A relation cannot point from an item to itself in this
contract.

`relationTypeKey` is exact, stable user workspace data rather than a display
label. It is not a TypeScript enum, does not grant permission or algorithm
behavior, and is not seeded by a migration. Different key text means a
different type; renaming a later display label will not change the key. A future
versioned relation vocabulary may attach labels and governance to these keys
without allowing personal values into code.

For a stable relation identity, subject, relation-type key, and object are
immutable natural-identity fields. This contract allows later revisions to
change qualifier, epistemic role, review state, or provenance. Changing an
endpoint or relation type requires a new caller-selected relation ID. Multiple
independent relations with equal endpoints and type are allowed so sources and
conflicting claims do not collapse silently.

Creation uses `expectedRevision: 0`; an existing relation requires its current
revision. Its first revision cannot be `rejected` or `withdrawn`. A relation in
any state requires both endpoint item identities to exist in the resulting
command state. Item and relation lifecycles are independent: withdrawing or
rejecting an item does not silently revise, withdraw, or delete its relations,
and changing a relation does not revise either endpoint. Readers must expose
the current state of the relation and both endpoints instead of inferring one
from another.

### Provenance input

```ts
export type FormalKnowledgeRevisionRef =
  | Readonly<{kind: 'item'; itemId: string; revision: number}>
  | Readonly<{kind: 'relation'; relationId: string; revision: number}>;

export interface KnowledgeProvenanceInput {
  readonly citations: readonly string[];
  readonly fragmentDerivations: readonly string[];
  readonly knowledgeDerivations: readonly FormalKnowledgeRevisionRef[];
}
```

Each string in `citations` or `fragmentDerivations` is an exact Fragment UUID.
The three arrays are required even when one is empty. Every operation requires
at least one total provenance input. Under `eligible_target`, at least one
Fragment in `citations` or `fragmentDerivations` is required and must be admitted
by that target. Under `manual_edit`, exact same-workspace Fragment inputs and/or
historical formal-revision derivations satisfy the general provenance
requirement.

- A citation states that the output directly relies on that exact Fragment.
- A Fragment derivation states that the output was summarized, inferred,
  combined, or otherwise transformed from that Fragment; it does not claim a
  direct quotation.
- A knowledge derivation names an exact already-committed historical item or
  relation revision used to form the output.

The same Fragment cannot appear twice or in both Fragment arrays for one
operation. The same branch/stable-ID/revision tuple cannot appear twice. Input
order is preserved and participates in exact semantic equality.

Knowledge derivations cannot refer to an item or relation revision being created
by the same change set in this contract. This closes derivation cycles without
adding a graph topology protocol. Relation endpoints may still refer to items
created in the same change set; the relation itself uses direct Fragment
provenance or older formal revisions.

Role-specific provenance rules are:

| Epistemic role   | Required behavior                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source_excerpt` | Item only; exactly one citation, no derivations, a present body, and SHA-256 of the body's exact UTF-8 bytes equal to the Fragment's selected-text SHA-256 |
| `source_claim`   | At least one Fragment citation or Fragment derivation                                                                                                      |
| `summary`        | At least one Fragment or knowledge derivation; `eligible_target` still requires a target-scoped Fragment input                                             |
| `inference`      | At least one Fragment or knowledge derivation; citations alone are insufficient, and `eligible_target` still requires target grounding                     |
| `user_assertion` | At least one Fragment or historical formal-revision input; `eligible_target` still requires a target-scoped Fragment input                                 |

These rules distinguish a quote, a source's claim, a derived summary, an
inference, and the user's assertion. They do not rate factual reliability.

### Closed provenance preflight and issue selection

For each operation, the decoder completes a descriptor-only shallow preflight
of the `provenance` record and all three declared arrays before it reads any
array element value. In declaration order it first verifies each array
container, Proxy status, prototype, and own `length` data descriptor, then adds
the three lengths. A total greater than 64 returns `limit_exceeded` at
`request.operations[i].provenance` with budget
`operation_provenance_inputs` before any element UUID, tag, or revision is
examined and before index enumeration. If the total is admitted, the preflight
then verifies each array's own index keys and data descriptors, density, and
absence of inherited index accessors; a defect returns `invalid_shape` at that
exact array field. Only after that successful preflight are elements decoded in
`citations`, `fragmentDerivations`, then `knowledgeDerivations` order and by
ascending index within each array.

Let `P` mean `request.operations[i].provenance`, `V` mean
`request.operations[i].value`, and `K[j]` mean
`request.operations[i].provenance.knowledgeDerivations[j]`. The following
cross-field failures have one exact result after their referenced element
shapes and identifiers are valid:

| Scenario                                                                                                | Code                 | Exact path                                                                      |
| ------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------- |
| All three provenance arrays are empty                                                                   | `invalid_provenance` | `P`                                                                             |
| A Fragment repeats within `citations`                                                                   | `invalid_provenance` | Later `P.citations[j]`                                                          |
| A Fragment repeats within `fragmentDerivations` or repeats an earlier citation                          | `invalid_provenance` | Later `P.fragmentDerivations[j]`                                                |
| A formal revision tuple repeats                                                                         | `invalid_provenance` | Later `K[j]`                                                                    |
| A formal revision names an item or relation operated on by this command                                 | `invalid_provenance` | Exact `K[j]`                                                                    |
| An `eligible_target` operation has no admitted target-scoped Fragment after all Fragment inputs resolve | `invalid_provenance` | `P`                                                                             |
| `source_excerpt` body is absent                                                                         | `invalid_provenance` | `V.body`                                                                        |
| `source_excerpt` has other than one citation                                                            | `invalid_provenance` | `P.citations`                                                                   |
| `source_excerpt` has any Fragment derivation                                                            | `invalid_provenance` | `P.fragmentDerivations`                                                         |
| `source_excerpt` has any formal-revision derivation                                                     | `invalid_provenance` | `P.knowledgeDerivations`                                                        |
| `source_excerpt` body bytes do not match its resolved Fragment digest                                   | `invalid_provenance` | `V.body`                                                                        |
| `source_claim` has no Fragment citation or Fragment derivation                                          | `invalid_provenance` | `P`                                                                             |
| `inference` has citations but no Fragment or formal-revision derivation                                 | `invalid_provenance` | `P`                                                                             |
| A relation has equal subject and object IDs                                                             | `invalid_relation`   | `V.objectItemId`                                                                |
| An existing relation changes a natural-identity field                                                   | `invalid_relation`   | First changed field in `subjectItemId`, `relationTypeKey`, `objectItemId` order |

The all-empty rule precedes role-specific cardinality rules. Target grounding
precedes the remaining role-specific rules. For `source_excerpt`, after the
all-empty and target-grounding rules, the five rows above are checked in their
displayed order. The exact one-citation row therefore owns a zero-citation
failure when another derivation made the general provenance set non-empty. A
relation input containing the excluded `source_excerpt` enum value is instead
request-local `invalid_state` at `V.epistemicRole`. These paths do not depend on
which repository adapter or test fixture supplies the resolved rows.

## Closed input ownership and inspection

Context, request, and repository snapshot are untrusted closed inputs. The
boundary inspects a container before reading any caller-supplied value from it.
It uses the trusted Node.js Proxy predicate before reflection so rejecting a
Proxy invokes zero traps. It then admits only ordinary records whose prototype
is exactly `Object.prototype` and dense ordinary arrays whose prototype is
exactly `Array.prototype`. Declared fields and indices must be enumerable own
data properties. Extra or symbol keys, class/custom/null prototypes, own
accessors, inherited accessors for any declared field or array index,
dangerous keys, sparse arrays, and cycles are rejected without invoking a
caller-owned getter, setter, iterator, coercion hook, or other code.

Descriptor inspection precedes all field-value reads. In particular, an
accessor installed on `Object.prototype` for a declared record field or on
`Array.prototype` for a declared index is rejected even when ordinary
assignment would otherwise reach it. The boundary never uses ordinary
property assignment into a container that can dispatch such an inherited
setter.

After admission, every accepted record and array is projected into fresh,
implementation-owned ordinary containers. Record fields are created with
`Object.defineProperty` as own enumerable data properties; arrays are created
with their standard own `length` and populated only after the boundary has
proved that no relevant inherited index setter exists. Nested values are
recursively copied. The boundary never retains or freezes a caller-owned
container. Decoded context, request, repository state, successful plan,
receipt, result, and issue values are deeply frozen owned graphs. Mutating any
original caller value after decoding cannot change a digest, comparison,
prepared plan, result, or replay receipt.

For context or request, a malformed container uses the nearest declared path;
an own or inherited accessor for a declared field uses that field's path. Any
malformed repository container, accessor, ordering, relation, or value uses
`state`. These rules apply before hashing, lookup, sorting, comparison, or ID
derivation.

## Text and identifier boundary

Every UUID crossing the boundary must be lowercase canonical hyphenated text:

```text
^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$
```

The rule applies to the effective workspace, Snapshot/Fragment target, item and
relation IDs, endpoint IDs, Fragment inputs, and historical-revision stable IDs.
Other UUID spellings are rejected before hashing, lookup, sorting, comparison,
or UUIDv5 derivation. Repository snapshots use the same canonical form.

All text must contain valid Unicode scalar values and no NUL. No field is
trimmed, case-folded, Unicode-normalized, locale-collated, or translated.
"Whitespace" below means the ECMAScript whitespace and line-terminator set.

- `title` and `relationTypeKey` are non-empty and not all whitespace. They are
  single-line, have no leading or trailing whitespace, and contain no C0, DEL,
  C1, U+2028, or U+2029 code point.
- present `body` and `qualifier` contain at least one non-whitespace scalar, use
  LF rather than CR, U+2028, or U+2029 for line breaks, and contain no C0, DEL,
  or C1 control other than LF or horizontal tab.
- absent optional fields and present fields are different protocol values.

The fixed budgets are:

| Budget                                | Limit                                                        |
| ------------------------------------- | ------------------------------------------------------------ |
| Operations per change set             | 64                                                           |
| Total provenance inputs per operation | 64                                                           |
| Title                                 | 300 Unicode code points                                      |
| Relation-type key                     | 120 Unicode code points                                      |
| Body                                  | 20,000 Unicode code points                                   |
| Qualifier                             | 2,000 Unicode code points                                    |
| Command idempotency key               | 200 ASCII characters from `[A-Za-z0-9._:-]`                  |
| Revision number                       | signed 32-bit positive integer; expected creation value is 0 |

Collection length is checked before visiting collection elements. Text lexical
validity is checked before its code-point budget.

Operation `expectedRevision` accepts positive zero for creation or an integer
from 1 through 2,147,483,647. `expectedDecisionRevision` and every historical
derivation `revision` accept only 1 through 2,147,483,647. For each field, a
wrong primitive type is `invalid_shape`; negative zero
(`Object.is(value, -0)`), a negative value, a non-finite value, a non-integer,
or a non-safe integer is `invalid_state`; and a safe integer above
2,147,483,647 is `limit_exceeded` with budget
`revision_number`. Thus zero is valid only for operation creation, never for a
curation-decision expectation or historical derivation. Repository revision
and current-revision values must be positive signed 32-bit integers; a defect
there is `invalid_shape` at `state`.

The closed field and collection limits make a public encoded-byte rejection
unreachable. No single saturated request maximizes every encoder measure. The
independent upper bounds across closed-decoded canonical command projections
are:

- **UTF-8 bytes:** the longer `eligible_target` authorization, 64 maximized
  `put_item` operations, and 64 maximized relation-revision derivations per
  operation produce 5,601,498 bytes including the terminal LF, visit 17,294
  canonical JSON values, and have depth 7;
- **canonical JSON values:** the longer `eligible_target` authorization, 64
  maximized `put_relation` operations with present maximized qualifiers, and 64
  maximized relation-revision derivations per operation visit 17,358 values,
  produce 954,074 bytes including the terminal LF, and have depth 7; and
- **JSON depth:** every admitted shape has depth at most 7.

These are encoder-input bounds after closed decoding, not claims that each
saturated `eligible_target` projection later satisfies target grounding against
repository state. Every measure remains below the existing encoder's internal
8 MiB, 100,000-value, and depth-64 defenses. Those encoder limits are
implementation invariants, not request budgets: this protocol has no
`request_bytes` budget or issue branch. Reaching an encoder limit after
successful closed decoding is an implementation fault and cannot be mapped to
a caller-visible rejection.

## Stable identities

Caller-selected item and relation IDs provide durable identity independent of
title, body, evidence location, parser output, or model behavior. Every derived
ID uses RFC 9562 UUID version 5 and lowercase canonical output:

```text
knowledge change set:
  namespace = effective_workspace_id
  name      = struinfo:knowledge-change-set:v1:<command_idempotency_key>

knowledge revision:
  namespace = item_id
  name      = struinfo:knowledge-revision:v1:<revision_number>

relation revision:
  namespace = relation_id
  name      = struinfo:knowledge-relation-revision:v1:<revision_number>

committed-change event:
  namespace = knowledge_change_set_id
  name      = struinfo:knowledge-change-committed-event:v1
```

Revision numbers start at 1, increase without gaps for one stable identity, and
fit a signed 32-bit positive integer. A semantically unchanged operation creates
no revision. The change-set ID is stable for a command key; a different request
under that key is an idempotency conflict, not another change set.

Every revision after revision 1 stores the immediately preceding revision ID as
`previousRevisionId`; revision 1 stores no predecessor. A correction,
withdrawal, reactivation, or value-restoring compensation is therefore another
append-only revision in the same linear chain. Revision 1 does not separately
name a non-immediate historical revision as "reverted" or "corrected"; that
higher-level workflow remains deferred rather than being inferred from equal
content.

## Semantic equality and operation behavior

Exact equality compares every item or relation value field, optional-field
presence, and ordered provenance input after validation. Evidentiary change is
a semantic revision even when title/body/relation fields are unchanged.

One change set may contain at most one operation for a given item ID and at most
one operation for a given relation ID. The later duplicate returns
`duplicate_operation`. Item and relation UUID namespaces are independent, so an
item and relation may coincidentally use equal UUID text.

For each operation:

1. missing identity plus `expectedRevision: 0` creates revision 1;
2. missing identity plus a positive expected revision returns its not-found
   issue;
3. existing identity plus expected revision 0 or any non-current revision
   returns `stale_revision`;
4. existing identity plus exact current revision and equal value/provenance is
   `unchanged`; and
5. existing identity plus exact current revision and a delta appends the next
   immutable revision and advances its current pointer.

The overall change set is `applied` when at least one operation is applied and
`unchanged` only when every operation is unchanged. An accepted unchanged set
still stores its change-set row and operation receipts so exact replay remains
durable. It does not append domain revisions.

Split behavior is multiple item operations in one command; an `eligible_target`
command binds that split to one authorized target.
Connection behavior is a relation operation. Correction, withdrawal, and
reactivation are new revisions. No operation overwrites evidence, rewrites old
knowledge revisions, or copies a source Snapshot into a knowledge row.

For this direct A0 command, proposal and authorization happen at the trusted
application boundary and only the atomic committed change set is persisted.
The durable `KnowledgeChangeSet` does not pass through a partially persisted
`proposed` or `authorized` state. Candidate and policy-authorized workflows may
add those pre-commit states later without creating another formal write path.

## Closed repository snapshot

The pure planner receives one closed projection, not a database client or an
open object graph:

```ts
export type KnowledgeCurationTargetState =
  | Readonly<{
      workspaceId: string;
      targetId: string;
      kind: 'snapshot';
      resourceId: string;
      snapshotId: string;
    }>
  | Readonly<{
      workspaceId: string;
      targetId: string;
      kind: 'fragment';
      fragmentId: string;
    }>;

export interface KnowledgeIntakeDecisionState {
  readonly workspaceId: string;
  readonly targetId: string;
  readonly decisionId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
  readonly action:
    'full' | 'split' | 'condense' | 'source_only' | 'ignore' | 'needs_review';
}

export interface KnowledgeFragmentState {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly fragmentId: string;
  readonly selectedTextSha256: string;
}

export interface KnowledgeItemState {
  readonly workspaceId: string;
  readonly itemId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
}

export interface KnowledgeRevisionState {
  readonly workspaceId: string;
  readonly itemId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly previousRevisionId?: string;
  readonly value: Readonly<KnowledgeItemRevisionValue>;
  readonly provenance: Readonly<KnowledgeProvenanceInput>;
}

export interface KnowledgeRelationState {
  readonly workspaceId: string;
  readonly relationId: string;
  readonly subjectItemId: string;
  readonly relationTypeKey: string;
  readonly objectItemId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
}

export interface KnowledgeRelationRevisionState {
  readonly workspaceId: string;
  readonly relationId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly previousRevisionId?: string;
  readonly value: Readonly<KnowledgeRelationRevisionValue>;
  readonly provenance: Readonly<KnowledgeProvenanceInput>;
}

export interface StoredKnowledgeChangeSetState {
  readonly workspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly changeSetId: string;
  readonly requestSha256: string;
  readonly authorization: Readonly<KnowledgeAuthorizationReceipt>;
  readonly originalOutcome: KnowledgeOriginalOutcome;
  readonly operationCount: number;
}

export type StoredKnowledgeChangeOperationState =
  | (Readonly<{
      workspaceId: string;
      changeSetId: string;
    }> &
      Extract<KnowledgeOperationReceipt, {operationKind: 'put_item'}>)
  | (Readonly<{
      workspaceId: string;
      changeSetId: string;
    }> &
      Extract<KnowledgeOperationReceipt, {operationKind: 'put_relation'}>);

export interface KnowledgeChangeEventState {
  readonly workspaceId: string;
  readonly eventId: string;
  readonly eventKind: 'knowledge_change_set_committed';
  readonly eventSchemaVersion: 1;
  readonly changeSetId: string;
}

export interface ManualKnowledgeRepositorySnapshot {
  readonly curationTargets: readonly KnowledgeCurationTargetState[];
  readonly intakeDecisions: readonly KnowledgeIntakeDecisionState[];
  readonly fragments: readonly KnowledgeFragmentState[];
  readonly items: readonly KnowledgeItemState[];
  readonly revisions: readonly KnowledgeRevisionState[];
  readonly relations: readonly KnowledgeRelationState[];
  readonly relationRevisions: readonly KnowledgeRelationRevisionState[];
  readonly changeSets: readonly StoredKnowledgeChangeSetState[];
  readonly changeOperations: readonly StoredKnowledgeChangeOperationState[];
  readonly changeEvents: readonly KnowledgeChangeEventState[];
}
```

All containers and nested values obey the closed inspection and owned-copy
rules above. Every row belongs to the effective workspace. Canonical UUID and
ASCII key strings compare by ascending UTF-8 bytes; numeric tuple members
compare arithmetically. The ten arrays use exactly these sort and uniqueness
rules:

| Array               | Ascending sort tuple                   | Required unique identities                           |
| ------------------- | -------------------------------------- | ---------------------------------------------------- |
| `curationTargets`   | `(targetId)`                           | `targetId`                                           |
| `intakeDecisions`   | `(targetId, decisionId)`               | `targetId`; independently `decisionId`               |
| `fragments`         | `(fragmentId)`                         | `fragmentId`                                         |
| `items`             | `(itemId)`                             | `itemId`                                             |
| `revisions`         | `(itemId, revision)`                   | `(itemId, revision)`; independently `revisionId`     |
| `relations`         | `(relationId)`                         | `relationId`                                         |
| `relationRevisions` | `(relationId, revision)`               | `(relationId, revision)`; independently `revisionId` |
| `changeSets`        | `(commandIdempotencyKey, changeSetId)` | `commandIdempotencyKey`; independently `changeSetId` |
| `changeOperations`  | `(changeSetId, operationIndex)`        | `(changeSetId, operationIndex)`                      |
| `changeEvents`      | `(changeSetId, eventId)`               | `changeSetId`; independently `eventId`               |

The snapshot contains an exact closure, not an arbitrary superset. Its rows
have one of two mutually exclusive shapes:

1. **Stored-command closure.** `changeSets` contains exactly one row whose key
   equals the context key; `changeOperations` contains exactly its declared
   operation count; `changeEvents` contains exactly its one committed event;
   and the other seven arrays are empty. This branch is enough to reconstruct
   replay or detect a digest conflict without observing later domain state.
2. **New-command closure.** `changeSets`, `changeOperations`, and
   `changeEvents` are empty. For `eligible_target`, `curationTargets` contains
   the requested target if it exists and `intakeDecisions` contains that
   target's current decision if it exists; each is otherwise empty and neither
   contains another target. For `manual_edit`, both arrays are empty.
   `fragments` contains exactly every existing distinct Fragment named by any
   citation or Fragment derivation. `items` contains exactly every existing
   distinct item named as a primary item, relation endpoint, or historical
   item derivation. `relations` contains exactly every existing distinct
   relation named as a primary relation or historical relation derivation.
   `revisions` contains each loaded item's current revision plus every existing
   requested historical item revision, with identical rows de-duplicated.
   `relationRevisions` follows the same rule for relations.

An identity that does not exist in the effective workspace contributes no row;
that absence drives the declared not-found result. An unrelated row, a second
candidate for a single current target/decision/command/event, a row outside the
listed closure, or a row omitted from a returned existing identity's required
closure is malformed state rather than additional context. The pure planner
validates this projection; TM2 later proves that the repository adapter loads
it truthfully under the required transaction and locks.

For exact-closure validation, the requested identity sets come from the already
decoded request. The pure planner rejects unrelated rows and detectable gaps
inside returned identities, such as a missing current revision. An entirely
absent requested business identity is the ordinary not-found representation;
the row arrays alone cannot distinguish that database fact from an adapter
that failed to load an existing identity. Therefore completeness for wholly
absent lookups is an explicit repository-adapter obligation proved against
PostgreSQL in TM2, not a TM1 claim or a fabricated snapshot field.

Current pointers must resolve an exact returned revision. A loaded item or
relation revision must include its complete ordered provenance arrays, including
empty arrays where allowed; provenance is never silently inherited from the
preceding revision. Derived IDs,
predecessor shape, relation stable fields, Fragment SHA-256, operation count,
contiguous operation indices, receipt branches, stored authorization, and the
one deterministic committed event for a loaded change set must be internally
consistent. Any malformed, missing required, extra, out-of-order, duplicated,
cross-workspace, or inconsistent repository value returns
`invalid_shape` at `state`; it is not interpreted as ordinary not-found state.
An absent requested business identity is represented by no corresponding valid
row, not by a nullable or partial row.

## Result and issue contract

The command exposes one closed discriminated result union:

```ts
export type KnowledgeAuthorizationReceipt =
  | Readonly<{
      kind: 'eligible_target';
      targetId: string;
      decisionId: string;
      decisionRevision: number;
      decisionRevisionId: string;
    }>
  | Readonly<{kind: 'manual_edit'}>;

export type KnowledgeOriginalOutcome = 'applied' | 'unchanged';
export type KnowledgeOperationOutcome = 'applied' | 'unchanged';

export type KnowledgeOperationReceipt =
  | Readonly<{
      operationIndex: KnowledgeBoundedIndex;
      operationKind: 'put_item';
      itemId: string;
      resultingRevision: number;
      resultingRevisionId: string;
      outcome: KnowledgeOperationOutcome;
    }>
  | Readonly<{
      operationIndex: KnowledgeBoundedIndex;
      operationKind: 'put_relation';
      relationId: string;
      resultingRevision: number;
      resultingRevisionId: string;
      outcome: KnowledgeOperationOutcome;
    }>;

export interface ManualKnowledgeReceipt<
  Outcome extends KnowledgeOriginalOutcome = KnowledgeOriginalOutcome,
> {
  readonly workspaceId: string;
  readonly commandIdempotencyKey: string;
  readonly changeSetId: string;
  readonly commandKind: 'apply_manual_knowledge_change_set';
  readonly authorization: KnowledgeAuthorizationReceipt;
  readonly originalOutcome: Outcome;
  readonly operations: readonly KnowledgeOperationReceipt[];
}

export type ApplyManualKnowledgeChangeSetResult =
  | Readonly<{
      status: 'applied';
      receipt: ManualKnowledgeReceipt<'applied'>;
    }>
  | Readonly<{
      status: 'unchanged';
      receipt: ManualKnowledgeReceipt<'unchanged'>;
    }>
  | Readonly<{
      status: 'replayed';
      receipt: ManualKnowledgeReceipt;
    }>
  | Readonly<{
      status: 'rejected';
      issue: KnowledgeIssue;
    }>;
```

Receipt operation order exactly matches request order. The authorization
receipt exposes the exact durable basis of the commit without source content.
Replayed results preserve that basis, the original outcomes, and revisions even
after later commands advance state.

```ts
export type KnowledgeIssueCode =
  | 'invalid_shape'
  | 'invalid_identifier'
  | 'invalid_text'
  | 'invalid_state'
  | 'limit_exceeded'
  | 'duplicate_operation'
  | 'curation_target_not_found'
  | 'curation_not_eligible'
  | 'stale_curation_revision'
  | 'fragment_not_found'
  | 'fragment_out_of_scope'
  | 'item_not_found'
  | 'relation_not_found'
  | 'revision_not_found'
  | 'stale_revision'
  | 'invalid_provenance'
  | 'invalid_relation'
  | 'idempotency_conflict'
  | 'persistence_failed';

export type KnowledgeBudgetName =
  | 'change_set_operations'
  | 'operation_provenance_inputs'
  | 'title_code_points'
  | 'relation_type_code_points'
  | 'body_code_points'
  | 'qualifier_code_points'
  | 'idempotency_key_characters'
  | 'revision_number';

export type KnowledgeBoundedIndex =
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

export type KnowledgeIssuePath =
  | 'context'
  | 'context.effectiveWorkspaceId'
  | 'context.commandIdempotencyKey'
  | 'context.authority'
  | 'request'
  | 'request.authorization'
  | 'request.authorization.kind'
  | 'request.authorization.target'
  | 'request.authorization.target.kind'
  | 'request.authorization.target.snapshotId'
  | 'request.authorization.target.fragmentId'
  | 'request.authorization.expectedDecisionRevision'
  | 'request.operations'
  | `request.operations[${KnowledgeBoundedIndex}]`
  | `request.operations[${KnowledgeBoundedIndex}].kind`
  | `request.operations[${KnowledgeBoundedIndex}].itemId`
  | `request.operations[${KnowledgeBoundedIndex}].relationId`
  | `request.operations[${KnowledgeBoundedIndex}].expectedRevision`
  | `request.operations[${KnowledgeBoundedIndex}].value`
  | `request.operations[${KnowledgeBoundedIndex}].value.knowledgeKind`
  | `request.operations[${KnowledgeBoundedIndex}].value.epistemicRole`
  | `request.operations[${KnowledgeBoundedIndex}].value.reviewState`
  | `request.operations[${KnowledgeBoundedIndex}].value.title`
  | `request.operations[${KnowledgeBoundedIndex}].value.body`
  | `request.operations[${KnowledgeBoundedIndex}].value.subjectItemId`
  | `request.operations[${KnowledgeBoundedIndex}].value.relationTypeKey`
  | `request.operations[${KnowledgeBoundedIndex}].value.objectItemId`
  | `request.operations[${KnowledgeBoundedIndex}].value.qualifier`
  | `request.operations[${KnowledgeBoundedIndex}].provenance`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.citations`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.citations[${KnowledgeBoundedIndex}]`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.fragmentDerivations`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.fragmentDerivations[${KnowledgeBoundedIndex}]`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.knowledgeDerivations`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.knowledgeDerivations[${KnowledgeBoundedIndex}]`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.knowledgeDerivations[${KnowledgeBoundedIndex}].kind`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.knowledgeDerivations[${KnowledgeBoundedIndex}].itemId`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.knowledgeDerivations[${KnowledgeBoundedIndex}].relationId`
  | `request.operations[${KnowledgeBoundedIndex}].provenance.knowledgeDerivations[${KnowledgeBoundedIndex}].revision`
  | 'state'
  | 'persistence';

export type KnowledgeIssue =
  | Readonly<{
      code: 'limit_exceeded';
      path: KnowledgeIssuePath;
      budget: KnowledgeBudgetName;
    }>
  | Readonly<{
      code: Exclude<KnowledgeIssueCode, 'limit_exceeded'>;
      path: KnowledgeIssuePath;
    }>;
```

Issue objects contain no rejected values, titles, bodies, relation labels,
Fragment text, database details, exception messages, stacks, or credentials.
Dynamic indices are zero-based decimal values in the closed 0-through-63 union.
A missing declared field uses its exact field path. An unknown extra key,
dangerous key, invalid container/prototype, Proxy, symbol, sparse array, or
cycle uses the nearest declared container path, so caller-controlled key text
is never echoed. An own or inherited accessor for a declared field uses that
declared field path. Inspection and owned-copy semantics are fixed by the
closed-input section above. Every result, receipt, issue, and prepared plan is
deeply frozen.

The stable scenario mapping is:

| Scenario                                                                                                                    | Code                                     | Path                                                                                    | Budget                        |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------- |
| Invalid ordinary-record, dense-array, own-property, declared-field, tagged-union, descriptor, or closed-state shape         | `invalid_shape`                          | Nearest declared container or field; repository input uses `state`                      | Absent                        |
| Non-canonical UUID in context/request                                                                                       | `invalid_identifier`                     | Exact UUID field                                                                        | Absent                        |
| Non-canonical UUID or SHA-256, bad derived ID, ordering/duplicate defect, or inconsistent repository projection             | `invalid_shape`                          | `state`                                                                                 | Absent                        |
| Empty or lexically invalid command key                                                                                      | `invalid_identifier`                     | `context.commandIdempotencyKey`                                                         | Absent                        |
| Invalid Unicode scalar, control, line-break, boundary whitespace, or empty present text                                     | `invalid_text`                           | Exact text field                                                                        | Absent                        |
| Unknown authority, authorization kind, target kind, operation kind, knowledge kind, epistemic role, or review state         | `invalid_state`                          | Exact discriminator/enum field                                                          | Absent                        |
| Revision field has the wrong primitive type                                                                                 | `invalid_shape`                          | Exact revision field                                                                    | Absent                        |
| Revision field is negative zero, negative, non-finite, non-integer, or not a safe integer                                   | `invalid_state`                          | Exact revision field                                                                    | Absent                        |
| `expectedDecisionRevision` or historical derivation revision is zero                                                        | `invalid_state`                          | Exact revision field                                                                    | Absent                        |
| Operations array is empty                                                                                                   | `invalid_state`                          | `request.operations`                                                                    | Absent                        |
| After lookup proves an identity is absent, its first requested revision is rejected or withdrawn                            | `invalid_state`                          | Operation review-state field                                                            | Absent                        |
| More than 64 operations                                                                                                     | `limit_exceeded`                         | `request.operations`                                                                    | `change_set_operations`       |
| More than 64 total provenance inputs for one operation                                                                      | `limit_exceeded`                         | Operation provenance                                                                    | `operation_provenance_inputs` |
| Text exceeds its fixed code-point limit                                                                                     | `limit_exceeded`                         | Exact text field                                                                        | Matching text budget          |
| Command key exceeds 200 characters                                                                                          | `limit_exceeded`                         | `context.commandIdempotencyKey`                                                         | `idempotency_key_characters`  |
| Request revision field or a calculated next revision exceeds signed positive 32-bit range                                   | `limit_exceeded`                         | Exact request revision field; calculated next revision uses operation expected revision | `revision_number`             |
| Later operation repeats an earlier item or relation ID of the same kind                                                     | `duplicate_operation`                    | Later `request.operations[i]`                                                           | Absent                        |
| `eligible_target` target is missing or cross-workspace                                                                      | `curation_target_not_found`              | `request.authorization.target`                                                          | Absent                        |
| `eligible_target` decision is absent, or its action is `source_only`, `ignore`, or `needs_review`                           | `curation_not_eligible`                  | `request.authorization`                                                                 | Absent                        |
| `eligible_target` current decision revision differs from expected                                                           | `stale_curation_revision`                | `request.authorization.expectedDecisionRevision`                                        | Absent                        |
| Fragment missing or cross-workspace                                                                                         | `fragment_not_found`                     | Exact Fragment input                                                                    | Absent                        |
| Fragment exists but is outside an `eligible_target` authorization                                                           | `fragment_out_of_scope`                  | Exact Fragment input                                                                    | Absent                        |
| Primary item or relation identity is absent for a positive expected revision                                                | `item_not_found` or `relation_not_found` | Operation identity                                                                      | Absent                        |
| Relation endpoint item is absent/cross-workspace                                                                            | `item_not_found`                         | Exact endpoint field                                                                    | Absent                        |
| Historical derivation revision is absent/cross-workspace                                                                    | `revision_not_found`                     | Exact knowledge-derivation element                                                      | Absent                        |
| Existing primary identity does not have the expected current revision                                                       | `stale_revision`                         | Operation expected revision                                                             | Absent                        |
| Empty provenance, missing target grounding, duplicate input, role mismatch, same-change-set derivation, or excerpt mismatch | `invalid_provenance`                     | Exact path in the closed provenance table                                               | Absent                        |
| Self relation or changed stable relation identity                                                                           | `invalid_relation`                       | Exact path in the closed provenance/relation table                                      | Absent                        |
| Existing command key has a different canonical request digest                                                               | `idempotency_conflict`                   | `context.commandIdempotencyKey`                                                         | Absent                        |
| Adapter cannot atomically commit the accepted plan                                                                          | `persistence_failed`                     | `persistence`                                                                           | Absent                        |

## Deterministic validation and state precedence

Closed request validation visits fields in TypeScript declaration order.
Arrays are validated by ascending index. For operations, the boundary validates
the container, `kind`, primary ID, and expected revision before value and
provenance fields. Duplicate primary operations are detected immediately after
the later primary ID is valid. Before any provenance element, the boundary runs
the closed shallow preflight and total-count check specified above. It then
detects Fragment and formal-revision input duplicates at the exact later
element.

After request-local checks and canonical request hashing, state-dependent
precedence is:

1. exact same-key replay or same-key `idempotency_conflict`;
2. for `eligible_target`, workspace-scoped curation target lookup;
3. for `eligible_target`, current intake-decision existence;
4. for `eligible_target`, expected intake-decision revision;
5. for `eligible_target`, current intake-action eligibility;
6. validate primary item/relation expected revisions and missing-identity
   first-revision lifecycle in request order;
7. resolve Fragment inputs in request/array order, including conditional target
   scope;
8. resolve historical item/relation revision derivations in request/array
   order;
9. resolve relation endpoint identities against existing and same-command
   items;
10. validate target grounding, the closed role-specific provenance table, and
    stable relation identity in the frozen order above;
11. calculate exact semantic deltas and next-revision budgets; and
12. atomically persist or return `persistence_failed`.

Repository adapters may acquire locks in canonical sorted order, but error
selection remains request order over the closed loaded snapshot. Same-key
successful replay occurs before current curation, item, relation, Fragment, or
lifecycle validation, so a durable receipt survives later state changes.

## Idempotency, concurrency, and atomicity

Command identity is
`(effective_workspace_id, command_idempotency_key)` for the knowledge module.
The canonical request envelope is:

```ts
interface ManualKnowledgeCommandProjection {
  readonly schemaVersion: 'struinfo.manual-knowledge-change-set.v1';
  readonly authority: 'manual_user';
  readonly operationOrigin: 'manual_user';
  readonly commandKind: 'apply_manual_knowledge_change_set';
  readonly workspaceId: string;
  readonly request: ApplyManualKnowledgeChangeSetRequest;
}
```

Absent optional fields remain absent. Array order remains exact. The existing
canonical JSON encoder produces UTF-8 plus one terminal LF using its internal
8 MiB defense, and SHA-256 stores only its lowercase digest in the database.
Closed request budgets prove every admitted projection fits, so the encoder
limit is not a public validation branch.

The rules are:

1. same key plus equal digest replays the original receipt;
2. same key plus different digest returns `idempotency_conflict`;
3. a rejected command claims no key;
4. an accepted applied or unchanged command stores one durable change set and
   its complete ordered operation receipt;
5. all revision inserts, provenance inserts, current-pointer changes, operation
   rows, change-set receipt, and its one typed committed-change event commit in
   one transaction; and
6. no result or adapter failure may expose a partial plan.

The PostgreSQL adapter locks the owning workspace row first. It then locks
existing primary item and relation identities in ascending canonical UUID
order, followed by referenced endpoint identities and, for `eligible_target`,
the curation target/decision; historical revision lookups use the same
transaction snapshot. The exact lock protocol and race behavior require TM2;
TM1 proves only the closed pure plan and the repository-port intent.

## PostgreSQL migration contract

`000004_create_manual_knowledge_core.sql` is a forward-only migration under the
existing first-party runner. It may add the one composite uniqueness constraint
needed to bind an intake decision to its curation target, then creates exactly
these thirteen tables:

1. `knowledge_change_set`;
2. `knowledge_item`;
3. `knowledge_revision`;
4. `knowledge_relation`;
5. `knowledge_relation_revision`;
6. `knowledge_change_operation`;
7. `knowledge_revision_fragment_input`;
8. `knowledge_revision_item_input`;
9. `knowledge_revision_relation_input`;
10. `relation_revision_fragment_input`;
11. `relation_revision_item_input`;
12. `relation_revision_relation_input`; and
13. `knowledge_change_event`.

The added upstream constraint is exactly
`intake_decision(workspace_id, target_id, decision_id)` and does not change
curation semantics or historical rows.

Minimum relational shape:

- `knowledge_change_set`: stable change-set ID, command key, request SHA-256,
  fixed command kind, authority and origin, authorization kind, the exact
  curation target/current decision revision only for `eligible_target`,
  committed outcome, operation count, and creation time;
- `knowledge_item`: stable item ID, current revision number and ID, and creation
  time;
- `knowledge_revision`: item/revision identities, gap-free ordinal, kind,
  epistemic role, review state, title, optional body, owning change set and
  operation ordinal, optional immediate predecessor revision ID, and creation
  time;
- `knowledge_relation`: stable relation ID, immutable subject/type-key/object
  identity, current revision number and ID, and creation time;
- `knowledge_relation_revision`: relation/revision identities, gap-free ordinal,
  subject, relation-type key, object, epistemic role, review state, optional
  qualifier, owning change set and operation ordinal, optional immediate
  predecessor revision ID, and creation time;
- `knowledge_change_operation`: change set, zero-based contiguous request
  ordinal, operation branch, one exact typed item-or-relation identity,
  applied/unchanged outcome, and exact resulting revision number and ID;
- Fragment-input tables: output revision, input kind `citation` or `derivation`,
  kind-local ordinal, and exact Fragment ID;
- item-input tables: output revision, knowledge-input ordinal, and exact input
  KnowledgeItem/revision identity;
- relation-input tables: output revision, knowledge-input ordinal, and exact
  input KnowledgeRelation/revision identity; and
- `knowledge_change_event`: deterministic event ID, fixed event kind
  `knowledge_change_set_committed`, fixed schema version 1, exact change-set ID,
  and creation time.

Every primary key, unique identity, foreign key, lookup, and current pointer is
workspace-first. Foreign keys use real typed target tables, not an unconstrained
object-type/object-ID pair. Item and relation current pointers are non-null and
reference their own exact revision. Current-pointer foreign keys may be
deferrable so identity plus first revision can commit atomically.

History, provenance, and change-event rows are append-only-compatible. The
migration exposes
no `ON DELETE CASCADE`, mutable history column, arbitrary JSON payload, trigger,
view, search index, extension, runtime role, grant, policy, AI table, generic
outbox payload, delivery state, seed value, personal label, or real source text.
Ordinary B-tree indexes needed by declared workspace-first lookups and foreign
keys are allowed.

`knowledge_change_event.event_id` uses the committed-change UUIDv5 formula in
this contract. Every accepted change set has exactly one event row by a unique
workspace-first change-set reference in the same transaction, including an
unchanged change set because it is a durable accepted command. Rejected commands
have none. The event carries no JSON, titles, bodies, relation keys, Fragment
text, or destination. Future delivery code reads the exact immutable
change-set/operation rows and owns separate consumer/delivery state; it cannot
turn this event into a second write path.

The two revision-table predecessor references are typed self-foreign keys. A
revision-1 row has no predecessor; revision `n > 1` references exactly revision
`n - 1` of the same stable identity. The application validates this arithmetic
where an ordinary foreign key cannot express it.

Database timestamps are generated for audit and do not participate in semantic
equality, deterministic identity, or the command digest. Application-owned
revision ordinals and provenance ordinals are exact integers; the application
validates their gap-free completeness where ordinary constraints are
insufficient.

The database may enforce universal checks, but the application remains
responsible for closed input, Unicode/code-point budgets, UUIDv5, request
hash, first-error order, conditional curation eligibility, exact Fragment
scope, excerpt digest, relation lifecycle, and authorization.

Migration files are immutable after acceptance. Rollback uses a separately
reviewed compensation migration or consistent PostgreSQL-plus-Blob restore; it
never edits `000004` after application.

## Pure application and repository boundary

Implementation lives under `apps/server/src/modules/knowledge/` and exposes
plain TypeScript protocols plus pure decoding, identity, validation, comparison,
and planning functions. Domain code does not import NestJS, PostgreSQL, Drizzle,
pg-boss, filesystem, network, environment, system clock, randomness, locale,
AI, browser, or transport modules.

The pure boundary must be able to:

- decode and deep-freeze the closed context/request;
- derive target, decision, change-set, and revision IDs;
- construct the canonical request digest;
- reconcile exact replay and idempotency conflict;
- validate a closed repository snapshot of curation, evidence, knowledge, and
  relation state;
- calculate exact applied/unchanged operations, append-only rows, provenance
  rows, the typed committed-change event, and pointer compare-and-set values;
- produce no persistence plan on any rejection; and
- reconstruct a replay receipt from stored change-set and operation rows.

The repository port exposes one transaction per command, one closed lock/load
snapshot operation, inserts for change sets, operations, identities, immutable
revisions, provenance, and the committed-change event, and compare-and-set
methods only for item/relation current pointers. It exposes no history/event
update/delete method and no generic SQL, JSON, or cross-workspace lookup escape
hatch.

Real PostgreSQL adapters and runtime grants remain behind TM2. A static
migration and pure boundary must agree exactly before TM1 can pass.

## Personal-data and artifact boundary

Real titles, bodies, relation-type keys, qualifiers, states, citations,
derivations,
and command history are private workspace data. They belong in external
PostgreSQL/Blob state and later workspace exports, never in source code,
environment variables, defaults, migration seeds, tracked fixtures, frontend
mocks, logs, packages, or container images.

Tracked tests use generated synthetic UUIDs and value-free tokens such as
`synthetic-item-alpha`; they do not copy weekly prose, Stage 0 annotations,
personal categories, preferences, project documents, or external data-root
files. Implementation and tests do not read `.agents/stage-0/**`.

This contract authorizes no dependency. Any new production dependency, copied
third-party source, tokenizer, graph package, search engine, or UUID library
requires separate dependency and license review.

## TM1 acceptance boundary

The fixed implementation candidate passes TM1 only when independent synthetic,
value-free tests prove at least:

1. both authorization branches, both exact target branches, eligible/ineligible
   decisions, decision-revision staleness, manual-edit behavior, and conditional
   Fragment target scoping;
2. closed UUID, text, enum, array, optional-field, budget, hostile-object,
   own/inherited accessor and setter, zero-trap Proxy rejection, owned-copy,
   caller-mutation isolation, dangerous-key, deep-freeze, and non-echoing-error
   behavior;
3. change-set, item-revision, and relation-revision UUIDv5 known answers plus
   canonical request digest known answers and independent saturated byte-count,
   value-count, and depth vectors;
4. item create, revise, unchanged, withdraw, reactivate, stale, missing, and
   first-revision lifecycle behavior for every kind/role/state protocol;
5. relation create, revise, unchanged, identity immutability, self-edge,
   endpoint existence/lifecycle independence, parallel equal relations, and
   withdrawal;
6. direct citation versus derivation semantics, exact excerpt digest,
   duplicates, out-of-scope/missing Fragments, historical item/relation
   revision inputs, complete provenance replacement, and rejection of
   same-change-set derivation, including the exact role/scenario issue paths
   and provenance-total preflight precedence;
7. multi-item split plus relation in one atomic plan, operation-order receipts,
   duplicate primary operations, mixed applied/unchanged behavior, and no
   partial plan;
8. same-key replay, same-key conflict, rejected-key reuse, original receipt
   replay after later state changes, exact first-error precedence, every
   request revision domain branch, and all ten repository-array sort,
   uniqueness, exact-closure, and malformed-superset cases;
9. poisoned filesystem, network, environment, clock, randomness, AI,
   framework, and database seams proving a pure non-AI module;
10. static DDL proof for exactly thirteen new tables, the one admitted upstream
    uniqueness addition, workspace-first keys/FKs, typed provenance, current
    pointers, one typed committed event per accepted change set,
    append-only-compatible history, no cascade, no arbitrary JSON, and no
    seeds;
11. no new dependency/license delta, personal/real-source material, test helper,
    ignored evidence, or generated artifact in the candidate package; and
12. format, lint, strict type checking, focused tests, full repository tests,
    build, and candidate application-artifact verification.

TM1 does not claim real PostgreSQL parsing, constraints, transaction isolation,
locks, concurrency, runtime grants, container/Linux parity, HTTP/browser,
search, real source import, export/restore, preference learning, AI, or release
readiness. Those claims remain deferred to TM2 and later named gates.

## References

- [Product requirements](product-requirements.md)
- [Roadmap](roadmap.md)
- [Development outline](development-outline.md)
- [Knowledge core architecture](knowledge-core-architecture.md)
- [Manual curation contract](manual-curation-contract.md)
- [Database migrations and roles](database-migrations-and-roles.md)
- [Application artifact boundary](application-artifact-boundary.md)
- [ADR 0002](adr/0002-postgresql-persistence-and-durable-work.md)
- [ADR 0004](adr/0004-adaptive-knowledge-ingestion-and-policy-authorized-writes.md)
- [ADR 0005](adr/0005-versioned-knowledge-core-and-ai-optional-operations.md)
- [ADR 0006](adr/0006-external-configuration-and-personal-data-isolation.md)
