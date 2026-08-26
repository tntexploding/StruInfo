# ADR 0030: Entry Automation Owner Work Queue

- Status: Accepted
- Implementation: M1G-5A complete
- Date: 2026-08-26
- Owners: Main Agent / product owner
- Scope: M1G-5A

## Context

M1G-4 records durable, recoverable routing facts, but a completed claim was
visible only inside run audit. It did not become an ordinary owner task and had
no independent completed, dismissed or reopened state. Reusing the claim status
for that purpose would mix immutable execution evidence with later owner work.

M1G-5A makes successful routing useful without granting an automatic content
writer. The active workspace remains data-free and tests use synthetic Entries.

## Decision

### Separate owner state from execution evidence

Forward migration `000019` adds
`processing_entry_automation_work_item`. A work item references exactly one
completed automation claim and stores only:

- `pending`, `completed` or `dismissed` owner state;
- an optimistic current version; and
- created, updated and optional resolved timestamps.

Successful execution settlement creates one pending work item per completed
claim in the same PostgreSQL transaction. The migration backfills successful
existing claims. Claim route, reason, Entry revision and status remain
immutable audit facts; changing a work item never rewrites them.

### Owner-facing queue

Two workspace-fixed local operations list visible work items and update one
item by expected version. Listing joins each fact to the current Entry, applies
privacy before return and marks the item stale when the Entry revision has
changed since routing. Missing or privacy-invisible Entries are not exposed.

The Tags workspace renders the queue as a secondary owner tool. The owner can
open the Entry, mark the item completed, dismiss it or reopen it. None of these
actions changes Entry text, scores, keywords, Associations, graph edges, Query
state, proposals or the underlying automation claim.

### Transfer compatibility

Processing Bundle v6 carries the new thirteenth Processing table. V1 through
v5 remain readable; older sections restore an empty owner queue while retaining
their existing run and proposal state. The complete package now covers 59
workspace tables plus referenced external Blob bytes and external preferences.

## Alternatives Considered

- **Reuse claim status as the task state:** rejected because execution audit and
  owner completion have different lifecycles.
- **Automatically mutate Entries for advance claims:** rejected because no
  concrete content-write action has been authorized.
- **Keep the queue only in browser memory:** rejected because owner work must
  survive restarts and package round trips.
- **Hide stale items:** rejected because a changed Entry is relevant context,
  not proof that the routing fact should disappear.

## Consequences

- Every successfully settled route can now become reachable owner work.
- Audit facts stay append-only while owner task state remains small and
  reversible.
- Privacy remains explicit per queue read/update request.
- One migration and one backward-compatible Processing section version are
  added; there is no new dependency or Provider capability.

## Security, Privacy, and Licensing

The queue table stores identities, revisions, route/reason references and owner
state, not Entry body or source bytes. Private Entries are omitted unless the
current request explicitly includes them. No network call, secret or dependency
is added.

## Migration and Rollback

Applying `000019` creates and backfills the queue table. Application rollback
may stop exposing the queue while leaving the table and Processing v6 data
intact. Database downgrade is not performed; older packages remain readable
through the registered codecs.

## Validation

- migration tests bind the table, constraints, index and successful-claim
  backfill;
- service tests cover privacy, stale Entry visibility and optimistic updates;
- PostgreSQL adapter tests cover transactional creation, listing and owner
  state changes;
- API client and Web tests bind the public routes and honest unavailable/loading
  states; and
- the ordinary repository quality gate covers TypeScript, lint, unit,
  integration, build and artifact isolation.

## Explicitly Deferred

- automatic tag, Association, graph or AI-proposal actions from a route;
- learned completion behavior or implicit preference changes;
- bulk queue mutation and multi-user assignment; and
- production PostgreSQL/container and owner-data validation.

## References

- [ADR 0027](0027-recoverable-entry-automation-routing-execution.md)
- [ADR 0028](0028-owner-controlled-entry-automation-routing.md)
- [ADR 0029](0029-entry-automation-control-integrity.md)
- [Product requirements](../product-requirements.md)
- [Roadmap](../roadmap.md)
