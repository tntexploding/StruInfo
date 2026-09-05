import {deepStrictEqual, ok, strictEqual} from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
  InformationEntryRetrievalService,
  type CurrentInformationEntry,
  type InformationEntrySearchIndexRefreshProgress,
} from '../apps/server/src/modules/entries/index.js';
import {
  createPostgresRepositories,
  type PostgresPoolBoundary,
} from '../apps/server/src/platform/database/postgresql/index.js';

/** Called only with the fresh, random-container runtime pool owned by M2-P0D. */
export async function verifyIncrementalIndexCandidate(
  pool: PostgresPoolBoundary,
  workspaceId: string,
) {
  const identity = await pool.query<{database_name: string; role_name: string}>(
    'SELECT current_database() AS database_name, current_user AS role_name',
  );
  strictEqual(identity.rows[0]?.database_name, 'struinfo_m2_p0d');
  strictEqual(identity.rows[0].role_name, 'struinfo_tm2_runtime');
  const repositories = createPostgresRepositories(pool);
  const entries = repositories.informationEntries;
  const index = repositories.informationEntrySearchIndex;
  const associations = repositories.informationEntryAssociations;
  const allFixtureEntries = await entries.loadCurrentEntries(workspaceId, true);
  ok(
    allFixtureEntries.length >= 8 &&
      allFixtureEntries.every((entry) =>
        entry.sourceKey.startsWith('synthetic:m2-p0d:'),
      ),
  );
  const loadByIds = entries.loadCurrentEntriesByIds?.bind(entries);
  ok(loadByIds !== undefined);
  const boundedLoad = loadByIds;
  const initial = allFixtureEntries.filter((entry) => !entry.value.isPrivate);
  const first = initial[0];
  const second = initial[1];
  const third = initial[2];
  ok(first !== undefined && second !== undefined && third !== undefined);
  const windowLimit = 7;
  let loadedEntries = 0;
  let embeddingInputs = 0;
  let afterDispatch: (() => Promise<void>) | undefined;
  let failNext = false;
  const makeService = (model = 'synthetic-index-2d') =>
    new InformationEntryRetrievalService({
      workspaceId,
      entries: {
        materializeEntries: entries.materializeEntries.bind(entries),
        reviseEntry: entries.reviseEntry.bind(entries),
        loadCurrentEntries: () =>
          Promise.reject(
            new Error(
              'Incremental refresh must not load the complete Entry corpus.',
            ),
          ),
        loadCurrentEntriesByIds: async (id, includePrivate, ids) => {
          strictEqual(includePrivate, false);
          ok(ids.length <= 32);
          const rows = await boundedLoad(id, false, ids);
          loadedEntries += rows.length;
          return rows;
        },
      },
      index,
      associations,
      embeddingProvider: {
        providerKey: 'synthetic-index',
        model,
        embed: async (inputs) => {
          embeddingInputs += inputs.length;
          const action = afterDispatch;
          afterDispatch = undefined;
          if (action !== undefined) await action();
          if (failNext) {
            failNext = false;
            throw new Error('Synthetic embedding failure.');
          }
          return inputs.map(() => [1, 0]);
        },
      },
    });
  const browse = entries.loadCurrentEntryBrowsePage?.bind(entries);
  ok(browse !== undefined);
  const queryReads = {full: 0, browse: 0, candidates: 0};
  const queryService = new InformationEntryRetrievalService({
    workspaceId,
    entries: {
      materializeEntries: entries.materializeEntries.bind(entries),
      reviseEntry: entries.reviseEntry.bind(entries),
      loadCurrentEntries: (id, includePrivate) => {
        queryReads.full += 1;
        return entries.loadCurrentEntries(id, includePrivate);
      },
      loadCurrentEntriesByIds: (id, includePrivate, ids) => {
        queryReads.candidates += 1;
        return boundedLoad(id, includePrivate, ids);
      },
      loadCurrentEntryBrowsePage: (id, scope, limit, after) => {
        queryReads.browse += 1;
        return browse(id, scope, limit, after);
      },
    },
    index,
    associations,
  });
  const realService = () =>
    new InformationEntryRetrievalService({
      workspaceId,
      entries,
      index,
      associations,
    });
  async function refresh(
    service: InformationEntryRetrievalService,
    limit = windowLimit,
  ) {
    const beforeLoaded = loadedEntries;
    const beforeInputs = embeddingInputs;
    const result = await service.refresh(limit);
    strictEqual(result.progress.loadedEntryCount, loadedEntries - beforeLoaded);
    strictEqual(
      result.progress.embeddingInputCount,
      embeddingInputs - beforeInputs,
    );
    ok(result.progress.loadedEntryCount <= limit);
    return result;
  }
  async function finish(model = 'synthetic-index-2d') {
    let windows = 0;
    let loaded = 0;
    let inputs = 0;
    let last: Readonly<InformationEntrySearchIndexRefreshProgress>;
    do {
      ok(windows <= initial.length + 8);
      const result = await refresh(makeService(model));
      last = result.progress;
      strictEqual(last.outcome === 'provider_failed', false);
      loaded += last.loadedEntryCount;
      inputs += last.embeddingInputCount;
      windows += 1;
    } while (last.outcome !== 'complete');
    return {windows, loadedEntryCount: loaded, embeddingInputCount: inputs};
  }
  async function current(
    entryId: string,
  ): Promise<Readonly<CurrentInformationEntry>> {
    const row = (await boundedLoad(workspaceId, true, [entryId]))[0];
    ok(row !== undefined);
    return row;
  }
  async function revise(
    entryId: string,
    patch: Partial<CurrentInformationEntry['value']>,
  ) {
    const entry = await current(entryId);
    strictEqual(
      await entries.reviseEntry({
        workspaceId,
        entryId,
        expectedRevision: entry.revision,
        revisionId: randomUUID(),
        value: {...entry.value, ...patch},
      }),
      'applied',
    );
    return current(entryId);
  }

  // A restored package has no derived index. The preceding identity/content guards
  // and the caller's newly created Docker pool restrict every mutation to fixtures.
  await index.replaceSearchIndex(workspaceId, {projections: [], postings: []});
  const restoration = await finish();
  strictEqual(restoration.loadedEntryCount, initial.length);
  strictEqual(restoration.embeddingInputCount, initial.length);
  const replay = (await refresh(makeService())).progress;
  strictEqual(replay.loadedEntryCount, 0);
  strictEqual(replay.embeddingInputCount, 0);
  await revise(first.entryId, {
    titlePath: 'Synthetic incremental input changed',
  });
  const query = {
    text: 'Synthetic incremental input changed',
    textMode: 'substring' as const,
    textFields: ['title'] as const,
    includePrivate: false,
    onlyPrivate: false,
    limit: 3,
  };
  const browseQuery = {includePrivate: false, onlyPrivate: false, limit: 3};
  const browseBefore = await queryService.search(browseQuery);
  deepStrictEqual(queryReads, {full: 0, browse: 1, candidates: 0});
  const searchBefore = await queryService.search(query);
  deepStrictEqual(queryReads, {full: 1, browse: 1, candidates: 0});
  deepStrictEqual(
    searchBefore.items.map((item) => item.entry.entryId),
    [first.entryId],
  );
  const singleChange = (await refresh(makeService())).progress;
  const searchAfter = await queryService.search(query);
  deepStrictEqual(searchAfter, searchBefore);
  deepStrictEqual(queryReads, {full: 1, browse: 1, candidates: 1});
  const browseAfter = await queryService.search(browseQuery);
  deepStrictEqual(browseAfter, browseBefore);
  deepStrictEqual(queryReads, {full: 1, browse: 2, candidates: 1});
  const queryIntegration = {
    equalLexicalResultsAndSource: true,
    equalBrowsePagesAndCursor: true,
    ...queryReads,
  };
  strictEqual(singleChange.loadedEntryCount, 1);
  strictEqual(singleChange.embeddingInputCount, 1);
  strictEqual(singleChange.updatedEntryCount, 1);
  await revise(first.entryId, {
    usefulnessScore: first.value.usefulnessScore === 5 ? 1 : 5,
  });
  const reusedRevision = (await refresh(makeService())).progress;
  strictEqual(reusedRevision.reusedEmbeddingCount, 1);
  strictEqual(reusedRevision.embeddingInputCount, 0);

  await revise(first.entryId, {titlePath: 'Synthetic retry one'});
  await revise(second.entryId, {titlePath: 'Synthetic retry two'});
  failNext = true;
  const failedWindow = await refresh(makeService(), 1);
  strictEqual(failedWindow.progress.outcome, 'provider_failed');
  strictEqual(failedWindow.progress.updatedEntryCount, 1);
  strictEqual(failedWindow.index.semanticSearchReady, false);
  const retry = await finish();
  strictEqual(retry.embeddingInputCount, 2);

  await revise(first.entryId, {titlePath: 'Synthetic pre-generation revision'});
  afterDispatch = async () => {
    await revise(first.entryId, {titlePath: 'Synthetic concurrent revision'});
  };
  const staleRevision = (await refresh(makeService())).progress;
  strictEqual(staleRevision.updatedEntryCount, 0);
  strictEqual(staleRevision.staleEntryCount, 1);
  const prior = (await index.loadSearchIndex(workspaceId)).projections.find(
    (projection) => projection.entryId === first.entryId,
  );
  ok(
    prior !== undefined &&
      prior.entryRevision !== (await current(first.entryId)).revision,
  );
  await finish();

  await revise(second.entryId, {
    titlePath: 'Synthetic public before privacy change',
  });
  afterDispatch = async () => {
    await revise(second.entryId, {isPrivate: true});
  };
  const privacyChange = (await refresh(makeService())).progress;
  strictEqual(privacyChange.updatedEntryCount, 0);
  strictEqual(privacyChange.staleEntryCount, 1);
  strictEqual(privacyChange.removedProjectionCount, 1);
  const afterPrivate = await index.loadSearchIndex(workspaceId);
  ok(
    !afterPrivate.projections.some(
      (projection) => projection.entryId === second.entryId,
    ),
  );
  ok(
    !afterPrivate.postings.some(
      (posting) => posting.entryId === second.entryId,
    ),
  );
  await finish();

  await pool.query(
    'UPDATE struinfo.information_entry SET is_current_structure = false WHERE workspace_id = $1 AND entry_id = $2',
    [workspaceId, third.entryId],
  );
  const retirement = (await refresh(makeService(), 1)).progress;
  strictEqual(retirement.removedProjectionCount, 1);
  strictEqual(retirement.loadedEntryCount, 0);
  strictEqual(retirement.embeddingInputCount, 0);
  const modelFirst = (await refresh(makeService('synthetic-next-model'), 1))
    .progress;
  strictEqual(modelFirst.embeddingInputCount, 1);
  const modelRest = await finish('synthetic-next-model');
  strictEqual(
    modelFirst.embeddingInputCount + modelRest.embeddingInputCount,
    initial.length - 2,
  );
  strictEqual(
    (await makeService('synthetic-next-model').status()).semanticSearchReady,
    true,
  );

  await pool.query(
    'DELETE FROM struinfo.information_entry_term_posting WHERE workspace_id = $1 AND entry_id = $2',
    [workspaceId, first.entryId],
  );
  const completeRepair = await realService().rebuild();
  strictEqual(completeRepair.currentProjectionCount, initial.length - 2);
  const repaired = await index.loadSearchIndex(workspaceId);
  ok(repaired.postings.some((posting) => posting.entryId === first.entryId));
  ok(
    !repaired.projections.some(
      (projection) =>
        projection.entryId === second.entryId ||
        projection.entryId === third.entryId,
    ),
  );
  const lexical = await realService().search({
    text: 'Synthetic concurrent revision',
    textMode: 'substring',
    includePrivate: false,
    onlyPrivate: false,
    limit: 10,
  });
  deepStrictEqual(
    lexical.items.map((item) => item.entry.entryId),
    [first.entryId],
  );
  const noProvider = await realService().refresh(7);
  strictEqual(noProvider.progress.outcome, 'complete');
  strictEqual(noProvider.progress.embeddingInputCount, 0);
  return Object.freeze({
    baselinePublicEntries: initial.length,
    windowLimit,
    restoration,
    replay,
    singleChange,
    reusedRevision,
    queryIntegration,
    failure: failedWindow.progress,
    retry,
    staleRevision,
    privacyChange,
    retirement,
    modelChange: {first: modelFirst, remaining: modelRest},
    fullRepair: {
      publicEntryCount: completeRepair.publicEntryCount,
      currentProjectionCount: completeRepair.currentProjectionCount,
      exactLexicalResultCount: lexical.totalCount,
    },
    totalHydratedEntries: loadedEntries,
    totalSyntheticEmbeddingInputs: embeddingInputs,
  });
}
