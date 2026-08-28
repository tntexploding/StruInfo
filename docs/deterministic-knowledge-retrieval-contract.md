# Deterministic Knowledge Retrieval Contract

- Contract ID: `C-SLICE-B-RETRIEVAL-r3`
- Status: Draft for independent Maintenance and Test review; implementation is
  blocked until the contract is accepted
- Date: 2026-08-14
- Upstream write contract:
  [`C-SLICE-B-KNOWLEDGE-r3`](manual-knowledge-core-contract.md)
- Accepted write candidate: `f18c0346910de824ef20d074d88744c446946025`
- Migration impact: none; `000004_create_manual_knowledge_core.sql` remains the
  latest schema migration
- Dependency impact: none

## Purpose

This contract freezes the first deterministic read boundary over current formal
knowledge. It lets an authorized user browse or search current knowledge items
without AI, embeddings, tokenization, a vector store, a second database truth,
or locale-dependent behavior.

The slice proves this transition:

```text
closed user query
  + complete current knowledge snapshot for one workspace
  -> deterministic text and structured matching
  -> optional direct-source and one-hop relation filtering
  -> stable rank, keyset page, and explicit match reasons
```

It is the correctness baseline for later PostgreSQL query pushdown and
rebuildable search projections. An optimized adapter must reproduce this
contract's results; it cannot redefine matching, ranking, provenance, or
visibility.

## Scope and deferred boundaries

Search schema version 1 includes:

- current `KnowledgeItem` revisions only;
- exact and Unicode-aware substring matching over title and optional body;
- explicit filters for knowledge kind, epistemic role, and review state;
- direct Fragment-input filters by Resource, Snapshot, or Fragment identity;
- one-hop incoming, outgoing, or either-direction relation filtering;
- stable UTF-8 byte-order ranking and keyset pagination;
- exact result reasons for text, direct source, and matching relations;
- one read-only repository port and a closed, owned repository snapshot;
- workspace isolation, non-echoing errors, and hostile-input rejection; and
- a pure implementation that needs no filesystem, network, clock, randomness,
  database client, framework, AI, or model configuration.

Search schema version 1 deliberately excludes:

- historical-revision search;
- aliases, content classifications on formal knowledge, collections, tree
  placements, saved views, or framework membership;
- recursive provenance propagation through knowledge derivations;
- relation text search, multi-hop graph traversal, graph scores, or path search;
- event time, valid time, publication time, or capture-time filtering;
- locale-sensitive case folding, stemming, Chinese segmentation, edit distance,
  synonym expansion, `pg_trgm`, full-text search, BM25, or RRF;
- search projections, denormalized index tables, extensions, or a new migration;
- embeddings, RAG, natural-language answers, query expansion, or AI ranking;
- HTTP, authentication middleware, browser UI, WebSocket, or external clients;
- real PostgreSQL parsing, adapter completeness, query plans, indexes,
  transactions, runtime grants, or Windows/Linux database parity; and
- export/restore, personal preference, exploration policy, or automatic
  knowledge maintenance.

A zero-match result is a successful, explainable result. A missing or
cross-workspace source, relation anchor, or candidate is not exposed through a
distinct not-found error.

## Authority and workspace boundary

The trusted application boundary constructs this context after authorization:

```ts
export interface DeterministicKnowledgeSearchContext {
  readonly effectiveWorkspaceId: string;
  readonly authority: 'manual_user';
}
```

The request contains no workspace ID and cannot override the effective
workspace. The repository port receives only the canonical effective workspace
ID. Every repository row must carry that same workspace ID.

This contract does not claim that HTTP authentication exists. It only freezes
the application boundary after the caller has been authenticated and authorized
by a later transport layer.

## Closed request contract

