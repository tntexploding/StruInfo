export const RAW_CORE_CONTEXT_ORACLE = Object.freeze({
  workspaceId: '00000000-0000-0000-0000-000000000101',
  resourceId: '00000000-0000-0000-0000-000000000102',
  snapshotId: '00000000-0000-0000-0000-000000000103',
  profile: 'commonmark-v1',
  parserName: 'struinfo-commonmark',
  parserVersion: '1',
  normalizationVersion: 'utf8-lf-v1',
  projectionVersion: 'markdown-structure-v1',
});

export const RAW_CORE_BYTE_ORACLE = Object.freeze({
  rawUtf8Hex:
    'efbbbf2320e59088e688900d0a0d0ae6aeb5e890bdf09f98802065cc8120c3a90de69cabe8a18c0a',
  rawByteLength: 40,
  rawSha256: 'c2eb1731663ca0237135b8d2e424d1f3cd4b3fa201696b187758d1f9586ad6c6',
  rawBlobId: '269425c0-7059-5137-a280-0379c77b97ee',
  normalizedText: '# 合成\n\n段落😀 e\u0301 é\n末行\n',
  normalizedUtf8Hex:
    '2320e59088e688900a0ae6aeb5e890bdf09f98802065cc8120c3a90ae69cabe8a18c0a',
  normalizedByteLength: 35,
  normalizedSha256:
    '6131f27950e9817f6ecc32d814d43c09bbf5825b9af728dddd7f58d6732f74f6',
  normalizedBlobId: '56efd2be-3333-5757-89ab-e3e00a5fbdc5',
  utf16Length: 19,
  codePointLength: 18,
});

export const BOM_NORMALIZATION_ORACLE = Object.freeze({
  'single-leading-bom': '78',
  'double-leading-bom': 'efbbbf78',
  'non-leading-bom': '78efbbbf79',
});

export interface FrozenCodePointLedgerEntry {
  readonly codePointIndex: number;
  readonly scalar: string;
  readonly utf16Start: number;
  readonly utf16End: number;
  readonly line: number;
}

export const RAW_CORE_CODE_POINT_LEDGER: readonly FrozenCodePointLedgerEntry[] =
  Object.freeze([
    Object.freeze({
      codePointIndex: 0,
      scalar: 'U+0023',
      utf16Start: 0,
      utf16End: 1,
      line: 1,
    }),
    Object.freeze({
      codePointIndex: 1,
      scalar: 'U+0020',
      utf16Start: 1,
      utf16End: 2,
      line: 1,
    }),
    Object.freeze({
      codePointIndex: 2,
      scalar: 'U+5408',
      utf16Start: 2,
      utf16End: 3,
      line: 1,
    }),
    Object.freeze({
      codePointIndex: 3,
      scalar: 'U+6210',
      utf16Start: 3,
      utf16End: 4,
      line: 1,
    }),
    Object.freeze({
      codePointIndex: 4,
      scalar: 'U+000A',
      utf16Start: 4,
      utf16End: 5,
      line: 1,
    }),
    Object.freeze({
      codePointIndex: 5,
      scalar: 'U+000A',
      utf16Start: 5,
      utf16End: 6,
      line: 2,
    }),
    Object.freeze({
      codePointIndex: 6,
      scalar: 'U+6BB5',
      utf16Start: 6,
      utf16End: 7,
      line: 3,
    }),
    Object.freeze({
      codePointIndex: 7,
      scalar: 'U+843D',
      utf16Start: 7,
      utf16End: 8,
      line: 3,
    }),
    Object.freeze({
      codePointIndex: 8,
      scalar: 'U+1F600',
      utf16Start: 8,
      utf16End: 10,
      line: 3,
    }),
    Object.freeze({
      codePointIndex: 9,
      scalar: 'U+0020',
      utf16Start: 10,
      utf16End: 11,
      line: 3,
    }),
    Object.freeze({
      codePointIndex: 10,
      scalar: 'U+0065',
      utf16Start: 11,
      utf16End: 12,
      line: 3,
    }),
    Object.freeze({
      codePointIndex: 11,
      scalar: 'U+0301',
      utf16Start: 12,
      utf16End: 13,
      line: 3,
    }),
    Object.freeze({
      codePointIndex: 12,
      scalar: 'U+0020',
      utf16Start: 13,
      utf16End: 14,
      line: 3,
    }),
    Object.freeze({
      codePointIndex: 13,
      scalar: 'U+00E9',
      utf16Start: 14,
      utf16End: 15,
      line: 3,
    }),
    Object.freeze({
      codePointIndex: 14,
      scalar: 'U+000A',
      utf16Start: 15,
      utf16End: 16,
      line: 3,
    }),
    Object.freeze({
      codePointIndex: 15,
      scalar: 'U+672B',
      utf16Start: 16,
      utf16End: 17,
      line: 4,
    }),
    Object.freeze({
      codePointIndex: 16,
      scalar: 'U+884C',
      utf16Start: 17,
      utf16End: 18,
      line: 4,
    }),
    Object.freeze({
      codePointIndex: 17,
      scalar: 'U+000A',
      utf16Start: 18,
      utf16End: 19,
      line: 4,
    }),
  ]);

