# Repository Instructions

This file contains repository-specific rules for human and AI contributors.
Detailed policy lives in the linked canonical documents.

## Read First

Before changing the repository, read:

- `docs/current-project-state.md`
- `docs/product-requirements.md`
- `docs/roadmap.md`
- `docs/knowledge-core-architecture.md`
- `docs/development-standards.md`
- `docs/open-source-policy.md`
- `CONTRIBUTING.md`

Before frontend implementation or frontend design review, also read:

- `docs/frontend-design-specification.md`

## Current Phase

### Data-Free Development Baseline

The active workspace is intentionally empty for continued product development. The
former external validation corpus, database rows, Blob bytes, preferences and
exports have been moved to a recovery archive outside the repository and
application data root. Actual owner-content review, formal gates, release review
and broader product review start only after product development is complete and
MUST NOT block unrelated product development before then. Until the owner
explicitly authorizes material use, do not import, restore, fetch, seed or
otherwise introduce any real document, entry, personal configuration or derived
knowledge. Product and integration tests must use synthetic, value-free fixtures
only. Continue development in this same main project and workspace; do not create
a replacement workspace.

Historical evidence below records completed engineering work. It does not
authorize restoring the former corpus into the active workspace.

The foundational architecture, non-browser/non-container engineering
foundation, and first product authority model are accepted in ADR 0001 through
ADR 0004. A former external corpus was used for historical validation and is no
longer part of the active project state. ADR 0005 accepts the canonical
versioned knowledge model and AI-optional operations;
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
product-development task. The following M1C paragraphs are historical evidence,
not a list of current routes. M1C-PERSIST introduced the fifth migration,
Evidence/Blob import, external workspace selection and a PostgreSQL 18
two-workspace functional smoke. M1C-API formerly exposed import, evidence/review
reads, manual curation, knowledge changes and deterministic search through a
narrow workspace-fixed local HTTP surface. ADR 0009 retires the curation and
formal-Knowledge runtime; the current listener exposes the Entry-first product.
M1C-WEB formerly provided three shipped browser workspaces and served the built
Web application from the same loopback listener. M1C-VERTICAL has passed with fixed `ruanyf/weekly` issue 405 in a
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

M1C-USE-7 presents the internal `EpistemicRole` as the plain-language question
“内容如何形成” and adds previous-entry navigation beside the routine knowledge
write action. Knowledge created by the quick queue in the current page session
can be corrected through a new immutable revision using the same stable item
identity; older or structurally complex knowledge continues through the
advanced editor when its full provenance cannot be reconstructed safely.

M1C-USE-8 adds a narrow current-item read boundary for that advanced revision
path. Choosing “在高级编辑器中修改” loads the selected item's stable identity,
current revision, value, privacy fact, Fragment citations/derivations, and
historical knowledge derivations before editing. Saving still goes through the
accepted append-only knowledge command; a search result alone must never be
treated as a complete provenance record.

M1C-USE-9 simplifies only the owner-facing knowledge-write taxonomy while the
broader knowledge framework remains under discussion. New writes offer concept,
viewpoint, event, method, resource, and other; the stored `assertion` value is
labelled as viewpoint, while legacy entity/framework/work rows remain unchanged
and are presented and searched as resources. The seventh forward migration adds
the genuine `other` value without rewriting existing revisions. New source-backed
items default to “来源原文所述”; review-state behavior is intentionally unchanged.

M1C is the historical runnable compatibility baseline. ADR 0007 redirected the
active product main line to M1D: a canonical `InformationEntry` layer between
immutable Snapshot/Fragment evidence and optional formal Knowledge records.
Entry is the ordinary document annotation, association and retrieval unit.
ADR 0009 later removes the superseded Curation/Knowledge/Retrieval application
runtime while preserving accepted migrations, historical rows and personal-data
package compatibility. Do not rewrite existing M1C data or turn AI, vectors,
formal TM2 or test-harness hardening into an Entry prerequisite.

