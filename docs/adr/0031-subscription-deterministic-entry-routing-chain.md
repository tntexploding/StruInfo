# ADR 0031: Subscription Deterministic Entry Routing Chain

- Status: Accepted
- Implementation: M1G-5B complete
- Date: 2026-08-26
- Owners: Main Agent / product owner
- Scope: M1G-5B

## Context

M1G-2 can detect and import a changed subscribed GitHub Markdown file. M1G-4
can route an explicit current Entry set, and M1G-5A makes successful claims
actionable. These boundaries were disconnected: a changed subscription stopped
at Snapshot creation even when the owner had enabled a ready Profile and
AutomationPolicy.

M1G-5B connects the existing boundaries without inventing a second splitter,
planner or content writer.

## Decision

### Default-off per-subscription authority

Each external source subscription adds `routeAfterImport`, defaulting to
`false` for old preference files and personal-data packages. The Import page
exposes it as “变化后自动拆分并分流”. Enabling it is explicit authority only for
this local deterministic chain:

```text
changed source
  → existing Evidence import or idempotent reuse
  → existing deterministic section Entry materialization
  → existing M1G-4 recoverable routing execution
  → existing M1G-5A owner work queue
```

It does not authorize AI, automatic tag edits, Association writes, graph edits,
proposal acceptance, deletion or hiding.

### Exact reuse and retry semantics

The source-content identity intentionally excludes the routing switch, so
toggling the switch cannot fork Resource/Snapshot identity. The subscription
configuration identity includes it, allowing an enabled subscription to check
the current source again while reusing already imported evidence.

The chain accepts the first existing Entry structure for the Snapshot. If no
structure exists it uses the same deterministic section materializer and atomic
empty-Snapshot repository boundary as the Split page. The automation request is
scoped to current Entries from that Snapshot and uses the stable key
`source-route:<subscriptionId>:<sourceSha256>`.

The successful source cursor advances only after import, materialization and
routing all succeed. A policy/Profile mismatch, materialization failure or
routing failure leaves the prior cursor intact, so the next explicit or due
check can safely retry. Idempotent Evidence, Entry and automation boundaries
prevent duplicate product state.

### Privacy and observability

The chain is local. A private subscription can participate only because the
owner configured that subscription and enabled this switch; its privacy scope
is passed to local materialization and routing. No private body is sent to a
Provider. The existing import ProcessingRun reports whether the changed source
was merely imported or also materialized and routed, and the run result exposes
the automation run identity and materialized Entry count.

## Alternatives Considered

- **Always route changed subscriptions:** rejected because automation remains
  explicit and default-off.
- **Create a new background pipeline:** rejected because Evidence, Split and
  routing already provide idempotent boundaries.
- **Advance the cursor after import but before routing:** rejected because a
  failed downstream step would become difficult to retry.
- **Run AI tags or links automatically:** rejected because proposal acceptance
  remains a separate explicit owner action.

## Consequences

- A configured subscription can now reach an actionable owner queue without
  manual handoff between Import, Split and Tags.
- Existing manual import, deterministic/manual/AI split and explicit routing
  controls remain unchanged when the switch is off.
- The external preference schema remains version 1 and backward readable; no
  migration, package table or dependency is added by M1G-5B itself.
- Enabling or disabling the switch changes only subscription configuration and
  never changes evidence identity.

## Security, Privacy, and Licensing

The chain reads only the already admitted exact GitHub Markdown subscription.
It executes no repository code, follows no links and adds no Provider transfer,
secret or dependency. Private material stays local and remains hidden from
ordinary reads.

## Migration and Rollback

There is no database migration. Older preferences decode the new switch as
false. Rolling back M1G-5B ignores the field and returns changed subscriptions
to import-only behavior; Evidence, Entries, routing runs and work items remain
valid current data.

## Validation

- subscription service tests run the complete synthetic changed-source chain
  and prove the exact Snapshot-scoped Entry ledger reaches the existing
  execution repository;
- preference tests cover the default-off backward decoder and field
  preservation;
- client/UI tests cover explicit configuration transport and owner-visible
  outcome wording; and
- the ordinary repository quality gate verifies all unchanged manual paths.

## Explicitly Deferred

- generic RSS/API/Web/directory subscriptions;
- arbitrary source-triggered rules or multi-stage workflow editors;
- automatic AI proposal acceptance or private Provider transfer;
- automatic Entry/tag/Association/graph content mutation; and
- production scheduler, PostgreSQL/container and owner-data validation.

## References

- [ADR 0024](0024-versioned-git-source-subscriptions.md)
- [ADR 0027](0027-recoverable-entry-automation-routing-execution.md)
- [ADR 0030](0030-entry-automation-owner-work-queue.md)
- [Product requirements](../product-requirements.md)
- [Roadmap](../roadmap.md)