export const RAW_CORE_UTF16_BOUNDARY_TO_CODE_POINT = Object.freeze([
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  null,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
]);

export const RAW_CORE_NODE_ORACLE = Object.freeze([
  Object.freeze({
    localKey: 'n/0',
    parentLocalKey: null,
    kind: 'document',
    siblingOrdinal: 0,
    codePointRange: Object.freeze({start: 0, end: 18}),
    lineRange: Object.freeze({start: 1, end: 4}),
  }),
  Object.freeze({
    localKey: 'n/0/0',
    parentLocalKey: 'n/0',
    kind: 'section',
    siblingOrdinal: 0,
    codePointRange: Object.freeze({start: 0, end: 18}),
    lineRange: Object.freeze({start: 1, end: 4}),
  }),
  Object.freeze({
    localKey: 'n/0/0/0',
    parentLocalKey: 'n/0/0',
    kind: 'heading',
    siblingOrdinal: 0,
    codePointRange: Object.freeze({start: 0, end: 4}),
    lineRange: Object.freeze({start: 1, end: 1}),
  }),
  Object.freeze({
    localKey: 'n/0/0/1',
    parentLocalKey: 'n/0/0',
    kind: 'paragraph',
    siblingOrdinal: 1,
    codePointRange: Object.freeze({start: 6, end: 17}),
    lineRange: Object.freeze({start: 3, end: 4}),
  }),
]);

export const RAW_CORE_FRAGMENT_ORACLE = Object.freeze([
  Object.freeze({
    localKey: 'f/n/0',
    nodeLocalKey: 'n/0',
    role: 'document',
    codePointRange: Object.freeze({start: 0, end: 18}),
    lineRange: Object.freeze({start: 1, end: 4}),
    selectedTextSha256:
      '6131f27950e9817f6ecc32d814d43c09bbf5825b9af728dddd7f58d6732f74f6',
  }),
  Object.freeze({
    localKey: 'f/n/0/0/0',
    nodeLocalKey: 'n/0/0/0',
    role: 'leaf',
    codePointRange: Object.freeze({start: 0, end: 4}),
    lineRange: Object.freeze({start: 1, end: 1}),
    selectedTextSha256:
      '05338638991f42d6b01d2e688a790492d11edb5be84590133878dc88671c0961',
  }),
  Object.freeze({
    localKey: 'f/n/0/0/1',
    nodeLocalKey: 'n/0/0/1',
    role: 'leaf',
    codePointRange: Object.freeze({start: 6, end: 17}),
    lineRange: Object.freeze({start: 3, end: 4}),
    selectedTextSha256:
      '8a0fb2d2427930f819e6285495c99346e3b7b16e57de32ed46042920260624ec',
  }),
]);

