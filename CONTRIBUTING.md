# Contributing to StruInfo

StruInfo has accepted its foundational development outline and architecture
decisions. M1C remains the compatibility baseline, while the active product is
the cleaned InformationEntry-first flow. ADR 0011 governs the shipped M1E-2
Entry-centred formal relation graph; ADR 0012 through ADR 0015 govern the
provider-neutral task boundary and the shipped OpenAI split, tags and
selected-pair association proposal slices. ADR 0016 through ADR 0019 complete
manual split and local text/HTML/PDF import. ADR 0020 through ADR 0031 complete
the query, exploration, source-subscription, external-preference, recoverable
routing and owner-queue baseline. ADR 0032 through ADR 0036 add explicit local
advance actions, post-materialization structure correction, pre-split derived
source editing, versioned local split rules and an explicit local multi-file
session queue. Any later AI or automation increment must still select one narrow
authority boundary and one closed payload rather than adding a generic write
path.
An accepted ADR does not bypass a reachable product, dependency, or release
obligation, but deferred hardening and test-tooling certification do not block
unrelated product work.

The repository and distributable image remain data-free even when an owner uses
real material in an external deployment. Contributors must not add real
documents, entries, preferences, Blob bytes, database exports, backups or
derived knowledge to Git, tests or release artifacts. Use synthetic value-free
fixtures only. Ordinary tests and reachable product-blocker fixes remain part
of development; deferred hardening is not permission to skip them.

## Sources of Truth

- Product behavior: `docs/product-requirements.md`
- Delivery order and gates: `docs/roadmap.md`
- Current implementation and unfinished work: `docs/current-project-state.md`
- Engineering rules: `docs/development-standards.md`
- Dependency and license review: `docs/open-source-policy.md`
- Decision history: `docs/decision-log.md`

Update the canonical document instead of creating a new numbered copy for
ordinary revisions. Git records small-version history; `docs/archive/` is only
for major superseded directions.

## Maintenance phase

Since 2026-09-05, the accepted product scope is complete and feature development
is paused. Prioritize reproducible data, privacy and availability defects,
security fixes and necessary runtime compatibility updates. New capabilities
require a concrete use case and an explicit owner decision; the roadmap
candidate pool and frozen M2-P4R are not an active task queue. Follow
[the maintenance handoff](docs/maintenance-handoff.md).

## Workflow

1. Start from `main` and use a short-lived branch for a single purpose.
2. Keep the change small, reversible, and linked to a requirement or decision.
3. Add or update tests and documentation with the behavior they describe.
4. Run the repository checks defined by the selected stack.
5. Review security, privacy, provenance, migration, and license effects.
6. Classify review findings under the proportional-gate rules in
   `docs/development-standards.md`; move non-blocking hardening to
   `docs/deferred-hardening-memo.md` instead of delaying the product path.
7. Keep generated output, secrets, private snapshots, and local databases out
   of Git.

The project uses `type(scope): imperative summary` commit subjects. Common types
are `docs`, `chore`, `feat`, `fix`, `refactor`, `test`, `build`, `ci`, and
`revert`. Keep one logical change per commit and explain non-obvious reasons in
the body.

## Review Checklist

- The change has one clear purpose and the simplest adequate design.
- Module boundaries follow reasons to change, not arbitrary file size.
- Public behavior, errors, and failure recovery are explicit.
- Tests cover new behavior and regressions without relying on live services.
- User data, credentials, logs, and AI inputs are handled safely.
- Source citations and knowledge provenance remain intact where applicable.
- Retried writes are idempotent and asynchronous failures remain observable.
- New or upgraded third-party material has a recorded source and license review.
- A high-impact architecture decision has an ADR or a decision-log entry.
- Every blocking finding demonstrates a reachable, material product impact;
  test-tooling gaps and unreachable edge cases are tracked as deferred hardening.

## Project License Status

StruInfo is distributed under the repository-root MIT `LICENSE`. Every release
must also retain `THIRD_PARTY_NOTICES.md`, the admitted dependency license tree
and the release SBOM. Personal data, credentials and external configuration are
never release materials.
