import {TextDecoder} from 'node:util';

import {parse, type DefaultTreeAdapterTypes} from 'parse5';
import type {getDocument as getPdfJsDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';

import {MARKDOWN_BUDGETS} from '../markdown/markdown_contract.js';

export const STRUCTURED_DOCUMENT_MAX_RAW_BYTES = 1_048_576;
// Public pages can carry large scripts while their extracted reading text is small.
// The Markdown output and PDF budgets remain independent.
export const STRUCTURED_HTML_MAX_RAW_BYTES = 8 * 1024 * 1024;
export const STRUCTURED_DOCUMENT_MAX_PAGES = 500;

export const STRUCTURED_DOCUMENT_FORMATS = ['html', 'pdf'] as const;
export type StructuredDocumentFormat =
  (typeof STRUCTURED_DOCUMENT_FORMATS)[number];

export type StructuredDocumentProjectionResult =
  | Readonly<{
      status: 'projected';
      value: Readonly<{sourceUtf8: Uint8Array; pageCount?: number}>;
    }>
  | Readonly<{
      status: 'rejected';
      code:
        | 'document_empty'
        | 'document_too_large'
        | 'html_utf8_invalid'
        | 'html_text_missing'
        | 'pdf_invalid'
        | 'pdf_password_required'
        | 'pdf_text_missing'
        | 'pdf_page_limit_exceeded'
        | 'projection_too_large';
      path: 'sourceBase64' | 'sourcePreface';
      budget?: 'source_bytes' | 'pdf_pages';
    }>;

const fatalUtf8Decoder = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
});
const SKIPPED_HTML_ELEMENTS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
  'canvas',
  'svg',
  'form',
  'button',
  'input',
  'select',
  'textarea',
]);
const CONTAINER_HTML_ELEMENTS = new Set([
  'html',
  'body',
  'article',
  'main',
  'section',
  'nav',
  'header',
  'footer',
  'aside',
  'div',
  'figure',
  'figcaption',
  'ul',
  'ol',
  'dl',
  'table',
  'thead',
  'tbody',
  'tfoot',
]);

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;
interface PdfTextItem {
  readonly str: string;
  readonly transform: readonly unknown[];
  readonly hasEOL: boolean;
}

type PdfJsGetDocument = typeof getPdfJsDocument;

let pdfJsGetDocumentPromise: Promise<PdfJsGetDocument> | undefined;

export async function projectStructuredDocument(
  format: StructuredDocumentFormat,
  sourceBytes: Uint8Array,
  sourcePreface?: string,
): Promise<StructuredDocumentProjectionResult> {
  if (sourceBytes.byteLength === 0) {
    return reject('document_empty', 'sourceBase64');
  }
  if (
    sourceBytes.byteLength >
    (format === 'html'
      ? STRUCTURED_HTML_MAX_RAW_BYTES
      : STRUCTURED_DOCUMENT_MAX_RAW_BYTES)
  ) {
    return reject('document_too_large', 'sourceBase64', 'source_bytes');
  }
  const normalizedPreface = normalizePreface(sourcePreface);
  if (normalizedPreface === undefined) {
    return reject('document_empty', 'sourcePreface');
  }
  const projected =
    format === 'html'
      ? projectHtml(sourceBytes)
      : await projectPdf(sourceBytes);
  if (projected.status === 'rejected') return projected;

  const sourceText =
    normalizedPreface === ''
      ? projected.text
      : `${normalizedPreface}\n\n${projected.text}`;
  const sourceUtf8 = new TextEncoder().encode(`${sourceText.trim()}\n`);
  if (sourceUtf8.byteLength > MARKDOWN_BUDGETS.sourceBytes) {
    return reject('projection_too_large', 'sourceBase64', 'source_bytes');
  }
  return Object.freeze({
    status: 'projected' as const,
    value: Object.freeze({
      sourceUtf8,
      ...(projected.pageCount === undefined
        ? {}
        : {pageCount: projected.pageCount}),
    }),
  });
}

