# ADR 0074: Shared application use cases and execution authority

- Status: Accepted owner-directed foundation
- Date: 2026-09-12
- Trigger: The owner accepts the dual-channel AI roadmap and asks to proceed with shared business use cases and execution identity.

## Decision

Keep the modular monolith and extract selected business orchestration from the owner HTTP adapter into `apps/server/src/application`. `DocumentUseCases` lists and reads documents and materializes their first deterministic or manual structure. `EntryUseCases` searches current entries and the separate private-document channel and revises manual annotations. `RelationUseCases` reads bounded graphs and associations and edits graph edges. `ProcessingUseCases` lists recent runs and cancels a run using its expected version. Their typed inputs, results and business errors do not depend on HTTP, React, a Provider SDK, MCP or a database implementation.

`M1cApiService` remains the owner-facing HTTP adapter. It decodes requests, constructs the local owner authority for its fixed workspace, invokes these use cases and preserves the current HTTP response/error mapping. Advanced commands that are not yet needed by another caller remain in their existing services; this is not a wholesale rewrite or a second implementation of each route.

An `ExecutionAuthority` is constructed by trusted server code. It binds one workspace, an immutable identity (`owner`, `external_agent` or `automation`), explicit read grants and an independent local private-read grant. It is never decoded from document content or a business request. Grant arrays and identity objects are copied. Requests cannot choose another workspace or promote their caller. This is an in-process boundary, not new authentication for the existing HTTP listener.

| Caller                       | Current authority                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Local owner                  | Existing document, Entry, relation and run operations; private content still requires the applicable per-call opt-in                          |
| External Agent or automation | No authority by default; server composition can grant document reads, lexical Entry search, relation reads and recent-run reads independently |
| Any delegated caller         | Manual writes, run cancellation and model use remain unavailable in this increment, including when read/private grants exist                  |

Every shared entry point checks authority before repository, Blob or model access. Semantic and hybrid searches require the separate `models.use` operation, which is currently owner-only. A private-read grant does not authorize outbound model transfer. Recent-run reads filter private scopes unless the call explicitly includes them; the limit describes a bounded recent window, so filtering may return fewer runs. The existing owner task panel explicitly retains its complete recent-window scope.

Manual and deterministic materialization both reconstruct Entry bodies from exact local Fragment text and use the existing atomic empty-Snapshot repository write. Manual ranges must cover the complete ordered source partition. Entry revisions preserve evidence and origin semantics and use expected revisions; graph writes preserve pair overrides and bind source-checked relationships to the displayed endpoint revisions. Cancellation retains its existing compare-and-set outcome. Ordinary business errors carry a category and safe code, while transport status codes remain in the adapter.

## Boundaries for the next increment

The internal pipeline and an external MCP adapter must call these application use cases, not reuse the owner HTTP facade as their execution identity or write repository tables directly. Their write operations need an explicit accepted authority and origin/audit contract; the current manual writer must not be used to label unattended or Agent changes as owner edits.

This increment does not persist execution identities, add an automatic-acceptance policy, start a Provider, expose MCP, change subscription scheduling, alter migrations or packages, or configure the owner's instance. Existing AI proposal services still require their current explicit acceptance. The future internal pipeline must choose its first split strategy before the subscription path materializes Entries, rather than attempting AI splitting after a deterministic structure already exists.

## Validation

Synthetic tests call the application layer directly to exercise default denial, immutable grants, independent privacy, model-call denial, exact source reconstruction, atomic first structure, manual provenance, stale Entry and relation writes, source-review versions and cancellation conflicts. Existing HTTP, integration and browser regressions verify adapter compatibility. Final executed counts and results are recorded in `current-project-state.md`.
