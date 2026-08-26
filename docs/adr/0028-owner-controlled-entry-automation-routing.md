# ADR 0028: Owner-Controlled Entry Automation Routing

- Status: Accepted
- Implementation: M1G-4C complete
- Date: 2026-08-26
- Owners: Main Agent / product owner
- Scope: M1G-4C

## Context

ADR 0026 defined a default-off external `EntryAutomationPolicy` and a local
read-only trial. ADR 0027 made the resulting routing facts durable and
recoverable, but deliberately exposed no product route or owner-facing control.
The stored execution therefore could not be configured, started, paused,
resumed, manually overridden or inspected from the ordinary application.

M1G-4C closes that operational gap without granting any new downstream content
authority. The active workspace remains data-free and validation uses only
synthetic Entries.

## Decision

### Public local boundary

The workspace-fixed local API exposes six narrow operations:

- read and revise the current AutomationPolicy;
- run a read-only deterministic trial;
- start one idempotent durable routing execution;
- list recent automation executions; and
- read one exact execution and its claims.

Policy revision uses the existing atomic external-preference update. Every save
must present the expected current policy revision and bind the exact current
PreferenceProfile revision. Enabling, disabling, pausing and resuming are
ordinary explicit policy revisions; no hidden scheduler changes them.

A start request carries an idempotency key, explicit privacy scope, exact policy
and Profile revisions, the trial's Entry revision ledger, and any explicit
manual-takeover Entry identities. It delegates to the M1G-4B execution service;
the HTTP layer never writes claims itself.

### Owner-facing controls

The Tags workspace contains a secondary automation panel beneath the existing
PreferenceProfile panel. It provides:

- clear default-off enable and pause controls;
- editable thresholds, dimension requirements and per-run budgets;
- the exact bound Profile revision and activation explanation;
- explicit public-only or current-request include-private scope;
- read-only trial counts and per-Entry reasons;
- per-Entry manual takeover before execution;
- explicit start, reload and recent-run audit controls; and
- visible claim status, route and reason.

Saving a draft and starting a run are separate actions. A dirty draft cannot
start a run. A run can start only after a current complete trial reports
`activation: ready`. Late loads and trial responses are discarded through
request identities.

### Authority and privacy boundary

M1G-4C completes only the owner control and audit surface for routing facts.
`advance_candidate`, `manual_review` and `defer_candidate` still do not modify
Entry bodies, usefulness/interest values, keywords, Associations, Formal
Knowledge graph edges, Query results or AI proposals. Defer does not mean
ignore, hide or delete.

Private Entries participate only when the owner explicitly enables the local
scope for the current trial/run. No Provider or network call is introduced, and
execution audit records contain identities, revisions, routes and reasons—not
Entry text or source bytes.

## Alternatives Considered

- **Start automatically when policy is enabled:** rejected because enablement
  authorizes trial semantics, not an unattended schedule.
- **Combine Profile and policy editors:** rejected because preference evidence
  and execution authority have independent revisions and meanings.
- **Let a dirty draft start directly:** rejected because recovery requires the
  durable run to bind one saved policy revision.
- **Execute tags, links or graph writes for advance claims:** rejected because
  those concrete actions have not been accepted as automation authority.

## Consequences

- The owner can configure, pause/resume, trial, manually take over, start and
  audit Entry routing from one ordinary Tags surface.
- Public API and Web controls use the same M1G-4A policy and M1G-4B execution
  boundaries; there is no duplicate planner or writer.
- Existing five-step manual workflows remain unchanged and usable while the
  policy is disabled.
- No migration, dependency, Bundle version or Provider capability is added.
- M1G-4A through M1G-4C are now complete.

## Security, Privacy, and Licensing

All planning and execution remain local. Privacy opt-in is explicit per request.
No secret, prompt, raw Provider response, Entry body or source Blob is added to
the automation tables. This increment adds no dependency or licence obligation.

## Migration and Rollback

There is no migration. Rolling back M1G-4C removes only the API and Web control
surface; ADR 0026 preferences and ADR 0027 durable runs remain readable. No
personal-data-package format changes.

## Validation

- public service tests cover policy save/stale conflict, trial, manual takeover,
  durable start, exact claim response, recent-run listing and exact run load;
- Web API tests bind all six operations to their dedicated routes;
- existing policy, execution-service, PostgreSQL repository, migration and
  personal-data-package tests remain green; and
- TypeScript, formatting, lint, build and artifact boundaries are part of the
  ordinary repository verification.

## Explicitly Deferred

- concrete automatic actions after advance/defer routing;
- unattended scheduling or source-subscription-to-automation chaining;
- implicit behavior tracking or learned policy changes;
- automatic AI proposal acceptance, private Provider transfer, Embedding,
  vectors and RAG; and
- production PostgreSQL/container certification and owner-data validation.

## References

- [ADR 0026](0026-entry-automation-policy-dry-run.md)
- [ADR 0027](0027-recoverable-entry-automation-routing-execution.md)
- [Product requirements](../product-requirements.md)
- [Roadmap](../roadmap.md)
