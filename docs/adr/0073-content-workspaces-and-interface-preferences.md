# ADR 0073: Content workspaces and external interface preferences

- Status: Accepted owner-directed UI increment
- Date: 2026-09-11
- Trigger: The owner asks for Inbox, Library, Topics, Query and Settings, and same-document editing through a reserved right tool area.

## Decision

The primary navigation is 收件箱 / 资料库 / 专题 / 查询 / 设置. Inbox owns subscriptions, manual capture and actual receiving records. Library keeps a document selected while showing source, structure, annotation or relationship tools. On wide screens those tools cover a reserved rail and do not resize the reading paper. Narrow screens place the complete tool after the paper. Existing split preview/commit, Entry revision CAS, AI proposal review and exact evidence return remain the business authority.

Topics reuses the bounded Entry graph, including calculated and manually edited relationships. It does not introduce persistent topic membership, topic aggregation or a new knowledge writer. Query keeps its existing retrieval semantics, pagination, comparisons and exports, and places language/utility controls in one side area. Global rules and maintenance move to Settings; supported bulk tools remain explicitly accessible there.

A closed `uiPreferences` field is added to the external workspace review-preferences file. It stores an independent nonnegative revision, system/light/dark theme, and ordered subsets of allowed right-rail actions for the five pages. Missing state uses the complete default layout. Hidden actions remain reachable through secondary controls. It cannot store source content, identifiers of selected documents, privacy opt-ins, credentials, arbitrary scripts, URLs or custom action definitions.

GET and PUT `/api/v1/preferences/interface` expose only that field. PUT binds the current revision and uses the existing serialized workspace preference update. A stale write returns HTTP 409 with the current layout and leaves state unchanged; malformed or unsupported fields return 422. Sibling settings are preserved. The existing personal-data package carries the optional field; older packages restore the default, and invalid layouts are rejected. There is no migration or runtime dependency increment.

AI Settings reports actual independent capabilities and describes the existing external model/secret configuration and controlled restart. It does not add a browser secret writer, new Provider or automatic content transfer. Theme selection in the shell is a session preview; Settings persists the default.

## Validation scope

Use synthetic data to exercise whitelist validation, CAS, sibling preference writes, external-file reopen, workspace isolation, old/new package reads, actual document tools, navigation, focus, responsive layouts and existing processing regressions. Deployment and screenshots of any real material belong outside Git and application artifacts. Final execution evidence is recorded in current-project-state.md.
