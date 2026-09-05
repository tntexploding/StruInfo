# Architecture Decision Records

Use an Architecture Decision Record (ADR) for a consequential implementation
decision that will be expensive or risky to change later.

Examples include the runtime and repository layout, persistence model, source
snapshot retention, external AI data boundary, authentication, asynchronous job
semantics, API versioning, deployment, and cloud-to-local communication.

## Process

1. Copy `0000-template.md` to the next four-digit number and a short kebab-case
   title, for example `0001-runtime-and-repository-layout.md`.
2. Start with status `Proposed` and include real alternatives.
3. Link the approved ADR from `docs/decision-log.md`.
4. Do not rewrite an accepted decision to hide history. Add a new ADR and mark
   the old record `Superseded`.

## Records

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-typescript-modular-monolith.md) | Accepted | TypeScript modular monolith and toolchain |
| [0002](0002-postgresql-persistence-and-durable-work.md) | Accepted | PostgreSQL persistence, durable work, and Blob storage |
| [0003](0003-m0-s-engineering-foundation.md) | Accepted | Exact engineering foundation, dependency policy, quality gates, and migration boundary |
| [0004](0004-adaptive-knowledge-ingestion-and-policy-authorized-writes.md) | Accepted | Adaptive knowledge ingestion, separated exploration policy, and policy-authorized formal writes |
| [0005](0005-versioned-knowledge-core-and-ai-optional-operations.md) | Accepted | Versioned relational knowledge core and complete AI-optional operations |
| [0006](0006-external-configuration-and-personal-data-isolation.md) | Accepted | External runtime configuration and isolation of all personal data from source and packages |
| [0007](0007-information-entry-first-document-processing.md) | Accepted | InformationEntry-first document processing, annotation, association, and retrieval while preserving formal knowledge |
| [0008](0008-current-entry-state-and-portable-personal-data.md) | Accepted | Current Entry state, unified Tags review and portable personal-data packages |
| [0009](0009-retire-superseded-m1c-runtime.md) | Accepted | Retire superseded M1C runtime while preserving migrations and external-data compatibility |
| [0010](0010-entry-centered-formal-knowledge-graph.md) | Superseded | Centre-search and bounded-neighbourhood shape retained; edge admission superseded by ADR 0011 |
| [0011](0011-association-derived-formal-graph-edges.md) | Accepted | Deterministic similarity associations are editable Formal Knowledge graph edges |
| [0012](0012-provider-neutral-processing-runs-and-proposals.md) | Accepted | Provider-neutral durable processing runs and typed proposal envelopes |
| [0013](0013-openai-entry-tag-proposals.md) | Accepted | Optional OpenAI Responses API tag proposals for public Entries with manual acceptance |
| [0014](0014-openai-entry-association-proposals.md) | Accepted | Optional OpenAI selected-pair Entry association proposals with manual graph acceptance |
| [0015](0015-openai-entry-split-proposals.md) | Accepted | Optional OpenAI public-Snapshot split proposals with exact Fragment review and manual Entry materialization |
| [0016](0016-manual-entry-fragment-grouping.md) | Accepted | Local manual grouping at existing Fragment boundaries before atomic Entry materialization |
| [0017](0017-manual-within-fragment-entry-boundaries.md) | Accepted | Exact manual Unicode-scalar boundaries inside immutable Fragments before first Entry materialization |
| [0018](0018-local-text-file-import.md) | Accepted | Explicit local Markdown/plain-text file capture through the existing Evidence import |
| [0019](0019-local-html-pdf-import.md) | Accepted | Exact raw HTML/PDF evidence with a deterministic local text projection for the existing Split path |
| [0020](0020-explainable-lexical-entry-search.md) | Accepted | Explainable exact, substring and spelling-tolerant Entry search without AI or a new search stack |
| [0021](0021-query-association-and-result-comparison.md) | Accepted | Query-owned Association navigation and two-result comparison without a new backend boundary |
| [0022](0022-evidence-bounded-ai-query-synthesis.md) | Accepted | Explicit public-only AI synthesis over bounded deterministic Entry query evidence |
| [0023](0023-deterministic-entry-exploration-policy.md) | Accepted | Default-off explainable Entry exploration over current visible direct Associations |
| [0024](0024-versioned-git-source-subscriptions.md) | Accepted | Versioned exact GitHub Markdown subscriptions through external preferences and existing Evidence import |
| [0025](0025-explainable-entry-preference-profile.md) | Accepted | Complete local explainable Entry preference rules, read-only trial evaluation and integration boundary before automation authority |
| [0026](0026-entry-automation-policy-dry-run.md) | Accepted | Default-off external Entry automation policy and deterministic read-only routing trial without execution authority |
| [0027](0027-recoverable-entry-automation-routing-execution.md) | Accepted | Durable idempotent Entry routing claims with exact revalidation, failure pause and compensation |
| [0028](0028-owner-controlled-entry-automation-routing.md) | Accepted | Owner-controlled policy editing, trial, manual takeover, durable start and routing audit without downstream content mutation |
| [0029](0029-entry-automation-control-integrity.md) | Accepted | Exact automation-run audit, independent request generations and responsive recovery visibility without new execution authority |
| [0030](0030-entry-automation-owner-work-queue.md) | Accepted | Successful routing claims become a durable owner work queue without changing immutable execution facts or Entry content |
| [0031](0031-subscription-deterministic-entry-routing-chain.md) | Accepted | Default-off changed-source chaining reuses Evidence import, deterministic Entry materialization and recoverable routing |
| [0032](0032-deterministic-entry-tag-and-association-actions.md) | Accepted | Recoverable deterministic tag and Association actions for advance candidates only |
| [0033](0033-post-materialization-entry-restructuring.md) | Accepted | Owner-controlled post-materialization Entry restructuring with impact preview and lineage |
| [0034](0034-pre-split-derived-document-editing.md) | Accepted | One current pre-split working copy confirmed as a new immutable derived Snapshot |
| [0035](0035-versioned-configurable-entry-split-rules.md) | Accepted | External versioned deterministic Entry split rules with preview and explicit apply |
| [0036](0036-explicit-local-multi-file-import-queue.md) | Accepted | Explicit session-only local multi-file import queue over the existing Evidence boundary |
| [0037](0037-plugin-compatible-source-acquisition-foundation.md) | Accepted | Shared bounded source-connector result and remote-document Evidence import foundation |
| [0038](0038-public-rss-atom-source-subscriptions.md) | Accepted | Public RSS/Atom subscriptions through external preferences and host-owned import |
| [0039](0039-declarative-json-api-source-subscriptions.md) | Accepted | Bounded declarative JSON API subscriptions without a script or generic REST surface |
| [0040](0040-constrained-web-source-subscriptions.md) | Accepted | Explicit same-origin Web page subscriptions with server-owned extraction and no discovery |
| [0041](0041-installed-source-connector-product-wiring.md) | Accepted | Visible installed connector capabilities and portable external configuration references |
| [0042](0042-formal-knowledge-relation-semantics-and-source-review.md) | Accepted | Closed Formal Knowledge relation semantics, maintenance notes and explicit source-review status |
| [0043](0043-rebuildable-entry-search-index-and-rag.md) | Accepted | Rebuildable Entry term/vector index, optional semantic recall and evidence-bounded RAG |
| [0044](0044-evidence-driven-local-performance.md) | Accepted | Repeatable data-free performance workload and evidence-driven local optimizations |
| [0045](0045-operational-production-baseline.md) | Accepted | Maintainable single-host production runtime, secrets, backup/restore and upgrade boundary |
| [0046](0046-codex-operated-bulk-ingestion.md) | Accepted | Provider-free Codex-operated recoverable bulk Snapshot-to-Entry ingestion |
| [0047](0047-deterministic-bulk-enrichment.md) | Accepted | Deterministic bulk tags, typed exceptions and incremental Association replacement |
| [0048](0048-bulk-ingestion-exception-adjudication.md) | Accepted | Closed bulk-ingestion exception summary, sampling and guarded adjudication |
| [0049](0049-disposable-postgresql-bulk-ingestion-benchmark.md) | Accepted | Disposable PostgreSQL 18 end-to-end bulk-ingestion benchmark and recovery evidence |
| [0050](0050-external-codex-review-work-packages.md) | Accepted | External bounded Codex review work packages for current ingestion exceptions |
| [0051](0051-closed-codex-review-result-application.md) | Accepted | Closed stale-safe Codex review-result application and incremental rebuild |
| [0052](0052-unified-bulk-ingestion-pipeline-control.md) | Accepted | Unified bounded P0A–P0F pipeline control over persisted stage state |
| [0053](0053-real-scale-capacity-classification-and-query-follow-up.md) | Accepted | Real-scale backup capacity, complete document paging, deterministic classification and indexed lexical candidates |
| [0054](0054-classification-diagnostics-field-weighting-and-external-profile.md) | Accepted | Classification diagnostics, field-weighted rules and external personal classification profiles |
| [0055](0055-scaled-codex-classification-review.md) | Accepted | Scaled Codex classification review through the existing closed packet/result boundary |
| [0056](0056-entry-type-coverage-and-correction-workbench.md) | Accepted | Entry type coverage reporting and focused correction workbench |
| [0057](0057-high-coverage-deterministic-type-completion.md) | Accepted | Conservative high-confidence deterministic type completion |
| [0058](0058-calibrated-classification-profile-and-neighbor-consensus.md) | Accepted | Per-category classification calibration, larger external profiles and bounded neighbor consensus |
| [0059](0059-trusted-entry-type-learning-profile.md) | Accepted | Trusted Entry type samples and an inactive explainable local learning profile |
| [0060](0060-balanced-type-learning-and-projection-gate.md) | Accepted | Balanced type-learning samples, zero-support protection and full-projection activation gates |
| [0061](0061-cross-validated-type-learning-calibration.md) | Accepted | Cross-Snapshot calibration, bounded body features and misclassification diagnostics |
| [0062](0062-production-release-identity-and-live-deployment-baseline.md) | Accepted | Separate public release, current development and owner-confirmed live deployment identities |
| [0063](0063-backup-recoverability-and-retention-preview.md) | Accepted | Read-only backup verification and non-destructive retention preview |
| [0064](0064-operational-health-capacity-and-alerting.md) | Accepted | Privacy-safe operational health, capacity and backup-age alert boundary |
| [0065](0065-production-flow-release-regression.md) | Accepted | Disposable PostgreSQL 18 five-step release regression |

