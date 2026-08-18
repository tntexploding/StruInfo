# Contributing to StruInfo

StruInfo has accepted its foundational development outline and architecture
decisions. M0-S and the first pure domain slices are complete; implementation
now follows the `M1C` runnable vertical main line in the roadmap. An accepted
ADR does not bypass a reachable product, dependency, or release obligation, but
deferred hardening and test-tooling certification do not block unrelated product
work.

## Sources of Truth

- Product behavior: `docs/product-requirements.md`
- Delivery order and gates: `docs/roadmap.md`
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
