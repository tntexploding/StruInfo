# StruInfo Frontend Design Specification

- Status: Project frontend baseline
- Version: 1.2
- Effective date: 2026-08-10
- Scope: StruInfo web application design, implementation, and review

## 1. Purpose and Authority

This document turns the product requirements and the supplied visual direction
into an implementable frontend contract.
It is normative for StruInfo frontend work and design review.

The following terms express requirement strength:

- **MUST**: required for acceptance;
- **SHOULD**: expected unless a documented reason justifies a deviation;
- **MAY**: optional and must still satisfy all higher-priority requirements.

Apply frontend guidance in this order:

1. legal, privacy, security, provenance, and data-integrity requirements;
2. `docs/product-requirements.md` and accepted ADRs;
3. this specification;
4. the supplied source direction in
   `docs/AI_Personal_Knowledge_OS_Frontend_Style_Guide.md`;
5. external design skills and high-level reference products.

External skills are authoring and review aids, not runtime dependencies.
This specification is self-contained so a contributor does not need a personal
Skill installation to follow the project contract.

## 2. Design Contract

The fixed design contract is:

| Axis                     | Decision                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Product identity         | A trustworthy, source-traceable, AI-augmentable knowledge workspace                                          |
| Visual family            | `struinfo-industrial`, an original black/white/cyan industrial information system                            |
| Full-product depth       | `complex / 3`: multi-zone shell and complete shared component treatment                                      |
| M0-S depth               | `moderate / 2`: recognizable shell and states without fake product data                                      |
| M1C depth                | `complex / 3`: four task workspaces plus a contextual provenance dossier                                     |
| M1D depth                | `complex / 3`: Entry annotation/search workspace inside the existing product shell                           |
| Primary evidence pattern | Black edge shell, cyan active rule, indexed sections, precise provenance dossier                             |
| Primary user question    | What is worth retaining or exploring, what knowledge changed, what supports it, and what can I control next? |

The interface MUST feel like an operating workspace, not a marketing landing
page or a generic card dashboard.
Information architecture and truthful state MUST remain legible before any
decorative layer is noticed.

The design may use high-level industrial and editorial patterns associated with
the Ark UI family, but MUST remain an original StruInfo implementation.
It MUST NOT copy protected logos, screenshots, character art, production
bundles, proprietary fonts, or exact coordinates from reference products.

## 3. Product Experience Principles

### 3.1 Evidence before confidence

Every important AI output MUST expose its evidence path.
The interface MUST distinguish at least:

- source excerpt;
- source claim;
- AI-derived summary;
- AI inference;
- user-authored assertion;
- user review state.

The interface MUST NOT compress trust into one ambiguous score such as
`Trust Score: 88 / 100`.
When data exists, show the following dimensions separately:

- traceability to a captured snapshot and exact fragment;
- source assessment and its scope;
- extraction confidence;
- entity or relation confidence;
- independent corroboration or conflict;
- freshness and relevant time type;
- review status and reviewer.

An absent dimension MUST read `未评估` or an equally explicit unknown state.
It MUST NOT be replaced with a generated number.
User confirmation means the user accepted the record or confirmed what a source
said; it MUST NOT be rendered as proof that the claim is objectively true.

Information value, current interest, exploration value, noise, and factual
reliability are separate concepts.
The interface MUST NOT use interest as proof, source quality as a reason to
force attention, or one aggregate score to hide these dimensions.
When an item is surfaced to break an information bubble, the UI MUST explain
the exploration type, such as adjacent expansion, cross-domain connection,
foundational gap, emerging signal, viewpoint diversity, or serendipity.

### 3.2 AI is visible but not anthropomorphized

AI is optional. The interface MUST remain fully operable for capture, content
classification, intake decisions, manual splitting, editing, typed relations,
recomposition, revision history, deterministic search, export, and restore when
no model or embedding provider is configured. `AI 未启用` is a capability state,
not a product failure, and MUST NOT disable non-AI actions.

AI-generated or AI-modified content MUST carry a persistent origin label such
as `AI 生成 · 待审核` or `AI 生成 · 策略自动入库` according to its real state.
The label MUST remain associated with the content when it is copied into a
drawer, brief, graph dossier, or review view.
Policy-authorized content MUST also expose the policy name/version and a route
to inspect, pause, or override the decision; automatic admission never removes
AI origin.

`AI Agent Active` or similar status text MAY appear only when it reflects a real
runtime state.
The interface MUST NOT invent model activity, progress, telemetry, or system
codes for atmosphere.

### 3.3 User control remains explicit

