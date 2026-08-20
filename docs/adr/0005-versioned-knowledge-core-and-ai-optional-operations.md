# ADR 0005: Versioned Knowledge Core and AI-Optional Operations

- Status: Accepted
- Date: 2026-08-10
- Decision owners: Project owner and maintainers
- Supersedes:
- Superseded by: [ADR 0007](0007-information-entry-first-document-processing.md)
  for the primary product-layer document unit and routine retrieval path;
  this ADR remains authoritative for formal semantic knowledge

## Context and Constraints

The accepted architecture fixes PostgreSQL, immutable evidence, modular
application boundaries, and policy-authorized formal writes. It does not yet
define the canonical structure of knowledge, relations, recomposition, and
search precisely enough to implement product tables.

The project owner has clarified that preference calibration is not the current
priority and asked whether the complete information workflow can operate
without AI. Manual corpus review placed a content category in a field that had
been modeled as an intake decision, showing that content classification,
processing action, and review state must not share one field. The actual user
annotation remains outside the repository.

AI availability, provider behavior, model versions, and embeddings are not
stable enough to be correctness dependencies. Manual organization and
deterministic tooling must remain useful and complete.

## Decision

Use a source-backed, versioned relational knowledge graph in PostgreSQL as the
canonical knowledge model.

- `KnowledgeItem` supplies stable identity; semantic changes create immutable
  `KnowledgeRevision` rows.
- `KnowledgeRelation` supplies stable edge identity; semantic or evidentiary
  changes create relation revisions.
- Citations bind exact knowledge or relation revisions to exact evidence
  Fragments. Derivations record all Fragment, revision, rule, import, or
  processing-run inputs used to create a derived revision.
- Aliases, user vocabulary, classifications, collections, tree placements, and
  saved views remain separate from canonical revision bodies.
- Recomposition references existing items through collections, frameworks,
  ordered membership, and derivation rather than copying their text.
- Search indexes, graph layouts, tree views, and embeddings are rebuildable
  projections, never the only copy of knowledge.
- AI-independent retrieval combines structured filters, normalized exact and
  alias matching, Unicode substring and PostgreSQL `pg_trgm` similarity,
  optional admitted deterministic token postings, and bounded traversal of
  accepted relations. Multiple channels use a versioned deterministic rank
  fusion policy and expose the reasons each result matched.
- Core relational fields remain typed and constrained. Versioned validated
  `jsonb` payloads may hold kind-specific extensions, but an unconstrained EAV
  or arbitrary-document schema is not accepted.

Keep these dimensions independent:

- user-extensible content classification;
- workflow intake action;
- structural knowledge kind;
- epistemic role;
- review/lifecycle state; and
- operation origin.

All formal changes pass through the same knowledge application commands and
atomic `KnowledgeChangeSet`, whether proposed by a user, deterministic parser,
declarative rule, import adapter, AI processor, or authorized external client.
No origin receives a direct table-write path.

RAG is not part of database correctness. Embeddings, query expansion, and
natural-language synthesis remain optional derived or application-layer
enhancements; disabling or rebuilding them cannot make canonical knowledge
unreadable.

AI is optional. With no AI or embedding provider configured, the product must
still support evidence capture, deterministic document parsing, manual
classification and editing, typed relations, collections and frameworks,
revision history, conflicts, structured and text search, relation traversal,
export, backup, and restore. AI adds proposals, query expansion, embeddings,
and cited synthesis through replaceable adapters.

The detailed object and operation contract is recorded in
[`docs/knowledge-core-architecture.md`](../knowledge-core-architecture.md).

## Alternatives Considered

### Vector-first RAG store

Chunks and embeddings make semantic retrieval quick to prototype but do not
provide stable identities, user-controlled relations, revision semantics,
conflicts, deterministic edits, or AI-independent operation. Rejected as the
canonical model; embeddings remain derived indexes.

### Property-graph database as the source of truth

A graph database offers native traversal, but the first workload does not
justify another persistence system or cross-database transactions. PostgreSQL
adjacency tables and recursive queries are sufficient until measured otherwise.

### Document-only or free-form JSON knowledge

This preserves flexibility but weakens constraints, relationships, reviewable
changes, and maintainable queries. Rejected for canonical knowledge; JSON is
limited to validated versioned extensions.

### Require AI for decomposition and search

This reduces initial UI and rule work but makes user data inaccessible when a
provider is unavailable, unaffordable, untrusted, or disabled. It also makes
model behavior part of database correctness. Rejected.

## Consequences

- The first knowledge slice includes manual commands and deterministic search
  before AI automation.
- Schema and UI must represent classification, action, kind, epistemic role,
  state, and origin separately.
- Revisioned relations and derivations add tables but preserve auditability and
  allow conflicting claims to coexist.
- Search can launch without an embedding model and evolve without migrating
  canonical knowledge.
- Fuzzy and associative search remains available without AI, and every result
  can identify the deterministic text, filter, or relation channel that found
  it.
- AI processors become interchangeable productivity adapters instead of the
  owners of product semantics.

## Security, Privacy, and Licensing

Every record remains workspace-scoped. Model output is untrusted and must pass
the same schema, evidence, authorization, idempotency, and optimistic-concurrency
checks as other proposals. User-defined relation terms cannot change permission
or execution semantics.

No new dependency is accepted by this decision. Adding a tokenizer, graph
database, vector service, or model provider requires the normal admission and
licensing process.

## Migration and Rollback

No product-domain knowledge tables exist, so the accepted model can be
introduced with fresh forward migrations. Before those migrations, table and
index details may still be refined if they preserve this decision's stable
identity, immutable revision, provenance, command-boundary, and AI-optional
invariants.

After data exists, stable item IDs, immutable revisions, citations, and export
contracts are compatibility boundaries. Replacing PostgreSQL or changing the
revision model requires a superseding ADR and a verified migration.

## Validation

- Exercise create, revise, split, relate, compose, classify, conflict, withdraw,
  and search commands without any AI configuration.
- Prove that the same semantic operation produces the same validated change
  shape when initiated manually, by a deterministic rule, or by an AI proposal.
- Prove that classification does not mutate intake action or review state.
- Prove citation and derivation round trips across revisions and exports.
- Prove that tree, search, and optional vector projections can be rebuilt from
  canonical rows.
- Prove that fuzzy text retrieval, accepted-relation association, deterministic
  rank fusion, and match explanations work with all AI adapters disabled.
- Prove that duplicate or stale commands are rejected or replayed atomically.

## Acceptance

The project owner accepted this model on 2026-08-10 after clarifying that
ingestion, splitting, linking, maintenance, and retrieval must remain complete
without AI, while AI supplies optional automation and synthesis. The owner also
confirmed deterministic fuzzy and associative retrieval as the initial route;
RAG and embeddings remain optional enhancements.

## References

- [Knowledge core architecture](../knowledge-core-architecture.md)
- [Product requirements](../product-requirements.md)
- [Development outline](../development-outline.md)
- [ADR 0002](0002-postgresql-persistence-and-durable-work.md)
- [ADR 0004](0004-adaptive-knowledge-ingestion-and-policy-authorized-writes.md)
