import {createHash} from 'node:crypto';
import {TextDecoder, TextEncoder} from 'node:util';

import {describe, expect, it, vi} from 'vitest';

import type {
  CaptureEvidenceInput,
  EvidenceBlobInput,
  SnapshotInput,
} from '../evidence_contract.js';
import {validateEvidenceCapture} from '../evidence_validation.js';
import {
  MARKDOWN_BUDGETS,
  MARKDOWN_TEXT_NORMALIZATION_VERSION,
  computeMarkdownStructureSha256,
  deriveDocumentNodeId,
  deriveDocumentStructureId,
  deriveEvidenceBlobId,
  deriveFragmentId,
  materializeMarkdownEvidence,
  parseMarkdownStructure,
  type MaterializedMarkdownEvidence,
  type ParsedMarkdownDocument,
} from './index.js';
import {deriveLineRange} from './markdown_projection.js';
import {
  BoundedPreorderLedger,
  SaturatingBudgetCounter,
} from './markdown_budget_ledger.js';

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const SNAPSHOT_ID = '00000000-0000-0000-0000-000000000002';
const RESOURCE_ID = '00000000-0000-0000-0000-000000000003';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Mutable<Value> = Value extends Uint8Array
  ? Uint8Array
  : Value extends readonly (infer Item)[]
    ? Mutable<Item>[]
    : Value extends object
      ? {-readonly [Key in keyof Value]: Mutable<Value[Key]>}
      : Value;

