# Deterministic Markdown Structure Contract

- Contract ID: `C-SLICE-A-MARKDOWN-r2`
- Status: Frozen corrected implementation contract; acceptance requires the named TM1 gate
- Baseline: `e478ff06b817c2987578baa3c14534e30279d579`
- Upstream contract:
  [`C-SLICE-A-EVIDENCE-r2`](source-evidence-storage-contract.md)
- First source profile: `ruanyf-weekly-v1`

## Purpose

This contract defines the first deterministic transformation from captured
Markdown bytes to an ID-independent document structure and then to the existing
source-evidence application DTOs.

The transformation is a pure, AI-optional boundary. It does not fetch a source,
read a file, follow a link, download an image, write a Blob, call PostgreSQL,
classify content, decide intake, create formal knowledge, render HTML, or execute
source-controlled code.

The parser preserves evidence and proposes reviewable structural units. It does
not decide whether those units are interesting, reliable, admitted, or factual.

Revision 2 changes only the resource-budget execution boundary. The admitted
CommonMark dependency exposes a synchronous API that completely buffers its
public parse result and has no supported abort or streaming limit. The fixed
source-byte ceiling bounds that upstream step. After it returns, one bounded
StruInfo preflight decides all reachable product-graph budgets before the full
StruInfo graph is allocated. Revision 2 does not change parser identity,
normalization, output, errors, budget values, CommonMark semantics, or the
dependency set.

## Fixed implementation profile

Contract revision 2 does not increment a parser, projection, or storage
identity. References below to revision 1 describe that unchanged parser and
output shape, which uses these identities:

| Identity                     | Value                                 |
| ---------------------------- | ------------------------------------- |
| Generic parser name          | `struinfo-commonmark`                 |
| Weekly parser name           | `struinfo-commonmark/ruanyf-weekly`   |
| Parser version               | `1`                                   |
| Text normalization version   | `utf8-lf-v1`                          |
| Structure projection version | `markdown-structure-v1`               |
| Markdown grammar             | CommonMark, with no syntax extensions |
| Parser dependency candidate  | `mdast-util-from-markdown@2.0.3`      |

The dependency is not admitted merely by appearing in this contract. Before it
enters a candidate, its exact package, tarball provenance, transitive closure,
checksums, license material, SBOM entries, and third-party notice changes must
pass the repository dependency process.

The implementation calls `mdast-util-from-markdown` directly. It does not add a
`unified` or `remark-parse` plugin layer and does not reuse Prettier's bundled
parser internals.

`commonmark-v1` maps only to parser name `struinfo-commonmark`;
`ruanyf-weekly-v1` maps only to `struinfo-commonmark/ruanyf-weekly`. Both use
parser version `1`; callers cannot mix these identities.

Any change to the parser dependency version, enabled grammar, AST mapping,
section rules, range conversion, Fragment policy, canonical projection, or ID
materialization algorithm requires a new parser version. A normalization change
also requires a new text-normalization version. Existing structures are never
overwritten to apply new behavior.

## Boundary split

The implementation has two pure stages.

### Parse stage

`parseMarkdownStructure` accepts a closed `unknown` value and returns either a
complete `ParsedMarkdownDocument` or one stable rejection. It emits parser-local
keys and contains no database UUIDs.

The input contains only:

- `workspaceId`, `resourceId`, and `snapshotId` context;
- the exact logical raw Blob identity already assigned to those source bytes;
- `profile`, which is exactly `commonmark-v1` or `ruanyf-weekly-v1`;
- `sourceUtf8`, an ordinary owned byte view containing the captured Markdown;
- optional `documentBaseUri`, used only to resolve relative Markdown link and
  image destinations.

Parser names, versions, grammar switches, limits, clocks, callbacks, plugins,
and ID generators are not caller-controlled fields.

Before decoding, the parser validates the context and exact raw identity. The
top-level and raw-Blob workspace IDs agree, all IDs and digests satisfy the
upstream evidence contract, `rawBlob.digestAlgorithm` is `sha256`, and the SHA-256 and
byte length calculated from the owned `sourceUtf8` copy equal `rawBlob.digest`
and `rawBlob.byteLength`. The raw `blobId` also equals the deterministic Blob ID
defined below for its workspace and digest. A mismatch rejects with
`invalid_source_identity`; the parser cannot attach arbitrary bytes to an
already named raw Blob or introduce a second stable ID for one Blob digest.

When present, `documentBaseUri` is an absolute HTTP(S) URI with a host, no
credentials, and no fragment. It identifies the immutable source-document view,
not a local checkout path. Validation uses `new URL(documentBaseUri)` and the
parsed document stores exactly the resulting `.href`. An invalid base fails
with `invalid_base_uri` before any destination is resolved.

### Materialization stage

`materializeMarkdownEvidence` accepts one successfully parsed document plus a
closed binding containing:

- the complete `SnapshotInput` that will be used by the surrounding capture;
- an explicit `external_reference_only` media policy; and
- the original `sourceUtf8` needed to replay and authenticate the parse-stage
  result.

It returns:

- one `DocumentStructureInput`, including nodes and Fragments;
- zero or more `ExternalMediaAssetInput` values;
- zero or more `MediaUsageInput` values; and
- through the structure DTO, the owned normalized UTF-8 bytes needed by the
  Blob port and the existing evidence validator.

The materializer performs no I/O. It cannot select stored media, download an
asset, or manufacture a captured secondary Resource.

