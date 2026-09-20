# ADR 0082: DeepSeek off-peak model dispatch

- Status: Accepted by the owner's request on 2026-09-14
- Scope: One external workspace price policy and existing model operations

## Decision

Add a default-off owner setting under Settings → AI. DeepSeek's official pricing,
verified on 2026-09-14, defines peak periods as Monday–Friday 09:00–12:00 and
14:00–18:00 in Beijing; all other periods, including weekends, are off-peak at
half the peak price. Use explicit UTC+08:00 calculation independent of host time
zone, with inclusive starts and exclusive ends. The rule is version-labelled and
links to the official pricing page; do not reuse the superseded overnight rule.

Source: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/

The policy is a revision-checked optional field in external workspace preferences
and personal-data packages. Older packages default it off. This rule applies only
to the selected DeepSeek Responses provider. It neither changes model credentials
nor enables ingestion, expands source scope, changes call budgets, or grants
external Agents new permissions.

Every Responses request is checked immediately before network dispatch, including
intake review, split, tags, multilingual recall, associations, translation, query
synthesis, and daily/weekly report planning and summaries. Existing in-flight
requests may finish. Raw subscription capture, deterministic operations, cached
translations and local reads remain usable. Standalone synchronous tools return
a distinct price-window notice and require another request in the off-peak period.

Durable document tasks and report generation wait before claiming a model call.
A final-dispatch time-boundary rejection returns the unsent call/attempt budget;
document retry identities remain distinct from the aborted proposal run. Existing
completed steps, evidence and manual edits remain intact. A bounded minute poll
resumes only price-deferred requests, including after an ordinary service restart.
Manual pauses, cancellation, existing ingestion policy, actor/model configuration,
Agent process/capture grants, source privacy and revisions still take precedence.
Unrelated interrupted or failed tasks retain explicit continuation behavior.

On personal-data package restoration, price-deferred tasks become explicitly
paused and reports become explicitly resumable, with a new concurrency version;
neither starts automatically. Keep their spent budgets and archive bytes intact.
There is no migration, dependency, report publication or recurring-report creation
in this increment. The existing Processing Bundle v14 structure remains readable.

## Verification

Use synthetic clocks and material for exact boundaries, weekends, all provider
operations, mid-task transitions, unsent budget refunds, restart, cancellation,
revoked permissions, preference CAS and package compatibility. Check the settings
in a real browser at the existing responsive widths. Instance settings and any
deployment evidence stay outside Git; no paid model call is needed to verify a
dispatch restriction.
