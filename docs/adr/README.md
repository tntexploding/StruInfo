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

No architecture decision has been accepted yet.
