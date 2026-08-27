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
