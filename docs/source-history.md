# Historical Source Backfill

Document Entry exposes **补收往期** beside refresh. Select one or more public RSS
or Web subscriptions, a publication-date range and a per-source maximum. The
bottom action strip exposes **查询选定时间段的内容 → 加入待审核队列**. Querying
preselects the newest matching articles under each source quota; it does not
import. Preview and adjust individual rows before the second action. A separate
result-source filter supports inspecting one source without losing selections
from the others; the selection summary shows both total and current-source counts.
Selection spans directory pages and sources. Import explicitly selected articles
into the existing document inbox as **pending review**, even when unattended
processing is enabled. It does not accept documents, start AI, change live feed
cursors, or enable paused subscriptions.

## Discovery and scope

The owner-only application service joins RSS/Atom metadata with same-site
robots-declared Sitemaps, nested Sitemap indexes, publisher archive pages, and
public WordPress/Substack pagination where the feed generator identifies them.
A same-site custom archive or Sitemap URL is available per browsing session.
Directory scans use bounded requests and can stop between pages, continue, or
retry failed pages. Public requests are paced per host; rate limiting pauses that
source until an explicit retry rather than probing more endpoints. Metadata is held in expiring server memory, outside both Git
and the content database. Closing the view releases its session; browser/server
restart requires rereading the directory. Completed imports remain durable.

The UI reports loaded counts, unread pages, index methods and failures. Reading a
publisher's exposed index does not establish completeness of that publisher's
entire history. Deleted articles, unlisted pages, inaccessible hosts and paywalled
full text remain outside this reader. Website indexes can include non-article
pages; previews allow the owner to assess the actual public body before import.
No authentication, paid access, script execution or background media fetching is
introduced. External Agent grants are unchanged.

## Time, selection and import

- The per-source maximum defaults to 20 per explicit import batch. Leave it blank
  for no additional per-source cap; the existing 5,000-row batch ceiling remains.
  It limits selection and import, not the number of directory rows available to
  browse. Changing query sources, dates, directories or the limit requires a new
  explicit query before import. Preview/text/source display filters do not import.
- Before network imports begin, the server freezes the selected IDs and validates
  every source quota and date scope. Each small import request refers to that
  plan; extra IDs and superseded plans are rejected. Retries retain source identity
  and existing receipt decisions. Imported documents remain filterable by their
  original subscription in Document Entry.

- Use publisher publication metadata when available. URL-derived dates are
  explicitly inferred; a Sitemap's `lastmod` is never a publication date.
- Date bounds are inclusive UTC calendar dates. Unknown dates are counted and
  excluded from a date-filtered selection. Clear dates to view them; the page's
  metadata-enrichment action reads original public pages without importing.
- Canonical article URLs remove fragments and common tracking parameters for
  duplicate checks. Existing captures keep their receipt decisions and content.
  Imports are serialized and retries check durable evidence before fetching.
- Import preserves exact remote HTML and its Markdown projection, subscription
  identity, publication date and current receipt date. Writes use the existing
  evidence transaction and a review-only capture hook. Failures remain selectable
  for explicit retry; stopping retains completed results.
- One session covers at most 32 sources and 100,000 directory rows. At most eight
  sessions are resident, with a two-hour idle expiry. A selection is at most 5,000
  rows; each HTTP import request admits at most eight, and the UI submits one at a
  time for per-article progress and cancellation. Limits never masquerade as
  complete coverage. Remote responses retain the existing 8 MiB raw boundary.
  HTML projection accepts that same raw boundary while extracted Markdown stays
  within 1 MiB; script-heavy page scaffolding does not count as reading text.

No database migration, new dependency, persistent scheduling, AI call, or live
subscription expansion is part of this feature. Synthetic tests cover network
bounds, metadata interpretation, cross-source deduplication, publication-date
selection, partial failures, owner-only authority and pending-review persistence.

## Bounded operator pilots

An explicitly authorized operator may freeze an external selection manifest,
import through the existing history plan, then start bounded document tasks.
Admission decisions, task checkpoints and publication still use the same owner
application commands. This does not enable subscription polling or unattended
admission of future arrivals. Separate calibration and continuation batches;
review extraction, receipt holds, failures and measured cost before proceeding.

### Durable batch preparation and execution

`tools/historical_batch.ts` prepares and coordinates explicitly selected historical
work. All input, manifest, progress, control and lock files must be outside Git.
The preparation input records the workspace, inclusive dates, sources, cumulative
source limits and prior accepted counts, previously reviewed URLs, candidate
metadata, batch size and frozen task limits. Its TypeScript contract is
`PreparationInput` in `tools/historical_batch_plan.ts`.

