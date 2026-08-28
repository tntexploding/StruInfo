# ADR 0017: Manual Within-Fragment Entry Boundaries

- Status: Accepted
- Date: 2026-08-24
- Owners: Main Agent / product owner
- Scope: M1E-4B

## Context

M1E-4A lets the owner group complete, ordered `section` Fragments before the
first Entry materialization. That path is usable without AI, but a large source
Fragment still has to become one indivisible unit. The next narrow owner-facing
gap is to place a boundary inside that Fragment without rewriting the immutable
Snapshot or losing exact provenance.

The current Entry input table identifies whole Fragments. Replacing it or
creating synthetic source Fragments would rewrite accepted evidence semantics.
Making range columns mandatory on every existing input would also force old
Bundles to invent information that their Entry section does not contain.

## Decision

M1E-4B adds exact, half-open Unicode-scalar ranges to the manual first-
materialization path.

### Range semantics

- A range is `[startCodePoint, endCodePoint)` relative to the selected text of
  one immutable source Fragment.
- `0 <= startCodePoint < endCodePoint <= fragment scalar length`.
- Manual groups must partition every ordered `section` Fragment completely:
  the first range starts at zero, adjacent ranges touch, and the last range ends
  at the Fragment length. No source scalar may be omitted, duplicated or
  reordered.
- A group may contain consecutive ranges from one or more adjacent Fragments.
  Adjacent ranges from the same Fragment are concatenated directly; different
  Fragments retain the existing two-newline separator.
- Requests contain only bounded titles, Fragment identities and scalar ranges.
  The server reconstructs Entry bodies from local evidence and never trusts
  client-authored body text.

### Persistence

Forward migration `000017` creates
`information_entry_fragment_range`. It is a one-to-one optional child of an
existing `information_entry_fragment_input` ordinal. Whole-Fragment inputs have
no range row. Ranged manual Entries store one range row for every input ordinal
so subsequent Entry edits retain the exact provenance.

The Entry Bundle section advances to `struinfo.m1d-entry.v3` and carries the new
eighth Entry table. v1 and v2 sections remain readable; their missing range
table upgrades to empty, which exactly means whole-Fragment inputs.

### Product behavior

The Split workbench exposes a read-only text selection/caret for each current
piece and an explicit “split at caret” action. Mouse and keyboard selection are
both supported; the operation is never triggered merely by selecting text.
Existing merge, boundary restore, reset, title editing, privacy and first-writer
behavior remain.

The deterministic materializer, accepted AI proposals and M1E-4A-compatible
whole-Fragment drafts continue to write no range rows. All three entry creation
paths still share `materializeEntriesIfSnapshotEmpty` under the workspace lock.

## Rejected alternatives

### Rewrite Snapshot or Fragment rows

Rejected. Source evidence is immutable and must retain the imported document
identity.

### Store only client-authored Entry body text

Rejected. It would break exact source reconstruction and allow the request to
silently change evidence.

### Add mandatory range columns to the existing input table

Rejected. Old Entry v2 Bundles cannot derive per-Fragment end offsets without
cross-section source data. An optional child table gives legacy data an exact
and honest “whole Fragment” interpretation.

### Restructure Entries that already have labels or associations

Deferred. That requires explicit lineage and migration of Entry identity,
labels, associations and graph overrides. M1E-4B remains a first-
materialization boundary.

## Consequences

- Manual no-AI splitting now reaches any Unicode-scalar boundary inside an
  imported section Fragment.
- Snapshot and Fragment evidence remain unchanged and source order stays exact.
- One migration and one backward-compatible Entry Bundle version are added; no
  dependency or Provider change is needed.
- Full-text source editing, source reordering, custom parsing/rule profiles and
  post-materialization restructuring remain deferred.

## Validation

Synthetic tests must cover scalar/UTF-16 conversion, Emoji and combining text,
complete range partitioning, gap/overlap/reorder rejection, body
reconstruction, persistence/reload, Entry v1/v2 Bundle upgrade, HTTP decoding,
keyboard-accessible workbench actions, privacy and the atomic first-writer
boundary.

## Related decisions

- [ADR 0007](0007-information-entry-first-document-processing.md)
- [ADR 0008](0008-current-entry-state-and-portable-personal-data.md)
- [ADR 0015](0015-openai-entry-split-proposals.md)
- [ADR 0016](0016-manual-entry-fragment-grouping.md)
