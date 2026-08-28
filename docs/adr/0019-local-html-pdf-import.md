# ADR 0019: Local HTML and PDF Text-Layer Import

- Status: Accepted
- Date: 2026-08-24
- Owners: Main Agent / product owner
- Scope: M1E-5B

## Context

M1E-5A accepts one local Markdown or plain-text file, but ordinary saved web
pages and text-bearing PDF documents still require manual copying before they
can enter Import -> Split. The existing Evidence model already separates an
immutable raw Blob from normalized text and exact Fragments, so these formats
do not require a second database or a new Entry model. They do require an
honest format adapter: raw HTML/PDF bytes are evidence, while extracted text is
a derived projection used by the existing deterministic structure pipeline.

The active workspace remains data-free. Parser tests therefore use only small,
generated, synthetic documents and no real source material enters Git.

## Decision

### Accepted files and budgets

- The Import page accepts one `.html`, `.htm` or `.pdf` in addition to the
  existing `.md`, `.markdown` and `.txt` files.
- Raw input remains bounded by 1 MiB. HTML must be strict UTF-8 and PDF must
  begin with a valid PDF signature. Empty, malformed, password-protected or
  textless inputs fail visibly before Evidence persistence.
- The browser sends canonical Base64 and a closed `html` or `pdf` format value
  to the new local `POST /api/v1/imports/document` boundary. The existing
  Markdown route remains available and unchanged.

### Raw evidence and textual projection

The selected HTML/PDF bytes are always the Snapshot raw Blob. The server creates
a separate UTF-8 Markdown projection, then feeds that projection through the
accepted CommonMark materializer to produce DocumentNode and Fragment evidence.
The canonical text hash therefore describes the projection while the raw Blob
identity describes the exact selected file. Privacy, source identity,
idempotent replay, external Blob location and the later Split queue remain the
same as for existing imports.

For HTML, the adapter prefers `article`, then `main`, then `body`; it retains the
document title, headings, paragraphs, lists, quotations, preformatted text,
table rows, link destinations and image alternative text. It ignores scripts,
styles, forms, embedded active content and explicitly hidden content. It never
executes document code and never fetches linked resources.

For PDF, the adapter uses PDF.js in data-only mode and emits a heading for each
page followed by the page text layer in reading order reported by the parser.
This is a text extraction boundary, not a claim of pixel-perfect layout, table,
column, footnote or equation reconstruction.

An optional source preface for HTML/PDF is added only to the textual projection;
it never changes or pretends to be part of the preserved raw file. Markdown and
plain text retain the M1E-5A composed-Snapshot behavior.

### Dependency boundary

`parse5@8.0.1` and `pdfjs-dist@6.2.108` are direct server runtime dependencies;
`entities@8.0.0` is the only net-new transitive package. Their MIT,
Apache-2.0 and BSD-2-Clause legal files are retained in the dependency record.
PDF.js's optional native `@napi-rs/canvas` dependency is explicitly ignored
because text-layer extraction does not use image rendering or Canvas.

## Rejected or deferred alternatives

### Execute a browser or fetch page assets

Rejected. Local HTML is untrusted evidence, not an application. Network fetch,
JavaScript execution, CSS layout and external media capture require separate
source-connector and retention decisions.

### OCR and visual PDF reconstruction

Deferred. Image-only scans, OCR, column recovery, drawings, embedded images and
high-fidelity table/equation extraction need a separate optional adapter with
visible confidence and provenance. M1E-5B rejects a PDF with no usable text
rather than silently inventing content.

### Office documents, archives and batch ingestion

Deferred. DOCX/ODT, multi-file capture, directory watching and cloud sync remain
separate product increments.

## Consequences

- The complete no-AI path can begin from local Markdown, plain text, HTML or a
  text-bearing PDF.
- Original HTML/PDF bytes remain recoverable from the external Blob store while
  existing Split, Tags, Associations and Query logic operate on one normalized
  textual projection.
- No database migration, repository-owned upload directory, personal fixture or
  active workspace data is added.
- Existing private-document visibility rules apply unchanged end to end.

## Validation

Synthetic tests cover semantic HTML extraction and active-content exclusion,
PDF text-layer extraction and page markers, malformed/textless rejection,
strict file admission, raw/projection separation and the existing Markdown
regression path. Server and Web typechecks, focused tests and the complete
repository quality command remain required before handoff.

## Related decisions

- [ADR 0006](0006-external-configuration-and-personal-data-isolation.md)
- [ADR 0007](0007-information-entry-first-document-processing.md)
- [ADR 0016](0016-manual-entry-fragment-grouping.md)
- [ADR 0017](0017-manual-within-fragment-entry-boundaries.md)
- [ADR 0018](0018-local-text-file-import.md)