The materializer also closes the Snapshot binding. The supplied Snapshot has
the same workspace, Resource, and Snapshot IDs as the parsed document; its
`rawBlob` is present and exactly equals the parsed raw Blob; its `rawSha256`
equals that Blob digest; its `canonicalContentSha256` equals
`normalizedTextSha256`; and its `canonicalizationVersion` is `utf8-lf-v1`.
Every mismatch rejects with `invalid_source_identity` before a DTO is returned.

For either fixed revision-1 Markdown parser name, `validateEvidenceCapture`
repeats the Snapshot/canonical-text identity checks against the capture DTO,
requires each exact Blob identity in its Blob set (one shared row when raw and
normalized identities are equal), and verifies the deterministic Blob and
structure IDs. The validator does not claim to re-read raw Blob-store bytes;
byte-to-raw-identity proof belongs to the parse call and a later Blob-port read
gate.

## Normative public shapes

The following TypeScript shapes are normative. Imported evidence types are the
types already defined by `evidence_contract.ts`. Optional properties are omitted,
not set to `null` or `undefined`. Every record and nested union is closed.

```ts
export type MarkdownProfile = 'commonmark-v1' | 'ruanyf-weekly-v1';
export type MarkdownParserName =
  'struinfo-commonmark' | 'struinfo-commonmark/ruanyf-weekly';

export interface ParseMarkdownInput {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly rawBlob: Readonly<ExactBlobIdentity>;
  readonly profile: MarkdownProfile;
  readonly sourceUtf8: Uint8Array;
  readonly documentBaseUri?: string;
}

export interface ParsedSourceRange {
  readonly codePointRange: Readonly<CodePointRange>;
  readonly lineRange: Readonly<LineRange>;
}

export interface ParsedMarkdownNode extends ParsedSourceRange {
  readonly localKey: string;
  readonly parentLocalKey?: string;
  readonly kind: DocumentNodeKind;
  readonly siblingOrdinal: number;
}

export type ParsedFragmentRole = 'document' | 'leaf' | 'intake_target';

export interface ParsedMarkdownFragment extends ParsedSourceRange {
  readonly localKey: string;
  readonly nodeLocalKey: string;
  readonly role: ParsedFragmentRole;
  readonly selectedTextSha256: string;
}

export type ParsedLinkResolution =
  | Readonly<{status: 'resolved'; uri: string}>
  | Readonly<{
      status: 'not_resolved';
      reason:
        | 'document_fragment'
        | 'relative_without_base'
        | 'unsupported_scheme'
        | 'credentials_not_allowed'
        | 'invalid_uri';
    }>;

export interface ParsedLinkReference extends ParsedSourceRange {
  readonly localKey: string;
  readonly nodeLocalKey: string;
  readonly ordinal: number;
  readonly rawDestination: string;
  readonly resolution: ParsedLinkResolution;
  readonly captureState: 'not_captured';
}

export interface ParsedMediaReference extends ParsedSourceRange {
  readonly localKey: string;
  readonly imageNodeLocalKey: string;
  readonly ordinal: number;
  readonly rawDestination: string;
  readonly resolvedUri: string;
  readonly purpose: MediaPurpose;
  readonly purposeOrigin: MediaPurposeOrigin;
}

export type MarkdownDiagnosticCode =
  'opaque_html_block' | 'inline_html' | 'link_definition_block';

export interface MarkdownDiagnostic extends ParsedSourceRange {
  readonly code: MarkdownDiagnosticCode;
}

export interface ParsedMarkdownDocument {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly rawBlob: Readonly<ExactBlobIdentity>;
  readonly profile: MarkdownProfile;
  readonly parserName: MarkdownParserName;
  readonly parserVersion: '1';
  readonly textNormalizationVersion: 'utf8-lf-v1';
  readonly structureProjectionVersion: 'markdown-structure-v1';
  readonly documentBaseUri?: string;
  readonly normalizedTextUtf8: Uint8Array;
  readonly normalizedTextSha256: string;
  readonly normalizedTextByteLength: number;
  readonly structureSha256: string;
  readonly nodes: readonly Readonly<ParsedMarkdownNode>[];
  readonly fragments: readonly Readonly<ParsedMarkdownFragment>[];
  readonly intakeTargetNodeKeys: readonly string[];
  readonly links: readonly Readonly<ParsedLinkReference>[];
  readonly media: readonly Readonly<ParsedMediaReference>[];
  readonly diagnostics: readonly Readonly<MarkdownDiagnostic>[];
}

export interface MaterializeMarkdownEvidenceInput {
  readonly parsed: Readonly<ParsedMarkdownDocument>;
  readonly snapshot: Readonly<SnapshotInput>;
  readonly mediaPolicy: 'external_reference_only';
  readonly sourceUtf8: Uint8Array;
}

export interface MaterializedMarkdownEvidence {
  readonly textBlob: Readonly<EvidenceBlobInput>;
  readonly structure: Readonly<DocumentStructureInput>;
  readonly mediaAssets: readonly Readonly<ExternalMediaAssetInput>[];
  readonly mediaUsages: readonly Readonly<MediaUsageInput>[];
}

export type MarkdownBudgetName =
  | 'source_bytes'
  | 'nodes'
  | 'fragments'
  | 'depth'
  | 'links'
  | 'media'
  | 'diagnostics'
  | 'canonical_structure_bytes'
  | 'canonical_json_values';

export type MarkdownIssueCode =
  | 'invalid_shape'
  | 'invalid_source_identity'
  | 'invalid_utf8'
  | 'invalid_text'
  | 'empty_document'
  | 'limit_exceeded'
  | 'invalid_source_position'
  | 'invalid_tree'
  | 'invalid_fragment'
  | 'invalid_base_uri'
  | 'invalid_media_reference'
  | 'unsafe_media_scheme'
  | 'parsed_result_mismatch'
  | 'structure_hash_mismatch'
  | 'internal_parser_failure';

export interface MarkdownIssue {
  readonly code: MarkdownIssueCode;
  readonly path: string;
  readonly range?: Readonly<ParsedSourceRange>;
  readonly budget?: MarkdownBudgetName;
}

export type ParseMarkdownResult =
  | Readonly<{status: 'parsed'; value: Readonly<ParsedMarkdownDocument>}>
  | Readonly<{status: 'rejected'; issue: Readonly<MarkdownIssue>}>;

export type MaterializeMarkdownEvidenceResult =
  | Readonly<{
      status: 'materialized';
      value: Readonly<MaterializedMarkdownEvidence>;
    }>
  | Readonly<{status: 'rejected'; issue: Readonly<MarkdownIssue>}>;
```

