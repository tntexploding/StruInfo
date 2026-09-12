import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {ReadingContent} from './reading_content.js';
import {
  readingTitle,
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
