import {describe, expect, it} from 'vitest';

import {
  LOCAL_DOCUMENT_FILE_MAX_BYTES,
  composeLocalDocumentSource,
  prepareLocalDocumentFile,
} from './local_file_import.js';

describe('local document file import', () => {
  it('prepares exact UTF-8 Markdown bytes with a portable content identity', async () => {
    const bytes = new TextEncoder().encode('# Synthetic\r\n\r\nBody 😀\r\n');
    const prepared = prepareLocalDocumentFile('synthetic.md', bytes);
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;

    const source = await composeLocalDocumentSource(prepared.value, '');
    const digest =
      '0823cf58e89947054187d15164783e3a597086b55eb631fe559ab68cce649a2c';
    expect(source).toEqual({
      sourceBase64: 'IyBTeW50aGV0aWMNCg0KQm9keSDwn5iADQo=',
      byteLength: bytes.byteLength,
      sha256: digest,
      defaultSourceKey: `synthetic.md#sha256:${digest}`,
      documentFormat: 'markdown',
      composed: false,
    });
    expect(prepared.value.mediaType).toBe('text/markdown');
    expect(prepared.value.sourceText).toBe('# Synthetic\r\n\r\nBody 😀\r\n');
  });

  it('treats a Markdown prefix as a visible composed Snapshot payload', async () => {
    const prepared = prepareLocalDocumentFile(
      'synthetic.txt',
      new TextEncoder().encode('Body.'),
    );
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;

    const source = await composeLocalDocumentSource(
      prepared.value,
      '  # Added context  ',
    );
    expect(source).toMatchObject({
      sourceBase64: 'IyBBZGRlZCBjb250ZXh0CgpCb2R5Lg==',
      documentFormat: 'markdown',
      composed: true,
    });
    expect(prepared.value.mediaType).toBe('text/plain');
  });

  it('keeps HTML raw bytes exact while carrying the prefix separately', async () => {
    const bytes = new TextEncoder().encode(
      '<!doctype html><html><body><main>正文</main></body></html>',
    );
    const prepared = prepareLocalDocumentFile('synthetic.HTML', bytes);
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;

    const source = await composeLocalDocumentSource(
      prepared.value,
      '  # Imported context  ',
    );
    expect(source).toMatchObject({
      sourceBase64:
        'PCFkb2N0eXBlIGh0bWw+PGh0bWw+PGJvZHk+PG1haW4+5q2j5paHPC9tYWluPjwvYm9keT48L2h0bWw+',
      byteLength: bytes.byteLength,
      documentFormat: 'html',
      sourcePreface: '# Imported context',
      composed: false,
    });
    expect(prepared.value.mediaType).toBe('text/html');
  });

  it('accepts a PDF by binary signature without decoding it as UTF-8', async () => {
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0xff, 0x00]);
    const prepared = prepareLocalDocumentFile('synthetic.pdf', bytes);
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;
    expect(prepared.value).toMatchObject({
      documentFormat: 'pdf',
      mediaType: 'application/pdf',
      sourceText: '',
    });
    await expect(
      composeLocalDocumentSource(prepared.value, ''),
    ).resolves.toMatchObject({documentFormat: 'pdf', composed: false});
  });

  it('rejects unsupported, path-like, malformed and empty files', () => {
    expect(
      prepareLocalDocumentFile('synthetic.docx', new Uint8Array([1])),
    ).toEqual({status: 'rejected', code: 'file_type_unsupported'});
    expect(
      prepareLocalDocumentFile('../synthetic.md', new Uint8Array([1])),
    ).toEqual({status: 'rejected', code: 'file_name_invalid'});
    expect(
      prepareLocalDocumentFile('synthetic.md', new Uint8Array([0xc0, 0xaf])),
    ).toEqual({status: 'rejected', code: 'file_utf8_invalid'});
    expect(
      prepareLocalDocumentFile(
        'synthetic.txt',
        new TextEncoder().encode('  \n'),
      ),
    ).toEqual({status: 'rejected', code: 'file_content_invalid'});
    expect(
      prepareLocalDocumentFile('synthetic.pdf', new TextEncoder().encode('no')),
    ).toEqual({status: 'rejected', code: 'file_content_invalid'});
  });

  it('enforces the same 1 MiB source budget before transport', async () => {
    expect(
      prepareLocalDocumentFile(
        'large.md',
        new Uint8Array(LOCAL_DOCUMENT_FILE_MAX_BYTES + 1),
      ),
    ).toEqual({status: 'rejected', code: 'file_too_large'});

    const prepared = prepareLocalDocumentFile(
      'boundary.md',
      new Uint8Array(LOCAL_DOCUMENT_FILE_MAX_BYTES).fill(0x61),
    );
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;
    await expect(
      composeLocalDocumentSource(prepared.value, 'prefix'),
    ).resolves.toBeUndefined();
  });
});