function projectHtml(
  sourceBytes: Uint8Array,
):
  | Readonly<{status: 'ready'; text: string; pageCount?: undefined}>
  | Extract<StructuredDocumentProjectionResult, {status: 'rejected'}> {
  let html: string;
  try {
    html = fatalUtf8Decoder.decode(Uint8Array.from(sourceBytes));
  } catch {
    return reject('html_utf8_invalid', 'sourceBase64');
  }
  if (html.includes('\u0000') || html.trim() === '') {
    return reject('document_empty', 'sourceBase64');
  }
  const document = parse(html);
  const root =
    findExplicitArticleBody(document) ??
    findFirstElement(document, 'article') ??
    findHeadingContentContainer(document) ??
    findFirstElement(document, 'main') ??
    findFirstElement(document, 'body') ??
    document;
  const blocks: string[] = [];
  const title = findFirstElement(document, 'title');
  if (title !== undefined) {
    const titleText = normalizeInlineText(descendantText(title));
    if (titleText !== '') blocks.push(`# ${escapeMarkdown(titleText)}`);
  }
  renderHtmlBlocks(root, blocks);
  const text = normalizeBlocks(blocks);
  return text === ''
    ? reject('html_text_missing', 'sourceBase64')
    : Object.freeze({status: 'ready' as const, text});
}

async function projectPdf(
  sourceBytes: Uint8Array,
): Promise<
  | Readonly<{status: 'ready'; text: string; pageCount: number}>
  | Extract<StructuredDocumentProjectionResult, {status: 'rejected'}>
