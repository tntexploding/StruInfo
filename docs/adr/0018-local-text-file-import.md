# ADR 0018: Local Text File Import

- Status: Accepted
- Date: 2026-08-24
- Owners: Main Agent / product owner
- Scope: M1E-5A

## Context

The Import page can capture pasted Markdown and a fixed Git file, but it cannot
select an ordinary local document. This leaves the first step of the five-stage
workflow dependent on copying text by hand even though Evidence already accepts
the `uploaded_file` resource kind, keeps source bytes in the external Blob store
and parses deterministic UTF-8 Markdown.

The active data-free development rule prohibits adding real documents to the
repository. A local file path is machine-specific personal data and is not a
portable source identity. M1E-5A must therefore add a browser-to-local-service
adapter without creating a repository upload directory or a second database.

## Decision

### Accepted files and byte boundary

- The owner may select or drop one `.md`, `.markdown` or `.txt` file.
- The file must contain valid UTF-8, must not be empty after the accepted text
  normalization and must fit the existing 1 MiB Markdown source budget.
- The browser sends canonical Base64 for the selected bytes. The local service
  decodes it before any Evidence write and feeds the resulting bytes to the
  existing atomic Markdown import use case.
- `.md` and `.markdown` use `text/markdown`; `.txt` uses `text/plain`. Both use
  the existing CommonMark structure parser, so a plain-text file becomes normal
  paragraph evidence without a new parser dependency.

When no prefix is supplied, the selected file bytes are the exact Snapshot raw
bytes. If the owner deliberately supplies “正文前置文字”, the browser creates a
new UTF-8 payload containing that prefix and the decoded file text; the UI must
state that this is a composed Snapshot rather than claim byte-for-byte file
preservation.

### Portable identity and retry behavior

The browser never sends a directory path. The default source key combines the
base file name with a SHA-256 content identity; an explicit owner alias replaces
that display/identity key. IDs and the command key remain stable while one form
submission is being retried. Therefore a network retry replays the same command
without duplicate evidence, while a later import is an explicit new capture and
continues to obey the existing resource/source-key uniqueness rules.

### Product flow

The Import page adds a third source type, keyboard-operable file input and drop
target, selected-file summary, validation feedback and read-only file preview.
Privacy, alias, canonical link, publication date and parser selection remain in
the same form. A successful capture refreshes the import history and opens the
new Evidence Snapshot; it does not automatically create InformationEntry rows.
The document proceeds to the existing Split queue.

## Rejected alternatives

### Multipart upload and a repository-owned uploads directory

Rejected. JSON Base64 fits the existing 2 MiB local request boundary for the
1 MiB source budget and needs no dependency. Source bytes belong in the external
content-addressed Blob store, never under Git or the installation tree.

### Accept arbitrary binary office formats

Deferred. PDF, DOCX, OCR and media extraction need format-specific adapters and
truthful source-position semantics. Renaming them to text would create corrupt
evidence.

### Watch directories or automatically collect files

Deferred. M1E-5A is one explicit owner action. Background collection, cloud sync
and scheduled import require separate configuration and failure-state decisions.

## Consequences

- The complete no-AI path can now start from a local Markdown or text file.
- No migration, package dependency, personal fixture or active repository data
  is added.
- Exact raw byte preservation is honest for unmodified file capture; deliberate
  prefix composition is visible and produces a new source payload.
- Existing privacy, Blob, Snapshot, Fragment, split and Bundle boundaries remain
  unchanged.

## Validation

Synthetic tests cover accepted extensions, strict UTF-8, the 1 MiB boundary,
canonical Base64 transport, portable source keys, raw-byte import, prefix
composition, private capture, retry behavior, file-selection UI states, the visible drop target and the
existing complete quality command. Browser validation uses only generated
in-memory files and never imports real user data.

## Related decisions

- [ADR 0006](0006-external-configuration-and-personal-data-isolation.md)
- [ADR 0007](0007-information-entry-first-document-processing.md)
- [ADR 0016](0016-manual-entry-fragment-grouping.md)
- [ADR 0017](0017-manual-within-fragment-entry-boundaries.md)