describe('deterministic Markdown parsing', () => {
  it('normalizes one BOM plus CRLF and CR while preserving all other text', () => {
    const source = Uint8Array.from([
      0xef,
      0xbb,
      0xbf,
      ...encoder.encode('A\r\n甲😀\rB\n'),
    ]);
    const parsed = parseValue(source);

    expect(decoder.decode(parsed.normalizedTextUtf8)).toBe('A\n甲😀\nB\n');
    expect(parsed.normalizedTextByteLength).toBe(
      encoder.encode('A\n甲😀\nB\n').byteLength,
    );
    expect(parsed.normalizedTextSha256).toBe(sha256('A\n甲😀\nB\n'));
    expect(parsed.rawBlob.digest).toBe(sha256Bytes(source));
    expect(parsed.rawBlob.digest).not.toBe(parsed.normalizedTextSha256);
  });

  it('removes exactly one leading BOM through parse and materialization', () => {
    const source = Uint8Array.from([
      0xef,
      0xbb,
      0xbf,
      0xef,
      0xbb,
      0xbf,
      ...encoder.encode('Synthetic'),
    ]);
    const expected = encoder.encode('\uFEFFSynthetic');
    const parsed = parseValue(source);
    const materialized = materializeValue(parsed, source);

    expect(parsed.normalizedTextUtf8).toEqual(expected);
    expect(materialized.structure.normalizedTextUtf8).toEqual(expected);
    expect(
      validateEvidenceCapture(captureFor(parsed, materialized)).status,
    ).toBe('validated');
  });

  it.each([
    {
      name: 'invalid UTF-8',
      bytes: Uint8Array.from([0xc3, 0x28]),
      code: 'invalid_utf8',
    },
    {
      name: 'retained NUL',
      bytes: encoder.encode('A\u0000B'),
      code: 'invalid_text',
    },
    {
      name: 'empty bytes',
      bytes: new Uint8Array(),
      code: 'empty_document',
    },
    {
      name: 'whitespace only',
      bytes: encoder.encode(' \n\t'),
      code: 'empty_document',
    },
  ])('rejects $name without a partial result', ({bytes, code}) => {
    expect(parseCandidate(bytes)).toEqual({
      status: 'rejected',
      issue: {code, path: '$.sourceUtf8'},
    });
  });

  it('binds source bytes to the exact deterministic raw Blob identity', () => {
    const input = createParseInput('Synthetic');
    const wrongDigest = structuredClone(input);
    wrongDigest.rawBlob.digest = 'a'.repeat(64);
    expect(parseMarkdownStructure(wrongDigest)).toEqual({
      status: 'rejected',
      issue: {code: 'invalid_source_identity', path: '$'},
    });

    const wrongId = structuredClone(input);
    wrongId.rawBlob.blobId = '00000000-0000-0000-0000-000000000099';
    expect(parseMarkdownStructure(wrongId)).toEqual({
      status: 'rejected',
      issue: {code: 'invalid_source_identity', path: '$'},
    });
  });

  it.each([
    'relative/base.md',
    'file:///synthetic/base.md',
    'https://u:p@example.invalid/base.md',
    'https://example.invalid/base.md#part',
  ])('rejects invalid document base URI context: %s', (documentBaseUri) => {
    expect(parseCandidate('Synthetic', {documentBaseUri})).toEqual({
      status: 'rejected',
      issue: {code: 'invalid_base_uri', path: '$.documentBaseUri'},
    });
  });

  it('stores the canonical WHATWG href for a valid base URI', () => {
    expect(
      parseValue('Synthetic', {
        documentBaseUri: 'https://EXAMPLE.invalid:443/a/../base.md',
      }).documentBaseUri,
    ).toBe('https://example.invalid/base.md');
  });

  it('uses Unicode code points and one-based inclusive LF line ranges', () => {
    const parsed = parseValue('甲😀e\u0301\n乙');
    const root = parsed.nodes[0];
    const paragraph = parsed.nodes[1];

    expect(root?.codePointRange).toEqual({start: 0, end: 6});
    expect(root?.lineRange).toEqual({start: 1, end: 2});
    expect(paragraph?.codePointRange).toEqual({start: 0, end: 6});
    expect(paragraph?.lineRange).toEqual({start: 1, end: 2});
    expect(parsed.fragments[0]?.selectedTextSha256).toBe(
      sha256('甲😀e\u0301\n乙'),
    );
  });

  it.each([
    {start: 0, end: 1, expected: {start: 1, end: 1}},
    {start: 0, end: 2, expected: {start: 1, end: 1}},
    {start: 0, end: 3, expected: {start: 1, end: 2}},
    {start: 2, end: 3, expected: {start: 2, end: 2}},
  ])(
    'derives A\\nB range [$start,$end) as inclusive lines',
    ({start, end, expected}) => {
      expect(deriveLineRange(Array.from('A\nB'), start, end)).toEqual(expected);
    },
  );

  it('counts only LF as a line terminator in CRLF-shaped text', () => {
    expect(deriveLineRange(Array.from('A\r\nB'), 0, 3)).toEqual({
      start: 1,
      end: 1,
    });
    expect(deriveLineRange(Array.from('A\r\nB'), 3, 4)).toEqual({
      start: 2,
      end: 2,
    });
  });

  it('keeps late ranges exact after a large prefix with many ranged entities', () => {
    const prefixLineCount = 50_000;
    const occurrenceCount = 750;
    const prefix = `\`\`\`\n${'x\n'.repeat(prefixLineCount)}\`\`\`\n\n`;
    const tail = Array.from(
      {length: occurrenceCount},
      (_, index) =>
        `Synthetic [link](https://example.invalid/${String(index)}) <x>`,
    ).join('\n\n');
    const source = `${prefix}${tail}`;
    const sourceUtf8 = encoder.encode(source);
    const parsed = parseValue(sourceUtf8);
    const expectedLastLine = prefixLineCount + 4 + (occurrenceCount - 1) * 2;

    expect(parsed.nodes).toHaveLength(occurrenceCount + 2);
    expect(parsed.fragments).toHaveLength(occurrenceCount + 2);
    expect(parsed.links).toHaveLength(occurrenceCount);
    expect(parsed.diagnostics).toHaveLength(occurrenceCount);
    expect(parsed.nodes.at(-1)?.lineRange).toEqual({
      start: expectedLastLine,
      end: expectedLastLine,
    });
    expect(parsed.links.at(-1)?.lineRange).toEqual({
      start: expectedLastLine,
      end: expectedLastLine,
    });
    expect(parsed.diagnostics.at(-1)?.lineRange).toEqual({
      start: expectedLastLine,
      end: expectedLastLine,
    });

    const materialized = materializeValue(parsed, sourceUtf8);
    expect(
      validateEvidenceCapture(captureFor(parsed, materialized)).status,
    ).toBe('validated');
  });

  it('does not normalize canonically equivalent Unicode sequences', () => {
    const composed = parseValue('é');
    const decomposed = parseValue('e\u0301');
    expect(composed.normalizedTextSha256).not.toBe(
      decomposed.normalizedTextSha256,
    );
  });

  it('maps document-flow headings into sections and preserves skipped ranks', () => {
    const parsed = parseValue(
      '# Top\n\n### Deep\n\nBody\n\n## Peer\n\n> ### Nested\n',
    );
    expect(
      parsed.nodes.map(({localKey, parentLocalKey, kind}) => ({
        localKey,
        parentLocalKey,
        kind,
      })),
    ).toEqual([
      {localKey: 'n/0', parentLocalKey: undefined, kind: 'document'},
      {localKey: 'n/0/0', parentLocalKey: 'n/0', kind: 'section'},
      {localKey: 'n/0/0/0', parentLocalKey: 'n/0/0', kind: 'heading'},
      {localKey: 'n/0/0/1', parentLocalKey: 'n/0/0', kind: 'section'},
      {localKey: 'n/0/0/1/0', parentLocalKey: 'n/0/0/1', kind: 'heading'},
      {localKey: 'n/0/0/1/1', parentLocalKey: 'n/0/0/1', kind: 'paragraph'},
      {localKey: 'n/0/0/2', parentLocalKey: 'n/0/0', kind: 'section'},
      {localKey: 'n/0/0/2/0', parentLocalKey: 'n/0/0/2', kind: 'heading'},
      {localKey: 'n/0/0/2/1', parentLocalKey: 'n/0/0/2', kind: 'blockquote'},
      {localKey: 'n/0/0/2/1/0', parentLocalKey: 'n/0/0/2/1', kind: 'heading'},
    ]);
  });

  it('maps CommonMark blocks, opaque HTML, definitions, and inline HTML', () => {
    const parsed = parseValue(
      'Paragraph <span>x</span>\n\n> Quote\n\n- A\n  - B\n\n```txt\ncode\n```\n\n---\n\n<div>x</div>\n\n[key]: https://example.invalid/value\n',
    );
    expect(parsed.nodes.map((node) => node.kind)).toEqual([
      'document',
      'paragraph',
      'blockquote',
      'paragraph',
      'list',
      'list_item',
      'paragraph',
      'list',
      'list_item',
      'paragraph',
      'code_block',
      'thematic_break',
      'paragraph',
      'paragraph',
    ]);
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'inline_html',
      'inline_html',
      'opaque_html_block',
      'link_definition_block',
    ]);
  });

  it('keeps extension-looking CommonMark source without GFM structure', () => {
    const parsed = parseValue(
      '| A | B |\n| - | - |\n| x | y |\n\n- [x] task\n',
    );
    expect(parsed.nodes.some((node) => node.kind === 'table')).toBe(false);
    expect(parsed.nodes.map((node) => node.kind)).toContain('paragraph');
  });

  it('treats an unclosed fence as a code block through EOF', () => {
    const parsed = parseValue('```txt\nsynthetic');
    expect(parsed.nodes.at(-1)?.kind).toBe('code_block');
    expect(parsed.nodes.at(-1)?.codePointRange.end).toBe(
      Array.from('```txt\nsynthetic').length,
    );
  });

  it('emits document and exact leaf Fragments but no container-only Fragment', () => {
    const parsed = parseValue('> - Synthetic\n');
    const kindsByKey = new Map(
      parsed.nodes.map((node) => [node.localKey, node.kind]),
    );
    expect(
      parsed.fragments.map((fragment) => kindsByKey.get(fragment.nodeLocalKey)),
    ).toEqual(['document', 'paragraph']);
    expect(
      parsed.fragments.every(
        (fragment) => fragment.localKey === `f/${fragment.nodeLocalKey}`,
      ),
    ).toBe(true);
  });
});

