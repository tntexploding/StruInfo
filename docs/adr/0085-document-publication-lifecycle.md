# ADR 0085: Document-centred processing and publication

- Status: Accepted by owner
- Date: 2026-09-19

For publication versions created under P1, [ADR 0088](0088-confirmed-content-and-deferred-organization.md)
replaces mutable-row hydration with confirmed reading and separate organization.
Historical tasks retain the sequence and budgets recorded here.

## Decision

One bounded document task continues from intake approval through split, tags,
relationship evaluation and publication. An evaluation may correctly produce no
relationship. Complete coherent articles may remain one Entry. All stages retain
their existing evidence, call budgets, retry limits and model identity.

Work-in-progress stays readable in the document workbench. Query, RAG, knowledge
graph and new report selection share a published Entry read view. It excludes
pending/rejected receipts, held/blocked material, superseded source captures,
unfinished document tasks and revisions that no longer match confirmation.
Existing reports and immutable evidence remain intact. Source read access is not
knowledge publication. Historical material without task/intake records remains
readable and enters confirmation when explicitly edited.

Publication is a bounded list of current Entry identities and revisions saved in
the existing intake JSON. A complete current-document comparison rejects stale
or partial confirmation. Internal tasks publish after all stages; manual edits
return to draft and require confirmation. External split/tag/relation output uses
the same boundary through `document_publish`; `document_read` exposes draft
Entries and revisions to authorized external processors. No migration or new
dependency is introduced.

Only explicit inbox actions and the saved, scoped unattended policy can enqueue
work. Legacy receipt-only requests remain compatible. External Agent reception
still requires automate, processing requires process, external publication
requires structure, and page capture requires capture. No grant is widened.
Paused/failed tasks resume explicitly with existing attempts and budget. Only
existing dispatch waits resume automatically under their original authority.
A changed intake body invalidates its review checkpoint, not the spent budget.

All internal provider requests using the shared fetch adapter are serialized.
Price and global permission are checked both before queuing and before dispatch;
in-flight results are preserved. The Overview AI module shows global allow/deny,
current state and counts. The task queue owns document stages, waits, controls
and navigation. It does not imply new unattended authorization.

## Verification

Synthetic regressions cover admission grants, pause/cancel after model review,
checkpoint recovery, stale publication, draft exclusion and serialized dispatch.
Browser scenarios cover complete document task submission, uncertain intake,
compact controls, queue navigation and preserved reading layout. Instance
verification is read-only; historical tasks are not restarted by this increment.