The foundational application and persistence decisions were accepted on
2026-08-08 after the M0-P architecture gate. The non-browser, non-container
engineering foundation was accepted on 2026-08-10 after fixed-candidate
Windows/Linux testing and material closure review. The first product authority
model was accepted on 2026-08-10 after the owner confirmed the knowledge-core,
preference/exploration, and progressive-automation requirements.
The personal-data isolation boundary was accepted on 2026-08-10 by explicit
owner requirement. ADR 0005 now fixes the canonical versioned knowledge model,
including deterministic fuzzy and associative retrieval without AI.
ADR 0007 partially supersedes ADR 0005 only at the product workflow layer:
ordinary document material now becomes searchable `InformationEntry` records
before optional formal semantic knowledge, while ADR 0005 remains the formal
knowledge model. ADR 0008 makes routine Entry editing current-state based and
turns exports into complete personal-data packages. ADR 0009 removes the
superseded M1C application runtime; accepted migrations and historical data
remain compatible, while a future Formal Knowledge page requires a new product
boundary. ADR 0010 accepted the Entry-centred page shape and was then partially superseded
by ADR 0011: deterministic similarity associations may appear directly as
formal graph edges, while visible origin and durable user edits or blocks retain
owner authority. ADR 0012 adds durable provider-neutral processing runs and
typed proposal envelopes without selecting an AI provider or creating a second
write path. ADR 0013 selects one optional OpenAI tag-proposal path; ADR 0014
reuses that provider boundary for a user-selected public Entry pair and accepts
a typed relation proposal only through the existing graph command. ADR 0015
adds an explicitly selected public-Snapshot split proposal whose exact Fragment
groups materialize only after manual acceptance through the existing Entry
boundary. ADR 0016 adds the complete no-Provider owner path for grouping those
same immutable Fragments before the first Entry structure is committed. ADR 0017
extends that path to exact Unicode-scalar ranges without rewriting source evidence. ADR 0018 accepts explicit local Markdown/plain-text capture; ADR 0019 extends the same Evidence path to semantic HTML and PDF text-layer projections while retaining exact raw files externally. ADR 0020 extends the existing deterministic Entry query with explicit exact, substring and spelling-tolerant lexical modes, field scope, visible scores and cursor binding without AI, a migration or another search service. ADR 0021 completes the Query workspace with an explicit Association traversal entry point and a query-bound two-result comparison surface while reusing that same public search boundary. ADR 0022 completes the next narrow Query increment: an explicit, session-only, public-only OpenAI synthesis over a bounded deterministic evidence pack, with claim-level local source references and no retrieval or write authority.

