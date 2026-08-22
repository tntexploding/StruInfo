import {createHash} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {
  createNodePostgresPool,
  createPostgresKnowledgeRepositories,
  decodePostgresConnectionUrl,
  type PostgresPoolBoundary,
} from '../apps/server/src/platform/database/postgresql/index.js';
import {createLocalStorageServices} from '../apps/server/src/platform/storage/local_storage_services.js';
import {M1cApiService} from '../apps/server/src/transport/m1c_api_service.js';
import {M1cWorkspaceTransfer} from '../apps/server/src/workspace_transfer/m1c_workspace_transfer.js';

const DATABASE_VARIABLE = 'STRUIINFO_M1C_PRIVATE_DATABASE_URL';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PRIVATE_RESOURCE_ID = '10000000-0000-4000-8000-000000000001';
const PUBLIC_RESOURCE_ID = '10000000-0000-4000-8000-000000000002';
const PRIVATE_SNAPSHOT_ID = '20000000-0000-4000-8000-000000000001';
const PUBLIC_SNAPSHOT_ID = '20000000-0000-4000-8000-000000000002';
const PRIVATE_OBSERVATION_ID = '30000000-0000-4000-8000-000000000001';
const PUBLIC_OBSERVATION_ID = '30000000-0000-4000-8000-000000000002';
const PRIVATE_ITEM_ID = '40000000-0000-4000-8000-000000000001';
const PUBLIC_ITEM_ID = '40000000-0000-4000-8000-000000000002';
const RELATION_ID = '50000000-0000-4000-8000-000000000001';

const PRIVATE_MARKER = 'Privacy smoke complete private body.';
const PRIVATE_SOURCE =
  '# Synthetic private weekly\r\n\r\n## 工具\r\n\r\n1、Private entry\r\n\r\n' +
  `${PRIVATE_MARKER}\r\n`;
const PUBLIC_SOURCE =
  '# Synthetic public weekly\n\n## 工具\n\n1、Public entry\n\n' +
  'Privacy smoke public body.\n';

async function main(): Promise<void> {
  const databaseUrl = process.env[DATABASE_VARIABLE];
  if (databaseUrl === undefined || databaseUrl === '') {
    process.stderr.write(
      `${JSON.stringify({event: 'm1c_private_not_ready', variable: DATABASE_VARIABLE})}\n`,
    );
    process.exitCode = 2;
    return;
  }

  const taskRoot = await mkdtemp(join(tmpdir(), 'struinfo-m1c-private-'));
  let pool: PostgresPoolBoundary | undefined;
  try {
    pool = createNodePostgresPool(
      decodePostgresConnectionUrl(databaseUrl, 'runtime'),
    );
    const repositories = createPostgresKnowledgeRepositories(pool);
    const storage = await createLocalStorageServices(taskRoot);
    const service = new M1cApiService({
      workspaceId: WORKSPACE_ID,
      blobStore: storage.blobStore,
      reviewPreferences: storage.reviewPreferences,
      evidenceRepository: repositories.evidence,
      evidenceReadRepository: repositories.evidenceRead,
      curationRepository: repositories.curation,
      curationReadRepository: repositories.curationRead,
      knowledgeRepository: repositories.knowledge,
      knowledgeReadRepository: repositories.knowledgeRead,
      retrievalRepository: repositories.retrieval,
      informationEntryRepository: repositories.informationEntries,
      informationDocumentTagRepository: repositories.informationDocumentTags,
      informationEntryAssociationRepository:
        repositories.informationEntryAssociations,
      workspaceTransfer: new M1cWorkspaceTransfer({
        repository: repositories.workspaceTransfer,
        blobStore: storage.blobStore,
        fileStore: storage.workspaceBundleFiles,
      }),
    });

    const privateFragmentId = await importDocument(
      service,
      privateDocumentInput(),
      true,
    );
    const publicFragmentId = await importDocument(
      service,
      publicDocumentInput(),
      false,
    );

    await createItems(service, privateFragmentId, publicFragmentId);
    await createRelation(service, publicFragmentId);
    await verifyDefaultAndPrivateSearch(service);
    await verifyPrivateRelationSearch(service);
    await verifyFullDocumentBoundary(service, storage.blobStore);
    await verifyDatabasePrivacy(pool);

    process.stdout.write(
      `${JSON.stringify({
        event: 'm1c_private_smoke_passed',
        migrations: 6,
        privateDocuments: 1,
        publicItemsVisibleByDefault: 1,
        privateItemsVisibleWithOptIn: 1,
        privateRelationsVisibleWithOptIn: 1,
        rawBackupVerified: true,
        normalizedFullDocumentVerified: true,
      })}\n`,
    );
  } finally {
    if (pool !== undefined) {
      await pool.end().catch(() => undefined);
    }
    await rm(taskRoot, {recursive: true, force: true});
  }
}

