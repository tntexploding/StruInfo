# ADR 0092: Bounded background topics and selective relations

- Status: Accepted for the P5 development increment
- Date: 2026-10-24
- Related: ADR 0088, ADR 0091

## Context

Pairwise model judging grows with the corpus and delays publication. P1 provides immutable confirmed
content and independent deferred organization. P4 provides evidence-bound annotations and explicit term identity.
P5 needs useful, explainable topic membership without making a relation mandatory for every Entry.

## Decision

Keep candidate similarity, topic membership and concrete pair relations separate. Recall a bounded group
from confirmed public Entries using effective annotation identities and lexical evidence. Count cooccurrence
inside an independent Entry, cap publisher contributions, deduplicate bodies, downweight frequent and broad
terms, and never count model topics or relations as new observations. Limit candidate groups by document,
publisher, date and known conditions. No whole-corpus pairwise model loop or new embedding call is introduced.

Persist topics with a name, scope, members, reasons, exact body quotes and Entry revisions. Members may be
included, pinned or excluded. A summary records covered member revisions and becomes stale on changed or
uncovered membership. Incremental jobs send only selected public members and related topic decisions;
unaffected members remain stored. Optional supports, contradicts, continues and replaces relations require
evidence at both ends. Manual membership, relations, blocks and legacy manual pair decisions take priority.

One owner-authorized group uses one structured model request plus the frozen existing transport retry allowance.
The group must name the existing external batch budget; missing, paused, exhausted or mismatched budgets wait.
Charge the request once at group level through the existing usage journal. Unknown billed usage retains its reservation.
Retain global permission, price and concurrency gates. A deferred publication record alone grants no model authority.

Freeze selected inputs, candidates, rule and vocabulary versions. Reuse identical work; save a valid response
before applying it. Apply topics and job completion atomically with compare-and-swap. Check current admission,
Entry revisions, vocabulary revision and topic versions before applying. Do not overwrite newer manual work.
No-topic output is successful; malformed or unsupported evidence is not retried as a transport failure.
Cancellation preserves in-flight answers and accounting without applying them.

Migration 000042 adds a workspace-scoped topic/job aggregate with versioned values. Processing Bundle v18
appends it and retains older codecs. Restore pauses queued/running jobs and preserves settled history.
Shared application commands serve HTTP and MCP using existing read/relation grants; only the owner starts
or controls internal model jobs. The UI exposes the same candidate, topic and job distinctions.

## Consequences and validation

Basic publication remains independent of organization success. P5 does not rewrite historical document-task
semantics, silently process new publications, allocate new money or migrate the private instance.
P7 owns active-workspace cutover; P8 owns removal of fully replaced paths.

Use synthetic provider/domain tests for bounded recall, empty results, exact evidence, manual authority,
late versions, cancellation, reuse and metering. Verify atomic storage and restore in disposable PostgreSQL
and inspect the real browser panel at desktop and narrow widths. Semantic quality and cost effectiveness
require a separately authorized finite model run; passing engineering checks does not establish either.
