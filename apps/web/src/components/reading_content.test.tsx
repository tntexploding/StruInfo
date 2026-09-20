import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {ReadingContent} from './reading_content.js';
import {
  readingTitle,
  compactDocumentTitle,
  sourceDisplayName,
  sourceShortName,
} from './reading_text.js';

describe('safe article reading', () => {
  it('renders Markdown, resolves source-relative references and avoids duplicate headings', () => {
    const text =
      '# Test article\n\nA **bold** paragraph with [a reference][r].\n\n- One\n- Two\n\n[r]: ../detail';
    const markup = renderToStaticMarkup(
      <ReadingContent
        text={text}
        baseUri="https://example.invalid/articles/test"
        omitLeadingTitle="Test article"
      />,
    );
    expect(markup).toContain('<strong>bold</strong>');
    expect(markup).toContain('<ul>');
    expect(markup).toContain('href="https://example.invalid/detail"');
    expect(markup).not.toContain('<h3>');
  });

  it('keeps active HTML inert, rejects active URLs, and never loads article images', () => {
    const text =
      '<script>alert(1)</script>\n\n[bad](javascript:alert%281%29) ![remote](https://example.invalid/pixel.png) [data](data:text/html,test)';
    const markup = renderToStaticMarkup(<ReadingContent text={text} />);
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('href="javascript:');
    expect(markup).not.toContain('href="data:');
    expect(markup).toContain('&lt;script&gt;');
    expect(markup).toContain('图片：remote');
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it('presents human names without changing stored identifiers', () => {
    expect(readingTitle('[Readable **title**](https://example.invalid)')).toBe(
      'Readable title',
    );
    const source = {
      sourceKey: 'feed:0123456789abcdef0123456789abcdef',
      canonicalUri: 'https://example.invalid/news/test-article.html',
    };
    expect(sourceDisplayName(source)).toBe('test article · example.invalid');
    expect(sourceShortName(source)).toBe('example.invalid');
    expect(source.sourceKey).toContain('0123456789abcdef');
    expect(sourceDisplayName({sourceKey: 'Manual document'})).toBe(
      'Manual document',
    );
  });
});

describe('source split boundaries', () => {
  it('marks real block boundaries while retaining formatting and reference links', () => {
    const text =
      '# Title\n\nFirst **bold** paragraph.\n\n## Next\n\nSecond [reference][r].\n\n[r]: https://example.invalid/reference';
    const markup = renderToStaticMarkup(
      <ReadingContent
        text={text}
        boundaries={[{offset: text.indexOf('## Next'), label: '第 2 条'}]}
      />,
    );
    expect(markup.match(/role="separator"/g)).toHaveLength(1);
    expect(markup).toContain('<strong>bold</strong>');
    expect(markup).toContain('href="https://example.invalid/reference"');
    expect(markup.indexOf('role="separator"')).toBeGreaterThan(
      markup.indexOf('paragraph.'),
    );
    expect(markup.indexOf('role="separator"')).toBeLessThan(
      markup.indexOf('<h4>Next'),
    );
  });
  it('marks an exact Unicode cut inside a paragraph and inside a list item', () => {
    const text = 'A😀Z\n\n- First\n- Second';
    const markup = renderToStaticMarkup(
      <ReadingContent
        text={text}
        boundaries={[
          {offset: 3, label: '第二段'},
          {offset: text.indexOf('- Second'), label: '第三段'},
        ]}
      />,
    );
    expect(markup.match(/role="separator"/g)).toHaveLength(2);
    expect(markup).toContain('<p>A😀<span');
    expect(markup).toContain('</span>Z</p>');
    expect(markup).toContain('<li><span class="reading-split-boundary"');
    expect(markup).toContain('<p>Second</p></li>');
  });
  it('does not invent a boundary for a whole document', () => {
    expect(
      renderToStaticMarkup(
        <ReadingContent text="One complete article." boundaries={[]} />,
      ),
    ).not.toContain('role="separator"');
  });
});

describe('compact document headings', () => {
  it('keeps normal titles intact', () => {
    expect(compactDocumentTitle('Synthetic complete title')).toBe(
      'Synthetic complete title',
    );
  });
  it('uses a complete briefing heading without retaining its long appended body', () => {
    const heading = '【合成资料每日速递（01月01日）】';
    expect(compactDocumentTitle(heading + ' 合成摘要条目。'.repeat(40))).toBe(
      heading,
    );
  });
  it('does not mistake a short category prefix for the whole title', () => {
    const value = '【测试】' + '合成标题文字'.repeat(20);
    expect(compactDocumentTitle(value)).toBe(
      Array.from(value).slice(0, 80).join('') + '…',
    );
  });
  it('shortens other oversized headings at a Unicode scalar boundary', () => {
    expect(compactDocumentTitle('😀'.repeat(90))).toBe('😀'.repeat(80) + '…');
  });
});
