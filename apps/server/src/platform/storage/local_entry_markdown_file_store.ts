import {randomUUID} from 'node:crypto';
import {open, rename, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {
  MAXIMUM_ENTRY_MARKDOWN_EXPORT_BYTES,
  type EntryMarkdownFileStore,
  type EntryMarkdownStoredFile,
} from '../../modules/entries/information_entry_markdown_export.js';

/** The root is the validated external exports area created at startup. */
export class LocalEntryMarkdownFileStore implements EntryMarkdownFileStore {
  public constructor(private readonly exportsRoot: string) {}
  public async write(
    workspaceId: string,
    bytes: Uint8Array,
  ): Promise<Readonly<EntryMarkdownStoredFile>> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
        workspaceId,
      ) ||
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength === 0 ||
      bytes.byteLength > MAXIMUM_ENTRY_MARKDOWN_EXPORT_BYTES
    )
      throw new Error('Markdown export storage unavailable.');
    const fileName = workspaceId + '-' + randomUUID() + '.entries.md';
    const temporaryPath = join(this.exportsRoot, '.' + randomUUID() + '.tmp');
    const owned = Uint8Array.from(bytes);
    let temporaryCreated = false;
    try {
      const handle = await open(temporaryPath, 'wx', 0o600);
      temporaryCreated = true;
      try {
        await handle.writeFile(owned);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, join(this.exportsRoot, fileName));
      return Object.freeze({fileName, byteLength: owned.byteLength});
    } catch {
      if (temporaryCreated) {
        try {
          await unlink(temporaryPath);
        } catch {
          /* Preserve the safe storage error. */
        }
      }
      throw new Error('Markdown export storage unavailable.');
    }
  }
}