async function importDocument(
  service: M1cApiService,
  input: Readonly<Record<string, unknown>>,
  expectedPrivate: boolean,
): Promise<string> {
  const result = await service.importMarkdown(input);
  const body = asRecord(result.body, 'import body');
  assertEqual(result.statusCode, 201, 'import status code');
  assertEqual(body.status, 'created', 'import outcome');
  assertEqual(body.isPrivate === true, expectedPrivate, 'import privacy');
  const fragments = body.intakeTargetFragmentIds;
  if (!Array.isArray(fragments) || typeof fragments[0] !== 'string') {
    throw new Error('The imported document did not expose an intake Fragment.');
  }
  return fragments[0];
}

async function createItems(
  service: M1cApiService,
  privateFragmentId: string,
  publicFragmentId: string,
): Promise<void> {
  const result = await service.applyKnowledgeChangeSet({
    commandIdempotencyKey: 'm1c-private-items-v1',
    request: {
      authorization: {kind: 'manual_edit'},
      operations: [
        {
          kind: 'put_item',
          itemId: PRIVATE_ITEM_ID,
          expectedRevision: 0,
          value: {
            knowledgeKind: 'concept',
            epistemicRole: 'source_claim',
            reviewState: 'confirmed',
            title: 'Privacy smoke private item',
            body: 'Derived from the synthetic private document.',
          },
          provenance: provenance(privateFragmentId),
        },
        {
          kind: 'put_item',
          itemId: PUBLIC_ITEM_ID,
          expectedRevision: 0,
          value: {
            knowledgeKind: 'concept',
            epistemicRole: 'source_claim',
            reviewState: 'confirmed',
            title: 'Privacy smoke public item',
            body: 'Derived from the synthetic public document.',
          },
          provenance: provenance(publicFragmentId),
        },
      ],
    },
  });
  assertApplied(result.statusCode, result.body, 'knowledge items');
}

async function createRelation(
  service: M1cApiService,
  publicFragmentId: string,
): Promise<void> {
  const result = await service.applyKnowledgeChangeSet({
    commandIdempotencyKey: 'm1c-private-relation-v1',
    request: {
      authorization: {kind: 'manual_edit'},
      operations: [
        {
          kind: 'put_relation',
          relationId: RELATION_ID,
          expectedRevision: 0,
          value: {
            subjectItemId: PUBLIC_ITEM_ID,
            relationTypeKey: 'm1c.private-linked',
            objectItemId: PRIVATE_ITEM_ID,
            epistemicRole: 'source_claim',
            reviewState: 'confirmed',
          },
          provenance: provenance(publicFragmentId),
        },
      ],
    },
  });
  assertApplied(result.statusCode, result.body, 'private-endpoint relation');
}

async function verifyDefaultAndPrivateSearch(
  service: M1cApiService,
): Promise<void> {
  const request = searchRequest();
  const ordinary = await service.search(request);
  const ordinaryBody = asRecord(ordinary.body, 'ordinary search');
  assertEqual(ordinary.statusCode, 200, 'ordinary search status');
  assertEqual(ordinaryBody.totalCount, 1, 'ordinary result count');
  assertEqual(ordinaryBody.privateDocumentTotalCount, 0, 'ordinary documents');
  const ordinaryItems = asRecords(ordinaryBody.items, 'ordinary items');
  assertEqual(ordinaryItems[0]?.itemId, PUBLIC_ITEM_ID, 'ordinary public item');

  const expanded = await service.search({includePrivate: true, request});
  const expandedBody = asRecord(expanded.body, 'private search');
  assertEqual(expanded.statusCode, 200, 'private search status');
  assertEqual(expandedBody.totalCount, 2, 'private result count');
  assertEqual(expandedBody.privateDocumentTotalCount, 1, 'private documents');
  const expandedItems = asRecords(expandedBody.items, 'private items');
  const privateItem = expandedItems.find(
    (item) => item.itemId === PRIVATE_ITEM_ID,
  );
  assertEqual(privateItem?.isPrivate, true, 'private item marker');
}