`nodes` are canonical pre-order. Fragments and intake-target keys follow node
pre-order. Links and media follow token start, token end, then occurrence
ordinal. Diagnostics follow start, end, then diagnostic code. Materialized
assets follow first resolved-URI occurrence and usages follow image-node order.

All metadata records and arrays in a successful result are deeply frozen. The
parse result's `normalizedTextUtf8` and the materialized
`structure.normalizedTextUtf8` are fresh ordinary full-view owned copies and are
intentionally the only mutable return values. Materialization defensively
copies and rechecks the parsed normalized bytes against their digest. Mutating a
parsed byte view therefore causes a stable identity rejection; it cannot create
a different valid structure. Each successful materialization returns a new byte
view, so mutating one materialized result cannot affect another call.

## Closed input and owned bytes

Both public stages accept ordinary own-data-property records with declared
fields only. They reject inherited or unknown fields, symbol keys, accessors,
proxies, class instances, custom prototypes, sparse arrays, array accessors,
and extra array properties without executing caller-owned accessors or traps.

`sourceUtf8` must be an ordinary full-view `Uint8Array` over a fixed,
non-shared, non-detached `ArrayBuffer`. Partial, resizable, detached, proxied,
or shared views fail before parsing. The parser makes a defensive copy before
decoding; later caller mutation cannot change the result.

The materializer applies the same byte-view rules to its own `sourceUtf8`,
makes a new copy, and internally reruns `parseMarkdownStructure` from those raw
bytes using only the parsed context, raw identity, profile, and base URI. It
requires exact field-by-field equality with the supplied parsed document,
including normalized bytes, identities, keys, ordering, ranges, hashes,
targets, links, media, and diagnostics. A caller-built internally consistent
object that was not produced by the fixed parser is rejected with
`parsed_result_mismatch`; a TypeScript brand or frozen object is never treated
as proof of parser origin.

### Validation precedence

Each public call returns the first failure in this order; a later applicable
condition never replaces it.

`parseMarkdownStructure` uses:

1. closed shape and byte-view shape (`invalid_shape`);
2. source-byte limit (`limit_exceeded/source_bytes`);
3. source bytes, raw digest/length, workspace, and deterministic raw Blob ID
   binding (`invalid_source_identity`);
4. base-URI validation (`invalid_base_uri`);
5. fatal UTF-8 decode, NUL rejection, then the exact empty-document check;
6. CommonMark conversion and position conversion;
7. mapped tree invariants, Fragment invariants, and reachable budgets using the
   resource-budget priority below; and
8. canonical projection and structure digest.

`materializeMarkdownEvidence` uses:

1. closed shape and both byte-view shapes (`invalid_shape`);
2. source-byte limit, raw byte/Blob binding, then Snapshot binding;
3. profile/parser/version/base consistency and the parsed normalized-byte
   digest/length (`invalid_base_uri` for an invalid base, otherwise
   `parsed_result_mismatch` for a parsed-result inconsistency);
4. supplied tree invariants (`invalid_tree`);
5. supplied Fragment invariants (`invalid_fragment`);
6. supplied canonical projection digest (`structure_hash_mismatch`);
7. a complete raw-byte parser replay, propagating any parse-stage issue; and
8. exact comparison of every remaining replayed field
   (`parsed_result_mismatch`), followed only then by DTO construction.

Thus changing only `parsed.structureSha256` returns
`structure_hash_mismatch`; changing a structurally valid node or Fragment while
also supplying its recomputed hash reaches replay comparison and returns
`parsed_result_mismatch`; and an invalid tree or Fragment returns its invariant
code before either digest or replay comparison.

No returned error contains source text, a URI value, input bytes, a local path,
or a caller-provided object rendering.

## Text normalization `utf8-lf-v1`

The normalization algorithm is exact and ordered:

1. enforce the inclusive source-byte limit and take an owned byte copy;
2. decode UTF-8 in fatal mode, never inserting U+FFFD for invalid input;
3. remove one leading U+FEFF byte-order mark when present;
4. replace every CRLF pair with LF, then every remaining CR with LF;
5. reject U+0000;
6. preserve every other code point, whitespace character, tab, and trailing LF;
7. do not apply NFC, NFD, NFKC, NFKD, trimming, or a synthetic final newline;
8. encode the result as UTF-8 and calculate its lowercase SHA-256.

