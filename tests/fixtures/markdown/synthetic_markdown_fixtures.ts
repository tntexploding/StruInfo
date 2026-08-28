export const RAW_CORE_RAW_UTF8_HEX =
  'efbbbf2320e59088e688900d0a0d0ae6aeb5e890bdf09f98802065cc8120c3a90de69cabe8a18c0a';

export const RAW_CORE_LOGICAL_SOURCE =
  '\uFEFF# 合成\r\n\r\n段落😀 e\u0301 é\r末行\n';

export const RAW_CORE_NORMALIZED_TEXT = '# 合成\n\n段落😀 e\u0301 é\n末行\n';

export const INVALID_UTF8_HEX_FIXTURES = Object.freeze([
  Object.freeze({id: 'invalid-two-byte', hex: 'c328'}),
  Object.freeze({id: 'invalid-four-byte', hex: 'f0288cbc'}),
  Object.freeze({id: 'invalid-before-nul', hex: 'c32800'}),
]);

export const EMPTY_TEXT_HEX_FIXTURES = Object.freeze([
  Object.freeze({id: 'zero-bytes', hex: '', expectedEmpty: true}),
  Object.freeze({id: 'bom-only', hex: 'efbbbf', expectedEmpty: true}),
  Object.freeze({
    id: 'ecmascript-whitespace',
    hex: '09200d0ac2a0e280a8',
    expectedEmpty: true,
  }),
  Object.freeze({id: 'zero-width-space', hex: 'e2808b', expectedEmpty: false}),
]);

export const BOM_TEXT_HEX_FIXTURES = Object.freeze([
  Object.freeze({id: 'single-leading-bom', hex: 'efbbbf78'}),
  Object.freeze({id: 'double-leading-bom', hex: 'efbbbfefbbbf78'}),
  Object.freeze({id: 'non-leading-bom', hex: '78efbbbf79'}),
]);

export const NUL_TEXT_UTF8_HEX = '780079';

export const COMMONMARK_SYNTHETIC_FIXTURES = Object.freeze({
  headings: '# H1\n\n## H2\n\n#### H4\n\n> ### 引用标题\n\n- ### 列表标题\n',
  setext: '合成标题\n========\n\n合成\n副标题\n--------\n',
  blocks: [
    '合成段落。',
    '',
    '> 合成引用',
    '>',
    '> ### 引用内标题',
    '',
    '1. 合成有序项',
    '   - 合成嵌套项',
    '',
    '    synthetic indented code',
    '',
    '```text',
    'synthetic fenced code',
    '```',
    '',
    '***',
    '',
    '```text',
    'synthetic unclosed code',
  ].join('\n'),
  opaque: [
    '<div>合成块</div>',
    '',
    '合成 <i>内联</i>。',
    '',
    '[合成引用]: https://docs.example.invalid/reference',
    '[合成图片]: https://media.example.invalid/reference.png',
    '',
    '[链接][合成引用]',
    '',
    '![图片][合成图片]',
    '',
  ].join('\n'),
  extensionLooking: [
    '| 合成甲 | 合成乙 |',
    '| --- | --- |',
    '- [ ] 合成任务标记',
    'https://docs.example.invalid/bare',
    '~~合成删除线~~',
    '[^synthetic]',
    '',
  ].join('\n'),
  malformedAndEscaped: [
    '[未闭合](https://docs.example.invalid/item',
    '\\[转义标签](https://docs.example.invalid/escaped)',
    '',
  ].join('\n'),
});

export const WEEKLY_V1_SYNTHETIC_MARKDOWN = [
  '# 合成周报',
  '',
  '合成前言。',
  '',
  '## 科技动态',
  '',
  '1、合成条目甲',
  '',
  '正文内部 2、不是新条目。',
  '',
  '3、合成条目乙',
  '',
  '3、合成条目丙',
  '',
  '2、合成条目丁',
  '',
  '> 4、引用中的编号',
  '',
  '- 5、列表中的编号',
  '',
  '```text',
  '6、代码中的编号',
  '```',
  '',
  '## 工具',
  '',
  '合成无编号内容。',
  '',
  '## 封面图',
  '',
  '![合成封面](https://media.example.invalid/cover.png)',
  '',
  '## 往年回顾',
  '',
  '合成导航内容。',
  '',
  '## 自定义栏目',
  '',
  '合成自定义内容。',
  '',
].join('\n');