```ts
export const DETERMINISTIC_KNOWLEDGE_SEARCH_SCHEMA_VERSION =
  'struinfo.deterministic-knowledge-search.v1' as const;

export type KnowledgeSearchTextField = 'title' | 'body';
export type KnowledgeSearchTextMode = 'exact' | 'substring';
export type KnowledgeSearchSourceInputKind = 'citation' | 'derivation';
export type KnowledgeSearchRelationDirection =
  'outgoing' | 'incoming' | 'either';

export interface KnowledgeSearchTextClause {
  readonly value: string;
  readonly mode: KnowledgeSearchTextMode;
  readonly fields: readonly KnowledgeSearchTextField[];
}

export type KnowledgeSearchSourceFilter =
  | Readonly<{kind: 'any'}>
  | Readonly<{
      kind: 'resource';
      resourceId: string;
      inputKinds: readonly KnowledgeSearchSourceInputKind[];
    }>
  | Readonly<{
      kind: 'snapshot';
      snapshotId: string;
      inputKinds: readonly KnowledgeSearchSourceInputKind[];
    }>
  | Readonly<{
      kind: 'fragment';
      fragmentId: string;
      inputKinds: readonly KnowledgeSearchSourceInputKind[];
    }>;

export type KnowledgeSearchRelationFilter =
  | Readonly<{kind: 'any'}>
  | Readonly<{
      kind: 'connected_to';
      anchorItemId: string;
      direction: KnowledgeSearchRelationDirection;
      relationTypeKeys: readonly string[];
      reviewStates: readonly KnowledgeReviewState[];
    }>;

export interface KnowledgeSearchFilters {
  readonly knowledgeKinds: readonly KnowledgeKind[];
  readonly epistemicRoles: readonly EpistemicRole[];
  readonly reviewStates: readonly KnowledgeReviewState[];
  readonly source: KnowledgeSearchSourceFilter;
  readonly relation: KnowledgeSearchRelationFilter;
}

export type KnowledgeSearchMatchRank = 0 | 1 | 2 | 3 | 4;

export interface KnowledgeSearchCursor {
  readonly schemaVersion: 1;
  readonly querySha256: string;
  readonly matchRank: KnowledgeSearchMatchRank;
  readonly normalizedTitle: string;
  readonly itemId: string;
}

export interface DeterministicKnowledgeSearchRequest {
  readonly text?: Readonly<KnowledgeSearchTextClause>;
  readonly filters: Readonly<KnowledgeSearchFilters>;
  readonly page: Readonly<{
    readonly limit: number;
    readonly after?: Readonly<KnowledgeSearchCursor>;
  }>;
}
```

All records are closed: undeclared own keys, symbol keys, inherited declared
fields, accessors, class instances, non-plain prototypes, sparse arrays, array
extra keys, and Proxies are rejected before caller-owned code is executed.

The five top-level filter members are required. Empty set-valued arrays mean
"any value" for that dimension; omission never carries a default. A text
clause, when present, must name at least one field. `source.kind: 'any'` and
`relation.kind: 'any'` contain no extra fields.

### Request budgets

| Input                  | Limit                      |
| ---------------------- | -------------------------- |
| Text query             | 1–300 Unicode code points  |
| Text fields            | 1–2 unique protocol values |
| Knowledge kinds        | 0–8 unique protocol values |
| Epistemic roles        | 0–5 unique protocol values |
| Item review states     | 0–6 unique protocol values |
| Source input kinds     | 0–2 unique protocol values |
| Relation-type filters  | 0–32 unique keys           |
| One relation-type key  | 1–120 Unicode code points  |
| Relation review states | 0–6 unique protocol values |
| Page limit             | integer from 1 through 100 |

Array length is checked before any element. Duplicate set values are rejected;
the first duplicate in caller order owns the error path. After validation, all
set-valued arrays are copied and canonicalized: protocol enums use their
declaration order, while relation-type keys use the UTF-8 byte comparator
defined below.

All UUID inputs must be lowercase canonical hyphenated text and are rejected
before lookup or comparison otherwise. A relation-type key uses the same scalar,
control-character, boundary-whitespace, and code-point rules as the upstream
write contract. Query text must contain valid Unicode scalar values, contain no
NUL or C0/C1 line/control character, contain at least one non-whitespace scalar,
and have no leading or trailing ECMAScript whitespace. The decoder does not
silently trim it.

The canonical digest projection has conservative strict upper bounds of 32 KiB
UTF-8, 128 canonical values, and depth 8 under the existing encoder's root-depth
convention. These bounds include the largest permitted `search_key_v1` expansion
of query text. They are deliberately loose safety bounds, not public rejection
budgets. They remain far below the encoder's 8 MiB, 100,000-value, and depth-64
defenses. Reaching an encoder defense after successful decoding is an
implementation failure, not a caller rejection branch.

## Search normalization

Search matching uses one versioned function:

```text
search_key_v1(text) = NFC(ascii_lowercase(NFC(text)))
```

`NFC` is Unicode canonical composition. `ascii_lowercase` maps only U+0041
through U+005A to U+0061 through U+007A. It does not use the process locale.
Both NFC applications are required. The inner NFC gives canonically equivalent
input one representation before ASCII lowering. ASCII lowering can create a new
composition opportunity, as in `J` + U+030C becoming `j` + U+030C. The outer NFC
closes that opportunity to U+01F0. Omitting it would make generated sort keys
fail their own cursor validation.