export const RAW_CORE_CANONICAL_PROJECTION = Object.freeze({
  projection: 'markdown-structure-v1',
  parser: Object.freeze({name: 'struinfo-commonmark', version: '1'}),
  text: Object.freeze({
    normalizationVersion: 'utf8-lf-v1',
    sha256: '6131f27950e9817f6ecc32d814d43c09bbf5825b9af728dddd7f58d6732f74f6',
    byteLength: 35,
  }),
  nodes: Object.freeze([
    Object.freeze({
      path: 'n/0',
      parentPath: null,
      kind: 'document',
      siblingOrdinal: 0,
      codePointStart: 0,
      codePointEnd: 18,
      lineStart: 1,
      lineEnd: 4,
    }),
    Object.freeze({
      path: 'n/0/0',
      parentPath: 'n/0',
      kind: 'section',
      siblingOrdinal: 0,
      codePointStart: 0,
      codePointEnd: 18,
      lineStart: 1,
      lineEnd: 4,
    }),
    Object.freeze({
      path: 'n/0/0/0',
      parentPath: 'n/0/0',
      kind: 'heading',
      siblingOrdinal: 0,
      codePointStart: 0,
      codePointEnd: 4,
      lineStart: 1,
      lineEnd: 1,
    }),
    Object.freeze({
      path: 'n/0/0/1',
      parentPath: 'n/0/0',
      kind: 'paragraph',
      siblingOrdinal: 1,
      codePointStart: 6,
      codePointEnd: 17,
      lineStart: 3,
      lineEnd: 4,
    }),
  ]),
  fragments: Object.freeze([
    Object.freeze({
      nodePath: 'n/0',
      locatorKind: 'unicode_code_point_range',
      locatorVersion: 1,
      codePointStart: 0,
      codePointEnd: 18,
      lineStart: 1,
      lineEnd: 4,
      selectedTextSha256:
        '6131f27950e9817f6ecc32d814d43c09bbf5825b9af728dddd7f58d6732f74f6',
    }),
    Object.freeze({
      nodePath: 'n/0/0/0',
      locatorKind: 'unicode_code_point_range',
      locatorVersion: 1,
      codePointStart: 0,
      codePointEnd: 4,
      lineStart: 1,
      lineEnd: 1,
      selectedTextSha256:
        '05338638991f42d6b01d2e688a790492d11edb5be84590133878dc88671c0961',
    }),
    Object.freeze({
      nodePath: 'n/0/0/1',
      locatorKind: 'unicode_code_point_range',
      locatorVersion: 1,
      codePointStart: 6,
      codePointEnd: 17,
      lineStart: 3,
      lineEnd: 4,
      selectedTextSha256:
        '8a0fb2d2427930f819e6285495c99346e3b7b16e57de32ed46042920260624ec',
    }),
  ]),
});

export const RAW_CORE_STRUCTURE_ORACLE = Object.freeze({
  canonicalByteLength: 1_498,
  structureSha256:
    '984a78cfabbb545264ca96c330e485400ed0c0e181cd627efc5b8b94cb824def',
  structureId: 'f0cfba2d-2238-58c9-86e6-631440f594b0',
});

export const RAW_CORE_ENTITY_UUID_ORACLE = Object.freeze({
  nodes: Object.freeze({
    'n/0': '41ade691-9cf8-582a-9a82-b3f657841681',
    'n/0/0': 'a473c33e-6e57-5cc6-bc0a-ebe88e8c13e1',
    'n/0/0/0': '74d5ddf8-0ad9-5f5a-afbd-7bbeb9b737f5',
    'n/0/0/1': 'd8930e86-2762-5c7e-ba76-e54fcdb1a176',
  }),
  fragments: Object.freeze({
    'f/n/0': '97f828c2-b17f-5173-953e-516a715b8eec',
    'f/n/0/0/0': '26e0bd8d-5364-57cf-bee8-cb119bf254e4',
    'f/n/0/0/1': 'c3349caf-e05c-55de-8a4c-668481bd7a7f',
  }),
});

export const CONTRACT_UUID_KNOWN_ANSWER = Object.freeze({
  workspaceId: '00000000-0000-0000-0000-000000000001',
  snapshotId: '00000000-0000-0000-0000-000000000002',
  normalizedDigest:
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  structureDigest:
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  normalizedBlobId: '19e7290a-332e-5f8e-af0d-fbb8f608a4f0',
  structureId: '32eb3cce-4a45-507e-972c-1094676afe9e',
  nodeRootId: '68ac02ca-3d54-54ec-a580-780c78bacd98',
  nodeChildId: '3de7ce3d-2524-578b-b801-d31e015792d9',
  fragmentChildId: '2526b3aa-8e94-5d16-9356-5d713e97b9f6',
});