M1D-1 now implements that first Entry slice. Forward migration `000008` adds
stable Entry identities, append-only revisions, exact Fragment inputs,
independent content/type/domain keywords and lineage. The typed PostgreSQL
repository, four workspace-fixed local API operations and the fifth Web
workspace support split materialization, manual revision, privacy-aware current
reads and deterministic text/keyword search with exact source return.
M1D-2 now adds forward migration `000009` and a versioned Document-tag projection
bound to the canonical Snapshot. Deterministic aggregation ranks current Entry
keyword candidates by full-document occurrence first and Entry coverage second;
manual edits append their own revision. The local API and Entry workspace provide
Document ↔ Entry navigation, transparent per-tag evidence metrics and full-source
return while preserving explicit privacy opt-in. M1D-2 closure applied `000008`
and `000009` to the selected external workspace, materialized issue 398 into 34
Entries, and extended the same external Workspace Bundle with a separate
`struinfo.m1d-entry.v1` section. New exports now atomically carry all 45 current
workspace tables while old one-section M1C Bundles remain readable as an empty
Entry state; Blob bytes and personal UI preferences remain external.

M1D-3 adds forward migration `000010` and selective Entry associations. A
versioned local policy narrows candidates through content-keyword and text
indexes, then stores separate content/type/domain scores plus a rebuildable base
score. Durable append-only manual overrides can enhance, weaken, block or restore
an association and are never rewritten by projection rebuilds. The local API and
Entry workspace expose rebuild, inspection, exact-source return and manual
control while applying privacy scope before visibility. In the selected external
workspace, 34 issue-398 Entries deterministically produced 7 association pairs
covering 6 Entries. These projections are similarity navigation signals rather than manually
verified semantic assertions; ADR 0011 later allows them to appear as editable
graph edges.

M1D-4 completes explainable Entry search without a new migration or search
service. One query-bound cursor combines text, exact content/source keys,
Snapshot, type/custom type, domain/custom domain and primary/secondary scope,
chunk mode, published/captured time, privacy and optional one- or two-hop
association traversal. Privacy is applied before counting, candidate selection,
traversal, ordering and pagination; blocked associations are never traversed.
Each result reports its structural filters, text match reasons and bounded path.
The selected external workspace returned all 34 issue-398 Entries in stable
20/14 pages, exposed a five-Entry two-hop neighborhood after rebuilding the
seven existing projections, and averaged 17.23 ms over 20 sequential public
searches. Browser checks passed at 320, 390, 768, 1024 and 1440 CSS pixels. This
workload does not justify AI, vectors, `pg_trgm`, query pushdown or speculative
indexes.

M1D-5 completes the runnable Entry-network baseline. Workspace Bundle v1 now
adds a third backward-compatible `struinfo.m1d-association.v1` section for the
three `000010` projection/override tables; current exports carry all 48 workspace
tables while old one- and two-section Bundles restore missing Entry or association
state as empty. The owner explicitly selected the remaining nine fixed Snapshots,
materializing issues 398 through 407 into 345 current Entries and rebuilding 598
association projections without a seed or background writer. A 5,281,365-byte,
10-Blob-reference Bundle containing 9,385 rows restored atomically to a disposable
empty database with exact document, Entry-search, source and association parity.
A disposable enhance/restore override round-tripped as two append-only revisions;
replaying onto a non-empty target returned `workspace_not_empty` without changing
the 345 restored Entries. Blob bytes, exports and personal preferences remained
external. The runnable M1D baseline is now complete; later work must come from
direct owner use or an explicitly accepted M1E proposal boundary, not speculative
AI, vectors, indexing or another certification-hardening cycle.

M1D-UI-1 restructures the owner-facing Web application without changing the
accepted persistence or HTTP boundaries. Primary navigation is now exactly
Overview, Import, Split, Tags, Associations and Query, shown in Chinese as
`总览 / 导入 / 拆分 / 标签 / 联系 / 查询`. Overview reports only real external-
workspace counts and keeps the optional five-stage AI run rail distinct; absent
run data must never be rendered as fabricated progress. Import owns source and
Bundle operations, Split owns structural materialization and evidence inspection,
Tags owns Entry/Document content-type-domain annotation, Associations owns
explainable candidates and manual overrides, and Query owns deterministic search
with explicit privacy and source return. AI jobs, fuzzy search and global policy
write controls remain visibly unavailable until public product boundaries exist.
The shell is responsive through ordinary scrolling and does not move user data,
preferences, snapshots, exports or backups into Git or the application package.

