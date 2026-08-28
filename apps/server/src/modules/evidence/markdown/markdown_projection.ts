import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

import {
  DOCUMENT_NODE_KINDS,
  type DocumentNodeInput,
  type DocumentStructureInput,
  type FragmentInput,
  type SnapshotInput,
} from '../evidence_contract.js';
import {
  CanonicalJsonError,
  encodeCanonicalJson,
} from '../../../serialization/canonical_json.js';
import {
  MARKDOWN_BUDGETS,
  MARKDOWN_PARSER_NAMES,
  MARKDOWN_PARSER_VERSION,
  MARKDOWN_STRUCTURE_PROJECTION_VERSION,
  MARKDOWN_TEXT_NORMALIZATION_VERSION,
  PARSED_FRAGMENT_ROLES,
  type MarkdownParserName,
  type ParsedMarkdownFragment,
  type ParsedMarkdownNode,
} from './markdown_contract.js';
import {MarkdownFault, markdownFail} from './markdown_failure.js';
import {
  SHA256_PATTERN,
  deriveDocumentNodeId,
  deriveDocumentStructureId,
  deriveEvidenceBlobId,
  deriveFragmentId,
} from './markdown_identity.js';
import {
  indexMarkdownText,
  lineRangeFromIndex,
  type IndexedMarkdownText,
} from './markdown_line_index.js';

export {deriveLineRange} from './markdown_line_index.js';

const fragmentKinds = new Set(['heading', 'paragraph', 'code_block', 'image']);

export interface MarkdownStructureProjectionSource {
  readonly parserName: MarkdownParserName;
  readonly parserVersion: typeof MARKDOWN_PARSER_VERSION;
  readonly textNormalizationVersion: typeof MARKDOWN_TEXT_NORMALIZATION_VERSION;
  readonly normalizedTextSha256: string;
  readonly normalizedTextByteLength: number;
  readonly nodes: readonly Readonly<ParsedMarkdownNode>[];
  readonly fragments: readonly Readonly<ParsedMarkdownFragment>[];
  readonly intakeTargetNodeKeys: readonly string[];
}

export type FixedMarkdownEvidenceCheck =
  | Readonly<{status: 'not_applicable'}>
  | Readonly<{status: 'valid'}>
  | Readonly<{status: 'invalid'; path: string}>;

interface TreeNode {
  readonly identity: string;
  readonly parentIdentity?: string;
  readonly suppliedPath?: string;
  readonly kind: string;
  readonly siblingOrdinal: number;
  readonly codePointStart: number;
  readonly codePointEnd: number;
  readonly lineStart: number;
  readonly lineEnd: number;
}

interface TreeIndex {
  readonly preorder: readonly TreeNode[];
  readonly pathByIdentity: ReadonlyMap<string, string>;
  readonly preorderIndexByIdentity: ReadonlyMap<string, number>;
  readonly maximumDepth: number;
}

interface ProjectionFragment {
  readonly identity: string;
  readonly nodeIdentity: string;
  readonly suppliedLocalKey?: string;
  readonly codePointStart: number;
  readonly codePointEnd: number;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly selectedTextSha256: string;
}

export function computeMarkdownStructureSha256(
  source: Readonly<MarkdownStructureProjectionSource>,
  normalizedText: string,
): string {
  return computeMarkdownStructureSha256WithTextIndex(
    source,
    indexMarkdownText(normalizedText),
  );
}

export function computeMarkdownStructureSha256WithTextIndex(
  source: Readonly<MarkdownStructureProjectionSource>,
  textIndex: Readonly<IndexedMarkdownText>,
): string {
  const tree = validateParsedTree(source.nodes, textIndex);
  validateIntakeTargets(source, tree);
  const fragments = validateParsedFragments(source, tree, textIndex.codePoints);
  return hashProjection(
    source.parserName,
    source.parserVersion,
    source.textNormalizationVersion,
    source.normalizedTextSha256,
    source.normalizedTextByteLength,
    tree,
    fragments,
  );
}

export function validateFixedMarkdownEvidenceStructure(
  structure: Readonly<DocumentStructureInput>,
  snapshot: Readonly<SnapshotInput>,
  normalizedText: string,
): FixedMarkdownEvidenceCheck {
  if (!isFixedParserName(structure.parserName)) {
    return Object.freeze({status: 'not_applicable'});
  }
  return validateFixedMarkdownEvidenceStructureWithTextIndex(
    structure,
    snapshot,
    indexMarkdownText(normalizedText),
  );
}

