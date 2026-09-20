# ADR 0081: Reviewable daily and weekly reports

- Status: Accepted by the owner's request on 2026-09-13
- Scope: Local reports, shared HTTP/MCP use cases, and explicit generation

## Decision

Add a report workspace over admitted public Entries. A daily report selects one
local calendar date; a weekly report independently selects the Monday-to-Sunday
week containing that date. The request freezes its time zone, received/published
date basis, topic/source filters, source revisions and bounded generation budget.
Received time belongs to the original intake capture, not the later full-text
preparation. Unknown publication dates are excluded from a published-time report.

Selection removes repeated captures and exact duplicate bodies before generation.
A bounded model pass selects and groups reports of the same event or development;
each resulting story is separately summarized from complete selected Entry text.
Every summary point cites local source handles. Omitted candidates, grouping,
partial progress, failures and model origin remain visible. There is no required
story quota, inferred fact verification, or automatic Entry/tag/relation write.

Reports persist as workspace data in one forward migration and a compatible
Processing Bundle extension. Generation is explicit, bounded and resumable;
restart never starts a report by itself. Manual review/editing wins over late
model results. Original AI text remains separate from corrections. Export is
local Markdown with source links and an explicit draft/reviewed label. Sources
are rechecked for privacy, admission and revision changes before model calls,
reading and export. Report generation is not a delivery or publication event.

The Web application and MCP share report read, preview and export use cases.
Creation, generation and editing require the existing local owner identity.
Existing Agent grants remain unchanged; no external report-write grant is added.
A local owner can also compose a report manually without a configured model. Private-content transfer, unattended scheduling,
message delivery, monthly reports and new providers/dependencies are excluded.

## Verification

Use synthetic fixtures for period selection, deduplication, citation validation,
privacy, concurrent manual changes, restart/retry budgets and package recovery.
Exercise create, generate, edit, review, source return and export in the browser.
Existing instance data, credentials and generated reports remain outside Git.