ADR 0008 starts M1E-1 from direct owner feedback. Routine Entry, Document-tag,
association-projection and association-override edits now keep one current final
database state plus a concurrency version; immutable Snapshot/Fragment evidence
is the original version, while formal Knowledge remains append-only. The Tags
page is the sole routine review surface and combines five-position usefulness and
interest scores with deterministic keywords, quick tags, exclusions and
user-confirmed aliases. Intake actions, judgment reasons and manual-link intent
are removed from the current workflow. New external personal-data packages embed
all referenced Blob bytes and workspace preferences with database sections while
remaining backward-readable with legacy Bundles. Entry search has public,
include-private and private-only scopes. M1E-2 replaces the former placeholder
with a bounded Entry-centred Formal Knowledge graph, while preserving the same
external data and privacy boundaries.

ADR 0009 completes the cleanup. Active source MUST NOT restore imports, adapters,
HTTP routes, frontend contracts or hidden tools from the retired Manual Curation,
formal Knowledge writer/current-item reader or deterministic Knowledge search.
Migrations `000003`, `000004`, `000006` and `000007`, their historical rows,
frozen contracts and legacy personal-data-package section remain for recovery.
The old TM2 harness is an excluded historical archive with no product script and
MUST NOT block current work. ADR 0011 now governs the M1E-2 boundary: the
owner-facing Formal Knowledge page uses existing InformationEntry identities as
nodes, with visible deterministic similarity associations and user-created or
user-edited relationships as graph edges. Its simple deterministic search
selects the highest visible Entry as centre and loads only a bounded
neighbourhood; Query remains the exhaustive result surface. Similarity edges do
not require per-edge confirmation, but their calculated origin remains visible
and durable user edits or blocks override later rebuilds. M1E-2 now ships the
public graph read/edit boundary, graph/list Web surface and Association Bundle
v3. Migration `000012` adds only the missing current override metadata; it MUST
NOT restore the retired M1C Knowledge runtime or portray similarity as verified
factual assertion.

The direct-use increment after M1E-2 adds two reachable owner features without a
new database migration. Entry Query returns complete private documents in a
separate response channel only after explicit current-request privacy opt-in;
full bytes remain in the external Blob store. Associations exposes versioned
content/type/domain weights and threshold through a narrow public write boundary.
That policy is stored in the external personal preference file and carried by the
personal-data package; saving it rebuilds automatic projections but MUST NOT
overwrite pair-specific overrides or Formal Knowledge graph relationships.

ADR 0012 starts M1E-3A with a provider-neutral durable task boundary. Forward
migration `000013` adds current ProcessingRun records, typed proposal envelopes
and exact Fragment evidence. The public local API lists recent runs and cancels
a queued/running run with an expected version; Overview derives its task rail
only from these records. At that boundary there was no public start-AI route, no
proposal accept command, no Provider SDK and no opaque payload. New personal-data
packages carry the three processing tables while older packages restore them
empty. Any later AI slice still has to select one Provider boundary and one
closed proposal kind.

ADR 0013 completes M1E-3B with one optional OpenAI Responses API boundary and
one closed `tags` proposal for a user-selected public InformationEntry. Forward
migration `000014` adds a typed proposal header plus content-keyword and
domain-keyword tables; arbitrary Provider JSON, prompts, secrets and raw errors
MUST NOT be stored. The adapter uses native `fetch` and is enabled only when an
environment-only `OPENAI_API_KEY` and external `STRUIINFO_OPENAI_MODEL` are both
present. Private Entries MUST be rejected before any Provider call. The public
local API and Tags page may list, explicitly start, accept or reject tag
proposals; acceptance MUST use the existing Entry revision command and preserve
body, scores, privacy and exact Fragment evidence. The Provider has no direct
Entry, association or graph write port. Processing Bundle v2 carries all six
processing tables and upgrades v1 with empty tag-proposal state. `ai_tags` MUST
NOT be interpreted as generic AI capability.