High-impact actions such as approve, reject, merge, archive, replace, delete,
or push MUST use visible action verbs.
They MUST NOT be represented by unexplained icon-only controls.

Each view SHOULD expose one primary action and at most one co-primary action.
Secondary operations SHOULD use progressive disclosure.
The next state and any irreversible consequence MUST be clear before commit.
Automatic decisions MUST provide a visible reason, scope, policy version, and
manual takeover path.

### 3.4 Failure is a first-class state

Loading, empty, partial, stale, offline, unauthorized, conflict, and failed
states MUST be designed alongside the success state.
An error MUST explain what failed, what remains safe, and what the user can do
next.
One generic `完成` state MUST NOT hide independent fetch, AI, storage, or
delivery failures.

### 3.5 Density has structure

StruInfo SHOULD be information-dense, but density comes from hierarchy,
alignment, compact metadata, and progressive disclosure.
It MUST NOT come from tiny essential text, repeated metrics, border boxes around
every region, or decorative telemetry.

Every persistent datum MUST have one visual owner.
For example, a candidate row owns comparable status fields, while its evidence
drawer owns the supporting excerpt and provenance details.
The same number SHOULD NOT be repeated in both places merely to fill space.

## 4. Phase-aware Information Architecture

The long-term information architecture reserves these modules:

- Command Center;
- Intake Workspace;
- Review Queue;
- Saved Knowledge;
- Search;
- Sources;
- Evidence Vault;
- Processing Runs and Change Sets;
- Knowledge Graph;
- Timeline;
- Ask AI;
- Daily and Weekly Briefs;
- Reports;
- Settings.

Only implemented routes MAY appear as active navigation.
Future modules MUST NOT be rendered as working controls, live metrics, or empty
shells solely to make the product appear complete.

For MVP-0, prioritize this task path:

```text
Fixed weekly source document
  -> document structure and independent items
  -> evidence and media inspection
  -> content classification, separate from intake action
  -> full / split / condense / source-only / ignore / review decision
  -> manual or deterministic knowledge change set
  -> commit stable items, immutable revisions, relations, and citations
  -> deterministic search and return to source or change evidence
  -> optional AI proposal through the same change-set boundary
```

After the M1C checkpoint, the routine document path is redirected by ADR 0007:

```text
captured Snapshot and Fragment evidence
  -> InformationEntry
  -> content / type / domain keyword editing
  -> document context and selective related entries
  -> deterministic Entry search and exact source return
  -> optional formal KnowledgeItem or typed relation when deeper semantics help
```

Scheduled acquisition, Daily and Weekly Briefs, QQbot, public integration APIs,
Knowledge Graph canvas, complete Timeline, and mixed online query are later
modules unless a tracked milestone explicitly releases them.

## 5. Application Shell

### 5.1 Desktop composition

The full product uses four structural zones:

```text
top command bar
left navigation | main workspace | contextual evidence rail
```

Recommended dimensions are tokens, not one-off component values:

- command bar: `64px`;
- expanded navigation: `232px`;
- compact navigation: `72px`;
- evidence rail: `clamp(360px, 30vw, 480px)`;
- main workspace: `minmax(0, 1fr)` with no arbitrary dashboard max-width.

The main workspace owns the current task.
The left rail owns navigation.
The right rail owns additional context for the selected record.
The command bar owns global search and genuinely global actions.

Do not put the same action in the command bar, page header, card header, and
footer at the same time.

### 5.2 Responsive recomposition

Required verification widths are `320px`, `390px`, `768px`, `1024px`, and
`1440px`.

| Width or condition | Required behavior                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `>= 1200px`        | Expanded or user-collapsible left rail; contextual rail may remain docked                  |
| `768px-1199px`     | Compact rail; contextual rail becomes a dismissible overlay or replaces a secondary column |
| `< 768px`          | One-column workspace; navigation becomes a disclosed menu or bounded bottom strip          |
| Portrait           | Recompose actions and drawers; do not scale desktop absolute positions                     |
| Short-wide         | Preserve primary content and actions; reduce optional instrumentation first                |

Essential actions MUST remain reachable without horizontal scrolling.
Tables MAY use a contained horizontal scroll region when a meaningful stacked
alternative would destroy comparison.
The document itself MUST NOT overflow horizontally.

### 5.3 M0-S shell profile

M0-S implements only an operational-health shell.
It MUST NOT fabricate sources, knowledge counts, AI activity, insights, graphs,
notifications, or review work.

The initial screen SHOULD contain:

- StruInfo product identity and a short `Personal Knowledge OS` descriptor;
- one semantic page heading for system readiness;
- the exact API health state: loading, ready, not ready, or unexpected error;
- role and database readiness when supplied by the contract;
- one explicit retry action when retry is supported;
- a visible development/mock label when deterministic mock transport is active.

