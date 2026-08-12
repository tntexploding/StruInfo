import {createHash} from 'node:crypto';
import {TextDecoder, TextEncoder} from 'node:util';

import {fromMarkdown} from 'mdast-util-from-markdown';

import type {DocumentNodeKind} from '../evidence_contract.js';
import {
  copyCheckedByteView,
  decodeParseMarkdownInput,
} from './closed_markdown_input.js';
import {
  BoundedPreorderLedger,
  SaturatingBudgetCounter,
} from './markdown_budget_ledger.js';
import {
  MARKDOWN_BUDGETS,
  MARKDOWN_PARSER_VERSION,
  MARKDOWN_STRUCTURE_PROJECTION_VERSION,
  MARKDOWN_TEXT_NORMALIZATION_VERSION,
  parserNameForProfile,
  type MarkdownDiagnostic,
  type MarkdownProfile,
  type ParseMarkdownResult,
  type ParsedLinkReference,
  type ParsedLinkResolution,
  type ParsedMarkdownDocument,
  type ParsedMarkdownFragment,
  type ParsedMarkdownNode,
  type ParsedMediaReference,
  type ParsedSourceRange,
} from './markdown_contract.js';
import {
  MarkdownFault,
  freezeMarkdownMetadata,
  markdownFail,
} from './markdown_failure.js';
import {
  SHA256_PATTERN,
  UUID_PATTERN,
  deriveEvidenceBlobId,
} from './markdown_identity.js';
import {computeMarkdownStructureSha256WithTextIndex} from './markdown_projection.js';
import {
  indexMarkdownText,
  lineRangeFromIndex,
  type IndexedMarkdownText,
} from './markdown_line_index.js';

const textDecoder = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
});
const textEncoder = new TextEncoder();
const numberedContainerLabels = new Set([
  '科技动态',
  '文章',
  '工具',
  'AI 相关',
  '资源',
  '图片',
  '文摘',
  '言论',
]);
const weeklyEntryPattern = /^[1-9][0-9]*、/u;
const windowsDrivePattern = /^[A-Za-z]:/u;

interface MdastPoint {
  readonly offset?: number;
}

interface MdastPosition {
  readonly start?: MdastPoint;
  readonly end?: MdastPoint;
}

interface MdastNode {
  readonly type: string;
  readonly position?: MdastPosition;
  readonly children?: readonly MdastNode[];
  readonly depth?: number;
  readonly value?: string;
  readonly url?: string;
  readonly alt?: string | null;
  readonly identifier?: string;
}

interface NodeDraft {
  readonly kind: DocumentNodeKind;
  start: number;
  end: number;
  readonly children: NodeDraft[];
  parent?: NodeDraft;
  localKey?: string;
  siblingOrdinal?: number;
  headingDepth?: number;
  headingLabel?: string;
  documentFlowSection?: boolean;
  intakeTarget?: boolean;
  coverSection?: boolean;
  linkOrdinal: number;
}

interface LinkDraft {
  readonly block: NodeDraft;
  readonly ordinal: number;
  readonly rawDestination: string;
  readonly resolution: ParsedLinkResolution;
  readonly range: Readonly<ParsedSourceRange>;
}

interface MediaDraft {
  readonly imageNode: NodeDraft;
  readonly rawDestination: string;
  readonly resolvedUri: string;
  readonly range: Readonly<ParsedSourceRange>;
}

interface MappingState {
  readonly textIndex: Readonly<IndexedMarkdownText>;
  readonly offsetToCodePoint: ReadonlyMap<number, number>;
  readonly definitions: ReadonlyMap<string, MdastNode>;
  readonly documentBaseUri?: string;
  readonly links: LinkDraft[];
  readonly media: MediaDraft[];
  readonly diagnostics: MarkdownDiagnostic[];
}

interface SourcePositionState {
  readonly textIndex: Readonly<IndexedMarkdownText>;
  readonly offsetToCodePoint: ReadonlyMap<number, number>;
}

interface PreflightNodeRecord {
  readonly depth: number;
  readonly kind: DocumentNodeKind;
}

interface WeeklySectionPreflight {
  readonly depth: number;
  readonly label: string;
  markerCount: number;
  afterFirstMarker: boolean;
  deepestNodeAfterFirstMarker: number;
}

interface ProductPreflightState extends SourcePositionState {
  readonly codePoints: readonly string[];
  readonly definitions: ReadonlyMap<string, MdastNode>;
  readonly documentBaseUri?: string;
  readonly profile: MarkdownProfile;
  readonly nodes: BoundedPreorderLedger<PreflightNodeRecord>;
  readonly fragments: SaturatingBudgetCounter;
  readonly links: SaturatingBudgetCounter;
  readonly media: SaturatingBudgetCounter;
  readonly diagnostics: SaturatingBudgetCounter;
  maximumDepth: number;
  activeWeeklySection?: WeeklySectionPreflight;
}

interface ProductGraphPreflight {
  readonly maximumDepth: number;
  readonly nodes: number;
  readonly fragments: number;
  readonly links: number;
  readonly media: number;
  readonly diagnostics: number;
}

interface ProductGraphPreflightInput {
  readonly ast: MdastNode;
  readonly textIndex: Readonly<IndexedMarkdownText>;
  readonly offsetToCodePoint: ReadonlyMap<number, number>;
  readonly definitions: ReadonlyMap<string, MdastNode>;
  readonly profile: MarkdownProfile;
  readonly documentBaseUri?: string;
}

