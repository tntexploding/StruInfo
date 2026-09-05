import {deepStrictEqual, ok, strictEqual} from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {JsonValue} from '../apps/server/src/serialization/canonical_json.js';
import {
  buildInformationEntryAssociationProjection,
  listInformationEntrySourceReviewItems,
  paginateInformationEntrySourceReviews,
  type CurrentInformationEntry,
  type InformationEntryAssociationOverrideWrite,
  type InformationEntryGraphRelationValue,
  type InformationEntrySourceReviewRequest,
} from '../apps/server/src/modules/entries/index.js';
import {
  createPostgresRepositories,
  PostgresInformationEntryAssociationRepository,
  type PostgresPoolBoundary,
} from '../apps/server/src/platform/database/postgresql/index.js';
import {READ_CURRENT_INFORMATION_ENTRIES_BY_ID_SQL} from '../apps/server/src/platform/database/postgresql/postgres_information_entry_repository.js';
import {
  ACQUIRE_WORKSPACE_WRITE_LOCK_SQL,
  deriveWorkspaceWriteLockKey,
} from '../apps/server/src/platform/database/postgresql/workspace_write_lock.js';
import {M1D_ASSOCIATION_BUNDLE_CODEC} from '../apps/server/src/workspace_transfer/m1d_association_bundle.js';

