# Repository Instructions

This file contains repository-specific rules for human and AI contributors.
Detailed policy lives in the linked canonical documents.

## Read First

Before changing the repository, read:

- `docs/product-requirements.md`
- `docs/roadmap.md`
- `docs/knowledge-core-architecture.md`
- `docs/development-standards.md`
- `docs/open-source-policy.md`
- `CONTRIBUTING.md`

Before frontend implementation or frontend design review, also read:

- `docs/frontend-design-specification.md`

## Current Phase

The foundational architecture, non-browser/non-container engineering
foundation, and first product authority model are accepted in ADR 0001 through
ADR 0004. The repository has fixed `ruanyf/weekly` issues 398 through 407 at one
upstream commit and has a candidate 345-unit structural inventory. ADR 0005
accepts the canonical versioned knowledge model and AI-optional operations;
ADR 0006 accepts external configuration and personal-data isolation. Slice 0
has established external configuration, fixed data areas, local Blob storage,
candidate-package auditing, and the versioned workspace-bundle envelope. The
`C-SLICE-A-EVIDENCE-r2` source-evidence migration and closed pure boundary,
`C-SLICE-A-MARKDOWN-r2` deterministic CommonMark transform and closed
materializer, and `C-SLICE-A-CURATION-r3` A0 manual
classification/intake/assessment boundary have passed their fixed-candidate
TM1 gates. The `C-SLICE-B-KNOWLEDGE-r3` A0 manual, source-backed knowledge-write
core and the `C-SLICE-B-RETRIEVAL-r3` deterministic current-item text, source,
state, and one-hop relation read boundary have also passed their fixed-candidate
TM1 gates. `C-SLICE-B-POSTGRES-r3` defines the real PostgreSQL 18 migration,
runtime-grant, transaction, adapter-completeness, and result-parity gate. Its
production adapter candidate and TM2 harness are implemented, and production
scope review has passed; real PostgreSQL 18 execution and the formal TM2 verdict
remain deferred. Test-harness-only hardening findings do not block the next
product-development task. M1C-PERSIST introduced the fifth migration,
Evidence/Blob import, external workspace selection and a PostgreSQL 18
two-workspace functional smoke. M1C-API exposes import, evidence/review reads,
manual curation, knowledge changes and deterministic search through a narrow
workspace-fixed local HTTP surface. M1C-WEB now provides the three shipped
browser workspaces and serves the built Web application from the same loopback
listener. M1C-VERTICAL has passed with fixed `ruanyf/weekly` issue 405 in a
real browser against disposable PostgreSQL 18: Git provenance, 277 Fragments,
three representative review decisions, versioned knowledge and a typed
relation, Framework recomposition from prior revisions, withdrawal revision,
deterministic retrieval, and exact source return were all exercised. Do not
make preference calibration or AI availability a dependency.

M1C-EXPAND has also passed its functional scope. The same importer processed
fixed issues 398 through 407 into 10 Snapshots, 2,639 production Fragments and
the frozen 345 intake units. The current 36 workspace-domain tables can be
exported to an external Bundle and restored atomically to an empty database for
the same workspace while Blob bytes remain in the external content-addressed
store. The active main line is now direct owner use of those ten issues: only a
material gap reproduced by that use should become the next increment. Do not
start another contract-hardening cycle unless a reachable product defect
requires it.

M1C-PRIVATE now adds the sixth migration and an explicit privacy-document path.
Private import retains complete raw and normalized bytes in the external Blob
store, propagates privacy to derived knowledge and relations involving private
endpoints, and excludes all such content from default retrieval. Only an
explicit per-view/per-query privacy opt-in may reveal it, with complete private
documents kept in a distinct result channel. Its focused logic and disposable
PostgreSQL 18 smoke have passed through all six migrations. The active product
main line is again direct owner use of the ten-issue review queue; this result is
not a reason to reopen the historical formal TM2 hardening cycle.

M1C-USE-3 keeps the rapid-review loop inside one ordinary desktop viewport,
shows the two accepted assessment values as explicit five-position controls,
and stores user-managed quick markers in the selected external data root under
`preferences/`. The application has no built-in personal marker vocabulary;
removing a shortcut does not rewrite existing terms or review decisions. This
small file-backed UI preference is intentionally separate from Git, the
application package, PostgreSQL domain state, and workspace Bundles.