interface MappedDocument {
  readonly root: NodeDraft;
  readonly links: readonly LinkDraft[];
  readonly media: readonly MediaDraft[];
  readonly diagnostics: readonly MarkdownDiagnostic[];
}

export function parseMarkdownStructure(input: unknown): ParseMarkdownResult {
  try {
    const decoded = decodeParseMarkdownInput(input);
    if (decoded.sourceUtf8.byteLength > MARKDOWN_BUDGETS.sourceBytes) {
      markdownFail('limit_exceeded', '$.sourceUtf8', {
        budget: 'source_bytes',
      });
    }
    const sourceBytes = copyCheckedByteView(decoded.sourceUtf8);
    validateSourceIdentity(decoded, sourceBytes);
    const documentBaseUri = validateDocumentBaseUri(decoded.documentBaseUri);
    const normalized = normalizeMarkdown(sourceBytes);
    let ast: MdastNode;
    try {
      ast = fromMarkdown(normalized.text) as unknown as MdastNode;
    } catch {
      markdownFail('internal_parser_failure', '$.sourceUtf8');
    }
    const offsetToCodePoint = buildOffsetMap(normalized.text);
    const definitions = collectDefinitions(ast);
    const preflight = preflightProductGraph({
      ast,
      textIndex: normalized.textIndex,
      offsetToCodePoint,
      definitions,
      profile: decoded.profile,
      ...(documentBaseUri === undefined ? {} : {documentBaseUri}),
    });
    enforceReachableBudgets(preflight);
    const mapped = mapDocument(
      ast,
      normalized.textIndex,
      offsetToCodePoint,
      definitions,
      documentBaseUri,
    );
    if (decoded.profile === 'ruanyf-weekly-v1') {
      applyWeeklyProfile(mapped.root, normalized.textIndex.codePoints);
    }
    const draftLedger = assignLocalKeys(mapped.root);
    const nodes = createNodes(draftLedger.drafts, normalized.textIndex);
    const intakeTargetNodeKeys = Object.freeze(
      draftLedger.drafts
        .filter((draft) => draft.intakeTarget === true)
        .map((draft) => requiredLocalKey(draft)),
    );
    const fragments = createFragments(
      draftLedger.drafts,
      nodes,
      intakeTargetNodeKeys,
      normalized.textIndex.codePoints,
    );
    const links = createLinks(mapped.links);
    const media = createMedia(mapped.media);
    const diagnostics = [...mapped.diagnostics].sort(compareDiagnostics);
    assertPreflightMatchesProduct(preflight, {
      maximumDepth: draftLedger.maximumDepth,
      nodes: nodes.length,
      fragments: fragments.length,
      links: links.length,
      media: media.length,
      diagnostics: diagnostics.length,
    });
    const parserName = parserNameForProfile(decoded.profile);
    const projectionSource = {
      parserName,
      parserVersion: MARKDOWN_PARSER_VERSION,
      textNormalizationVersion: MARKDOWN_TEXT_NORMALIZATION_VERSION,
      normalizedTextSha256: normalized.sha256,
      normalizedTextByteLength: normalized.bytes.byteLength,
      nodes,
      fragments,
      intakeTargetNodeKeys,
    };
    const structureSha256 = computeMarkdownStructureSha256WithTextIndex(
      projectionSource,
      normalized.textIndex,
    );
    const value: ParsedMarkdownDocument = {
      workspaceId: decoded.workspaceId,
      resourceId: decoded.resourceId,
      snapshotId: decoded.snapshotId,
      rawBlob: decoded.rawBlob,
      profile: decoded.profile,
      parserName,
      parserVersion: MARKDOWN_PARSER_VERSION,
      textNormalizationVersion: MARKDOWN_TEXT_NORMALIZATION_VERSION,
      structureProjectionVersion: MARKDOWN_STRUCTURE_PROJECTION_VERSION,
      ...(documentBaseUri === undefined ? {} : {documentBaseUri}),
      normalizedTextUtf8: Uint8Array.from(normalized.bytes),
      normalizedTextSha256: normalized.sha256,
      normalizedTextByteLength: normalized.bytes.byteLength,
      structureSha256,
      nodes,
      fragments,
      intakeTargetNodeKeys,
      links,
      media,
      diagnostics,
    };
    return Object.freeze({
      status: 'parsed' as const,
      value: freezeMarkdownMetadata(value),
    });
  } catch (error) {
    const issue =
      error instanceof MarkdownFault
        ? error.issue
        : Object.freeze({
            code: 'internal_parser_failure' as const,
            path: '$.sourceUtf8',
          });
    return Object.freeze({status: 'rejected' as const, issue});
  }
}

function validateSourceIdentity(
  input: ReturnType<typeof decodeParseMarkdownInput>,
  sourceBytes: Uint8Array,
): void {
  const {rawBlob} = input;
  if (
    !UUID_PATTERN.test(input.workspaceId) ||
    !UUID_PATTERN.test(input.resourceId) ||
    !UUID_PATTERN.test(input.snapshotId) ||
    rawBlob.workspaceId !== input.workspaceId ||
    !UUID_PATTERN.test(rawBlob.blobId) ||
    runtimeDigestAlgorithm(rawBlob) !== 'sha256' ||
    !SHA256_PATTERN.test(rawBlob.digest) ||
    !Number.isSafeInteger(rawBlob.byteLength) ||
    rawBlob.byteLength < 0 ||
    rawBlob.byteLength !== sourceBytes.byteLength ||
    rawBlob.digest !== sha256Bytes(sourceBytes) ||
    rawBlob.blobId !== deriveEvidenceBlobId(input.workspaceId, rawBlob.digest)
  ) {
    markdownFail('invalid_source_identity', '$');
  }
}

