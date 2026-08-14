# Repository Instructions

This file contains repository-specific rules for human and AI contributors.
Detailed policy lives in the linked canonical documents.

## Read First

Before changing the repository, read:

- `docs/product-requirements.md`
- `docs/roadmap.md`
- `docs/knowledge-core-architecture.md`
- `docs/development-standards.md`
- `docs/open-source-policy.md`
- `CONTRIBUTING.md`

Before frontend implementation or frontend design review, also read:

- `docs/frontend-design-specification.md`

## Current Phase

The foundational architecture, non-browser/non-container engineering
foundation, and first product authority model are accepted in ADR 0001 through
ADR 0004. The repository has fixed `ruanyf/weekly` issues 398 through 407 at one
upstream commit and has a candidate 345-unit structural inventory. ADR 0005
accepts the canonical versioned knowledge model and AI-optional operations;
ADR 0006 accepts external configuration and personal-data isolation. Slice 0
has established external configuration, fixed data areas, local Blob storage,
candidate-package auditing, and the versioned workspace-bundle envelope. The
`C-SLICE-A-EVIDENCE-r2` source-evidence migration and closed pure boundary,
`C-SLICE-A-MARKDOWN-r2` deterministic CommonMark transform and closed
materializer, and `C-SLICE-A-CURATION-r3` A0 manual
classification/intake/assessment boundary have passed their fixed-candidate
TM1 gates. The corrected `C-SLICE-B-KNOWLEDGE-r3` candidate defines the next
manual, source-backed knowledge-write increment and requires independent
Maintenance and Test re-review before implementation. Deterministic retrieval
follows that stable canonical write model. Do not make preference calibration
or AI availability a dependency.

Browser runtime artifacts and real PostgreSQL/container execution remain behind
their named admission gates. Do not represent either deferred gate as passed or
make it mandatory before its dependency and distribution review is accepted.

Do not change the accepted language, application shape, or persistence model
without a superseding ADR. Cloud deployment vendors and AI providers remain
unselected. Do not reuse M0-P probe candidate source as production code; carry
the tracked provenance, workspace, idempotency, fencing, and recovery
invariants into fresh implementation and tests.

## Local Multi-Agent Workflow

If `.agents/development-workflow.md` exists, read it before starting parallel
implementation or review work.
The file is intentionally local and ignored by Git; canonical requirements,
accepted ADRs, and repository standards take precedence.
Move durable decisions and required evidence into tracked documentation instead
of leaving them only in `.agents/`.

## Change Rules

- Follow the relevant Google style guide and repository-local deviations.
- Prefer direct, readable modules with explicit interfaces and dependencies.
- Keep product requirements, implementation decisions, and task plans separate.
- Add tests with behavior changes once a test stack exists.
- Never commit credentials, personal knowledge, fetched snapshots, or private
  source material.
- Never place personal knowledge, custom vocabulary, preferences, policies,
  source subscriptions, saved views, real snapshots, exports, or backups in the
  repository, installation tree, test fixtures, or package. Load them from an
  external workspace store; tracked examples must be synthetic and value-free.
- Do not add or copy third-party code without completing the open-source review
  and attribution record.
- Preserve source provenance, idempotency, permission boundaries, and visible
  failure states in all later implementation work.
- Preserve a complete non-AI path for classification, editing, relations,
  recomposition, search, export, and recovery. AI adapters only create proposals
  consumed by the same application commands.
- Frontend work must preserve AI-origin, evidence, uncertainty, and review-state
  distinctions, and must keep information value, current preference,
  exploration value, noise, and factual reliability separate as defined by
  `docs/frontend-design-specification.md`.
- Model and source adapters never write formal knowledge directly. Automatic
  commits require a user command or an enabled, versioned policy and retain a
  manual takeover, audit, and compensating-revision path.
- Keep changes scoped and update canonical documentation in the same change.

If a required command or tool has not been selected, do not invent a permanent
workflow. Record the missing decision and the validation actually performed.
