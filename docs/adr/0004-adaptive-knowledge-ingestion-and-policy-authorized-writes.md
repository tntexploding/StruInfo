# ADR 0004: Adaptive Knowledge Ingestion and Policy-Authorized Writes

- Status: Accepted
- Date: 2026-08-10
- Decision owners: Project owner and maintainers
- Supersedes: PD-002 product workflow assumptions in part
- Superseded by:

## Context and Constraints

The original product probe centered on a cited digest followed by per-item human
approval. The project owner has clarified that StruInfo's core is instead the
ingestion and maintenance of heterogeneous knowledge: preserve source evidence,
assess whether material is informative or worth exploring, select an appropriate
document granularity, extract and compare knowledge, maintain relations and
conflicts, and support evidence-backed browser retrieval.

The inputs may include weekly compilations, papers, project documents, AI design
outlines, tutorials, summaries, journals, images, and later additional media.
Forcing all inputs into one document shape or requiring approval of every
extracted atom would make the intended automation impractical. Allowing a model
adapter or worker to write formal knowledge directly would make authorization,
idempotency, audit, and rollback unverifiable.

The owner also wants the system to learn current preferences without reinforcing
an information bubble. Current interest therefore cannot be the only admission
or ranking signal, and ordinary negative feedback cannot silently disable
exploration.

ADR 0001 and ADR 0002 already fix the modular-monolith application shape,
PostgreSQL source of truth, durable work, immutable evidence, and application
module boundaries. This ADR adds the application authority model without
changing those accepted foundations.

## Decision

Use a four-layer ingestion model:

1. the evidence layer preserves allowed source bytes or references, versions,
   hashes, fragments, and media identity;
2. the document layer preserves headings, sections, items, tables, media
   placement, and source order;
3. the knowledge layer preserves stable items, immutable revisions, citations,
   derivations, typed relations, and conflicts; and
4. the control layer preserves intake decisions, assessments, feedback,
   preference and exploration profiles, processing plans, change sets,
   automation policies, and manual takeover history.

Add a `curation` application module that owns `IntakeDecision`, separated
assessments, `PreferenceProfile`, `ExplorationPolicy`, and `AutomationPolicy`.
The module does not own formal knowledge.

AI, OCR, source, and transport adapters return validated ordinary data. AI
processing ends at an assessment, rule suggestion, processing plan, or
`KnowledgeChangeProposal`; an adapter never writes a knowledge table.

The `knowledge` module is the only application boundary that creates or revises
formal knowledge. It converts proposals into a `KnowledgeChangeSet`, validates
workspace, evidence, action type, idempotency identity, resource versions, and
authorization, and then commits through a formal use case.

Authorization for a change set must come from either:

- the current authenticated user command; or
- an enabled, versioned `AutomationPolicy` previously approved by the user.

Authorization is action-scoped. Admission of a document or item may authorize
low-risk additions and non-destructive revisions, but it does not implicitly
authorize merge, deletion, replacement, important conflict resolution, broad
structure changes, new data egress, or permission expansion.

Automation advances through observable levels:

- A0: the user labels intake decisions; AI explains and proposes;
- A1: admitted content may produce policy-authorized low-risk commits;
- A2: high-confidence intake is processed automatically, low-value intake may be
  ignored automatically, and uncertain intake requires review; and
- A3: long-running policy may maintain low-risk relations and local structure.

Every level retains policy scope, version, validity, trial state, budgets, pause,
manual takeover, audit, and reprocessing. Reversal uses compensating immutable
revisions and explicit relationships; committed history is not mutated back to
an uncommitted state.

Information value, current interest, exploration value, noise, and factual
reliability remain separate assessments. `PreferenceProfile` learns current
preferences. `ExplorationPolicy` owns adjacent expansion, cross-domain links,
foundational gaps, emerging signals, viewpoint/source diversity, serendipity,
and exploration budgets. Ordinary clicks or negative feedback cannot directly
overwrite the exploration policy.

The first validation corpus is at least ten fixed issues from the
`ruanyf/weekly` GitHub repository, with independent section items as the primary
manual decision unit. The first UI validates intake, change inspection,
knowledge browsing, evidence-backed search, correction, policy pause, and manual
takeover. Digests, QQbot, public integrations, and cloud deployment follow the
knowledge core.

