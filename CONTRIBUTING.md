# Contributing to StruInfo

StruInfo has accepted its foundational development outline and architecture
decisions. M1C remains the compatibility baseline, while M1E-1 is the cleaned
runnable InformationEntry-first product baseline. ADR 0011 governs the shipped
M1E-2 Entry-centred formal relation graph. Its direct-use increment now also
provides a separate complete-private-document query channel and versioned external
association weights/thresholds. ADR 0012 now governs the accepted M1E-3A
provider-neutral ProcessingRun/proposal foundation. The next AI increment must
select one Provider boundary and one closed proposal payload rather than adding a
generic model write path; reachable owner-use feedback may still be inserted first.
An accepted ADR does not bypass a reachable product, dependency, or release
obligation, but deferred hardening and test-tooling certification do not block
unrelated product work.

The active workspace is currently frozen as a data-free owner-audit baseline.
Until the owner explicitly lifts that freeze, contributors must not import,
restore, fetch or add real documents, entries, preferences or derived knowledge.
Use synthetic value-free fixtures only, and continue in the same main project
and workspace rather than creating a replacement workspace.

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

The project has not selected a distribution license and therefore does not yet
contain a `LICENSE` file. Do not publish a release or describe the repository as
open source until the owner records that decision and adds the required license
materials.