export const LINK_URL_ORACLE = Object.freeze({
  'absolute-http': Object.freeze({
    status: 'resolved',
    href: 'https://docs.example.invalid/b?q=%7e',
  }),
  'relative-with-base': Object.freeze({
    status: 'resolved',
    href: 'https://docs.example.invalid/a/asset?q=1#fragment',
  }),
  'document-fragment': Object.freeze({
    status: 'not_resolved',
    reason: 'document_fragment',
  }),
  'relative-without-base': Object.freeze({
    status: 'not_resolved',
    reason: 'relative_without_base',
  }),
  'unsupported-scheme': Object.freeze({
    status: 'not_resolved',
    reason: 'unsupported_scheme',
  }),
  credentials: Object.freeze({
    status: 'not_resolved',
    reason: 'credentials_not_allowed',
  }),
  'invalid-uri': Object.freeze({
    status: 'not_resolved',
    reason: 'invalid_uri',
  }),
});

export const MEDIA_URL_ORACLE = Object.freeze({
  'canonical-first': Object.freeze({
    status: 'resolved',
    href: 'https://media.example.invalid/synthetic-image.png',
  }),
  'canonical-duplicate': Object.freeze({
    status: 'resolved',
    href: 'https://media.example.invalid/synthetic-image.png',
  }),
  'relative-with-base': Object.freeze({
    status: 'resolved',
    href: 'https://media.example.invalid/a/synthetic-image.png',
  }),
  'fragment-only': Object.freeze({
    status: 'rejected',
    code: 'invalid_media_reference',
  }),
  'relative-without-base': Object.freeze({
    status: 'rejected',
    code: 'invalid_media_reference',
  }),
  'invalid-uri': Object.freeze({
    status: 'rejected',
    code: 'invalid_media_reference',
  }),
  'file-scheme': Object.freeze({
    status: 'rejected',
    code: 'unsafe_media_scheme',
  }),
  'data-scheme': Object.freeze({
    status: 'rejected',
    code: 'unsafe_media_scheme',
  }),
  'javascript-scheme': Object.freeze({
    status: 'rejected',
    code: 'unsafe_media_scheme',
  }),
  credentials: Object.freeze({
    status: 'rejected',
    code: 'unsafe_media_scheme',
  }),
});

export const DEPTH_ORACLE = Object.freeze({
  rootDepth: 0,
  maximumDepth: 64,
  syntheticSectionDepth: 1,
  headingUnderSectionDepth: 2,
  paragraphDepth: 1,
  imageUnderParagraphDepth: 2,
});

export const MAXIMUM_PROJECTION_ORACLE = Object.freeze({
  nodeCount: 2_500,
  fragmentCount: 2_000,
  maximumLegalSectionCount: 500,
  maximumLegalHeadingCount: 500,
  maximumLegalParagraphCount: 1_499,
  maximumLegalDepth: 2,
  scalarFieldsPerNode: 8,
  scalarFieldsPerFragment: 8,
  maximumNodePathBytes: 323,
  canonicalJsonValues: 40_511,
  canonicalJsonValueLimit: 100_000,
  maximumLegalCanonicalBytes: 883_134,
  conservativeNodeBytes: 805,
  conservativeFragmentBytes: 572,
  conservativeCanonicalByteUpperBound: 3_161_273,
  canonicalByteLimit: 16_777_216,
  conservativeCanonicalByteHeadroom: 13_615_943,
});

export const ADMITTED_PARSER_ARTIFACT_ORACLE = Object.freeze({
  version: '2.0.3',
  lockIntegritySha512:
    'W4mAWTvSlKvf8L6J+VN9yLSqQ9AOAAvHuoDAmPkz4dHf553m5gVj2ejadHJhoJmcmxEnOv6Pa8XJhpxE93kb8Q==',
  licenseSha256:
    'DD1081884A92952802F4803110A6BB543ACEA9A814C786D58605B4C1219B5EBB',
  tarballSha256:
    'ADC7944BEB265A36CBC8B3F0AD019BC939F56EB11AB9CEFCCC964392E0B9597D',
  license: 'MIT',
  packageUrl: 'pkg:npm/mdast-util-from-markdown@2.0.3',
  downloadLocation:
    'https://registry.npmjs.org/mdast-util-from-markdown/-/mdast-util-from-markdown-2.0.3.tgz',
});
