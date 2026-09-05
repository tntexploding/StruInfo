# ADR 0067: Saved Entry queries and reading context

- Status: Accepted
- Date: 2026-09-05
- Scope: Owner-selected roadmap item 3

## Decision

Store at most 20 named Entry queries in an independently versioned `entrySavedQueries` field of the external workspace review preferences. Each record contains a stable UUID, a name of at most 80 Unicode scalars, the existing validated search conditions and an optional last-selected Entry UUID. Saving, updating, renaming and deleting require the collection's expected revision inside the existing serialized preference update. Only explicit saves persist this state.

Expose a workspace-fixed list/write API and one privacy-scoped current Entry read for resuming the selected position. The Query page reruns saved conditions against current data. The previous selection is read independently and labelled separately when outside the current result page; it does not change matching, counts, ranking or cursors. A missing, retired or invisible selection is reported without returning its old content.

Saving a privacy preference does not grant later disclosure. Reopening a private view requires a fresh explicit choice, including after leaving Query. Query-to-source and Query-to-graph navigation keep request-local evidence authority; returning restores conditions and the last selected identity using current reads. In-page navigation context stays in memory.

No result body, pagination cursor, comparison, AI answer or graph response enters the preferences. Query text and saved names are personal data and stay outside Git and the installation. Personal-data packages carry the new field; older packages default to an empty revision-zero collection. Existing sibling preference writes and restore rollback preserve it.

No database migration, dependency, Provider, automatic history writer, saved-result snapshot, URL-sharing or new content-write authority is introduced.

## Validation

Synthetic tests cover closed parsing, revision conflicts, sibling writes, old/new package round trips and rollback, current Entry privacy, saved-query management, navigation, unavailable anchors/semantic mode and late responses. The repository verification gate passed 1,036 unit tests and four integration tests. All 21 real-Chrome product tests passed, including checks at 320, 390, 768, 1024 and 1440 CSS pixels. Delivery and review evidence is recorded in [the implementation report](../saved-query-context.md).
