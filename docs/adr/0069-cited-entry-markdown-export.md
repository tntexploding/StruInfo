# ADR 0069: Cited Entry Markdown export

- Status: Accepted
- Date: 2026-09-05
- Scope: Owner-selected roadmap item 5

## Decision

Query gains a secondary, session-only collection of 1–20 explicitly selected
current Entries. Selection order is export order. Cursor pagination preserves
the selection; changing the semantic query or privacy scope clears it.
The owner previews a named Markdown list and explicitly generates its file.
Preview and generation require exact Entry revision numbers and revision IDs.
There is no selection by arbitrary query, automatic expansion or all-results
export.

A closed local read port acquires the existing workspace lock before reading
selected current Entries, their immutable evidence and associations whose two
endpoints are selected. It retains the lock through preparation and file
creation. Privacy is checked before any Blob read. Missing, retired, inaccessible
or changed selections fail as a whole. Generation rebuilds the preview locally
and compares its byte digest, so changed relationships also require a fresh
preview. No client-authored Markdown, source bytes or path is accepted.

The document separates bounded current Entry excerpts from exact local source
excerpts. It records workspace, Entry/revision, Snapshot, Structure and Fragment
identities, half-open Unicode-scalar ranges, source hashes, capture time and
known publication metadata. Missing publication time remains unknown.
Only existing visible relationships between selected Entries are included,
with direction, origin, maintenance note and version-bound review status.
Calculated similarity and AI-assisted relationships retain their labels.
Source review does not certify objective truth. Session AI answers are excluded.

A narrow file port writes a unique UTF-8 Markdown file atomically under the
configured external `exports/` area, with owner-only file permissions where
supported. Source text is literal fenced text; headings and metadata are escaped.
The response supplies the same bytes for an explicit browser download without
exposing a server path. No Entry, annotation, association, graph, processing,
preference or evidence state is written. No migration, package version,
dependency, Provider, schedule, external sending or sharing boundary is added.
The existing personal-data package remains the complete recovery format.

## Verification

Use synthetic parser, rendering, provenance, stale/privacy and file-port tests,
local HTTP integration and real-browser selection/preview/download tests.
Exercise the bounded PostgreSQL read and existing lock against actual concurrent
Entry writes using the owned disposable synthetic smoke environment.
Verify five responsive widths, keyboard, errors and late-response isolation.
Preserve the completed uncommitted roadmap items 3 and 4.

Completed: 1,059 unit tests, 4 HTTP integration tests, 27 Chrome regressions,
application build, 1,187 artifact files and deployment-source checks. The
PostgreSQL 18.6 synthetic smoke proves bounded hydration, exact external bytes,
unchanged domain state and revision/privacy/retirement checks. See the
[delivery record](../cited-entry-export.md).
