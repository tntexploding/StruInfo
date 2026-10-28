import {PostgresResearchRepository} from '../platform/database/postgresql/postgres_research_repository.js';
import {researchSettingsSchema, scheduleSchema} from './research_contract.js';
import {TopicService} from './topic_service.js';
import {PostgresTopicRepository} from '../platform/database/postgresql/postgres_topic_repository.js';
import {
  topicScopeSchema,
  topicFingerprint,
  type TopicInput,
  type TopicValue,
} from '../modules/entries/content_topics.js';
import {AiTagProposalService} from '../modules/processing/ai_tag_proposal_service.js';
import {AnnotationService} from './annotation_service.js';
import {
  EMPTY_ANNOTATION_VOCABULARY,
  type AnnotationDraft,
  type AnnotationVocabulary,
} from '../modules/entries/structured_annotations.js';
import {beforeAll, afterAll, describe, it, expect} from 'vitest';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {once} from 'node:events';
import {ExpressAdapter} from '@nestjs/platform-express';
import type {Express} from 'express';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createAgentMcpServer} from '../transport/agent_mcp.js';
import {agentHttpMiddleware} from '../transport/agent_http.js';
import {
  DocumentPublicationService,
  publishedEntryRepository,
  unpublishedSnapshots,
} from './document_publication.js';
import {DocumentIntakeService} from './document_intake_service.js';
import {AgentCaptureService} from './agent_capture_service.js';
import {AgentCommands} from './agent_commands.js';
import type {AgentTaskService} from './agent_task_service.js';
import {
  ExecutionAuthority,
  DELEGATED_READ_OPERATIONS,
} from './execution_authority.js';
import {DocumentUseCases} from './document_use_cases.js';
import {EntryUseCases} from './entry_use_cases.js';
import {RelationUseCases} from './relation_use_cases.js';
import {PostgresDocumentIntakeRepository} from '../platform/database/postgresql/postgres_document_intake_repository.js';
import {PostgresDocumentPublicationRepository} from '../platform/database/postgresql/postgres_document_publication_repository.js';
import {PostgresEvidenceRepository} from '../platform/database/postgresql/postgres_evidence_repository.js';
import {
  recordIngestionCapture,
  PostgresIngestionRepository,
} from '../platform/database/postgresql/postgres_ingestion_repository.js';
import {
  importSourceConnectorDocuments,
  SourceConnectorRegistry,
  type SourceConnectorDocument,
} from '../modules/subscriptions/source_connector.js';
import {DEFAULT_SOURCE_RECEIVING} from '../modules/subscriptions/source_receiving.js';
import {importMarkdownEvidence} from '../modules/evidence/index.js';
import {ingestionSettingsSchema} from './ingestion_contract.js';
import {PostgresM1cDomainTransferRepository} from '../platform/database/postgresql/postgres_workspace_transfer_repository.js';
import {
  createNodePostgresPool,
  createPostgresRepositories,
  type PostgresPoolBoundary,
} from '../platform/database/postgresql/index.js';
import {POSTGRES_STARTUP_OPTIONS} from '../platform/database/postgresql/postgres_connection_config.js';
import {executeMigrations} from '../platform/database/migrations/migration_runner.js';
import {NodeMigrationFileSystem} from '../platform/database/migrations/migration_files.js';
import {PgMigrationConnector} from '../platform/database/migrations/postgres_migration_connection.js';
import {preparePgBossSchema} from '../queue/prepare_pg_boss_schema.js';
import {SystemPgBossFactory} from '../queue/pg_boss_runtime.js';
import {initializeLocalDataRoot} from '../platform/storage/local_data_root.js';
import {LocalFilesystemBlobStore} from '../platform/storage/local_filesystem_blob_store.js';
import {LocalReviewPreferencesStore} from '../platform/storage/local_review_preferences_store.js';
import {SourceSubscriptionService} from '../modules/subscriptions/source_subscription.js';
import {InformationEntryRetrievalService} from '../modules/entries/information_entry_retrieval.js';
import {SourceSplitService} from './source_split_service.js';
import type {SourceSplitDefinition} from '../modules/entries/source_split_recipe.js';