> {
  if (!startsWithPdfMagic(sourceBytes)) {
    return reject('pdf_invalid', 'sourceBase64');
  }
  let getDocument: PdfJsGetDocument;
  try {
    getDocument = await loadPdfJsGetDocument();
  } catch {
    return reject('pdf_invalid', 'sourceBase64');
  }
  const loadingTask = getDocument({
    data: Uint8Array.from(sourceBytes),
    stopAtErrors: true,
    useWasm: false,
    useWorkerFetch: false,
  });
  const passwordState = {requested: false};
  loadingTask.onPassword = () => {
    passwordState.requested = true;
    void loadingTask.destroy();
  };
  try {
    const document = await loadingTask.promise;
    if (document.numPages > STRUCTURED_DOCUMENT_MAX_PAGES) {
      return reject('pdf_page_limit_exceeded', 'sourceBase64', 'pdf_pages');
    }
    const blocks: string[] = [];
    let textItemCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({
        disableNormalization: false,
        includeMarkedContent: false,
      });
      const lines = pdfTextLines(content.items);
      if (lines.length > 0) {
        blocks.push(`## 第 ${pageNumber.toString()} 页`);
        blocks.push(...lines);
        textItemCount += lines.length;
      }
      page.cleanup();
    }
    if (textItemCount === 0) {
      return reject('pdf_text_missing', 'sourceBase64');
    }
    return Object.freeze({
      status: 'ready' as const,
      text: normalizeBlocks(blocks),
      pageCount: document.numPages,
    });
  } catch {
    return reject(
      passwordState.requested ? 'pdf_password_required' : 'pdf_invalid',
      'sourceBase64',
    );
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

async function loadPdfJsGetDocument(): Promise<PdfJsGetDocument> {
  installPdfTextExtractionDomMatrix();
  pdfJsGetDocumentPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then(
    (module) => module.getDocument,
  );
  return pdfJsGetDocumentPromise;
}

function installPdfTextExtractionDomMatrix(): void {
  if (typeof Reflect.get(globalThis, 'DOMMatrix') === 'function') return;
  Object.defineProperty(globalThis, 'DOMMatrix', {
    configurable: true,
    enumerable: false,
    value: PdfTextExtractionDomMatrix,
    writable: true,
  });
}

/**
 * PDF.js constructs one identity DOMMatrix while loading its display bundle,
 * even when StruInfo uses only getTextContent(). Rendering is not exposed here,
 * so the six identity fields are the complete compatibility surface required by
 * the admitted text-only path; unexpected rendering operations still fail closed.
 */
class PdfTextExtractionDomMatrix {
  public a = 1;
  public b = 0;
  public c = 0;
  public d = 1;
  public e = 0;
  public f = 0;
}

function renderHtmlBlocks(node: HtmlNode, blocks: string[]): void {
  if (isTextNode(node)) {
    const text = normalizeInlineText(node.value);
    if (text !== '') blocks.push(escapeMarkdown(text));
    return;
  }
  if (isHtmlElement(node)) {
    const tagName = node.tagName.toLowerCase();
    if (
      SKIPPED_HTML_ELEMENTS.has(tagName) ||
      isHiddenElement(node) ||
      isShareWidget(node)
    )
      return;
    if (/^h[1-6]$/u.test(tagName)) {
      const value = normalizeInlineText(descendantText(node));
      if (value !== '') {
        blocks.push(
          `${'#'.repeat(Number(tagName.slice(1)))} ${escapeMarkdown(value)}`,
        );
      }
      return;
    }
    if (tagName === 'p' || tagName === 'address' || tagName === 'figcaption') {
      pushInlineBlock(blocks, node);
      return;
    }
    if (tagName === 'li') {
      const value = inlineMarkdown(node).trim();
      if (value !== '') blocks.push(`- ${value}`);
      return;
    }
    if (tagName === 'blockquote') {
      const value = normalizeInlineText(descendantText(node));
      if (value !== '') blocks.push(`> ${escapeMarkdown(value)}`);
      return;
    }
    if (tagName === 'pre') {
      const value = descendantText(node).trim();
      if (value !== '') blocks.push(`\`\`\`text\n${value}\n\`\`\``);
      return;
    }
    if (tagName === 'table' || tagName === 'figure') {
      const parts: string[] = [];
      for (const child of childNodes(node)) renderHtmlBlocks(child, parts);
      // A row, caption or chart credit is not an independent reading item.
      // One newline retains cells (including empty ones) and their ordering.
      if (parts.length) blocks.push(parts.join('\n'));
      return;
    }
    if (tagName === 'tr') {
      const cells = childNodes(node)
        .filter(
          (child): child is HtmlElement =>
            isHtmlElement(child) &&
            (child.tagName === 'th' || child.tagName === 'td'),
        )
        .map((cell) => inlineMarkdown(cell).trim());
      if (cells.length > 0) {
        blocks.push(
          `| ${cells.map((cell) => cell.replace(/\|/gu, '\\|')).join(' | ')} |`,
        );
      }
      return;
    }
    if (!CONTAINER_HTML_ELEMENTS.has(tagName)) {
      const value = inlineMarkdown(node).trim();
      if (value !== '') blocks.push(value);
      return;
    }
  }
  for (const child of childNodes(node)) renderHtmlBlocks(child, blocks);
}

function pushInlineBlock(blocks: string[], element: HtmlElement): void {
  const value = inlineMarkdown(element).trim();
  if (value !== '') blocks.push(value);
}

function inlineMarkdown(node: HtmlNode): string {
  if (isTextNode(node))
    return escapeMarkdown(normalizeInlineTextFragment(node.value));
  if (!isHtmlElement(node) || SKIPPED_HTML_ELEMENTS.has(node.tagName))
    return '';
  if (isHiddenElement(node) || isShareWidget(node)) return '';
  if (node.tagName === 'br') return '\n';
  if (node.tagName === 'img') {
    const alt = normalizeInlineText(attributeValue(node, 'alt') ?? '');
    const source = safeImageReference(
      attributeValue(node, 'src') ?? attributeValue(node, 'data-src'),
    );
    return source === undefined
      ? alt === ''
        ? ''
        : `图片：${escapeMarkdown(alt)}`
      : `![${escapeMarkdown(alt || '查看原图')}](${escapeMarkdownDestination(source)})`;
  }
  const value = childNodes(node).map(inlineMarkdown).join('');
  if (node.tagName === 'code' && value.trim() !== '') {
    return `\`${value.trim()}\``;
  }
  if (node.tagName === 'a') {
    // The reader exposes images as explicit links; do not create nested links.
    if (
      childNodes(node).some(
        (child) => isHtmlElement(child) && child.tagName === 'img',
      )
    )
      return value;
    const href = attributeValue(node, 'href');
    const label = value.trim();
    if (href !== undefined && href.trim() !== '' && label !== '') {
      return `[${label}](${escapeMarkdownDestination(href.trim())})`;
    }
  }
  return value;
}

function safeImageReference(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const source = value.trim();
  try {
    // Relative references resolve against the original document when read.
    const parsed = new URL(source, 'https://document.invalid/');
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      return undefined;
    return source;
  } catch {
    return undefined;
  }
}

function pdfTextLines(items: readonly unknown[]): string[] {
  const lines: string[] = [];
  let line = '';
  let previousY: number | undefined;
  for (const candidate of items) {
    if (!isPdfTextItem(candidate)) continue;
    const text = normalizeInlineText(candidate.str);
    const y = candidate.transform[5];
    if (
      line !== '' &&
      typeof y === 'number' &&
      previousY !== undefined &&
      Math.abs(y - previousY) > 0.5
    ) {
      lines.push(line.trim());
      line = '';
    }
    if (text !== '') {
      line += needsWordSeparator(line, text) ? ` ${text}` : text;
    }
    if (candidate.hasEOL && line !== '') {
      lines.push(line.trim());
      line = '';
    }
    if (typeof y === 'number') previousY = y;
  }
  if (line !== '') lines.push(line.trim());
  return lines.filter((value) => value !== '');
}

function isPdfTextItem(value: unknown): value is PdfTextItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.hasOwn(value, 'str') &&
    typeof (value as {str?: unknown}).str === 'string' &&
    Array.isArray((value as {transform?: unknown}).transform) &&
    typeof (value as {hasEOL?: unknown}).hasEOL === 'boolean'
  );
}

