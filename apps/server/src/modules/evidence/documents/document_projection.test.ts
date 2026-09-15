import {describe, expect, it} from 'vitest';

import {projectStructuredDocument} from './document_projection.js';

describe('structured document projection', () => {
  it('prefers the inner article body over an outer article containing tag catalogs', async () => {
    const result = await projectStructuredDocument(
      'html',
      new TextEncoder().encode(
        '<head><title>Synthetic title</title></head><article><div class="post-content"><header><h1>Synthetic title</h1><p>Large unrelated tag catalog.</p></header><div class="article-content"><p>The full central argument.</p><figure><img src="/diagram.png" alt="Central diagram"><figcaption>Evidence caption.</figcaption></figure><p>Source-backed conclusion.</p></div><aside>Related tag catalog.</aside></div></article>',
      ),
    );
    expect(result.status).toBe('projected');
    if (result.status !== 'projected') return;
    const text = new TextDecoder().decode(result.value.sourceUtf8);
    expect(text).toContain('# Synthetic title');
    expect(text).toContain('The full central argument.');
    expect(text).toContain('Evidence caption.');
    expect(text).toContain('Source-backed conclusion.');
    expect(text).not.toMatch(/unrelated tag catalog|Related tag catalog/u);
  });

  it('distinguishes the article heading from navigation and site-banner headings', async () => {
    const result = await projectStructuredDocument(
      'html',
      new TextEncoder().encode(
        '<div class="body-wrapper"><nav><h1>Site logo</h1></nav><div class="banner"><h1>Daily column</h1></div><div class="news-article"><h1>Synthetic story</h1><p>First argument.</p><p>Supporting evidence.</p><figure><img src="/plot.png" alt="Evidence plot"></figure></div><footer>Site-wide menu.</footer></div>',
      ),
    );
    expect(result.status).toBe('projected');
    if (result.status !== 'projected') return;
    const text = new TextDecoder().decode(result.value.sourceUtf8);
    expect(text).toContain('Supporting evidence.');
    expect(text).toContain('Evidence plot');
    expect(text).not.toMatch(/Site logo|Daily column|Site-wide menu/u);
  });

  it('selects a marked reading body around one heading while retaining figures and citations', async () => {
    const html =
      '<body><nav>Site menu</nav><div class="page"><div class="story-body"><h1>Synthetic reading</h1><p>Opening argument.</p><figure><img src="/figure.png" alt="Synthetic figure"><figcaption>Figure context.</figcaption></figure><p>Continuation of the argument.</p><footer><a href="/citation">Article citation</a></footer></div><section><h2>Recommended cards</h2><p>Unrelated promoted text.</p></section></div><footer>Site boilerplate</footer></body>';
    const result = await projectStructuredDocument(
      'html',
      new TextEncoder().encode(html),
    );
    expect(result.status).toBe('projected');
    if (result.status !== 'projected') return;
    const text = new TextDecoder().decode(result.value.sourceUtf8);
    expect(text).toContain('Opening argument.');
    expect(text).toContain('Continuation of the argument.');
    expect(text).toContain('![Synthetic figure](/figure.png)');
    expect(text).toContain('Figure context.');
    expect(text).toContain('[Article citation](/citation)');
    expect(text).not.toMatch(
      /Site menu|Recommended cards|Unrelated promoted|Site boilerplate/u,
    );
  });
  it('does not truncate a multi-document HTML upload to the first marked body', async () => {
    const result = await projectStructuredDocument(
      'html',
      new TextEncoder().encode(
        '<div class="reading-content"><h1>One</h1><p>First document.</p></div><div class="reading-content"><h1>Two</h1><p>Second document.</p></div>',
      ),
    );
    expect(result.status).toBe('projected');
    if (result.status !== 'projected') return;
    expect(new TextDecoder().decode(result.value.sourceUtf8)).toContain(
      'Second document.',
    );
  });

  it('keeps image references and captions without executable URLs or nested links', async () => {
    const source = new TextEncoder().encode(
      '<article><h1>Synthetic diagram</h1><figure><a href="https://example.invalid/full"><img src="/diagram.png" alt="A labelled shape"></a><figcaption>The shape used in the procedure.</figcaption></figure><img src="javascript:bad()" alt="Unsafe reference"><img src="https://example.invalid/second.png"><p>Continuation.</p></article>',
    );
    const result = await projectStructuredDocument('html', source);
    expect(result.status).toBe('projected');
    if (result.status !== 'projected') return;
    const text = new TextDecoder().decode(result.value.sourceUtf8);
    expect(text).toContain('![A labelled shape](/diagram.png)');
    expect(text).toContain('The shape used in the procedure.');
    expect(text).toContain('![查看原图](https://example.invalid/second.png)');
    expect(text).not.toContain('javascript:');
    expect(text).not.toContain('[![');
  });

  it('extracts semantic HTML blocks without executing or retaining hidden code', async () => {
    const source = new TextEncoder().encode(`<!doctype html>
      <html><head><title>Synthetic document</title><script>secret()</script></head>
      <body><p>Outside fallback.</p><article>
        <h1>Main heading</h1>
        <p>A <a href="https://example.invalid/tool">useful link</a>.</p>
        <ul><li>First <a href="https://example.invalid/item">item</a></li><li aria-hidden="true">Hidden item</li></ul>
        <pre>const answer = 42;</pre>
      </article></body></html>`);

    const result = await projectStructuredDocument(
      'html',
      source,
      '# Imported context',
    );

    expect(result.status).toBe('projected');
    if (result.status !== 'projected') return;
    const text = new TextDecoder().decode(result.value.sourceUtf8);
    expect(text).toContain('# Imported context');
    expect(text).toContain('# Synthetic document');
    expect(text).toContain('# Main heading');
    expect(text).toContain('A [useful link](https://example.invalid/tool).');
    expect(text).toContain('- First [item](https://example.invalid/item)');
    expect(text).toContain('```text\nconst answer = 42;\n```');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('Hidden item');
    expect(text).not.toContain('Outside fallback');
  });

  it('extracts a synthetic PDF text layer under an explicit page heading', async () => {
    const result = await projectStructuredDocument(
      'pdf',
      createSyntheticPdf('Synthetic PDF text'),
    );

    expect(result.status).toBe('projected');
    if (result.status !== 'projected') return;
    expect(result.value.pageCount).toBe(1);
    expect(new TextDecoder().decode(result.value.sourceUtf8)).toContain(
      '## 第 1 页\n\nSynthetic PDF text',
    );
  });

  it('rejects malformed HTML/PDF input and does not claim OCR support', async () => {
    await expect(
      projectStructuredDocument('html', Uint8Array.from([0xc0, 0xaf])),
    ).resolves.toMatchObject({status: 'rejected', code: 'html_utf8_invalid'});
    await expect(
      projectStructuredDocument('pdf', new TextEncoder().encode('not a pdf')),
    ).resolves.toEqual({
      status: 'rejected',
      code: 'pdf_invalid',
      path: 'sourceBase64',
    });
    await expect(
      projectStructuredDocument(
        'html',
        new TextEncoder().encode('<script>x</script>'),
      ),
    ).resolves.toMatchObject({status: 'rejected', code: 'html_text_missing'});
  });
});

function createSyntheticPdf(text: string): Uint8Array {
  const escaped = text.replace(/([\\()])/gu, '\\$1');
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${escaped}) Tj\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length.toString()} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, value] of objects.entries()) {
    offsets.push(new TextEncoder().encode(pdf).byteLength);
    pdf += `${(index + 1).toString()} 0 obj\n${value}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(pdf).byteLength;
  pdf += `xref\n0 ${(objects.length + 1).toString()}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${(objects.length + 1).toString()} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset.toString()}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
