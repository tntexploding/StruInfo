# ADR 0091: Evidence-bound structured annotations

- Status: Accepted for the P4 development increment
- Date: 2026-10-24
- Related: ADR 0088, ADR 0089, ADR 0090

## Context

Flat keywords cannot distinguish a content form, an entity, a subject and a use.
Spelling alone cannot identify a term: translations may share meaning while homonyms do not.
P1 already separates editable entries from immutable confirmed content. P4 needs to preserve that boundary.

## Decision

Store an optional structured annotation set on each Entry revision. It includes dimension and term snapshots,
original wording, primary/secondary assignment, exact body evidence, reading state, uncertainty and explicit claims.
Claims preserve statement, speaker, stance, conditions and time; absent information stays empty.
The set records its input revision, body hash, vocabulary revision, origin and adapter version.
Body changes retain the old set for inspection and mark it stale for classification.

External personal preferences own versioned dimensions, stable terms, aliases and relations.
Only the owner changes the catalog. A term identity cannot silently change meaning or dimension.
New proposed terms remain entry-local until the owner adopts them; matching spelling does not merge identities.
Only confirmed aliases and equivalent relations expand retrieval. Broader and related relations stay distinct.
The catalog is explicitly public model context and is never populated by mining private entries.

Reuse the existing tag request for model-generated structured data when dimensions are enabled.
Bound supplied context and output; validate exact local evidence before storing a durable proposal.
Do not add model stages, grants, retries or budgets. Preserve prior proposal compatibility and manual annotation sets.
Unknown and empty results are valid. Program validation does not assess whether the chosen label or claim is semantically sound.

Shared application commands serve owner HTTP and MCP with the existing private-data and write grants.
Manual saves check Entry and catalog revisions, stage a draft and use the Entry revision transaction.
Confirmed query content changes only through P1 confirmation. Topic work remains independently deferred to P5.

Migration 000041 adds current Entry annotation storage and immutable tag-proposal annotation payloads.
Published content snapshots include annotation sets. Entry Bundle v8 and Processing Bundle v17 append these tables;
older bundles upgrade with empty new tables. Restore preserves versions and pauses deferred work as before.

## Consequences and validation

Classification filters cover dimension, term identity, annotation status and reading state.
Text and identity retrieval expand confirmed equivalence only; cursors bind catalog revision.
Structured vocabulary searches use the authoritative confirmed projection instead of an incomplete legacy index.
Original labels are included in bounded search-index text. A future indexed classifier may optimize this path without changing semantics.

Use synthetic domain/provider tests, disposable PostgreSQL round trips and browser interaction/screenshot checks.
Do not migrate the private instance, rewrite real tags, call models or start topic processing in this increment.