The M0-S screen uses `moderate / 2` depth: one edge shell, one quiet blueprint
rule or grid layer, indexed metadata, restrained reveal, and complete responsive
states.
It does not need the full long-term navigation or a synthetic dashboard.

### 5.4 M1C product workspace profile

M1C releases four real task workspaces: materials/evidence, rapid manual
review, advanced knowledge maintenance, and deterministic search/source return. The built Web
application uses the same loopback listener as the narrow product API and MUST
continue to expose AI as unavailable until an admitted adapter is configured.

The right provenance dossier MUST preserve Snapshot identity, Fragment line
range, exact selected text, and digest. A search source match opens its exact
`fragmentId`, not merely the first Fragment in the same Snapshot. Review keeps
information density, current interest, serendipity, noise/marketing, and source
reliability separate. Search keeps text, source, state and one-hop relation
reasons visible rather than collapsing them into an opaque score.

The knowledge workspace MUST make the routine post-review path primary. For a
selected Snapshot it reconstructs eligible reviewed Fragments, distinguishes
pending entries from entries already returned by source-scoped deterministic
search, and lets the user confirm an editable title, body, knowledge kind,
epistemic role, and review state before writing. The protocol term
`EpistemicRole` MUST be presented as the plain-language question “内容如何形成”:
source text, a summary organized from the source, an inference based on the
source, or a user-supplied judgment. A new source-backed item defaults to source
text while keeping the other choices available. New-write knowledge kinds are
limited to concept, viewpoint, event, method, resource, and other. The stored
`assertion` kind is labelled viewpoint; legacy entity, framework, and work kinds
remain unchanged but are displayed and filtered as resources. A successful write is followed by a search
read-back and queue advance. The action row MUST also offer a visible route to
the previous entry. An item created in the current queue session may be edited
there by appending a new immutable revision; an older or structurally complex
item routes to the advanced editor. Choosing “在高级编辑器中修改” MUST first
load that selected item's current stable identity, revision, value, privacy
fact, Fragment inputs, and historical knowledge derivations through the public
workspace-scoped read boundary. The editor MUST visibly identify the loaded
revision and preserve those inputs until the user explicitly replaces them; it
MUST NOT infer complete provenance from a search result or open a blank draft.
Multi-item splits and typed relations remain available in that secondary
advanced editor; the term
“change set” alone MUST NOT be the primary user-facing explanation. A search
refresh failure after a successful commit MUST NOT be presented as a failed
write or invite an accidental duplicate command.

Privacy-document interaction is explicit and local to the action being taken:

- Markdown intake MUST offer an unchecked “作为隐私文档录入” control beside
  the source/import fields, before the submit action;
- search MUST default to the public scope and expose a separately labelled
  unchecked “查询隐私文档” control; a previous result or page transition MUST
  NOT silently broaden a later query;
- privacy state MUST use a text label or badge in addition to color, and every
  returned private item, relation reason and full-document result MUST remain
  visibly marked;
- complete private documents MUST appear in a distinct result section and open
  only through an action that preserves the explicit privacy scope; they MUST
  NOT be blended into ordinary knowledge cards or silently opened by a public
  source match; and
- metadata needed to identify and deliberately select a private Snapshot MAY be
  visible in the materials list, but its full text, excerpts, derived entries
  and relation content MUST remain hidden until the explicit control is active.

This first local-product control communicates a visibility boundary, not
encryption or multi-user authorization. The interface MUST NOT make stronger
security claims than the implemented storage and local-runtime model.

### 5.5 M1D Entry workspace profile

M1D adds Entry browsing, annotation, and search to the existing shell. It MUST
not relabel an Entry as formal knowledge or force the advanced knowledge editor
into the routine path.

The first vertical slice has one clear task: select an existing document,
materialize or open its current Entries, edit the three keyword dimensions, and
search the saved result with an exact source route. The screen MUST expose:

- Snapshot/document identity and Entry order;
- current Entry body and precise evidence location;
- editable free content keywords;
- exactly one type keyword;
- one primary domain and at most two secondary domains;
- explicit save state and actionable failure state;
- deterministic body/keyword match reasons; and
- an optional, clearly secondary route to formal knowledge maintenance.

Type and domain choices are system protocol values and use concise Chinese
labels. A selected `其他` value reveals a dimension-specific custom-name field;
the UI MUST NOT reuse one custom value between type and domain. Actual content
keywords and custom names come from the active workspace and MUST NOT be
compiled into frontend fixtures or defaults.

