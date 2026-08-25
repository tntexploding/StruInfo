# ADR 0022: Evidence-Bounded AI Query Synthesis

- Status: Accepted
- Implementation: Complete (M1F-3, 2026-08-25)
- Date: 2026-08-25
- Owners: Main Agent / product owner
- Scope: M1F-3

## Context

M1F-1 and M1F-2 completed an explainable, privacy-scoped Query surface: local
exact, substring and spelling-tolerant lexical retrieval can be combined with
structured filters, one- or two-hop Association traversal, stable pagination,
two-result comparison and exact source return. The owner now wants an optional
AI comprehensive-query path.

The product already has one optional OpenAI Responses API boundary for split,
tag and selected-pair Association proposals. Reusing its environment-only
configuration, native HTTP adapter style and closed Structured Output boundary
is smaller and more understandable than adding another Provider or a generic
agent framework. Query synthesis is nevertheless different from a durable
proposal: it is a read result, not a pending domain mutation, and there is no
current need for answer history, saved conversations or automatic writes.

The main risk is semantic overreach. A fluent answer must not hide which local
records were retrieved, silently broaden privacy scope, replace deterministic
ranking, or be portrayed as online research, semantic retrieval or a verified
fact. M1F-3 therefore starts with a bounded synthesis over the current public
query only.

## Decision

### Retrieval remains deterministic

The existing Entry query remains the only retrieval and ranking boundary.
M1F-3 does not ask the Provider to search the workspace, choose filters, rank
records, traverse the graph or fetch the Web. The owner first runs an ordinary
Query. After a successful non-empty public result, a subordinate explicit
action may request “AI 综合当前结果”. Typing, changing filters, paging or
selecting a result MUST NOT call the Provider automatically.

The synthesis service reruns the same closed semantic query without a cursor
and with a fixed evidence limit. It takes at most the first eight current public
Entries in deterministic result order. Each local evidence item receives a
request-local handle from `E01` through `E08`. The Provider receives only:

- the user's bounded question;
- each handle, current title and a bounded body excerpt;
- current public content, type and domain keywords; and
- an explicit instruction to use only the supplied evidence.

Workspace, database, Snapshot, Fragment and stable Entry identifiers, Blob
bytes, source URLs, preferences, secrets and unrelated rows are not sent. The
service may include at most 4,000 Unicode scalar values from any one Entry and
24,000 across the complete evidence pack. Truncation is recorded and shown to
the owner; it is never hidden by the answer.

### Privacy boundary

M1F-3 is public-only. A request with `includePrivate` or `onlyPrivate` scope is
rejected before complete-document Blob reads and before any Provider call. The
separate complete-private-document result channel never enters the evidence
pack. The UI disables synthesis while either private scope is active and
explains why. A later private-content transfer policy would require a separate
owner decision; local visibility opt-in alone is not permission to send content
to an external model.

### Closed Provider output

The Provider returns one closed Structured Output value:

```text
answer: string
evidenceStatus: supported | partial | insufficient
claims:
  - statement: string
    evidenceRefs: E01..E08[]
limitations: string[]
```

The application bounds the answer to 4,000 Unicode scalar values, each claim to
500, at most 12 claims, at most 8 unique evidence references per claim, and at
most 6 limitations of 300 scalar values each. Every reference must name an
evidence handle in the current request. A `supported` or `partial` result must
contain at least one cited claim. Invalid, missing, out-of-scope or malformed
output fails visibly and is not repaired through a second Provider attempt.

The public response maps each accepted evidence handle back to its local Entry
identity, revision, title, excerpt, truncation state and exact-source action.
The model never supplies those identities. The response also exposes the query
digest, model, prompt version and evidence status so the UI can distinguish an
AI-generated synthesis from retrieved product facts.

### Provider and execution boundary

M1F-3 adds an independent `ai_query_synthesis` capability. It reuses the existing
optional OpenAI Responses API configuration, native `fetch` style, fixed endpoint,
`store: false`, no tools, one attempt, 60-second timeout and bounded output-token
budget. It adds no SDK, second Provider or ambient configuration source.