describe('ruanyf-weekly-v1 deterministic profile', () => {
  it('creates occurrence-identity entry sections for numbered containers', () => {
    const parsed = parseValue(
      '# Synthetic\n\n## 文章\n\n1、 First\n\n3、 Third\n\n3、 Repeated\n',
      {profile: 'ruanyf-weekly-v1'},
    );
    expect(parsed.intakeTargetNodeKeys).toHaveLength(3);
    expect(
      parsed.intakeTargetNodeKeys.map(
        (key) => parsed.nodes.find((node) => node.localKey === key)?.kind,
      ),
    ).toEqual(['section', 'section', 'section']);
    expect(
      parsed.fragments.filter((fragment) => fragment.role === 'intake_target'),
    ).toHaveLength(3);
  });

  it('does not promote nested or non-initial number-like text', () => {
    const parsed = parseValue(
      '# Synthetic\n\n## 文章\n\nIntro\n2、 second line\n\n> 1、 quoted\n\n- 2、 listed\n',
      {profile: 'ruanyf-weekly-v1'},
    );
    expect(parsed.intakeTargetNodeKeys).toHaveLength(1);
    const target = parsed.nodes.find(
      (node) => node.localKey === parsed.intakeTargetNodeKeys[0],
    );
    expect(target?.codePointRange.start).toBe(
      Array.from('# Synthetic\n\n').length,
    );
  });

  it('keeps an unnumbered container as one intake target', () => {
    const parsed = parseValue('# S\n\n## 工具\n\nNo marker\n', {
      profile: 'ruanyf-weekly-v1',
    });
    expect(parsed.intakeTargetNodeKeys).toHaveLength(1);
  });

  it('marks cover media and excludes historical navigation', () => {
    const parsed = parseValue(
      '# S\n\n## 封面图\n\n![cover](https://example.invalid/cover.png)\n\n## 往年回顾\n\nArchive\n',
      {profile: 'ruanyf-weekly-v1'},
    );
    expect(parsed.media).toHaveLength(1);
    expect(parsed.media[0]).toMatchObject({
      purpose: 'cover',
      purposeOrigin: 'deterministic_parser',
    });
    expect(parsed.intakeTargetNodeKeys).toHaveLength(1);
  });

  it('matches heading labels through emphasis, inline code, and references', () => {
    const parsed = parseValue(
      '# S\n\n文章\n----\n\n1、 Setext\n\n## **工**具\n\n1、 Strong\n\n## [图][label]片\n\n1、 Reference\n\n[label]: https://example.invalid/value\n',
      {profile: 'ruanyf-weekly-v1'},
    );
    expect(parsed.intakeTargetNodeKeys).toHaveLength(3);
  });
});

describe('Markdown link and media sidecars', () => {
  it('records every link resolution outcome without capturing a Resource', () => {
    const parsed = parseValue(
      '[fragment](#part) [relative](item) [scheme](mailto:a@example.invalid) [credentials](https://u:p@example.invalid/x) [valid](https://example.invalid/x)\n',
    );
    expect(parsed.links.map((link) => link.resolution)).toEqual([
      {status: 'not_resolved', reason: 'document_fragment'},
      {status: 'not_resolved', reason: 'relative_without_base'},
      {status: 'not_resolved', reason: 'unsupported_scheme'},
      {status: 'not_resolved', reason: 'credentials_not_allowed'},
      {status: 'resolved', uri: 'https://example.invalid/x'},
    ]);
    expect(parsed.links.map((link) => link.captureState)).toEqual([
      'not_captured',
      'not_captured',
      'not_captured',
      'not_captured',
      'not_captured',
    ]);
  });

  it('resolves relative links and images against the canonical WHATWG base', () => {
    const parsed = parseValue('[link](../item) ![image](media.png)', {
      documentBaseUri: 'https://example.invalid/base/doc.md',
    });
    expect(parsed.documentBaseUri).toBe('https://example.invalid/base/doc.md');
    expect(parsed.links[0]?.resolution).toEqual({
      status: 'resolved',
      uri: 'https://example.invalid/item',
    });
    expect(parsed.media[0]?.resolvedUri).toBe(
      'https://example.invalid/base/media.png',
    );
  });

  it.each([
    {
      source: '![x](relative.png)',
      code: 'invalid_media_reference',
    },
    {source: '![x](#fragment)', code: 'invalid_media_reference'},
    {source: '![x](data:text/plain,x)', code: 'unsafe_media_scheme'},
    {
      source: '![x](https://u:p@example.invalid/x)',
      code: 'unsafe_media_scheme',
    },
    {source: String.raw`![x](S:\synthetic\x.png)`, code: 'unsafe_media_scheme'},
  ])('fails the whole parse for unsafe media $source', ({source, code}) => {
    const result = parseCandidate(source);
    expect(result).toMatchObject({
      status: 'rejected',
      issue: {code, path: '$.sourceUtf8'},
    });
    if (result.status === 'rejected') {
      expect(result.issue.range).toBeDefined();
    }
  });

  it('resolves reference links and images while retaining definition diagnostics', () => {
    const parsed = parseValue(
      '[link][ref] ![image][media]\n\n[ref]: https://example.invalid/link\n[media]: https://example.invalid/image.png\n',
    );
    expect(parsed.links[0]?.resolution).toEqual({
      status: 'resolved',
      uri: 'https://example.invalid/link',
    });
    expect(parsed.media[0]?.resolvedUri).toBe(
      'https://example.invalid/image.png',
    );
    expect(
      parsed.diagnostics.filter(
        (diagnostic) => diagnostic.code === 'link_definition_block',
      ),
    ).toHaveLength(2);
  });

  it('gives image children dense ordinals unaffected by inline constructs', () => {
    const parsed = parseValue(
      'text *em* ![one](https://example.invalid/one.png) [link](https://example.invalid/x) ![two](https://example.invalid/two.png)',
    );
    const imageNodes = parsed.nodes.filter((node) => node.kind === 'image');
    expect(imageNodes.map((node) => node.siblingOrdinal)).toEqual([0, 1]);
    expect(imageNodes[0]?.parentLocalKey).toBe(imageNodes[1]?.parentLocalKey);
  });
});