Privacy remains action-scoped. Ordinary Entry lists, counts, suggestions,
related-item sections, and search exclude private content. The user must
explicitly enable `查询隐私文档` for the current view before any private Entry or
association becomes visible, and the expanded scope must remain visibly marked.

The minimal slice may omit document-tag aggregation and automatic association
scoring, but it MUST present those absent capabilities honestly instead of
fabricating candidates, counts, or AI activity. At 320/390/768/1024/1440 widths,
Entry body, keyword controls, save action, search results, and source return must
remain reachable through normal document scrolling and keyboard order.

## 6. Design Tokens

All visual values MUST be reached through semantic `--si-*` custom properties
or an equivalent typed token layer.
Components MUST NOT introduce raw hex colors or arbitrary spacing when a project
token already expresses the role.

### 6.1 Color

```css
:root {
  color-scheme: dark;

  --si-color-bg-canvas: #121515;
  --si-color-bg-shell: #0d1011;
  --si-color-surface-1: #1f2326;
  --si-color-surface-2: #252b2e;
  --si-color-surface-ai: #1c234b;

  --si-color-text-primary: #f3f7f8;
  --si-color-text-secondary: #a8b0b5;
  --si-color-text-muted: #879298;
  --si-color-text-disabled: #6f7a80;

  --si-color-border-subtle: #2b3134;
  --si-color-border-default: #394146;
  --si-color-signal: #26cdcb;

  --si-color-warning: #d9a441;
  --si-color-danger: #d9534f;
  --si-color-danger-text: #ff7c77;
  --si-color-topic: #7c6fe8;
  --si-color-topic-text: #a99eff;
  --si-color-info: #4d86ff;
  --si-color-info-text: #8db0ff;
}
```

Neutral surfaces SHOULD occupy at least three quarters of a representative
screen.
Electric cyan is reserved for current selection, focus, the primary action,
real active processing, traceable state, and important graph edges.
It MUST NOT become the color of all headings, body text, and borders.

The supplied muted color `#6f7a80` is below the normal-text contrast target on
the approved elevated surfaces.
It is therefore a disabled or decorative token.
Readable muted text uses `#879298` or a later verified equivalent.

The base danger, topic, and information colors MAY identify borders, icons, or
filled badges.
Their lighter text variants MUST be used for normal text on dark surfaces.
Color MUST NOT be the sole carrier of any state.

### 6.2 Typography

No font file is admitted by this specification.
Use system and already-installed fallbacks until a font receives dependency and
license review.

```css
:root {
  --si-font-ui:
    'Noto Sans SC', 'Source Han Sans SC', 'Microsoft YaHei UI', 'PingFang SC',
    system-ui, sans-serif;
  --si-font-display:
    'Bahnschrift SemiCondensed', 'Arial Narrow', var(--si-font-ui);
  --si-font-mono: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;

  --si-text-xs: 0.75rem;
  --si-text-sm: 0.8125rem;
  --si-text-body: 0.875rem;
  --si-text-control: 1rem;
  --si-text-title: clamp(1.75rem, 4vw, 3.5rem);
}
```

Rules:

- use one `h1` for each routed page and do not skip heading levels;
- keep Chinese body text at normal tracking and comfortable line height;
- use uppercase Latin only for short section labels, status keys, and indices;
- use tabular numerals for timestamps, counts, hashes, and coordinates;
- do not use oversized landing-page titles inside operational workspaces;
- essential text MUST NOT be smaller than `0.8125rem` at default zoom;
- mobile inputs SHOULD use at least `1rem` text.

### 6.3 Spacing and sizing

Use the following spacing scale:

```text
2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px
```

Use `4px` as the base unit.
Values outside the scale require a component-level reason, such as a 1px rule
or a responsive viewport calculation.

Interactive targets MUST be at least `40x40px` on pointer-oriented desktop
layouts and `44x44px` on touch layouts.

### 6.4 Radius, rules, and elevation

Use a restrained radius hierarchy:

- `0px`: stage geometry, rules, table edges, clipped decoration;
- `4px`: compact status and data controls;
- `6px`: standard inputs and buttons;
- `8px`: drawers, dialogs, and large functional surfaces;
- values above `10px`: only circular or semantically pill-shaped controls.

Use 1px low-contrast rules and one strong edge instead of four-sided card
chrome wherever possible.
Depth comes from surface contrast, masks, overlap, and information hierarchy.
Heavy stacked shadows and broad glass effects are prohibited.

### 6.5 Iconography and texture

Use one consistent original or approved open-source line-icon system with
`1.5-2px` strokes.
Icon-only controls require an accessible name and are limited to familiar
secondary actions.

