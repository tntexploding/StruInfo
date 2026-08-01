# Repository Instructions

This file contains repository-specific rules for human and AI contributors.
Detailed policy lives in the linked canonical documents.

## Read First

Before changing the repository, read:

- `docs/product-requirements.md`
- `docs/roadmap.md`
- `docs/development-standards.md`
- `docs/open-source-policy.md`
- `CONTRIBUTING.md`

## Current Phase

The repository is in pre-implementation planning.
Do not choose a production language, framework, database, deployment platform,
or AI provider until the development outline is approved and the decision is
recorded.

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
- Do not add or copy third-party code without completing the open-source review
  and attribution record.
- Preserve source provenance, idempotency, permission boundaries, and visible
  failure states in all later implementation work.
- Keep changes scoped and update canonical documentation in the same change.

If a required command or tool has not been selected, do not invent a permanent
workflow. Record the missing decision and the validation actually performed.
