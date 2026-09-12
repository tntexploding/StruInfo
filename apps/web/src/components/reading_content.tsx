import {fromMarkdown} from 'mdast-util-from-markdown';
import {Fragment, useEffect, useMemo, useRef} from 'react';
import type {ReactNode, RefObject} from 'react';

import {
  plainText,
  readingTitle,
  safeReadingLink,
  type MarkdownNode,
} from './reading_text.js';

export function ReadingContent({
  text,
  baseUri,
  omitLeadingTitle,
  lang,
  scrollLabel,
  scrollMemory,
  active = true,
}: {
  readonly text: string;
  readonly baseUri?: string | undefined;
  readonly omitLeadingTitle?: string | undefined;
  readonly lang?: string | undefined;
  readonly scrollLabel?: string | undefined;
  readonly active?: boolean;
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
  const render = (node: MarkdownNode): ReactNode => {
    const children = node.children?.map((child, index) => (
      <Fragment key={index}>{render(child)}</Fragment>
    ));
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
        return <li>{children}</li>;
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
      {document.children.map((node, index) =>
        index === 0 &&
        node.type === 'heading' &&
        omitLeadingTitle !== undefined &&
        plainText(node).trim() === readingTitle(omitLeadingTitle) ? null : (
          <Fragment key={index}>{render(node)}</Fragment>
        ),
      )}
    </div>
  );
}