function validateDocumentBaseUri(
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.hostname === '' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.hash !== ''
    ) {
      markdownFail('invalid_base_uri', '$.documentBaseUri');
    }
    return parsed.href;
  } catch (error) {
    if (error instanceof MarkdownFault) {
      throw error;
    }
    markdownFail('invalid_base_uri', '$.documentBaseUri');
  }
}

function normalizeMarkdown(sourceBytes: Uint8Array): Readonly<{
  text: string;
  textIndex: Readonly<IndexedMarkdownText>;
  bytes: Uint8Array;
  sha256: string;
}> {
  let decoded: string;
  try {
    decoded = textDecoder.decode(sourceBytes);
  } catch {
    markdownFail('invalid_utf8', '$.sourceUtf8');
  }
  const withoutBom = decoded.startsWith('\uFEFF') ? decoded.slice(1) : decoded;
  const text = withoutBom.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  if (text.includes('\u0000')) {
    markdownFail('invalid_text', '$.sourceUtf8');
  }
  if (text.trim().length === 0) {
    markdownFail('empty_document', '$.sourceUtf8');
  }
  const bytes = textEncoder.encode(text);
  return Object.freeze({
    text,
    textIndex: indexMarkdownText(text),
    bytes,
    sha256: sha256Bytes(bytes),
  });
}

/**
 * Performs one bounded StruInfo mapping preflight over the complete public
 * MDAST result. No NodeDraft, Fragment, link, media, or diagnostic product
 * graph is constructed until these saturated counts pass in contract order.
 */
function preflightProductGraph(
  input: Readonly<ProductGraphPreflightInput>,
): Readonly<ProductGraphPreflight> {
  const {
    ast,
    textIndex,
    offsetToCodePoint,
    definitions,
    profile,
    documentBaseUri,
  } = input;
  if (ast.type !== 'root') {
    markdownFail('internal_parser_failure', '$.sourceUtf8');
  }
  const state: ProductPreflightState = {
    textIndex,
    offsetToCodePoint,
    codePoints: textIndex.codePoints,
    definitions,
    ...(documentBaseUri === undefined ? {} : {documentBaseUri}),
    profile,
    nodes: new BoundedPreorderLedger(MARKDOWN_BUDGETS.nodes),
    fragments: new SaturatingBudgetCounter(MARKDOWN_BUDGETS.fragments),
    links: new SaturatingBudgetCounter(MARKDOWN_BUDGETS.links),
    media: new SaturatingBudgetCounter(MARKDOWN_BUDGETS.media),
    diagnostics: new SaturatingBudgetCounter(MARKDOWN_BUDGETS.diagnostics),
    maximumDepth: 0,
  };
  observePreflightNode(state, 'document', 0, true);
  const sections: {rank: number; depth: number}[] = [];
  for (const child of requiredChildren(ast)) {
    if (child.type === 'heading') {
      const rank = requiredHeadingRank(child);
      if (rank <= 2) {
        finishWeeklySectionPreflight(state);
      }
      while ((sections.at(-1)?.rank ?? 0) >= rank) {
        sections.pop();
      }
      const sectionDepth = (sections.at(-1)?.depth ?? 0) + 1;
      observePreflightNode(state, 'section', sectionDepth, false);
      preflightHeading(child, sectionDepth + 1, state);
      sections.push({rank, depth: sectionDepth});
      if (profile === 'ruanyf-weekly-v1' && rank === 2) {
        state.activeWeeklySection = {
          depth: sectionDepth,
          label: extractHeadingLabel(child),
          markerCount: 0,
          afterFirstMarker: false,
          deepestNodeAfterFirstMarker: sectionDepth,
        };
      }
      continue;
    }

    const parentDepth = sections.at(-1)?.depth ?? 0;
    const activeSection = state.activeWeeklySection;
    if (
      activeSection !== undefined &&
      numberedContainerLabels.has(activeSection.label) &&
      sections.at(-1)?.rank === 2 &&
      child.type === 'paragraph'
    ) {
      const range = rangeForAst(child, state);
      if (
        isWeeklyEntryMarkerRange(
          range.codePointRange.start,
          range.codePointRange.end,
          state.codePoints,
        )
      ) {
        activeSection.markerCount += 1;
        activeSection.afterFirstMarker = true;
        state.nodes.observe(() =>
          Object.freeze({
            kind: 'section' as const,
            depth: activeSection.depth + 1,
          }),
        );
        state.fragments.observe();
        state.maximumDepth = Math.max(
          state.maximumDepth,
          activeSection.depth + 1,
        );
      }
    }
    preflightBlock(child, parentDepth + 1, state);
  }
  finishWeeklySectionPreflight(state);
  const nodeSnapshot = state.nodes.snapshot();
  return Object.freeze({
    maximumDepth: state.maximumDepth,
    nodes: nodeSnapshot.saturatedCount,
    fragments: state.fragments.saturatedCount,
    links: state.links.saturatedCount,
    media: state.media.saturatedCount,
    diagnostics: state.diagnostics.saturatedCount,
  });
}

