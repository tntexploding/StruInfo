# ADR 0077: Complete the bounded AI and Agent workflow

- Status: Accepted by owner request
- Date: 2026-09-12
- Scope: ADR 0075/0076 completion; no live model activation

The owner requested both channels to work end to end and explicitly chose to
finish implementation with no model configuration. This increment closes the
remaining ordinary-document, interface, operator-control and real-database gaps.

## Decisions

1. AI split input and acceptance share one deterministic evidence-unit selector.
   Existing section evidence retains its order. Ordinary CommonMark uses
   non-overlapping outermost block Fragments, excluding nested duplicates.
   If block coverage would omit non-whitespace text, the complete document
   Fragment is used. No source bytes or evidence identities are rewritten.
   The existing 64-unit / 120,000-code-point input and 24-group bounds remain;
   oversized inputs require owner handling.

2. External Agents can capture public Markdown, configure/check public
   unauthenticated Git, RSS/Atom, JSON API and constrained-web subscriptions,
   read canonical split units and current Entries, then submit a complete split
   partition without an internal model. The server reconstructs bodies from
   local Fragments and uses the existing proposal/empty-Snapshot acceptance.
   External split provenance is external-agent-v1. Existing grants are not widened:
   capture and structure are independent additions alongside read, annotate,
   process and automate. Private or credential-backed source administration
   remains owner-only. Source authorization is rechecked inside serialized execution.

3. Settings → AI exposes saved scope and budgets, runtime status, document tasks,
   queue progress, actual attempt counts and pause/retry/takeover. Inbox exposes
   the same queue. Draft state is separate from polling/filter state; a global
   pause uses the saved policy, and a CAS conflict preserves the draft.

4. Completed ProcessingRun creation retries compare immutable identity fields,
   not changing progress text. Association run reads include their typed
   payload, so acceptance can verify the frozen endpoint/override versions.
   Captured Markdown declares the same media type as existing Markdown sources.
   First capture runs can initialize an empty workspace under the same write lock.

5. tools/verify_ai_agent_flow.ts provides a reproducible PostgreSQL 18 synthetic
   end-to-end check using all migrations and restricted runtime grants. It
   refuses non-test database names and repository-local output. Fixtures,
   preferences and Blob bytes remain outside the repository; injected provider
   responses make no model network calls.

## Unchanged boundaries

No new migration, dependency, provider, public multi-tenant gateway, private
transfer, historical batch rewrite or report-generation feature is introduced.
Processing Bundle v12 carries the same tables; split task requests fit the
existing bounded typed task envelope. Existing manual proposal acceptance,
privacy and non-AI paths remain available. Model and external interface remain
off without explicit external configuration. Actual model quality, latency and
cost acceptance await owner-supplied configuration; this is distinct from
engineering completion.