Normalized text fails with `empty_document` exactly when
`normalizedText.trim().length === 0`; the parser does not manufacture a
zero-length root node. A retained U+0000 fails with `invalid_text`.

The raw Snapshot identity remains the digest and length of the original captured
bytes. For this import profile, `Snapshot.canonicalContentSha256`, the normalized
text Blob digest, and the digest used by the structure projection are equal, and
the Snapshot canonicalization and structure normalization versions both equal
`utf8-lf-v1`. The implementation must never report the normalized digest as the
raw digest when CR, CRLF, or a BOM changed the bytes.

## Locator semantics

All persisted text locations use the normalized text, not the raw Snapshot:

- code-point ranges are zero-based, non-empty, and half-open;
- line ranges are one-based and have an inclusive end;
- line 1 begins at code point 0;
- only LF terminates a line; and
- the ending line is the line containing `end - 1`.

MDAST/unist offsets are UTF-16 code-unit offsets. The implementation builds one
UTF-16-boundary-to-Unicode-code-point map for the normalized text. Every parser
position must land on a valid code-point boundary; an offset inside a surrogate
pair is a parser invariant failure. Columns are not persisted in revision 1.

Revision 1 does not claim a raw-byte locator. The raw Snapshot remains available
as separate evidence, while all Node and Fragment round trips use the normalized
text Blob.

## Generic CommonMark structure

The output contains exactly one `document` root. Its range covers the entire
normalized text and its sibling ordinal is zero.

Supported block mappings are:

| CommonMark node                            | StruInfo node                        |
| ------------------------------------------ | ------------------------------------ |
| root                                       | `document`                           |
| document-flow heading                      | synthetic `section` plus `heading`   |
| heading inside quote or list               | `heading`                            |
| paragraph                                  | `paragraph`                          |
| block quote                                | `blockquote`                         |
| ordered or unordered list                  | `list`                               |
| list item                                  | `list_item`                          |
| indented or fenced code                    | `code_block`                         |
| thematic break                             | `thematic_break`                     |
| Markdown image or resolved image reference | `image`                              |
| HTML or link definition block              | opaque `paragraph` plus a diagnostic |

Inline text, emphasis, strong text, inline code, breaks, and ordinary links stay
inside the exact range of their enclosing block. They do not become independent
`DocumentNode` values in revision 1. Raw HTML is never parsed as DOM, rendered,
executed, or inspected for media.

An image node is a direct child of the smallest mapped paragraph or heading
that contains its inline occurrence. Image sibling ordinals are dense among
image children of that block; intervening text, links, emphasis, and other
non-node inline constructs do not consume an ordinal. An inline HTML AST node
does not become a node and remains covered by its enclosing block range. A
block HTML AST node and a link-definition AST node each become one opaque
paragraph over their exact source range.

Only headings in document flow synthesize section hierarchy. A section begins at
its heading and ends immediately before the next document-flow heading whose
rank is less than or equal to its rank, or at the enclosing section/document end.
The heading node is the section's first child. A skipped rank attaches to the
nearest preceding lower-rank section; the parser does not create a fictional
heading. A heading inside a quote or list remains a heading node in that
container and does not restructure the document root.

Every node additionally satisfies:

- its range is non-empty and contained by its parent range;
- sibling ordinals are dense `0..n-1` in source order;
- sibling source ranges do not cross;
- the exported node array is canonical pre-order traversal;
- `list_item` is a child of `list`; and
- parser-local keys use structural paths and occurrence ordinals, never heading
  text, a displayed item number, a URL, or a content hash.

CommonMark syntax is error-tolerant. An unclosed fenced block extends to EOF, and
an unrecognized or malformed link remains source text. Neither condition may
hang, read past the source, or invent a target.

## `ruanyf-weekly-v1` profile

The weekly profile is a deterministic source adapter layered on the generic
CommonMark tree. It does not change Markdown grammar and contains no user
preference or intake policy.

`commonmark-v1` declares no automatic intake targets. It emits the document and
leaf evidence needed for later manual selection. Weekly heading matching
derives one exact label from the CommonMark heading's inline tree. In source
order, `text` contributes its parsed value after replacing every LF with one
U+0020, and `inlineCode` contributes its parsed value unchanged. `emphasis`,
`strong`, `link`, and `linkReference` recursively contribute their children; an
image or image reference contributes its parsed alt value; a `break` node
contributes one U+0020; and inline HTML contributes nothing. CommonMark
character references and escapes therefore use the parser's decoded value. The
concatenation is trimmed with ECMAScript `String.prototype.trim()` and is
otherwise unchanged: no whitespace collapse, case folding, translation, or
fuzzy matching occurs. Any inline node kind not listed above contributes the
empty string. A source spelling change requires an explicit profile revision
instead of an implicit guess.

The profile applies these rules to document-flow level-two sections:

1. `科技动态`, `文章`, `工具`, `AI 相关`, `资源`, `图片`, `文摘`, and
   `言论` are numbered-entry containers.
2. A direct child paragraph is an entry marker only when its first source line
   begins at the normalized physical line start with the ECMAScript Unicode
   regular expression `/^[1-9][0-9]*、/u`, and the paragraph range starts at
   that same code point. The digits are ASCII, the separator is U+3001, and any
   leading source whitespace therefore prevents a match even when CommonMark
   would omit indentation from the paragraph AST position.
