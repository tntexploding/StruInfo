# ADR 0089: Source receiving strategies

- Status: Accepted for P2 implementation, 2026-10-24
- Related: [content-system plan](../content-system-refactor-plan.md), [ADR 0088](0088-confirmed-content-and-deferred-organization.md)

## Decision

Retain the connector registry and the shared evidence/intake write path.
RSS, JSON API, Web, installed adapters and Git remain transport components.
An external source instance independently selects manual checks, one successful
collection, interval polling, or a weekly local-time window. The existing interval
limits request frequency within a window. After downtime, perform one overdue
check rather than replaying missed windows. Failures use bounded exponential
backoff. Explicit checks remain available while automatic checking is disabled.

The external preference revision protects changes. Adjusting cadence or priority
preserves the live cursor; changing transport identity retains the existing reset
behavior. Saved configurations without a strategy retain interval polling.
Capabilities describe the installed implementation: public history discovery is
available for RSS/Web, not for every source. Discovery is not a promise that a
publisher exposes its complete archive. Webhooks and arbitrary search schedules
are not implemented or advertised.

Live and historical imports use the same immutable evidence writer. A receipt
freezes its channel and source strategy in the existing intake JSON, in the same
transaction as evidence. History remains pending owner review and does not grant
automatic processing or change the live cursor. Cross-source history checks retain
each source's own receipt rather than treating another source's capture as its own.

Connector resource identity remains source plus external article identity. New
snapshot identity uses article version, projection and parser profile, excluding
unrelated changes to the enclosing RSS response. The first original response stays
immutable. Existing v1 snapshots are recognized when their raw/projection identity
matches; no historical records are merged or rewritten. Repeated imports skip the
stored snapshot and cannot reset a receipt decision. Capture command keys include
the resource identity so two articles with the same content do not conflict.
Partial import failure leaves the live cursor unchanged; the next check reuses
saved articles and writes the missing ones.

## Queue and authority

The ingestion dispatcher orders eligible tasks by source turns, then urgency,
explicit preference and waiting time. A source cannot consume every first turn.
Waiting gains one point per hour; urgency contributes +24/0/-12, owner preference
contributes -10 to +10, and explicitly admitted history has a -12 offset.
These are scheduling units, not factual-confidence scores. Completeness remains
an intake assessment; owner decisions are preserved. No model decision increases
credibility or creates a new processing grant.

Existing ingestion settings still determine which new receipts receive tasks.
History capture is review-only. Existing price, permission, privacy, daily limits,
frozen task limits and publication checks continue to apply. P2 does not dispatch
the P1 organization records or change saved AI task semantics.

## Interfaces and storage

Owner source HTTP and Agent `subscription_put` accept the same strategy schema.
Owner listing and `subscriptions_read` expose next check, waiting reason, recent
new material, pending count and fetch failures. Agent reads continue to omit
private sources and owner-managed credentials/configuration.

No migration or dependency is required: strategies/check state use external
preferences and reception metadata uses the existing intake JSON. Current bundle
export/restore retains these fields. Old records without a channel remain marked
as unknown; their channel is not guessed from receipt time. The private instance
is not changed during P2 validation.

## Validation

Synthetic unit tests cover cadence, time zones, DST, backoff, configuration and
history controls. `pnpm test:publication` includes P2 cases in its disposable
PostgreSQL workspace: partial imports, duplicate response recovery, preserved
manual refusal, independent history admission, source fairness and unpublished
content visibility. Browser checks exercise the source form and narrow layouts.
