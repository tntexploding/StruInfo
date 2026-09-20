# ADR 0086: Explicit Batch Document Recovery

- Status: Accepted by owner
- Date: 2026-09-19

## Decision

The overview queue provides owner-selected continuation, recovery rounds and
admission of existing unprocessed public documents. Each apply request includes
at most 32 distinct document identities and their observed versions. Partial
success is reported per document. Preview excludes private, pending, held,
rejected and manually edited drafts, completed/cancelled tasks, and duplicate
source versions. A legacy accepted document without a task enters the existing
full review-to-publication pipeline under saved budgets.

Continue preserves attempts and remaining calls. Restart is restricted to failed
document tasks whose attempt or call allowance is exhausted. A new task retains
completed steps, records the predecessor and cumulative earlier calls, and gets
the same bounded per-round allowance. The original task is superseded and cannot
write again. Restart requests are idempotent under the predecessor lock. Changed
Entry versions or a manual publication draft block recovery. A restart cannot
hide the original creation time from manual-publication checks.

Existing price and global-permission gates govern every request. No automatic
restart loop, new source subscription, unattended policy change, external Agent
grant, dependency or migration is introduced. Recovery metadata lives in the
existing task JSON and remains in personal-data packages; downgrade uses the
pre-upgrade backup. The owner authorized processing the eligible historical
backlog in the existing external instance after synthetic tests and backup.