ADR 0023 adds a default-off local exploration lane without changing ordinary
retrieval. ADR 0024 adds one exact public-GitHub Markdown subscription through
external preferences, real ProcessingRun records and the existing Evidence
import authority; it does not add a generic crawler or Provider boundary.
ADR 0025 governs the current product increment: M1G-3A implements its
default-off external Entry PreferenceProfile state and package compatibility,
M1G-3B implements deterministic suggestions and bounded read-only trials, and
M1G-3C exposes the narrow commands and secondary Tags panel. M1G-3D completes
atomic sibling-preference updates, stale-response protection and the privacy,
backward-package, responsive-browser and artifact checks. The accepted boundary
does not grant automatic routing or Provider authority.
ADR 0026 starts M1G-4 with the separate authority record deliberately required
by ADR 0025. M1G-4A persists a default-off Entry AutomationPolicy externally and
can explain deterministic advance, defer and manual-review candidates in a
bounded dry-run. It does not execute a route or create automatic write
authority.

ADR 0027 completes M1G-4B by durably executing that routing decision as an
idempotent ProcessingRun and exact per-Entry claims. Policy, Profile and Entry
revisions are revalidated before completion; failure pauses only the still
matching policy revision and compensates open claims. This records routing
facts only and does not infer automatic tag, Association, graph or AI-proposal
write authority.

