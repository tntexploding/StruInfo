import {fromMarkdown} from 'mdast-util-from-markdown';
import {Fragment, useEffect, useMemo, useRef} from 'react';
import type {ReactNode, RefObject} from 'react';

import {
  plainText,
  readingTitle,
  safeReadingLink,
  type MarkdownNode,
} from './reading_text.js';

export interface ReadingBoundary {
  readonly offset: number;
  readonly label: string;
  readonly separator?: boolean;
  readonly annotation?: ReactNode;
}
const NO_BOUNDARIES: readonly ReadingBoundary[] = [];

export function ReadingContent({
  text,
  baseUri,
  omitLeadingTitle,
  lang,
  scrollLabel,
  scrollMemory,
  active = true,
  boundaries = NO_BOUNDARIES,
  leadingContent,
}: {
  readonly text: string;
  readonly baseUri?: string | undefined;
  readonly omitLeadingTitle?: string | undefined;
  readonly lang?: string | undefined;
  readonly scrollLabel?: string | undefined;
  readonly active?: boolean;
  readonly boundaries?: readonly ReadingBoundary[];
  readonly leadingContent?: ReactNode;
  readonly scrollMemory?:
    | Readonly<{key: string; positions: RefObject<Map<string, number>>}>
    | undefined;
}) {
  const scrollRegion = useRef<HTMLDivElement>(null);
  const positionKey = scrollMemory?.key;
  const positions = scrollMemory?.positions;
  useEffect(() => {
    if (active && scrollRegion.current !== null) {
      scrollRegion.current.scrollTop =
        positionKey === undefined
          ? 0
          : (positions?.current.get(positionKey) ?? 0);
    }
  }, [active, text, positionKey, positions]);
  const document = useMemo(() => fromMarkdown(text), [text]);
  const definitions = new Map<string, string>();
  for (const node of document.children) {
    if (node.type === 'definition')
      definitions.set(node.identifier.toLowerCase(), node.url);
  }
  const marker = (boundary: ReadingBoundary) => (
    <Fragment key={boundary.offset}>
      {boundary.separator !== false ? (
        <span
          className="reading-split-boundary"
          role="separator"
          aria-label={'拆分边界：' + boundary.label}
        >
          <span aria-hidden="true">{boundary.label}</span>
        </span>
      ) : null}
      {boundary.annotation ? (
        <span className="reading-split-annotation">{boundary.annotation}</span>
      ) : null}
    </Fragment>
  );
  const renderNodes = (
    nodes: readonly MarkdownNode[],
    marks: readonly ReadingBoundary[],
  ): ReactNode => {
    let remaining = marks;
    const result: ReactNode[] = [];
    for (const [index, node] of nodes.entries()) {
      const start = node.position?.start.offset ?? 0;
      const end = node.position?.end.offset ?? start;
      const before = remaining.filter((m) => m.offset <= start);
      const inside = remaining.filter(
        (m) => m.offset > start && m.offset < end,
      );
      remaining = remaining.filter((m) => m.offset >= end && m.offset > start);
      result.push(
        <Fragment key={index}>
          {node.type === 'listItem' ? (
            render(node, inside, before)
          ) : (
            <>
              {before.map(marker)}
              {render(node, inside)}
            </>
          )}
        </Fragment>,
      );
    }
    return (
      <>
        {result}
        {remaining.map(marker)}
      </>
    );
  };
  const render = (
    node: MarkdownNode,
    marks: readonly ReadingBoundary[],
    leading: readonly ReadingBoundary[] = NO_BOUNDARIES,
  ): ReactNode => {
    const children = node.children
      ? renderNodes(node.children, marks)
      : undefined;
    // A cut within a raw Markdown leaf stays at its exact source offset, including escaped text.
    if (
      !node.children &&
      marks.length &&
      node.position?.start.offset !== undefined &&
      node.position.end.offset !== undefined
    ) {
      const start = node.position.start.offset;
      const end = node.position.end.offset;
      const parts: ReactNode[] = [];
      let cursor = start;
      for (const point of marks) {
        parts.push(text.slice(cursor, point.offset), marker(point));
        cursor = point.offset;
      }
      parts.push(text.slice(cursor, end));
      return node.type === 'code' ? (
        <pre>
          <code>{parts}</code>
        </pre>
      ) : (
        <>{parts}</>
      );
    }
    switch (node.type) {
      case 'text':
        return node.value;
      case 'paragraph':
        return <p>{children}</p>;
      case 'heading': {
        const Heading =
          node.depth === 1 ? 'h3' : node.depth === 2 ? 'h4' : 'h5';
        return <Heading>{children}</Heading>;
      }
      case 'strong':
        return <strong>{children}</strong>;
      case 'emphasis':
        return <em>{children}</em>;
      case 'inlineCode':
        return <code>{node.value}</code>;
      case 'code':
        return (
          <pre>
            <code>{node.value}</code>
          </pre>
        );
      case 'blockquote':
        return <blockquote>{children}</blockquote>;
      case 'list':
        return node.ordered ? (
          <ol start={node.start ?? 1}>{children}</ol>
        ) : (
          <ul>{children}</ul>
        );
      case 'listItem':
        return (
          <li>
            {leading.map(marker)}
            {children}
          </li>
        );
      case 'break':
        return <br />;
      case 'thematicBreak':
        return <hr />;
      case 'definition':
        return null;
      case 'html':
        return <code className="reading-content__literal">{node.value}</code>;
      case 'image':
      case 'imageReference':
      case 'link':
      case 'linkReference': {
        const url =
          node.url ?? definitions.get(node.identifier?.toLowerCase() ?? '');
        const href = safeReadingLink(url, baseUri);
        const label = node.type.startsWith('image')
          ? `图片：${node.alt ?? '查看原图'}`
          : children;
        return href === undefined ? (
          <span>{label}</span>
        ) : (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            {label}
          </a>
        );
      }
      default:
        return children ?? node.value ?? null;
    }
  };
  return (
    <div
      ref={scrollRegion}
      onScroll={(event) => {
        if (active && positionKey !== undefined)
          positions?.current.set(positionKey, event.currentTarget.scrollTop);
      }}
      className="reading-content"
      lang={lang}
      role={scrollLabel === undefined ? undefined : 'region'}
      aria-label={scrollLabel}
      tabIndex={scrollLabel === undefined ? undefined : 0}
      data-scrollable={scrollLabel !== undefined}
    >
      {leadingContent ? (
        <div className="reading-content__lead">{leadingContent}</div>
      ) : null}
      {renderNodes(
        document.children.filter(
          (node, index) =>
            !(
              index === 0 &&
              node.type === 'heading' &&
              omitLeadingTitle !== undefined &&
              plainText(node).trim() === readingTitle(omitLeadingTitle)
            ),
        ),
        boundaries,
      )}
    </div>
  );
}
