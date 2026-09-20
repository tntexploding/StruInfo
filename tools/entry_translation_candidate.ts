import {deepStrictEqual, ok, strictEqual, rejects} from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {InformationEntryRetrievalService} from '../apps/server/src/modules/entries/information_entry_retrieval.js';
import {EntryTranslationService} from '../apps/server/src/modules/entries/information_entry_translation.js';
import {
  createPostgresRepositories,
  type PostgresPoolBoundary,
} from '../apps/server/src/platform/database/postgresql/index.js';

/** Exercises only the disposable, synthetic lifecycle database owned by the harness. */
export async function verifyEntryTranslationCandidate(
  pool: PostgresPoolBoundary,
  workspaceId: string,
) {
  const identity = await pool.query<{database_name: string; role_name: string}>(
    'SELECT current_database() AS database_name, current_user AS role_name',
  );
  strictEqual(identity.rows[0]?.database_name, 'struinfo_m2_p0d');
  strictEqual(identity.rows[0].role_name, 'struinfo_tm2_runtime');
  const repositories = createPostgresRepositories(pool);
  const entries = await repositories.informationEntries.loadCurrentEntries(
    workspaceId,
    false,
  );
  ok(
    entries.length > 1 &&
      entries.every((entry) => entry.sourceKey.startsWith('synthetic:m2-p0d:')),
  );
  const source = entries[0];
  ok(source !== undefined);
  const retrieval = (selectedWorkspace: string) =>
    new InformationEntryRetrievalService({
      workspaceId: selectedWorkspace,
      entries: repositories.informationEntries,
      associations: repositories.informationEntryAssociations,
      index: repositories.informationEntrySearchIndex,
      translations: repositories.entryTranslations,
    });
  const search = (selectedWorkspace = workspaceId, includePrivate = false) =>
    retrieval(selectedWorkspace).search({
      text: '合成译文',
      textFields: ['title'],
      includePrivate,
      onlyPrivate: false,
      limit: 10,
    });
  strictEqual((await search()).totalCount, 0);
  deepStrictEqual(
    await repositories.entryTranslations.loadCurrentTranslations(randomUUID()),
    [],
  );
  let calls = 0;
  const service = new EntryTranslationService({
    workspaceId,
    repository: repositories.entryTranslations,
    loadPublicEntry: async (id) =>
      (
        await repositories.informationEntries.loadCurrentEntriesByIds?.(
          workspaceId,
          false,
          [id],
        )
      )?.[0],
    provider: {
      providerKey: 'openai-responses-v1',
      model: 'synthetic-model',
      promptVersion: 'synthetic-v1',
      translate: () => {
        calls += 1;
        return Promise.resolve({
          title: '合成译文',
          body: '合成段落。\n\n12 `code` 😀',
        });
      },
    },
  });
  strictEqual(await service.read(source.entryId, source.revision), undefined);
  const [translated, repeated] = await Promise.all([
    service.generate(source.entryId, source.revision),
    service.generate(source.entryId, source.revision),
  ]);
  deepStrictEqual(translated, repeated);
  strictEqual(calls, 1);
  deepStrictEqual(
    await repositories.entryTranslations.loadCurrentTranslations(workspaceId),
    [translated],
  );
  const found = await search();
  strictEqual(found.totalCount, 1);
  strictEqual(found.items[0]?.entry.entryId, source.entryId);
  deepStrictEqual(found.items[0].matchReasons, ['translation_title']);
  strictEqual(calls, 1);
  deepStrictEqual(
    (
      await repositories.informationEntries.loadCurrentEntriesByIds?.(
        workspaceId,
        false,
        [source.entryId],
      )
    )?.[0],
    source,
  );
  const regenerated = await service.generate(
    source.entryId,
    source.revision,
    translated.translatedAt,
  );
  strictEqual(calls, 2);
  ok(regenerated.translatedAt !== translated.translatedAt);
  deepStrictEqual(
    await service.read(source.entryId, source.revision),
    regenerated,
  );
  await rejects(
    service.generate(source.entryId, source.revision, translated.translatedAt),
    {code: 'translation_source_stale'},
  );
  strictEqual(calls, 2);
  strictEqual(
    await repositories.entryTranslations.replaceIfCurrent?.(
      workspaceId,
      translated,
      translated.translatedAt,
    ),
    false,
  );
  const nextId = randomUUID();
  await pool.query(
    'UPDATE struinfo.information_entry SET current_revision = current_revision + 1, current_revision_id = $3 WHERE workspace_id = $1 AND entry_id = $2',
    [workspaceId, source.entryId, nextId],
  );
  strictEqual(
    await service.read(source.entryId, source.revision + 1),
    undefined,
  );
  strictEqual(
    await repositories.entryTranslations.saveIfCurrent(workspaceId, translated),
    false,
  );
  strictEqual((await search()).totalCount, 0);
  const updated = await service.generate(source.entryId, source.revision + 1);
  strictEqual(updated.sourceRevisionId, nextId);
  strictEqual(calls, 3);
  strictEqual((await search()).totalCount, 1);
  await pool.query(
    'UPDATE struinfo.information_entry SET is_private = true WHERE workspace_id = $1 AND entry_id = $2',
    [workspaceId, source.entryId],
  );
  strictEqual(
    await repositories.entryTranslations.load(
      workspaceId,
      source.entryId,
      source.revision + 1,
    ),
    undefined,
  );
  strictEqual(
    await repositories.entryTranslations.saveIfCurrent(workspaceId, updated),
    false,
  );
  deepStrictEqual(
    await repositories.entryTranslations.loadCurrentTranslations(workspaceId),
    [],
  );
  strictEqual(
    await repositories.entryTranslations.replaceIfCurrent?.(
      workspaceId,
      updated,
      updated.translatedAt,
    ),
    false,
  );
  strictEqual((await search(workspaceId, true)).totalCount, 0);
  await rejects(service.generate(source.entryId, source.revision + 1), {
    code: 'translation_entry_unavailable',
  });
  await pool.query(
    'UPDATE struinfo.information_entry SET is_private = false, is_current_structure = false WHERE workspace_id = $1 AND entry_id = $2',
    [workspaceId, source.entryId],
  );
  strictEqual(
    await repositories.entryTranslations.load(
      workspaceId,
      source.entryId,
      source.revision + 1,
    ),
    undefined,
  );
  strictEqual(
    await repositories.entryTranslations.saveIfCurrent(workspaceId, updated),
    false,
  );
  deepStrictEqual(
    await repositories.entryTranslations.loadCurrentTranslations(workspaceId),
    [],
  );
  strictEqual((await search()).totalCount, 0);
  await pool.query(
    'UPDATE struinfo.information_entry SET is_current_structure = true WHERE workspace_id = $1 AND entry_id = $2',
    [workspaceId, source.entryId],
  );
  const suppliedSource = entries[1];
  ok(suppliedSource !== undefined);
  const offlineService = new EntryTranslationService({
    workspaceId,
    repository: repositories.entryTranslations,
    loadPublicEntry: async (id) =>
      (
        await repositories.informationEntries.loadCurrentEntriesByIds?.(
          workspaceId,
          false,
          [id],
        )
      )?.[0],
  });
  strictEqual(offlineService.enabled, false);
  const suppliedText = {
    title: '合成外部译文',
    body: '外部提供的合成内容。12 `code` 😀',
  };
  const supplied = await offlineService.importProvided(
    suppliedSource.entryId,
    suppliedSource.revision,
    suppliedSource.revisionId,
    suppliedText,
  );
  strictEqual(supplied.providerKey, 'provided-translation-v1');
  strictEqual(supplied.model, '');
  strictEqual(supplied.promptVersion, '');
  deepStrictEqual(
    await offlineService.importProvided(
      suppliedSource.entryId,
      suppliedSource.revision,
      suppliedSource.revisionId,
      suppliedText,
    ),
    supplied,
  );
  await rejects(
    offlineService.importProvided(
      suppliedSource.entryId,
      suppliedSource.revision,
      suppliedSource.revisionId,
      {...suppliedText, body: '另一份合成内容'},
    ),
    {code: 'translation_already_exists'},
  );
  deepStrictEqual(
    (
      await repositories.informationEntries.loadCurrentEntriesByIds?.(
        workspaceId,
        false,
        [suppliedSource.entryId],
      )
    )?.[0],
    suppliedSource,
  );
  const snapshot =
    await repositories.workspaceTransfer.exportWorkspace(workspaceId);
  strictEqual(
    snapshot.entries.tables.find(
      (table) => table.name === 'information_entry_translation',
    )?.rows.length,
    2,
  );
  // A second empty synthetic workspace exercises actual FK ordering and translation columns.
  const restoredWorkspace = randomUUID();
  const restored = {...snapshot};
  for (const section of [
    'domain',
    'entries',
    'associations',
    'processing',
  ] as const) {
    const tables = snapshot[section].tables.map((table) => ({
      ...table,
      rows: table.rows.map((row) => ({
        ...row,
        workspace_id: restoredWorkspace,
      })),
    }));
    Object.assign(restored, {[section]: {...snapshot[section], tables}});
  }
  await repositories.workspaceTransfer.restoreEmptyWorkspace(
    restoredWorkspace,
    restored,
  );
  deepStrictEqual(
    await repositories.entryTranslations.load(
      restoredWorkspace,
      source.entryId,
      source.revision + 1,
    ),
    updated,
  );
  deepStrictEqual(
    await repositories.entryTranslations.load(
      restoredWorkspace,
      suppliedSource.entryId,
      suppliedSource.revision,
    ),
    supplied,
  );
  const suppliedSearch = await retrieval(restoredWorkspace).search({
    text: '合成外部译文',
    textFields: ['title'],
    includePrivate: false,
    onlyPrivate: false,
    limit: 10,
  });
  strictEqual(suppliedSearch.totalCount, 1);
  strictEqual(suppliedSearch.items[0]?.entry.entryId, suppliedSource.entryId);
  const restoredSearch = await search(restoredWorkspace);
  strictEqual(restoredSearch.totalCount, 1);
  strictEqual(restoredSearch.items[0]?.entry.workspaceId, restoredWorkspace);
  strictEqual(restoredSearch.items[0].entry.entryId, source.entryId);
  strictEqual(calls, 3);
  return Object.freeze({
    providedTranslationImportedAndRestored: true,
    currentCacheOverwriteRejected: true,
    providerCalls: calls,
    translationSearchWithoutRebuild: true,
    restoredTranslationSearch: true,
    sourcePreserved: true,
    staleWriteRejected: true,
    privateReadRejected: true,
    retiredReadRejected: true,
    translationRestored: true,
  });
}