ADR 0028 completes M1G-4C through six narrow local API operations and a
secondary Tags control panel. The owner can edit, enable, disable, pause,
resume, trial, manually take over, start and inspect routing runs. A run binds
only a saved ready policy and its exact Profile/Entry revisions; completed
claims still do not mutate Entry content, tags, Associations, graph edges,
queries or AI proposals.

ADR 0029 completes M1G-4D by making the existing exact-run operation a real
owner-facing audit path and separating policy, save, trial, execution, list and
detail request generations. Late responses cannot replace newer visible
authority, unresolved claims remain explicit, and the responsive Tags control
surface adds no downstream content-write permission.

ADR 0030 completes M1G-5A by projecting every successfully completed routing
claim into a separate durable owner work item. Pending/completed/dismissed state
is optimistic and reversible, stale Entry revisions remain visible, and neither
the work item nor its UI changes the immutable claim or Entry content.

ADR 0031 completes M1G-5B by adding one default-off subscription switch that
chains a changed exact GitHub Markdown source through the existing Evidence
import, deterministic empty-Snapshot Entry materialization and M1G-4 execution.
The successful cursor advances only after the whole chain succeeds; no AI or
automatic content-edit authority is implied.

ADR 0032 completes M1H-1A/B with explicit default-off deterministic Entry tag
application and replaceable Association projection rebuild for completed
advance candidates, including typed recovery and exact-origin compensation.