3. When a container has at least one marker, each marker starts a synthetic
   child section that ends before the next marker or at the parent end. Those
   child sections, not the parent container, are intake targets.
4. Missing, repeated, or non-monotonic displayed numbers do not fail, reorder,
   merge, or deduplicate entries. Source occurrence is identity.
5. A number-like line in a non-container section, code block, quote, nested list,
   or non-initial paragraph line never creates a peer weekly entry.
6. A numbered-entry container with no recognized markers remains one intake
   target; source information is not discarded because numbering is absent.
7. `封面图` is one intake target. A Markdown image in that section receives the
   deterministic purpose suggestion `cover`.
8. `往年回顾` remains in the document tree but is a navigation section and is
   not an intake target.
9. Every other level-two content section is one intake target. The document H1,
   preamble, and navigation do not become independent targets.

The profile exports `intakeTargetNodeKeys` as a deterministic projection. It is
reconstructable from the normalized text and the frozen parser/profile
versions because each target section receives a section Fragment while a
non-target container section does not. Fragment rows do not persist an intake
role, so this is not a durable control record. `intakeTargetNodeKeys` is not a
`ContentClassification`, `IntakeDecision`, or authorization to create
knowledge.

## Fragment policy

Fragments always select exact normalized source, including visible Markdown
markers. The parser does not save a generated plain-text paraphrase as evidence.

Revision 1 emits one Fragment for:

- the document root;
- every `heading`, `paragraph`, `code_block`, and `image` leaf; and
- every profile-declared intake-target `section`.

Container-only list, list-item, blockquote, non-target section, and thematic-break
nodes do not receive an additional container Fragment. Their source remains
covered by the document, target, and leaf ranges.

Each Fragment is bound to one node, uses that exact node range, uses locator
`unicode_code_point_range` version 1, carries the derived line range, and hashes
the UTF-8 encoding of the selected normalized text. Overlap between a target
Fragment and its leaf Fragments is intentional. Equal text at different source
occurrences remains distinct. Ancestor/descendant range overlap is allowed;
crossing ranges are not. Canonical Fragment order is node pre-order index,
code-point start, code-point end, locator kind, locator version, then selected
text digest.

## Links and media

### Links

The parser reports every recognized ordinary Markdown link or resolved link
reference, excluding images, as a `ParsedLinkReference`. Its range is the exact
link occurrence, its node key is the smallest enclosing mapped block, and its
ordinal is dense among ordinary links in that block. `rawDestination` is the
CommonMark parser's decoded destination value; for a reference it is the value
selected by CommonMark definition resolution.

URI resolution uses the platform WHATWG `URL` implementation. A destination
whose first code point is `#` is `not_resolved/document_fragment`. Otherwise,
the parser calls `new URL(rawDestination)` when no base exists or
`new URL(rawDestination, documentBaseUri)` when it does. A throw without a base
is `relative_without_base`; a throw with a base is `invalid_uri`. A parsed URI
outside HTTP(S) is `unsupported_scheme`, credentials produce
`credentials_not_allowed`, and an absent hostname is `invalid_uri`. A success
stores exactly the resulting `.href`. Resolution neither performs DNS nor
opens a connection.

It never fetches a destination or creates a Resource/Snapshot for it. The current
evidence schema has no persisted Link entity; the source token remains durable in
its Fragment, and the sidecar can be recreated deterministically. Queryable link
persistence requires a separate forward contract and must not be improvised as
JSON or a fake captured Resource.

Every non-resolved destination remains in source evidence and in the bounded
sidecar reason rather than becoming a captured link.

### Media

Each recognized Markdown image or CommonMark-resolved image reference produces
one `image` node and one
`ParsedMediaReference` containing its local key, image-node key, occurrence
ordinal, exact occurrence range, decoded destination, and resolved URI. An
unresolved image reference remains inline source text and does not become an
image node or media reference.

Media uses the same WHATWG resolution and exact `.href` output as links, but it
is fail-closed: a destination must resolve to HTTP or HTTPS, have a hostname,
and contain no credentials. `file:`, `data:`, `javascript:`, local absolute
paths, credentials, and other unsafe schemes fail the whole parse with
`unsafe_media_scheme`. A fragment-only destination, parse failure, absent host,
or relative image without a base fails the whole parse with
`invalid_media_reference`; no partial result is returned.

Materialization deduplicates assets by resolved URI within one structure but
retains a separate MediaUsage for every occurrence. Every successfully resolved
but unfetched image becomes an `external_reference`; no bytes, media type, or
dimensions are invented. Normal images use purpose `unknown`, origin `unknown`,
and no confidence. Images in the weekly `封面图` target use purpose `cover`,
origin `deterministic_parser`, and no confidence. Later corrections append a new
usage under the evidence contract.
Media-asset local keys use the first-seen resolved-URI ordinal, while usage keys
use image occurrence paths; neither key contains the URI itself. Because one
image node represents one source occurrence, its MediaUsage ordinal is zero.

`documentBaseUri` is immutable parse context. Changing it can change link
sidecars and resolved media while leaving Markdown node ranges unchanged. When
it changes a media URI, the same structural asset ID receives different
immutable content and the later evidence writer must return a visible conflict.
Link sidecars are not claimed as committed data in revision 1.

## Stable local keys and persistent IDs

