import {describe, expect, it} from 'vitest';

import {
  LOCAL_TEXT_FILE_MAX_BYTES,
  composeLocalTextFileSource,
  prepareLocalTextFile,
} from './local_file_import.js';

describe('local text file import', () => {
  it('prepares exact UTF-8 Markdown bytes with a portable content identity', async () => {
    const bytes = new TextEncoder().encode('# Synthetic\r\n\r\nBody 😀\r\n');
    const prepared = prepareLocalTextFile('synthetic.md', bytes);
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;

    const source = await composeLocalTextFileSource(prepared.value, '');
    expect(source).toBeDefined();
    const digest =
      '0823cf58e89947054187d15164783e3a597086b55eb631fe559ab68cce649a2c';
    expect(source).toEqual({
      sourceBase64: 'IyBTeW50aGV0aWMNCg0KQm9keSDwn5iADQo=',
      byteLength: bytes.byteLength,
      sha256: digest,
      defaultSourceKey: `synthetic.md#sha256:${digest}`,
      composed: false,
    });
    expect(prepared.value.mediaType).toBe('text/markdown');
    expect(prepared.value.sourceText).toBe('# Synthetic\r\n\r\nBody 😀\r\n');
  });

  it('treats an explicit prefix as a visible composed Snapshot payload', async () => {
    const prepared = prepareLocalTextFile(
      'synthetic.txt',
      new TextEncoder().encode('Body.'),
    );
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;

    const source = await composeLocalTextFileSource(
      prepared.value,
      '  # Added context  ',
    );
    const expected = new TextEncoder().encode('# Added context\n\nBody.');
    expect(source).toMatchObject({
      sourceBase64: 'IyBBZGRlZCBjb250ZXh0CgpCb2R5Lg==',
      byteLength: expected.byteLength,
      composed: true,
    });
    expect(prepared.value.mediaType).toBe('text/plain');
  });

  it('rejects unsupported, path-like, invalid UTF-8 and empty files', () => {
    expect(prepareLocalTextFile('synthetic.pdf', new Uint8Array([1]))).toEqual({
      status: 'rejected',
      code: 'file_type_unsupported',
    });
    expect(
      prepareLocalTextFile('../synthetic.md', new Uint8Array([1])),
    ).toEqual({status: 'rejected', code: 'file_name_invalid'});
    expect(
      prepareLocalTextFile('synthetic.md', new Uint8Array([0xc0, 0xaf])),
    ).toEqual({status: 'rejected', code: 'file_utf8_invalid'});
    expect(
      prepareLocalTextFile('synthetic.txt', new TextEncoder().encode('  \n')),
    ).toEqual({status: 'rejected', code: 'file_text_invalid'});
  });

  it('enforces the same 1 MiB source budget before transport', async () => {
    expect(
      prepareLocalTextFile(
        'large.md',
        new Uint8Array(LOCAL_TEXT_FILE_MAX_BYTES + 1),
      ),
    ).toEqual({status: 'rejected', code: 'file_too_large'});

    const prepared = prepareLocalTextFile(
      'boundary.md',
      new Uint8Array(LOCAL_TEXT_FILE_MAX_BYTES).fill(0x61),
    );
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;
    await expect(
      composeLocalTextFileSource(prepared.value, 'prefix'),
    ).resolves.toBeUndefined();
  });
});