`search_key_v1` is idempotent: applying it to one of its outputs returns exactly
the same code-point sequence. The final NFC cannot introduce an ASCII uppercase
character after ASCII lowering, so another application performs no new lowering
or composition. Every generated cursor `normalizedTitle` is the exact final
search key used for ordering and must pass this fixed-point property.

Version 1 freezes Unicode 17.0 normalization behavior, matching the repository's
required Node.js 24.18.0 and ICU 78.3 runtime. Windows and Linux implementations
must pass the same normalization vectors. A runtime Unicode-data upgrade may not
silently change `search_key_v1`; it requires an explicit parity review or a new
search-key version.

Under Unicode 17.0, the NFC form of one valid Unicode scalar contains at most
three Unicode code points. Therefore an accepted 300-code-point knowledge title
produces at most 900 code points in `search_key_v1`. `U+FB2C` repeated 300 times
is the required saturated witness: its NFC/search-key result contains exactly
900 code points. Canonical decomposition is scalar-local and either canonical
composition pass can only preserve or reduce that decomposed length, so the
bound applies to the whole title rather than only isolated scalars. Independent
TM1 must verify this bound, including exhaustive single-scalar enumeration, the
ASCII-lowering composition cases, idempotence, and the generated-cursor round
trip.

The same function is applied to the query, current title, and current body.
It deliberately does not apply NFKC, full Unicode case folding, accent removal,
punctuation folding, width conversion, stemming, segmentation, transliteration,
or synonym expansion.

Required known-answer behavior includes:

| Left            | Right                 | Equal search key |
| --------------- | --------------------- | ---------------- |
| `ABC`           | `abc`                 | yes              |
| `e` + U+0301    | U+00E9                | yes              |
| `J` + U+030C    | U+01F0                | yes              |
| `H` + U+0331    | U+1E96                | yes              |
| full-width `Ａ` | ASCII `A`             | no               |
| `Straße`        | `STRASSE`             | no               |
| `知识数据库`    | `知识` as a substring | yes              |

These choices make the first Chinese substring path useful while keeping Node
and later PostgreSQL behavior independently reproducible.

## Text matching

If `text` is absent, every item that satisfies the structured filters passes
the text stage and receives rank 4 with no text reason.

If `text.mode` is `exact`, a selected field matches only when its complete
search key equals the query search key. If the mode is `substring`, equality
and contiguous search-key containment both match. A missing body never matches.

Text reasons use this fixed order and rank:

| Rank | Reason                            |
| ---- | --------------------------------- |
| 0    | exact title                       |
| 1    | title substring that is not exact |
| 2    | exact body                        |
| 3    | body substring that is not exact  |
| 4    | no text clause                    |

All matching selected fields are reported, in title-before-body order. The
item's rank is its lowest matching rank. `exact` mode cannot emit substring
reasons.

## Structured filter algebra

Different filter dimensions are combined with logical AND. Values inside one
set-valued filter are combined with logical OR. An empty array places no
restriction on that dimension.

`knowledgeKinds`, `epistemicRoles`, and item `reviewStates` inspect only the
current `KnowledgeRevision`. Review state is returned visibly; this contract
does not treat `confirmed` as objective truth and does not silently hide
`draft`, `disputed`, `rejected`, or `withdrawn`. A caller such as the browser
must submit the exact state set it intends to show.

No filter mutates, merges, promotes, or withdraws knowledge.

## Direct-source matching

Source matching uses only direct Fragment inputs attached to the current item
revision:

- `citation` means a direct citation;
- `derivation` means a direct Fragment derivation;
- an empty `inputKinds` array admits both kinds; and
- a non-empty array admits the named kinds only.

A Resource filter matches equal `resourceId`; a Snapshot filter matches equal
`snapshotId`; a Fragment filter matches equal `fragmentId`. The repository row
must retain all three identities so the result can explain the match.

Historical item/relation derivations are not recursively expanded into source
matches in revision 1. A summary derived from another knowledge revision does
not match that revision's source unless the summary's own current revision also
stores the matching direct Fragment input.

Matching source reasons are ordered by `citation` before `derivation`, then
`inputOrdinal`, then canonical Fragment UUID. Upstream write limits ensure at
most 64 direct Fragment inputs for one current revision. With an active source
filter, `sourceMatches` contains every and only direct input that satisfies that
filter.

`source.kind: 'any'` performs no source restriction and returns an empty
`sourceMatches` array. It does not expand every provenance input merely for
display; full provenance belongs to a later knowledge-detail query.

## One-hop relation matching

`relation.kind: 'connected_to'` returns the item on the other endpoint of a
matching current relation:

- `outgoing`: `anchorItemId` is the subject and the result item is the object;
- `incoming`: `anchorItemId` is the object and the result item is the subject;
- `either`: the union of the two directions.

