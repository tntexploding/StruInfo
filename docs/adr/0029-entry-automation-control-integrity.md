# ADR 0029: Entry Automation Control Integrity

- Status: Accepted
- Implementation: M1G-4D complete
- Date: 2026-08-26
- Owners: Main Agent / product owner
- Scope: M1G-4D

## Context

ADR 0026 established the default-off `EntryAutomationPolicy`; ADR 0027 made
routing facts durable and recoverable; ADR 0028 exposed the owner controls and
six narrow local operations. The API already included an exact-run read, but
the Tags panel rendered claim details directly from the recent-run list and did
not consume that operation. Policy loads, run-list refreshes and execution
refreshes also used overlapping request identities, leaving a reachable path
for a late list response to replace newer audit state.

M1G-4D closes those product-control gaps without adding another execution
authority, database record, Provider call or package format.

## Decision

### Exact audit is distinct from recent summaries

The recent-run list is only a navigation summary. The owner explicitly selects
one run, after which the Web application calls the existing exact-run public
operation and renders its authoritative version, policy/Profile revisions,
privacy scope, status, error code and every typed claim.

An exact audit states whether claims are completed, compensated or still open.
Open claims are shown as unresolved rather than inferred as success. Failure of
the exact read leaves recent summaries intact, exposes a retry action and never
fabricates recovery completion. The page continues to state that routing runs
do not rewrite Entry content, scores, keywords, Associations, graph edges,
Query state or AI proposals.

### Independent request generations

Policy reads, policy saves, trials, durable execution, recent-run lists and
exact-run audits each own an independent latest-request generation. Starting a
new request invalidates any older response whose state it supersedes. Refreshing
the run list invalidates an older exact selection; executing a run invalidates
older policy/list/audit reads before the post-execution refresh.

The owner cannot discard a dirty policy draft through the general reload
button, and policy/list reloads are disabled while save or execution is in
flight. Unmount invalidates every generation. These rules prevent response
ordering from changing the visible authority or hiding a newer result; they do
not cancel or reinterpret a server command that may already have committed.

### Owner-visible responsive state

Loading, empty, failure, in-progress, succeeded, compensated and unresolved
claim states remain explicit. Audit metadata uses semantic headings and a
definition list; the claim table has a keyboard-focusable bounded scroll
container. Recent summaries and controls collapse to one column at narrow
widths while the table scrolls locally rather than widening the document.

## Alternatives Considered

- **Continue expanding list responses inline:** rejected because a list refresh
  is not an explicit exact-run audit and made the existing detail operation dead
  product code.
- **Use one global loading flag:** rejected because unrelated late responses
  could still overwrite newer policy, list or detail state.
- **Add a new recovery command:** rejected because ADR 0027 already owns
  compensation and policy pause; M1G-4D only makes persisted state inspectable.
- **Start concrete downstream actions from completed claims:** rejected because
  no such content-write authority has been accepted.

## Consequences

- Every public operation introduced by M1G-4C now has a reachable product
  consumer.
- The owner can distinguish a recent summary from a freshly loaded exact audit
  and can see unresolved claims without assuming success.
- Late run-list/detail responses cannot replace newer control state.
- M1G-4A through M1G-4D now form one complete policy, trial, recoverable routing,
  owner-control and control-integrity boundary.
- There is no migration, dependency, Provider capability or personal-data
  package change.

## Security, Privacy, and Licensing

The exact audit contains only existing run/Entry identities, revisions, route,
reason, status and timestamps. It does not include Entry text, source bytes,
prompts, secrets, request digests or idempotency keys. Privacy remains an
explicit per-trial/per-run local scope. No dependency or licence obligation is
added.

## Migration and Rollback

There is no migration. Rolling back M1G-4D removes only the exact-audit Web
consumer and request-isolation/UI changes; M1G-4A policy state, M1G-4B runs and
claims, M1G-4C public operations and personal-data packages remain readable.

## Validation

- focused Web tests cover honest loading, exact failed-run recovery wording,
  unresolved claims, error codes and retryable exact-read failure;
- the existing client route test continues to bind the exact-run operation;
- a synthetic browser regression delays an older run-list response, proves it
  cannot replace the newer list, loads the exact audit and verifies no document
  overflow at 320, 390, 768, 1024 and 1440 CSS pixels; and
- ordinary formatting, lint, TypeScript, unit, integration, build and artifact
  checks remain required.

## Explicitly Deferred

- concrete automatic actions after a route is recorded;
- unattended scheduling and source-subscription chaining;
- implicit behavior tracking or automatic policy learning;
- Provider use, private-content transfer, automatic AI proposal acceptance,
  Embedding, vectors and RAG; and
- production PostgreSQL/container and owner-data validation.

## References

- [ADR 0026](0026-entry-automation-policy-dry-run.md)
- [ADR 0027](0027-recoverable-entry-automation-routing-execution.md)
- [ADR 0028](0028-owner-controlled-entry-automation-routing.md)
- [Product requirements](../product-requirements.md)
- [Roadmap](../roadmap.md)