describe('Markdown materialization and stable identities', () => {
  it('matches every RFC 9562 UUIDv5 known-answer vector', () => {
    const blobId = deriveEvidenceBlobId(WORKSPACE_ID, 'b'.repeat(64));
    const structureId = deriveDocumentStructureId(
      SNAPSHOT_ID,
      'struinfo-commonmark',
      '1',
      'utf8-lf-v1',
      'a'.repeat(64),
    );
    expect(blobId).toBe('19e7290a-332e-5f8e-af0d-fbb8f608a4f0');
    expect(structureId).toBe('32eb3cce-4a45-507e-972c-1094676afe9e');
    expect(deriveDocumentNodeId(structureId, 'n/0')).toBe(
      '68ac02ca-3d54-54ec-a580-780c78bacd98',
    );
    expect(deriveDocumentNodeId(structureId, 'n/0/0')).toBe(
      '3de7ce3d-2524-578b-b801-d31e015792d9',
    );
    expect(deriveFragmentId(structureId, 'f/n/0/0')).toBe(
      '2526b3aa-8e94-5d16-9356-5d713e97b9f6',
    );
  });

  it('materializes normalized evidence, deduplicated assets, and occurrence usages', () => {
    const source =
      '![one](https://example.invalid/media.png) ![two](https://example.invalid/media.png)';
    const parsed = parseValue(source);
    const materialized = materializeValue(parsed, encoder.encode(source));

    expect(materialized.textBlob).toEqual({
      workspaceId: WORKSPACE_ID,
      blobId: deriveEvidenceBlobId(WORKSPACE_ID, parsed.normalizedTextSha256),
      digestAlgorithm: 'sha256',
      digest: parsed.normalizedTextSha256,
      byteLength: parsed.normalizedTextByteLength,
    });
    expect(materialized.textBlob.blobId).toBe(parsed.rawBlob.blobId);
    expect(materialized.structure.nodes).toHaveLength(parsed.nodes.length);
    expect(materialized.structure.fragments).toHaveLength(
      parsed.fragments.length,
    );
    expect(materialized.mediaAssets).toHaveLength(1);
    expect(materialized.mediaUsages).toHaveLength(2);
    expect(materialized.mediaUsages[0]?.mediaAssetId).toBe(
      materialized.mediaUsages[1]?.mediaAssetId,
    );
    expect(materialized.mediaUsages.map((usage) => usage.ordinal)).toEqual([
      0, 0,
    ]);
  });

  it('returns byte-for-byte equal IDs for repeated materialization', () => {
    const source = '# Synthetic\n\nParagraph\n';
    const parsed = parseValue(source);
    const first = materializeValue(parsed, encoder.encode(source));
    const second = materializeValue(parsed, encoder.encode(source));
    expect(first.structure.structureId).toBe(second.structure.structureId);
    expect(first.structure.nodes).toEqual(second.structure.nodes);
    expect(first.structure.fragments).toEqual(second.structure.fragments);
    expect(first.structure.normalizedTextUtf8).not.toBe(
      second.structure.normalizedTextUtf8,
    );
  });

  it('binds Snapshot raw and canonical identities before materializing', () => {
    const source = 'A\r\nB';
    const bytes = encoder.encode(source);
    const parsed = parseValue(bytes);
    const snapshot = snapshotFor(parsed);
    const wrongRaw = structuredClone(snapshot) as Mutable<SnapshotInput>;
    wrongRaw.rawSha256 = 'a'.repeat(64);
    expect(
      materializeMarkdownEvidence({
        parsed,
        snapshot: wrongRaw,
        mediaPolicy: 'external_reference_only',
        sourceUtf8: bytes,
      }),
    ).toEqual({
      status: 'rejected',
      issue: {code: 'invalid_source_identity', path: '$'},
    });

    const wrongCanonical = structuredClone(snapshot) as Mutable<SnapshotInput>;
    wrongCanonical.canonicalContentSha256 = 'b'.repeat(64);
    expect(
      materializeMarkdownEvidence({
        parsed,
        snapshot: wrongCanonical,
        mediaPolicy: 'external_reference_only',
        sourceUtf8: bytes,
      }),
    ).toEqual({
      status: 'rejected',
      issue: {code: 'invalid_source_identity', path: '$'},
    });
  });

  it('rejects an unknown supplied profile before replaying raw bytes', () => {
    const source = 'Synthetic';
    const parsed = structuredClone(
      parseValue(source),
    ) as Mutable<ParsedMarkdownDocument>;
    (parsed as unknown as {profile: string}).profile = 'unknown-profile';
    (parsed as unknown as {parserName: string}).parserName =
      'struinfo-commonmark/ruanyf-weekly';

    expect(materializeCandidate(parsed, encoder.encode(source))).toEqual({
      status: 'rejected',
      issue: {code: 'parsed_result_mismatch', path: '$'},
    });
  });

  it('rejects a changed structure digest before replay comparison', () => {
    const source = '# Synthetic\n';
    const parsed = structuredClone(
      parseValue(source),
    ) as Mutable<ParsedMarkdownDocument>;
    parsed.structureSha256 = 'a'.repeat(64);
    expect(materializeCandidate(parsed, encoder.encode(source))).toEqual({
      status: 'rejected',
      issue: {code: 'structure_hash_mismatch', path: '$.structureSha256'},
    });
  });

  it('rejects an invalid tree before structure digest comparison', () => {
    const source = '# Synthetic\n';
    const parsed = structuredClone(
      parseValue(source),
    ) as Mutable<ParsedMarkdownDocument>;
    const child = parsed.nodes[1];
    if (child === undefined) {
      throw new Error('Synthetic parse did not create a child.');
    }
    child.parentLocalKey = 'n/missing';
    parsed.structureSha256 = 'a'.repeat(64);
    expect(materializeCandidate(parsed, encoder.encode(source))).toEqual({
      status: 'rejected',
      issue: {code: 'invalid_tree', path: '$.nodes'},
    });
  });

  it('rejects an invalid Fragment before structure digest comparison', () => {
    const source = '# Synthetic\n';
    const parsed = structuredClone(
      parseValue(source),
    ) as Mutable<ParsedMarkdownDocument>;
    const fragment = parsed.fragments[0];
    if (fragment === undefined) {
      throw new Error('Synthetic parse did not create a Fragment.');
    }
    fragment.selectedTextSha256 = 'a'.repeat(64);
    parsed.structureSha256 = 'b'.repeat(64);
    expect(materializeCandidate(parsed, encoder.encode(source))).toEqual({
      status: 'rejected',
      issue: {code: 'invalid_fragment', path: '$.fragments'},
    });
  });

  it('reparses raw bytes and rejects an internally rehashed forged node', () => {
    const source = '# Synthetic\n\nBody\n';
    const parsed = structuredClone(
      parseValue(source),
    ) as Mutable<ParsedMarkdownDocument>;
    const heading = parsed.nodes.find((node) => node.kind === 'heading');
    if (heading === undefined) {
      throw new Error('Synthetic parse did not create a heading.');
    }
    heading.kind = 'paragraph';
    parsed.structureSha256 = computeMarkdownStructureSha256(
      parsed,
      decoder.decode(parsed.normalizedTextUtf8),
    );
    expect(materializeCandidate(parsed, encoder.encode(source))).toEqual({
      status: 'rejected',
      issue: {code: 'parsed_result_mismatch', path: '$'},
    });
  });

  it('keeps structure identity base-independent while media conflicts remain visible', () => {
    const source = '![x](media.png)';
    const first = parseValue(source, {
      documentBaseUri: 'https://example.invalid/a/doc.md',
    });
    const second = parseValue(source, {
      documentBaseUri: 'https://example.invalid/b/doc.md',
    });
    expect(first.structureSha256).toBe(second.structureSha256);
    const firstMaterialized = materializeValue(first, encoder.encode(source));
    const secondMaterialized = materializeValue(second, encoder.encode(source));
    expect(firstMaterialized.structure.structureId).toBe(
      secondMaterialized.structure.structureId,
    );
    expect(firstMaterialized.mediaAssets[0]?.mediaAssetId).toBe(
      secondMaterialized.mediaAssets[0]?.mediaAssetId,
    );
    expect(firstMaterialized.mediaAssets[0]?.originalUri).not.toBe(
      secondMaterialized.mediaAssets[0]?.originalUri,
    );
  });

  it('passes the fixed-parser EvidenceCapture structure and hash cross-check', () => {
    const source = 'A\r\nB';
    const bytes = encoder.encode(source);
    const parsed = parseValue(bytes);
    const materialized = materializeValue(parsed, bytes);
    const capture = captureFor(parsed, materialized);

    expect(validateEvidenceCapture(capture).status).toBe('validated');

    const changedHash = structuredClone(
      capture,
    ) as Mutable<CaptureEvidenceInput>;
    changedHash.structure.structureSha256 = 'a'.repeat(64);
    expect(validateEvidenceCapture(changedHash)).toMatchObject({
      status: 'validation_failed',
      issue: {code: 'invalid_structure', path: 'structure.structureSha256'},
    });
  });
});