ADR 0014 completes M1E-3C with one closed OpenAI `association` proposal for an
explicitly selected pair of public InformationEntry records. Forward migration
`000015` adds one typed association-payload table and admits `ai` as a graph
override origin. The provider receives only the selected pair's Entry content
and current annotations; either private endpoint is rejected before any network
call. A proposal freezes both Entry revisions, the pair's override revision,
model, prompt version, relation label and direction. Accepting uses the existing
graph-edge write command and CAS boundary; rejecting changes only proposal
state. Processing Bundle v3 carries all seven processing tables and upgrades v1
or v2 with empty association-proposal state. `ai_associations` is separate from
`ai_tags`; neither means generic AI capability. The UI MUST label a pending
proposal as AI-generated and require an explicit accept action. Do not add a
second Provider, automatic acceptance, private-content transfer, query
synthesis, Embedding or RAG without a later accepted increment.

ADR 0015 completes M1E-3D with one closed OpenAI `split` proposal for an
explicitly selected public Snapshot. Forward migration `000016` adds three typed
split-payload tables. The provider receives only the ordered public section
Fragment ordinals and exact text; database, Snapshot, Fragment and workspace
identifiers stay local. The public local API and Split page may list, explicitly
start, accept or reject a proposal. Private Snapshots MUST be rejected before
Blob reads and before any Provider call. Acceptance reconstructs Entry bodies
from exact local Fragment text and uses the existing empty-Snapshot Entry
materialization boundary under the workspace lock; rejection does not create
Entries. Processing Bundle v4 carries all ten processing tables and upgrades
v1-v3 with empty split-proposal state. `ai_split` is independent from `ai_tags`
and `ai_associations`, and the deterministic split path remains complete when
no Provider is configured.

ADR 0016 completes M1E-4A with a local manual Entry-grouping path. Before a
Snapshot has any Entry, the Split page may load its exact ordered `section`
Fragments, merge adjacent groups, split a merged group again at an existing
Fragment boundary, edit group titles and submit the complete source-order
partition. The server reconstructs every body from local Fragment text and
uses `struinfo.entry-split.manual-group.v1`; it never trusts client-authored
body text or changes Snapshot/Fragment evidence. Deterministic, manual and
accepted AI materialization all use the same atomic empty-Snapshot repository
boundary, so the first committed structure wins without duplicate Entry sets.
Private material requires explicit local `includePrivate` scope. This increment
adds no migration, dependency or Bundle section and does not replace already
materialized Entry structure. Arbitrary within-Fragment cutting, reordering,
pre-split source editing, custom parsers/rules and post-materialization
restructuring remain later boundaries.

ADR 0017 completes M1E-4B by extending the same pre-materialization workbench to
half-open Unicode-scalar ranges inside immutable Fragments. Requests contain
only bounded titles, Fragment identities and `[startCodePoint, endCodePoint)`
ranges; the server requires a complete ordered partition and reconstructs every
body from local evidence. Forward migration `000017` stores optional one-to-one
range rows, while missing rows continue to mean a complete Fragment for legacy,
deterministic and accepted-AI Entries. Entry Bundle v3 carries the eighth Entry
table and upgrades v1/v2 with empty range state, so the full personal-data
package now covers 56 workspace tables. The rule version is
`struinfo.entry-split.manual-range.v1`. This increment does not rewrite evidence,
reorder sources, save pre-split source edits, introduce a Provider/dependency or
restructure already materialized Entries.

ADR 0018 completes M1E-5A with one explicit local UTF-8 text-file capture path. The Import page accepts one `.md`, `.markdown` or `.txt` selected or dropped by the owner, validates the existing 1 MiB/UTF-8/text boundary in the browser and sends canonical Base64 only for `uploaded_file`. The local service decodes before any Evidence write and reuses the existing external Blob, immutable Snapshot/Fragment, privacy and idempotent import boundary. An unprefixed capture preserves exact selected bytes; an explicit prefix is a visibly composed Snapshot. Default identity uses the base file name plus SHA-256 and never transmits a machine directory path. Retry identity includes a stable capture time. This increment adds no migration, dependency, repository-owned upload directory or real fixture; PDF/DOCX/OCR, multi-file capture, directory watching and cloud sync remain later boundaries.

