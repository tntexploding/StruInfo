# ADR 0087 — Source feedback and bounded AI execution

- Date: 2026-09-25
- Status: Accepted by owner; implementation increment

## Decision

Use existing public intake decisions as bounded context in the existing intake
model call. Retain positive and negative examples; include only explicit manual
notes as owner reasons. Earlier model assessments remain clearly identified.
Keep reference snapshot/version identifiers in the resulting intake state.
Private material, current-document versions and unrelated evidence are excluded.

The overview derives source-review alerts from at most twenty distinct reviewed
articles per public subscription. At least five adverse outcomes and a 50% rate
are required. Owner acknowledgement records the reviewed article keys; five new
adverse articles are needed to remind again. Show manual rejection, AI hold and
capture failure separately. Keeping a subscription, reopening its receipt records,
or explicitly closing it are owner actions; this replaces the earlier proposed
automatic suspension. Closing retains its catalog configuration and all documents.
Controls check the displayed catalog revision and intake sample versions.

Persist optional execution settings in the existing external AI policy. A shared
per-process limiter covers complete internal model responses; document scheduling
uses the same configurable 1–4 parallelism. Existing deployments default to one.
New document tasks freeze zero to two automatic checkpoint retries (default zero).
Only transient model and format errors retry, with one/two-minute backoff; retained
call and step budgets still limit every attempt. Reducing the setting restricts
pending retries, while increasing it never renews existing task authorization.
Manual holds, privacy, provider grants, dispatch gates, publication checks and
source scope remain authoritative. Report and immediate-tool failures remain
explicitly retried. Restored unfinished retry tasks require explicit continuation.

## Consequences and validation

No model fine-tuning, extra feedback call, distributed scheduler, dependency or
migration is introduced. The supported runtime remains a single all-role process.
Synthetic tests cover privacy, balanced examples, source deduplication, stale owner
decisions, persistent acknowledgement, complete-response concurrency, bounded
checkpoint recovery, revoked permission, manual controls and dormant restoration.
Local deployment uses the existing external instance and a verified recovery copy;
operational material never enters Git. Engineering checks do not establish model
selection quality; subsequent owner usage supplies that feedback.
