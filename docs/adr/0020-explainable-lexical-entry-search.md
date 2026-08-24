# ADR 0020: Explainable Lexical InformationEntry Search

- Status: Accepted
- Date: 2026-08-24
- Owners: Main Agent / product owner
- Scope: M1F-1

## Context

The accepted Entry Query already combines normalized substring matching,
structural filters, privacy scope, associations, stable pagination and exact
source return. Direct project planning identified one remaining no-AI retrieval
gap: a user can miss a known Entry because of a small spelling, typing or
character error. Adding a model, vector database, `pg_trgm`, a second search
service or a new migration would be disproportionate before real workload data
shows that they are needed.

M1F-1 therefore extends the current complete-load deterministic boundary rather
than creating a parallel retrieval stack. The active workspace remains
personal-data free; validation uses only synthetic text.

## Decision

### Public query shape

A non-empty text query has two explicit dimensions:

- `textMode`: `exact`, `substring` or `fuzzy`;
- `textFields`: one or more of `title`, `body` and `tags`.

`tags` covers content, type and domain keywords. Omitted values preserve the
previous behavior: `substring` across all three fields. Field order is a set and
is canonicalized before query hashing. A mode or field selection without a
non-empty text query is rejected instead of becoming hidden state.

### Normalization and matching

All modes reuse the existing deterministic Entry search key:
`NFC(ascii_lowercase(NFC(text)))`. They do not use locale case folding,
translation, tokenization, a model or a user vocabulary.

- `exact` requires the complete selected field or individual tag to equal the
  normalized query and scores 10,000 basis points;
- `substring` accepts exact equality or containment and scores 10,000 or 9,000;
- `fuzzy` keeps those stronger matches, then compares local windows of query
  length minus one, equal length and plus one with character- and bigram-multiset
  Dice overlap. Characters contribute 40 percent and bigrams 60 percent. A
  result is admitted at 4,500 basis points; approximate scores are capped below
  the substring score. Queries shorter than three Unicode scalar values do not
  get broad approximate fallback.

The result exposes the selected mode and integer lexical score. The UI labels it
as a lexical score, not probability, confidence or semantic equivalence.

### Ordering, cursors and privacy

For an unchanged snapshot, result order remains deterministic: association depth
first, then descending text score, existing explanation counts and stable Entry
tie-breakers. Cursor schema v2 contains the text score and is bound to the v2
query projection, including canonical mode and field scope. Old ephemeral cursor
values are rejected rather than interpreted under changed ordering.

Privacy filtering still occurs before matching, scoring, counting, association
traversal, ordering and pagination. The separate complete-private-document
channel is available only after explicit current-request privacy opt-in and uses
the same text mode and field meaning: source identity for title, normalized full
text for body and private Entry keywords for tags. Complete bytes remain in the
external Blob store.

## Rejected or deferred alternatives

### AI or Embedding semantic retrieval

Deferred. M1F-1 is spelling-tolerant lexical retrieval and does not claim that
two texts have the same meaning. Query synthesis, embeddings and RAG remain
separate optional product decisions.

### PostgreSQL extensions, new indexes or query pushdown

Deferred. The current data-free development baseline provides no performance
evidence for `pg_trgm`, a custom index or another service. The accepted snapshot
loader remains the source of truth until a reachable workload demonstrates a
problem.

### Chinese segmentation, automatic translation and alias inference

Deferred. Exact user-confirmed aliases remain external personal configuration.
Automatic word segmentation or cross-language equivalence requires its own
visible evidence and correction boundary.

## Consequences

- Query now offers exact, contains and spelling-tolerant local matching across
  title, body and tags without making AI a prerequisite.
- Matching is deterministic, explainable, dependency-free and covered by the
  existing Entry and private-document privacy boundary.
- No migration, dependency, external data, Provider call or second search stack
  is introduced.
- Future retrieval work can replace or supplement this bounded scorer only
  through a superseding decision backed by real use or performance evidence.

## Validation

Synthetic unit and transport tests cover exact/substring field scope, a Chinese
single-character typo, relevance ordering, cursor binding, invalid closed input,
canonical field order and explicit private full-document fuzzy search. Web tests
cover visible mode/scope controls. The full repository quality command remains
required before handoff.

## Related decisions

- [ADR 0005](0005-versioned-knowledge-core-and-ai-optional-operations.md)
- [ADR 0007](0007-information-entry-first-document-processing.md)
- [ADR 0008](0008-current-entry-state-and-portable-personal-data.md)
- [ADR 0011](0011-association-derived-formal-graph-edges.md)