function preflightBlock(
  firstNode: MdastNode,
  firstDepth: number,
  state: ProductPreflightState,
): void {
  const stack: Readonly<{node: MdastNode; depth: number}>[] = [
    {node: firstNode, depth: firstDepth},
  ];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    const {node, depth} = current;
    rangeForAst(node, state);
    switch (node.type) {
      case 'paragraph':
        observePreflightNode(state, 'paragraph', depth, true);
        preflightInlineChildren(node, depth, state);
        break;
      case 'blockquote':
        observePreflightNode(state, 'blockquote', depth, false);
        pushPreflightChildren(stack, node, depth + 1);
        break;
      case 'list': {
        observePreflightNode(state, 'list', depth, false);
        const children = requiredChildren(node);
        for (const child of children) {
          if (child.type !== 'listItem') {
            markdownFail('internal_parser_failure', '$.sourceUtf8');
          }
        }
        pushPreflightChildren(stack, node, depth + 1);
        break;
      }
      case 'listItem':
        observePreflightNode(state, 'list_item', depth, false);
        pushPreflightChildren(stack, node, depth + 1);
        break;
      case 'code':
        observePreflightNode(state, 'code_block', depth, true);
        break;
      case 'thematicBreak':
        observePreflightNode(state, 'thematic_break', depth, false);
        break;
      case 'heading':
        preflightHeading(node, depth, state);
        break;
      case 'html':
        observePreflightNode(state, 'paragraph', depth, true);
        state.diagnostics.observe();
        break;
      case 'definition':
        observePreflightNode(state, 'paragraph', depth, true);
        state.diagnostics.observe();
        break;
      default:
        markdownFail('internal_parser_failure', '$.sourceUtf8');
    }
  }
}

function preflightHeading(
  node: MdastNode,
  depth: number,
  state: ProductPreflightState,
): void {
  requiredHeadingRank(node);
  rangeForAst(node, state);
  observePreflightNode(state, 'heading', depth, true);
  preflightInlineChildren(node, depth, state);
}

function preflightInlineChildren(
  node: MdastNode,
  blockDepth: number,
  state: ProductPreflightState,
): void {
  const stack = [...requiredChildren(node)].reverse();
  while (stack.length > 0) {
    const inline = stack.pop();
    if (inline === undefined) {
      continue;
    }
    if (inline.type === 'image' || inline.type === 'imageReference') {
      const rawDestination = imageDestination(inline, state.definitions);
      if (rawDestination !== undefined) {
        const range = rangeForAst(inline, state);
        resolveMediaDestination(rawDestination, state.documentBaseUri, range);
        observePreflightNode(state, 'image', blockDepth + 1, true);
        state.media.observe();
      }
      continue;
    }
    if (inline.type === 'link' || inline.type === 'linkReference') {
      if (linkDestination(inline, state.definitions) !== undefined) {
        rangeForAst(inline, state);
        state.links.observe();
      }
    } else if (inline.type === 'html') {
      rangeForAst(inline, state);
      state.diagnostics.observe();
    }
    if (hasMdastChildren(inline)) {
      stack.push(...[...inline.children].reverse());
    }
  }
}

function pushPreflightChildren(
  stack: Readonly<{node: MdastNode; depth: number}>[],
  parent: MdastNode,
  depth: number,
): void {
  const children = requiredChildren(parent);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (child !== undefined) {
      stack.push({node: child, depth});
    }
  }
}

function observePreflightNode(
  state: ProductPreflightState,
  kind: DocumentNodeKind,
  depth: number,
  createsFragment: boolean,
): void {
  state.nodes.observe(() => Object.freeze({kind, depth}));
  if (createsFragment) {
    state.fragments.observe();
  }
  state.maximumDepth = Math.max(state.maximumDepth, depth);
  const activeSection = state.activeWeeklySection;
  if (activeSection?.afterFirstMarker === true) {
    activeSection.deepestNodeAfterFirstMarker = Math.max(
      activeSection.deepestNodeAfterFirstMarker,
      depth,
    );
  }
}

function finishWeeklySectionPreflight(state: ProductPreflightState): void {
  const section = state.activeWeeklySection;
  delete state.activeWeeklySection;
  if (section === undefined) {
    return;
  }
  if (section.label === '往年回顾') {
    return;
  }
  if (
    !numberedContainerLabels.has(section.label) ||
    section.markerCount === 0
  ) {
    state.fragments.observe();
    return;
  }
  state.maximumDepth = Math.max(
    state.maximumDepth,
    section.depth + 1,
    section.deepestNodeAfterFirstMarker + 1,
  );
}

function requiredHeadingRank(node: MdastNode): number {
  const rank = node.depth;
  if (
    rank === undefined ||
    !Number.isSafeInteger(rank) ||
    rank < 1 ||
    rank > 6
  ) {
    markdownFail('internal_parser_failure', '$.sourceUtf8');
  }
  return rank;
}