Blueprint grids, directional rules, corner brackets, and clipped wedges MAY be
generated with original CSS or SVG.
They MUST be low contrast, ignore pointer events, and support grouping,
direction, state, or product identity.
Random scanlines, terminal noise, hexagons, and fake readouts are prohibited.

## 7. Motion

Use motion to reveal hierarchy and confirm real state:

```css
:root {
  --si-motion-direct: 240ms;
  --si-motion-reveal: 650ms;
  --si-motion-attention: 1800ms;
  --si-motion-ease: cubic-bezier(0.22, 0.8, 0.2, 1);
}
```

M0-S MAY use one masked or directional page reveal and direct hover/focus
feedback.
The full product MAY coordinate reveal and real-state attention motion.

Nonessential loops MUST stop under `prefers-reduced-motion: reduce`.
Reduced motion MUST preserve state clarity and focus, not simply remove all
feedback.
Do not animate decorative properties continuously on dense data screens.

## 8. Shared Component Model

Prefer composition over large configuration objects.
Colocate a focused component, its styles, tests, and local types.
Separate data access and state orchestration from presentational rendering.

More than 200 lines is a review signal, not an automatic violation.
Split a component when it has multiple reasons to change or cannot be tested in
isolation; do not split cohesive code to satisfy a number.

The shared component vocabulary SHOULD grow around real use:

- `AppShell`;
- `CommandBar`;
- `PrimaryNavigation`;
- `WorkspaceHeader`;
- `StatusBadge`;
- `SourceReference`;
- `AiOriginLabel`;
- `IntakeDecisionControls`;
- `ValueAssessment`;
- `ExplorationReason`;
- `ProcessingPlanSummary`;
- `KnowledgeChangeSet`;
- `MediaUsageLabel`;
- `EvidenceDrawer`;
- `ReviewActions`;
- `DataTable`;
- `EmptyState`;
- `ErrorState`;
- `LoadingState`;
- `Dialog` and `Drawer`;
- `GraphViewport` and its accessible list alternative;
- `TimelineList`;
- `BriefSection`.

Do not create a speculative component library before a component has one real
consumer and a credible second use.

## 9. Component and Page Patterns

### 9.1 Command bar

The command bar is a global operation surface, not duplicated page navigation.
Search, Ask AI, Capture, filters, notifications, and agent status appear only
after the corresponding behavior exists.

Search and Ask AI MUST communicate their scope: saved knowledge, current online
material, or mixed results.
Capture MUST make the destination and subsequent review state clear.

### 9.2 Intake, change sets, and review queue

An intake item row owns comparable decision data:

- title and short summary;
- source document, section, and stable item location;
- user-defined content classification and vocabulary version;
- information value and noise dimensions;
- current-interest and exploration types;
- traceability state;
- conflict or risk state;
- intake decision and review state;
- operation origin: user, deterministic parser, rule, import, AI, or external client;
- the policy responsible for any automatic decision;
- one primary intake or takeover action.

The interface MUST distinguish content classification, knowledge-admission
action, knowledge kind, epistemic role, review state, operation origin, and
attention routing. For example, `小说` says what the content is and does not
choose an intake action. `安静入库`, `探索推荐`, and `优先审核` describe
presentation; they MUST NOT replace `完整处理`, `拆分`, `压缩`,
`仅保留来源`, `忽略`, or `待定`.

A knowledge change set owns proposed additions, revisions, relations,
conflicts, citations, derivations, operation origin, and authorization basis.
It MUST show which operations were committed automatically and which require
human review. AI origin appears only when AI actually produced or changed an
operation; user and deterministic changes MUST NOT be visually relabeled as AI.

The evidence drawer owns excerpts, snapshot metadata, derivation, and detailed
assessments.
Full-process, split, condense, source-only, ignore, revise, authorize, reject,
merge, archive, revert-policy, and reprocess actions MUST expose their real
availability and consequences.

Negative feedback SHOULD distinguish `已经知道`, `质量低`, `来源不可靠`,
`暂时不需要`, `不感兴趣`, and `陌生但值得探索` so preference learning does
not treat every rejection as permanent topic exclusion.

The rapid-review route MUST optimize one-fragment-at-a-time decisions. Its
desktop reading order is: a narrow queue/paginator; the Fragment body above its
manual evaluation; deterministic keyword candidates above relation-intent
editing. On narrow screens these regions become one document-order column.
Queue counts belong in the page header instead of consuming a separate metric
dashboard.