The anchor itself is not returned merely because it participates in the
relation. The result item must independently satisfy every text, item-state,
kind, role, and source filter.

An empty `relationTypeKeys` array admits every exact relation-type key. An empty
relation `reviewStates` array admits every current relation state, including
`rejected` and `withdrawn`; callers that do not want those states must provide
the desired set explicitly. Relation type matching is exact and does not use
the text search normalization function.

Parallel relations can produce several reasons for one result item, but the
item appears once. Relation reasons are ordered by relation-type key in UTF-8
byte order, relation ID, and revision number. The response reports the exact
`relationMatchCount`, returns at most the first 32 reasons, and sets
`relationMatchesTruncated` when more exist. This display bound never changes
whether the item matches. With an active relation filter, the count and returned
prefix include every and only current relation that satisfies that filter and
connects the anchor to the result item in an admitted direction.

`relation.kind: 'any'` performs no relation restriction and returns
`relationMatchCount: 0`, `relationMatches: []`, and
`relationMatchesTruncated: false`. It does not turn a general browse query into
an unbounded adjacency response.

Relation traversal is one hop only. It does not infer symmetric, inverse,
transitive, hierarchical, or factual semantics from a relation-type key.

## Stable ordering and pagination

All matching items use this tuple:

```text
(match_rank, utf8(search_key_v1(title)), canonical_item_uuid)
```

The first element is numeric ascending. The second is lexicographic unsigned
UTF-8 byte order, not locale collation. The final canonical UUID is an ASCII
tie-breaker. Implementations must not rely on JavaScript locale comparison,
the host locale, insertion order, database default collation, or random order.

The query digest is SHA-256 over the canonical JSON plus LF encoding of this
owned semantic projection:

```ts
interface KnowledgeSearchDigestTextClause {
  readonly searchKey: string;
  readonly mode: KnowledgeSearchTextMode;
  readonly fields: readonly KnowledgeSearchTextField[];
}

interface KnowledgeSearchDigestProjection {
  readonly schemaVersion: typeof DETERMINISTIC_KNOWLEDGE_SEARCH_SCHEMA_VERSION;
  readonly text?: Readonly<KnowledgeSearchDigestTextClause>;
  readonly filters: Readonly<KnowledgeSearchFilters>;
}
```

When the request contains text, `text.searchKey` is exactly
`search_key_v1(decodedRequest.text.value)`; the original decoded code-point
spelling is not retained in the digest projection. Canonically equivalent text,
such as `e\u0301` and `\u00e9`, therefore has one query digest because it has one
matching meaning. The projection uses canonicalized set arrays and excludes
`page.limit` and `page.after`. Changing page size therefore does not invalidate
a cursor; changing any matching or filter semantic does.

A cursor is accepted only when its schema version is 1 and its lowercase
SHA-256 equals the current query digest. Its sort tuple is an exclusive lower
bound. Fabricating a valid-shape cursor can skip results but cannot reveal a
different workspace or bypass a filter.

The cursor title must contain 1–900 valid Unicode code points, satisfy the
upstream title control/boundary-whitespace rules, and already equal its own
`search_key_v1` result. This decoder bound is closed over every legal 300-code-
point title under the frozen Unicode 17.0 behavior. The cursor match rank must
be a finite integer from 0 through 4 and must not be negative zero. The cursor
item ID must be canonical UUID text. Any well-shaped cursor schema, digest,
rank, title key, or item-ID violation is `invalid_cursor`, not a lookup or
identifier error.

`totalCount` is the cardinality after all matching and filter semantics and
before applying either `page.after` or `page.limit`. It is constant for an
unchanged repository snapshot regardless of the cursor or requested page size.
The page contains at most `limit` matches strictly after the cursor.
`nextCursor` is present only when at least one further match exists and uses the
last returned item's tuple. A valid or fabricated cursor at or beyond the final
tuple can therefore return `items: []` with a nonzero `totalCount`.

Every call observes one repository snapshot. Search schema version 1 does not
promise a repeatable snapshot across several page requests; concurrent
current-revision changes can move an item between pages. Callers that require a
stable export or saved-result snapshot must use a later versioned export/query
contract.

## Result contract

