# StruInfo Decision Log

This log indexes product and engineering decisions while the project is small.
High-impact implementation choices use an ADR under `docs/adr/` and are linked
from this file.

## Status Values

- Proposed: Under active review.
- Accepted: Current direction.
- Deferred: Deliberately postponed until a named decision gate.
- Superseded: Replaced by a later entry or ADR.
- Rejected: Considered and not selected.

## Decisions

| ID | Date | Status | Decision | Rationale or review gate |
| --- | --- | --- | --- | --- |
| PD-001 | 2026-08-01 | Accepted | Long-term vision is an AI-native, source-traceable personal information hub | Current product requirements |
| PD-002 | 2026-08-02 | Accepted | First value probe uses one known source, a cited AI digest, approval, and source-backed retrieval | Avoid building the full platform before validating value |
| ENG-001 | 2026-08-02 | Accepted | Use the relevant Google style guide with narrow recorded project deviations | User requirement; consistent code is easier to review and maintain |
| ENG-002 | 2026-08-02 | Accepted | Reuse reliable third-party work only with provenance and license review | Preserve maintainability and distribution options |
| ENG-003 | 2026-08-02 | Deferred | Runtime language, frameworks, storage, and deployment stack | Decide in the upcoming development outline and foundational ADRs |
| LEGAL-001 | 2026-08-02 | Deferred | Project distribution license | Decide before any public or distributable release |

## Adding a Decision

Add context, the decision, reasons, consequences, owner, evidence, and the event
that should trigger review. Use an ADR when a decision changes architecture,
data compatibility, security boundaries, operations, or long-term dependencies.
