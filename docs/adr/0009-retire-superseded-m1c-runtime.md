# ADR 0009: Retire the Superseded M1C Runtime

- Status: Accepted
- Date: 2026-08-23
- Decision owners: Project owner and maintainers
- Supersedes: ADR 0008's temporary retention of legacy Curation and formal-Knowledge application APIs
- Superseded by:

## Context

ADR 0007 made `InformationEntry` the ordinary document-processing and retrieval
unit. ADR 0008 then moved usefulness, interest, deterministic tags, aliases and
privacy-scoped search into the five-stage Entry workflow. Direct code audit
showed that the older Manual Curation, formal Knowledge writer and deterministic
Knowledge search implementations were no longer called by the owner-facing
application. They nevertheless remained in the server, PostgreSQL composition,
HTTP contracts, frontend client, tests and styles.

Keeping two complete product paths made the repository harder to understand and
made future Formal Knowledge design likely to inherit obsolete assumptions by
accident. The owner explicitly requested removal of all superseded main-project
content.

At the same time, existing external workspaces may still contain rows created by
migrations `000003`, `000004`, `000006` and `000007`. Deleting those tables or
rewriting accepted migrations would destroy recoverable user data and break
legacy personal-data-package compatibility.

## Decision

### Active product boundary

The active application consists of Evidence/Blob import, current
`InformationEntry` materialization and editing, Document tags, Entry
associations, privacy-aware Entry search, preferences and personal-data-package
transfer. The owner-facing flow is:

```text
Import -> Split -> Tags -> Associations -> Query
```

The following superseded runtime is removed from active source and composition:

- Manual Curation command/read modules and HTTP routes;
- formal Knowledge command/current-item modules and HTTP routes;
- deterministic Knowledge search modules and HTTP routes;
- their PostgreSQL repositories, frontend client/contracts, obsolete workspaces,
  smoke tools and unreferenced styles.

The reserved `正式知识` page remains an honest placeholder. M1E-2 must define a
new minimum vertical product boundary before any formal-knowledge runtime is
implemented. It may reuse retained relational data concepts, but it must not
silently restore the deleted workflow.

### Data and historical compatibility

Accepted forward migrations, historical database tables and existing rows are
not deleted by this change. Workspace transfer continues to preserve the legacy
domain section so existing external data remains exportable and recoverable.
Frozen contracts, accepted ADRs, decision-log entries and migration semantic
tests remain historical evidence; they are not active product APIs.

Removing old tables requires a separate owner-authorized data-retirement
migration after a verified external personal-data export. This source cleanup
does not claim to erase user data.

### Verification archive

The unissued PostgreSQL TM2 harness is retained as an historical verification
archive because it records the former adapter boundary. It is removed from the
normal TypeScript/ESLint/command quality path and has no `test:postgres` product
script. It cannot block current product work or issue a verdict for deleted
runtime.

## Consequences

- The server and Web application expose one ordinary document model instead of
  parallel Entry and M1C workflows.
- Current navigation and API contracts describe only implemented product
  behavior.
- Old workspace rows remain recoverable through the personal-data package.
- Migrations are still append-only and are never rewritten to hide history.
- Future Formal Knowledge work starts from an explicit M1E-2 decision.
- Historical certification material remains inspectable without participating
  in daily builds.

## Rollback

The independent M3 Git worktree/branch created immediately before this cleanup
is the complete code rollback point. Restoring external user state still requires
a personal-data package; changing Git alone never rolls back an external
workspace database or Blob root.

## Validation

- Active server and Web TypeScript compile without legacy runtime imports.
- Unit and integration tests cover the current Entry/Evidence/package paths.
- Built artifacts contain no removed runtime or test-owned files.
- Frozen migrations and legacy transfer tables remain unchanged.
- Static search confirms that active application code has no imports from the
  retired modules.
- An entrypoint-rooted import-graph audit finds every production TypeScript
  module reachable; the only non-reachable source file is Vite's ambient
  `vite-env.d.ts` declaration.
- A CSS-to-component token audit finds no unreferenced class selectors after
  removing the obsolete health shell and the retired AI capability-strip
  subcolumn.
- The Markdown import receipt no longer exposes the unused
  `intakeTargetFragmentIds` field. The internal `intake_target` parser role is
  retained because it still determines which structural Markdown sections are
  materialized as current Entries; it is not a Curation runtime dependency.

## References

- [ADR 0007](0007-information-entry-first-document-processing.md)
- [ADR 0008](0008-current-entry-state-and-portable-personal-data.md)
- [Product requirements](../product-requirements.md)
- [Knowledge core architecture](../knowledge-core-architecture.md)
- [Roadmap](../roadmap.md)