```ts
export type KnowledgeSearchTextMatch = Readonly<{
  field: KnowledgeSearchTextField;
  kind: 'exact' | 'substring';
  rank: Exclude<KnowledgeSearchMatchRank, 4>;
}>;

export interface KnowledgeSearchSourceMatch {
  readonly inputKind: KnowledgeSearchSourceInputKind;
  readonly inputOrdinal: number;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly fragmentId: string;
}

export interface KnowledgeSearchRelationMatch {
  readonly relationId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly direction: 'outgoing' | 'incoming';
  readonly relationTypeKey: string;
  readonly epistemicRole: Exclude<EpistemicRole, 'source_excerpt'>;
  readonly reviewState: KnowledgeReviewState;
  readonly qualifier?: string;
}

export interface DeterministicKnowledgeSearchItem {
  readonly itemId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly value: Readonly<KnowledgeItemRevisionValue>;
  readonly matchRank: KnowledgeSearchMatchRank;
  readonly textMatches: readonly KnowledgeSearchTextMatch[];
  readonly sourceMatches: readonly KnowledgeSearchSourceMatch[];
  readonly relationMatchCount: number;
  readonly relationMatches: readonly KnowledgeSearchRelationMatch[];
  readonly relationMatchesTruncated: boolean;
}

export type DeterministicKnowledgeSearchResult =
  | Readonly<{
      status: 'ok';
      querySha256: string;
      totalCount: number;
      items: readonly DeterministicKnowledgeSearchItem[];
      nextCursor?: Readonly<KnowledgeSearchCursor>;
    }>
  | Readonly<{status: 'rejected'; issue: KnowledgeSearchIssue}>
  | Readonly<{
      status: 'failed';
      issue: Readonly<{
        code: 'repository_failed' | 'invalid_repository_snapshot';
        path: 'repository';
      }>;
    }>;
```

Successful values are implementation-owned, recursively frozen records and
dense arrays. They never retain caller or repository objects. The optional body
and qualifier preserve absence rather than being rewritten as empty strings.

A zero-match result is exactly:

```ts
{
  status: 'ok',
  querySha256: '<lowercase SHA-256>',
  totalCount: 0,
  items: [],
}
```

It has no `nextCursor`. An empty continuation page is not a zero-match result:
it preserves the full pre-pagination `totalCount` and also has no `nextCursor`.

## Closed repository snapshot

The first correctness implementation uses one read-only port:

```ts
export interface DeterministicKnowledgeSearchRepositoryPort {
  loadCurrentKnowledgeSearchSnapshot(
    effectiveWorkspaceId: string,
  ): Promise<unknown>;
}
```

It is called exactly once after successful context/request/cursor decoding. It
cannot expose generic SQL, a caller-selected workspace, a write method, or a
transaction callback.

The returned snapshot has five arrays:

```ts
export interface DeterministicKnowledgeSearchSnapshot {
  readonly items: readonly KnowledgeSearchItemState[];
  readonly revisions: readonly KnowledgeSearchRevisionState[];
  readonly fragmentInputs: readonly KnowledgeSearchFragmentInputState[];
  readonly relations: readonly KnowledgeSearchRelationState[];
  readonly relationRevisions: readonly KnowledgeSearchRelationRevisionState[];
}

export interface KnowledgeSearchItemState {
  readonly workspaceId: string;
  readonly itemId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
}

export interface KnowledgeSearchRevisionState {
  readonly workspaceId: string;
  readonly itemId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly value: Readonly<KnowledgeItemRevisionValue>;
}

export interface KnowledgeSearchFragmentInputState {
  readonly workspaceId: string;
  readonly itemId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly inputKind: KnowledgeSearchSourceInputKind;
  readonly inputOrdinal: number;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly fragmentId: string;
}

export interface KnowledgeSearchRelationState {
  readonly workspaceId: string;
  readonly relationId: string;
  readonly subjectItemId: string;
  readonly relationTypeKey: string;
  readonly objectItemId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
}

export interface KnowledgeSearchRelationRevisionState {
  readonly workspaceId: string;
  readonly relationId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly value: Readonly<KnowledgeRelationRevisionValue>;
}
```

`KnowledgeItemRevisionValue` and `KnowledgeRelationRevisionValue` are the exact
closed value records from `C-SLICE-B-KNOWLEDGE-r3`; readers must not create a
second enum or optional-field interpretation. The Fragment location is the
exact same-workspace Evidence join for one stored direct input of the current
item revision.

The snapshot contract requires:

1. every row belongs to the effective workspace;
2. item identities are unique and sorted by item ID;
3. revisions contain exactly one row for each listed item's current pointer,
   no historical row, and are sorted by item ID;
4. Fragment inputs refer to listed current revisions, preserve their stored
   ordinal, are unique by output revision and Fragment identity, and are sorted
   by item ID, input-kind order, and ordinal;
5. relation identities are unique and sorted by relation ID;
6. relation revisions contain exactly one row for each listed relation's
   current pointer, no historical row, and are sorted by relation ID;
7. relation identity endpoints/type equal the current revision, and both
   endpoint item identities are present;