Parse-stage keys use this complete ASCII grammar. Every decimal ordinal is
canonical base 10 with no leading zero except the value `0` itself.

| Value              | Exact local-key form                    |
| ------------------ | --------------------------------------- |
| root node          | `n/0`                                   |
| child node         | `<parent-node-key>/<sibling-ordinal>`   |
| Fragment           | `f/<node-key>`                          |
| ordinary link      | `l/<enclosing-node-key>/<link-ordinal>` |
| image reference    | `m/<image-node-key>/0`                  |
| deduplicated asset | `a/<first-seen-resolved-URI-ordinal>`   |
| image usage        | `u/<image-node-key>/0`                  |

The first-seen asset ordinal is zero-based over distinct successfully resolved
URIs. Keys contain no source prose, heading label, displayed item number, URI,
or digest. Equal owned bytes, raw identity, base URI, profile, and versions
produce byte-for-byte equal keys and arrays.

Materialization accepts no caller-provided Blob, structure, node, Fragment,
asset, or usage ID. It derives RFC 9562 UUID version 5 values in this order:

1. the normalized text Blob ID uses `workspaceId` as namespace and the exact
   UTF-8 name `struinfo:evidence-blob:v1:sha256:<normalized-digest>`; the same
   rule is required for the input raw Blob ID;
2. the structure ID uses `snapshotId` as namespace and the exact UTF-8 name
   `struinfo:document-structure:v1:<parser-name>:<parser-version>:<normalization-version>:<structure-digest>`;
3. every remaining entity uses that derived structure ID as namespace and one
   of these exact UTF-8 names:

```text
struinfo:document-node:v1:<node-local-key>
struinfo:fragment:v1:<fragment-local-key>
struinfo:media-asset:v1:<media-asset-local-key>
struinfo:media-usage:v1:<media-usage-local-key>
```

The implementation uses Node's cryptographic primitive directly and does not
copy third-party UUID code. The version and variant bits follow RFC 9562. IDs
are identity keys, not authorization boundaries. Revision 1 omits `mediaType`
from both raw and normalized `EvidenceBlobInput` rows in this capture path;
source media type remains Snapshot metadata, so equal raw and normalized bytes
can share one digest-unique Blob row without an immutable metadata conflict.
Repeated visible text or URIs at different occurrence paths do not collapse
nodes, Fragments, or usages. A different command key for the same logical parse
derives the same full entity graph, so it can resolve equal natural rows instead
of colliding with a new caller-selected ID.

The required known-answer vector uses workspace
`00000000-0000-0000-0000-000000000001`, Snapshot
`00000000-0000-0000-0000-000000000002`, normalized digest 64 lowercase `b`
characters, byte length `7`, structure digest 64 lowercase `a` characters,
generic parser identity, and the keys shown below:

| Derived value        | Required UUID                          |
| -------------------- | -------------------------------------- |
| normalized text Blob | `19e7290a-332e-5f8e-af0d-fbb8f608a4f0` |
| document structure   | `32eb3cce-4a45-507e-972c-1094676afe9e` |
| node `n/0`           | `68ac02ca-3d54-54ec-a580-780c78bacd98` |
| node `n/0/0`         | `3de7ce3d-2524-578b-b801-d31e015792d9` |
| Fragment `f/n/0/0`   | `2526b3aa-8e94-5d16-9356-5d713e97b9f6` |

## Canonical structure hash

`structureSha256` is recomputed; a caller-provided digest is never trusted.
The hash is SHA-256 over the repository's canonical JSON encoding of exactly
this ID-independent projection, using the shown property names and scalar
representations:

```ts
{
  projection: 'markdown-structure-v1',
  parser: {name: parserName, version: parserVersion},
  text: {
    normalizationVersion: textNormalizationVersion,
    sha256: normalizedTextSha256,
    byteLength: normalizedTextByteLength,
  },
  nodes: nodesInCanonicalPreorder.map((node) => ({
    path: reconstructedNodePath,
    parentPath: reconstructedParentPathOrNull,
    kind: node.kind,
    siblingOrdinal: node.siblingOrdinal,
    codePointStart: node.codePointRange.start,
    codePointEnd: node.codePointRange.end,
    lineStart: node.lineRange.start,
    lineEnd: node.lineRange.end,
  })),
  fragments: fragmentsInCanonicalOrder.map((fragment) => ({
    nodePath: reconstructedNodePath,
    locatorKind: 'unicode_code_point_range',
    locatorVersion: 1,
    codePointStart: fragment.codePointRange.start,
    codePointEnd: fragment.codePointRange.end,
    lineStart: fragment.lineRange.start,
    lineEnd: fragment.lineRange.end,
    selectedTextSha256: fragment.selectedTextSha256,
  })),
}
```

`reconstructedNodePath` is derived only from the one root, parent relations,
and dense sibling ordinals using the local node-path grammar. It is not read
from a caller-provided key or decoded from a UUID. Parser-local Fragment keys
and roles are intentionally absent because evidence DTOs do not persist them.

The projection excludes workspace/resource/snapshot/structure/blob/entity UUIDs,
command keys, timestamps, input property order, locale, and source prose outside
the normalized text digest. Link sidecars, diagnostics, MediaAssets, and
MediaUsages are not document-structure rows and therefore are not included.

