import {createHash} from 'node:crypto';
import {types as utilityTypes} from 'node:util';

import {describe, expect, it} from 'vitest';

import {
  BOM_NORMALIZATION_ORACLE,
  CONTRACT_UUID_KNOWN_ANSWER,
  DEPTH_ORACLE,
  LINK_URL_ORACLE,
  MAXIMUM_PROJECTION_ORACLE,
  MEDIA_URL_ORACLE,
  RAW_CORE_BYTE_ORACLE,
  RAW_CORE_CANONICAL_PROJECTION,
  RAW_CORE_CODE_POINT_LEDGER,
  RAW_CORE_CONTEXT_ORACLE,
  RAW_CORE_ENTITY_UUID_ORACLE,
  RAW_CORE_FRAGMENT_ORACLE,
  RAW_CORE_NODE_ORACLE,
  RAW_CORE_STRUCTURE_ORACLE,
  RAW_CORE_UTF16_BOUNDARY_TO_CODE_POINT,
} from '../tests/fixtures/markdown/frozen_markdown_oracles.js';
import {
  BOM_TEXT_HEX_FIXTURES,
  COMMONMARK_SYNTHETIC_FIXTURES,
  DEPTH_SEMANTICS_FIXTURES,
  EMPTY_TEXT_HEX_FIXTURES,
  INVALID_UTF8_HEX_FIXTURES,
  MARKDOWN_BUDGET_LIMITS,
  NUL_TEXT_UTF8_HEX,
  RAW_CORE_NORMALIZED_TEXT,
  RAW_CORE_RAW_UTF8_HEX,
  SYNTHETIC_LINK_URL_INPUTS,
  SYNTHETIC_MEDIA_URL_INPUTS,
  WEEKLY_V1_SYNTHETIC_MARKDOWN,
  bytesFromHex,
  createAccessorRecord,
  createArrayAccessor,
  createArrayWithExtraProperty,
  createClosedInputAttackCounter,
  createCustomPrototypeRecord,
  createDangerousOwnKeyRecord,
  createDepthBudgetMarkdown,
  createDetachedByteView,
  createDiagnosticBudgetMarkdown,
  createFragmentBudgetMarkdown,
  createInheritedRecord,
  createLinkBudgetMarkdown,
  createMediaBudgetMarkdown,
  createMaximumLegalMarkdownLedger,
  createNodeBudgetMarkdown,
  createPartialByteView,
  createProxyRecord,
  createProxiedByteView,
  createRawCoreSourceUtf8,
  createResizableByteView,
  createSharedByteView,
  createSourceBudgetUtf8,
  createSparseArray,
  createSubclassedByteView,
  createSymbolKeyRecord,
} from '../tests/fixtures/markdown/synthetic_markdown_fixtures.js';

const textEncoder = new TextEncoder();