Preparation excludes prior captures/reviews, known restricted or incomplete
content, unavailable bodies and unknown/out-of-range publication dates. It removes
tracking-link duplicates across sources, spreads capped selections through the
date range, and interleaves sources across batches. Prior acceptances count toward
each source's limit across all batches. Excess eligible rows are a separate reserve;
the coordinator never silently promotes them. `unchecked` candidates still require
full-text review; directory eligibility is not a completeness verdict.

```powershell
corepack pnpm exec tsx tools/historical_batch.ts prepare --input D:\External\preparation-input.json --out D:\External\manifest.json
corepack pnpm exec tsx tools/historical_batch.ts status --manifest D:\External\manifest.json --batch 1
```

Preparation creates a new manifest and refuses to overwrite one. It performs no
network import or model call. Controls default to paused. After owner authorization,
configure the existing runtime budget with batch ID `<manifest.id>-<batch number>`
and the exact workspace/model; then explicitly resume and execute:

```powershell
corepack pnpm exec tsx tools/historical_batch.ts resume --manifest D:\External\manifest.json --batch 1
corepack pnpm exec tsx tools/historical_batch.ts run --manifest D:\External\manifest.json --batch 1 --origin http://127.0.0.1:3210 --data-root D:\External\Data --execute
corepack pnpm exec tsx tools/historical_batch.ts pause --manifest D:\External\manifest.json --batch 1
```

Pause/resume changes a local control file; it does not itself start a coordinator.
A running coordinator observes pause, pauses its active tasks and waits for their
checkpoint acknowledgement. When no coordinator is running, execute it with the
paused control to apply task pauses, or pause tasks in the application. Restarting
the coordinator retains original requests, receipt revisions, task IDs and call
allowances; it can continue interrupted tasks under that same authority. Automatic
retry backoff remains owned by the application. Manual holds, terminal failures and
cancelled tasks are not restarted. A budget wait stops admission: correct the
external budget and explicitly continue the affected tasks before rerunning.

One coordinator holds an external `runner.lock`. After a process crash, verify its
recorded PID is no longer running before removing that lock and rerunning the same
command. `settled` means no runnable work remains; inspect per-article progress for
completed, rejected, held and failed results before proceeding to another batch.

The owner-only `history_restore` command reconstructs a session from at most 5,000
selected directory rows across 32 current public subscriptions. It performs no
fetch, import or model call. The server recomputes canonical identities and rejects
foreign/private-source URLs. Preview and import then recheck current source
configuration, actual publication metadata and durable duplicates. Restoring a
selection does not claim the publisher's entire archive was scanned or grant an
external Agent new write authority.

For a single runtime process, an optional external file
`exports/<workspaceId>.ai-batch-budget.json` enables conservative accounting:
`format: struinfo.ai-batch-budget.v1`, the matching `workspaceId`, `batchId`,
`model`, `limitCny`, `paused`, `offPeakOnly`, `inputCnyPerMillion`,
`cachedInputCnyPerMillion`, and `outputCnyPerMillion`. Prices are operator-supplied
estimates, not a provider invoice. An off-peak-only batch independently observes
the existing Beijing tariff window. Never use discounted rates without that
restriction. Model and budget mismatches fail closed.

Before each request, the runtime durably reserves an upper-bound input allowance
and the permitted output. `exports/<workspaceId>.ai-usage.jsonl` records stage,
model, token usage and cost only; prompts, source bodies and responses are absent.
Reliable response usage replaces the reservation. Network failures, missing
usage and interrupted processes retain the conservative reserved cost. A failed
settlement write must not discard an already paid response. An invalid journal
blocks further dispatch. Keep both files together across restarts; removing the
budget disables this optional guard. Reaching the limit pauses durable tasks
without spending a model attempt; continuation after changing a budget remains
explicit. Existing per-document call budgets and manual decisions are retained.
Four consecutive incomplete/network responses or HTTP 408/429/500/502/503/504
failures pause the matching configured batch. Other HTTP errors, including
credential and payment rejection, pause it immediately. Count settlement order,
not dispatch order, and preserve this history across restarts. A complete HTTP
200 resets the transport streak; malformed model JSON remains a separate task
failure. An already paused batch stays paused even when an in-flight response
succeeds. Old responses cannot pause a replacement batch. No global permission
or retry allowance changes. Check the provider and explicitly restore the batch
before continuing its tasks; the pause never renews the budget.