export function validateFixedMarkdownEvidenceStructureWithTextIndex(
  structure: Readonly<DocumentStructureInput>,
  snapshot: Readonly<SnapshotInput>,
  textIndex: Readonly<IndexedMarkdownText>,
): FixedMarkdownEvidenceCheck {
  if (!isFixedParserName(structure.parserName)) {
    return Object.freeze({status: 'not_applicable'});
  }
  try {
    if (
      structure.parserVersion !== MARKDOWN_PARSER_VERSION ||
      structure.textNormalizationVersion !==
        MARKDOWN_TEXT_NORMALIZATION_VERSION ||
      snapshot.workspaceId !== structure.workspaceId ||
      snapshot.resourceId !== structure.resourceId ||
      snapshot.snapshotId !== structure.snapshotId ||
      snapshot.rawBlob?.digest === undefined ||
      snapshot.rawSha256 !== snapshot.rawBlob.digest ||
      snapshot.canonicalContentSha256 !== structure.textBlob.digest ||
      snapshot.canonicalizationVersion !==
        MARKDOWN_TEXT_NORMALIZATION_VERSION ||
      snapshot.rawBlob.blobId !==
        deriveEvidenceBlobId(snapshot.workspaceId, snapshot.rawBlob.digest) ||
      structure.textBlob.blobId !==
        deriveEvidenceBlobId(structure.workspaceId, structure.textBlob.digest)
    ) {
      return Object.freeze({status: 'invalid', path: 'snapshot'});
    }
    const tree = validateEvidenceTree(structure.nodes, textIndex);
    const fragments = validateEvidenceFragments(
      structure.fragments,
      tree,
      textIndex.codePoints,
    );
    const calculatedDigest = hashProjection(
      structure.parserName,
      MARKDOWN_PARSER_VERSION,
      MARKDOWN_TEXT_NORMALIZATION_VERSION,
      structure.textBlob.digest,
      structure.textBlob.byteLength,
      tree,
      fragments,
    );
    if (calculatedDigest !== structure.structureSha256) {
      return Object.freeze({
        status: 'invalid',
        path: 'structure.structureSha256',
      });
    }
    const expectedStructureId = deriveDocumentStructureId(
      structure.snapshotId,
      structure.parserName,
      structure.parserVersion,
      structure.textNormalizationVersion,
      calculatedDigest,
    );
    if (structure.structureId !== expectedStructureId) {
      return Object.freeze({
        status: 'invalid',
        path: 'structure.structureId',
      });
    }
    for (const node of structure.nodes) {
      const path = tree.pathByIdentity.get(node.nodeId);
      if (
        path === undefined ||
        node.nodeId !== deriveDocumentNodeId(structure.structureId, path)
      ) {
        return Object.freeze({
          status: 'invalid',
          path: 'structure.nodes',
        });
      }
    }
    for (const fragment of structure.fragments) {
      const nodePath = tree.pathByIdentity.get(fragment.nodeId);
      if (
        nodePath === undefined ||
        fragment.fragmentId !==
          deriveFragmentId(structure.structureId, `f/${nodePath}`)
      ) {
        return Object.freeze({
          status: 'invalid',
          path: 'structure.fragments',
        });
      }
    }
    return Object.freeze({status: 'valid'});
  } catch {
    return Object.freeze({status: 'invalid', path: 'structure'});
  }
}

function validateParsedTree(
  nodes: readonly Readonly<ParsedMarkdownNode>[],
  textIndex: Readonly<IndexedMarkdownText>,
): TreeIndex {
  const projected = nodes.map((node) => ({
    identity: node.localKey,
    ...(node.parentLocalKey === undefined
      ? {}
      : {parentIdentity: node.parentLocalKey}),
    suppliedPath: node.localKey,
    kind: node.kind,
    siblingOrdinal: node.siblingOrdinal,
    codePointStart: node.codePointRange.start,
    codePointEnd: node.codePointRange.end,
    lineStart: node.lineRange.start,
    lineEnd: node.lineRange.end,
  }));
  return validateTree(projected, textIndex);
}

function validateEvidenceTree(
  nodes: readonly Readonly<DocumentNodeInput>[],
  textIndex: Readonly<IndexedMarkdownText>,
): TreeIndex {
  const projected = nodes.map((node) => ({
    identity: node.nodeId,
    ...(node.parentNodeId === undefined
      ? {}
      : {parentIdentity: node.parentNodeId}),
    kind: node.kind,
    siblingOrdinal: node.siblingOrdinal,
    codePointStart: node.codePointRange.start,
    codePointEnd: node.codePointRange.end,
    lineStart: node.lineRange?.start ?? 0,
    lineEnd: node.lineRange?.end ?? 0,
  }));
  if (nodes.some((node) => node.lineRange === undefined)) {
    markdownFail('invalid_tree', '$.nodes');
  }
  return validateTree(projected, textIndex);
}