ADR 0033 completes M1H-2A/B with a preview-first, owner-confirmed replacement
of an already materialized Entry partition. Snapshot/Fragment evidence remains
immutable; retired Entries remain lineage endpoints while current reads use one
atomic successor structure with annotation and relationship impact controls.

ADR 0034 completes M1H-3A/B with one current pre-split full-text working copy
per source Snapshot and an explicit confirmation that creates a new immutable
derived Snapshot through the existing Evidence/CommonMark path. It preserves
the original Blob/Snapshot/Fragment evidence, inherits privacy, adds Entry
Bundle v5 and does not create edit history or a second split implementation.

ADR 0035 completes M1H-4A/B with an external versioned deterministic split-rule
profile and a preview/apply surface that still uses immutable Fragment evidence
and the existing empty-Snapshot materialization boundary.

ADR 0036 completes M1H-5A/B with an explicit, session-only local multi-file
queue. Every selected file keeps the existing validation, privacy, idempotent
Evidence import and external Blob path; per-file results, stable retries and
stop-after-current control add no batch write protocol or automatic downstream
authority.

ADR 0037 starts the owner-selected pre-launch external-source phase. M1I-1A
adds one bounded source-connector result and runtime registry shared by built-in
readers and optional installed plugin adapters. M1I-1B adds the
remote_document Evidence kind and a deterministic multi-document import
preparer that retains exact remote bytes externally and advances no cursor
itself. Git remains the only public remote subscription until the later
RSS/Atom, declarative JSON API and constrained Web adapters are wired.

ADR 0038 completes M1I-2 with one built-in public RSS/Atom adapter on that
shared connector boundary. External preferences, the existing API/scheduler and
Import UI now support conditional Feed checks, bounded item-version cursors,
server-owned HTML-to-Markdown projection and per-item Evidence import. Item
links remain source references and are never crawled; JSON API, constrained Web
and installed-plugin product wiring remain later M1I increments.

ADR 0039 completes M1I-3 with one built-in read-only declarative JSON API
adapter. External preferences and the Import page store bounded property
mappings plus optional page/incremental cursors; Bearer secrets remain in a
named runtime environment variable. Complete bounded pages become individual
remote-document Evidence records before the host advances the connector cursor.
It is not a generic REST client, script runner or Web crawler.

ADR 0040 completes M1I-4 with one built-in constrained Web adapter. The owner
lists one public HTTPS page and at most seven same-origin paths; the server
extracts article/main/body content, retains exact raw bytes externally and
uses conditional per-page cursors. It never discovers links, follows redirects,
uses a login session or becomes an open crawler.

ADR 0041 completes M1I-5 by exposing only the connector capabilities actually
injected by the trusted runtime composition. Plugin subscriptions persist a
stable adapter ID and an opaque external configuration reference, never code,
secrets or configuration payloads. Installed adapters still return only bounded
documents and receive no domain write port.

ADR 0042 completes M1J on the existing Entry-centred graph. It adds closed
relation semantics, a bounded maintenance note and an explicit source-review
status to the current Association override, exposes both endpoint sources in the
relation inspector and upgrades Association personal-data packages to v4. It
does not restore the retired Knowledge runtime or claim automatic fact checking.

ADR 0043 completes M1K with a rebuildable, revision-bound Entry term/vector
index in PostgreSQL, optional OpenAI embeddings, lexical/semantic/hybrid Query
modes, explicit Recall@K/MRR evaluation and evidence-bounded RAG through the
existing query-synthesis action. Lexical Query remains complete without a
Provider, private content never enters the external embedding/RAG path and the
derived index is deliberately excluded from personal-data packages.

ADR 0044 completes M1L with a repository-owned synthetic performance workload
covering import, split, index, query, graph and connector paths. It removes the
measured repeated Association-map construction and duplicate HTTP search loads,
while treating timings as same-machine comparison evidence rather than a test
threshold or production SLO. It adds no migration, dependency, cache service or
real data.