export interface SyntheticUrlInput {
  readonly id: string;
  readonly destination: string;
  readonly base?: string;
}

export const SYNTHETIC_LINK_URL_INPUTS: readonly SyntheticUrlInput[] =
  Object.freeze([
    Object.freeze({
      id: 'absolute-http',
      destination: 'HTTPS://DOCS.EXAMPLE.INVALID:443/a/../b?q=%7e',
    }),
    Object.freeze({
      id: 'relative-with-base',
      destination: '../asset?q=1#fragment',
      base: 'https://docs.example.invalid/a/b/index.md',
    }),
    Object.freeze({id: 'document-fragment', destination: '#fragment'}),
    Object.freeze({id: 'relative-without-base', destination: 'relative/item'}),
    Object.freeze({
      id: 'unsupported-scheme',
      destination: 'mailto:synthetic@example.invalid',
    }),
    Object.freeze({
      id: 'credentials',
      destination: 'https://synthetic:synthetic@example.invalid/item',
    }),
    Object.freeze({
      id: 'invalid-uri',
      destination: 'https://example.invalid:invalid/item',
      base: 'https://docs.example.invalid/a/b/index.md',
    }),
  ]);

export const SYNTHETIC_MEDIA_URL_INPUTS: readonly SyntheticUrlInput[] =
  Object.freeze([
    Object.freeze({
      id: 'canonical-first',
      destination: 'HTTPS://MEDIA.EXAMPLE.INVALID:443/a/../synthetic-image.png',
    }),
    Object.freeze({
      id: 'canonical-duplicate',
      destination: 'https://media.example.invalid/synthetic-image.png',
    }),
    Object.freeze({
      id: 'relative-with-base',
      destination: '../synthetic-image.png',
      base: 'https://media.example.invalid/a/b/source.md',
    }),
    Object.freeze({id: 'fragment-only', destination: '#synthetic-image'}),
    Object.freeze({
      id: 'relative-without-base',
      destination: 'synthetic-image.png',
    }),
    Object.freeze({
      id: 'invalid-uri',
      destination: 'https://example.invalid:invalid/image.png',
      base: 'https://media.example.invalid/source.md',
    }),
    Object.freeze({
      id: 'file-scheme',
      destination: 'file://example.invalid/synthetic-image.png',
    }),
    Object.freeze({
      id: 'data-scheme',
      destination: 'data:image/png;base64,c3ludGhldGlj',
    }),
    Object.freeze({
      id: 'javascript-scheme',
      destination: 'javascript:void(0)',
    }),
    Object.freeze({
      id: 'credentials',
      destination: 'https://synthetic:synthetic@example.invalid/image.png',
    }),
  ]);

export interface ClosedInputAttackCounter {
  getterCalls: number;
  setterCalls: number;
  getTrapCalls: number;
  ownKeysTrapCalls: number;
  descriptorTrapCalls: number;
}

export function createClosedInputAttackCounter(): ClosedInputAttackCounter {
  return {
    getterCalls: 0,
    setterCalls: 0,
    getTrapCalls: 0,
    ownKeysTrapCalls: 0,
    descriptorTrapCalls: 0,
  };
}

export function createInheritedRecord(): object {
  const prototype = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(prototype, 'inherited', {
    enumerable: true,
    value: 'synthetic-inherited-value',
  });
  return Object.create(prototype) as object;
}

export function createCustomPrototypeRecord(): object {
  return Object.create(Object.freeze({syntheticPrototype: true})) as object;
}

export function createAccessorRecord(
  counter: ClosedInputAttackCounter,
): object {
  const record = {} as Record<string, unknown>;
  Object.defineProperty(record, 'synthetic', {
    configurable: true,
    enumerable: true,
    get() {
      counter.getterCalls += 1;
      return 'synthetic-accessor-value';
    },
    set() {
      counter.setterCalls += 1;
    },
  });
  return record;
}

