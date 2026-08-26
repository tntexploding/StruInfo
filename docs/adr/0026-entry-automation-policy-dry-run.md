# ADR 0026: Entry Automation Policy and Dry-Run Routing

- Status: Accepted
- Implementation: M1G-4A complete
- Date: 2026-08-25
- Owners: Main Agent / product owner
- Scope: M1G-4A

## Context

M1G-3 created an explainable, local `EntryPreferenceProfile`. It can summarize
the owner's explicit usefulness and interest annotations and can be trialled
against current Entries, but it deliberately has no automatic authority. The
next narrow boundary is to describe how a separately approved policy could turn
those two scores into routing candidates without yet executing any downstream
operation.

The active workspace remains data-free, so this increment cannot calibrate
real thresholds or claim that automatic processing is accurate. It must also
preserve the project's rapid-development rule: unreachable hardening and future
orchestrator concerns cannot block the runnable core. M1G-4A therefore freezes
only a portable policy record and a deterministic, read-only evaluator.

## Decision

### Separate, default-off authority record

One workspace-scoped `EntryAutomationPolicy` is stored in the external personal
preference file beside, but not inside, the `EntryPreferenceProfile`. It has:

- its own optimistic revision, enabled flag and pause flag;
- the exact Profile revision it was prepared against;
- independent usefulness and interest thresholds for advancing and deferring;
- a required one- or two-dimension agreement count for each direction;
- a minimum matched-rule evidence count;
- per-run Entry, advance-candidate and defer-candidate budgets; and
- the closed failure mode `pause` for a future executor.

All score thresholds are integer magnitudes from 1 through 320 because the
current Profile admits at most 64 rules of weight 5. The policy is disabled by
default. A Profile remains descriptive even when enabled; only a distinct,
enabled, unpaused policy bound to its exact Profile revision could later grant
automation authority.

The policy is personal data. It remains in the selected external data root and
is carried by the existing personal-data package. Old preference files and old
packages load a revision-zero disabled default. No policy value, Entry, source
text or owner preference enters Git or the application package.

### Deterministic dry-run only

M1G-4A exposes a pure domain evaluator, not an executor or HTTP command. It
reuses the accepted Profile trial over a current injected Entry snapshot, with
the same explicit privacy scope, Entry revision checks, Profile revision check,
100-Entry bound and stable Entry-ID order.

For each evaluated Entry:

1. an explicit manual-takeover identity always yields `manual_review`;
2. Entries beyond the run budget yield `manual_review`;
3. fewer matched rules than the policy minimum yields `manual_review`;
4. simultaneous advance and defer evidence across the two dimensions yields
   `manual_review`;
5. enough positive dimensions yields `advance_candidate`;
6. enough negative dimensions yields `defer_candidate`; and
7. otherwise the Entry remains `manual_review`.

Candidate budgets are then applied in stable order. Overflow returns to manual
review with an explicit budget reason. The result reports independent
usefulness and interest signals, the matched Profile rules, routing counts and
one closed reason per Entry.

The result also reports whether the saved policy would be operationally ready:
`disabled`, `paused`, `profile_disabled`, `profile_revision_mismatch` or
`ready`. This state does not change the dry-run calculation. Every successful
result is marked `dryRunOnly: true`; no route is executed and no
`ProcessingRun`, Entry revision, tag, Association, graph edge, proposal or
preference write is created.

### Ownership, privacy and takeover

Public-only remains the default consumer scope. Private Entries can participate
only when the current local caller explicitly supplies `includePrivate: true`.
No Provider is used. Manual takeover is request-local and wins before any
threshold or budget. It does not create a hidden permanent decision.

M1G-4A does not authorize automatic ignoring or deletion. A defer candidate is
only a lower-priority routing suggestion. The original Snapshot/Fragment
evidence and current Entry remain unchanged and searchable under their existing
rules.

## Alternatives Considered

- **Let the Profile directly route Entries:** rejected because descriptive
  preference evidence is not automation authorization.
- **Start an orchestrator together with the policy:** rejected because the
  owner needs visible, testable threshold behavior before any automatic write.
- **Collapse usefulness and interest into one score:** rejected because the two
  owner annotations have different meanings and mixed evidence needs manual
  review.
- **Store the policy in PostgreSQL:** rejected because it is portable personal
  configuration and must remain replaceable independently of the database.
- **Treat defer as ignore/delete:** rejected because it would recreate retired
  intake semantics and could hide or destroy reachable product content.

## Consequences

- Thresholds and budgets can be trialled deterministically before execution
  authority exists.
- Profile edits make a bound policy visibly stale instead of silently changing
  its meaning.
- Personal-data export and restore retain the policy without a migration or a
  new package section.
- This increment intentionally provides no owner-facing controls and performs
  no automatic work; those are later, separately bounded tasks.

## Security, Privacy, and Licensing

The evaluator is local and read-only. Privacy filtering occurs in the existing
Profile-trial boundary before routing. There is no network, filesystem or
Provider access in the evaluator, no secret handling and no new dependency or
licence obligation.

## Migration and Rollback

No database migration is required. Missing policy state upgrades to the
disabled default. Removing the optional field rolls behavior back to the same
default without changing Entry, Evidence, Association, graph or Processing
state. Since M1G-4A performs no business write, it needs no compensating rollback
operation.

## Validation

- closed decoder tests for bounds, unknown fields and owned frozen copies;
- old preference-file and personal-data-package compatibility;
- external file round-trip and sibling-preference preservation;
- stable routing, mixed-signal, threshold and candidate-budget tests;
- explicit manual takeover, privacy filtering and stale policy/Profile/Entry
  tests; and
- complete repository quality verification with synthetic value-free fixtures.

## Explicitly Deferred

- M1G-4B execution claims, ProcessingRun orchestration, policy revalidation,
  failure-driven pause and compensation;
- M1G-4C owner-facing policy editing and run controls;
- automatic split, tag, Association, graph or AI-proposal acceptance;
- private-content Provider transfer, behavior learning, query reordering,
  Embedding, vectors and RAG.

## References

- [ADR 0004](0004-adaptive-knowledge-ingestion-and-policy-authorized-writes.md)
- [ADR 0025](0025-explainable-entry-preference-profile.md)
- [Product requirements](../product-requirements.md)
- [Roadmap](../roadmap.md)