ADR 0019 completes M1E-5B with local .html, .htm and text-bearing .pdf capture. The exact selected bytes remain the external Snapshot raw Blob while a server-owned UTF-8 Markdown projection feeds the existing CommonMark/Fragment/Split path. HTML extraction keeps semantic reading content, excludes active/hidden content and never fetches links; PDF extraction is page-oriented text-layer only. Optional preface text changes only the HTML/PDF projection. `parse5`, `pdfjs-dist` and `entities` are the admitted dependency increment, while PDF.js's unused optional native Canvas dependency is explicitly ignored. OCR, complex visual reconstruction, Office and batch ingestion remain later boundaries.

M1E-3A-D provider work, M1E-4A/4B manual grouping and M1E-5A/5B local document import are
now complete. The next product task must come from direct owner use or another
explicitly accepted narrow boundary; do not infer a generic AI,
automatic-acceptance, private-content transfer, query synthesis, Embedding, or
RAG capability from these proposal paths.
ADR 0020 completes M1F-1 without another persistence or Provider boundary.
Entry Query now offers explicit exact, substring and spelling-tolerant local
lexical modes across title, body and the three keyword dimensions. Results expose
a bounded lexical score, query-bound cursor v2 and the same semantics for the
explicit complete-private-document channel. This is not semantic search, AI,
Embedding or RAG; it adds no migration, dependency, index or search service.

ADR 0021 completes M1F-2 at the Query surface. The selected visible Entry can
now become the existing one- or two-hop Association anchor without leaving
Query, and at most two results from the same semantic query scope can be compared
side by side with exact source return. Comparison is session-only, survives only
cursor pagination within that scope and becomes invisible immediately when
filters, Association or privacy scope change. It does not persist a saved view,
infer a winner or relation, add an API/migration/dependency, or turn local
Association traversal into AI or semantic retrieval.

ADR 0022 completes M1F-3. Query now offers an explicit secondary action that
synthesizes only the first eight public Entries returned by the existing
deterministic search. The Provider receives bounded request-local evidence
handles rather than workspace identifiers; claim references map back to exact
local source actions. Private scope is rejected before Blob or Provider access,
and the session-only answer cannot write Entry, Association, graph, preference,
database or package state. `ai_query_synthesis` is independent from the three
durable proposal capabilities. This is evidence-bounded AI synthesis, not
Provider retrieval, Web search, Embedding, vectors, RAG or a generic agent
capability.

ADR 0023 completes M1G-1 with a default-off deterministic exploration lane on
Query. An owner-selected visible Entry anchors a read-only request over current
visible direct Associations; current-page, blocked, stale and privacy-invisible
records are excluded before counting. A versioned external personal preference
sets a 0–50% page-relative budget and independently enables neighbor expansion,
cross-domain connections and serendipity. The resulting page-out candidates are
explainable and capped at 12. They do not change ordinary search matching,
ordering, totals, pagination or cursors, and do not write behavior history,
Entry, Association, graph or Processing state. Do not infer preference learning,
random retrieval, semantic search, vectors, Provider use or RAG from this lane.

ADR 0024 completes M1G-2 with the first closed versioned source subscription.
One external preference row identifies one exact Markdown file in one explicit
public GitHub repository/ref. Manual checks and default-off interval checks
create real import-stage ProcessingRun records; changed bytes reuse the existing
Evidence/Blob/Snapshot/Fragment import, while unchanged bytes do not create a
duplicate Snapshot. The Git/content cursor and schedule stay in the external
preference file and personal-data package. The Import page owns configuration
and run-now; Overview continues to show only stored runs. This adds no migration,
dependency, generic crawler, repository execution, automatic Entry/tag/link
processing, AI acceptance or real fixture. Do not infer RSS/API/web crawling,
private-repository access, preference learning or an autonomous pipeline.