8. UUIDs, enums, revision domains, text, optional fields, and direct-input
   domains satisfy the accepted upstream contract; and
9. arrays are closed dense arrays with implementation-owned decoding and no
   accessors, inherited fields, extra keys, or Proxy traps.

The repository is obligated to load every current item, its current revision,
every direct Fragment input for those revisions, and every current relation in
the workspace. A pure function cannot prove that a database adapter omitted an
entire identity. Real PostgreSQL adapter completeness and query-pushdown parity
therefore remain explicit TM2 gates and must not be reported as TM1 PASS.

Malformed repository state returns `failed/invalid_repository_snapshot` with
path `repository`; it is never blamed on the caller. A thrown or rejected port
call returns `failed/repository_failed`. Neither error echoes query text,
knowledge text, source IDs, relation keys, database details, or exception text.

The evaluator builds maps and adjacency lists and must avoid an item-by-relation
Cartesian scan. The intended bound is O(items + direct inputs + relations +
matched items log matched items). This is a correctness baseline for the fixed
corpus, not a claim that loading the complete workspace is the final production
query plan.

## Closed input ownership

Context, request, cursor, and repository snapshot are inspected before reading
caller-owned values:

- Proxy detection occurs before reflection that could invoke traps;
- record prototype, own-key set, and property descriptors are checked before
  reading declared values;
- own and inherited accessors for declared fields are rejected without invoking
  getters or setters;
- arrays are checked for a plain Array prototype, own data `length`, exact dense
  indices, and no extra or symbol keys before element reads;
- materialization uses implementation-owned null-prototype records or explicit
  own data properties, never assignment into a fresh ordinary `{}` that could
  invoke an inherited setter; and
- the owned decoded request, snapshot, and result are recursively frozen only
  after projection.

The input objects themselves are not frozen or mutated. Changing any caller or
repository object after invocation cannot change the query digest, match set,
rank, cursor, result, or previously returned value. No caller-owned getter,
setter, Proxy trap, coercion hook, iterator, comparison method, or serialization
method is executed.

## Issue protocol and first-error order

```ts
export type KnowledgeSearchIssueCode =
  | 'invalid_shape'
  | 'invalid_identifier'
  | 'invalid_text'
  | 'invalid_enum'
  | 'invalid_state'
  | 'duplicate_value'
  | 'limit_exceeded'
  | 'invalid_cursor';

export type KnowledgeSearchBudgetName =
  | 'query_text_code_points'
  | 'text_fields'
  | 'knowledge_kinds'
  | 'epistemic_roles'
  | 'item_review_states'
  | 'source_input_kinds'
  | 'relation_type_filters'
  | 'relation_type_code_points'
  | 'relation_review_states'
  | 'result_limit';

export type KnowledgeSearchIssue =
  | Readonly<{
      code: 'limit_exceeded';
      path: KnowledgeSearchIssuePath;
      budget: KnowledgeSearchBudgetName;
    }>
  | Readonly<{
      code: Exclude<KnowledgeSearchIssueCode, 'limit_exceeded'>;
      path: KnowledgeSearchIssuePath;
    }>;

export type KnowledgeSearchIndex2 = 0 | 1;
export type KnowledgeSearchIndex5 = 0 | 1 | 2 | 3 | 4;
export type KnowledgeSearchIndex6 = KnowledgeSearchIndex5 | 5;
export type KnowledgeSearchIndex8 = KnowledgeSearchIndex6 | 6 | 7;
export type KnowledgeSearchIndex32 =
  | KnowledgeSearchIndex8
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
  | 31;

export type KnowledgeSearchIssuePath =
  | 'context'
  | 'context.effectiveWorkspaceId'
  | 'context.authority'
  | 'request'
  | 'request.text'
  | 'request.text.value'
  | 'request.text.mode'
  | 'request.text.fields'
  | `request.text.fields[${KnowledgeSearchIndex2}]`
  | 'request.filters'
  | 'request.filters.knowledgeKinds'
  | `request.filters.knowledgeKinds[${KnowledgeSearchIndex8}]`
  | 'request.filters.epistemicRoles'
  | `request.filters.epistemicRoles[${KnowledgeSearchIndex5}]`
  | 'request.filters.reviewStates'
  | `request.filters.reviewStates[${KnowledgeSearchIndex6}]`
  | 'request.filters.source'
  | 'request.filters.source.kind'
  | 'request.filters.source.resourceId'
  | 'request.filters.source.snapshotId'
  | 'request.filters.source.fragmentId'
  | 'request.filters.source.inputKinds'
  | `request.filters.source.inputKinds[${KnowledgeSearchIndex2}]`
  | 'request.filters.relation'
  | 'request.filters.relation.kind'
  | 'request.filters.relation.anchorItemId'
  | 'request.filters.relation.direction'
  | 'request.filters.relation.relationTypeKeys'
  | `request.filters.relation.relationTypeKeys[${KnowledgeSearchIndex32}]`
  | 'request.filters.relation.reviewStates'
  | `request.filters.relation.reviewStates[${KnowledgeSearchIndex6}]`
  | 'request.page'
  | 'request.page.limit'
  | 'request.page.after'
  | 'request.page.after.schemaVersion'
  | 'request.page.after.querySha256'
  | 'request.page.after.matchRank'
  | 'request.page.after.normalizedTitle'
  | 'request.page.after.itemId';
```