async function verifyPrivateRelationSearch(
  service: M1cApiService,
): Promise<void> {
  const request = Object.freeze({
    filters: Object.freeze({
      knowledgeKinds: Object.freeze([]),
      epistemicRoles: Object.freeze([]),
      reviewStates: Object.freeze([]),
      source: Object.freeze({kind: 'any'}),
      relation: Object.freeze({
        kind: 'connected_to',
        anchorItemId: PUBLIC_ITEM_ID,
        direction: 'outgoing',
        relationTypeKeys: Object.freeze([]),
        reviewStates: Object.freeze([]),
      }),
    }),
    page: Object.freeze({limit: 25}),
  });
  const ordinary = await service.search(request);
  const ordinaryBody = asRecord(ordinary.body, 'ordinary relation search');
  assertEqual(ordinary.statusCode, 200, 'ordinary relation search status');
  assertEqual(
    ordinaryBody.totalCount,
    0,
    'ordinary private relation exclusion',
  );

  const expanded = await service.search({includePrivate: true, request});
  const expandedBody = asRecord(expanded.body, 'private relation search');
  assertEqual(expanded.statusCode, 200, 'private relation search status');
  assertEqual(expandedBody.totalCount, 1, 'private relation result count');
  const expandedItems = asRecords(expandedBody.items, 'private relation items');
  assertEqual(
    expandedItems[0]?.itemId,
    PRIVATE_ITEM_ID,
    'private relation target',
  );
  const publicRelations = asRecords(
    expandedItems[0]?.relationMatches,
    'private relation matches',
  );
  assertEqual(publicRelations.length, 1, 'private relation count');
  assertEqual(publicRelations[0]?.relationId, RELATION_ID, 'private relation');
  assertEqual(publicRelations[0]?.isPrivate, true, 'private relation marker');
}

async function verifyFullDocumentBoundary(
  service: M1cApiService,
  blobStore: Readonly<{
    read(
      identity: Readonly<{
        algorithm: 'sha256';
        digest: string;
        byteLength: number;
      }>,
    ): Promise<Uint8Array>;
  }>,
): Promise<void> {
  const denied = await service.loadEvidenceSnapshot(PRIVATE_SNAPSHOT_ID);
  assertEqual(denied.statusCode, 403, 'private full-document default');

  const allowed = await service.loadEvidenceSnapshot(PRIVATE_SNAPSHOT_ID, true);
  assertEqual(allowed.statusCode, 200, 'private full-document opt-in');
  const body = asRecord(allowed.body, 'private full-document body');
  const snapshot = asRecord(body.snapshot, 'private full-document snapshot');
  const structures = asRecords(snapshot.structures, 'private structures');
  const normalizedText = structures
    .map((structure) =>
      typeof structure.normalizedText === 'string'
        ? structure.normalizedText
        : '',
    )
    .join('\n');
  if (
    !normalizedText.includes(PRIVATE_MARKER) ||
    normalizedText.includes('\r')
  ) {
    throw new Error('The normalized private full document was not returned.');
  }

  const rawBytes = new TextEncoder().encode(PRIVATE_SOURCE);
  const rawDigest = createHash('sha256').update(rawBytes).digest('hex');
  const storedRaw = await blobStore.read({
    algorithm: 'sha256',
    digest: rawDigest,
    byteLength: rawBytes.byteLength,
  });
  assertEqual(
    new TextDecoder().decode(storedRaw),
    PRIVATE_SOURCE,
    'private raw backup',
  );
}