// Only the dedicated runner supplies this isolated target. No instance config is read.
const port = process.env.STRUINFO_P1_TEST_PORT;
function required<T>(value: T | undefined): T {
  assert(value !== undefined, 'Synthetic setup value is missing');
  return value;
}
describe.skipIf(!port)('P1 disposable PostgreSQL publication', () => {
  let admin: PostgresPoolBoundary, runtime: PostgresPoolBoundary;
  const pools: PostgresPoolBoundary[] = [];
  let blobStore: LocalFilesystemBlobStore,
    preferences: LocalReviewPreferencesStore;
  beforeAll(async () => {
    const container = required(process.env.STRUINFO_P1_TEST_CONTAINER);
    expect(container).toMatch(/^struinfo-p1-test-[a-f0-9-]+$/u);
    const connection = {
      host: '127.0.0.1',
      port: Number(port),
      database: 'struinfo_p1_test',
      user: 'struinfo_test',
      password: 'synthetic-test-only',
      ssl: false as const,
      application_name: 'struinfo-p1-test',
      options: POSTGRES_STARTUP_OPTIONS,
    };
    admin = createNodePostgresPool(connection);
    pools.push(admin);
    expect(
      (await admin.query("SELECT to_regnamespace('struinfo') AS schema"))
        .rows[0]?.schema,
    ).toBe(null);
    const migrations = {
      config: {connection},
      migrationRoots: [resolve('apps/server/migrations')],
      fileSystem: new NodeMigrationFileSystem(),
      connector: new PgMigrationConnector(),
      logger: {
        write() {
          /* No credentials in output. */
        },
      },
    };
    expect((await executeMigrations(migrations)).outcome).toBe('applied');
    expect((await executeMigrations(migrations)).outcome).toBe('noop');
    await preparePgBossSchema({
      factory: new SystemPgBossFactory(),
      pool: admin,
    });
    await admin.query(
      "CREATE ROLE struinfo_tm2_runtime LOGIN PASSWORD 'synthetic-test-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
    );
    execFileSync(
      'docker',
      [
        'exec',
        '-i',
        container,
        'psql',
        '-U',
        'struinfo_test',
        '-d',
        'struinfo_p1_test',
      ],
      {
        input: await readFile(
          resolve('deploy/postgresql/apply-runtime-grants.sql'),
          'utf8',
        ),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    runtime = createNodePostgresPool({
      ...connection,
      user: 'struinfo_tm2_runtime',
    });
    pools.push(runtime);
    const layout = await initializeLocalDataRoot(
      required(process.env.STRUINFO_P1_TEST_ROOT),
    );
    blobStore = await LocalFilesystemBlobStore.open(layout.areaRoots.blobs);
    preferences = new LocalReviewPreferencesStore(layout.areaRoots.preferences);
  }, 60000);
  afterAll(async () => {
    for (const pool of pools.toReversed()) await pool.end();
  });

  async function fixture() {
    const w = randomUUID(),
      repo = createPostgresRepositories(runtime);
    await repo.processingRuns.createRun({
      workspaceId: w,
      runId: randomUUID(),
      idempotencyKey: 'p1',
      origin: 'deterministic',
      privacyScope: 'public_only',
      initialStage: 'import',
    });
    const owner = ExecutionAuthority.owner(w);
    const agent = ExecutionAuthority.agent(w, 'p1-agent', [
      ...DELEGATED_READ_OPERATIONS,
      'sources.capture',
      'agent.split',
      'agent.tags',
    ]);
    const readonly = ExecutionAuthority.agent(
      w,
      'p1-read',
      DELEGATED_READ_OPERATIONS,
    );
    const captureRepo = new PostgresEvidenceRepository(runtime, (c, capture) =>
      recordIngestionCapture(c, capture, {kind: 'upload'}),
    );
    const subscriptions = new SourceSubscriptionService({
      workspaceId: w,
      preferences,
      processing: repo.processingRuns,
      blobStore,
      evidence: repo.evidence,
      reader: {
        read: () => Promise.reject(new Error('network forbidden in P1')),
      },
    });
    const capture = new AgentCaptureService(w, {
      blobStore,
      evidence: captureRepo,
      evidenceRead: repo.evidenceRead,
      subscriptions,
    });
    const intakeRepo = new PostgresDocumentIntakeRepository(runtime, w);
    const intake = new DocumentIntakeService({
      workspaceId: w,
      repository: intakeRepo,
      evidence: repo.evidenceRead,
      capture: captureRepo,
      blobStore,
      assertBodyChangeAllowed: () => Promise.resolve(),
      readWeb: () => Promise.reject(new Error('network forbidden in P1')),
    });
    const ledger = new PostgresDocumentPublicationRepository(runtime, w);
    const publication = new DocumentPublicationService(
      w,
      intakeRepo,
      intake,
      repo.informationEntries,
      () => Promise.resolve([]),
      ledger,
    );
    const knowledge = publishedEntryRepository(
      repo.informationEntries,
      async (entries) =>
        unpublishedSnapshots(await intakeRepo.list(), [], entries),
      ledger,
    );
    const retrieval = new InformationEntryRetrievalService({
      annotationVocabulary: async () =>
        (await preferences.load(w)).annotationVocabulary ??
        EMPTY_ANNOTATION_VOCABULARY,
      workspaceId: w,
      entries: knowledge,
      associations: repo.informationEntryAssociations,
      index: repo.informationEntrySearchIndex,
    });
    const documents = new DocumentUseCases(owner, {
      blobStore,
      evidenceReadRepository: repo.evidenceRead,
      informationEntryRepository: repo.informationEntries,
      informationDocumentTagRepository: repo.informationDocumentTags,
      informationDocumentWorkingCopyRepository:
        repo.informationDocumentWorkingCopies,
      documentIntakeRepository: intakeRepo,
      stageDocument: (id) => publication.stage(id, 'manual'),
    });
    const entriesFor = (authority: ExecutionAuthority) =>
      new EntryUseCases(authority, {
        blobStore,
        evidenceReadRepository: repo.evidenceRead,
        informationEntryRepository: repo.informationEntries,
        informationEntryAssociationRepository:
          repo.informationEntryAssociations,
        knowledgeEntries: knowledge,
        informationEntryRetrieval: retrieval,
        stageDocument: (id) => publication.stage(id, 'manual'),
      });
    const annotations = new AnnotationService({
      workspaceId: w,
      entries: repo.informationEntries,
      preferences,
      stage: (id) => publication.stage(id, 'manual'),
    });
    const commands = (authority: ExecutionAuthority) =>
      new AgentCommands(authority, {
        capture,
        intake,
        publication,
        sourceSplit,
        annotations,
        documents,
        entries: entriesFor(authority),
        relations: new RelationUseCases(authority, {
          informationEntryRepository: repo.informationEntries,
          informationEntryAssociationRepository:
            repo.informationEntryAssociations,
          reviewPreferences: preferences,
          knowledgeEntries: knowledge,
        }),
        tasks: {} as AgentTaskService,
      });
    const imported = await capture.importText(owner, {
      requestKey: 'p1',
      title: 'P1 synthetic guide',
      markdown: '# Synthetic guide\n\nConfirmed alpha knowledge.\n',
    });
    const snapshotId = imported.snapshotId;
    const sourceSplit = new SourceSplitService({
      workspaceId: w,
      preferences,
      evidence: repo.evidenceRead,
      blobStore,
      entries: repo.informationEntries,
      intake: intakeRepo,
      workingCopyPending: async (id) =>
        (await repo.informationDocumentWorkingCopies.load(w, id))?.state ===
        'editing',
      stage: (id) => publication.stage(id, 'manual'),
      checkModelCall: () =>
        Promise.reject(new Error('Models forbidden in P3 test')),
    });
    const accept = async () =>
      intake.receive(
        [
          {
            snapshotId,
            expectedVersion: (await intakeRepo.read(snapshotId))?.version ?? 0,
          },
        ],
        'accept',
      );
    const prepare = async () => {
      await accept();
      return documents.materialize({
        snapshotId,
        includePrivate: false,
        mode: 'deterministic',
      });
    };
    const confirm = async () =>
      publication.confirm(owner, {
        snapshotId,
        expectedEntries: (await documents.read(snapshotId)).entries.map(
          (e) => ({entryId: e.entryId, revision: e.revision}),
        ),
      });
    return {
      w,
      repo,
      owner,
      agent,
      readonly,
      capture,
      intakeRepo,
      intake,
      ledger,
      publication,
      knowledge,
      documents,
      entriesFor,
      commands,
      snapshotId,
      sourceSplit,
      accept,
      prepare,
      confirm,
    };
  }

  it('P5 persists manual topics, rejects stale writes and shares owner/Agent reads', async () => {
    const f = await fixture();
    await f.prepare();
    await f.confirm();
    const entry = required(
      (await f.knowledge.loadCurrentEntries(f.w, false))[0],
    );
    const repo = new PostgresTopicRepository(runtime, f.w);
    const topics = new TopicService({
      workspaceId: f.w,
      repository: repo,
      entries: f.knowledge,
      publications: f.ledger,
      checkModelCall: () => Promise.resolve(),
      executionSettings: () => Promise.resolve({automaticRetryLimit: 0}),
    });
    const {topicId} = (await topics.execute(f.owner, 'topic_save', {
      expectedVersion: 0,
      name: 'Synthetic topic',
      scope: 'Alpha knowledge',
    })) as {topicId: string};
    await topics.execute(f.owner, 'topic_member_set', {
      topicId,
      expectedVersion: 1,
      member: {
        entryId: entry.entryId,
        revision: entry.revision,
        quote: 'alpha',
        reason: 'Synthetic membership',
        decision: 'pinned',
      },
    });
    await expect(
      topics.execute(f.owner, 'topic_save', {
        topicId,
        expectedVersion: 1,
        name: 'stale',
        scope: 'stale',
      }),
    ).rejects.toMatchObject({code: 'topic_version_changed'});
    expect(await topics.execute(f.readonly, 'topics_list', {})).toMatchObject({
      topics: [
        {id: topicId, version: 2, value: {members: [{decision: 'pinned'}]}},
      ],
    });
    await expect(
      topics.execute(f.readonly, 'topic_member_set', {
        topicId,
        expectedVersion: 2,
        member: {
          entryId: entry.entryId,
          revision: entry.revision,
          quote: 'alpha',
          reason: 'unauthorized',
          decision: 'excluded',
        },
      }),
    ).rejects.toMatchObject({code: 'operation_not_authorized'});
    const original = required(await repo.read(topicId));
    expect(
      await repo.save([
        {id: randomUUID(), expectedVersion: 0, value: original.value},
        {id: topicId, expectedVersion: 1, value: original.value},
      ]),
    ).toBe(false);
    expect(await repo.list('topic')).toHaveLength(1);
  });

  it('P4 persists evidence, protects manual edits and uses confirmed versions for classification', async () => {
    const f = await fixture();
    const prepared = await f.prepare();
    const entry = required(prepared.entries[0]);
    await f.confirm();
    const dim = randomUUID(),
      term = randomUUID();
    const vocabulary: AnnotationVocabulary = {
      revision: 0,
      dimensions: [
        {
          id: dim,
          name: 'Synthetic issue',
          role: 'issue',
          description: 'Subject',
          enabled: true,
        },
      ],
      terms: [
        {
          id: term,
          dimensionId: dim,
          label: 'Alpha knowledge',
          meaning: 'Synthetic subject',
        },
      ],
      aliases: [{termId: term, text: '合成知识', status: 'confirmed'}],
      relations: [],
    };
    const command = (name: string, input: unknown) =>
      f.commands(f.owner).execute(name, input);
    await command('annotation_vocabulary_save', {
      expectedRevision: 0,
      vocabulary,
    });
    const quote = 'Confirmed alpha knowledge.';
    const start = Array.from(
      entry.value.body.slice(0, entry.value.body.indexOf(quote)),
    ).length;
    const draft: AnnotationDraft = {
      status: 'complete',
      note: '',
      readingState: 'read',
      labels: [
        {
          dimensionId: dim,
          term: required(vocabulary.terms[0]),
          wording: 'alpha knowledge',
          primary: true,
          evidence: {start, end: start + quote.length, quote},
        },
      ],
      claims: [],
    };
    const write = {
      entryId: entry.entryId,
      expectedRevision: entry.revision,
      vocabularyRevision: 1,
      annotation: draft,
    };
    await expect(
      f.commands(f.readonly).execute('entry_annotations_save', write),
    ).rejects.toMatchObject({code: 'operation_not_authorized'});
    await expect(
      command('entry_annotations_save', {
        ...write,
        annotation: {
          ...draft,
          labels: [
            {...draft.labels[0], evidence: {start: 0, end: 4, quote: 'fake'}},
          ],
        },
      }),
    ).rejects.toMatchObject({code: 'annotation_evidence_invalid'});
    await command('entry_annotations_save', write);
    expect(
      (await f.knowledge.loadCurrentEntries(f.w, false))[0]?.value.annotations,
    ).toBeUndefined();
    const current = required(
      (await f.repo.informationEntries.loadCurrentEntries(f.w, false))[0],
    );
    expect(current.value.annotations?.labels[0]?.evidence.quote).toBe(quote);
    await expect(
      command('entry_annotations_save', write),
    ).rejects.toMatchObject({code: 'stale_entry_revision'});
    await expect(
      f.commands(f.agent).execute('entry_annotations_save', {
        ...write,
        expectedRevision: current.revision,
      }),
    ).rejects.toMatchObject({code: 'manual_annotations_protected'});
    await f.confirm();
    const found = await f.entriesFor(f.owner).search({
      text: '合成知识',
      textFields: ['tags'],
      includePrivate: false,
      limit: 20,
      annotationFilter: {termIds: [term], readingState: 'read'},
    });
    expect(found.totalCount).toBe(1);
    expect(found.items[0]?.entry.value.annotations?.origin).toBe('manual');
    const bundle = await new PostgresM1cDomainTransferRepository(
      runtime,
    ).exportWorkspace(f.w);
    expect(
      bundle.entries.tables.find(
        (t) => t.name === 'information_entry_annotation',
      )?.rows,
    ).toHaveLength(1);
    expect((await preferences.load(f.w)).annotationVocabulary?.aliases).toEqual(
      vocabulary.aliases,
    );
    await expect(
      command('annotation_vocabulary_save', {expectedRevision: 0, vocabulary}),
    ).rejects.toMatchObject({code: 'stale_annotation_vocabulary'});
  });

  it('P3 shares recipe preview/apply with Agents and publishes only confirmed materialized content', async () => {
    const f = await fixture();
    const definition: SourceSplitDefinition = {
      recipeId: randomUUID(),
      revision: 1,
      name: 'Synthetic guide recipe',
      origin: 'manual',
      scope: {kind: 'document', snapshotId: f.snapshotId},
      settings: {
        template: 'whole',
        headingLevel: 2,
        titleIncludes: [],
        appendixHeadings: [],
        minimumEntries: 1,
        maximumEntries: 1,
        minimumBodyCharacters: 10,
        onMismatch: 'review',
      },
    };
    const command = (operation: string, input: Record<string, unknown>) =>
      f
        .commands(f.owner)
        .execute(operation, {snapshotId: f.snapshotId, ...input});
    await command('split_recipe_save', {expectedRevision: 0, definition});
    await expect(
      f.commands(f.readonly).execute('split_recipe_preview', {
        snapshotId: f.snapshotId,
        definition,
      }),
    ).resolves.toMatchObject({outcome: 'ready', completeCoverage: true});
    await command('split_recipe_trial', {
      recipeId: definition.recipeId,
      expectedRevision: 1,
      sampleKind: 'typical',
      expected: 'ready',
    });
    await command('split_recipe_control', {
      recipeId: definition.recipeId,
      expectedRevision: 2,
      action: 'enable',
      note: 'Synthetic source checked.',
    });
    await expect(
      command('split_recipe_apply', {
        recipeId: definition.recipeId,
        expectedRevision: 3,
      }),
    ).rejects.toMatchObject({code: 'recipe_receipt_not_accepted'});
    await f.accept();
    await expect(
      f.commands(f.readonly).execute('split_recipe_apply', {
        snapshotId: f.snapshotId,
        recipeId: definition.recipeId,
        expectedRevision: 3,
      }),
    ).rejects.toMatchObject({code: 'operation_not_authorized'});
    await expect(
      f.commands(f.agent).execute('split_recipe_apply', {
        snapshotId: f.snapshotId,
        recipeId: definition.recipeId,
        expectedRevision: 3,
      }),
    ).resolves.toMatchObject({createdCount: 1});
    expect(await f.knowledge.loadCurrentEntries(f.w, false)).toHaveLength(0);
    await f.confirm();
    const confirmed = await f.knowledge.loadCurrentEntries(f.w, false);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.value.body).toContain('Confirmed alpha knowledge.');
    await expect(
      command('split_recipe_apply', {
        recipeId: definition.recipeId,
        expectedRevision: 3,
      }),
    ).rejects.toMatchObject({code: 'document_structure_changed'});
    expect((await f.ledger.read(f.snapshotId))?.organization.status).toBe(
      'pending',
    );
  });

  it('P2 retries a partial receipt without duplicating articles or replacing manual decisions', async () => {
    const f = await fixture();
    const subscriptionId = randomUUID();
    const queue = new PostgresIngestionRepository(runtime, f.w);
    await queue.savePolicy(
      0,
      ingestionSettingsSchema.parse({
        enabled: true,
        subscriptionIds: [subscriptionId],
        model: 'synthetic-no-calls',
      }),
      {kind: 'owner', id: 'owner'},
    );
    let clock = '2026-10-24T01:00:00.000Z',
      raw = 'Original synthetic batch',
      fail = true;
    const document = (id: string): SourceConnectorDocument => ({
      externalId: id,
      version: 'v1',
      canonicalUri: 'https://example.invalid/' + id,
      mediaType: 'text/plain',
      profile: 'commonmark-v1',
      sourceUtf8: new TextEncoder().encode(
        '# Synthetic article\n\nA complete synthetic paragraph.',
      ),
      rawSourceBytes: new TextEncoder().encode(raw),
    });
    const service = new SourceSubscriptionService({
      workspaceId: f.w,
      preferences,
      processing: f.repo.processingRuns,
      blobStore,
      evidence: f.repo.evidence,
      evidenceRead: f.repo.evidenceRead,
      evidenceForSubscription: (id, reception) =>
        new PostgresEvidenceRepository(runtime, (client, capture) =>
          recordIngestionCapture(
            client,
            capture,
            {kind: 'subscription', subscriptionId: id},
            reception ? {reception} : {},
          ),
        ),
      pendingCounts: () => queue.pendingSourceCounts(),
      reader: {read: () => Promise.reject(new Error('Unexpected Git fetch'))},
      connectors: new SourceConnectorRegistry([
        {
          connectorId: 'builtin.rss-atom.v1',
          read: () =>
            Promise.resolve({
              status: 'changed',
              cursor: 'live-cursor',
              documents: [document('a'), document('b')],
            }),
        },
      ]),
      importConnectorDocuments: (deps, input) =>
        importSourceConnectorDocuments(
          {
            ...deps,
            importEvidence: (d, i) => {
              if (fail && i.resource.canonicalUri?.endsWith('/b'))
                return Promise.resolve({
                  status: 'persistence_failed',
                  code: 'transaction_failed',
                });
              return importMarkdownEvidence(d, i);
            },
          },
          input,
        ),
      now: () => clock,
    });
    const configured = {
      subscriptionId,
      kind: 'rss_atom' as const,
      label: 'Synthetic P2 source',
      sourceAlias: 'synthetic-p2',
      feedUrl: 'https://example.invalid/feed',
      itemLimit: 5,
      enabled: true,
      isPrivate: false,
      intervalMinutes: 60,
      receiving: {
        ...DEFAULT_SOURCE_RECEIVING,
        schedule: {mode: 'once' as const},
      },
    };
    await service.replace(0, [configured]);
    await expect(
      service.runNow(subscriptionId, 'partial'),
    ).rejects.toMatchObject({code: 'source_import_unavailable'});
    const first = required(
      (await f.repo.evidenceRead.listSnapshots(f.w)).find((s) =>
        s.canonicalUri?.endsWith('/a'),
      ),
    );
    const firstRecord = required(await f.intakeRepo.read(first.snapshotId));
    await f.intake.receive(
      [{snapshotId: first.snapshotId, expectedVersion: firstRecord.version}],
      'reject',
    );
    expect((await service.list()).subscriptions[0]?.cursor).toBeUndefined();
    expect((await service.receivingStatus())[subscriptionId]).toMatchObject({
      failures: 1,
      reason: 'backoff',
    });
    fail = false;
    clock = '2026-10-24T02:00:00.000Z';
    await service.runNow(subscriptionId, 'retry');
    raw = 'Changed enclosing feed; articles unchanged';
    clock = '2026-10-24T03:00:00.000Z';
    await service.runNow(subscriptionId, 'repeat');
    expect(
      (await f.repo.evidenceRead.listSnapshots(f.w)).filter((s) =>
        s.sourceKey.startsWith('synthetic-p2#'),
      ),
    ).toHaveLength(2);
    expect((await f.intakeRepo.read(first.snapshotId))?.value.receipt).toBe(
      'rejected',
    );
    const records = (await f.intakeRepo.list()).filter(
      (r) => r.value.captureOrigin?.kind === 'subscription',
    );
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.value.reception?.channel === 'live')).toBe(
      true,
    );
    expect(await service.runDue()).toEqual([]);
    const state = (await service.list()).subscriptions[0];
    expect(state?.cursor).toEqual({connectorCursor: 'live-cursor'});
    expect((await service.receivingStatus())[subscriptionId]).toMatchObject({
      reason: 'collected',
      errorCode: null,
      pendingCount: 1,
      lastNewAt: '2026-10-24T02:00:00.000Z',
    });
    const current = await service.list();
    await service.replace(current.revision, [
      {...configured, receiving: {...configured.receiving, urgency: 'high'}},
    ]);
    expect((await service.list()).subscriptions[0]?.cursor).toEqual(
      state?.cursor,
    );
    expect(
      (await f.intakeRepo.read(first.snapshotId))?.value.reception?.strategy
        ?.urgency,
    ).toBe('normal');
    expect(await queue.dispatchCandidates(25)).toHaveLength(1);
    expect(await f.knowledge.loadCurrentEntries(f.w, false)).toEqual([]);
  });

  it('P2 retains history provenance outside automatic admission and schedules sources fairly', async () => {
    const f = await fixture(),
      sourceA = randomUUID(),
      sourceB = randomUUID();
    const queue = new PostgresIngestionRepository(runtime, f.w);
    await queue.savePolicy(
      0,
      ingestionSettingsSchema.parse({
        enabled: true,
        subscriptionIds: [sourceA, sourceB],
        model: 'synthetic-no-calls',
      }),
      {kind: 'owner', id: 'owner'},
    );
    const capture = async (sourceId: string, id: string, history = false) =>
      importSourceConnectorDocuments(
        {
          blobStore,
          evidenceRead: f.repo.evidenceRead,
          evidenceRepository: new PostgresEvidenceRepository(
            runtime,
            (client, value) =>
              recordIngestionCapture(
                client,
                value,
                {kind: 'subscription', subscriptionId: sourceId},
                {
                  reviewOnly: history,
                  reception: {
                    channel: history ? 'history' : 'live',
                    strategy: DEFAULT_SOURCE_RECEIVING,
                  },
                },
              ),
          ),
        },
        {
          workspaceId: f.w,
          subscriptionId: sourceId,
          sourceAlias: 'synthetic-' + sourceId,
          isPrivate: false,
          connectorId: history ? 'builtin.history.v1' : 'builtin.rss-atom.v1',
          capturedAt: '2026-10-24T01:00:00.000Z',
          result: {
            status: 'changed',
            cursor: 'independent',
            documents: [
              {
                externalId: id,
                version: '1',
                canonicalUri: 'https://example.invalid/' + id,
                mediaType: 'text/markdown',
                profile: 'commonmark-v1',
                sourceUtf8: new TextEncoder().encode(
                  '# Synthetic ' + id + '\n\nOriginal content.\n',
                ),
              },
            ],
          },
        },
      );
    await capture(sourceA, 'old', true);
    for (const id of ['a1', 'a2', 'a3']) await capture(sourceA, id);
    await capture(sourceB, 'b1');
    const records = await f.intakeRepo.list();
    const history = required(
      records.find((r) => r.value.reception?.channel === 'history'),
    );
    expect(history.value.receipt).toBe('pending');
    expect(await queue.read(history.snapshotId)).toBeUndefined();
    const firstTwo = await queue.dispatchCandidates(2);
    expect(
      new Set(
        firstTwo.map((r) =>
          r.origin.kind === 'subscription' ? r.origin.subscriptionId : 'upload',
        ),
      ).size,
    ).toBe(2);
    expect(
      firstTwo.every(
        (r) => r.taskId === undefined && r.reception?.channel === 'live',
      ),
    ).toBe(true);
    expect(
      (await queue.list(false, 10)).some(
        (r) => r.snapshotId === history.snapshotId,
      ),
    ).toBe(false);
    await capture(sourceA, 'old', true);
    expect(
      (await f.intakeRepo.list()).filter(
        (r) => r.value.reception?.channel === 'history',
      ),
    ).toHaveLength(1);
    expect(await f.knowledge.loadCurrentEntries(f.w, false)).toEqual([]);
  });

  it('imports, confirms through HTTP, reads through MCP and preserves confirmed content across draft edits and organization failure', async () => {
    const f = await fixture();
    const again = await f.capture.importText(f.owner, {
      requestKey: 'p1',
      title: 'P1 synthetic guide',
      markdown: '# Synthetic guide\n\nConfirmed alpha knowledge.\n',
    });
    expect(again.status).toBe('existing');
    expect(again.snapshotId).toBe(f.snapshotId);
    await expect(
      f.capture.importText(f.owner, {
        requestKey: 'p1',
        title: 'P1 synthetic guide',
        markdown: 'Changed source',
      }),
    ).rejects.toBeDefined();
    const prepared = await f.prepare();
    expect(await f.knowledge.loadCurrentEntries(f.w, false)).toHaveLength(0);
    const adapter = new ExpressAdapter();
    adapter.registerParserMiddleware();
    const app: Express = adapter.getInstance();
    const token = 'synthetic-p1-token-'.repeat(3);
    app.use(
      agentHttpMiddleware({
        owner: f.commands(f.owner),
        agent: {token, commands: f.commands(f.agent)},
      }),
    );
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('test listener failed');
    const url = `http://127.0.0.1:${String(address.port)}`;
    const http = async (operation: string, input: unknown, owner = false) => {
      const response = await fetch(
        url + (owner ? '/api/v1/ai-tasks/commands' : '/api/v1/agent/commands'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(owner ? {} : {Authorization: 'Bearer ' + token}),
          },
          body: JSON.stringify({operation, input}),
        },
      );
      return {
        status: response.status,
        body: (await response.json()) as {
          result?: unknown;
          error?: {code: string};
        },
      };
    };
    const mcp = createAgentMcpServer((op, input) =>
      f
        .commands(f.readonly)
        .execute(op, input)
        .then((result) => ({result})),
    );
    const client = new Client({name: 'p1-test', version: '1'});
    const [a, b] = InMemoryTransport.createLinkedPair();
    await mcp.connect(a);
    await client.connect(b);
    try {
      const expectedEntries = prepared.entries.map((e) => ({
        entryId: e.entryId,
        revision: e.revision,
      }));
      expect(
        (
          await http(
            'document_publish',
            {snapshotId: f.snapshotId, expectedEntries},
            true,
          )
        ).status,
      ).toBe(200);
      const first = required(await f.ledger.read(f.snapshotId));
      expect(first.times.sourcePublishedAt).toBe(null);
      expect(first.times.eventAt).toBe(null);
      expect(first.organization.status).toBe('pending');
      expect(
        (await http('entries_search', {text: 'alpha'})).body.result,
      ).toMatchObject({totalCount: 1});
      expect(
        (
          await client.callTool({
            name: 'document_publish',
            arguments: {snapshotId: f.snapshotId, expectedEntries},
          })
        ).isError,
      ).toBe(true);
      const read = await client.callTool({
        name: 'entries_search',
        arguments: {text: 'alpha'},
      });
      expect(JSON.stringify(read)).toContain('Confirmed alpha knowledge');
      await f.confirm();
      expect((await f.ledger.read(f.snapshotId))?.publicationId).toBe(
        first.publicationId,
      );
      const entry = required(prepared.entries[0]);
      await f.entriesFor(f.owner).revise(entry.entryId, {
        expectedRevision: entry.revision,
        includePrivate: false,
        annotation: {
          body: 'Draft beta knowledge.',
          contentKeywords: ['draft-only'],
          typeKeyword: 'knowledge_explanation',
          domains: [{keyword: 'engineering_computing'}],
        },
      });
      expect(
        (await http('entries_search', {text: 'alpha'})).body.result,
      ).toMatchObject({totalCount: 1});
      expect(
        (await http('entries_search', {text: 'beta'})).body.result,
      ).toMatchObject({totalCount: 0});
      expect(
        (await http('document_publication_status', {snapshotId: f.snapshotId}))
          .body.result,
      ).toMatchObject({visibility: 'published', hasDraft: true});
      expect(
        (
          await http(
            'document_publish',
            {snapshotId: f.snapshotId, expectedEntries},
            true,
          )
        ).status,
      ).toBe(409);
      expect(
        await f.ledger.transitionOrganization({
          publicationId: first.publicationId,
          expectedVersion: 1,
          from: 'pending',
          to: 'running',
        }),
      ).toBe(true);
      expect(
        await f.ledger.transitionOrganization({
          publicationId: first.publicationId,
          expectedVersion: 2,
          from: 'running',
          to: 'failed',
          errorCode: 'synthetic_worker_failure',
        }),
      ).toBe(true);
      expect(
        (await http('entries_search', {text: 'alpha'})).body.result,
      ).toMatchObject({totalCount: 1});
      const restarted = new PostgresDocumentPublicationRepository(runtime, f.w);
      expect((await restarted.read(f.snapshotId))?.organization.status).toBe(
        'failed',
      );
      expect(
        (await restarted.loadPublished(f.w, false)).entries[0]?.value.body,
      ).toContain('alpha');
      const revised = (await f.documents.read(f.snapshotId)).entries;
      expect(
        (
          await http('document_publish', {
            snapshotId: f.snapshotId,
            expectedEntries: revised.map((e) => ({
              entryId: e.entryId,
              revision: e.revision,
            })),
          })
        ).status,
      ).toBe(200);
      expect(
        (await http('entries_search', {text: 'beta'})).body.result,
      ).toMatchObject({totalCount: 1});
      expect(
        (await http('entries_search', {text: 'alpha'})).body.result,
      ).toMatchObject({totalCount: 0});
      expect(
        await f.ledger.transitionOrganization({
          publicationId: first.publicationId,
          expectedVersion: 3,
          from: 'failed',
          to: 'pending',
        }),
      ).toBe(false);
      expect((await f.ledger.read(f.snapshotId))?.organization.status).toBe(
        'pending',
      );
      const raw = await f.repo.evidenceRead.loadSnapshot(f.w, f.snapshotId);
      expect(raw).toBeDefined();
    } finally {
      await client.close();
      await mcp.close();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => {
          if (e) reject(e);
          else resolve();
        }),
      );
    }
  }, 60000);

  it('rolls back intake, confirmed version and background work together when enqueue fails', async () => {
    const f = await fixture();
    await f.prepare();
    const before = await f.intakeRepo.read(f.snapshotId);
    const failing: PostgresPoolBoundary = {
      ...runtime,
      query: runtime.query.bind(runtime),
      end: () => Promise.resolve(),
      connect: async () => {
        const c = await runtime.connect();
        return {
          query: (sql, params) => {
            if (sql.includes('INSERT INTO struinfo.document_organization_work'))
              throw new Error('synthetic crash');
            return c.query(sql, params);
          },
          executeSimple: c.executeSimple.bind(c),
          release: c.release.bind(c),
        };
      },
    };
    const broken = new DocumentPublicationService(
      f.w,
      f.intakeRepo,
      f.intake,
      f.repo.informationEntries,
      () => Promise.resolve([]),
      new PostgresDocumentPublicationRepository(failing, f.w),
    );
    await expect(
      broken.confirm(f.owner, {
        snapshotId: f.snapshotId,
        expectedEntries: (await f.documents.read(f.snapshotId)).entries.map(
          (e) => ({entryId: e.entryId, revision: e.revision}),
        ),
      }),
    ).rejects.toBeDefined();
    expect(await f.intakeRepo.read(f.snapshotId)).toEqual(before);
    expect(
      (
        await runtime.query(
          'SELECT publication_id FROM struinfo.document_publication_version WHERE workspace_id=$1',
          [f.w],
        )
      ).rows,
    ).toHaveLength(0);
    expect(await f.knowledge.loadCurrentEntries(f.w, false)).toHaveLength(0);
    await f.confirm();
    expect(await f.knowledge.loadCurrentEntries(f.w, false)).toHaveLength(1);
  });

  it('withdraws rejected or private content without exposing draft fallback and rejects cross-workspace confirmation', async () => {
    const f = await fixture();
    await f.prepare();
    await f.confirm();
    await expect(
      f.publication.confirm(ExecutionAuthority.owner(randomUUID()), {
        snapshotId: f.snapshotId,
        expectedEntries: [],
      }),
    ).rejects.toMatchObject({code: 'workspace_mismatch'});
    await f.intake.receive(
      [
        {
          snapshotId: f.snapshotId,
          expectedVersion: required(await f.intakeRepo.read(f.snapshotId))
            .version,
        },
      ],
      'reject',
    );
    expect(await f.knowledge.loadCurrentEntries(f.w, false)).toHaveLength(0);
    await expect(f.confirm()).rejects.toMatchObject({
      code: 'document_not_admitted',
    });
    await f.intake.receive(
      [
        {
          snapshotId: f.snapshotId,
          expectedVersion: required(await f.intakeRepo.read(f.snapshotId))
            .version,
        },
      ],
      'accept',
    );
    expect(await f.knowledge.loadCurrentEntries(f.w, false)).toHaveLength(1);
    const resource = required(
      await f.repo.evidenceRead.loadSnapshot(f.w, f.snapshotId),
    ).resourceId;
    await admin.query(
      'UPDATE struinfo.resource SET is_private=true WHERE workspace_id=$1 AND resource_id=$2',
      [f.w, resource],
    );
    expect(await f.knowledge.loadCurrentEntries(f.w, false)).toHaveLength(0);
    await expect(
      f.publication.confirm(f.owner, {
        snapshotId: f.snapshotId,
        expectedEntries: [],
      }),
    ).rejects.toMatchObject({code: 'private_model_transfer_forbidden'});
    expect(
      (await f.knowledge.loadCurrentEntries(f.w, true))[0]?.value.isPrivate,
    ).toBe(true);
    const confirmed = required(await f.ledger.read(f.snapshotId));
    expect(
      await f.ledger.transitionOrganization({
        publicationId: confirmed.publicationId,
        expectedVersion: 1,
        from: 'pending',
        to: 'running',
      }),
    ).toBe(false);
  });

  it('exports confirmed reading and restores deferred work paused, preserving the draft independently', async () => {
    const f = await fixture();
    const prepared = await f.prepare();
    const initial = required(prepared.entries[0]);
    const quote = 'Confirmed alpha knowledge.';
    const start = Array.from(
      initial.value.body.slice(0, initial.value.body.indexOf(quote)),
    ).length;
    const annotations = {
      schemaVersion: 1 as const,
      vocabularyRevision: 0,
      dimensions: [],
      inputRevision: initial.revision,
      inputBodySha256: initial.value.bodySha256,
      origin: 'ai' as const,
      originVersion: 'synthetic.v1',
      status: 'complete' as const,
      note: '',
      readingState: 'unread' as const,
      labels: [],
      claims: [
        {
          statement: 'Synthetic alpha knowledge',
          speaker: 'Synthetic author',
          stance: 'reports' as const,
          conditions: '',
          time: '',
          evidence: {start, end: start + quote.length, quote},
        },
      ],
    };
    const tags = new AiTagProposalService({
      workspaceId: f.w,
      entries: f.repo.informationEntries,
      processing: f.repo.processingRuns,
      provider: {
        providerKey: 'deepseek-responses-v1',
        model: 'synthetic-no-network',
        promptVersion: 'synthetic.v1',
        proposeTags: () =>
          Promise.resolve({
            summary: 'Synthetic annotations',
            contentKeywords: [],
            typeKeyword: 'knowledge_explanation',
            domains: [],
            annotations,
          }),
      },
    });
    await tags.start(initial.entryId, 'p4-backup');
    const proposal = required((await tags.listForEntry(initial.entryId))[0]);
    expect(proposal.tagPayload?.annotations).toEqual(annotations);
    await tags.accept(initial.entryId, proposal.proposalId);
    await f.confirm();
    const entry = required(
      (await f.repo.informationEntries.loadCurrentEntries(f.w, false))[0],
    );
    await f.entriesFor(f.owner).revise(entry.entryId, {
      expectedRevision: entry.revision,
      includePrivate: false,
      annotation: {
        body: 'Unconfirmed replacement.',
        contentKeywords: ['replacement'],
        typeKeyword: 'knowledge_explanation',
        domains: [{keyword: 'engineering_computing'}],
      },
    });
    const topicRepo = new PostgresTopicRepository(runtime, f.w);
    const topicId = randomUUID(),
      jobId = randomUUID();
    const topicValue: TopicValue = {
      kind: 'topic',
      name: 'Synthetic topic',
      scope: 'Alpha',
      origin: 'manual',
      members: [
        {
          entryId: entry.entryId,
          revision: entry.revision,
          quote: 'alpha',
          reason: 'synthetic',
          decision: 'pinned',
          origin: 'manual',
        },
      ],
      relations: [],
      summary: '',
      summaryVersions: [],
      ruleVersion: 'topics.v1',
    };
    const topicInput: TopicInput = {
      ruleVersion: 'topics.v1',
      scope: topicScopeSchema.parse({entryId: entry.entryId}),
      vocabularyRevision: 0,
      entries: [
        {
          entryId: entry.entryId,
          revision: entry.revision,
          snapshotId: entry.snapshotId,
          source: 'synthetic',
          publishedAt: null,
          title: entry.value.titlePath,
          body: entry.value.body,
          labels: [],
        },
      ],
      topics: [],
      protectedPairs: [],
    };
    expect(
      await topicRepo.save([
        {id: topicId, expectedVersion: 0, value: topicValue},
        {
          id: jobId,
          expectedVersion: 0,
          value: {
            kind: 'job',
            input: topicInput,
            fingerprint: topicFingerprint(topicInput),
            candidates: [],
            budgetId: 'synthetic-backup',
            status: 'queued',
            attempts: 0,
            maxAttempts: 1,
            usage: [],
            appliedTopicIds: [],
          },
        },
      ]),
    ).toBe(true);
    const research = new PostgresResearchRepository(runtime, f.w);
    const settingsId = randomUUID(),
      scheduleId = randomUUID(),
      runId = randomUUID();
    const schedule = scheduleSchema.parse({
      name: 'Synthetic P6',
      enabled: true,
      timeZone: 'UTC',
      localTime: '09:00',
      cadence: 'daily',
      missed: 'once',
      publish: false,
      request: {
        kind: 'daily',
        composition: 'collection',
        date: '2040-01-02',
        timeZone: 'UTC',
      },
    });
    expect(
      await research.save([
        {
          id: settingsId,
          expectedVersion: 0,
          value: {
            kind: 'settings',
            settings: researchSettingsSchema.parse({enabled: true}),
            watchSince: '2040-01-01T00:00:00.000Z',
          },
        },
        {
          id: scheduleId,
          expectedVersion: 0,
          value: {
            kind: 'schedule',
            schedule,
            activatedAt: '2040-01-01T00:00:00.000Z',
          },
        },
        {
          id: runId,
          expectedVersion: 0,
          value: {
            kind: 'run',
            scheduleId,
            scheduleVersion: 1,
            slot: '2040-01-03T09:00',
            cutoff: '2040-01-03T09:00:00.000Z',
            request: schedule.request,
            publish: false,
            status: 'queued',
          },
        },
      ]),
    ).toBe(true);
    expect(
      await research.save([
        {
          id: scheduleId,
          expectedVersion: 0,
          value: {
            kind: 'schedule',
            schedule,
            activatedAt: '2040-01-01T00:00:00.000Z',
          },
        },
      ]),
    ).toBe(false);
    const transfer = new PostgresM1cDomainTransferRepository(runtime);
    const bundle = await transfer.exportWorkspace(f.w);
    expect(bundle.processing.schemaVersion).toBe('struinfo.m1e-processing.v19');
    expect(
      bundle.processing.tables.find(
        (t) => t.name === 'processing_tag_annotation_payload',
      )?.rows,
    ).toHaveLength(1);
    // A second disposable database receives the original workspace identity.
    await admin.query(
      'CREATE DATABASE struinfo_p1_restore OWNER struinfo_test',
    );
    const connection = {
      host: '127.0.0.1',
      port: Number(port),
      database: 'struinfo_p1_restore',
      user: 'struinfo_test',
      password: 'synthetic-test-only',
      ssl: false as const,
      application_name: 'struinfo-p1-restore',
      options: POSTGRES_STARTUP_OPTIONS,
    };
    await executeMigrations({
      config: {connection},
      migrationRoots: [resolve('apps/server/migrations')],
      fileSystem: new NodeMigrationFileSystem(),
      connector: new PgMigrationConnector(),
      logger: {
        write() {
          /* Outcomes only; no credentials. */
        },
      },
    });
    const restored = createNodePostgresPool(connection);
    try {
      await new PostgresM1cDomainTransferRepository(
        restored,
      ).restoreEmptyWorkspace(f.w, bundle);
      const ledger = new PostgresDocumentPublicationRepository(restored, f.w);
      expect((await ledger.read(f.snapshotId))?.organization).toMatchObject({
        status: 'paused',
        errorCode: 'restore_resume_required',
      });
      expect(
        (await ledger.loadPublished(f.w, false)).entries[0]?.value.body,
      ).toContain('alpha');
      expect(
        (await ledger.loadPublished(f.w, false)).entries[0]?.value.annotations,
      ).toEqual(annotations);
      const restoredResearch = new PostgresResearchRepository(restored, f.w);
      expect((await restoredResearch.read(settingsId))?.value).toMatchObject({
        kind: 'settings',
        settings: {enabled: false, notices: {enabled: false}},
      });
      expect((await restoredResearch.read(scheduleId))?.value).toMatchObject({
        kind: 'schedule',
        schedule: {enabled: false},
      });
      expect((await restoredResearch.read(runId))?.value).toMatchObject({
        kind: 'run',
        status: 'paused',
        errorCode: 'restore_resume_required',
      });
      const restoredTopics = new PostgresTopicRepository(restored, f.w);
      expect((await restoredTopics.read(topicId))?.value).toEqual(topicValue);
      expect((await restoredTopics.read(jobId))?.value).toMatchObject({
        status: 'paused',
        errorCode: 'restore_resume_required',
        attempts: 0,
      });
      const restoredRepo = createPostgresRepositories(restored);
      expect(
        (
          await restoredRepo.informationEntries.loadCurrentEntries(f.w, false)
        )[0]?.value.annotations,
      ).toEqual(annotations);
      expect(
        (
          await restoredRepo.processingRuns.listTagProposalsForEntry(
            f.w,
            entry.entryId,
            20,
          )
        )[0]?.tagPayload?.annotations,
      ).toEqual(annotations);
      expect(
        (
          await createPostgresRepositories(
            restored,
          ).informationEntries.loadCurrentEntries(f.w, false)
        )[0]?.value.body,
      ).toContain('replacement');
    } finally {
      await restored.end();
    }
  }, 60000);
});