function needsWordSeparator(current: string, next: string): boolean {
  if (current === '' || next === '') return false;
  return /[\p{L}\p{N}]$/u.test(current) && /^[\p{L}\p{N}]/u.test(next);
}

function childNodes(node: HtmlNode): readonly HtmlNode[] {
  return 'childNodes' in node ? node.childNodes : [];
}

function isHtmlElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node && typeof node.tagName === 'string';
}

function isTextNode(node: HtmlNode): node is DefaultTreeAdapterTypes.TextNode {
  return node.nodeName === '#text' && 'value' in node;
}

function findFirstElement(
  node: HtmlNode,
  tagName: string,
): HtmlElement | undefined {
  if (isHtmlElement(node) && isHiddenElement(node)) return undefined;
  if (isHtmlElement(node) && node.tagName.toLowerCase() === tagName)
    return node;
  for (const child of childNodes(node)) {
    const found = findFirstElement(child, tagName);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Prefer an explicitly marked reading body over an outer article with tag menus. */
function findExplicitArticleBody(document: HtmlNode): HtmlElement | undefined {
  const candidates: HtmlElement[] = [];
  const visit = (node: HtmlNode) => {
    if (isHtmlElement(node)) {
      if (
        isHiddenElement(node) ||
        SKIPPED_HTML_ELEMENTS.has(node.tagName) ||
        ['aside', 'nav'].includes(node.tagName)
      )
        return;
      const markers = [
        attributeValue(node, 'id') ?? '',
        attributeValue(node, 'class') ?? '',
      ]
        .join(' ')
        .replace(/([a-z])([A-Z])/gu, '$1-$2')
        .replace(/[_-]+/gu, '-')
        .toLowerCase();
      const itemprop = attributeValue(node, 'itemprop') ?? '';
      if (
        (/(?:^|\s)articleBody(?:$|\s)/u.test(itemprop) ||
          /(?:^|[\s_-])(?:article|post|entry|story)[_-](?:body|content|cnt)(?:$|[\s_-])/u.test(
            markers,
          )) &&
        findFirstElement(node, 'p')
      )
        candidates.push(node);
    }
    for (const child of childNodes(node)) visit(child);
  };
  visit(document);
  const leaves = candidates.filter(
    (candidate) =>
      !candidates.some((other) => {
        if (other === candidate) return false;
        let parent = other.parentNode;
        while (parent && isHtmlElement(parent)) {
          if (parent === candidate) return true;
          parent = parent.parentNode;
        }
        return false;
      }),
  );
  if (leaves.length === 1) return leaves[0];
  // An article can place its introduction, figures and later sections in
  // separate reading bodies. Keep their nearest explicit common container.
  // Several independent articles must still fall back to the complete page.
  return [...candidates]
    .reverse()
    .find(
      (candidate) =>
        leaves.length > 1 &&
        leaves.every((leaf) => isDescendantOf(leaf, candidate)) &&
        countVisibleHeadings(candidate) <= 1,
    );
}

function isDescendantOf(node: HtmlNode, ancestor: HtmlNode): boolean {
  let parent = 'parentNode' in node ? node.parentNode : null;
  while (parent) {
    if (parent === ancestor) return true;
    parent = 'parentNode' in parent ? parent.parentNode : null;
  }
  return false;
}

function countVisibleHeadings(node: HtmlNode): number {
  if (
    isHtmlElement(node) &&
    (isHiddenElement(node) ||
      SKIPPED_HTML_ELEMENTS.has(node.tagName) ||
      node.tagName === 'nav')
  )
    return 0;
  return (
    (isHtmlElement(node) && node.tagName === 'h1' ? 1 : 0) +
    childNodes(node).reduce(
      (count, child) => count + countVisibleHeadings(child),
      0,
    )
  );
}

/** One marked article container may coexist with site-banner headings. */
function findHeadingContentContainer(
  document: HtmlNode,
): HtmlElement | undefined {
  const headings: HtmlElement[] = [];
  const visit = (node: HtmlNode) => {
    if (
      isHtmlElement(node) &&
      (isHiddenElement(node) ||
        SKIPPED_HTML_ELEMENTS.has(node.tagName) ||
        node.tagName === 'nav')
    )
      return;
    if (isHtmlElement(node) && node.tagName === 'h1') headings.push(node);
    for (const child of childNodes(node)) visit(child);
  };
  visit(document);
  const headingCounts = new Map<HtmlNode, number>();
  for (const heading of headings) {
    let parent = heading.parentNode;
    while (parent && isHtmlElement(parent)) {
      headingCounts.set(parent, (headingCounts.get(parent) ?? 0) + 1);
      parent = parent.parentNode;
    }
  }
  const candidates = new Set<HtmlElement>();
  for (const heading of headings) {
    let parent = heading.parentNode;
    while (
      parent &&
      isHtmlElement(parent) &&
      !['body', 'html'].includes(parent.tagName)
    ) {
      const markers = [
        attributeValue(parent, 'id') ?? '',
        attributeValue(parent, 'class') ?? '',
      ].join(' ');
      if (
        headingCounts.get(parent) === 1 &&
        /(?:^|[\s_-])(?:article|post|entry|story|body|content)(?:$|[\s_-])/u.test(
          markers,
        ) &&
        findFirstElement(parent, 'p')
      ) {
        candidates.add(parent);
        break;
      }
      parent = parent.parentNode;
    }
  }
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

function descendantText(node: HtmlNode): string {
  if (isTextNode(node)) return node.value;
  if (isHtmlElement(node) && SKIPPED_HTML_ELEMENTS.has(node.tagName)) return '';
  if (isHtmlElement(node) && isHiddenElement(node)) return '';
  return childNodes(node).map(descendantText).join(' ');
}

/** Skip recognizable sharing controls, never arbitrary prose containing “share”. */
function isShareWidget(element: HtmlElement): boolean {
  const tokens = [
    attributeValue(element, 'class') ?? '',
    attributeValue(element, 'id') ?? '',
  ]
    .join(' ')
    .split(/\s+/u);
  return tokens.some((token) =>
    /^(?:social[-_]share(?:[-_]buttons?)?|share[-_](?:buttons?|tools?|links?|widget)|sharing[-_](?:tools?|buttons?)|addtoany(?:[-_]share[-_]save)?|a2a_kit|sharedaddy|wp-block-jetpack-sharing-buttons)$/iu.test(
      token,
    ),
  );
}

function isHiddenElement(element: HtmlElement): boolean {
  return (
    attributeValue(element, 'hidden') !== undefined ||
    attributeValue(element, 'aria-hidden')?.toLowerCase() === 'true'
  );
}

function attributeValue(
  element: HtmlElement,
  name: string,
): string | undefined {
  return element.attrs.find((attribute) => attribute.name === name)?.value;
}

function normalizePreface(value: string | undefined): string | undefined {
  if (value === undefined) return '';
  if (value.includes('\u0000')) return undefined;
  return value.trim().replace(/\r\n?/gu, '\n');
}

function normalizeInlineText(value: string): string {
  return normalizeInlineTextFragment(value).trim();
}

function normalizeInlineTextFragment(value: string): string {
  return value.replace(/[\t\n\f\r ]+/gu, ' ');
}

function normalizeBlocks(blocks: readonly string[]): string {
  return blocks
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .join('\n\n')
    .trim();
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_[\]<>]/gu, '\\$&');
}

function escapeMarkdownDestination(value: string): string {
  return value.replace(/\s/gu, '%20').replace(/\)/gu, '%29');
}

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

function reject(
  code: Extract<
    StructuredDocumentProjectionResult,
    {status: 'rejected'}
  >['code'],
  path: 'sourceBase64' | 'sourcePreface',
  budget?: 'source_bytes' | 'pdf_pages',
): Extract<StructuredDocumentProjectionResult, {status: 'rejected'}> {
  return Object.freeze({
    status: 'rejected' as const,
    code,
    path,
    ...(budget === undefined ? {} : {budget}),
  });
}