function validateTree(
  nodes: readonly TreeNode[],
  textIndex: Readonly<IndexedMarkdownText>,
): TreeIndex {
  if (nodes.length === 0) {
    markdownFail('invalid_tree', '$.nodes');
  }
  const byIdentity = new Map<string, TreeNode>();
  const children = new Map<string, TreeNode[]>();
  const roots: TreeNode[] = [];
  for (const node of nodes) {
    if (
      node.identity === '' ||
      byIdentity.has(node.identity) ||
      !isOneOf(DOCUMENT_NODE_KINDS, node.kind) ||
      !Number.isSafeInteger(node.siblingOrdinal) ||
      node.siblingOrdinal < 0
    ) {
      markdownFail('invalid_tree', '$.nodes');
    }
    validateRangeAndLine(node, textIndex, 'invalid_tree', '$.nodes');
    byIdentity.set(node.identity, node);
  }
  for (const node of nodes) {
    if (node.parentIdentity === undefined) {
      roots.push(node);
      continue;
    }
    const parent = byIdentity.get(node.parentIdentity);
    if (
      parent === undefined ||
      parent.identity === node.identity ||
      node.codePointStart < parent.codePointStart ||
      node.codePointEnd > parent.codePointEnd
    ) {
      markdownFail('invalid_tree', '$.nodes');
    }
    const siblings = children.get(parent.identity) ?? [];
    siblings.push(node);
    children.set(parent.identity, siblings);
  }
  const root = roots[0];
  if (
    roots.length !== 1 ||
    root?.kind !== 'document' ||
    root.siblingOrdinal !== 0 ||
    root.codePointStart !== 0 ||
    root.codePointEnd !== textIndex.codePoints.length
  ) {
    markdownFail('invalid_tree', '$.nodes');
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => left.siblingOrdinal - right.siblingOrdinal);
    for (const [index, child] of siblings.entries()) {
      const previous = siblings[index - 1];
      if (
        child.siblingOrdinal !== index ||
        (previous !== undefined && previous.codePointEnd > child.codePointStart)
      ) {
        markdownFail('invalid_tree', '$.nodes');
      }
    }
  }
  const preorder: TreeNode[] = [];
  const pathByIdentity = new Map<string, string>();
  const preorderIndexByIdentity = new Map<string, number>();
  const active = new Set<string>();
  let maximumDepth = 0;
  const visit = (node: TreeNode, path: string, depth: number): void => {
    if (active.has(node.identity) || pathByIdentity.has(node.identity)) {
      markdownFail('invalid_tree', '$.nodes');
    }
    if (depth > MARKDOWN_BUDGETS.depth) {
      markdownFail('limit_exceeded', '$.nodes', {budget: 'depth'});
    }
    active.add(node.identity);
    pathByIdentity.set(node.identity, path);
    preorderIndexByIdentity.set(node.identity, preorder.length);
    preorder.push(node);
    maximumDepth = Math.max(maximumDepth, depth);
    for (const child of children.get(node.identity) ?? []) {
      visit(child, `${path}/${String(child.siblingOrdinal)}`, depth + 1);
    }
    active.delete(node.identity);
  };
  visit(root, 'n/0', 0);
  if (
    preorder.length !== nodes.length ||
    !preorder.every((node, index) => node.identity === nodes[index]?.identity)
  ) {
    markdownFail('invalid_tree', '$.nodes');
  }
  for (const node of preorder) {
    const path = pathByIdentity.get(node.identity);
    if (
      path === undefined ||
      (node.suppliedPath !== undefined && path !== node.suppliedPath)
    ) {
      markdownFail('invalid_tree', '$.nodes');
    }
  }
  return {
    preorder: Object.freeze(preorder),
    pathByIdentity,
    preorderIndexByIdentity,
    maximumDepth,
  };
}

function validateIntakeTargets(
  source: Readonly<MarkdownStructureProjectionSource>,
  tree: Readonly<TreeIndex>,
): void {
  if (
    source.parserName === 'struinfo-commonmark' &&
    source.intakeTargetNodeKeys.length !== 0
  ) {
    markdownFail('invalid_fragment', '$.fragments');
  }
  const seen = new Set<string>();
  let previousIndex = -1;
  for (const key of source.intakeTargetNodeKeys) {
    const index = tree.preorderIndexByIdentity.get(key);
    const node = index === undefined ? undefined : tree.preorder[index];
    if (
      index === undefined ||
      node?.kind !== 'section' ||
      seen.has(key) ||
      index <= previousIndex
    ) {
      markdownFail('invalid_fragment', '$.fragments');
    }
    seen.add(key);
    previousIndex = index;
  }
}