function sha256(value: Uint8Array | string): string {
  return createHash('sha256')
    .update(typeof value === 'string' ? textEncoder.encode(value) : value)
    .digest('hex');
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function normalizeUtf8LfV1(bytes: Uint8Array): string {
  let text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(
    bytes,
  );
  if (text.startsWith('\uFEFF')) {
    text = text.slice(1);
  }
  text = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  if (text.includes('\0')) {
    throw new TypeError('Synthetic text contains NUL.');
  }
  return text;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

function encodeIndependentCanonicalJson(value: unknown): Uint8Array {
  return textEncoder.encode(`${JSON.stringify(canonicalize(value))}\n`);
}

function uuidBytes(uuid: string): Uint8Array {
  return bytesFromHex(uuid.replaceAll('-', ''));
}

function uuidV5(namespace: string, name: string): string {
  const digest = createHash('sha1')
    .update(uuidBytes(namespace))
    .update(textEncoder.encode(name))
    .digest()
    .subarray(0, 16);
  const versionByte = digest[6];
  const variantByte = digest[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new RangeError('Synthetic UUID digest is shorter than 16 bytes.');
  }
  digest[6] = (versionByte & 0x0f) | 0x50;
  digest[8] = (variantByte & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function independentCodePointLedger(text: string): readonly object[] {
  let utf16Offset = 0;
  let line = 1;
  return Object.freeze(
    Array.from(text, (character, codePointIndex) => {
      const utf16Start = utf16Offset;
      utf16Offset += character.length;
      const scalarValue = character.codePointAt(0);
      if (scalarValue === undefined) {
        throw new TypeError('Synthetic code-point entry is empty.');
      }
      const entry = Object.freeze({
        codePointIndex,
        scalar: `U+${scalarValue.toString(16).toUpperCase().padStart(4, '0')}`,
        utf16Start,
        utf16End: utf16Offset,
        line,
      });
      if (character === '\n') {
        line += 1;
      }
      return entry;
    }),
  );
}

function independentUtf16BoundaryMap(text: string): readonly (number | null)[] {
  const boundaries: (number | null)[] = Array.from(
    {length: text.length + 1},
    () => null,
  );
  let utf16Offset = 0;
  let codePointIndex = 0;
  for (const character of text) {
    boundaries[utf16Offset] = codePointIndex;
    utf16Offset += character.length;
    codePointIndex += 1;
  }
  boundaries[utf16Offset] = codePointIndex;
  return boundaries;
}

function resolveLinkIndependently(
  destination: string,
  base: string | undefined,
): Readonly<Record<string, string>> {
  if (destination.startsWith('#')) {
    return {status: 'not_resolved', reason: 'document_fragment'};
  }
  let parsed: URL;
  try {
    parsed =
      base === undefined ? new URL(destination) : new URL(destination, base);
  } catch {
    return {
      status: 'not_resolved',
      reason: base === undefined ? 'relative_without_base' : 'invalid_uri',
    };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {status: 'not_resolved', reason: 'unsupported_scheme'};
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return {status: 'not_resolved', reason: 'credentials_not_allowed'};
  }
  if (parsed.hostname === '') {
    return {status: 'not_resolved', reason: 'invalid_uri'};
  }
  return {status: 'resolved', href: parsed.href};
}

function resolveMediaIndependently(
  destination: string,
  base: string | undefined,
): Readonly<Record<string, string>> {
  if (destination.startsWith('#')) {
    return {status: 'rejected', code: 'invalid_media_reference'};
  }
  let parsed: URL;
  try {
    parsed =
      base === undefined ? new URL(destination) : new URL(destination, base);
  } catch {
    return {status: 'rejected', code: 'invalid_media_reference'};
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    return {status: 'rejected', code: 'unsafe_media_scheme'};
  }
  if (parsed.hostname === '') {
    return {status: 'rejected', code: 'invalid_media_reference'};
  }
  return {status: 'resolved', href: parsed.href};
}

function countMatches(value: string, pattern: RegExp): number {
  return Array.from(value.matchAll(pattern)).length;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isUnknownRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function countCanonicalValues(value: unknown): number {
  if (value === null || typeof value !== 'object') {
    return 1;
  }
  if (isUnknownArray(value)) {
    return (
      1 +
      value.reduce<number>(
        (count, item) => count + countCanonicalValues(item),
        0,
      )
    );
  }
  if (isUnknownRecord(value)) {
    return (
      1 +
      Object.values(value).reduce<number>(
        (count, item) => count + countCanonicalValues(item),
        0,
      )
    );
  }
  throw new TypeError('Canonical value is neither an array nor a record.');
}

function createMaximumLegalProjection() {
  const ledger = createMaximumLegalMarkdownLedger();
  const codePoints = Array.from(ledger.normalizedText);
  const projectionNodes = ledger.nodes.map((node) => ({
    path: node.path,
    parentPath: node.parentPath,
    kind: node.kind,
    siblingOrdinal: node.siblingOrdinal,
    codePointStart: node.codePointStart,
    codePointEnd: node.codePointEnd,
    lineStart: node.lineStart,
    lineEnd: node.lineEnd,
  }));
  const fragments = ledger.nodes
    .filter((node) => node.hasFragment)
    .map((node) => ({
      nodePath: node.path,
      locatorKind: 'unicode_code_point_range',
      locatorVersion: 1,
      codePointStart: node.codePointStart,
      codePointEnd: node.codePointEnd,
      lineStart: node.lineStart,
      lineEnd: node.lineEnd,
      selectedTextSha256: sha256(
        codePoints.slice(node.codePointStart, node.codePointEnd).join(''),
      ),
    }));
  return Object.freeze({
    ledger,
    projection: {
      projection: 'markdown-structure-v1',
      parser: {name: 'struinfo-commonmark', version: '1'},
      text: {
        normalizationVersion: 'utf8-lf-v1',
        sha256: sha256(ledger.normalizedText),
        byteLength: textEncoder.encode(ledger.normalizedText).byteLength,
      },
      nodes: projectionNodes,
      fragments,
    },
  });
}

function calculateConservativeProjectionByteUpperBound(): Readonly<{
  nodeBytes: number;
  fragmentBytes: number;
  totalBytes: number;
}> {
  const jsonStringBytes = (contentBytes: number): number => contentBytes + 2;
  const fixedStringBytes = (value: string): number =>
    jsonStringBytes(textEncoder.encode(value).byteLength);
  const propertyBytes = (name: string, valueBytes: number): number =>
    fixedStringBytes(name) + 1 + valueBytes;
  const objectBytes = (properties: readonly number[]): number =>
    2 +
    properties.reduce((total, property) => total + property, 0) +
    Math.max(0, properties.length - 1);
  const arrayBytes = (itemBytes: number, count: number): number =>
    2 + itemBytes * count + Math.max(0, count - 1);
  const maximumPathBytes = MAXIMUM_PROJECTION_ORACLE.maximumNodePathBytes;
  const maximumSourceOffsetDigits = String(
    MARKDOWN_BUDGET_LIMITS.sourceBytes,
  ).length;
  const maximumSiblingOrdinalDigits = String(
    MARKDOWN_BUDGET_LIMITS.nodes - 1,
  ).length;
  const nodeBytes = objectBytes([
    propertyBytes('path', jsonStringBytes(maximumPathBytes)),
    propertyBytes('parentPath', jsonStringBytes(maximumPathBytes)),
    propertyBytes('kind', fixedStringBytes('thematic_break')),
    propertyBytes('siblingOrdinal', maximumSiblingOrdinalDigits),
    propertyBytes('codePointStart', maximumSourceOffsetDigits),
    propertyBytes('codePointEnd', maximumSourceOffsetDigits),
    propertyBytes('lineStart', maximumSourceOffsetDigits),
    propertyBytes('lineEnd', maximumSourceOffsetDigits),
  ]);
  const fragmentBytes = objectBytes([
    propertyBytes('nodePath', jsonStringBytes(maximumPathBytes)),
    propertyBytes('locatorKind', fixedStringBytes('unicode_code_point_range')),
    propertyBytes('locatorVersion', 1),
    propertyBytes('codePointStart', maximumSourceOffsetDigits),
    propertyBytes('codePointEnd', maximumSourceOffsetDigits),
    propertyBytes('lineStart', maximumSourceOffsetDigits),
    propertyBytes('lineEnd', maximumSourceOffsetDigits),
    propertyBytes('selectedTextSha256', jsonStringBytes(64)),
  ]);
  const parserBytes = objectBytes([
    propertyBytes(
      'name',
      fixedStringBytes('struinfo-commonmark/ruanyf-weekly'),
    ),
    propertyBytes('version', fixedStringBytes('1')),
  ]);
  const textBytes = objectBytes([
    propertyBytes('normalizationVersion', fixedStringBytes('utf8-lf-v1')),
    propertyBytes('sha256', jsonStringBytes(64)),
    propertyBytes('byteLength', maximumSourceOffsetDigits),
  ]);
  const totalBytes =
    objectBytes([
      propertyBytes('projection', fixedStringBytes('markdown-structure-v1')),
      propertyBytes('parser', parserBytes),
      propertyBytes('text', textBytes),
      propertyBytes(
        'nodes',
        arrayBytes(nodeBytes, MAXIMUM_PROJECTION_ORACLE.nodeCount),
      ),
      propertyBytes(
        'fragments',
        arrayBytes(fragmentBytes, MAXIMUM_PROJECTION_ORACLE.fragmentCount),
      ),
    ]) + 1;
  return Object.freeze({nodeBytes, fragmentBytes, totalBytes});
}

function assertMaximumLegalLedgerInvariants(
  ledger: ReturnType<typeof createMaximumLegalMarkdownLedger>,
): void {
  const paths = ledger.nodes.map(({path}) => path);
  const nodesByPath = new Map(ledger.nodes.map((node) => [node.path, node]));
  const childrenByParent = new Map<string, (typeof ledger.nodes)[number][]>();
  const codePointLines: number[] = [];
  let line = 1;
  for (const codePoint of ledger.normalizedText) {
    codePointLines.push(line);
    if (codePoint === '\n') {
      line += 1;
    }
  }

  expect(new Set(paths).size).toBe(paths.length);
  expect(
    ledger.nodes.filter(({parentPath}) => parentPath === null),
  ).toHaveLength(1);
  expect(ledger.nodes[0]).toMatchObject({
    path: 'n/0',
    parentPath: null,
    kind: 'document',
    siblingOrdinal: 0,
    codePointStart: 0,
    codePointEnd: codePointLines.length,
  });

  for (const [index, node] of ledger.nodes.entries()) {
    expect(node.codePointStart).toBeLessThan(node.codePointEnd);
    expect(node.lineStart).toBe(codePointLines[node.codePointStart]);
    expect(node.lineEnd).toBe(codePointLines[node.codePointEnd - 1]);
    if (node.parentPath === null) {
      continue;
    }
    const parent = nodesByPath.get(node.parentPath);
    expect(parent).toBeDefined();
    expect(paths.indexOf(node.parentPath)).toBeLessThan(index);
    expect(node.codePointStart).toBeGreaterThanOrEqual(
      parent?.codePointStart ?? -1,
    );
    expect(node.codePointEnd).toBeLessThanOrEqual(parent?.codePointEnd ?? -1);
    const siblings = childrenByParent.get(node.parentPath) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentPath, siblings);
  }

  for (const [parentPath, siblings] of childrenByParent) {
    for (const [ordinal, sibling] of siblings.entries()) {
      expect(sibling.siblingOrdinal).toBe(ordinal);
      expect(sibling.path).toBe(`${parentPath}/${String(ordinal)}`);
      if (ordinal > 0) {
        const previousSibling = siblings[ordinal - 1];
        if (previousSibling === undefined) {
          throw new RangeError(
            'Synthetic sibling ledger is unexpectedly sparse.',
          );
        }
        expect(sibling.codePointStart).toBeGreaterThanOrEqual(
          previousSibling.codePointEnd,
        );
      }
    }
  }

  const canonicalPreorder: string[] = [];
  const visit = (path: string): void => {
    canonicalPreorder.push(path);
    for (const child of childrenByParent.get(path) ?? []) {
      visit(child.path);
    }
  };
  visit('n/0');
  expect(paths).toEqual(canonicalPreorder);
  const maximumDepth = Math.max(
    ...paths.map((path) => path.split('/').length - 2),
  );
  expect(maximumDepth).toBe(MAXIMUM_PROJECTION_ORACLE.maximumLegalDepth);
  expect(maximumDepth).toBeLessThanOrEqual(DEPTH_ORACLE.maximumDepth);
}

describe('independent F-RAW-CORE oracle', () => {
  it('recomputes raw and normalized byte identities without product code', () => {
    const rawBytes = createRawCoreSourceUtf8();
    const normalized = normalizeUtf8LfV1(rawBytes);

    expect(toHex(rawBytes)).toBe(RAW_CORE_RAW_UTF8_HEX);
    expect(rawBytes.byteLength).toBe(RAW_CORE_BYTE_ORACLE.rawByteLength);
    expect(sha256(rawBytes)).toBe(RAW_CORE_BYTE_ORACLE.rawSha256);
    expect(normalized).toBe(RAW_CORE_NORMALIZED_TEXT);
    expect(normalized).toBe(RAW_CORE_BYTE_ORACLE.normalizedText);
    expect(toHex(textEncoder.encode(normalized))).toBe(
      RAW_CORE_BYTE_ORACLE.normalizedUtf8Hex,
    );
    expect(textEncoder.encode(normalized).byteLength).toBe(
      RAW_CORE_BYTE_ORACLE.normalizedByteLength,
    );
    expect(sha256(normalized)).toBe(RAW_CORE_BYTE_ORACLE.normalizedSha256);
  });

  it('recomputes Unicode code-point and UTF-16 boundary ledgers', () => {
    expect(independentCodePointLedger(RAW_CORE_NORMALIZED_TEXT)).toEqual(
      RAW_CORE_CODE_POINT_LEDGER,
    );
    expect(independentUtf16BoundaryMap(RAW_CORE_NORMALIZED_TEXT)).toEqual(
      RAW_CORE_UTF16_BOUNDARY_TO_CODE_POINT,
    );
    expect(RAW_CORE_NORMALIZED_TEXT.length).toBe(
      RAW_CORE_BYTE_ORACLE.utf16Length,
    );
    expect(Array.from(RAW_CORE_NORMALIZED_TEXT)).toHaveLength(
      RAW_CORE_BYTE_ORACLE.codePointLength,
    );
  });

  it('freezes one cross-line paragraph and three exact Fragments', () => {
    const codePoints = Array.from(RAW_CORE_NORMALIZED_TEXT);
    const paragraph = RAW_CORE_NODE_ORACLE[3];
    const paragraphFragment = RAW_CORE_FRAGMENT_ORACLE[2];
    if (paragraph === undefined || paragraphFragment === undefined) {
      throw new RangeError('Frozen F-RAW-CORE oracle is incomplete.');
    }
    const selected = codePoints
      .slice(paragraph.codePointRange.start, paragraph.codePointRange.end)
      .join('');

    expect(RAW_CORE_NODE_ORACLE).toHaveLength(4);
    expect(RAW_CORE_FRAGMENT_ORACLE).toHaveLength(3);
    expect(paragraph.localKey).toBe('n/0/0/1');
    expect(paragraph.codePointRange).toEqual({start: 6, end: 17});
    expect(paragraph.lineRange).toEqual({start: 3, end: 4});
    expect(selected).toBe('段落😀 e\u0301 é\n末行');
    expect(sha256(selected)).toBe(
      '8a0fb2d2427930f819e6285495c99346e3b7b16e57de32ed46042920260624ec',
    );
    expect(paragraphFragment.selectedTextSha256).toBe(sha256(selected));
  });

  it('recomputes the frozen canonical projection bytes and digest', () => {
    const canonicalBytes = encodeIndependentCanonicalJson(
      RAW_CORE_CANONICAL_PROJECTION,
    );

    expect(canonicalBytes.byteLength).toBe(
      RAW_CORE_STRUCTURE_ORACLE.canonicalByteLength,
    );
    expect(canonicalBytes.byteLength).toBe(1_498);
    expect(sha256(canonicalBytes)).toBe(
      RAW_CORE_STRUCTURE_ORACLE.structureSha256,
    );
  });
});

describe('independent deterministic UUID oracle', () => {
  it('recomputes the corrected F-RAW-CORE Blob and structure graph', () => {
    const rawBlobId = uuidV5(
      RAW_CORE_CONTEXT_ORACLE.workspaceId,
      `struinfo:evidence-blob:v1:sha256:${RAW_CORE_BYTE_ORACLE.rawSha256}`,
    );
    const normalizedBlobId = uuidV5(
      RAW_CORE_CONTEXT_ORACLE.workspaceId,
      `struinfo:evidence-blob:v1:sha256:${RAW_CORE_BYTE_ORACLE.normalizedSha256}`,
    );
    const structureId = uuidV5(
      RAW_CORE_CONTEXT_ORACLE.snapshotId,
      `struinfo:document-structure:v1:${RAW_CORE_CONTEXT_ORACLE.parserName}:${RAW_CORE_CONTEXT_ORACLE.parserVersion}:${RAW_CORE_CONTEXT_ORACLE.normalizationVersion}:${RAW_CORE_STRUCTURE_ORACLE.structureSha256}`,
    );

    expect(rawBlobId).toBe(RAW_CORE_BYTE_ORACLE.rawBlobId);
    expect(normalizedBlobId).toBe(RAW_CORE_BYTE_ORACLE.normalizedBlobId);
    expect(structureId).toBe(RAW_CORE_STRUCTURE_ORACLE.structureId);
    for (const [localKey, expected] of Object.entries(
      RAW_CORE_ENTITY_UUID_ORACLE.nodes,
    )) {
      expect(uuidV5(structureId, `struinfo:document-node:v1:${localKey}`)).toBe(
        expected,
      );
    }
    for (const [localKey, expected] of Object.entries(
      RAW_CORE_ENTITY_UUID_ORACLE.fragments,
    )) {
      expect(uuidV5(structureId, `struinfo:fragment:v1:${localKey}`)).toBe(
        expected,
      );
    }
  });

  it('recomputes the contract UUIDv5 known-answer vector', () => {
    const normalizedBlobId = uuidV5(
      CONTRACT_UUID_KNOWN_ANSWER.workspaceId,
      `struinfo:evidence-blob:v1:sha256:${CONTRACT_UUID_KNOWN_ANSWER.normalizedDigest}`,
    );
    const structureId = uuidV5(
      CONTRACT_UUID_KNOWN_ANSWER.snapshotId,
      `struinfo:document-structure:v1:struinfo-commonmark:1:utf8-lf-v1:${CONTRACT_UUID_KNOWN_ANSWER.structureDigest}`,
    );

    expect(normalizedBlobId).toBe(CONTRACT_UUID_KNOWN_ANSWER.normalizedBlobId);
    expect(structureId).toBe(CONTRACT_UUID_KNOWN_ANSWER.structureId);
    expect(uuidV5(structureId, 'struinfo:document-node:v1:n/0')).toBe(
      CONTRACT_UUID_KNOWN_ANSWER.nodeRootId,
    );
    expect(uuidV5(structureId, 'struinfo:document-node:v1:n/0/0')).toBe(
      CONTRACT_UUID_KNOWN_ANSWER.nodeChildId,
    );
    expect(uuidV5(structureId, 'struinfo:fragment:v1:f/n/0/0')).toBe(
      CONTRACT_UUID_KNOWN_ANSWER.fragmentChildId,
    );
  });
});

describe('independent URL and media known answers', () => {
  it('recomputes every frozen link-resolution result with WHATWG URL', () => {
    const actual = Object.fromEntries(
      SYNTHETIC_LINK_URL_INPUTS.map(({id, destination, base}) => [
        id,
        resolveLinkIndependently(destination, base),
      ]),
    );
    expect(actual).toEqual(LINK_URL_ORACLE);
  });

  it('recomputes every frozen media-resolution result with WHATWG URL', () => {
    const actual = Object.fromEntries(
      SYNTHETIC_MEDIA_URL_INPUTS.map(({id, destination, base}) => [
        id,
        resolveMediaIndependently(destination, base),
      ]),
    );
    expect(actual).toEqual(MEDIA_URL_ORACLE);
    expect(MEDIA_URL_ORACLE['canonical-first'].href).toBe(
      MEDIA_URL_ORACLE['canonical-duplicate'].href,
    );
  });
});

describe('synthetic Markdown fixture completeness', () => {
  it('provides strict UTF-8, BOM, NUL and empty-document byte vectors', () => {
    for (const fixture of INVALID_UTF8_HEX_FIXTURES) {
      expect(() =>
        new TextDecoder('utf-8', {fatal: true}).decode(
          bytesFromHex(fixture.hex),
        ),
      ).toThrow();
    }
    expect(bytesFromHex(NUL_TEXT_UTF8_HEX)).toEqual(textEncoder.encode('x\0y'));
    expect(BOM_TEXT_HEX_FIXTURES).toEqual([
      {id: 'single-leading-bom', hex: 'efbbbf78'},
      {id: 'double-leading-bom', hex: 'efbbbfefbbbf78'},
      {id: 'non-leading-bom', hex: '78efbbbf79'},
    ]);
    expect(BOM_NORMALIZATION_ORACLE).toEqual({
      'single-leading-bom': '78',
      'double-leading-bom': 'efbbbf78',
      'non-leading-bom': '78efbbbf79',
    });
    for (const fixture of BOM_TEXT_HEX_FIXTURES) {
      const normalized = normalizeUtf8LfV1(bytesFromHex(fixture.hex));
      expect(toHex(textEncoder.encode(normalized)), fixture.id).toBe(
        BOM_NORMALIZATION_ORACLE[fixture.id],
      );
    }
    for (const fixture of EMPTY_TEXT_HEX_FIXTURES) {
      const normalized = normalizeUtf8LfV1(bytesFromHex(fixture.hex));
      expect(normalized.trim().length === 0).toBe(fixture.expectedEmpty);
    }
  });

  it('contains only explicit synthetic CommonMark and weekly profile cases', () => {
    expect(COMMONMARK_SYNTHETIC_FIXTURES.headings).toContain('#### H4');
    expect(COMMONMARK_SYNTHETIC_FIXTURES.setext).toContain('========');
    expect(COMMONMARK_SYNTHETIC_FIXTURES.blocks).toContain('```text');
    expect(COMMONMARK_SYNTHETIC_FIXTURES.opaque).toContain('<div>');
    expect(COMMONMARK_SYNTHETIC_FIXTURES.extensionLooking).toContain('| --- |');
    expect(WEEKLY_V1_SYNTHETIC_MARKDOWN).toContain('## 科技动态');
    expect(WEEKLY_V1_SYNTHETIC_MARKDOWN).toContain('1、合成条目甲');
    expect(WEEKLY_V1_SYNTHETIC_MARKDOWN).toContain('## 封面图');
    expect(WEEKLY_V1_SYNTHETIC_MARKDOWN).toContain('## 往年回顾');
  });
});

describe('closed-input attack generators', () => {
  it('constructs hostile records and arrays without executing caller code', () => {
    const counter = createClosedInputAttackCounter();
    const accessor = createAccessorRecord(counter);
    const symbolRecord = createSymbolKeyRecord();
    const arrayAccessor = createArrayAccessor(counter);
    const recordProxy = createProxyRecord(counter);
    const byteProxy = createProxiedByteView(counter);

    expect(Object.getPrototypeOf(accessor)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(symbolRecord)).toBe(Object.prototype);
    expect(counter).toEqual(createClosedInputAttackCounter());
    expect(Object.getPrototypeOf(createInheritedRecord())).not.toBe(
      Object.prototype,
    );
    expect(Object.getPrototypeOf(createCustomPrototypeRecord())).not.toBe(
      Object.prototype,
    );
    expect(Object.keys(accessor)).toEqual(['synthetic']);
    const accessorDescriptor = Object.getOwnPropertyDescriptor(
      accessor,
      'synthetic',
    );
    expect(typeof accessorDescriptor?.get).toBe('function');
    expect(typeof accessorDescriptor?.set).toBe('function');
    expect(accessorDescriptor).not.toHaveProperty('value');
    expect(Object.getOwnPropertyNames(symbolRecord)).toEqual([]);
    const symbolKeys = Object.getOwnPropertySymbols(symbolRecord);
    expect(symbolKeys).toHaveLength(1);
    const symbolKey = symbolKeys[0];
    if (symbolKey === undefined) {
      throw new RangeError('Synthetic symbol-key record has no symbol key.');
    }
    const symbolDescriptor = Object.getOwnPropertyDescriptor(
      symbolRecord,
      symbolKey,
    );
    expect(symbolDescriptor).toMatchObject({
      enumerable: true,
      value: 'synthetic-symbol-value',
    });
    expect(symbolDescriptor).not.toHaveProperty('get');
    expect(counter).toEqual(createClosedInputAttackCounter());
    for (const key of ['__proto__', 'constructor', 'prototype'] as const) {
      expect(Object.hasOwn(createDangerousOwnKeyRecord(key), key)).toBe(true);
    }
    expect(0 in createSparseArray()).toBe(false);
    expect(
      typeof Object.getOwnPropertyDescriptor(arrayAccessor, '0')?.get,
    ).toBe('function');
    expect(
      Object.hasOwn(createArrayWithExtraProperty(), 'syntheticExtra'),
    ).toBe(true);
    expect(utilityTypes.isProxy(recordProxy)).toBe(true);
    expect(utilityTypes.isProxy(byteProxy)).toBe(true);
    expect(counter).toEqual(createClosedInputAttackCounter());
  });

  it('constructs shared, partial, resizable, detached and subclassed views', () => {
    const shared = createSharedByteView();
    const partial = createPartialByteView();
    const resizable = createResizableByteView();
    const detached = createDetachedByteView();
    const subclassed = createSubclassedByteView();

    expect(shared.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(partial.byteOffset).toBe(2);
    expect(partial.byteLength).toBeLessThan(partial.buffer.byteLength);
    expect(
      (resizable.buffer as ArrayBuffer & {readonly resizable: boolean})
        .resizable,
    ).toBe(true);
    expect(detached.byteLength).toBe(0);
    expect(Object.getPrototypeOf(subclassed)).not.toBe(Uint8Array.prototype);
  });
});

describe('independent resource-budget generators', () => {
  it('generates exact source, node and Fragment at/over boundaries', () => {
    expect(
      createSourceBudgetUtf8(MARKDOWN_BUDGET_LIMITS.sourceBytes),
    ).toHaveLength(MARKDOWN_BUDGET_LIMITS.sourceBytes);
    expect(
      createSourceBudgetUtf8(MARKDOWN_BUDGET_LIMITS.sourceBytes + 1),
    ).toHaveLength(MARKDOWN_BUDGET_LIMITS.sourceBytes + 1);

    for (const count of [
      MARKDOWN_BUDGET_LIMITS.nodes,
      MARKDOWN_BUDGET_LIMITS.nodes + 1,
    ]) {
      expect(
        countMatches(createNodeBudgetMarkdown(count), /^---$/gmu) + 1,
      ).toBe(count);
    }
    for (const count of [
      MARKDOWN_BUDGET_LIMITS.fragments,
      MARKDOWN_BUDGET_LIMITS.fragments + 1,
    ]) {
      expect(
        createFragmentBudgetMarkdown(count).trimEnd().split('\n\n').length + 1,
      ).toBe(count);
    }
  });

  it('generates exact link, media and diagnostic at/over boundaries', () => {
    for (const count of [
      MARKDOWN_BUDGET_LIMITS.links,
      MARKDOWN_BUDGET_LIMITS.links + 1,
    ]) {
      expect(countMatches(createLinkBudgetMarkdown(count), /\[x\]\(/gu)).toBe(
        count,
      );
    }
    for (const count of [
      MARKDOWN_BUDGET_LIMITS.media,
      MARKDOWN_BUDGET_LIMITS.media + 1,
    ]) {
      expect(countMatches(createMediaBudgetMarkdown(count), /!\[x\]\(/gu)).toBe(
        count,
      );
    }
    for (const count of [
      MARKDOWN_BUDGET_LIMITS.diagnostics,
      MARKDOWN_BUDGET_LIMITS.diagnostics + 1,
    ]) {
      expect(countMatches(createDiagnosticBudgetMarkdown(count), /<x>/gu)).toBe(
        count,
      );
    }
  });

  it('counts root, parent edges, synthetic sections and images explicitly', () => {
    const paragraphAtLimit = createDepthBudgetMarkdown(
      MARKDOWN_BUDGET_LIMITS.depth,
      'paragraph',
    );
    const paragraphOverLimit = createDepthBudgetMarkdown(
      MARKDOWN_BUDGET_LIMITS.depth + 1,
      'paragraph',
    );
    const imageAtLimit = createDepthBudgetMarkdown(
      MARKDOWN_BUDGET_LIMITS.depth,
      'image',
    );
    const imageOverLimit = createDepthBudgetMarkdown(
      MARKDOWN_BUDGET_LIMITS.depth + 1,
      'image',
    );

    expect(countMatches(paragraphAtLimit, /> /gu) + 1).toBe(
      DEPTH_ORACLE.maximumDepth,
    );
    expect(countMatches(paragraphOverLimit, /> /gu) + 1).toBe(
      DEPTH_ORACLE.maximumDepth + 1,
    );
    expect(countMatches(imageAtLimit, /> /gu) + 2).toBe(
      DEPTH_ORACLE.maximumDepth,
    );
    expect(countMatches(imageOverLimit, /> /gu) + 2).toBe(
      DEPTH_ORACLE.maximumDepth + 1,
    );
    expect(DEPTH_ORACLE.rootDepth).toBe(0);
    expect(DEPTH_ORACLE.syntheticSectionDepth).toBe(1);
    expect(DEPTH_ORACLE.headingUnderSectionDepth).toBe(2);
    expect(DEPTH_ORACLE.imageUnderParagraphDepth).toBe(2);
    expect(DEPTH_SEMANTICS_FIXTURES.syntheticSection).toMatch(/^# /u);
    expect(DEPTH_SEMANTICS_FIXTURES.imageInParagraph).toMatch(/^!\[/u);
  });

  it('proves the maximum legal projection is below both defensive ceilings', () => {
    const {ledger, projection} = createMaximumLegalProjection();
    const canonicalBytes = encodeIndependentCanonicalJson(projection);
    const fragmentsByNodePath = new Map(
      projection.fragments.map((fragment) => [fragment.nodePath, fragment]),
    );
    const codePoints = Array.from(ledger.normalizedText);

    assertMaximumLegalLedgerInvariants(ledger);
    expect(projection.nodes).toHaveLength(MAXIMUM_PROJECTION_ORACLE.nodeCount);
    expect(projection.fragments).toHaveLength(
      MAXIMUM_PROJECTION_ORACLE.fragmentCount,
    );
    expect(
      projection.nodes.filter(({kind}) => kind === 'section'),
    ).toHaveLength(MAXIMUM_PROJECTION_ORACLE.maximumLegalSectionCount);
    expect(
      projection.nodes.filter(({kind}) => kind === 'heading'),
    ).toHaveLength(MAXIMUM_PROJECTION_ORACLE.maximumLegalHeadingCount);
    expect(
      projection.nodes.filter(({kind}) => kind === 'paragraph'),
    ).toHaveLength(MAXIMUM_PROJECTION_ORACLE.maximumLegalParagraphCount);
    for (const node of ledger.nodes.filter(({hasFragment}) => hasFragment)) {
      const fragment = fragmentsByNodePath.get(node.path);
      const selectedText = codePoints
        .slice(node.codePointStart, node.codePointEnd)
        .join('');
      expect(fragment).toBeDefined();
      expect(fragment).toMatchObject({
        codePointStart: node.codePointStart,
        codePointEnd: node.codePointEnd,
        lineStart: node.lineStart,
        lineEnd: node.lineEnd,
      });
      expect(fragment?.selectedTextSha256).toBe(sha256(selectedText));
      if (node.kind === 'heading') {
        expect(selectedText).toMatch(/^# synthetic-heading-[0-9]+$/u);
      } else if (node.kind === 'paragraph') {
        expect(selectedText).toMatch(/^synthetic-paragraph-[0-9]+$/u);
      }
    }

    expect(countCanonicalValues(projection)).toBe(
      MAXIMUM_PROJECTION_ORACLE.canonicalJsonValues,
    );
    expect(MAXIMUM_PROJECTION_ORACLE.canonicalJsonValues).toBe(40_511);
    expect(MAXIMUM_PROJECTION_ORACLE.canonicalJsonValues).toBeLessThan(
      MAXIMUM_PROJECTION_ORACLE.canonicalJsonValueLimit,
    );
    expect(canonicalBytes.byteLength).toBe(
      MAXIMUM_PROJECTION_ORACLE.maximumLegalCanonicalBytes,
    );
    expect(canonicalBytes.byteLength).toBeLessThan(
      MAXIMUM_PROJECTION_ORACLE.canonicalByteLimit,
    );
  });

  it('derives the conservative byte ceiling by field-length arithmetic only', () => {
    const bound = calculateConservativeProjectionByteUpperBound();

    expect(bound.nodeBytes).toBe(
      MAXIMUM_PROJECTION_ORACLE.conservativeNodeBytes,
    );
    expect(bound.fragmentBytes).toBe(
      MAXIMUM_PROJECTION_ORACLE.conservativeFragmentBytes,
    );
    expect(bound.totalBytes).toBe(
      MAXIMUM_PROJECTION_ORACLE.conservativeCanonicalByteUpperBound,
    );
    expect(bound.totalBytes).toBe(3_161_273);
    expect(bound.totalBytes).toBeLessThan(
      MAXIMUM_PROJECTION_ORACLE.canonicalByteLimit,
    );
    expect(
      MAXIMUM_PROJECTION_ORACLE.canonicalByteLimit - bound.totalBytes,
    ).toBe(MAXIMUM_PROJECTION_ORACLE.conservativeCanonicalByteHeadroom);
  });
});
