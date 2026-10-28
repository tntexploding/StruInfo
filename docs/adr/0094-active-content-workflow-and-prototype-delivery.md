# ADR 0094: One active content workflow and five-page delivery

- Status: Accepted
- Date: 2026-10-28
- Supersedes active orchestration in ADR 0085; retains historical payload decoding.
- Builds on ADRs 0088–0093.

## Decision

New document tasks carry `confirmed-content-v1`. Receipt review, source-aware structure and required annotations finish before confirmation. The application publishes a revision-checked snapshot and registers independent organization work. Topic grouping and selective relations run through P5 with a selected bounded budget; their absence or failure does not delay publication.

Manual acceptance, automatic ingestion, batch admission and HTTP/MCP commands use this same task creation and publication boundary. Standalone manual/external split and annotation operations remain drafts until explicit confirmation. Privacy, manual decisions and execution gates continue to apply.

The old document task executor cannot resume, restart or replan historical tasks. Historical records remain readable and cancellable; new tasks need a new explicit admission. Old entry-scoring automation execution, preference-scoring APIs and source import routing have no active endpoint. Stored archive codecs are retained for restoration and inspection.

Source configuration exposes a bounded retry count. Retry timing is application policy. Receipt creation never runs the retired Entry materializer/routing sequence. Source guidance is frozen into new split/tag/topic inputs; changing guidance does not rewrite prior work.

The frontend directly reuses the accepted overview, source, reading, database and settings prototype layout/styles. Demonstration data is replaced by application state. Overview owns the queue, source management owns intake, reading owns document edits, database owns retrieval/reports, and settings owns global configuration. Report drafts survive navigation to their sources; private query scope is reselected after leaving the page.

## Compatibility and delivery

P1–P6 migrations remain forward-compatible. Processing Bundle v19 reads prior formats and restores model automation paused. Historical tables/codecs are not an alternative active write path. Restoring data never resumes an old executor or renews a budget.

Release checks use synthetic providers and disposable PostgreSQL. Real sources, credentials, private data and prototype captures stay outside the published source. The public release is a normal child of public main; internal development history is not merged.