function validateParsedFragments(
  source: Readonly<MarkdownStructureProjectionSource>,
  tree: Readonly<TreeIndex>,
  codePoints: readonly string[],
): readonly ProjectionFragment[] {
  const targetKeys = new Set(source.intakeTargetNodeKeys);
  const expectedKeys = tree.preorder
    .filter(
      (node) =>
        node.kind === 'document' ||
        fragmentKinds.has(node.kind) ||
        targetKeys.has(node.identity),
    )
    .map((node) => node.identity);
  if (expectedKeys.length !== source.fragments.length) {
    markdownFail('invalid_fragment', '$.fragments');
  }
  return source.fragments.map((fragment, index) => {
    const node =
      tree.preorder[
        tree.preorderIndexByIdentity.get(fragment.nodeLocalKey) ?? -1
      ];
    const expectedRole =
      node?.kind === 'document'
        ? 'document'
        : targetKeys.has(fragment.nodeLocalKey)
          ? 'intake_target'
          : 'leaf';
    if (
      node === undefined ||
      expectedKeys[index] !== fragment.nodeLocalKey ||
      fragment.localKey !== `f/${fragment.nodeLocalKey}` ||
      !isOneOf(PARSED_FRAGMENT_ROLES, fragment.role) ||
      fragment.role !== expectedRole ||
      fragment.codePointRange.start !== node.codePointStart ||
      fragment.codePointRange.end !== node.codePointEnd ||
      fragment.lineRange.start !== node.lineStart ||
      fragment.lineRange.end !== node.lineEnd ||
      !SHA256_PATTERN.test(fragment.selectedTextSha256) ||
      fragment.selectedTextSha256 !==
        sha256Text(
          codePoints
            .slice(fragment.codePointRange.start, fragment.codePointRange.end)
            .join(''),
        )
    ) {
      markdownFail('invalid_fragment', '$.fragments');
    }
    return {
      identity: fragment.localKey,
      nodeIdentity: fragment.nodeLocalKey,
      suppliedLocalKey: fragment.localKey,
      codePointStart: fragment.codePointRange.start,
      codePointEnd: fragment.codePointRange.end,
      lineStart: fragment.lineRange.start,
      lineEnd: fragment.lineRange.end,
      selectedTextSha256: fragment.selectedTextSha256,
    };
  });
}

function validateEvidenceFragments(
  fragments: readonly Readonly<FragmentInput>[],
  tree: Readonly<TreeIndex>,
  codePoints: readonly string[],
): readonly ProjectionFragment[] {
  const seenNodes = new Set<string>();
  const projected = fragments.map((fragment) => {
    const nodeIndex = tree.preorderIndexByIdentity.get(fragment.nodeId);
    const node = nodeIndex === undefined ? undefined : tree.preorder[nodeIndex];
    if (
      node === undefined ||
      seenNodes.has(fragment.nodeId) ||
      runtimeFragmentField(fragment, 'locatorKind') !==
        'unicode_code_point_range' ||
      runtimeFragmentField(fragment, 'locatorVersion') !== 1 ||
      fragment.lineRange === undefined ||
      fragment.codePointRange.start !== node.codePointStart ||
      fragment.codePointRange.end !== node.codePointEnd ||
      fragment.lineRange.start !== node.lineStart ||
      fragment.lineRange.end !== node.lineEnd ||
      fragment.selectedTextSha256 !==
        sha256Text(
          codePoints
            .slice(fragment.codePointRange.start, fragment.codePointRange.end)
            .join(''),
        )
    ) {
      markdownFail('invalid_fragment', '$.fragments');
    }
    seenNodes.add(fragment.nodeId);
    return {
      identity: fragment.fragmentId,
      nodeIdentity: fragment.nodeId,
      codePointStart: fragment.codePointRange.start,
      codePointEnd: fragment.codePointRange.end,
      lineStart: fragment.lineRange.start,
      lineEnd: fragment.lineRange.end,
      selectedTextSha256: fragment.selectedTextSha256,
    };
  });
  const sorted = [...projected].sort((left, right) =>
    compareFragments(left, right, tree),
  );
  if (!isDeepStrictEqual(projected, sorted)) {
    markdownFail('invalid_fragment', '$.fragments');
  }
  return projected;
}