The path union contains only declared context/request fields, bounded array
elements, cursor fields, and their exact parents. Paths never contain caller
text or IDs.

| Scenario                                                                           | Code                 | Path                                   | Budget                      |
| ---------------------------------------------------------------------------------- | -------------------- | -------------------------------------- | --------------------------- |
| Wrong container, key set, descriptor, primitive type, or sparse array              | `invalid_shape`      | Exact field or containing record/array | absent                      |
| Non-canonical context/filter UUID                                                  | `invalid_identifier` | Exact UUID field                       | absent                      |
| Unknown context authority                                                          | `invalid_enum`       | `context.authority`                    | absent                      |
| Unknown request enum literal                                                       | `invalid_enum`       | Exact enum field/element               | absent                      |
| Empty, whitespace-boundary, control-containing, or invalid-scalar query/key        | `invalid_text`       | Exact text field                       | absent                      |
| Query over 300 code points                                                         | `limit_exceeded`     | `request.text.value`                   | `query_text_code_points`    |
| Empty text-field array                                                             | `invalid_state`      | `request.text.fields`                  | absent                      |
| Relation key over 120 code points                                                  | `limit_exceeded`     | Exact key element                      | `relation_type_code_points` |
| Set array over its stated maximum                                                  | `limit_exceeded`     | Array field                            | Matching collection budget  |
| Later duplicate set element                                                        | `duplicate_value`    | Later element                          | absent                      |
| Page limit wrong numeric domain, including -0, non-integer, non-finite, or below 1 | `invalid_state`      | `request.page.limit`                   | absent                      |
| Integer page limit above 100                                                       | `limit_exceeded`     | `request.page.limit`                   | `result_limit`              |
| Cursor wrong schema, SHA syntax, rank including -0, title key, UUID, or digest     | `invalid_cursor`     | Exact cursor field                     | absent                      |

First error order is:

1. zero-execution container/prototype/key/descriptor inspection for context and
   request;
2. context fields in declaration order: effective workspace UUID, then authority;
3. request top-level shape;
4. text container, primitive type, lexical validity, code-point budget, mode,
   fields length, elements, and duplicates;
5. item filters in order: knowledge kind, epistemic role, review state;
6. source branch, branch identifier, then input-kind length, elements, and
   duplicates;
7. relation branch, anchor, direction, type-key length/elements/duplicates, then
   relation review-state length/elements/duplicates;
8. page limit and cursor closed shape;
9. cursor schema, digest syntax, sort tuple, and query-digest equality;
10. repository call and closed snapshot decoding.

Every array length failure precedes reading any element of that array. For a
duplicate, the later duplicate element owns the path. A wrong primitive type is
`invalid_shape`; an unknown context authority or request protocol literal is
`invalid_enum`; a malformed context or filter UUID is `invalid_identifier`;
invalid scalar/control/whitespace text is `invalid_text`; an invalid numeric
domain is `invalid_state`; over-budget input is `limit_exceeded`; and every
well-shaped but semantically invalid cursor field, including negative-zero rank
and its embedded item UUID, is `invalid_cursor`.

Lexical validity of the complete query string is checked before its code-point
budget. Therefore a query that both contains a forbidden scalar or control and
exceeds 300 code points returns `invalid_text` at `request.text.value` with no
budget. For `text.fields`, length zero returns `invalid_state` at
`request.text.fields` with no budget; length above two returns `limit_exceeded`
at that path with the `text_fields` budget. Neither branch reads an array
element before resolving its length outcome.

Rejected requests do not call the repository. Rejected and failed results do not
include partial items or cursors.

## Purity, privacy, and artifact boundary

The domain decoder, planner, normalizer, matcher, ranker, and result
materializer are pure. Unit tests poison filesystem, network, environment,
clock, randomness, AI, framework, and database seams. Only the executor may call
the one read port, once.

