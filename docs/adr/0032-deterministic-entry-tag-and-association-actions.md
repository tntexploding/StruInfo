# ADR 0032: Deterministic Entry Tag and Association Actions

- Status: Accepted
- Implementation: M1H-1A and M1H-1B complete
- Date: 2026-08-26
- Owners: Main Agent / product owner
- Scope: M1H-1A/B

## Context

M1G-4 records explainable routing facts and M1G-5 turns them into an owner work
queue. Even with a saved AutomationPolicy, an `advance_candidate` stopped at a
route label. The owner still had to open Tags, generate the same local lexical
tags and rebuild the same replaceable Association projection by hand.

M1H-1 closes that reachable gap without granting generic workflow authority or
restoring the retired Curation runtime.

## Decision

### Explicit, default-off action authority

`EntryAutomationPolicy` adds two independent, default-off flags under
`advanceActions`:

- `deterministicTags` authorizes the existing local lexical tag rule; and
- `rebuildAssociations` authorizes rebuilding the current replaceable
  Association projection after tag processing.

Only a completed `advance_candidate` claim can receive an action. Manual-review
and defer claims remain owner-queue facts. Enabling the source-subscription
chain does not itself enable either action; it uses the exact saved policy.

### M1H-1A deterministic tags

The server applies one bounded, versioned, network-free rule to the current
Entry body. It honors the external automatic-tag enable switch, exclusion list
and confirmed aliases, rejects duplicate normalized identities, preserves all
manual/AI/imported tags and only appends missing `origin=rule` content tags.

The action stores its exact rule origin version and resulting Entry optimistic
revision, but never copies Entry body or source bytes. A retry after the tag
transaction observes `tags_applied` and continues instead of adding the tags a
second time.

### M1H-1B Association rebuild

When enabled, the action loads the current privacy-scoped Entries and current
external AssociationPolicy, builds the existing deterministic projection and
uses the existing atomic replacement port. Pair-specific manual overrides and
Formal Knowledge graph metadata live outside that projection and are not
overwritten.

The action reaches `applied` only after the selected tag and projection steps
complete. A source-subscription cursor advances only after this action chain
also completes.

### Durable recovery and safe compensation

Forward migration `000020` adds one typed
`processing_entry_automation_action` row per authorized advance claim. Its
state machine is:

```text
pending → tags_applied → applied → undo_pending → undone
   └────────────────────────────────────────────→ cancelled (failed run only)
```

The Tags work queue exposes retry and compensation. Undo is permitted only
while the Entry still has the exact action result revision. It removes only the
tags carrying that action's rule-origin version, advances the Entry concurrency
revision when needed and rebuilds the replaceable projection again. Any later
manual Entry edit makes the action stale instead of overwriting owner work.
Immutable Snapshot/Fragment evidence and routing claims are never deleted.

Processing Bundle v7 carries the fourteenth Processing table. V1 through v6
remain readable and restore missing action state as empty. The complete
personal-data package now covers 60 workspace tables.

## Alternatives Considered

- **Run actions for every route:** rejected because manual-review and defer are
  not write authority.
- **Use AI tag proposals automatically:** rejected because AI acceptance remains
  explicit and independent.
- **Replace all current tags:** rejected because deterministic automation must
  not erase manual, AI or imported annotations.
- **Persist a full Entry copy for undo:** rejected because immutable evidence
  plus exact rule-origin tags and optimistic revisions provide bounded
  compensation without repeated personal-data copies.
- **Turn Association projection into graph assertions:** rejected because
  calculated similarity remains a replaceable navigation signal.

## Consequences

- The local no-Provider path can now run `import → split → route → deterministic
tags → Association rebuild → owner queue → query` when the owner enables both
  policy flags.
- Manual import, split, Tags editing, Association controls and Query remain
  complete while the flags are off.
- One migration and one backward-compatible Processing section version are
  added; no dependency, Provider, background crawler or real fixture is added.
- Work items remain independently completable or dismissible after their action
  state settles.

## Security, Privacy, and Licensing

All action logic is local. Private Entries require the current request or
private subscription scope before body/tag access and never reach a Provider.
The action table stores identifiers, authority flags, versions and counts—not
Entry body, Blob bytes, prompts, secrets or arbitrary JSON. No dependency or
license obligation is introduced.

## Migration and Rollback

Migration `000020` creates the action table and index without backfilling old
runs, because earlier policies granted no downstream action authority. Rolling
back application code leaves typed action audit rows intact. Safe compensation
is an explicit forward operation; database downgrade and destructive history
rewrites are not performed.

## Validation

- deterministic-tag tests cover filtering, aliases, deduplication and bounded
  network-free output;
- action-service tests cover tag application, projection rebuild, idempotent
  continuation and exact-origin compensation;
- migration and PostgreSQL repository tests cover typed state, successful-run
  availability and failed-run cancellation;
- API/client/Web tests bind the default-off controls, work-queue status,
  retry/undo and privacy inputs;
- Bundle tests cover v1-v6 upgrade to empty v7 action state; and
- the ordinary repository quality gate covers formatting, lint, TypeScript,
  unit/integration tests, build and artifact isolation.

## Explicitly Deferred

- automatic AI proposal acceptance or private Provider transfer;
- automatic manual-review/defer actions, deletion, hiding or score changes;
- learned action selection, arbitrary workflow editors and cross-source rules;
- automatic graph assertion creation; and
- owner-data, production PostgreSQL/container and release validation.

## References

- [ADR 0027](0027-recoverable-entry-automation-routing-execution.md)
- [ADR 0030](0030-entry-automation-owner-work-queue.md)
- [ADR 0031](0031-subscription-deterministic-entry-routing-chain.md)
- [Product requirements](../product-requirements.md)
- [Roadmap](../roadmap.md)