describe('closed Markdown inputs and owned bytes', () => {
  it('rejects unknown, symbol, inherited, class, and accessor fields', () => {
    const unknown = createParseInput('Synthetic') as Record<string, unknown>;
    unknown.extra = 'not-allowed';
    expectInvalidShape(unknown);

    const symbol = createParseInput('Synthetic') as Record<
      PropertyKey,
      unknown
    >;
    symbol[Symbol('synthetic')] = true;
    expectInvalidShape(symbol);

    const inherited = Object.create({workspaceId: WORKSPACE_ID}) as Record<
      string,
      unknown
    >;
    Object.assign(inherited, createParseInput('Synthetic'));
    expectInvalidShape(inherited);

    class Candidate {
      public readonly value = createParseInput('Synthetic');
    }
    expectInvalidShape(new Candidate());

    let getterCalls = 0;
    const accessor = createParseInput('Synthetic');
    Object.defineProperty(accessor, 'workspaceId', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return WORKSPACE_ID;
      },
    });
    expectInvalidShape(accessor);
    expect(getterCalls).toBe(0);

    const explicitUndefined = createParseInput(
      'Synthetic',
    ) as unknown as Record<string, unknown>;
    Object.defineProperty(explicitUndefined, 'documentBaseUri', {
      value: undefined,
      enumerable: true,
    });
    expectInvalidShape(explicitUndefined);
  });

  it('projects valid input without invoking an inherited setter', () => {
    const input = createParseInput('Synthetic');
    const previous = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'workspaceId',
    );
    let setterCalls = 0;
    try {
      Object.defineProperty(Object.prototype, 'workspaceId', {
        configurable: true,
        set() {
          setterCalls += 1;
        },
      });
      expect(parseMarkdownStructure(input).status).toBe('parsed');
      expect(setterCalls).toBe(0);
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(Object.prototype, 'workspaceId');
      } else {
        Object.defineProperty(Object.prototype, 'workspaceId', previous);
      }
    }
    expect(setterCalls).toBe(0);
  });

  it('rejects root, nested, and byte-view proxies without invoking traps', () => {
    let trapCalls = 0;
    const traps: ProxyHandler<object> = {
      get() {
        trapCalls += 1;
        throw new Error('Proxy trap must not run.');
      },
      getOwnPropertyDescriptor() {
        trapCalls += 1;
        throw new Error('Proxy trap must not run.');
      },
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error('Proxy trap must not run.');
      },
      ownKeys() {
        trapCalls += 1;
        throw new Error('Proxy trap must not run.');
      },
    };
    expectInvalidShape(new Proxy(createParseInput('Synthetic'), traps));

    const nested = createParseInput('Synthetic');
    nested.rawBlob = new Proxy(
      nested.rawBlob,
      traps,
    ) as unknown as typeof nested.rawBlob;
    expectInvalidShape(nested);

    const bytes = encoder.encode('Synthetic');
    const proxiedBytes = new Proxy(bytes, traps);
    const byteInput = createParseInput(bytes);
    byteInput.sourceUtf8 = proxiedBytes as unknown as Uint8Array;
    expectInvalidShape(byteInput);
    expect(trapCalls).toBe(0);
  });

  it('rejects partial, shared, resizable, detached, and extended byte views', () => {
    const partialBacking = new ArrayBuffer(16);
    expectInvalidShape(createParseInput(new Uint8Array(partialBacking, 1, 8)));

    if (typeof SharedArrayBuffer === 'function') {
      expectInvalidShape(
        createParseInput(new Uint8Array(new SharedArrayBuffer(8))),
      );
    }

    const ResizableArrayBuffer = ArrayBuffer as unknown as new (
      byteLength: number,
      options: {maxByteLength: number},
    ) => ArrayBuffer;
    const resizable = new ResizableArrayBuffer(8, {maxByteLength: 16});
    expectInvalidShape(createParseInput(new Uint8Array(resizable)));

    const detached = new ArrayBuffer(8);
    const detachedView = new Uint8Array(detached);
    structuredClone(detached, {transfer: [detached]});
    expectInvalidShape(createParseInput(detachedView));

    const extended = encoder.encode('Synthetic') as Uint8Array & {
      extra?: string;
    };
    extended.extra = 'not-allowed';
    expectInvalidShape(createParseInput(extended));
  });

  it('defensively copies source and result bytes while deeply freezing metadata', () => {
    const input = createParseInput('Synthetic');
    const original = input.sourceUtf8;
    const result = parseMarkdownStructure(input);
    if (result.status !== 'parsed') {
      throw new Error('Synthetic parse failed.');
    }
    original[0] = 0x58;
    expect(decoder.decode(result.value.normalizedTextUtf8)).toBe('Synthetic');
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.nodes)).toBe(true);
    expect(Object.isFrozen(result.value.nodes[0])).toBe(true);

    const firstMaterialized = materializeValue(
      result.value,
      encoder.encode('Synthetic'),
    );
    const secondMaterialized = materializeValue(
      result.value,
      encoder.encode('Synthetic'),
    );
    firstMaterialized.structure.normalizedTextUtf8[0] = 0x58;
    expect(
      decoder.decode(secondMaterialized.structure.normalizedTextUtf8),
    ).toBe('Synthetic');
  });

  it('revalidates a supplied parsed graph and rejects sparse arrays', () => {
    const source = 'Synthetic';
    const parsed = structuredClone(
      parseValue(source),
    ) as Mutable<ParsedMarkdownDocument>;
    const sparse = new Array<ParsedMarkdownDocument['nodes'][number]>(
      parsed.nodes.length + 1,
    );
    for (const [index, node] of parsed.nodes.entries()) {
      sparse[index] = node;
    }
    parsed.nodes = sparse;
    expect(materializeCandidate(parsed, encoder.encode(source))).toEqual({
      status: 'rejected',
      issue: {code: 'invalid_shape', path: '$'},
    });
  });

  it('rejects post-parse byte mutation before any DTO is returned', () => {
    const source = 'Synthetic';
    const parsed = parseValue(source);
    parsed.normalizedTextUtf8[0] = 0x58;
    expect(materializeCandidate(parsed, encoder.encode(source))).toEqual({
      status: 'rejected',
      issue: {code: 'parsed_result_mismatch', path: '$'},
    });
  });

  it('does not depend on network, clock, randomness, filesystem, or AI hooks', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Network access is forbidden.');
    });
    const clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Clock access is forbidden.');
    });
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Randomness is forbidden.');
    });
    try {
      expect(
        parseValue('[x](https://example.invalid/value)').links,
      ).toHaveLength(1);
    } finally {
      fetchSpy.mockRestore();
      clockSpy.mockRestore();
      randomSpy.mockRestore();
    }
  });
});

