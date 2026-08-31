import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {
  LocalBulkIngestionCodexReviewFileStore,
  LocalBulkIngestionCodexReviewFileStoreError,
} from './local_bulk_ingestion_codex_review_file_store.js';

const PACKET_ID = '11111111-1111-4111-8111-111111111111';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0).reverse()) {
    rmSync(root, {recursive: true, force: true});
  }
});

describe('LocalBulkIngestionCodexReviewFileStore', () => {
  it('creates direct-child packet/result files and preserves an edited result', async () => {
    const {root, store} = createStore();
    const packet = new TextEncoder().encode('{"packet":1}');
    const template = new TextEncoder().encode('{"action":"replace_me"}');

    await expect(
      store.writePackage({
        packetId: PACKET_ID,
        packetBytes: packet,
        resultTemplateBytes: template,
      }),
    ).resolves.toMatchObject({outcome: 'created'});
    const resultPath = join(root, `${PACKET_ID}.codex-result.json`);
    writeFileSync(resultPath, '{"action":"accept"}', 'utf8');
    await expect(
      store.writePackage({
        packetId: PACKET_ID,
        packetBytes: packet,
        resultTemplateBytes: template,
      }),
    ).resolves.toMatchObject({outcome: 'existing'});

    await expect(readFile(resultPath, 'utf8')).resolves.toBe(
      '{"action":"accept"}',
    );
    await expect(store.readPacket(PACKET_ID)).resolves.toEqual(packet);
    await expect(store.readResult(PACKET_ID)).resolves.toEqual(
      new TextEncoder().encode('{"action":"accept"}'),
    );
  });

  it('rejects a different packet at the same deterministic identity', async () => {
    const {store} = createStore();
    await store.writePackage({
      packetId: PACKET_ID,
      packetBytes: new TextEncoder().encode('{"packet":1}'),
      resultTemplateBytes: new TextEncoder().encode('{}'),
    });

    await expect(
      store.writePackage({
        packetId: PACKET_ID,
        packetBytes: new TextEncoder().encode('{"packet":2}'),
        resultTemplateBytes: new TextEncoder().encode('{}'),
      }),
    ).rejects.toEqual(
      new LocalBulkIngestionCodexReviewFileStoreError('packet_conflict'),
    );
  });
});

function createStore(): Readonly<{
  root: string;
  store: LocalBulkIngestionCodexReviewFileStore;
}> {
  const parent = mkdtempSync(join(tmpdir(), 'struinfo-codex-review-'));
  roots.push(parent);
  const root = join(parent, 'codex-work');
  mkdirSync(root);
  return {
    root,
    store: new LocalBulkIngestionCodexReviewFileStore(root),
  };
}