## Alternatives Considered

### Require human approval for every extracted knowledge atom

This provides a simple authority rule but makes deep document decomposition and
long-term autonomous maintenance too expensive. It also treats approval of a
source item and approval of a destructive knowledge operation as if they were
the same decision.

### Allow AI workers to write formal knowledge directly

This minimizes application code but bypasses domain validation, action-scoped
authorization, idempotency, evidence checks, and reviewable audit history. It is
not accepted.

### Use one combined relevance or interest score

A single score hides whether an item is informative, familiar, exploratory,
noisy, or trustworthy. Optimizing it from clicks and approvals would reinforce
the existing preference profile and make information-bubble behavior hard to
detect.

### Keep the cited digest as the first product core

Digests remain valuable later, but they do not validate heterogeneous document
structure, knowledge granularity, automatic maintenance, conflicts, or
evidence-backed retrieval. Delivery surfaces should consume the core rather than
define it.

## Consequences

- The first product slice requires evidence, document, curation, processing,
  knowledge, and retrieval behavior before reports or external integrations.
- The data model and UI are larger than a binary candidate queue because they
  must expose processing plans, assessment dimensions, policy versions, change
  sets, and manual takeover.
- Low-risk automatic ingestion can grow without granting the model unbounded
  authority.
- Preference learning can improve efficiency while exploration remains an
  explicit product policy rather than an accidental ranking side effect.
- Immutable compensating revisions retain evidence and auditability but require
  users and queries to understand current versus superseded state.
- Module-boundary tests must prove that adapters cannot bypass `curation` and
  `knowledge` application interfaces.

## Security, Privacy, and Licensing

External content and model output remain untrusted data and cannot expand
network, file, tool, workspace, or write authority. A policy stores allowed
actions and scope; it does not contain executable model-authored code.

Private knowledge remains denied to external AI by default under SEC-001.
Enabling a provider is workspace-scoped and separately audited from knowledge
write authorization. A policy that permits a knowledge change does not imply
permission to send its evidence to an external provider.

Automatic commits require stable policy identity and version, bounded budgets,
idempotency, optimistic concurrency or fencing, and visible failure states.
Pausing or expiring a policy prevents new authorized claims; already running
work must revalidate the exact policy generation before commit.

Public readability and an informal “open” description do not establish content
retention or redistribution rights. Full-text, image, and linked-source
retention for the first corpus must be recorded before public deployment or
redistribution.

## Migration and Rollback

No product-domain tables or user corpus exist yet, so the decision can be
implemented through fresh forward migrations without data conversion.

The operational fallback is A0: pause every automation policy and require user
commands while preserving proposals, assessments, and evidence. A faulty policy
is retired, its affected change sets are enumerated, and corrections use
compensating revisions or explicit relation changes.

Changing the exclusive knowledge-write boundary, removing action-scoped
authorization, or merging preference and exploration into one policy requires a
superseding ADR.

## Validation

- Import at least ten fixed weekly issues twice and prove stable source identity,
  document structure, and no duplicate knowledge side effects.
- Exercise full, split, condensed, source-only, ignored, and needs-review intake
  decisions with distinct feedback reasons.
- Prove that every committed change set has an authenticated command or an
  enabled exact policy version and can return to its evidence and processing
  run.
- Prove that paused, expired, wrong-workspace, over-budget, stale-generation, and
  unauthorized action policies cannot commit.
- Prove that merge, delete, major conflict resolution, broad restructuring, and
  new data egress require explicit human authorization by default.
- Verify that preference feedback does not mutate exploration policy and that
  each exploration recommendation exposes its type and reason.
- Correct and reprocess an AI-created revision while preserving the old revision,
  citation history, authorization, and compensating relationship.

## References

- [Product requirements](../product-requirements.md)
- [Roadmap](../roadmap.md)
- [Development outline](../development-outline.md)
- [Frontend design specification](../frontend-design-specification.md)
- [ADR 0001](0001-typescript-modular-monolith.md)
- [ADR 0002](0002-postgresql-persistence-and-durable-work.md)
- [First-source repository](https://github.com/ruanyf/weekly)
