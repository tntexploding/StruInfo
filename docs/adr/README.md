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
write path.