function mapDocument(
  ast: MdastNode,
  textIndex: Readonly<IndexedMarkdownText>,
  offsetToCodePoint: ReadonlyMap<number, number>,
  definitions: ReadonlyMap<string, MdastNode>,
  documentBaseUri: string | undefined,
): MappedDocument {
  if (ast.type !== 'root') {
    markdownFail('internal_parser_failure', '$.sourceUtf8');
  }
  const rootChildren = requiredChildren(ast);
  const {codePoints} = textIndex;
  const state: MappingState = {
    textIndex,
    offsetToCodePoint,
    definitions,
    ...(documentBaseUri === undefined ? {} : {documentBaseUri}),
    links: [],
    media: [],
    diagnostics: [],
  };
  const root = createDraft('document', 0, codePoints.length);
  const sections: {rank: number; section: NodeDraft}[] = [];
  for (const child of rootChildren) {
    if (child.type === 'heading') {
      const headingRange = rangeForAst(child, state);
      const rank = child.depth;
      if (
        rank === undefined ||
        !Number.isSafeInteger(rank) ||
        rank < 1 ||
        rank > 6
      ) {
        markdownFail('internal_parser_failure', '$.sourceUtf8');
      }
      while ((sections.at(-1)?.rank ?? 0) >= rank) {
        const closed = sections.pop();
        if (closed !== undefined) {
          closed.section.end = headingRange.codePointRange.start;
        }
      }
      const parent = sections.at(-1)?.section ?? root;
      const section = createDraft(
        'section',
        headingRange.codePointRange.start,
        codePoints.length,
      );
      section.headingDepth = rank;
      section.headingLabel = extractHeadingLabel(child);
      section.documentFlowSection = true;
      addChild(parent, section);
      addChild(section, mapHeading(child, state));
      sections.push({rank, section});
    } else {
      const parent = sections.at(-1)?.section ?? root;
      const mapped = mapBlock(child, state);
      if (mapped !== undefined) {
        addChild(parent, mapped);
      }
    }
  }
  for (const open of sections) {
    open.section.end = codePoints.length;
  }
  return {
    root,
    links: Object.freeze(state.links),
    media: Object.freeze(state.media),
    diagnostics: Object.freeze(state.diagnostics),
  };
}

function mapBlock(node: MdastNode, state: MappingState): NodeDraft | undefined {
  const range = rangeForAst(node, state);
  switch (node.type) {
    case 'paragraph': {
      const draft = draftFromRange('paragraph', range);
      mapInlineChildren(node, draft, state);
      return draft;
    }
    case 'blockquote': {
      const draft = draftFromRange('blockquote', range);
      for (const child of requiredChildren(node)) {
        const mapped =
          child.type === 'heading'
            ? mapHeading(child, state)
            : mapBlock(child, state);
        if (mapped !== undefined) {
          addChild(draft, mapped);
        }
      }
      return draft;
    }
    case 'list': {
      const draft = draftFromRange('list', range);
      for (const child of requiredChildren(node)) {
        if (child.type !== 'listItem') {
          markdownFail('internal_parser_failure', '$.sourceUtf8');
        }
        const mapped = mapBlock(child, state);
        if (mapped !== undefined) {
          addChild(draft, mapped);
        }
      }
      return draft;
    }
    case 'listItem': {
      const draft = draftFromRange('list_item', range);
      for (const child of requiredChildren(node)) {
        const mapped =
          child.type === 'heading'
            ? mapHeading(child, state)
            : mapBlock(child, state);
        if (mapped !== undefined) {
          addChild(draft, mapped);
        }
      }
      return draft;
    }
    case 'code':
      return draftFromRange('code_block', range);
    case 'thematicBreak':
      return draftFromRange('thematic_break', range);
    case 'heading':
      return mapHeading(node, state);
    case 'html':
      state.diagnostics.push({code: 'opaque_html_block', ...range});
      return draftFromRange('paragraph', range);
    case 'definition':
      state.diagnostics.push({code: 'link_definition_block', ...range});
      return draftFromRange('paragraph', range);
    default:
      markdownFail('internal_parser_failure', '$.sourceUtf8');
  }
}

function mapHeading(node: MdastNode, state: MappingState): NodeDraft {
  const draft = draftFromRange('heading', rangeForAst(node, state));
  mapInlineChildren(node, draft, state);
  return draft;
}

function mapInlineChildren(
  node: MdastNode,
  block: NodeDraft,
  state: MappingState,
): void {
  const stack = [...requiredChildren(node)].reverse();
  while (stack.length > 0) {
    const inline = stack.pop();
    if (inline === undefined) {
      continue;
    }
    if (inline.type === 'image' || inline.type === 'imageReference') {
      const rawDestination = imageDestination(inline, state.definitions);
      if (rawDestination !== undefined) {
        const range = rangeForAst(inline, state);
        const resolvedUri = resolveMediaDestination(
          rawDestination,
          state.documentBaseUri,
          range,
        );
        const image = draftFromRange('image', range);
        addChild(block, image);
        state.media.push({
          imageNode: image,
          rawDestination,
          resolvedUri,
          range,
        });
      }
      continue;
    }
    if (inline.type === 'link' || inline.type === 'linkReference') {
      const rawDestination = linkDestination(inline, state.definitions);
      if (rawDestination !== undefined) {
        const range = rangeForAst(inline, state);
        const ordinal = block.linkOrdinal;
        block.linkOrdinal += 1;
        state.links.push({
          block,
          ordinal,
          rawDestination,
          resolution: resolveLinkDestination(
            rawDestination,
            state.documentBaseUri,
          ),
          range,
        });
      }
    } else if (inline.type === 'html') {
      state.diagnostics.push({
        code: 'inline_html',
        ...rangeForAst(inline, state),
      });
    }
    if (hasMdastChildren(inline)) {
      stack.push(...[...inline.children].reverse());
    }
  }
}

