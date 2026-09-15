# ADR 0083: Event-first report selection and reading hierarchy

- Date: 2026-09-15
- Status: Accepted owner-requested report improvements 1, 2 and 4

## Problem

A story quota exposed to the planning model encouraged unrelated developments
to be combined. Receipt-window reports also obscured older publication dates,
and equally weighted bullet paragraphs made the main finding hard to scan.

## Decision

The existing single planning call identifies and ranks independent events across
all frozen candidates. It receives no story quota. Each source must occur exactly
once in the complete plan; only redundant accounts of the same event may share
a group. The application then applies the owner's existing story limit to
recommended groups. Remaining groups persist as collapsed “其他阅读” with sources.
This does not guarantee semantic grouping quality; owner review remains useful.

New report sources freeze publication and original intake receipt dates in the
report timezone, including inferred-publication metadata. Unknown publication
dates stay unknown. Earlier publications are marked supplementary reading;
statistical reference years, event dates and forecasts stay distinct in the
summary prompt. Source evidence is never rewritten.

Generated stories contain a cited central finding, optional supporting evidence
and an optional material limitation. Each part is bounded to 140 characters.
Old unstructured points retain their wording and presentation. Editing preserves
point roles and original AI drafts; export includes dates and other reading.

The additive optional report fields reuse the existing table and Processing
Bundle v14. Current code reads older drafts unchanged. Older executables are not
promised to read new report fields: a rollback after new report writes must use
the matching pre-upgrade backup. No migration, model dependency, extra model
stage, increased call budget, automatic report creation or delivery is added.
Price waits, privacy, stale-source checks and owner-only writes remain in force.

## Validation

Synthetic tests cover independent-event selection after limits, rejected missing
or duplicate sources, original receipt dates, unknown publication, structured
summary bounds, new/old bundle reads and price waits. Browser checks cover
supplementary dates, finding hierarchy, collapsed other reading, source return,
editing and export. Real comparison reports remain outside Git, alongside their
unchanged predecessors.

## Owner-approved reading refinement (2026-09-15)

The owner accepted removing the visible fixed three-part template. The story
adapter now returns an ordered array of 1–4 cited paragraphs (`report_story_v4`),
with required internal roles and the same 140-character bound. A short update
needs only one paragraph; critical qualifications stay next to the claim they
limit. Rendering and Markdown export preserve every stored paragraph without
role headings. This changes presentation, not existing report content or AI drafts.

The page centres the report, puts actions by its heading, collapses history into
a popover and opens editing in a native dialog at the right. Dismissal preserves
the current editing session; explicit discard or successful save ends it.
Source return preserves the draft, and saves use its original report version.
No new persistence, automatic regeneration, model call or wider authority is
introduced. Old reports use the same natural paragraph rendering.

Focused validation of the reading refinement passed 40 synthetic cases, three
browser flows (including shared query popovers), static/type checks, build and
artifact checks. Browser coverage includes draft retention, source return,
concurrent-update rejection and narrow screens. The local image also passed an
offline synthetic provider/export check. Actual Edge verification preserved the
existing comparison reports and AI drafts, with no additional model calls;
instance backup, deployment and visual evidence remain outside Git.
