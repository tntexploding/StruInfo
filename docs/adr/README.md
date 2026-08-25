# Architecture Decision Records

Use an Architecture Decision Record (ADR) for a consequential implementation
decision that will be expensive or risky to change later.

Examples include the runtime and repository layout, persistence model, source
snapshot retention, external AI data boundary, authentication, asynchronous job
semantics, API versioning, deployment, and cloud-to-local communication.

## Process

1. Copy `0000-template.md` to the next four-digit number and a short kebab-case
   title, for example `0001-runtime-and-repository-layout.md`.
2. Start with status `Proposed` and include real alternatives.
3. Link the approved ADR from `docs/decision-log.md`.
4. Do not rewrite an accepted decision to hide history. Add a new ADR and mark
   the old record `Superseded`.

## Records

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-typescript-modular-monolith.md) | Accepted | TypeScript modular monolith and toolchain |
| [0002](0002-postgresql-persistence-and-durable-work.md) | Accepted | PostgreSQL persistence, durable work, and Blob storage |
| [0003](0003-m0-s-engineering-foundation.md) | Accepted | Exact engineering foundation, dependency policy, quality gates, and migration boundary |
| [0004](0004-adaptive-knowledge-ingestion-and-policy-authorized-writes.md) | Accepted | Adaptive knowledge ingestion, separated exploration policy, and policy-authorized formal writes |
| [0005](0005-versioned-knowledge-core-and-ai-optional-operations.md) | Accepted | Versioned relational knowledge core and complete AI-optional operations |
| [0006](0006-external-configuration-and-personal-data-isolation.md) | Accepted | External runtime configuration and isolation of all personal data from source and packages |
| [0007](0007-information-entry-first-document-processing.md) | Accepted | InformationEntry-first document processing, annotation, association, and retrieval while preserving formal knowledge |
| [0008](0008-current-entry-state-and-portable-personal-data.md) | Accepted | Current Entry state, unified Tags review and portable personal-data packages |
| [0009](0009-retire-superseded-m1c-runtime.md) | Accepted | Retire superseded M1C runtime while preserving migrations and external-data compatibility |
| [0010](0010-entry-centered-formal-knowledge-graph.md) | Superseded | Centre-search and bounded-neighbourhood shape retained; edge admission superseded by ADR 0011 |
| [0011](0011-association-derived-formal-graph-edges.md) | Accepted | Deterministic similarity associations are editable Formal Knowledge graph edges |
| [0012](0012-provider-neutral-processing-runs-and-proposals.md) | Accepted | Provider-neutral durable processing runs and typed proposal envelopes |
| [0013](0013-openai-entry-tag-proposals.md) | Accepted | Optional OpenAI Responses API tag proposals for public Entries with manual acceptance |
| [0014](0014-openai-entry-association-proposals.md) | Accepted | Optional OpenAI selected-pair Entry association proposals with manual graph acceptance |
| [0015](0015-openai-entry-split-proposals.md) | Accepted | Optional OpenAI public-Snapshot split proposals with exact Fragment review and manual Entry materialization |
| [0016](0016-manual-entry-fragment-grouping.md) | Accepted | Local manual grouping at existing Fragment boundaries before atomic Entry materialization |
| [0017](0017-manual-within-fragment-entry-boundaries.md) | Accepted | Exact manual Unicode-scalar boundaries inside immutable Fragments before first Entry materialization |
| [0018](0018-local-text-file-import.md) | Accepted | Explicit local Markdown/plain-text file capture through the existing Evidence import |
| [0019](0019-local-html-pdf-import.md) | Accepted | Exact raw HTML/PDF evidence with a deterministic local text projection for the existing Split path |
| [0020](0020-explainable-lexical-entry-search.md) | Accepted | Explainable exact, substring and spelling-tolerant Entry search without AI or a new search stack |
| [0021](0021-query-association-and-result-comparison.md) | Accepted | Query-owned Association navigation and two-result comparison without a new backend boundary |
| [0022](0022-evidence-bounded-ai-query-synthesis.md) | Accepted | Explicit public-only AI synthesis over bounded deterministic Entry query evidence |
| [0023](0023-deterministic-entry-exploration-policy.md) | Accepted | Default-off explainable Entry exploration over current visible direct Associations |
| [0024](0024-versioned-git-source-subscriptions.md) | Accepted | Versioned exact GitHub Markdown subscriptions through external preferences and existing Evidence import |

The foundational application and persistence decisions were accepted on
2026-08-08 after the M0-P architecture gate. The non-browser, non-container
engineering foundation was accepted on 2026-08-10 after fixed-candidate
Windows/Linux testing and material closure review. The first product authority
model was accepted on 2026-08-10 after the owner confirmed the knowledge-core,
preference/exploration, and progressive-automation requirements.
The personal-data isolation boundary was accepted on 2026-08-10 by explicit
owner requirement. ADR 0005 now fixes the canonical versioned knowledge model,
including deterministic fuzzy and associative retrieval without AI.
ADR 0007 partially supersedes ADR 0005 only at the product workflow layer:
ordinary document material now becomes searchable `InformationEntry` records
before optional formal semantic knowledge, while ADR 0005 remains the formal
knowledge model. ADR 0008 makes routine Entry editing current-state based and
turns exports into complete personal-data packages. ADR 0009 removes the
superseded M1C application runtime; accepted migrations and historical data
remain compatible, while a future Formal Knowledge page requires a new product
boundary. ADR 0010 accepted the Entry-centred page shape and was then partially superseded
by ADR 0011: deterministic similarity associations may appear directly as
formal graph edges, while visible origin and durable user edits or blocks retain
owner authority. ADR 0012 adds durable provider-neutral processing runs and
typed proposal envelopes without selecting an AI provider or creating a second
write path. ADR 0013 selects one optional OpenAI tag-proposal path; ADR 0014
reuses that provider boundary for a user-selected public Entry pair and accepts
a typed relation proposal only through the existing graph command. ADR 0015
adds an explicitly selected public-Snapshot split proposal whose exact Fragment
groups materialize only after manual acceptance through the existing Entry
boundary. ADR 0016 adds the complete no-Provider owner path for grouping those
same immutable Fragments before the first Entry structure is committed. ADR 0017
extends that path to exact Unicode-scalar ranges without rewriting source evidence. ADR 0018 accepts explicit local Markdown/plain-text capture; ADR 0019 extends the same Evidence path to semantic HTML and PDF text-layer projections while retaining exact raw files externally. ADR 0020 extends the existing deterministic Entry query with explicit exact, substring and spelling-tolerant lexical modes, field scope, visible scores and cursor binding without AI, a migration or another search service. ADR 0021 completes the Query workspace with an explicit Association traversal entry point and a query-bound two-result comparison surface while reusing that same public search boundary. ADR 0022 completes the next narrow Query increment: an explicit, session-only, public-only OpenAI synthesis over a bounded deterministic evidence pack, with claim-level local source references and no retrieval or write authority.

ADR 0023 adds a default-off local exploration lane without changing ordinary
retrieval. ADR 0024 adds one exact public-GitHub Markdown subscription through
external preferences, real ProcessingRun records and the existing Evidence
import authority; it does not add a generic crawler or Provider boundary.
