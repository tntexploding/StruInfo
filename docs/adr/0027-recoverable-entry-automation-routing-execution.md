# ADR 0027: Recoverable Entry Automation Routing Execution

- Status: Accepted
- Implementation: M1G-4B complete
- Date: 2026-08-26
- Owners: Main Agent / product owner
- Scope: M1G-4B

## Context

ADR 0026 introduced a default-off `EntryAutomationPolicy` and a deterministic
dry run, but deliberately granted no execution authority. The next narrow step
is to make an enabled policy operationally recoverable without pretending that
the product has already defined automatic tag, Association, graph or AI
acceptance actions.

The active workspace remains data-free. This increment therefore proves the
execution protocol with synthetic fixtures and keeps owner-facing start, pause,
resume and takeover controls for M1G-4C.

## Decision

### Durable routing execution

M1G-4B executes the accepted routing decision itself. It creates one ordinary
deterministic `ProcessingRun`, one typed automation header and one typed claim
per routed Entry. The header freezes:

- the idempotent request digest and deterministic plan digest;
- the exact AutomationPolicy revision and PreferenceProfile revision; and
- the explicit public-only or include-private local scope.

Each claim freezes its ordinal, Entry identity, Entry revision and revision
identity, route and reason. The only routes remain `advance_candidate`,
`manual_review` and `defer_candidate`. Completing a claim means that this
routing fact was durably recorded; it does not mutate the Entry or execute an
undefined downstream product action.

The new PostgreSQL tables are
`processing_entry_automation_run` and
`processing_entry_automation_claim`. Migration `000018` is forward-only and
workspace-scoped. Processing Bundle v5 carries both tables; v1 through v4
packages remain readable and restore the new state as empty.

### Revalidation and recovery

The service derives the run identity from workspace plus idempotency key. An
equal replay returns the stored terminal result; the same key with a different
request is a conflict.

Before claiming work, before starting the run and immediately before settling
it, the service/repository require the same policy revision, Profile revision,
Entry revisions, Entry revision identities, routes and plan digest. The
PostgreSQL writer holds the existing workspace lock and uses optimistic run
versions, so a stale execution cannot silently complete.

If revalidation or execution fails:

1. the exact still-current AutomationPolicy is atomically advanced one revision
   and paused;
2. open claims are marked `compensated` with a closed error code; and
3. the ProcessingRun becomes failed.

If the owner has already changed or paused the policy, the compensator records
that the pause was superseded and never overwrites the newer preference. If
the durable settlement cannot be confirmed, the result exposes
`recoveryPending` instead of claiming success.

There is no destructive rollback because M1G-4B does not write Entry content,
keywords, Associations, graph edges, queries or proposals. Existing committed
product content remains untouched.

### Authority boundary

M1G-4B is an application service plus PostgreSQL repository boundary. It has no
HTTP route and no Web control. M1G-4C must provide explicit owner controls and
must not infer downstream automatic actions that have not been accepted by a
later decision.

Private Entries can be routed only when the local request explicitly sets
`includePrivate`. No Provider or network call is involved, and no private
content is copied into the execution tables.

## Alternatives Considered

- **Immediately auto-write tags or links:** rejected because the product has
  not defined which concrete mutation an advance/defer route authorizes.
- **Keep runs only in memory:** rejected because restart recovery and honest
  audit require durable claims.
- **Store policy snapshots in PostgreSQL:** rejected because the policy remains
  external personal configuration; only its exact revision is bound.
- **Overwrite a newer policy when compensating:** rejected because owner edits
  always outrank an older run.

## Consequences

- Routing can be idempotently claimed, resumed and audited across process
  restarts.
- A stale policy, Profile or Entry cannot be reported as successfully routed.
- Failure pauses only the exact policy revision that authorized the run.
- The personal-data package now covers 58 workspace tables through Processing
  Bundle v5.
- Actual automatic split/tag/link/graph actions still require separately
  accepted product semantics.

## Security, Privacy, and Licensing

Execution is local and deterministic. Claims store identifiers, revisions,
routes and reasons, not Entry bodies, source bytes, prompts, secrets or Provider
responses. Privacy is filtered before planning. No dependency or licence change
is introduced.

## Migration and Rollback

Migration `000018` adds the two append-only execution tables and one lookup
index. Rolling application code back leaves those tables unused. Processing
Bundle v4 and older packages upgrade with empty execution tables; current v5
packages retain execution audit state.

## Validation

- service tests cover success, equal replay, key conflict, inactive authority,
  manual takeover, private scope and revalidation failure;
- repository tests cover typed load, atomic initialization and terminal
  settlement;
- migration tests verify the two-table workspace-scoped schema; and
- Bundle tests verify v5 round-trip shape and v1-v4 empty-state upgrades.

## Explicitly Deferred

- M1G-4C HTTP/UI policy editing, start, pause, resume and manual takeover;
- concrete downstream actions for advance and defer routes;
- automatic AI proposal acceptance, behavior learning or query reordering;
- private-content Provider transfer, Embedding, vectors and RAG; and
- production PostgreSQL/container certification and owner-data validation.

## References

- [ADR 0026](0026-entry-automation-policy-dry-run.md)
- [Product requirements](../product-requirements.md)
- [Roadmap](../roadmap.md)
