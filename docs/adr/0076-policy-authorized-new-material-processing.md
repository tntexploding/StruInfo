# ADR 0076: Policy-authorized processing of new material

- Status: Accepted for implementation
- Date: 2026-09-12

The owner requested roadmap step 3: connect existing subscriptions and ordinary
manual imports to the bounded AI document task, without confirming every normal
article. Private transfer, historical bulk processing and reports remain outside
this increment.

A workspace policy explicitly selects public subscription identities and/or
manual imports, a configured model, per-document Entry/relation/call limits and
a daily new-document allowance. The policy defaults off. Pause keeps collecting
in-scope material into a durable queue while stopping subsequent model stages.
The workspace database stores policy state because capture and enrollment must
share one transaction; this data remains external to Git and the application.
Each queue row freezes the policy revision, settings and authorizing owner or
Agent identity. It is not inferred from preference scores or old routing flags.

The PostgreSQL evidence adapter exposes one optional transaction-local hook for
a newly inserted Snapshot. Trusted composition binds its origin to a manual
import or an exact subscription ID. Ordinary import endpoints and subscription
adapters use it; bulk tools and package restoration do not. A replay that adds
only observations cannot enroll an old Snapshot. The hook stores no source
content and never calls a model. An enrolled Snapshot bypasses the old
deterministic subscription split, including while processing is paused.

Migration 000035 adds the current policy and document queue. The worker/all role
polls the queue under a workspace-specific advisory lock. Daily admission uses
the evidence workspace transaction lock and a UTC day; retries reuse the
original document allowance and frozen task budget. Task creation is idempotent
by workspace, automation identity and Snapshot. Existing child proposal and
Entry concurrency checks remain authoritative.

Before generation and before acceptance, the task executor checks current
enable/pause state, scope, model, budgets and document takeover. A failed task
enters the attention queue and is retried only explicitly. Scope or budget
revocation also enters attention rather than blocking later permitted material. A paused or
interrupted policy-authorized task may continue automatically while that saved
authority remains active. Manual single-document tasks retain explicit restart
semantics. Completed writes are never rolled back by pause or takeover.

The existing owner HTTP gateway adds ingestion status, policy save and document
control. The MCP gateway exposes the same commands and public subscription
identities. A new independent automate grant is required for policy or queue
writes; read, annotate and process do not imply it. Status includes pagination,
filters, frozen authorization, progress, safe failure codes and model attempts.

Processing Bundle v12 includes both tables and reads earlier bundles with empty
policy/queue state. Restoration forces the policy paused and advances its
version before any worker can proceed. Credentials are never packaged. There
is no new dependency, provider, UI or deployed configuration in this increment.