describe('Markdown resource budgets', () => {
  it('keeps bounded preorder ledgers linear and retains at most limit plus one', () => {
    const ledger = new BoundedPreorderLedger<number>(3);
    let creates = 0;
    for (let value = 0; value < 20_000; value += 1) {
      ledger.observe(() => {
        creates += 1;
        return value;
      });
    }
    const snapshot = ledger.snapshot();

    expect(snapshot.observations).toBe(4);
    expect(snapshot.saturatedCount).toBe(4);
    expect(snapshot.retained).toEqual([0, 1, 2, 3]);
    expect(creates).toBe(4);

    const counter = new SaturatingBudgetCounter(3);
    counter.observeMany(20_000);
    expect(counter.saturatedCount).toBe(4);
  });

  it.each([1_250, 5_000, 20_000])(
    'rejects %i synthetic list items with the exact node-budget issue',
    (listItems) => {
      expect(parseCandidate('- a\n'.repeat(listItems))).toEqual({
        status: 'rejected',
        issue: {code: 'limit_exceeded', path: '$.nodes', budget: 'nodes'},
      });
    },
    30_000,
  );

  it('counts weekly synthetic entry sections before allocating their product graph', () => {
    const entries = Array.from(
      {length: 1_250},
      (_, index) => `${String(index + 1)}、 Synthetic`,
    ).join('\n\n');
    expect(
      parseCandidate(`## 工具\n\n${entries}`, {
        profile: 'ruanyf-weekly-v1',
      }),
    ).toEqual({
      status: 'rejected',
      issue: {code: 'limit_exceeded', path: '$.nodes', budget: 'nodes'},
    });
  }, 30_000);

  it('preserves priority when depth and node budgets are both exceeded', () => {
    const shallowOverflow = '- a\n'.repeat(MARKDOWN_BUDGETS.nodes);
    const depthOverflow = `${'> '.repeat(MARKDOWN_BUDGETS.depth)}Synthetic`;
    expect(parseCandidate(`${shallowOverflow}\n${depthOverflow}`)).toEqual({
      status: 'rejected',
      issue: {code: 'limit_exceeded', path: '$.nodes', budget: 'depth'},
    });
  }, 30_000);

  it('preserves node priority when node, Fragment, and link budgets are exceeded', () => {
    const links = Array.from(
      {length: MARKDOWN_BUDGETS.links + 1},
      (_, index) => `[x](https://example.invalid/${String(index)})`,
    ).join(' ');
    const paragraphs = Array.from(
      {length: MARKDOWN_BUDGETS.fragments},
      () => 'p',
    ).join('\n\n');
    const breaks = Array.from(
      {length: MARKDOWN_BUDGETS.nodes},
      () => '---',
    ).join('\n\n');

    expect(parseCandidate(`${links}\n\n${paragraphs}\n\n${breaks}`)).toEqual({
      status: 'rejected',
      issue: {code: 'limit_exceeded', path: '$.nodes', budget: 'nodes'},
    });
  }, 30_000);

  it('accepts the source-byte limit and rejects one byte over it', () => {
    const atLimit = encoder.encode('a'.repeat(MARKDOWN_BUDGETS.sourceBytes));
    expect(parseCandidate(atLimit).status).toBe('parsed');

    const overLimit = encoder.encode(
      'a'.repeat(MARKDOWN_BUDGETS.sourceBytes + 1),
    );
    expect(parseCandidate(overLimit)).toEqual({
      status: 'rejected',
      issue: {
        code: 'limit_exceeded',
        path: '$.sourceUtf8',
        budget: 'source_bytes',
      },
    });
  }, 60_000);

  it('accepts 2,500 nodes with 2,000 Fragments below both canonical ceilings', () => {
    const paragraphs = Array.from({length: 1_999}, () => 'p').join('\n\n');
    const breaks = Array.from({length: 500}, () => '---').join('\n\n');
    const parsed = parseValue(`${paragraphs}\n\n${breaks}`);
    expect(parsed.nodes).toHaveLength(MARKDOWN_BUDGETS.nodes);
    expect(parsed.fragments).toHaveLength(MARKDOWN_BUDGETS.fragments);
  }, 30_000);

  it('rejects one mapped node over the inclusive node limit', () => {
    const source = Array.from(
      {length: MARKDOWN_BUDGETS.nodes},
      () => '---',
    ).join('\n\n');
    expect(parseCandidate(source)).toEqual({
      status: 'rejected',
      issue: {code: 'limit_exceeded', path: '$.nodes', budget: 'nodes'},
    });
  }, 30_000);

  it('rejects one Fragment over the inclusive Fragment limit', () => {
    const source = Array.from(
      {length: MARKDOWN_BUDGETS.fragments},
      () => 'p',
    ).join('\n\n');
    expect(parseCandidate(source)).toEqual({
      status: 'rejected',
      issue: {
        code: 'limit_exceeded',
        path: '$.fragments',
        budget: 'fragments',
      },
    });
  }, 30_000);

  it('uses root depth zero and rejects a deepest node at depth 65', () => {
    const atLimit = `${'> '.repeat(63)}Synthetic`;
    const overLimit = `${'> '.repeat(64)}Synthetic`;
    expect(parseValue(atLimit).nodes.at(-1)?.kind).toBe('paragraph');
    expect(parseCandidate(overLimit)).toEqual({
      status: 'rejected',
      issue: {code: 'limit_exceeded', path: '$.nodes', budget: 'depth'},
    });
  });

  it('accepts the link limit and rejects one link over it', () => {
    const createLinks = (count: number): string =>
      Array.from(
        {length: count},
        (_, index) => `[x](https://example.invalid/${String(index)})`,
      ).join(' ');
    expect(parseValue(createLinks(MARKDOWN_BUDGETS.links)).links).toHaveLength(
      MARKDOWN_BUDGETS.links,
    );
    expect(parseCandidate(createLinks(MARKDOWN_BUDGETS.links + 1))).toEqual({
      status: 'rejected',
      issue: {code: 'limit_exceeded', path: '$.links', budget: 'links'},
    });
  }, 60_000);

  it('accepts the media limit and rejects one media usage over it', () => {
    const createMedia = (count: number): string =>
      Array.from(
        {length: count},
        (_, index) => `![x](https://example.invalid/${String(index)}.png)`,
      ).join(' ');
    expect(parseValue(createMedia(MARKDOWN_BUDGETS.media)).media).toHaveLength(
      MARKDOWN_BUDGETS.media,
    );
    expect(parseCandidate(createMedia(MARKDOWN_BUDGETS.media + 1))).toEqual({
      status: 'rejected',
      issue: {code: 'limit_exceeded', path: '$.media', budget: 'media'},
    });
  }, 30_000);

  it('accepts the diagnostic limit and rejects one diagnostic over it', () => {
    const createInlineHtml = (count: number): string =>
      Array.from({length: count}, () => '<x>').join(' ');
    expect(
      parseValue(createInlineHtml(MARKDOWN_BUDGETS.diagnostics)).diagnostics,
    ).toHaveLength(MARKDOWN_BUDGETS.diagnostics);
    expect(
      parseCandidate(createInlineHtml(MARKDOWN_BUDGETS.diagnostics + 1)),
    ).toEqual({
      status: 'rejected',
      issue: {
        code: 'limit_exceeded',
        path: '$.diagnostics',
        budget: 'diagnostics',
      },
    });
  }, 30_000);
});

