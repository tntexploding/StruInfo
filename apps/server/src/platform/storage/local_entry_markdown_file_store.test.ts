import {mkdtemp, readdir, readFile, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach, describe, expect, it} from 'vitest';
import {LocalEntryMarkdownFileStore} from './local_entry_markdown_file_store.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, {recursive: true, force: true});
});
describe('external Markdown file store', () => {
  it('preserves exact UTF-8 bytes, gives each export a unique safe name and leaves no temporary file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'struinfo-synthetic-markdown-'));
    roots.push(root);
    const store = new LocalEntryMarkdownFileStore(root);
    const bytes = new TextEncoder().encode('# 合成清单\n\n🙂\n');
    const first = await store.write(
      '11111111-1111-4111-8111-111111111111',
      bytes,
    );
    const second = await store.write(
      '11111111-1111-4111-8111-111111111111',
      bytes,
    );
    expect(first.fileName).toMatch(/^[0-9a-f-]+\.entries\.md$/u);
    expect(first.fileName).not.toBe(second.fileName);
    expect(await readFile(join(root, first.fileName))).toEqual(
      Buffer.from(bytes),
    );
    expect(await readdir(root)).toHaveLength(2);
    if (process.platform !== 'win32')
      expect((await stat(join(root, first.fileName))).mode & 0o777).toBe(0o600);
  });
  it('rejects traversal identity and reports a missing root without exposing its path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'struinfo-synthetic-markdown-'));
    roots.push(root);
    const store = new LocalEntryMarkdownFileStore(root);
    await expect(
      store.write('../outside', new Uint8Array([65])),
    ).rejects.toThrow('Markdown export storage unavailable.');
    expect(await readdir(root)).toHaveLength(0);
    await expect(
      new LocalEntryMarkdownFileStore(join(root, 'missing')).write(
        '11111111-1111-4111-8111-111111111111',
        new Uint8Array([65]),
      ),
    ).rejects.toThrow('Markdown export storage unavailable.');
  });
});