function applyWeeklyProfile(
  root: NodeDraft,
  codePoints: readonly string[],
): void {
  const sections = flattenDrafts(root).filter(
    (node) => node.documentFlowSection === true && node.headingDepth === 2,
  );
  for (const section of sections) {
    const label = section.headingLabel ?? '';
    if (label === '往年回顾') {
      section.intakeTarget = false;
      continue;
    }
    if (label === '封面图') {
      section.intakeTarget = true;
      section.coverSection = true;
      continue;
    }
    if (!numberedContainerLabels.has(label)) {
      section.intakeTarget = true;
      continue;
    }
    const markerIndexes = section.children
      .map((child, index) => ({child, index}))
      .filter(({child}) => isWeeklyEntryMarker(child, codePoints))
      .map(({index}) => index);
    if (markerIndexes.length === 0) {
      section.intakeTarget = true;
      continue;
    }
    section.intakeTarget = false;
    const markerSet = new Set(markerIndexes);
    const originalChildren = [...section.children];
    section.children.length = 0;
    let index = 0;
    let markerPosition = 0;
    while (index < originalChildren.length) {
      const child = originalChildren[index];
      if (child === undefined) {
        index += 1;
        continue;
      }
      if (!markerSet.has(index)) {
        addChild(section, child);
        index += 1;
        continue;
      }
      const nextMarker = markerIndexes[markerPosition + 1];
      const endIndex = nextMarker ?? originalChildren.length;
      const entryEnd =
        nextMarker === undefined
          ? section.end
          : (originalChildren[nextMarker]?.start ?? section.end);
      const entry = createDraft('section', child.start, entryEnd);
      entry.intakeTarget = true;
      for (let childIndex = index; childIndex < endIndex; childIndex += 1) {
        const entryChild = originalChildren[childIndex];
        if (entryChild !== undefined) {
          addChild(entry, entryChild);
        }
      }
      addChild(section, entry);
      index = endIndex;
      markerPosition += 1;
    }
  }
}

function isWeeklyEntryMarker(
  node: NodeDraft,
  codePoints: readonly string[],
): boolean {
  if (node.kind !== 'paragraph') {
    return false;
  }
  return isWeeklyEntryMarkerRange(node.start, node.end, codePoints);
}

function isWeeklyEntryMarkerRange(
  start: number,
  end: number,
  codePoints: readonly string[],
): boolean {
  if (start > 0 && codePoints[start - 1] !== '\n') {
    return false;
  }
  const lineEnd = codePoints.indexOf('\n', start);
  const firstLine = codePoints
    .slice(start, lineEnd === -1 ? end : Math.min(lineEnd, end))
    .join('');
  return weeklyEntryPattern.test(firstLine);
}

function assignLocalKeys(root: NodeDraft): Readonly<{
  drafts: readonly NodeDraft[];
  maximumDepth: number;
}> {
  let maximumDepth = 0;
  const drafts: NodeDraft[] = [];
  const visit = (
    node: NodeDraft,
    parent: NodeDraft | undefined,
    ordinal: number,
    depth: number,
  ): void => {
    if (depth > MARKDOWN_BUDGETS.depth) {
      markdownFail('limit_exceeded', '$.nodes', {budget: 'depth'});
    }
    if (parent === undefined) {
      delete node.parent;
    } else {
      node.parent = parent;
    }
    node.siblingOrdinal = ordinal;
    node.localKey =
      parent === undefined
        ? 'n/0'
        : `${requiredLocalKey(parent)}/${String(ordinal)}`;
    maximumDepth = Math.max(maximumDepth, depth);
    drafts.push(node);
    for (const [index, child] of node.children.entries()) {
      visit(child, node, index, depth + 1);
    }
  };
  visit(root, undefined, 0, 0);
  return Object.freeze({drafts: Object.freeze(drafts), maximumDepth});
}

function createNodes(
  drafts: readonly NodeDraft[],
  textIndex: Readonly<IndexedMarkdownText>,
): readonly Readonly<ParsedMarkdownNode>[] {
  return Object.freeze(
    drafts.map((node) => {
      const codePointRange = Object.freeze({start: node.start, end: node.end});
      const lineRange = lineRangeFromIndex(
        textIndex.lineIndex,
        node.start,
        node.end,
      );
      return Object.freeze({
        localKey: requiredLocalKey(node),
        ...(node.parent === undefined
          ? {}
          : {parentLocalKey: requiredLocalKey(node.parent)}),
        kind: node.kind,
        siblingOrdinal: node.siblingOrdinal ?? 0,
        codePointRange,
        lineRange,
      });
    }),
  );
}

function createFragments(
  drafts: readonly NodeDraft[],
  nodes: readonly Readonly<ParsedMarkdownNode>[],
  intakeTargetNodeKeys: readonly string[],
  codePoints: readonly string[],
): readonly Readonly<ParsedMarkdownFragment>[] {
  const draftByKey = new Map(
    drafts.map((draft) => [requiredLocalKey(draft), draft]),
  );
  const targetKeys = new Set(intakeTargetNodeKeys);
  return Object.freeze(
    nodes
      .filter(
        (node) =>
          node.kind === 'document' ||
          node.kind === 'heading' ||
          node.kind === 'paragraph' ||
          node.kind === 'code_block' ||
          node.kind === 'image' ||
          targetKeys.has(node.localKey),
      )
      .map((node) => {
        const draft = draftByKey.get(node.localKey);
        if (draft === undefined) {
          markdownFail('invalid_fragment', '$.fragments');
        }
        const selected = codePoints.slice(draft.start, draft.end).join('');
        return Object.freeze({
          localKey: `f/${node.localKey}`,
          nodeLocalKey: node.localKey,
          role:
            node.kind === 'document'
              ? ('document' as const)
              : targetKeys.has(node.localKey)
                ? ('intake_target' as const)
                : ('leaf' as const),
          codePointRange: node.codePointRange,
          lineRange: node.lineRange,
          selectedTextSha256: sha256Text(selected),
        });
      }),
  );
}