function hashProjection(
  parserName: MarkdownParserName,
  parserVersion: string,
  normalizationVersion: string,
  textSha256: string,
  textByteLength: number,
  tree: Readonly<TreeIndex>,
  fragments: readonly ProjectionFragment[],
): string {
  if (
    !SHA256_PATTERN.test(textSha256) ||
    !Number.isSafeInteger(textByteLength) ||
    textByteLength < 0
  ) {
    markdownFail('structure_hash_mismatch', '$.structureSha256');
  }
  const projection = {
    projection: MARKDOWN_STRUCTURE_PROJECTION_VERSION,
    parser: {name: parserName, version: parserVersion},
    text: {
      normalizationVersion,
      sha256: textSha256,
      byteLength: textByteLength,
    },
    nodes: tree.preorder.map((node) => ({
      path: requiredPath(tree, node.identity),
      parentPath:
        node.parentIdentity === undefined
          ? null
          : requiredPath(tree, node.parentIdentity),
      kind: node.kind,
      siblingOrdinal: node.siblingOrdinal,
      codePointStart: node.codePointStart,
      codePointEnd: node.codePointEnd,
      lineStart: node.lineStart,
      lineEnd: node.lineEnd,
    })),
    fragments: fragments.map((fragment) => ({
      nodePath: requiredPath(tree, fragment.nodeIdentity),
      locatorKind: 'unicode_code_point_range',
      locatorVersion: 1,
      codePointStart: fragment.codePointStart,
      codePointEnd: fragment.codePointEnd,
      lineStart: fragment.lineStart,
      lineEnd: fragment.lineEnd,
      selectedTextSha256: fragment.selectedTextSha256,
    })),
  };
  let bytes: Uint8Array;
  try {
    bytes = encodeCanonicalJson(
      projection,
      MARKDOWN_BUDGETS.canonicalStructureBytes,
    );
  } catch (error) {
    if (error instanceof CanonicalJsonError && error.code === 'size_exceeded') {
      markdownFail('limit_exceeded', '$.structureSha256', {
        budget: 'canonical_structure_bytes',
      });
    }
    markdownFail('limit_exceeded', '$.structureSha256', {
      budget: 'canonical_json_values',
    });
  }
  return createHash('sha256').update(bytes).digest('hex');
}

function validateRangeAndLine(
  range: Readonly<{
    codePointStart: number;
    codePointEnd: number;
    lineStart: number;
    lineEnd: number;
  }>,
  textIndex: Readonly<IndexedMarkdownText>,
  code: 'invalid_tree' | 'invalid_fragment',
  path: '$.nodes' | '$.fragments',
): void {
  if (
    !Number.isSafeInteger(range.codePointStart) ||
    !Number.isSafeInteger(range.codePointEnd) ||
    range.codePointStart < 0 ||
    range.codePointEnd <= range.codePointStart ||
    range.codePointEnd > textIndex.codePoints.length
  ) {
    markdownFail(code, path);
  }
  const derived = lineRangeFromIndex(
    textIndex.lineIndex,
    range.codePointStart,
    range.codePointEnd,
  );
  if (range.lineStart !== derived.start || range.lineEnd !== derived.end) {
    markdownFail(code, path);
  }
}

function compareFragments(
  left: ProjectionFragment,
  right: ProjectionFragment,
  tree: Readonly<TreeIndex>,
): number {
  const leftIndex = tree.preorderIndexByIdentity.get(left.nodeIdentity) ?? -1;
  const rightIndex = tree.preorderIndexByIdentity.get(right.nodeIdentity) ?? -1;
  return (
    leftIndex - rightIndex ||
    left.codePointStart - right.codePointStart ||
    left.codePointEnd - right.codePointEnd ||
    compareAscii(left.selectedTextSha256, right.selectedTextSha256)
  );
}

function requiredPath(tree: Readonly<TreeIndex>, identity: string): string {
  const path = tree.pathByIdentity.get(identity);
  if (path === undefined) {
    markdownFail('invalid_tree', '$.nodes');
  }
  return path;
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isFixedParserName(value: string): value is MarkdownParserName {
  return isOneOf(MARKDOWN_PARSER_NAMES, value);
}

function isOneOf<const Values extends readonly string[]>(
  values: Values,
  candidate: string,
): candidate is Values[number] {
  return values.some((value) => value === candidate);
}

export function isMarkdownProjectionFault(error: unknown): boolean {
  return error instanceof MarkdownFault;
}

function runtimeFragmentField(
  fragment: Readonly<FragmentInput>,
  field: 'locatorKind' | 'locatorVersion',
): unknown {
  return (fragment as unknown as Readonly<Record<string, unknown>>)[field];
}
