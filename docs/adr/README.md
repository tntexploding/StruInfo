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

The foundational application and persistence decisions were accepted on
2026-08-08 after the M0-P architecture gate. The non-browser, non-container
engineering foundation was accepted on 2026-08-10 after fixed-candidate
Windows/Linux testing and material closure review.
