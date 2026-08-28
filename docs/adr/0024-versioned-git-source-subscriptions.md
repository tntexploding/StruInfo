# ADR 0024: Versioned Git Source Subscriptions

- Status: Accepted
- Implementation: Complete (M1G-2, 2026-08-25)
- Date: 2026-08-25
- Owners: Main Agent / product owner
- Scope: M1G-2

## Context

The current Import page can persist manually supplied text, a user-selected
local file, or a fixed Git Markdown file whose content and commit identity are
already known to the caller. `ProcessingRun` can show real five-stage task
progress, but no current product boundary discovers a later Git version or
starts the accepted Evidence import automatically.

The owner selected M1G-2 as the next narrow product increment. The immediate
need is a recoverable first subscription path, not a generic crawler, learned
preference model, automatic Entry processing or another queue protocol. The
active workspace remains data-free, so implementation evidence must use
synthetic readers and value-free fixtures rather than restoring historical
weekly issues.

## Decision

### One closed source kind

M1G-2 supports a versioned subscription to one exact Markdown file in an
explicitly configured public GitHub repository. A subscription contains:

- a stable UUID and owner-visible label;
- an exact `https://github.com/{owner}/{repository}` repository URI;
- one repository ref and one repository-relative `.md` or `.markdown` path;
- the existing CommonMark or weekly Markdown parser profile;
- a stable source alias and optional local private-visibility flag;
- an enabled flag and a fixed interval from 15 minutes through seven days; and
- last-attempt, last-success, last-run and Git/content cursor facts maintained
  by the application.

The list has one optimistic revision and is disabled by default. Manual
execution is allowed for a valid saved subscription even when periodic
execution is disabled. Equal writes are unchanged and stale writes are
rejected. Removing a subscription does not delete already imported Evidence.

The repository URI is data, not a general fetch target. The production reader
derives GitHub API requests from the validated owner/repository/ref/path fields;
it does not accept redirects to an arbitrary host, follow page links, execute
repository code, clone a repository, read a local checkout or run Git hooks.
RSS, arbitrary webpages, APIs, private repositories, authentication tokens and
multi-file discovery remain separate later boundaries.

### External and portable state

Subscriptions and their cursors are personal configuration. They live in the
workspace-scoped external preferences file under the selected data root and
never in Git, the installation tree or a repository-relative path. The existing
personal-data package carries the closed subscription record; older preference
files and packages load an empty revision-zero list.

The cursor stores the latest successfully observed Git commit and exact source
SHA-256. A new commit with identical source bytes advances the cursor but does
not create another Snapshot. A changed source uses identities derived from the
workspace, subscription and content/commit identities, so retrying the same
observation reuses the existing Evidence import rather than duplicating it.

### Real ProcessingRun and existing import authority

Every manual or due scheduled check first creates a deterministic
`ProcessingRun` at the `import` stage. Its visible steps distinguish waiting,
checking Git, writing a changed Snapshot, no-change success and stable failure.
The run stores no source body, repository response, credential or raw error.

On change, the service calls the existing Markdown Evidence import boundary.
It does not write Evidence tables directly and does not automatically create
Entries, tags, Associations, graph edges or AI proposals. Import idempotency,
external Blob storage, immutable Snapshot/Fragment evidence and private-result
visibility therefore remain the same as a manual fixed-Git import.

The `scheduler` and combined `all` roles may poll due enabled subscriptions.
Polling is sequential and non-overlapping; the due calculation uses the saved
last attempt and configured interval. A timer is only a wake-up mechanism, not
correctness evidence. Failure leaves the last-success cursor intact and records
a bounded next retry point through the same interval. The API exposes explicit
list/replace and run-now operations; it does not expose an arbitrary URL fetch.

### UI boundary

Import owns the subscription editor because subscriptions create source
Snapshots. It shows loading, unavailable, empty, saved, running, unchanged,
imported and failed states; scheduled execution is visibly off until the user
enables a saved row. Each row shows its exact repository/ref/path, interval,
last success and cursor without displaying source text.

Overview continues to derive progress only from stored `ProcessingRun` rows.
A subscription run therefore appears on the existing five-stage rail as a
deterministic import task. The UI does not fabricate future split/tag/contact
progress and refreshes Evidence plus ProcessingRun state after a manual check.

## Rejected or deferred alternatives

### Generic web crawling or repository-wide discovery

Deferred. An arbitrary URL crawler, recursive Git tree scan or glob language
would add a much larger network and policy boundary than the first subscribed
source needs.

### Automatic downstream Entry or AI processing

Rejected for this slice. A discovered Snapshot enters the same Split page as a
manual import. Automatic split, tag, association or proposal acceptance needs a
separate versioned policy with its own limits and takeover path.

### Database migration for subscriptions

Rejected. Source choices, polling intervals and cursors are portable personal
configuration rather than shared domain truth. Existing Evidence and
ProcessingRun records remain the durable database evidence of actual work.

### Real corpus validation during development

Rejected under the active data-free baseline. Network behavior is tested
through an injected reader and synthetic GitHub responses; real source use is
deferred until the owner restores material authorization.

## Consequences

- The project gains the first real discovery/check loop while preserving the
  complete manual import path.
- Restarting retains subscriptions, cursors and due times outside the package.
- The same changed document reaches the already accepted Blob/Snapshot/Fragment
  chain, so no second ingestion model is introduced.
- GitHub availability can fail a run without blocking manual local work.
- This is not preference learning, automatic knowledge maintenance, arbitrary
  online search or proof of long-running production scheduling.

## Acceptance boundary

M1G-2 is complete when synthetic tests prove:

1. closed subscription decoding, disabled defaults, optimistic revision and
   preservation across unrelated preference writes;
2. strict GitHub repository/ref/path admission and deterministic reader mapping;
3. first import, unchanged commit, same-content new commit, changed content and
   idempotent replay behavior;
4. queued/running/succeeded/failed ProcessingRun steps without source-body or
   raw-error persistence;
5. enabled due selection, fixed-interval calculation and non-overlapping
   scheduler execution;
6. personal-data-package round-trip plus backward-compatible empty defaults;
7. public API input, stale, not-found, repository and source-read failures;
8. Import-page editing, explicit run, honest empty/error/progress states and
   responsive layouts at the established viewport widths; and
9. no real data, network call in tests, migration, dependency, automatic Entry
   materialization, AI acceptance or application-artifact leak.

## Implementation outcome

M1G-2 is complete. The external review-preferences store now carries the
revisioned subscription list and successful Git/content cursor, and the full
personal-data package preserves it without adding a database section. A native
`fetch` reader admits only the exact public GitHub repository/ref/Markdown-path
shape above. The application service creates real import-stage
`ProcessingRun` records, advances cursors only after a completed observation,
and calls the existing Evidence import authority only when source bytes change.

The public local API exposes list/replace/run-now operations. Import provides
the corresponding editor and manual check action; the `scheduler` and `all`
roles use a non-overlapping lifecycle resource for enabled due rows. Overview
continues to read the resulting run state through its existing boundary. Tests
use injected readers and synthetic GitHub responses only; no real source,
credential, migration or Provider call was introduced.

The complete repository verification passed with 101 unit-test files and 718
tests, two integration-test files and four tests, both application builds, and
an 888-file application-artifact audit. Formatting, ESLint and all TypeScript
projects also passed. These synthetic checks do not claim long-running scheduler
or live GitHub acceptance evidence.