/** Executes only against the synthetic disposable database owned by M2-P0D. */
export async function verifySourceReviewCandidate(
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
  const associations = repositories.informationEntryAssociations;
  const initial = await entries.loadCurrentEntries(workspaceId, true);
  ok(
    initial.length >= 8 &&
      initial.every((entry) => entry.sourceKey.startsWith('synthetic:m2-p0d:')),
  );
  const publicEntries = initial
    .filter((entry) => !entry.value.isPrivate)
    .sort((a, b) => a.entryId.localeCompare(b.entryId));
  const [low, high, third, fourth] = publicEntries;
  ok(
    low !== undefined &&
      high !== undefined &&
      third !== undefined &&
      fourth !== undefined,
  );
  const pair = {entryLowId: low.entryId, entryHighId: high.entryId};
  const current = async (entryId: string) => {
    const row = (
      await entries.loadCurrentEntriesByIds?.(workspaceId, true, [entryId])
    )?.[0];
    ok(row !== undefined);
    return row;
  };
  const override = async () =>
    (
      await associations.loadAssociationSnapshot(workspaceId, true)
    ).overrides.find(
      (row) =>
        row.entryLowId === low.entryId && row.entryHighId === high.entryId,
    );
  const graph: InformationEntryGraphRelationValue = {
    origin: 'ai',
    label: 'Synthetic source relationship',
    direction: 'high_to_low',
    semanticKind: 'contradicts',
    verificationStatus: 'source_checked',
    note: 'Synthetic review note',
  };
  async function writeGraph(
    value: InformationEntryGraphRelationValue,
    extra: Partial<InformationEntryAssociationOverrideWrite> = {},
  ) {
    const prior = await override();
    const write: InformationEntryAssociationOverrideWrite = {
      workspaceId,
      ...pair,
      expectedRevision: prior?.revision ?? 0,
      revisionId: randomUUID(),
      includePrivate: false,
      value: {
        action: 'weaken',
        manualAdjustment: -1500,
        isBlocked: false,
        graph: value,
      },
      ...extra,
    };
    return associations.writeAssociationOverride(write);
  }
  strictEqual(await writeGraph(graph), 'applied');
  let maximumHydratedEntries = 0;
  const measured = new PostgresInformationEntryAssociationRepository({
    query: pool.query.bind(pool),
    end: () => Promise.resolve(),
    async connect() {
      const client = await pool.connect();
      return {
        executeSimple: client.executeSimple.bind(client),
        release: client.release.bind(client),
        async query<Row extends Readonly<Record<string, unknown>>>(
          sql: string,
          parameters?: readonly unknown[],
        ) {
          const result = await client.query<Row>(sql, parameters);
          if (sql === READ_CURRENT_INFORMATION_ENTRIES_BY_ID_SQL) {
            maximumHydratedEntries = Math.max(
              maximumHydratedEntries,
              result.rows.length,
            );
            ok(
              result.rows.length <= 8,
              'Only the page plus one pair may hydrate Entry bodies.',
            );
          }
          return result;
        },
      };
    },
  });
  let comparedPages = 0;
  let cappedScopes = 0;
  const maximumPagesPerScope = initial.length > 64 ? 16 : 256;
  async function compareScopes() {
    const all = await entries.loadCurrentEntries(workspaceId, true);
    const snapshot = await associations.loadAssociationSnapshot(
      workspaceId,
      true,
    );
    for (const privacyScope of [
      'public',
      'include_private',
      'private_only',
    ] as const) {
      for (const filter of [
        'pending',
        'all',
        'unreviewed',
        'needs_review',
        'source_checked',
      ] as const) {
        let request: InformationEntrySourceReviewRequest = {
          privacyScope,
          filter,
          limit: 3,
        };
        const expected = listInformationEntrySourceReviewItems(
          workspaceId,
          all,
          snapshot,
          request,
        );
        let traversed = 0;
        let scopePages = 0;
        let hasNext: boolean;
        do {
          const actual = await measured.loadSourceReviewPage(
            workspaceId,
            request,
          );
          deepStrictEqual(
            actual,
            paginateInformationEntrySourceReviews(expected, request),
          );
          comparedPages += 1;
          scopePages += 1;
          traversed += actual.items.length;
          hasNext = actual.nextCursor !== undefined;
          if (actual.nextCursor !== undefined)
            request = {...request, after: actual.nextCursor};
        } while (hasNext && scopePages < maximumPagesPerScope);
        if (hasNext) cappedScopes += 1;
        else strictEqual(traversed, expected.length);
      }
    }
  }
  const find = async () => {
    const page = await measured.loadSourceReviewPage(workspaceId, {
      privacyScope: 'public',
      filter: 'needs_review',
      limit: 3,
    });
    return page.items.find(
      (row) =>
        row.edge.entryLowId === low.entryId &&
        row.edge.entryHighId === high.entryId,
    );
  };
  ok((await find())?.review.reason === 'unbound');
  const reviewedRevisions = {
    entryLowRevision: low.revision,
    entryHighRevision: high.revision,
  };
  strictEqual(
    await writeGraph(
      {...graph, reviewedRevisions},
      {
        expectedEntryRevisions: reviewedRevisions,
        requireVisibleGraphEdge: true,
      },
    ),
    'applied',
  );
  const accepted = await override();
  ok(accepted !== undefined);
  const savedEntries = [
    await current(low.entryId),
    await current(high.entryId),
  ];
  deepStrictEqual(
    savedEntries,
    [low, high],
    'Source review must not change Entries.',
  );
  await compareScopes();
  // Revision races are tested with an actual held workspace lock. No sleeps or timing assumptions.
  const blocker = await pool.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query(ACQUIRE_WORKSPACE_WRITE_LOCK_SQL, [
      deriveWorkspaceWriteLockKey(workspaceId),
    ]);
    pending = associations.writeAssociationOverride({
      workspaceId,
      ...pair,
      expectedRevision: accepted.revision,
      revisionId: randomUUID(),
      includePrivate: false,
      expectedEntryRevisions: reviewedRevisions,
      requireVisibleGraphEdge: true,
      value: {
        ...accepted.value,
        graph: {...graph, reviewedRevisions, note: 'Synthetic late review'},
      },
    });
    await blocker.query(
      'UPDATE struinfo.information_entry SET current_revision = current_revision + 1, current_revision_id = $3 WHERE workspace_id = $1 AND entry_id = $2',
      [workspaceId, low.entryId, randomUUID()],
    );
    await blocker.query('COMMIT');
    strictEqual(await pending, 'stale');
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  deepStrictEqual(await override(), accepted);
  ok((await find())?.review.reason === 'entry_changed');
  const revised = await current(low.entryId);
  const rebound = {
    entryLowRevision: revised.revision,
    entryHighRevision: high.revision,
  };
  strictEqual(
    await writeGraph(
      {...graph, reviewedRevisions: rebound},
      {expectedEntryRevisions: rebound, requireVisibleGraphEdge: true},
    ),
    'applied',
  );
  strictEqual(
    await writeGraph(
      {...graph, reviewedRevisions: rebound},
      {expectedEntryRevisions: rebound, expectedRevision: accepted.revision},
    ),
    'stale',
  );
  const beforeRebuild = await override();
  await associations.replaceAssociationProjections(
    workspaceId,
    buildInformationEntryAssociationProjection(
      await entries.loadCurrentEntries(workspaceId, true),
    ),
    true,
  );
  deepStrictEqual(await override(), beforeRebuild);
  const beforeBlock = await override();
  ok(beforeBlock !== undefined);
  strictEqual(
    await associations.writeAssociationOverride({
      workspaceId,
      ...pair,
      expectedRevision: beforeBlock.revision,
      revisionId: randomUUID(),
      includePrivate: false,
      value: {
        ...beforeBlock.value,
        action: 'block',
        manualAdjustment: 0,
        isBlocked: true,
      },
    }),
    'applied',
  );
  strictEqual(
    await writeGraph(
      {...graph, reviewedRevisions: rebound},
      {expectedEntryRevisions: rebound, requireVisibleGraphEdge: true},
    ),
    'not_found',
  );
  const blocked = await override();
  ok(blocked !== undefined);
  strictEqual(blocked.value.isBlocked, true);
  await compareScopes();
  strictEqual(
    await associations.writeAssociationOverride({
      workspaceId,
      ...pair,
      expectedRevision: blocked.revision,
      revisionId: randomUUID(),
      includePrivate: false,
      value: {...blocked.value, action: 'restore', isBlocked: false},
    }),
    'applied',
  );

  async function revise(
    entry: CurrentInformationEntry,
    patch: Partial<CurrentInformationEntry['value']>,
  ) {
    strictEqual(
      await entries.reviseEntry({
        workspaceId,
        entryId: entry.entryId,
        expectedRevision: entry.revision,
        revisionId: randomUUID(),
        value: {...entry.value, ...patch},
      }),
      'applied',
    );
  }
  await revise(await current(high.entryId), {isPrivate: true});
  await revise(await current(third.entryId), {isPrivate: true});
  await associations.writeAssociationOverride({
    workspaceId,
    entryLowId: high.entryId,
    entryHighId: third.entryId,
    expectedRevision: 0,
    revisionId: randomUUID(),
    includePrivate: true,
    value: {
      action: 'restore',
      manualAdjustment: 0,
      isBlocked: false,
      graph: {...graph, verificationStatus: 'needs_review'},
    },
  });
  strictEqual(
    await writeGraph(graph, {requireVisibleGraphEdge: true}),
    'not_found',
  );
  await pool.query(
    'UPDATE struinfo.information_entry SET is_current_structure = false WHERE workspace_id = $1 AND entry_id = $2',
    [workspaceId, fourth.entryId],
  );
  await compareScopes();
  const exported =
    await repositories.workspaceTransfer.exportWorkspace(workspaceId);
  const encoded = M1D_ASSOCIATION_BUNDLE_CODEC.encode(exported.associations);
  deepStrictEqual(
    M1D_ASSOCIATION_BUNDLE_CODEC.decode(
      JSON.parse(JSON.stringify(encoded)) as JsonValue,
    ),
    exported.associations,
  );
  const exportedReview = exported.associations.tables
    .find((table) => table.name === 'information_entry_association_override')
    ?.rows.find(
      (row) =>
        row.entry_low_id === low.entryId && row.entry_high_id === high.entryId,
    );
  strictEqual(
    exportedReview?.graph_reviewed_entry_low_revision,
    rebound.entryLowRevision,
  );
  strictEqual(
    exportedReview.graph_reviewed_entry_high_revision,
    rebound.entryHighRevision,
  );

  // Restructure one synthetic source while retaining the other current groups.
  // A new pair must retain the note, but cannot inherit a check of different Entry identities.
  const beforeStructure = await entries.loadCurrentEntries(workspaceId, true);
  const source = beforeStructure.find((row) => row.entryId === low.entryId);
  const target = beforeStructure.find((row) => row.entryId === high.entryId);
  ok(source !== undefined && target !== undefined);
  const freshRevisions = {
    entryLowRevision: source.revision,
    entryHighRevision: target.revision,
  };
  strictEqual(
    await writeGraph(
      {...graph, reviewedRevisions: freshRevisions},
      {
        includePrivate: true,
        expectedEntryRevisions: freshRevisions,
        requireVisibleGraphEdge: true,
      },
    ),
    'applied',
  );
  const reviewed = await override();
  ok(reviewed !== undefined);
  const currentOverrides = (
    await associations.loadAssociationSnapshot(workspaceId, true)
  ).overrides;
  const sourceEntries = beforeStructure
    .filter((row) => row.snapshotId === source.snapshotId)
    .sort((a, b) => a.entryId.localeCompare(b.entryId));
  const sourceIds = new Set(sourceEntries.map((row) => row.entryId));
  const successorId = randomUUID();
  const [destinationLow, destinationHigh] = [
    successorId,
    target.entryId,
  ].sort();
  ok(destinationLow !== undefined && destinationHigh !== undefined);
  strictEqual(
    await repositories.informationEntryRestructures.applyEntryRestructure({
      workspaceId,
      snapshotId: source.snapshotId,
      includePrivate: true,
      expectedEntries: sourceEntries.map((row) => ({
        entryId: row.entryId,
        revision: row.revision,
        revisionId: row.revisionId,
      })),
      expectedOverrides: currentOverrides.filter(
        (row) =>
          sourceIds.has(row.entryLowId) || sourceIds.has(row.entryHighId),
      ),
      successors: sourceEntries.map((row) => ({
        operation: row.entryId === source.entryId ? 'insert' : 'unchanged',
        expectedRevision: row.revision,
        row: {
          workspaceId,
          resourceId: row.resourceId,
          snapshotId: row.snapshotId,
          entryId: row.entryId === source.entryId ? successorId : row.entryId,
          revisionId:
            row.entryId === source.entryId ? randomUUID() : row.revisionId,
          value: row.value,
        },
        predecessorEntryIds: [row.entryId],
        annotationStatus: 'preserved',
      })),
      retiredEntryIds: [source.entryId],
      lineage: [
        {
          successorEntryId: successorId,
          predecessorEntryId: source.entryId,
          kind: 'boundary_from',
        },
      ],
      overrideTransfers: [
        {
          sourceEntryLowId: source.entryId,
          sourceEntryHighId: target.entryId,
          destinationEntryLowId: destinationLow,
          destinationEntryHighId: destinationHigh,
          revisionId: randomUUID(),
          value: {
            ...reviewed.value,
            graph: {
              ...graph,
              reviewedRevisions: freshRevisions,
              direction:
                successorId < target.entryId ? 'high_to_low' : 'low_to_high',
            },
          },
        },
      ],
      projections: [],
    }),
    'applied',
  );
  const replacement = (
    await associations.loadAssociationSnapshot(workspaceId, true)
  ).overrides.find(
    (row) =>
      row.entryLowId === destinationLow && row.entryHighId === destinationHigh,
  );
  strictEqual(replacement?.value.graph?.verificationStatus, 'source_checked');
  strictEqual(replacement.value.graph.note, graph.note);
  strictEqual(replacement.value.graph.reviewedRevisions, undefined);
  const replacementRows = listInformationEntrySourceReviewItems(
    workspaceId,
    await entries.loadCurrentEntries(workspaceId, true),
    await associations.loadAssociationSnapshot(workspaceId, true),
    {privacyScope: 'include_private', filter: 'needs_review', limit: 3},
  );
  strictEqual(
    replacementRows.find(
      (row) =>
        row.edge.entryLowId === destinationLow &&
        row.edge.entryHighId === destinationHigh,
    )?.review.reason,
    'unbound',
  );

  return {
    restructuredPairRequiresFreshReview: true,
    comparedPages,
    cappedScopes,
    maximumPagesPerScope,
    maximumHydratedEntries,
    pageLimit: 3,
    unboundHistoryRechecked: true,
    concurrentEntryChangeRejected: true,
    overrideConflictRejected: true,
    blockedNotRestored: true,
    rebuildPreservedReview: true,
    privateAndRetiredFiltered: true,
    bundleSchema: exported.associations.schemaVersion,
    exactReviewedRevisionsExported: true,
  };
}