Search performs no write, lock, event, audit mutation, cache mutation, query
history storage, or hidden preference learning. Query history is not persisted
by this contract.

Real titles, bodies, relation keys, source identities, and queries are private
workspace data. They never enter source, tracked fixtures, logs, error payloads,
package resources, migration seeds, or generated documentation. Tracked tests
use synthetic UUIDs and value-free strings and do not read `.agents/stage-0/**`.

This contract authorizes no dependency, migration, extension, copied code,
search service, tokenizer, data set, or model. `000004` and all package/lockfile,
NOTICE, SBOM, and license records remain byte-identical unless a later accepted
task explicitly changes them.

## TM1 acceptance boundary

The fixed implementation candidate passes TM1 only when independent synthetic,
value-free tests prove at least:

1. closed context/request/result unions, all budgets, exact paths, and first
   error precedence;
2. zero-execution hostile input, owned copies, deep freeze, and caller-mutation
   isolation for request and repository values;
3. every normalization known answer, UTF-8 byte comparator parity on ASCII,
   Chinese, Emoji, BMP/non-BMP, NFC/NFD, full-width, and German sharp-s cases,
   exhaustive Unicode 17.0 single-scalar expansion, ASCII-lowering composition
   vectors including `J` + U+030C and `H` + U+0331, search-key idempotence, the
   900-code-point cursor round trip, equivalent-text digest parity, and an
   independent saturated digest-projection bound;
4. exact/substring title/body matching, selected-field behavior, absent body,
   all text ranks, multiple reasons, and no-text rank 4;
5. each item filter alone, empty-array semantics, within-filter OR,
   cross-filter AND, explicit rejected/withdrawn behavior, and duplicate filters;
6. Resource/Snapshot/Fragment direct citation and derivation matching,
   input-kind restrictions, current-revision-only behavior, ordering, and no
   recursive provenance propagation;
7. incoming/outgoing/either one-hop traversal, exact type and relation-state
   filters, parallel relation deduplication, reason ordering/truncation,
   endpoint state visibility, and missing/cross-workspace anchor emptiness;
8. complete stable ordering, tie-breaks, limit boundaries, pre-pagination total
   count, zero-match versus empty-continuation results, next-cursor creation,
   exclusive continuation, changed page size, mismatched digest, fabricated
   boundaries, and empty pages;
9. every repository array's ordering, uniqueness, current-pointer closure,
   workspace boundary, endpoint closure, Fragment-input closure, malformed
   optional fields, and non-echoing repository failures;
10. result identity/value fidelity, no duplicate items, exact match reasons,
    recursively frozen output, and absent optional-field preservation;
11. poisoned side-effect seams and proof that rejection avoids the repository
    while accepted execution calls the read port once; and
12. no migration/dependency/license delta, personal or real-source fixture,
    test helper leakage, ignored evidence, generated artifact leak, skipped
    mandatory check, or weakened full-repository quality gate.

The independent Test Agent owns the mandatory test ledger, known-answer
vectors, and oracle implementation. It must not import product normalization,
ranking, cursor-digest, decoder, or fixture helpers to prove those same
behaviors.

## Deferred gates

TM1 does not claim any of the following:

- real PostgreSQL 18 adapter completeness or query equivalence;
- snapshot consistency across pages, isolation levels, runtime grants, or
  concurrent update behavior;
- SQL collation, Unicode normalization, query plan, index, extension, or
  performance acceptance;
- container/Linux parity or production resource limits;
- HTTP/auth/browser/frontend behavior;
- aliases, classification, time, recursive provenance, multi-hop relations,
  projections, `pg_trgm`, tokenization, or fuzzy ranking;
- AI, embeddings, RAG, natural-language synthesis, or preference learning;
- export/restore or release/distribution readiness.

Those capabilities require later contracts and named TM2 or product gates. A
future optimized adapter may replace complete-snapshot loading only after real
PostgreSQL parity tests prove identical matches, order, counts, reasons, and
cursor behavior for the frozen vectors.

## References

- [Product requirements](product-requirements.md)
- [Roadmap](roadmap.md)
- [Development outline](development-outline.md)
- [Knowledge core architecture](knowledge-core-architecture.md)
- [Manual knowledge core contract](manual-knowledge-core-contract.md)
- [Source evidence storage contract](source-evidence-storage-contract.md)
- [Application artifact boundary](application-artifact-boundary.md)
- [Development standards](development-standards.md)
- [ADR 0002](adr/0002-postgresql-persistence-and-durable-work.md)
- [ADR 0005](adr/0005-versioned-knowledge-core-and-ai-optional-operations.md)
- [ADR 0006](adr/0006-external-configuration-and-personal-data-isolation.md)