ADR 0025 accepts the M1G-3 development boundary. M1G-3A provides the closed,
default-off external Entry PreferenceProfile state, ordered-rule limits,
workspace preference persistence and backward-compatible personal-data-package
transport. M1G-3B adds the pure local deterministic suggestion and bounded
read-only trial core over injected current Entry snapshots. It keeps usefulness
and interest separate, filters privacy before counting, reports malformed or
stale inputs, and writes no product state. M1G-3C exposes the narrow
get/save/suggest/trial local API and a secondary Tags panel for explicit rule
editing, candidate evidence and bounded draft trials. Only Profile save writes
external preferences; suggestions and trials remain read-only and local.
M1G-3D serializes sibling preference writes per workspace, moves optimistic
checks inside the atomic update, rejects late UI responses and completes
privacy, backward-package, responsive-browser and artifact checks. M1G-3 is
complete. These slices must not restore the retired Curation PreferenceProfile runtime, record
implicit behavior, alter Query ranking, call a Provider, or grant automatic
split/tag/link/ignore authority. Automatic routing remains a later
`AutomationPolicy` decision.

ADR 0026 starts M1G-4 with the separate authority record required by ADR 0025.
M1G-4A stores a default-off, independently versioned Entry AutomationPolicy in
the external preference file and personal-data package. Its pure local trial
binds one exact Profile revision, applies explicit evidence, threshold and
budget rules, and routes visible current Entries to advance candidate, manual
review or defer candidate with stable reasons. Manual takeover wins, while
defer never means ignore, delete or hide. M1G-4A exposes no HTTP/UI executor,
creates no ProcessingRun and performs no downstream write. Recoverable
execution and owner controls remain separate M1G-4B/M1G-4C boundaries.

ADR 0027 completes M1G-4B with durable, idempotent execution of those routing
facts. Forward migration `000018` adds one typed automation-run header and one
typed per-Entry claim table. Each run freezes exact AutomationPolicy,
PreferenceProfile and Entry revisions plus request/plan digests; authority and
Entry state are revalidated before start and settlement. A failed run pauses
only the still-matching external policy revision and compensates open claims;
an unconfirmed recovery remains visibly pending. Processing Bundle v5 carries
the two new tables and upgrades v1-v4 with empty execution state. Completing a
claim records only advance/manual/defer routing—it MUST NOT mutate Entry
content, tags, Associations, graph edges, queries or AI proposals. M1G-4C owns
future HTTP/UI controls, and concrete downstream automatic actions still
require a separately accepted product boundary.

ADR 0028 completes M1G-4C with six narrow local API operations and one
secondary Tags control panel. The owner can edit, enable/disable, pause/resume,
trial, manually take over, explicitly start and inspect Entry routing runs. A
dirty draft cannot start a run, and every start binds the saved ready policy to
the exact Profile and Entry revisions shown by the trial. This adds no
migration, dependency, Provider call or automatic downstream mutation.
Completed advance/manual/defer claims remain routing audit facts only; they
MUST NOT alter Entry content, keywords, Associations, graph edges, Query state
or AI proposals.

ADR 0029 completes M1G-4D by making the existing exact-run read a real
owner-facing audit path and separating policy, save, trial, execution, recent
list and exact-detail request generations. Recent runs are summaries only;
unresolved or compensated claims remain explicit, stale responses cannot
replace newer visible authority, and the responsive Tags panel introduces no
new execution or content-write permission. M1G-4 is complete through A–D;
concrete automatic business actions remain a later explicitly accepted
boundary.

ADR 0030 completes M1G-5A with a durable owner work queue derived only from
successfully completed routing claims. Migration `000019` stores reversible
pending/completed/dismissed owner state separately from immutable claim audit,
and Processing Bundle v6 carries the thirteenth Processing table. Queue reads
remain privacy-scoped and show when the routed Entry revision is stale. Queue
actions MUST NOT mutate Entry content, tags, Associations, graph edges, Query
state or AI proposals.