ADR 0045 completes M1M with a non-root multi-stage image, privilege-separated
runtime and maintenance manifests, external secret files, explicit migration,
queue preparation and grant order, and executable personal-data backup/empty-
workspace restore operations. Target-image, real PostgreSQL 18, public-network
and distribution certification remain explicit release-time gates.

ADR 0046 starts M2-P0A with a Codex-operated, Provider-free bulk ingestion
control plane. It freezes bounded Snapshot plans, treats one Snapshot as one
atomic transaction shard, records every attempt through existing ProcessingRun
state and adds pause/resume/retry/status/report maintenance commands. Processing
Bundle v8 carries only typed batch control rows; source bytes remain external.

ADR 0047 completes M2-P0B by continuing a successful P0A batch through the
existing deterministic tag rules and an incremental Association rebuild. Entry
updates are atomic per Snapshot, user overrides survive projection replacement,
typed exceptions expose rule gaps without copying content, and Processing Bundle
v9 carries the recoverable state. Its 15,000-entry synthetic core benchmark is
performance direction evidence, not end-to-end acceptance.

ADR 0048 completes M2-P0C with a maintenance-only exception review control
plane. It separates current and stale Entry revisions, returns deterministic
content-free samples and applies only exact-count guarded group transitions.
Processing Bundle v10 carries one current adjudication table; no decision writes
Entry content, tags, Associations or Provider state.

ADR 0049 completes M2-P0D with a disposable PostgreSQL 18 benchmark over the
real Evidence, P0A, P0B and P0C boundaries. A fixed synthetic 500-Snapshot /
15,000-Entry workload proves migration replay, controlled failure recovery,
persisted counts and cleanup in about 15 minutes on the recorded local machine.
It is development-cycle engineering evidence, not a real-corpus or production
SLO, and ordinary verification remains independent of Docker.

ADR 0050 completes M2-P0E with external, deterministic Codex review work
packages for current pending exceptions. Packets and invalid-by-default result
templates live only under the external data root, bind exact Entry/adjudication
revisions and require an explicit current-command opt-in before including private
content. No Provider, database write or browser executor is introduced.

ADR 0051 completes M2-P0F with a closed review-result decoder and idempotent
application boundary. Exact packet/result identity gates one atomic set of Entry
annotation revisions, exact adjudication transitions and an incremental
Association rebuild while rejecting placeholders, open fields and stale state.

ADR 0052 completes M2-P0G with one thin, bounded bulk-ingestion state machine.
It advances P0A materialization, P0B enrichment and P0C review in that order,
returns a closed next action and never hides stage-specific recovery or creates
a second background workflow engine.

ADR 0053 completes M2-P1A–D from the first real-scale ingestion feedback. It
raises the still-bounded complete-package capacity, pages the complete Snapshot
catalog, fills only missing unambiguous type/domain classifications through an
explicit enrichment refresh, and uses the existing derived term index to narrow
eligible public lexical queries while retaining a semantics-complete fallback.

ADR 0054 completes M2-P2A–D without touching owner data. It separates missing
classification causes, replaces flattened v1 matching with field-weighted and
fail-closed v2 scoring, emits one primary plus at most two qualified secondary
domains, and carries owner aliases/mappings/exclusions in external preferences
and the complete personal-data package. Residual Codex review and UI controls
remain deferred until the refreshed real distribution is measured.

ADR 0055 completes M2-P2E after that real refresh measured 11,794 residual
classification exceptions. Explicit classification groups may reuse the existing
P0E/P0F packet and exact-apply protocol in batches of up to 100, with current
annotations prefilled and only missing dimensions left as invalid placeholders.
Other exception packets remain capped at 20; privacy, byte limits, stale-state
rejection and external-file isolation remain unchanged.

ADR 0056 completes M2-P2F for the largest observed residual category: missing
Entry types. The Tags workspace exposes current coverage, per-type counts and a
cursor-paged correction queue. PostgreSQL hydrates only the visible page and
type saves reuse the existing Entry CAS revision while preserving all other
annotation and evidence fields. Privacy remains explicit; no migration,
Provider, dependency or automatic rewrite is introduced.

