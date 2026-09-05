import {deepStrictEqual, ok} from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';

import {
  buildInformationEntryKnowledgeGraph,
  InformationEntryRetrievalService,
  type InformationEntrySearchRequest,
  type InformationEntrySearchResult,
  withInformationEntryEmbedding,
} from '../apps/server/src/modules/entries/index.js';
import {
  createPostgresRepositories,
  type PostgresPoolBoundary,
} from '../apps/server/src/platform/database/postgresql/index.js';

/** Called only inside the disposable synthetic M2-P0D workload, after its counts. */
export async function verifyCurrentReadCandidate(
  pool: PostgresPoolBoundary,
  workspaceId: string,
) {
  let returnedRows = 0;
  let peakRssBytes = 0;
  const sampleMemory = () => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  };
  const measuredPool: PostgresPoolBoundary = {
    async query<Row extends Readonly<Record<string, unknown>>>(
      sql: string,
      parameters?: readonly unknown[],
    ) {
      const result = await pool.query<Row>(sql, parameters);
      returnedRows += result.rows.length;
      sampleMemory();
      return result;
    },
    async connect() {
      const client = await pool.connect();
      return {
        async query<Row extends Readonly<Record<string, unknown>>>(
          sql: string,
          parameters?: readonly unknown[],
        ) {
          const result = await client.query<Row>(sql, parameters);
          returnedRows += result.rows.length;
          sampleMemory();
          return result;
        },
        executeSimple: client.executeSimple.bind(client),
        release: () => {
          client.release();
        },
      };
    },
    end: () => Promise.resolve(),
  };
  const repositories = createPostgresRepositories(measuredPool);
  const entries = repositories.informationEntries;
  const associations = repositories.informationEntryAssociations;
  const index = repositories.informationEntrySearchIndex;
  const legacyEntries = {
    loadCurrentEntries: entries.loadCurrentEntries.bind(entries),
    materializeEntries: entries.materializeEntries.bind(entries),
    reviseEntry: entries.reviseEntry.bind(entries),
  };
  const legacyIndex = {
    loadSearchIndex: index.loadSearchIndex.bind(index),
    replaceSearchIndex: index.replaceSearchIndex.bind(index),
  };
  const fast = new InformationEntryRetrievalService({
    workspaceId,
    entries,
    associations,
    index,
  });
  const legacy = new InformationEntryRetrievalService({
    workspaceId,
    entries: legacyEntries,
    associations,
    index: legacyIndex,
  });
  const request = {
    includePrivate: false,
    onlyPrivate: false,
    limit: 3,
  } as const;
  const initial = await entries.loadCurrentEntries(workspaceId, true);
  const first = initial[0];
  ok(first !== undefined && initial.length >= 8);
  const center = first;
  const loadNeighborhood =
    associations.loadAssociationSnapshotForEntries?.bind(associations);
  const loadEntries = entries.loadCurrentEntriesByIds?.bind(entries);
  ok(loadNeighborhood !== undefined && loadEntries !== undefined);
  const boundedAssociations = loadNeighborhood;
  const boundedEntries = loadEntries;
  let comparedPages = 0;
  let comparedGraphs = 0;
  let fallbackQueries = 0;

  async function comparePages(
    scope: Pick<
      InformationEntrySearchRequest,
      'includePrivate' | 'onlyPrivate'
    >,
  ) {
    let after: InformationEntrySearchResult['nextCursor'];
    const seen = new Set<string>();
    let scopePages = 0;
    do {
      const input = {
        ...request,
        ...scope,
        ...(after === undefined ? {} : {after}),
      };
      const expected = await legacy.search(input);
      const actual = await fast.search(input);
      deepStrictEqual(actual, expected);
      for (const item of actual.items) {
        ok(!seen.has(item.entry.entryId));
        seen.add(item.entry.entryId);
      }
      comparedPages += 1;
      scopePages += 1;
      after = actual.nextCursor;
      if (after === undefined) deepStrictEqual(seen.size, actual.totalCount);
    } while (after !== undefined && scopePages < 16);
  }
  async function graphRead(
    optimized: boolean,
    entryId: string,
    includePrivate: boolean,
    onlyPrivate = false,
  ) {
    const snapshot = optimized
      ? await boundedAssociations(workspaceId, includePrivate, [entryId])
      : await associations.loadAssociationSnapshot(workspaceId, includePrivate);
    const ids = [
      ...new Set([
        entryId,
        ...snapshot.projections.flatMap((item) => [
          item.entryLowId,
          item.entryHighId,
        ]),
        ...snapshot.overrides.flatMap((item) => [
          item.entryLowId,
          item.entryHighId,
        ]),
      ]),
    ];
    const current = optimized
      ? await boundedEntries(workspaceId, includePrivate, ids)
      : await entries.loadCurrentEntries(workspaceId, includePrivate);
    return buildInformationEntryKnowledgeGraph(
      entryId,
      onlyPrivate ? current.filter((item) => item.value.isPrivate) : current,
      snapshot,
    );
  }
  async function compareScopes() {
    for (const scope of [
      {includePrivate: false, onlyPrivate: false},
      {includePrivate: true, onlyPrivate: false},
      {includePrivate: true, onlyPrivate: true},
    ]) {
      await comparePages(scope);
      for (const entry of initial.slice(0, 8)) {
        deepStrictEqual(
          await graphRead(
            true,
            entry.entryId,
            scope.includePrivate,
            scope.onlyPrivate,
          ),
          await graphRead(
            false,
            entry.entryId,
            scope.includePrivate,
            scope.onlyPrivate,
          ),
        );
        comparedGraphs += 1;
      }
      for (const extra of [
        {text: 'TypeScript', textMode: 'substring' as const},
        {text: 'TypeScrip', textMode: 'fuzzy' as const},
        {sourceKey: center.sourceKey},
        {snapshotId: center.snapshotId},
        {contentKeyword: 'typescript'},
        {typeKeyword: 'knowledge_explanation' as const},
        {domainKeyword: 'engineering_computing' as const},
        {chunkMode: 'split' as const},
        {time: {field: 'captured' as const, from: '2039-01-01T00:00:00.000Z'}},
        {
          association: {
            entryId: center.entryId,
            maximumDepth: 2 as const,
            minimumScore: 0,
          },
        },
      ]) {
        const input = {...request, ...scope, ...extra};
        deepStrictEqual(await fast.search(input), await legacy.search(input));
        fallbackQueries += 1;
      }
    }
    deepStrictEqual(await fast.status(), await legacy.status());
  }
  await compareScopes();
  const firstPage = await fast.search(request);
  ok(firstPage.nextCursor !== undefined);
  for (const service of [fast, legacy]) {
    let rejected = false;
    try {
      await service.search({
        ...request,
        includePrivate: true,
        after: firstPage.nextCursor,
      });
    } catch (error) {
      rejected =
        error instanceof Error &&
        error.name === 'InformationEntrySearchCursorError';
    }
    ok(rejected, 'A cursor must not cross privacy scopes.');
  }

  async function measure(read: () => Promise<unknown>) {
    await read();
    const samples = [];
    for (let iteration = 0; iteration < 5; iteration += 1) {
      returnedRows = 0;
      peakRssBytes = process.memoryUsage().rss;
      const started = performance.now();
      const timer = setInterval(sampleMemory, 1);
      try {
        await read();
      } finally {
        clearInterval(timer);
      }
      sampleMemory();
      samples.push({
        milliseconds: Number((performance.now() - started).toFixed(3)),
        returnedRows,
        peakRssBytes,
      });
    }
    return samples;
  }
  const measurements = {
    browse: {
      legacy: await measure(() => legacy.search(request)),
      optimized: await measure(() => fast.search(request)),
    },
    status: {
      legacy: await measure(() => legacy.status()),
      optimized: await measure(() => fast.status()),
    },
    graph: {
      legacy: await measure(() => graphRead(false, center.entryId, false)),
      optimized: await measure(() => graphRead(true, center.entryId, false)),
    },
  };

  // Disturb only synthetic current state; original Snapshot/Fragment bytes stay intact.
  const snapshot = await index.loadSearchIndex(workspaceId);
  await index.replaceSearchIndex(workspaceId, {
    ...snapshot,
    projections: snapshot.projections.map((projection) =>
      withInformationEntryEmbedding(
        projection,
        'synthetic',
        'synthetic-2d',
        [1, 0],
      ),
    ),
  });
  for (const [ordinal, item] of initial.slice(0, 4).entries()) {
    deepStrictEqual(
      await entries.reviseEntry({
        workspaceId,
        entryId: item.entryId,
        expectedRevision: item.revision,
        revisionId: randomUUID(),
        value: {
          ...item.value,
          ...(ordinal < 2
            ? {isPrivate: true}
            : {titlePath: item.value.titlePath + ' synthetic revised'}),
        },
      }),
      'applied',
    );
  }
  const retired = initial[7];
  ok(retired !== undefined);
  await pool.query(
    'UPDATE struinfo.information_entry SET is_current_structure = false WHERE workspace_id = $1 AND entry_id = $2',
    [workspaceId, retired.entryId],
  );
  for (const [ordinal, related] of initial.slice(1, 7).entries()) {
    const [entryLowId, entryHighId] = [center.entryId, related.entryId].sort();
    ok(entryLowId !== undefined && entryHighId !== undefined);
    deepStrictEqual(
      await associations.writeAssociationOverride({
        workspaceId,
        entryLowId,
        entryHighId,
        expectedRevision: 0,
        revisionId: randomUUID(),
        includePrivate: true,
        value: {
          action: ordinal === 2 ? 'block' : 'enhance',
          manualAdjustment: 0,
          isBlocked: ordinal === 2,
          graph: {
            origin: ordinal === 1 ? 'ai' : 'user',
            label: 'synthetic relation',
            direction: 'low_to_high',
            semanticKind: 'related',
            verificationStatus: 'unreviewed',
            note: 'synthetic only',
          },
        },
      }),
      'applied',
    );
  }
  await compareScopes();
  for (const model of ['synthetic-2d', 'synthetic-mismatch']) {
    const embeddingProvider = {
      providerKey: 'synthetic',
      model,
      embed: () => Promise.reject(new Error('Provider calls forbidden')),
    };
    deepStrictEqual(
      await new InformationEntryRetrievalService({
        workspaceId,
        entries,
        associations,
        index,
        embeddingProvider,
      }).status(),
      await new InformationEntryRetrievalService({
        workspaceId,
        entries: legacyEntries,
        associations,
        index: legacyIndex,
        embeddingProvider,
      }).status(),
    );
  }
  const changedGraph = await graphRead(true, center.entryId, true);
  ok(changedGraph?.hiddenEdges.length === 1);
  ok(changedGraph.edges.some((edge) => edge.origin === 'ai_assisted'));
  ok(changedGraph.edges.some((edge) => edge.origin === 'user_created'));
  ok(!changedGraph.nodes.some((node) => node.entryId === retired.entryId));
  return {
    comparedPages,
    comparedGraphs,
    fallbackQueries,
    measurements,
    states: [
      'public',
      'include_private',
      'private_only',
      'stale_revision',
      'retired_structure',
      'blocked',
      'user',
      'ai',
      'embedding_model_mismatch',
    ],
    limitation:
      'Five warm sequential reads per path on the same synthetic workload. Rows are returned SQL rows, not scanned rows; RSS is sampled for the shared Node process, not isolated per-request allocation or PostgreSQL memory. No production SLO claim.',
  };
}