async function verifyDatabasePrivacy(
  pool: PostgresPoolBoundary,
): Promise<void> {
  const result = await pool.query<{
    private_resource: boolean;
    private_item: boolean;
    private_relation: boolean;
  }>(
    `SELECT
      (SELECT is_private FROM struinfo.resource
        WHERE workspace_id = $1 AND resource_id = $2) AS private_resource,
      (SELECT is_private FROM struinfo.knowledge_revision
        WHERE workspace_id = $1 AND item_id = $3 AND revision_number = 1) AS private_item,
      (SELECT is_private FROM struinfo.knowledge_relation_revision
        WHERE workspace_id = $1 AND relation_id = $4 AND revision_number = 1) AS private_relation`,
    [WORKSPACE_ID, PRIVATE_RESOURCE_ID, PRIVATE_ITEM_ID, RELATION_ID],
  );
  const row = result.rows[0];
  assertEqual(row?.private_resource, true, 'database private resource');
  assertEqual(row?.private_item, true, 'database private item');
  assertEqual(row?.private_relation, true, 'database private relation');
}

function privateDocumentInput(): Readonly<Record<string, unknown>> {
  return documentInput({
    commandKey: 'm1c-private-import-v1',
    resourceId: PRIVATE_RESOURCE_ID,
    snapshotId: PRIVATE_SNAPSHOT_ID,
    observationId: PRIVATE_OBSERVATION_ID,
    sourceKey: 'git:synthetic/private-weekly.md',
    sourceText: PRIVATE_SOURCE,
    isPrivate: true,
  });
}

function publicDocumentInput(): Readonly<Record<string, unknown>> {
  return documentInput({
    commandKey: 'm1c-public-import-v1',
    resourceId: PUBLIC_RESOURCE_ID,
    snapshotId: PUBLIC_SNAPSHOT_ID,
    observationId: PUBLIC_OBSERVATION_ID,
    sourceKey: 'git:synthetic/public-weekly.md',
    sourceText: PUBLIC_SOURCE,
    isPrivate: false,
  });
}

function documentInput(
  values: Readonly<{
    commandKey: string;
    resourceId: string;
    snapshotId: string;
    observationId: string;
    sourceKey: string;
    sourceText: string;
    isPrivate: boolean;
  }>,
): Readonly<Record<string, unknown>> {
  const canonicalUri = `https://example.invalid/${values.resourceId}.md`;
  return Object.freeze({
    commandIdempotencyKey: values.commandKey,
    resource: {
      resourceId: values.resourceId,
      resourceKind: 'git_file',
      sourceKey: values.sourceKey,
      canonicalUri,
      ...(values.isPrivate ? {isPrivate: true} : {}),
    },
    gitResource: {
      resourceId: values.resourceId,
      canonicalRepositoryUri: 'https://example.invalid/synthetic.git',
      repositoryRelativePath: `${values.resourceId}.md`,
    },
    snapshot: {
      snapshotId: values.snapshotId,
      resourceId: values.resourceId,
      capturedAt: '2040-01-02T03:04:05Z',
      mediaType: 'text/markdown',
    },
    gitObservations: [
      {
        observationId: values.observationId,
        resourceId: values.resourceId,
        snapshotId: values.snapshotId,
        repositoryRef: 'refs/heads/main',
        commit: {algorithm: 'sha1', digest: 'a'.repeat(40)},
        observedAt: '2040-01-02T03:04:05Z',
      },
    ],
    profile: 'ruanyf-weekly-v1',
    sourceText: values.sourceText,
    documentBaseUri: canonicalUri,
  });
}

function provenance(fragmentId: string) {
  return Object.freeze({
    citations: Object.freeze([fragmentId]),
    fragmentDerivations: Object.freeze([]),
    knowledgeDerivations: Object.freeze([]),
  });
}

function searchRequest() {
  return Object.freeze({
    text: Object.freeze({
      value: 'Privacy smoke',
      mode: 'substring',
      fields: Object.freeze(['title', 'body']),
    }),
    filters: Object.freeze({
      knowledgeKinds: Object.freeze([]),
      epistemicRoles: Object.freeze([]),
      reviewStates: Object.freeze([]),
      source: Object.freeze({kind: 'any'}),
      relation: Object.freeze({kind: 'any'}),
    }),
    page: Object.freeze({limit: 25}),
  });
}

function assertApplied(statusCode: number, body: unknown, label: string): void {
  assertEqual(statusCode, 200, `${label} status code`);
  assertEqual(asRecord(body, label).status, 'applied', `${label} outcome`);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} was not a record.`);
  }
  return value as Record<string, unknown>;
}

function asRecords(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} was not an array.`);
  }
  return value.map((entry) => asRecord(entry, label));
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} did not match its expected value.`);
  }
}

await main();