The public local route is `POST /api/v1/entries/search/synthesize`. Its request
contains a request identity, a non-empty question of at most 600 Unicode scalar
values and the existing semantic search request without cursor or caller-owned
limit. The server forces public-only scope and the eight-item evidence limit.
Provider absence, disabled capability, an empty result set, timeout and
malformed output are distinct visible outcomes and never become an empty
successful answer. A stale or cancelled request is discarded without replacing
the current page state.

The result is session-only. It is not a ProcessingProposal, ProcessingRun,
Entry revision, graph edge, preference, database row or personal-data-package
section. It cannot write Entry, Association or Formal Knowledge state.

### Query interaction

Search remains the page's primary action. The AI action and answer occupy a
secondary panel after local results. Before the first call, the page states that
the selected public result text will be sent to the configured OpenAI model.
The answer visibly includes:

- the `AI 综合` origin, model, prompt version and evidence status;
- answer text and limitations;
- claim-level local evidence chips with exact-source actions; and
- evidence-pack and excerpt truncation notices.

Changing the question, text mode, fields, filters, Association scope, privacy
scope or semantic query digest immediately invalidates the previous synthesis.
The client uses request identity and cancellation so a slower earlier response
cannot overwrite a newer scope. At widths below 1,024 CSS pixels the answer and
evidence stack in one column and retain ordinary page scrolling.

## Rejected or deferred alternatives

### Let the Provider retrieve or rank records

Rejected. It would duplicate the deterministic Query boundary and make source,
privacy and ordering behavior difficult to explain.

### Persist answers as knowledge or processing proposals

Deferred. Direct use has not demonstrated a need for answer history or saved
conversations. A read answer is not a proposed domain mutation and must not
silently become formal knowledge.

### Private synthesis, Web search, vectors or RAG

Deferred. M1F-3 sends only bounded public local evidence. It adds no online
retrieval, tool calls, Embedding, vector index, semantic reranker, private-data
transfer or generic agent loop.

## Consequences

- The owner can obtain a concise AI synthesis without losing deterministic
  retrieval, exact local evidence or the complete non-AI Query path.
- Provider use is explicit, bounded, public-only and independently discoverable
  through `ai_query_synthesis`.
- The first implementation needs no migration, new dependency, Bundle revision
  or durable task lifecycle.
- AI fluency remains visibly separate from source-backed records and does not
  gain write authority.

## Implemented slice

1. **M1F-3A — contract and Provider:** the pure request/evidence/output
   boundary, deterministic evidence-pack builder and OpenAI Responses API
   adapter are implemented with focused synthetic tests.
2. **M1F-3B — product wiring and Query UI:** the application service,
   `POST /api/v1/entries/search/synthesize`, Web client,
   `ai_query_synthesis` capability and secondary evidence-linked Query panel
   are implemented with request-identity and abort-based stale isolation.
3. **M1F-3C — closure:** privacy preflight, bounded evidence, closed-output,
   local-reference, Provider-disabled and responsive synthetic checks are part
   of the candidate. No real data was restored and owner review remains
   deferred.

## Implementation validation

- public-only admission and zero Provider calls for both private scopes;
- deterministic top-eight evidence selection, scalar limits and truncation;
- closed output validation and unknown evidence-reference rejection;
- exact mapping from model handles to local Entry/source controls;
- Provider-disabled, empty, timeout, malformed and stale-response behavior;
- no Entry, graph, preference, database or package writes;
- full non-AI Query regression; and
- responsive, keyboard-reachable synthetic UI checks at 320, 390, 768, 1024
  and 1440 CSS pixels.

The implementation adds no migration, dependency, Bundle section, Processing
row, answer history or product write port. The Query page keeps local results
visible while a Provider request is pending or fails.

## Related decisions

- [ADR 0008](0008-current-entry-state-and-portable-personal-data.md)
- [ADR 0013](0013-openai-entry-tag-proposals.md)
- [ADR 0020](0020-explainable-lexical-entry-search.md)
- [ADR 0021](0021-query-association-and-result-comparison.md)
