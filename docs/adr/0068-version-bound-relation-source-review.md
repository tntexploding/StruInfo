# ADR 0068: Version-bound relation source review

- Status: Accepted
- Date: 2026-09-05
- Scope: Owner-selected roadmap item 4

## Decision

Add a secondary Source Review surface to the existing Entry-centred Knowledge workspace. List visible current graph relationships in bounded, stable pair-order pages, with pending, unreviewed, needs-review, source-checked and all filters. Apply workspace, current-structure, privacy and block visibility before counting and pagination. Calculated similarity remains visibly calculated; its review task starts unreviewed.

Migration `000031` adds two nullable reviewed Entry revision columns to the current association override. A source review records the exact displayed endpoint revisions. Source-checked is current only when both recorded revisions match. Old source-checked rows without a version binding retain their stored state and require another review; no historical binding is invented. Reads derive staleness without rewriting user decisions. Relationship transfer onto replacement Entry identities clears the binding while retaining the note and stored status.

The review write changes only review status and the existing bounded maintenance note. It preserves origin, label, semantic kind, direction, adjustment and visibility, and rejects missing, retired, blocked or inaccessible pairs. The existing workspace lock checks both endpoint versions and the expected override revision before settlement. Ordinary graph edits carry the displayed endpoint versions when recording source review; hide/restore keeps the prior binding. Projection rebuilding does not write override metadata.

Association Bundle v5 carries the new columns; v1-v4 restore them as null. No new table, dependency, Provider, automatic fact checking, web verification or content-write authority is added. The review status expresses the owner's source check, not objective truth. Private scope is explicit and local to the current page.

## Verification

Use synthetic state-machine, API and adapter tests; execute migration, pagination, endpoint/override concurrency, privacy, projection rebuild and actual database export and typed package-codec round-trip checks in disposable PostgreSQL; exercise legacy package upgrades in unit tests. Verify the browser review loop, source return, errors, late responses, keyboard and five responsive widths. Retain the completed uncommitted roadmap item 3.

Completed evidence: full repository verification (1,047 unit tests, 4 HTTP integration tests, build and 1,167 artifact files), 24 Chrome regressions, and PostgreSQL 18.6 synthetic smoke with 31 migrations, 978 equivalent review pages and actual workspace-lock/restructure checks. See [the delivery record](../relation-source-review.md).