ADR 0031 completes M1G-5B with one default-off `routeAfterImport` switch on an
exact source subscription. A changed source may reuse the existing Evidence
import, deterministic empty-Snapshot Entry materialization and M1G-4 execution;
the successful cursor advances only after the whole chain succeeds. This local
chain grants no AI, automatic tag/link/graph write, proposal acceptance or
generic workflow authority. Older preferences decode the switch as false.

ADR 0032 completes M1H-1A/B with two independent default-off
`EntryAutomationPolicy.advanceActions` flags. Only a completed
`advance_candidate` may append bounded local deterministic rule tags and then
rebuild the replaceable Association projection. Exclusions and confirmed
aliases apply; manual/AI/imported tags, pair overrides and Formal Knowledge
graph relationships MUST survive. Migration `000020` stores typed recoverable
action state and exact rule-origin compensation without copying Entry bodies;
Processing Bundle v7 carries the fourteenth Processing table and the complete
personal-data package now covers 60 workspace tables. Manual-review/defer
routes, AI proposal acceptance, graph assertions, score changes, hiding and
deletion remain unauthorized.

ADR 0033 completes M1H-2A/B with owner-controlled restructuring after Entry
materialization. The Split page first previews one complete Fragment/scalar
partition and freezes current Entry, override and Document-tag versions. Apply
requires the same plan digest plus explicit annotation/relationship impact
acknowledgements, then atomically switches the unique current structure, writes
successor lineage, recomputes Document tags, transfers eligible manual/AI graph
relations and rebuilds replaceable Association projections. Snapshot/Fragment
evidence and retired Entry rows remain intact. Migration `000021` adds
`is_current_structure`; Entry Bundle v4 carries it and upgrades v1-v3 rows as
current. AutomationPolicy and AI proposals receive no restructuring authority.

ADR 0034 completes M1H-3A/B with owner-controlled editing before first Entry
materialization. Each source Snapshot may have one current working copy; saves
replace that current draft and restore deletes it, without keeping ordinary edit
history or changing the original Blob/Snapshot/Fragment evidence. Explicit
confirmation reuses the existing Evidence/CommonMark importer to create one
deterministic immutable derived Resource/Snapshot, inheriting privacy and then
continuing through the existing deterministic, manual or AI split paths.
Migration `000022` adds the ninth Entry table; Entry Bundle v5 carries it and
upgrades v1-v4 with empty working-copy state. The personal-data package now
covers 61 workspace tables, while the active workspace remains data-free.

ADR 0035 completes M1H-4A/B with one external, independently versioned
`EntrySplitRuleProfile` and its Split-page controls. The default profile keeps
one section per Entry; the only additional rule deterministically merges
adjacent short section Fragments under explicit scalar and Fragment-count
limits. Draft rules may be previewed, but only the exact saved revision can be
applied through the existing empty-Snapshot atomic materialization boundary.
The service always rebuilds title/body from immutable local Fragment evidence,
and private Snapshots still require a current-action opt-in. This preference is
already transported by the complete personal-data package and adds no migration,
table, dependency or Provider. Do not infer arbitrary scripts, regex programs,
custom parsers, source reordering, automatic background splitting or permission
to replace already materialized Entry structures.

ADR 0036 completes M1H-5A/B with one explicit local multi-file import queue.
The owner may select or drop at most 20 supported files; every item independently
reuses the accepted file validation, privacy propagation, stable idempotent
identity, Evidence import and external Blob path. The Import page reports
per-file state, retries failed items with their frozen request identity, and
stops only before the next item rather than pretending to cancel an in-flight
write. The queue is session-only and is not a ProcessingRun, database record or
personal-data-package section. This adds no migration, dependency, API route,
directory scan, automatic Entry materialization, tag/link action, Provider call
or real data.

