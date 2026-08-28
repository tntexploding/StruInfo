# ADR 0014: OpenAI Entry Association Proposals

- Status: Accepted
- Date: 2026-08-24
- Decision owners: Project owner and maintainers
- Supersedes:
- Superseded by:

## Context and Constraints

M1E-3B proved the first provider-specific vertical path: one explicitly selected
public Entry can produce a closed tag proposal, and only the existing Entry
revision command can accept it. The Formal Knowledge page already has an
existing CAS-protected relation write boundary for a selected Entry pair.

The next useful AI increment should reuse those two accepted boundaries. It must
not scan the workspace, send private material, create a second graph mutation
path, or turn similarity into an AI-verified factual assertion. The complete
manual relation workflow must remain available without Provider configuration.

Owner, formal-gate, release and broader product reviews are currently deferred.
This changes scheduling only: reviews remain unissued and no real material may
be restored to the active workspace. Synthetic, value-free verification may
continue and a reachable product defect remains a normal blocker.

## Decision

### One provider and one selected pair

M1E-3C reuses the optional OpenAI Responses API configuration accepted by ADR
0013 and implements only the `association` proposal kind. A request is created
only after the owner has selected two visible public InformationEntry records in
the Formal Knowledge page. There is no background pair scan or automatic
candidate generation.

The provider receives only the selected Entries' titles, bodies and current
content/type/domain annotations. Either private endpoint is rejected before
fetch. The request uses native `fetch`, `store: false`, no tools, one attempt,
the configured output bound and the existing bounded deadline. Credentials,
Blob bytes, other Entries, preferences and database details are never included.

### Closed typed payload

Forward migration `000015` adds one
`processing_association_proposal` table beneath the existing proposal envelope.
It stores the expected low/high Entry revisions, expected current pair-override
revision, provider model, prompt version, proposed relation label and direction.
It does not store arbitrary JSON, prompt text, raw Provider output or raw errors.

The closed result permits a short explanation in the proposal envelope, a
relation label of at most 80 characters, and one of `symmetric`,
`low_to_high` or `high_to_low`. Entry pair order is canonical and the payload
is immutable after creation.

### Explicit acceptance through the existing graph command

Starting or rejecting a proposal never changes the graph. Accepting first
rechecks both Entry revisions and the pair's current override revision, then
calls the existing graph-edge write command. The accepted override records
origin `ai`; graph reads expose it as `ai_assisted`. A later user edit becomes
a normal user-edited relation and remains authoritative across projection
rebuilds.

Acceptance is retry-safe. If the graph write committed but proposal-decision
persistence was interrupted, a retry may mark the proposal accepted only when
the current graph value exactly matches the stored payload and expected next
revision. Stale or mismatched state is rejected rather than overwritten. The
Provider has no repository or graph write port.

### Capability, UI and portability

The workspace publishes `ai_associations` only when the same external OpenAI
model and environment-only key are configured. It remains distinct from
`ai_tags` and never implies a generic `ai` capability.

The selected-edge inspector labels pending output as `AI 生成 · 待审核`, shows
the proposed label, direction, model, prompt version and explanation, and offers
explicit accept/reject actions. It also states that exactly the selected public
pair is sent. Private pairs and unconfigured Provider states remain readable and
fully editable through the manual graph controls.

Processing Bundle v3 carries the seven Processing tables. Legacy v1 and v2
sections restore missing association proposal rows as empty. Existing graph
origin constraints are widened only to admit `ai`; no historical row is
rewritten.

## Alternatives Considered

### Let OpenAI choose pairs across the workspace

Rejected. It would expand disclosure, cost and ranking semantics before a
selected-pair workflow proves useful.

### Write the relation as soon as the response arrives

Rejected. It bypasses the accepted graph command and the visible owner decision.

### Send private Entries after a UI privacy opt-in

Rejected. ADR 0013 intentionally has no private-provider escape hatch. A future
private external-processing policy requires its own decision.

### Reuse the free-form proposal summary as the relation payload

Rejected. The relation label, direction and frozen revisions must be typed and
independently validated.

## Consequences

- A selected public pair can receive a durable, reviewable AI relation proposal.
- Manual graph editing and deterministic similarity remain complete without AI.
- AI origin is visible and remains distinct from user edits and calculated
  similarity.
- One workspace table and one migration are added; the personal-data Processing
  section advances to v3.
- AI split, query synthesis, automatic acceptance, private transfer, a second
  Provider, Embedding and RAG remain outside this increment.

## Validation

M1E-3C must prove that:

- only the selected public pair enters the Provider request;
- a private endpoint stops the request before fetch;
- the Responses API request uses the configured model, `store: false`, no tools
  and the closed response schema;
- malformed or unavailable Provider responses become stable run failures;
- proposal creation, listing, rejection and acceptance use the public product
  boundaries;
- acceptance writes through the existing graph command, records AI origin and
  rejects stale Entry or override revisions;
- an interrupted post-write acceptance can be retried without a duplicate graph
  mutation;
- Processing Bundle v3 round-trips the typed payload and reads v1/v2 with empty
  association state; and
- the Formal Knowledge UI distinguishes pending AI output from committed graph
  state and keeps the manual path usable when unconfigured.

Real Provider quality, cost, owner acceptance, PostgreSQL/container
certification and release review remain deferred and unissued. They do not
block a later product increment unless they reveal a reachable product defect.

## References

- [ADR 0006](0006-external-configuration-and-personal-data-isolation.md)
- [ADR 0011](0011-association-derived-formal-graph-edges.md)
- [ADR 0012](0012-provider-neutral-processing-runs-and-proposals.md)
- [ADR 0013](0013-openai-entry-tag-proposals.md)
- [Product requirements](../product-requirements.md)
- [Roadmap](../roadmap.md)