`有用程度` is the review UI projection of `information_density`, while
`有趣程度` writes `current_interest`. They MUST remain independent sliders and
MUST NOT be combined into an opaque preference score. The selected
`IntakeAction` is also independent: scores MAY produce a visible recommendation
for `完整处理`, `拆分`, or `压缩`, but only the user's explicit submit chooses the
action. Submit advances to the next pending Fragment; previous/next navigation
MUST reconstruct persisted decisions, assessments, reasons, and vocabulary
assignments rather than preserve unsaved accidental state.

The submitted action is an audit-time inclination, not a mandatory downstream
knowledge shape. The review page MUST show a separate derived processing plan:
short Fragments normally become one item, while a real split requires sufficient
length and internal structure. A workspace-owned classification rule MAY suggest
a generic `KnowledgeKind` such as `work`; the actual classification label remains
external user data and MUST NOT be hard-coded as a product literal.

Both sliders expose exactly five visible positions, labelled `1` through `5`
from `很低` to `很高`; the wire value remains the accepted `0..4` assessment
score. The review workspace MUST grow to its content and use the product
workspace's normal vertical scrolling; it MUST NOT lock the route to one
viewport or clip lower panels. The queue may remain sticky and long Fragment
text may scroll inside its reading region, but evaluation, keyword, relation,
previous, and submit controls must remain reachable through ordinary page
scrolling. Reducing readable type or pointer targets is not an acceptable way
to increase density.

Keyword suggestions in the no-AI path are deterministic, visibly editable
candidates. Users can add and remove their own quick markers. The quick-marker
bar is stored in the selected workspace's external personal-preferences file,
is not exported as application code or a domain Bundle, and contains no
hard-coded default vocabulary. Choosing a marker classifies the current
Fragment; removing it from the shortcut bar does not rewrite existing reviews.
A user-visible master switch MUST disable automatic keyword insertion without
removing manually entered or already persisted terms. Link destinations, URL
paths, and attachment filenames MUST be excluded from automatic candidates by
default; a semantic link label may remain a candidate. The user may explicitly
allow URL hosts and maintain exact exclusion terms. These controls are stored
with the selected external workspace preferences and MUST NOT become source
constants, Git data, migration seeds, or domain-Bundle content.
Failure to load that optional UI-preference endpoint MUST NOT disable manual
classification. The page keeps an explicitly session-only quick-marker and
automatic-filter fallback, visibly states that it will not persist, and still
allows the current Fragment to create and assign user-confirmed vocabulary.
A confirmed keyword or quick marker becomes a term in the active external
workspace only after a user action. Before a formal knowledge item exists,
`自动候选`, `仅手动联系`, `不建立联系`, and explicit target directives express
future processing intent, not a committed `KnowledgeRelation`. The UI MUST
state this distinction.

Knowledge maintenance MUST provide a compact vocabulary workbench. Case-only
duplicates can migrate current assignments to one retained term and retire the
other; user-confirmed cross-language equivalents become alias rules; related or
containing terms stay explicit hints unless the user confirms a merge. History is
never deleted. These rules live with external review preferences, while formal
knowledge relations still require the normal knowledge-change command.

The `KnowledgeChangeSet` editor is an advanced knowledge-maintenance surface.
It MUST NOT appear as a required control in every Fragment review or block the
rapid submit-and-advance loop.

### 9.3 Evidence drawer

The drawer SHOULD contain these ordered regions when data exists:

1. origin, content classification, intake decision, review state, and policy authorization;
2. exact supporting excerpt or image region;
3. captured snapshot and canonical source links;
4. separated information, preference, exploration, noise, and trust dimensions;
5. optional processing plan, change set, derivation, and provenance events;
6. media usage and whether it came from source text, AI inference, or user confirmation;
7. source, capture, language, content type, and revision metadata.

The drawer MUST preserve keyboard focus, provide a clear close action, and
return focus to the invoking record.
On narrow screens it becomes a full-height dialog or routed detail view.

### 9.4 Daily and weekly briefs

A brief is a decision surface, not a feed of uniform article cards.
Group information by change, topic, object, or event.
Each item SHOULD answer:

- what changed;
- why it may matter;
- what evidence supports it;
- how it relates to saved knowledge;
- what action is available.

Every important conclusion MUST link to its evidence.
A weekly brief MUST NOT visually imply it is only seven daily briefs joined
together.

### 9.5 Knowledge graph

The graph uses a dark bounded grid and restrained node colors.
It MUST NOT resemble a decorative 3D star field.

Relation semantics require more than color:

- strong relation: solid line plus relation label;
- weak relation: dashed line plus relation label;
- AI inference: distinct dash or marker plus AI origin label;
- source support: explicit source-to-claim direction;
- conflict: visible conflict marker and accessible text.