function createLinks(
  drafts: readonly LinkDraft[],
): readonly Readonly<ParsedLinkReference>[] {
  return Object.freeze(
    [...drafts]
      .sort(
        (left, right) =>
          compareRanges(left.range, right.range) ||
          left.ordinal - right.ordinal,
      )
      .map((link) =>
        Object.freeze({
          localKey: `l/${requiredLocalKey(link.block)}/${String(link.ordinal)}`,
          nodeLocalKey: requiredLocalKey(link.block),
          ordinal: link.ordinal,
          rawDestination: link.rawDestination,
          resolution: freezeMarkdownMetadata(link.resolution),
          captureState: 'not_captured' as const,
          ...link.range,
        }),
      ),
  );
}

function createMedia(
  drafts: readonly MediaDraft[],
): readonly Readonly<ParsedMediaReference>[] {
  return Object.freeze(
    [...drafts]
      .sort((left, right) => compareRanges(left.range, right.range))
      .map((media) => {
        const isCover = hasCoverAncestor(media.imageNode);
        const imageNodeLocalKey = requiredLocalKey(media.imageNode);
        return Object.freeze({
          localKey: `m/${imageNodeLocalKey}/0`,
          imageNodeLocalKey,
          ordinal: 0,
          rawDestination: media.rawDestination,
          resolvedUri: media.resolvedUri,
          purpose: isCover ? ('cover' as const) : ('unknown' as const),
          purposeOrigin: isCover
            ? ('deterministic_parser' as const)
            : ('unknown' as const),
          ...media.range,
        });
      }),
  );
}

function enforceReachableBudgets(
  counts: Readonly<{
    maximumDepth: number;
    nodes: number;
    fragments: number;
    links: number;
    media: number;
    diagnostics: number;
  }>,
): void {
  const checks = [
    ['depth', counts.maximumDepth, MARKDOWN_BUDGETS.depth, '$.nodes'],
    ['nodes', counts.nodes, MARKDOWN_BUDGETS.nodes, '$.nodes'],
    ['fragments', counts.fragments, MARKDOWN_BUDGETS.fragments, '$.fragments'],
    ['links', counts.links, MARKDOWN_BUDGETS.links, '$.links'],
    ['media', counts.media, MARKDOWN_BUDGETS.media, '$.media'],
    [
      'diagnostics',
      counts.diagnostics,
      MARKDOWN_BUDGETS.diagnostics,
      '$.diagnostics',
    ],
  ] as const;
  for (const [budget, actual, limit, path] of checks) {
    if (actual > limit) {
      markdownFail('limit_exceeded', path, {budget});
    }
  }
}

function assertPreflightMatchesProduct(
  preflight: Readonly<ProductGraphPreflight>,
  product: Readonly<ProductGraphPreflight>,
): void {
  if (
    preflight.maximumDepth !== product.maximumDepth ||
    preflight.nodes !== product.nodes ||
    preflight.fragments !== product.fragments ||
    preflight.links !== product.links ||
    preflight.media !== product.media ||
    preflight.diagnostics !== product.diagnostics
  ) {
    markdownFail('internal_parser_failure', '$.sourceUtf8');
  }
}

function resolveLinkDestination(
  rawDestination: string,
  documentBaseUri: string | undefined,
): ParsedLinkResolution {
  if (rawDestination.startsWith('#')) {
    return Object.freeze({
      status: 'not_resolved' as const,
      reason: 'document_fragment' as const,
    });
  }
  let parsed: URL;
  try {
    parsed =
      documentBaseUri === undefined
        ? new URL(rawDestination)
        : new URL(rawDestination, documentBaseUri);
  } catch {
    return Object.freeze({
      status: 'not_resolved' as const,
      reason:
        documentBaseUri === undefined
          ? ('relative_without_base' as const)
          : ('invalid_uri' as const),
    });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return Object.freeze({
      status: 'not_resolved' as const,
      reason: 'unsupported_scheme' as const,
    });
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return Object.freeze({
      status: 'not_resolved' as const,
      reason: 'credentials_not_allowed' as const,
    });
  }
  if (parsed.hostname === '') {
    return Object.freeze({
      status: 'not_resolved' as const,
      reason: 'invalid_uri' as const,
    });
  }
  return Object.freeze({status: 'resolved' as const, uri: parsed.href});
}

function resolveMediaDestination(
  rawDestination: string,
  documentBaseUri: string | undefined,
  range: Readonly<ParsedSourceRange>,
): string {
  if (rawDestination.startsWith('#')) {
    markdownFail('invalid_media_reference', '$.sourceUtf8', {range});
  }
  if (
    windowsDrivePattern.test(rawDestination) ||
    rawDestination.includes('\\')
  ) {
    markdownFail('unsafe_media_scheme', '$.sourceUtf8', {range});
  }
  let parsed: URL;
  try {
    parsed =
      documentBaseUri === undefined
        ? new URL(rawDestination)
        : new URL(rawDestination, documentBaseUri);
  } catch {
    markdownFail('invalid_media_reference', '$.sourceUtf8', {range});
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    markdownFail('unsafe_media_scheme', '$.sourceUtf8', {range});
  }
  if (parsed.hostname === '') {
    markdownFail('invalid_media_reference', '$.sourceUtf8', {range});
  }
  return parsed.href;
}