ADR 0037 starts the owner-selected pre-launch external-source phase. M1I-1A/B
adds a bounded connector result shared by built-in readers and optional trusted
plugin adapters, plus the remote-document Evidence kind and deterministic
multi-document import preparer. ADR 0038 completes M1I-2: external preferences,
the existing subscription API/scheduler and Import page now admit public
RSS/Atom Feeds through one built-in adapter with conditional requests, bounded
item-version cursors, server-owned HTML-to-Markdown projection and per-item
Evidence import. Feed item links remain references and are never crawled.
ADR 0039 completes M1I-3: the same external preference, API, scheduler,
ProcessingRun and Import surfaces now admit a bounded declarative JSON API
adapter. It performs public HTTPS GET only, maps records through closed dot
paths, separates same-run pagination from cross-run incremental cursors and
stores only an environment-variable reference for optional Bearer credentials.
ADR 0040 completes M1I-4 with at most eight owner-declared same-origin public
Web pages. The server extracts article/main/body content without scripts, link
discovery, redirects or browser session state; exact HTML remains an external
Blob and the Markdown projection reuses the Evidence path. ADR 0041 completes
M1I-5: only trusted adapters explicitly injected into the runtime expose a
closed capability in the API and Import UI. Plugin preferences retain only a
stable `plugin.*` connector ID and an opaque external configuration reference;
missing plugins remain visible but unavailable. Connector code retains no
database, Entry, tag, Association, graph, AI or cursor-write port.

ADR 0042 completes M1J without restoring the retired M1C Knowledge runtime.
The current Entry-centred graph now stores a closed relation semantic kind,
bounded maintenance note and source-review status on user/AI overrides, while
calculated projection edges remain explicitly `similarity / calculated`.
The Formal Knowledge relationship inspector opens exact evidence for both
endpoints. `source_checked` records only that the owner reviewed those sources;
it is not an automated truth claim. Migration `000024`, restructuring and AI
acceptance preserve this metadata, and Association Bundle v4 carries it while
remaining backward-readable with v1-v3. M1J adds no Provider, dependency,
second content model, knowledge tree, complex ontology or automatic fact check.

ADR 0043 completes M1K on the existing Entry Query path. Migration `000025`
adds only a wholly rebuildable, current-revision-bound term/vector projection;
the local Unicode tokenizer and lexical Query remain complete without a
Provider. An optional environment-configured OpenAI Embeddings adapter enables
public-only semantic and hybrid retrieval, explicit Recall@K/MRR evaluation,
and reuse of the existing bounded query synthesis as evidence-grounded RAG.
Private Entries MUST be rejected before projection, embedding, retrieval or
synthesis Provider calls. Derived index tables are deliberately excluded from
personal-data packages and must be rebuilt after restore or model changes.
M1K adds no vector database, search service, background indexer, private RAG,
Provider-owned retrieval or real fixture.

ADR 0044 completes M1L with a repository-owned, data-free performance workload
and only two measured optimizations: one per-request Association read index and
removal of duplicate HTTP search loads. Timings are comparison evidence, not an
SLO or test threshold.

ADR 0045 completes M1M with a non-root multi-stage image, split runtime and
maintenance Compose manifests, strict external secret-file injection, explicit
migration/queue/grant/preflight order, and complete personal-data backup plus
same-workspace empty-database restore. Target Linux image, real PostgreSQL 18
operations, public-network and distribution certification remain deferred.
There is no inferred M1N: further work comes from owner-authorized unified use
and deployment review or a reachable product defect. Do not restore real
material merely to demonstrate the deployment boundary.

Browser runtime artifacts and production-equivalent PostgreSQL/container
certification remain behind their named admission gates. The M1C disposable
PostgreSQL functional smoke is accepted as product evidence, not as formal TM2
or deployment certification. Do not represent a deferred formal gate as passed
or make it mandatory before its dependency and distribution review is accepted.

Do not change the accepted language, application shape, or persistence model
without a superseding ADR. Cloud deployment vendors remain unselected; OpenAI
is selected only for the optional proposal paths accepted by ADR 0013 through
ADR 0015 and the bounded public Query synthesis accepted by ADR 0022. ADR 0023
is entirely local and does not expand that Provider selection. ADR 0024's
closed GitHub reader is a source adapter, not an AI Provider expansion. Do not
reuse M0-P probe candidate source as production code; carry
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