type ParseOptions = Readonly<{
  profile?: 'commonmark-v1' | 'ruanyf-weekly-v1';
  documentBaseUri?: string;
}>;

function parseCandidate(
  source: string | Uint8Array,
  options?: ParseOptions,
): ReturnType<typeof parseMarkdownStructure> {
  return parseMarkdownStructure(createParseInput(source, options));
}

function parseValue(
  source: string | Uint8Array,
  options?: ParseOptions,
): ParsedMarkdownDocument {
  const result = parseCandidate(source, options);
  if (result.status !== 'parsed') {
    throw new Error(`Synthetic parse failed with ${result.issue.code}.`);
  }
  return result.value;
}

function createParseInput(
  source: string | Uint8Array,
  options?: ParseOptions,
): {
  workspaceId: string;
  resourceId: string;
  snapshotId: string;
  rawBlob: {
    workspaceId: string;
    blobId: string;
    digestAlgorithm: 'sha256';
    digest: string;
    byteLength: number;
  };
  profile: 'commonmark-v1' | 'ruanyf-weekly-v1';
  sourceUtf8: Uint8Array;
  documentBaseUri?: string;
} {
  const sourceUtf8 =
    typeof source === 'string' ? encoder.encode(source) : source;
  const digest = sha256Bytes(sourceUtf8);
  return {
    workspaceId: WORKSPACE_ID,
    resourceId: RESOURCE_ID,
    snapshotId: SNAPSHOT_ID,
    rawBlob: {
      workspaceId: WORKSPACE_ID,
      blobId: deriveEvidenceBlobId(WORKSPACE_ID, digest),
      digestAlgorithm: 'sha256',
      digest,
      byteLength: sourceUtf8.byteLength,
    },
    profile: options?.profile ?? 'commonmark-v1',
    sourceUtf8,
    ...(options?.documentBaseUri === undefined
      ? {}
      : {documentBaseUri: options.documentBaseUri}),
  };
}