Zoom, pan, filter, focus, expand, selection, and open-evidence actions MUST be
keyboard-operable where technically possible.
A searchable list or tree alternative MUST expose the same essential records
and relations to assistive technology and low-power devices.

### 9.6 Timeline

Every displayed timestamp MUST identify its semantic type when ambiguity is
possible: event, published, captured, validity, or knowledge revision time.
AI-inferred times require an inference label and precision.

The timeline SHOULD use a semantic list in document order.
Visual rails and markers are supplementary, not the only representation.

### 9.7 Ask AI

Ask AI is an optional enhancement route. It MUST NOT replace Saved Knowledge or
Search, and hiding or disabling it MUST leave deterministic filtering, exact
and alias matching, Chinese substring search, source/time filters, and relation
navigation available.

Answers MUST separate saved knowledge from real-time online material.
Important claims require citations.
When evidence is insufficient, the primary answer state MUST say so directly.

AI output MUST show generation state, source scope, citation availability, and
review status.
The UI MUST NOT portray fluent prose as verified merely because generation
completed successfully.

## 10. State and Content Language

Use concise Chinese as the primary product language.
Short English micro-labels MAY clarify hierarchy, for example
`EVIDENCE / 证据` or `REVIEW / 审阅`.
Do not scatter ornamental English or invented protocol names.

Use stable, explicit state terms.
Recommended labels include:

- `可追溯`;
- `待审核`;
- `策略自动入库`;
- `待人工判断`;
- `探索推荐`;
- `已压缩`;
- `仅保留来源`;
- `用户已确认`;
- `有争议`;
- `已驳回`;
- `已撤回`;
- `证据不足`;
- `可能过期`;
- `处理中`;
- `处理失败`;
- `部分完成`;
- `离线`.

Status text MUST be understandable without its icon or color.
Dates MUST include timezone or make the active timezone visible at the view
level.
Hashes and trace IDs SHOULD be shortened visually but remain copyable in full.

## 11. Accessibility

The minimum target is WCAG 2.1 AA.
Compatible WCAG 2.2 interaction criteria SHOULD be adopted where practical.

Every frontend change MUST satisfy:

- semantic `header`, `nav`, `main`, `aside`, and heading structure;
- a keyboard-visible skip link to the main workspace;
- logical DOM and focus order matching the visual task order;
- keyboard access to every interaction, with no positive `tabindex`;
- a visible `2px` signal-colored focus outline with offset;
- focus trapping and return for modal dialogs and drawers;
- visible labels for form controls;
- accessible names for icon-only controls;
- `aria-live="polite"` for nonurgent status updates;
- `role="alert"` only for actionable urgent failures;
- table headers and scopes for evidence tables;
- meaningful image alternative text and empty alt for decoration;
- normal text contrast of at least `4.5:1`;
- large text and non-text UI contrast of at least `3:1`;
- 200% text zoom without lost content or function;
- state communication through text or shape as well as color;
- reduced-motion parity;
- no hover-only information or controls.

Dark mode is the only approved visual theme at this stage.
The absence of a light theme is not a defect.
Forced-colors and high-contrast behavior MUST remain usable and MUST NOT be
disabled to preserve the art direction.

## 12. Frontend Engineering Constraints

The accepted application shape is React, Vite, and TypeScript.
Use the existing dependency graph and token-based CSS.

The source style guide mentions Next.js, Tailwind CSS, headless component
libraries, graph libraries, table libraries, server-state libraries, and global
state stores as possible future tools.
That mention is not dependency authorization.
Any such addition requires the repository dependency and open-source review
process and, when it changes the accepted application shape, an ADR.

Current implementation rules:

- use named first-party exports;
- keep component APIs small and composable;
- keep fetch adapters behind narrow interfaces;
- use local state for component-local interaction;
- lift state only to the nearest real shared owner;
- use URL state for shareable filters only when routing exists;
- do not add a global store for the M0-S shell;
- keep mock transports deterministic and prevent live-network fallback;
- render untrusted source and AI text as text, never injected HTML;
- never compile personal knowledge, custom categories, preferences, source
  subscriptions, saved queries, user prompts, real snapshots, or actual runtime
  configuration into frontend constants, mocks, fixtures, or assets;
- load workspace-owned vocabulary and preferences through authenticated runtime
  contracts; tracked demos and tests use clearly synthetic values only;
- treat missing AI configuration as a supported state and keep all non-AI
  routes and actions usable;
- keep CSS family tokens and depth tokens independent;
- use one semantic markup tree rather than duplicate pages per depth.

A representative root contract is:

```html
<html
  lang="zh-CN"
  data-ui-family="struinfo-industrial"
  data-ui-depth="moderate"
></html>
```

