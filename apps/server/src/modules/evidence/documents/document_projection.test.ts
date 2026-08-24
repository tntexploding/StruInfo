import {describe, expect, it} from 'vitest';

import {projectStructuredDocument} from './document_projection.js';

describe('structured document projection', () => {
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