ADR 0057 completes M2-P2G with a high-confidence deterministic type-completion
lane. Classifier v4 accepts explicit body-level genre signals and only explicit
dataset/statistics/reference-material signals without guessing generic linked
resource cards or `other`. A redacted preview reports coverage and
stable samples; apply reuses the recoverable enrichment refresh and never
overwrites an existing type. Remaining uncertainty is routed to the existing
Codex packet and Tags correction paths.

ADR 0058 completes M2-P3A–C with per-category thresholds, a larger external
Profile v2 and bounded privacy-separated neighbor consensus.

ADR 0059 completes M2-P4A–C with an external trusted-sample registry, diverse
active sampling, a closed Codex work package, an explainable sparse local type
model and snapshot-grouped shadow evaluation. Candidate models remain inactive
until an explicit activation gate passes; later API adapters must reuse the same
packet/result and Profile boundary.

ADR 0060 completes M2-P4D after the first quarantined real-scale labeling trial
exposed class imbalance, zero-sample smoothing and projection-blind activation.
Sampling now fills per-class and per-Snapshot support deficits, unsupported
classes stay disabled, and activation requires validation coverage plus a stable,
non-collapsed projection over the current unclassified corpus. Older models stay
readable but cannot run until retrained under the v2 activation policy.

ADR 0061 completes M2-P4E with bounded body token, phrase and character-trigram
features, minimum cross-Snapshot support, balanced three-fold Snapshot validation,
and per-class score/margin calibration directly against 92% precision. Evaluation
now exports a sparse confusion matrix and bounded misclassification identities;
the 64-example class cap keeps the hardest rows before adding Snapshot diversity.
Older feature-v1/activation-v2 models remain readable but cannot run until
retrained under the v3 activation policy.

The owner subsequently froze M2-P4A–E as an experimental implementation because
development-time labeling did not establish reliable cross-material
generalization. The accepted ADRs remain the historical engineering boundary,
while the unresolved product goal is queued as inactive M2-P4R; no further
export, apply, activation, or Entry completion is authorized until that item is
explicitly resumed with an independent representative evaluation set.

ADR 0062 completes M2-P5A by separating the fixed public `v0.1.0` source tree,
the later M2 development line and the owner-confirmed private cloud deployment.
Host-specific identities, secrets, data, backup records and monitoring targets
remain outside Git; production facts not independently inspected stay marked as
pending production review.

ADR 0063 completes the M2-P5B engineering boundary with workspace-scoped backup
listing, full read-only package verification and a bounded retention preview.
It deliberately adds no automatic deletion: actual cloud backup identities and
restore-drill evidence remain in the owner's external operations record.

ADR 0064 completes M2-P5C with a read-only maintenance status command covering
database/domain counts, current search-index completeness, failed or stalled
work, external-data-root capacity and latest-backup age. It returns stable,
privacy-safe alert codes while keeping schedules, thresholds and notification
targets in external operations configuration.

ADR 0065 completes M2-P5D by extending the existing disposable PostgreSQL 18
regression through Evidence import, Entry materialization, deterministic tags,
incremental Associations, current search projection, exact source return,
Entry-centred knowledge graph and the P5C database observer. It uses only
synthetic temporary resources and does not itself create a release.

ADR 0067 adds bounded external named Entry queries and current reading context.
See [the accepted decision](0067-saved-entry-queries-and-reading-context.md) for
privacy renewal, preference concurrency and package compatibility.

ADR 0068 adds a bounded relationship source-review queue, checks of the displayed
Entry versions and Association Bundle v5. See [the decision](0068-version-bound-relation-source-review.md)
for old unbound checks, concurrent edits, privacy and projection rebuild behavior.

ADR 0069 adds explicit selected-Entry Markdown preview and export under the
existing workspace lock. See [the decision](0069-cited-entry-markdown-export.md)
for exact evidence, privacy, current-version checks and external file ownership.