The full product may advance the shell to `complex` without changing semantic
content or accessible names.

## 13. Performance and Large-data Behavior

The UI MUST preserve interaction quality as sources, evidence, and relations
grow.

- paginate or virtualize large tables and timelines after measurement;
- load graph neighborhoods incrementally rather than rendering the full graph;
- pause offscreen motion and media;
- lazy-load noncritical images with explicit dimensions;
- memoize only measured expensive computation;
- avoid broad context updates that rerender the entire workspace;
- use CSS transitions for direct motion and reserve JavaScript animation for
  behavior CSS cannot express;
- provide a low-complexity list alternative for graph-heavy workflows.

Performance tooling or virtualization libraries still require dependency
admission.
Do not add them speculatively.

## 14. Asset and Provenance Rules

All shipped UI code and visual assets MUST be original, user-owned, or admitted
under a compatible license with required attribution.

Do not ship:

- Hypergryph, Arknights, Endfield, Palantir, Linear, Raycast, or Obsidian logos;
- reference-product screenshots, production bundles, character art, or icon
  sheets;
- fonts with unclear redistribution rights;
- copied community themes whose embedded asset rights are unknown.

Prefer original CSS/SVG grids, lines, masks, and diagrams.
Reference-product names describe high-level qualities only and do not imply
affiliation or source-code reuse.

## 15. Verification and Design Review Gate

### 15.1 Required implementation evidence

Before frontend handoff, record:

- format, lint, typecheck, focused unit tests, and build results;
- loading, ready/success, empty, partial, offline, and error behavior relevant to
  the task;
- keyboard focus order and named controls;
- reduced-motion behavior;
- viewport evidence at `320`, `390`, `768`, `1024`, and `1440` widths;
- console and runtime-error result;
- token usage and absence of unreviewed asset or dependency additions.

M1C has local real-browser functional evidence at desktop, `390px`, and `320px`,
including keyboard-first focus, responsive bounds, source return and a real
PostgreSQL-backed synthetic vertical flow. This is not production browser,
container/Linux or distribution certification. Static or unit evidence alone
MUST NOT be described as a browser PASS, and later release gates must record
their own browser/runtime identity.

### 15.2 Design review output

Use this review structure:

1. context, user task, phase, family, and depth;
2. summary verdict: `PASS`, `NEEDS_WORK`, or `BLOCKED`;
3. design-token and component compliance;
4. three-pillar assessment;
5. blocking, major, and minor findings;
6. exact remediation and rerun scope.

The three pillars are:

| Pillar        | Acceptance question                                                      |
| ------------- | ------------------------------------------------------------------------ |
| Frictionless  | Is the primary task and next action obvious and efficient?               |
| Quality Craft | Is the result coherent, responsive, accessible, and token-driven?        |
| Trustworthy   | Are AI origin, evidence, uncertainty, and failures represented honestly? |

Blocking findings include:

- an inaccessible primary task;
- misleading AI or evidence status;
- a hidden failure or dead end;
- fabricated telemetry or product data;
- copied or unreviewed third-party assets;
- a broken responsive layout at a required width;
- a material contract or dependency violation.

The project has no Figma library or Storybook at this stage.
Review against this document, rendered states, and code tokens.
Do not mark their absence as a defect or pretend that a Figma comparison
occurred.

## 16. Agent Handoff Contract

Every frontend implementation or review task MUST state:

- the fixed Git baseline;
- the released route or component scope;
- `data-ui-family` and target `data-ui-depth`;
- real user content and states allowed in the task;
- unavailable modules that must not be fabricated;
- owned paths and forbidden dependency/config paths;
- required viewport, accessibility, test, and build evidence;
- whether browser execution is admitted or still pending;
- the design-review verdict and unresolved material findings.

For M0-S, use:

```text
family = struinfo-industrial
depth = moderate
screen = operational health shell
primary task = understand readiness and retry a failed check
real data = operational-health contract only
future product modules = do not render as active UI
```

## 17. Design Inputs

This specification synthesizes:

- [StruInfo product requirements](product-requirements.md);
- [supplied frontend style direction](AI_Personal_Knowledge_OS_Frontend_Style_Guide.md);
- [Ark UI Skill](https://github.com/Brandon030722/ark-ui-skill);
- [Frontend UI Engineering](https://github.com/addyosmani/agent-skills/tree/main/skills/frontend-ui-engineering);
- [Frontend Design Review](https://github.com/microsoft/skills/tree/main/.github/skills/frontend-design-review).

No external Skill code, reference-product asset, or runtime dependency is
copied into the application by this document.