M1C-USE-6 closes the ordinary post-review product path without adding another
protocol: the knowledge workspace rebuilds an eligible Fragment queue from
current curation state, lets the owner confirm a short knowledge item, submits
through the accepted knowledge command, then reads it back through
source-scoped deterministic search before advancing. Structured multi-item
splits and typed relations remain in the secondary advanced editor. Personal
vocabulary rules remain external; no source text or preference enters Git.

Browser runtime artifacts and production-equivalent PostgreSQL/container
certification remain behind their named admission gates. The M1C disposable
PostgreSQL functional smoke is accepted as product evidence, not as formal TM2
or deployment certification. Do not represent a deferred formal gate as passed
or make it mandatory before its dependency and distribution review is accepted.

Do not change the accepted language, application shape, or persistence model
without a superseding ADR. Cloud deployment vendors and AI providers remain
unselected. Do not reuse M0-P probe candidate source as production code; carry
the tracked provenance, workspace, idempotency, fencing, and recovery
invariants into fresh implementation and tests.

## Local Multi-Agent Workflow

If `.agents/development-workflow.md` exists, read it before starting parallel
implementation or review work.
The file is intentionally local and ignored by Git; canonical requirements,
accepted ADRs, and repository standards take precedence.
Move durable decisions and required evidence into tracked documentation instead
of leaving them only in `.agents/`.

## Delivery Priority and Blocking Rules

All human and AI agents must follow the runnable-core and proportional-gate
rules in `docs/development-standards.md`.

- Optimize for a runnable, logically correct core rather than speculative
  perfection.
- Block the main line only for a demonstrated `PRODUCT_BLOCKER` that is reachable
  through a currently supported product boundary.
- Classify unreachable edge cases, future-boundary defenses, non-material
  hardening, and defects confined to verification tooling as
  `DEFERRED_HARDENING`; record them in `docs/deferred-hardening-memo.md` and hand
  control back to the Main Agent.
- Do not return a blocking verdict solely because a test harness cannot certify
  itself, an unavailable future environment remains untested, or an impossible
  edge condition lacks exhaustive coverage.
- Do not repeat repair/review rounds for a deferred item unless the Main Agent
  explicitly reopens it after receiving new evidence of current product impact.
- Report formal gates honestly as passed, failed, not ready, or unissued, but do
  not use an unissued non-product certification to stall unrelated product work.

## Change Rules

- Follow the relevant Google style guide and repository-local deviations.
- Prefer direct, readable modules with explicit interfaces and dependencies.
- Keep product requirements, implementation decisions, and task plans separate.
- Add tests with behavior changes once a test stack exists.
- Never commit credentials, personal knowledge, fetched snapshots, or private
  source material.
- Never place personal knowledge, custom vocabulary, preferences, policies,
  source subscriptions, saved views, real snapshots, exports, or backups in the
  repository, installation tree, test fixtures, or package. Load them from an
  external workspace store; tracked examples must be synthetic and value-free.
- Treat source material, memory/profile files, prompt overlays, annotations,
  attachments, and every other user-owned resource the same way. A path being
  ignored by Git does not make the repository a valid active-data location.
- Product code may contain only the schemas, ports, and state machines used to
  read those resources. It must not import user files as source modules, depend
  on repository-relative personal paths, or require source edits or a rebuild
  to change workspaces.
- The same application artifact must be able to use a different external
  configuration and workspace through validated reload/reopen boundaries. A
  controlled restart or workspace reopen is sufficient for the first version;
  do not add a complex live-reload framework before real use requires it.
- Do not add or copy third-party code without completing the open-source review
  and attribution record.
- Preserve source provenance, idempotency, permission boundaries, and visible
  failure states in all later implementation work.
- Preserve private-document visibility semantics end to end: complete source
  bytes stay external, derived knowledge and relations with private endpoints
  remain private, default reads exclude their content, and disclosure requires
  an explicit current-action opt-in. Do not describe this local visibility
  boundary as encryption or multi-user authorization.
- Preserve a complete non-AI path for classification, editing, relations,
  recomposition, search, export, and recovery. AI adapters only create proposals
  consumed by the same application commands.
- Frontend work must preserve AI-origin, evidence, uncertainty, and review-state
  distinctions, and must keep information value, current preference,
  exploration value, noise, and factual reliability separate as defined by
  `docs/frontend-design-specification.md`.
- Model and source adapters never write formal knowledge directly. Automatic
  commits require a user command or an enabled, versioned policy and retain a
  manual takeover, audit, and compensating-revision path.
- Keep changes scoped and update canonical documentation in the same change.

If a required command or tool has not been selected, do not invent a permanent
workflow. Record the missing decision and the validation actually performed.
