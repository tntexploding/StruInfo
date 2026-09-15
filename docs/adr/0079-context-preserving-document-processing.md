# ADR 0079: Context-preserving document processing

- Status: Accepted by owner direction on 2026-09-12
- Scope: Existing document tasks, source projection and bounded associations
- Supersedes: Mandatory structural splitting in the document processing guidelines

## Decision

An InformationEntry is a useful reading and annotation unit, not a mandatory
technical chunk. Coherent articles default to one complete Entry. AI grouping
may create multiple Entries only for a collection of independently
understandable items. Introductions, captions, narrative steps and conclusions
stay with their context. An uncertain grouping retains the complete document.
Original order and complete evidence coverage remain mandatory. A one-group AI
materialization uses the existing whole mode; explicit manual and external-Agent
grouping remains available. The model's independence assessment is a quality
signal, not a guarantee that its interpretation is correct.

An association evaluation may finish without proposing a relation. The existing
ProcessingRun stores successful completion with the closed no-relation step.
It creates no proposal or edge. Document tasks record an optional no_relation
step outcome, recover this completed evaluation without another call, and show
the result in the task panel. Existing records without that outcome remain
readable. Captures with the same canonical URI do not become cross-version
association candidates. Manual edits and existing overrides retain priority.

HTML projections retain safe image references, captions and loose text.
The existing reader exposes image links and does not silently fetch remote
media. Existing immutable Snapshots are not rewritten. Owner-selected
reprocessing uses an explicit new capture, retaining the original and previous
results outside the repository. This does not add media downloading or OCR.

Provider display metadata normalizes ordinary line breaks and tabs. Strict
validation still rejects invalid schemas, enums, controls, oversized fields and
incomplete partitions; no source bodies are normalized by this helper.
The split, tag and association prompt versions advance to v2.

## Compatibility and verification

Use current Entry, ProcessingRun, task and source-import boundaries. Add no
migration, provider, dependency or direct database writer. Existing proposal
acceptance, privacy, concurrency, idempotency and external data isolation remain.
The optional task outcome is carried by the current task state and package
reader. Older package state remains valid.

Synthetic regressions cover coherent articles, independent collections, source
coverage, media references, metadata limits, no-relation completion and
interrupted task recovery. Real pilot material and review records stay in the
owner-selected external instance. Report generation and broader MCP business
tools remain outside this change.