function collectDefinitions(root: MdastNode): ReadonlyMap<string, MdastNode> {
  const definitions = new Map<string, MdastNode>();
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    if (
      node.type === 'definition' &&
      typeof node.identifier === 'string' &&
      !definitions.has(node.identifier)
    ) {
      definitions.set(node.identifier, node);
    }
    if (hasMdastChildren(node)) {
      stack.push(...[...node.children].reverse());
    }
  }
  return definitions;
}

function linkDestination(
  node: MdastNode,
  definitions: ReadonlyMap<string, MdastNode>,
): string | undefined {
  if (node.type === 'link' || node.type === 'image') {
    return typeof node.url === 'string' ? node.url : undefined;
  }
  const definition =
    typeof node.identifier === 'string'
      ? definitions.get(node.identifier)
      : undefined;
  return typeof definition?.url === 'string' ? definition.url : undefined;
}

function imageDestination(
  node: MdastNode,
  definitions: ReadonlyMap<string, MdastNode>,
): string | undefined {
  return linkDestination(node, definitions);
}

function extractHeadingLabel(heading: MdastNode): string {
  const output: string[] = [];
  const stack = [...requiredChildren(heading)].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    switch (node.type) {
      case 'text':
        output.push((node.value ?? '').replaceAll('\n', ' '));
        break;
      case 'inlineCode':
        output.push(node.value ?? '');
        break;
      case 'break':
        output.push(' ');
        break;
      case 'image':
      case 'imageReference':
        output.push(node.alt ?? '');
        break;
      case 'emphasis':
      case 'strong':
      case 'link':
      case 'linkReference':
        if (hasMdastChildren(node)) {
          stack.push(...[...node.children].reverse());
        }
        break;
      default:
        break;
    }
  }
  return output.join('').trim();
}

function buildOffsetMap(text: string): ReadonlyMap<number, number> {
  const boundaries = new Map<number, number>([[0, 0]]);
  let utf16Offset = 0;
  let codePointOffset = 0;
  for (const codePoint of text) {
    utf16Offset += codePoint.length;
    codePointOffset += 1;
    boundaries.set(utf16Offset, codePointOffset);
  }
  return boundaries;
}

function rangeForAst(
  node: MdastNode,
  state: SourcePositionState,
): Readonly<ParsedSourceRange> {
  const startOffset = node.position?.start?.offset;
  const endOffset = node.position?.end?.offset;
  if (
    typeof startOffset !== 'number' ||
    typeof endOffset !== 'number' ||
    !Number.isSafeInteger(startOffset) ||
    !Number.isSafeInteger(endOffset)
  ) {
    markdownFail('invalid_source_position', '$.sourceUtf8');
  }
  const start = state.offsetToCodePoint.get(startOffset);
  const end = state.offsetToCodePoint.get(endOffset);
  if (start === undefined || end === undefined || end <= start) {
    markdownFail('invalid_source_position', '$.sourceUtf8');
  }
  return Object.freeze({
    codePointRange: Object.freeze({start, end}),
    lineRange: lineRangeFromIndex(state.textIndex.lineIndex, start, end),
  });
}

function createDraft(
  kind: DocumentNodeKind,
  start: number,
  end: number,
): NodeDraft {
  return {kind, start, end, children: [], linkOrdinal: 0};
}

function draftFromRange(
  kind: DocumentNodeKind,
  range: Readonly<ParsedSourceRange>,
): NodeDraft {
  return createDraft(
    kind,
    range.codePointRange.start,
    range.codePointRange.end,
  );
}

function addChild(parent: NodeDraft, child: NodeDraft): void {
  child.parent = parent;
  parent.children.push(child);
}

function flattenDrafts(root: NodeDraft): readonly NodeDraft[] {
  const result: NodeDraft[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    result.push(node);
    stack.push(...[...node.children].reverse());
  }
  return result;
}

function requiredLocalKey(node: NodeDraft): string {
  if (node.localKey === undefined) {
    markdownFail('invalid_tree', '$.nodes');
  }
  return node.localKey;
}

function requiredChildren(node: MdastNode): readonly MdastNode[] {
  if (!hasMdastChildren(node)) {
    markdownFail('internal_parser_failure', '$.sourceUtf8');
  }
  return node.children;
}

function hasMdastChildren(
  node: MdastNode,
): node is MdastNode & {readonly children: readonly MdastNode[]} {
  return Array.isArray(node.children);
}

function hasCoverAncestor(node: NodeDraft): boolean {
  let current: NodeDraft | undefined = node.parent;
  while (current !== undefined) {
    if (current.coverSection === true) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function compareRanges(
  left: Readonly<ParsedSourceRange>,
  right: Readonly<ParsedSourceRange>,
): number {
  return (
    left.codePointRange.start - right.codePointRange.start ||
    left.codePointRange.end - right.codePointRange.end
  );
}

function compareDiagnostics(
  left: Readonly<MarkdownDiagnostic>,
  right: Readonly<MarkdownDiagnostic>,
): number {
  return compareRanges(left, right) || compareAscii(left.code, right.code);
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function runtimeDigestAlgorithm(
  value: Readonly<{digestAlgorithm: string}>,
): unknown {
  return (value as unknown as Readonly<{digestAlgorithm?: unknown}>)
    .digestAlgorithm;
}