export function createProxyRecord(counter: ClosedInputAttackCounter): object {
  const target = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(target, 'synthetic', {
    enumerable: true,
    value: 'synthetic-proxy-value',
  });
  return new Proxy(target, {
    get(innerTarget, property, receiver) {
      counter.getTrapCalls += 1;
      return Reflect.get(innerTarget, property, receiver) as unknown;
    },
    getOwnPropertyDescriptor(innerTarget, property) {
      counter.descriptorTrapCalls += 1;
      return Reflect.getOwnPropertyDescriptor(innerTarget, property);
    },
    ownKeys(innerTarget) {
      counter.ownKeysTrapCalls += 1;
      return Reflect.ownKeys(innerTarget);
    },
  });
}

export function createSymbolKeyRecord(): object {
  const record = {} as Record<PropertyKey, unknown>;
  Object.defineProperty(record, Symbol('synthetic-symbol'), {
    configurable: true,
    enumerable: true,
    value: 'synthetic-symbol-value',
    writable: true,
  });
  return record;
}

export function createDangerousOwnKeyRecord(
  key: '__proto__' | 'constructor' | 'prototype',
): object {
  const record = {} as Record<string, unknown>;
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value: 'synthetic-dangerous-key-value',
    writable: true,
  });
  return record;
}

export function createSparseArray(): unknown[] {
  const values = new Array<unknown>(2);
  values[1] = 'synthetic-array-value';
  return values;
}

export function createArrayAccessor(
  counter: ClosedInputAttackCounter,
): unknown[] {
  const values = new Array<unknown>(1);
  Object.defineProperty(values, '0', {
    enumerable: true,
    get() {
      counter.getterCalls += 1;
      return 'synthetic-array-accessor-value';
    },
  });
  return values;
}

export function createArrayWithExtraProperty(): unknown[] {
  const values: unknown[] = ['synthetic-array-value'];
  Object.defineProperty(values, 'syntheticExtra', {
    enumerable: true,
    value: true,
  });
  return values;
}

export function createSharedByteView(): Uint8Array {
  return new Uint8Array(new SharedArrayBuffer(4));
}

export function createPartialByteView(): Uint8Array {
  return new Uint8Array(new ArrayBuffer(8), 2, 4);
}

export function createResizableByteView(): Uint8Array {
  const ResizableArrayBuffer = ArrayBuffer as unknown as new (
    byteLength: number,
    options: {maxByteLength: number},
  ) => ArrayBuffer;
  return new Uint8Array(
    new ResizableArrayBuffer(4, {
      maxByteLength: 8,
    }),
  );
}

export function createDetachedByteView(): Uint8Array {
  const buffer = new ArrayBuffer(4);
  const view = new Uint8Array(buffer);
  structuredClone(buffer, {transfer: [buffer]});
  return view;
}