function snapshotFor(parsed: Readonly<ParsedMarkdownDocument>): SnapshotInput {
  return {
    workspaceId: parsed.workspaceId,
    snapshotId: parsed.snapshotId,
    resourceId: parsed.resourceId,
    rawSha256: parsed.rawBlob.digest,
    rawBlob: parsed.rawBlob,
    canonicalContentSha256: parsed.normalizedTextSha256,
    canonicalizationVersion: MARKDOWN_TEXT_NORMALIZATION_VERSION,
    capturedAt: '2040-01-02T03:04:05Z',
  };
}

function materializeCandidate(
  parsed: unknown,
  sourceUtf8: Uint8Array,
): ReturnType<typeof materializeMarkdownEvidence> {
  const typedParsed = parsed as ParsedMarkdownDocument;
  return materializeMarkdownEvidence({
    parsed,
    snapshot: snapshotFor(typedParsed),
    mediaPolicy: 'external_reference_only',
    sourceUtf8,
  });
}

function materializeValue(
  parsed: Readonly<ParsedMarkdownDocument>,
  sourceUtf8: Uint8Array,
): MaterializedMarkdownEvidence {
  const result = materializeMarkdownEvidence({
    parsed,
    snapshot: snapshotFor(parsed),
    mediaPolicy: 'external_reference_only',
    sourceUtf8,
  });
  if (result.status !== 'materialized') {
    throw new Error(
      `Synthetic materialization failed with ${result.issue.code}.`,
    );
  }
  return result.value;
}

function captureFor(
  parsed: Readonly<ParsedMarkdownDocument>,
  materialized: Readonly<MaterializedMarkdownEvidence>,
): CaptureEvidenceInput {
  const blobs = new Map<string, EvidenceBlobInput>();
  blobs.set(parsed.rawBlob.blobId, parsed.rawBlob);
  blobs.set(materialized.textBlob.blobId, materialized.textBlob);
  return {
    workspaceId: parsed.workspaceId,
    commandIdempotencyKey: 'synthetic-markdown-command',
    blobs: [...blobs.values()],
    resource: {
      workspaceId: parsed.workspaceId,
      resourceId: parsed.resourceId,
      resourceKind: 'manual_text',
      sourceKey: 'adapter:synthetic/markdown',
    },
    snapshot: snapshotFor(parsed),
    gitObservations: [],
    structure: materialized.structure,
    mediaAssets: materialized.mediaAssets,
    mediaUsages: materialized.mediaUsages,
  };
}

function expectInvalidShape(input: unknown): void {
  expect(parseMarkdownStructure(input)).toEqual({
    status: 'rejected',
    issue: {code: 'invalid_shape', path: '$'},
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
