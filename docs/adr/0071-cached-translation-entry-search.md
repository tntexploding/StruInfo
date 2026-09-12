# ADR 0071: Search cached translations through canonical Entries

- Status: Accepted owner-use support boundary
- Date: 2026-09-08
- Trigger: The owner accepted original-based splitting with translations attached
  to the same Entry, and requested searchable cached Chinese text.

## Decision

The existing Entry Query includes valid cached Chinese title/body text in its
local lexical matching. The `title` and `body` field selections cover the
corresponding original and translated fields; `tags` continues to mean only the
canonical Entry annotations. Exact, substring and fuzzy modes keep their existing
text semantics. Structural, source, time, Association and privacy filters still
apply to the original Entry.

A narrow read-only repository port loads completed translations joined to current
public Entries in the selected workspace, requiring both source revision number
and revision UUID. Final matching checks the same identity and public scope
against the hydrated Entry. Private-only, empty browse, tags-only and purely
semantic requests do not load translations. Stale, retired and private caches
cannot produce a translated hit.

For accelerated lexical requests, cached translation identities supplement the
original term-index candidate identities before hydration. The existing search
core makes the final decision. Missing or stale original indexes retain the
complete fallback path. Translation reads do not depend on Provider configuration
or an index rebuild, and search cannot generate translations. This is a direct
read over the on-demand cache, not a second persistent search projection.

## Identity, ranking and reading

Each result contains the original Entry and exact Fragment provenance. New
`translation_title` and `translation_body` match reasons distinguish Chinese
matches from original `title` and `body` matches. Language variants share one
logical field for tie-breaking; scores use the strongest individual match and
are not summed across languages. Results, totals and pages contain one record
per Entry.

The request digest uses `struinfo.information-entry-search.v3` to reject cursors
issued under the previous matching semantics. The HTTP cursor envelope remains
v2 with at most five logical matched fields. Saving or changing content remains
a current-state query operation, not a snapshot-isolated browsing session.

Opening a translation hit prefers its saved Chinese reading view after cache
loading. Loading/failure preserves the original; the owner can switch back, and
exact-source actions still return imported original evidence. The UI labels
Chinese match reasons and explains that untranslated material needs original
text or existing annotations for discovery.

## Preserved boundaries

This supersedes only ADR 0070's exclusion of translation search. Translation
generation stays explicit and default-off. Splitting, Entry identity, annotation
writes, Association projection inputs and graph nodes do not change.

Hybrid retrieval may consume translated lexical matches through the same Query
path; the semantic lane and embedding inputs remain original-only. Existing
explicit query synthesis may therefore retrieve the same original Entry through
a Chinese match, but its evidence payload remains the original Entry text.
No translated evidence, independent corroborating source or new graph node is
created. The Formal Knowledge page's own centre search remains unchanged; Query
can open the selected canonical Entry in the graph.

No migration, dependency, configuration switch, Bundle change, automatic
translation, translation editing, private transfer or report generation is
introduced. Existing Entry Bundle v6 already carries cached translations, which
are searchable after restore without rebuilding the original index.

## Validation

Use synthetic fixtures for field/mode matching, de-duplication, ranking/cursors,
fallback and accelerated parity, public/current revision filtering and workspace
isolation. Exercise the real PostgreSQL adapter and restored caches in the
existing disposable regression. Verify visible match labels, preferred Chinese
reading, original/source return, keyboard operation and responsive bounds in a
real browser. Provider fidelity and owner-instance deployment are separate from
these code checks; the Provider remains disabled.

Validation completed on 2026-09-08: full `pnpm run verify` passed with 1,114 unit
tests, 4 integration tests, build, 1,200 artifact files and deployment checks.
The PostgreSQL 18 disposable smoke passed all 32 migrations, current cached
translation search, workspace/privacy/version/retirement filtering and restored
translation search, then removed its container and external data. Nine existing
Chrome query/privacy/saved-view/export regressions passed. A separate synthetic
Chrome session verified translated match labels, preferred Chinese reading,
original and rendered exact-source return, keyboard switching, failed-cache
retry, empty-result cleanup, reduced motion and unclipped match explanations at
320/390/768/1024/1440 widths. No real Provider call or owner-instance upgrade was
performed.