export function createProxiedByteView(
  counter: ClosedInputAttackCounter,
): Uint8Array {
  return new Proxy(new Uint8Array(4), {
    get(target, property, receiver) {
      counter.getTrapCalls += 1;
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

export function createSubclassedByteView(): Uint8Array {
  class SyntheticUint8Array extends Uint8Array {}
  return new SyntheticUint8Array(4);
}

export const MARKDOWN_BUDGET_LIMITS = Object.freeze({
  sourceBytes: 1_048_576,
  nodes: 2_500,
  fragments: 2_000,
  depth: 64,
  links: 10_000,
  media: 1_000,
  diagnostics: 10_000,
  canonicalStructureBytes: 16_777_216,
  canonicalJsonValues: 100_000,
});

export type MaximumLegalMarkdownNodeKind =
  'document' | 'section' | 'heading' | 'paragraph';

export interface MaximumLegalMarkdownLedgerNode {
  readonly path: string;
  readonly parentPath: string | null;
  readonly kind: MaximumLegalMarkdownNodeKind;
  readonly siblingOrdinal: number;
  readonly codePointStart: number;
  readonly codePointEnd: number;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly hasFragment: boolean;
}

export interface MaximumLegalMarkdownLedger {
  readonly normalizedText: string;
  readonly nodes: readonly MaximumLegalMarkdownLedgerNode[];
}

/**
 * Builds a maximum-count legal CommonMark ledger without calling product code.
 *
 * The source contains 500 document-flow H1 sections. Their 500 headings and
 * 1,499 paragraphs are the 1,999 leaf nodes; together with the document
 * Fragment they produce exactly 2,000 Fragments. The 500 non-target synthetic
 * sections bring the node count to 2,500 without manufacturing a Fragment.
 */
export function createMaximumLegalMarkdownLedger(): MaximumLegalMarkdownLedger {
  const fragmentLeafCount = MARKDOWN_BUDGET_LIMITS.fragments - 1;
  const sectionCount =
    MARKDOWN_BUDGET_LIMITS.nodes - MARKDOWN_BUDGET_LIMITS.fragments;
  const paragraphCount = fragmentLeafCount - sectionCount;
  const baseParagraphsPerSection = Math.floor(paragraphCount / sectionCount);
  const sectionsWithExtraParagraph = paragraphCount % sectionCount;
  const sourceChunks: string[] = [];
  const sectionEntries: {
    readonly node: MaximumLegalMarkdownLedgerNode;
    readonly leaves: readonly MaximumLegalMarkdownLedgerNode[];
  }[] = [];
  let codePointOffset = 0;
  let line = 1;
  let paragraphOrdinal = 0;

  const appendLeaf = (
    content: string,
    path: string,
    parentPath: string,
    kind: 'heading' | 'paragraph',
    siblingOrdinal: number,
  ): MaximumLegalMarkdownLedgerNode => {
    const codePointStart = codePointOffset;
    const lineStart = line;
    sourceChunks.push(content, '\n\n');
    codePointOffset += Array.from(content).length;
    const codePointEnd = codePointOffset;
    codePointOffset += 2;
    line += 2;
    return Object.freeze({
      path,
      parentPath,
      kind,
      siblingOrdinal,
      codePointStart,
      codePointEnd,
      lineStart,
      lineEnd: lineStart,
      hasFragment: true,
    });
  };

  for (
    let sectionOrdinal = 0;
    sectionOrdinal < sectionCount;
    sectionOrdinal += 1
  ) {
    const sectionPath = `n/0/${String(sectionOrdinal)}`;
    const sectionCodePointStart = codePointOffset;
    const sectionLineStart = line;
    const leaves: MaximumLegalMarkdownLedgerNode[] = [];
    leaves.push(
      appendLeaf(
        `# synthetic-heading-${String(sectionOrdinal)}`,
        `${sectionPath}/0`,
        sectionPath,
        'heading',
        0,
      ),
    );
    const paragraphsInSection =
      baseParagraphsPerSection +
      (sectionOrdinal < sectionsWithExtraParagraph ? 1 : 0);
    for (
      let paragraphIndex = 0;
      paragraphIndex < paragraphsInSection;
      paragraphIndex += 1
    ) {
      leaves.push(
        appendLeaf(
          `synthetic-paragraph-${String(paragraphOrdinal)}`,
          `${sectionPath}/${String(paragraphIndex + 1)}`,
          sectionPath,
          'paragraph',
          paragraphIndex + 1,
        ),
      );
      paragraphOrdinal += 1;
    }
    sectionEntries.push(
      Object.freeze({
        node: Object.freeze({
          path: sectionPath,
          parentPath: 'n/0',
          kind: 'section',
          siblingOrdinal: sectionOrdinal,
          codePointStart: sectionCodePointStart,
          codePointEnd: codePointOffset,
          lineStart: sectionLineStart,
          lineEnd: line - 1,
          hasFragment: false,
        }),
        leaves: Object.freeze(leaves),
      }),
    );
  }

  const normalizedText = sourceChunks.join('');
  const nodes = Object.freeze([
    Object.freeze({
      path: 'n/0',
      parentPath: null,
      kind: 'document',
      siblingOrdinal: 0,
      codePointStart: 0,
      codePointEnd: codePointOffset,
      lineStart: 1,
      lineEnd: line - 1,
      hasFragment: true,
    }),
    ...sectionEntries.flatMap(({node, leaves}) => [node, ...leaves]),
  ]);
  return Object.freeze({normalizedText, nodes});
}

function requireNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}

export function bytesFromHex(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/u.test(hex)) {
    throw new TypeError(
      'Synthetic fixture hex must be lowercase and complete.',
    );
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function createRawCoreSourceUtf8(): Uint8Array {
  return bytesFromHex(RAW_CORE_RAW_UTF8_HEX);
}

export function createSourceBudgetUtf8(byteLength: number): Uint8Array {
  requireNonNegativeInteger(byteLength, 'byteLength');
  const bytes = new Uint8Array(byteLength);
  bytes.fill(0x78);
  return bytes;
}

export function createNodeBudgetMarkdown(mappedNodeCount: number): string {
  requireNonNegativeInteger(mappedNodeCount, 'mappedNodeCount');
  if (mappedNodeCount < 2) {
    throw new RangeError('Node budget fixture requires a root and one node.');
  }
  return `${Array.from({length: mappedNodeCount - 1}, () => '---').join(
    '\n\n',
  )}\n`;
}

export function createFragmentBudgetMarkdown(fragmentCount: number): string {
  requireNonNegativeInteger(fragmentCount, 'fragmentCount');
  if (fragmentCount < 2) {
    throw new RangeError(
      'Fragment budget fixture requires document and leaf Fragments.',
    );
  }
  return `${Array.from(
    {length: fragmentCount - 1},
    (_, index) => `synthetic paragraph ${String(index)}`,
  ).join('\n\n')}\n`;
}

export function createLinkBudgetMarkdown(linkCount: number): string {
  requireNonNegativeInteger(linkCount, 'linkCount');
  return `${Array.from(
    {length: linkCount},
    () => '[x](https://link.example.invalid/item)',
  ).join(' ')}\n`;
}

export function createMediaBudgetMarkdown(mediaCount: number): string {
  requireNonNegativeInteger(mediaCount, 'mediaCount');
  return `${Array.from(
    {length: mediaCount},
    () => '![x](https://media.example.invalid/item.png)',
  ).join(' ')}\n`;
}

export function createDiagnosticBudgetMarkdown(
  diagnosticCount: number,
): string {
  requireNonNegativeInteger(diagnosticCount, 'diagnosticCount');
  return `${'<x>'.repeat(diagnosticCount)}\n`;
}

export type DepthBudgetLeaf = 'paragraph' | 'image';

export function createDepthBudgetMarkdown(
  deepestMappedNodeDepth: number,
  leaf: DepthBudgetLeaf,
): string {
  requireNonNegativeInteger(deepestMappedNodeDepth, 'deepestMappedNodeDepth');
  const leafDepthWithinContainer = leaf === 'paragraph' ? 1 : 2;
  if (deepestMappedNodeDepth < leafDepthWithinContainer) {
    throw new RangeError('Requested depth cannot contain the selected leaf.');
  }
  const blockquoteCount = deepestMappedNodeDepth - leafDepthWithinContainer;
  const content =
    leaf === 'paragraph'
      ? 'synthetic depth leaf'
      : '![x](https://media.example.invalid/depth.png)';
  return `${'> '.repeat(blockquoteCount)}${content}\n`;
}

export const DEPTH_SEMANTICS_FIXTURES = Object.freeze({
  syntheticSection: '# 合成深度标题\n',
  imageInParagraph: '![x](https://media.example.invalid/depth.png)\n',
});

export const ALL_STATIC_SYNTHETIC_TEXTS = Object.freeze([
  RAW_CORE_LOGICAL_SOURCE,
  RAW_CORE_NORMALIZED_TEXT,
  ...Object.values(COMMONMARK_SYNTHETIC_FIXTURES),
  WEEKLY_V1_SYNTHETIC_MARKDOWN,
  ...SYNTHETIC_LINK_URL_INPUTS.flatMap(({destination, base}) =>
    base === undefined ? [destination] : [destination, base],
  ),
  ...SYNTHETIC_MEDIA_URL_INPUTS.flatMap(({destination, base}) =>
    base === undefined ? [destination] : [destination, base],
  ),
  ...Object.values(DEPTH_SEMANTICS_FIXTURES),
]);