The materializer and `validateEvidenceCapture` use the same exported projection
function for the two fixed revision-1 parser names. Before hashing, it enforces
one root, canonical pre-order, dense ordinals, parent containment, non-crossing
sibling ranges, ID derivation from reconstructed paths, exact Fragment-to-node
binding, and canonical Fragment order. A future parser identity owns a new
contract and is not silently forced through this Markdown projection. A
supplied or persisted structure digest that does not match the recomputed value
fails with `structure_hash_mismatch`. The projection is limited to 16 MiB and
the canonical JSON encoder's 100,000 visited values before hashing.

## Resource budgets

The unchanged parser/output revision exports, documents, and tests these
inclusive constants:

| Budget                    |      Limit |
| ------------------------- | ---------: |
| Captured source bytes     |  1,048,576 |
| Mapped nodes              |      2,500 |
| Fragments                 |      2,000 |
| Structural depth          |         64 |
| Discovered links          |     10,000 |
| Media usages              |      1,000 |
| Diagnostics               |     10,000 |
| Canonical structure bytes | 16,777,216 |
| Canonical JSON values     |    100,000 |

Structural depth is the number of parent edges from the document root: the root
has depth 0, a direct child has depth 1, and every additional parent edge adds
one. Synthetic section nodes and image nodes count like all other mapped nodes.
The deepest emitted node must have depth no greater than 64.

The source-byte limit is checked before copying, decoding, or invoking the
CommonMark dependency. It also bounds a single line, label, target, alt value,
or fence; the parser/output revision does not add redundant token-length knobs.
The admitted `mdast-util-from-markdown@2.0.3` public API synchronously buffers
the complete micromark-event/MDAST result. It exposes no supported signal,
abort, event limit, node limit, or streaming compiler callback. This contract
therefore bounds that upstream allocation by the fixed inclusive source-byte
limit; the implementation does not use package-private interfaces, duplicate
the compiler, or silently change CommonMark semantics.

Depth through diagnostic limits are reachable StruInfo product-graph limits.
After the dependency returns, one deterministic preflight traverses the
complete public MDAST, saturates each count at its inclusive limit plus one,
and retains at most the node limit plus one lightweight preorder records. It
evaluates every reachable budget in the required priority before allocating a
complete `NodeDraft`, Fragment, link, media, or diagnostic product graph. A
passing mapping is checked against the preflight counts so count-model drift
cannot silently change accepted output. These budgets receive at-limit and
over-limit tests. The lower Fragment limit allows its over-limit case to remain
below the node limit.

The last two rows are downstream defensive ceilings, not separate reachable
Markdown quotas: the exact projection with 2,500 nodes and 2,000 Fragments
visits 40,511 canonical JSON values, and its maximum bounded field
representation remains below 16 MiB. TM1 proves those strict inequalities for
a maximum legal projection; it does not manufacture an otherwise illegal
Markdown result solely to reach either encoder ceiling. Every failure rejects
the whole parse without returning a persistable partial result. Callers cannot
raise limits per request.

If one request violates more than one limit, the single reported budget uses
this priority: `source_bytes`, `depth`, `nodes`, `fragments`, `links`, `media`,
`diagnostics`, `canonical_structure_bytes`, then `canonical_json_values`.

Wall-clock timing is not a deterministic correctness assertion. TM1 proves the
pre-dependency source-byte check, bounded StruInfo preflight, saturated ledger,
reachable budget priority, and canonical output limits. It does not claim a
tight peak-heap ceiling inside the admitted dependency for an at-limit source.
Process/worker cancellation and stronger runtime isolation remain later
runtime-admission concerns; a timing-only test is never the sole
resource-safety proof.

## Results and errors

Both stages return tagged results and convert dependency exceptions into stable
issues. Rejections contain `code`, the safe contract path below, and exactly the
specified numeric range or exceeded-budget field; all other optional fields are
omitted.

Revision 1 codes are:

- `invalid_shape`;
- `invalid_source_identity`;
- `invalid_utf8`;
- `invalid_text`;
- `empty_document`;
- `limit_exceeded`;
- `invalid_source_position`;
- `invalid_tree`;
- `invalid_fragment`;
- `invalid_base_uri`;
- `invalid_media_reference`;
- `unsafe_media_scheme`;
- `parsed_result_mismatch`;
- `structure_hash_mismatch`; and
- `internal_parser_failure`.

Issue paths use the literal root `$` followed only by the dot-property names
shown below; revision 1 never places input values in a path. Field presence is
exact, not "when useful":

| Code                      | Required path       | `range`                         | `budget` |
| ------------------------- | ------------------- | ------------------------------- | -------- |
| `invalid_shape`           | `$`                 | omitted                         | omitted  |
| `invalid_source_identity` | `$`                 | omitted                         | omitted  |
| `invalid_utf8`            | `$.sourceUtf8`      | omitted                         | omitted  |
| `invalid_text`            | `$.sourceUtf8`      | omitted                         | omitted  |
| `empty_document`          | `$.sourceUtf8`      | omitted                         | omitted  |
| `limit_exceeded`          | budget map below    | omitted                         | required |
| `invalid_source_position` | `$.sourceUtf8`      | omitted                         | omitted  |
| `invalid_tree`            | `$.nodes`           | omitted                         | omitted  |
| `invalid_fragment`        | `$.fragments`       | omitted                         | omitted  |
| `invalid_base_uri`        | `$.documentBaseUri` | omitted                         | omitted  |
| `invalid_media_reference` | `$.sourceUtf8`      | exact image occurrence required | omitted  |
| `unsafe_media_scheme`     | `$.sourceUtf8`      | exact image occurrence required | omitted  |
| `parsed_result_mismatch`  | `$`                 | omitted                         | omitted  |
| `structure_hash_mismatch` | `$.structureSha256` | omitted                         | omitted  |
| `internal_parser_failure` | `$.sourceUtf8`      | omitted                         | omitted  |

`limit_exceeded` uses this total budget-to-path map:

| Budget                      | Required path       |
| --------------------------- | ------------------- |
| `source_bytes`              | `$.sourceUtf8`      |
| `nodes`, `depth`            | `$.nodes`           |
| `fragments`                 | `$.fragments`       |
| `links`                     | `$.links`           |
| `media`                     | `$.media`           |
| `diagnostics`               | `$.diagnostics`     |
| `canonical_structure_bytes` | `$.structureSha256` |
| `canonical_json_values`     | `$.structureSha256` |

If dependency parsing throws without one of the deterministic conditions above,
the adapter returns `internal_parser_failure`; it does not expose an exception
name, message, stack, source excerpt, or dependency object.

Diagnostics are complete and deterministic: each block HTML AST node emits one
`opaque_html_block`, each inline HTML AST node emits one `inline_html`, and each
link-definition AST node emits one `link_definition_block`. They use the AST
node's exact converted range, are ordered by start, end, then code, and are not
deduplicated. They are bounded metadata, not partial failures.

MDX, frontmatter, math, directives, custom plugins, and GFM semantics are not
enabled. Revision 1 does not attempt to detect extension-looking source or emit
an unsupported-feature error: all bytes are parsed strictly as CommonMark.
Thus pipe tables, task markers, bare-URL autolinks, strikethrough, and footnote
syntax remain exact source text but are not represented as GFM structural
kinds, and no code path executes embedded syntax.

## TM1 acceptance boundary

The implementation candidate must pass all of these groups with synthetic,
value-free fixtures:

1. strict UTF-8, BOM/CRLF normalization, raw-versus-normalized identity, empty
   input, NUL, deterministic raw-Blob ID, wrong-byte/Snapshot binding, and exact
   inclusive budget boundaries;
2. Chinese, Emoji, combining characters, NFC/NFD distinction, UTF-16 boundary
   conversion, half-open code-point ranges, and one-based inclusive line ranges;
3. headings and skipped ranks, paragraphs, quotes, ordered/unordered and nested
   lists, fenced/indented/unclosed code, links, images, definitions, opaque HTML,
   inline HTML, extension-looking CommonMark text, malformed link text, escapes,
   every link-resolution reason, WHATWG base resolution, image fail-closed
   behavior, image-parent ordinals, allowed ancestor Fragment overlap, and
   repeated equal source content;
4. weekly numbered containers, internal main-text numbering, missing/repeated
   numbers, unnumbered containers, multi-line Setext and reference-link heading
   labels, cover purpose, and navigation exclusion;
5. exact local-key grammar, the UUID known-answer vector, canonical ordering,
   ID-independent structure-hash recomputation from both parse and evidence DTOs,
   raw-byte reparse rejection of an internally consistent forged parse result,
   equal replay under a different command key, changed conflict, base-URI media
   conflict, and cross-context isolation;
6. unknown/accessor/symbol/inherited fields, Proxy and prototype abuse, sparse
   arrays, shared/partial/resizable/detached byte views, defensive copying, and
   post-parse and post-materialization byte mutation, deep result freezing, and
   the exact code/path/range/budget matrix with non-echoing errors;
7. poisoned AI, network, filesystem, clock, and randomness capabilities proving
   that parsing has no such dependency;
8. at-limit/over-limit source, node, depth, link, media, diagnostic, and Fragment
   budgets; the source limit before dependency invocation; a deterministic
   saturated preflight that bounds StruInfo product-graph allocation and
   preserves combined-limit priority; a maximum legal projection strictly
   below both downstream canonical encoder ceilings; and no partial persistable
   output on any failure; and
9. format, lint, strict type checking, focused tests, full unit/integration
   tests, build, dependency/notice/SBOM review, and candidate-artifact audit.

Tracked fixtures must be independently written synthetic Markdown using reserved
hosts such as `example.invalid`. They contain no weekly prose, Stage 0 derived
output, personal knowledge, preference, machine path, credential, fetched media,
or real snapshot. The formal implementation must not read `.agents/stage-0`.

TM1 can establish only the deterministic Markdown pure transformation and closed
materialization boundary. It does not establish real PostgreSQL parsing,
catalog constraints, transactions, concurrency, runtime grants, Blob/database
failure recovery, container parity, browser behavior, real weekly import, or
completion of roadmap stage 1. Those claims remain behind their named gates.

## Explicitly deferred

- persisted and queryable secondary-link entities;
- GFM tables, task-list semantics, autolink literals, strikethrough, and
  footnotes;
- YAML/TOML frontmatter, MDX, JSX, math, Mermaid, directives, admonitions,
  wiki links, and user-defined syntax extensions;
- HTML DOM parsing, sanitization, rendering, media extraction, or execution;
- raw-byte-to-normalized-code-point locator mapping;
- image fetching, media sniffing, decoding, dimensions, OCR, and storage
  authorization;
- `ContentClassification`, `IntakeDecision`, `Assessment`, preference learning,
  AI proposals, formal knowledge, retrieval, HTTP, WebSocket, and frontend work;
- PostgreSQL repository writes and every deferred TM2/container/browser gate.
