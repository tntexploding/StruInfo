import {ReportService} from '../apps/server/src/application/report_service.js';
import {ReportCommands} from '../apps/server/src/application/report_commands.js';
import {reportRequestSchema} from '../apps/server/src/application/report_contract.js';
import {PostgresReportRepository} from '../apps/server/src/platform/database/postgresql/postgres_report_repository.js';
import assert from 'node:assert/strict';
import {
  DocumentPublicationService,
  publishedEntryRepository,
  unpublishedSnapshots,
} from '../apps/server/src/application/document_publication.js';
import {DocumentIntakeService} from '../apps/server/src/application/document_intake_service.js';
import {PostgresDocumentIntakeRepository} from '../apps/server/src/platform/database/postgresql/postgres_document_intake_repository.js';
import {PostgresM1cDomainTransferRepository} from '../apps/server/src/platform/database/postgresql/postgres_workspace_transfer_repository.js';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, relative, isAbsolute, sep} from 'node:path';
import {AgentTaskActions} from '../apps/server/src/application/agent_task_actions.js';
import {AgentTaskService} from '../apps/server/src/application/agent_task_service.js';
import {AgentCaptureService} from '../apps/server/src/application/agent_capture_service.js';
import {AgentCommands} from '../apps/server/src/application/agent_commands.js';
import {DocumentUseCases} from '../apps/server/src/application/document_use_cases.js';
import {EntryUseCases} from '../apps/server/src/application/entry_use_cases.js';
import {RelationUseCases} from '../apps/server/src/application/relation_use_cases.js';
import {
  ExecutionAuthority,
  DELEGATED_READ_OPERATIONS,
} from '../apps/server/src/application/execution_authority.js';
import {IngestionService} from '../apps/server/src/application/ingestion_service.js';
import {
  ingestionSettingsSchema,
  INGESTION_ACTOR_ID,
  ingestionTaskKey,
  type IngestionOrigin,
} from '../apps/server/src/application/ingestion_contract.js';
import {AiSplitProposalService} from '../apps/server/src/modules/processing/ai_split_proposal_service.js';
import {AiSplitProposalProviderError} from '../apps/server/src/modules/processing/ai_split_proposal.js';
import {AiTagProposalService} from '../apps/server/src/modules/processing/ai_tag_proposal_service.js';
import {AiAssociationProposalService} from '../apps/server/src/modules/processing/ai_association_proposal_service.js';
import {SourceSubscriptionService} from '../apps/server/src/modules/subscriptions/source_subscription.js';
import {importMarkdownEvidence} from '../apps/server/src/modules/evidence/index.js';
import {LocalFilesystemBlobStore} from '../apps/server/src/platform/storage/local_filesystem_blob_store.js';
import {initializeLocalDataRoot} from '../apps/server/src/platform/storage/local_data_root.js';
import {LocalReviewPreferencesStore} from '../apps/server/src/platform/storage/local_review_preferences_store.js';
import {NodeMigrationFileSystem} from '../apps/server/src/platform/database/migrations/migration_files.js';
import {PgMigrationConnector} from '../apps/server/src/platform/database/migrations/postgres_migration_connection.js';
import {executeMigrations} from '../apps/server/src/platform/database/migrations/migration_runner.js';
import {
  createNodePostgresPool,
  createPostgresRepositories,
} from '../apps/server/src/platform/database/postgresql/index.js';
import {POSTGRES_STARTUP_OPTIONS} from '../apps/server/src/platform/database/postgresql/postgres_connection_config.js';
import {PostgresAgentTaskRepository} from '../apps/server/src/platform/database/postgresql/postgres_agent_task_repository.js';
import {PostgresEvidenceRepository} from '../apps/server/src/platform/database/postgresql/postgres_evidence_repository.js';
import {
  PostgresIngestionRepository,
  recordIngestionCapture,
} from '../apps/server/src/platform/database/postgresql/postgres_ingestion_repository.js';
import {preparePgBossSchema} from '../apps/server/src/queue/prepare_pg_boss_schema.js';
import {SystemPgBossFactory} from '../apps/server/src/queue/pg_boss_runtime.js';

// Explicit disposable target only. This runner never loads an owner's runtime configuration.
const [portText, database, container, outputText] = process.argv.slice(2);
assert(
  portText && database && container && outputText,
  'port database container external-output required',
);
assert(/^struinfo_ai_smoke(?:_\d+)?$/u.test(database));
assert(/^struinfo-ai-closure-[a-z0-9-]+$/u.test(container));
const output = resolve(outputText),
  rel = relative(process.cwd(), output);
assert(
  isAbsolute(outputText) &&
    (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)),
  'output must be outside repository',
);
const port = Number(portText);
assert(Number.isInteger(port) && port > 0 && port < 65536);
const connection = {
  host: '127.0.0.1',
  port,
  database,
  user: 'struinfo_test',
  password: 'synthetic-test-only',
  ssl: false as const,
  application_name: 'struinfo-ai-synthetic-smoke',
  options: POSTGRES_STARTUP_OPTIONS,
};
const admin = createNodePostgresPool(connection);
let runtime: ReturnType<typeof createNodePostgresPool> | undefined;
const services: AgentTaskService[] = [];
const checks: string[] = [];
const reportServices: ReportService[] = [];
const mark = (name: string) => {
  checks.push(name);
  process.stdout.write(name + '\n');
};
try {
  assert.equal(
    (await admin.query("SELECT to_regnamespace('struinfo') AS schema")).rows[0]
      ?.schema,
    null,
    'database must be empty',
  );
  const migrations = {
    config: {connection},
    migrationRoots: [resolve('apps/server/migrations')],
    fileSystem: new NodeMigrationFileSystem(),
    connector: new PgMigrationConnector(),
    logger: {
      write() {
        /* Synthetic runner reports only high-level outcomes. */
      },
    },
  };
  assert.equal((await executeMigrations(migrations)).outcome, 'applied');
  assert.equal((await executeMigrations(migrations)).outcome, 'noop');
  await preparePgBossSchema({factory: new SystemPgBossFactory(), pool: admin});
  if (
    !(
      await admin.query(
        "SELECT 1 FROM pg_roles WHERE rolname='struinfo_tm2_runtime'",
      )
    ).rows.length
  )
    await admin.query(
      "CREATE ROLE struinfo_tm2_runtime LOGIN PASSWORD 'synthetic-test-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
    );
  const sql = await readFile(
    resolve('deploy/postgresql/apply-runtime-grants.sql'),
    'utf8',
  );
  execFileSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'struinfo_test', '-d', database],
    {input: sql, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000},
  );
  runtime = createNodePostgresPool({
    ...connection,
    user: 'struinfo_tm2_runtime',
  });
  assert.equal(
    (await runtime.query('SELECT current_user AS role')).rows[0]?.role,
    'struinfo_tm2_runtime',
  );
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::integer AS total FROM struinfo_meta.schema_migrations',
      )
    ).rows[0]?.total,
    39,
  );
  mark('39 migrations replay safely; restricted runtime grants applied');

  await mkdir(output, {recursive: true});
  const layout = await initializeLocalDataRoot(output);
  const blobStore = await LocalFilesystemBlobStore.open(layout.areaRoots.blobs);
  const preferences = new LocalReviewPreferencesStore(
    layout.areaRoots.preferences,
  );
  const w = randomUUID(),
    sub = randomUUID(),
    privateSub = randomUUID();
  const repo = createPostgresRepositories(runtime);
  assert.equal(
    await repo.processingRuns.createRun({
      workspaceId: w,
      runId: randomUUID(),
      idempotencyKey: 'synthetic-empty-workspace',
      origin: 'deterministic',
      privacyScope: 'public_only',
      initialStage: 'import',
    }),
    'applied',
  );
  const queue = new PostgresIngestionRepository(runtime, w);
  const pool = runtime;
  const captureRepo = (origin: IngestionOrigin) =>
    new PostgresEvidenceRepository(pool, (client, capture) =>
      recordIngestionCapture(client, capture, origin),
    );
  const sourceText =
    '# Synthetic A\n\nSynthetic alpha evidence.\n\n# Synthetic B\n\nSynthetic beta evidence.\n';
  const subscriptions = new SourceSubscriptionService({
    workspaceId: w,
    preferences,
    processing: repo.processingRuns,
    blobStore,
    evidence: repo.evidence,
    reader: {
      read: () =>
        Promise.resolve({
          commitSha: 'a'.repeat(40),
          sourceUtf8: new TextEncoder().encode(sourceText),
          canonicalUri:
            'https://github.com/synthetic/synthetic/blob/main/synthetic.md',
        }),
    },
    evidenceForSubscription: (id) =>
      captureRepo({kind: 'subscription', subscriptionId: id}),
    ownsAutomaticSnapshot: async (id) => Boolean(await queue.read(id)),
  });
  const capture = new AgentCaptureService(w, {
    blobStore,
    evidence: captureRepo({kind: 'upload'}),
    evidenceRead: repo.evidenceRead,
    subscriptions,
  });
  const owner = ExecutionAuthority.owner(w);
  async function settled(service: AgentTaskService) {
    for (let i = 0; i < 200; i++) {
      const active = await Promise.all(
        (await service.list(owner)).map((t) => service.read(owner, t.taskId)),
      );
      if (!active.some((t) => t.runtimeStatus === 'running')) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('synthetic task did not settle');
  }
  const readOnly = ExecutionAuthority.agent(
    w,
    'read-only',
    DELEGATED_READ_OPERATIONS,
  );
  const agent = ExecutionAuthority.agent(w, 'synthetic-agent', [
    ...DELEGATED_READ_OPERATIONS,
    'sources.capture',
    'agent.split',
    'agent.tags',
    'agent.relations',
    'tasks.control',
  ]);
  const source = {
    kind: 'github_markdown' as const,
    subscriptionId: sub,
    label: 'Synthetic source',
    sourceAlias: 'synthetic',
    enabled: false,
    intervalMinutes: 60,
    repositoryUri: 'https://github.com/synthetic/synthetic',
    repositoryRef: 'main',
    repositoryPath: 'synthetic.md',
    profile: 'commonmark-v1' as const,
  };
  await subscriptions.replace(0, [
    {
      ...source,
      subscriptionId: privateSub,
      isPrivate: true,
      routeAfterImport: false,
    },
  ]);
  await assert.rejects(() => capture.put(readOnly, 1, source), {
    code: 'operation_not_authorized',
  });
  await capture.put(agent, 1, source);
  assert(
    (await subscriptions.list()).subscriptions.some(
      (s) => s.subscriptionId === privateSub && s.isPrivate,
    ),
  );
  assert(
    !(await capture.list(agent)).subscriptions.some(
      (s) => s.subscriptionId === privateSub,
    ),
  );
  await assert.rejects(() => capture.put(agent, 1, source), {
    code: 'source_subscription_stale',
  });
  await assert.rejects(() => capture.check(agent, privateSub, 'private'), {
    code: 'source_owner_managed',
  });
  mark('source scope, catalog CAS and private sibling preservation');

  const receiptRepository = new PostgresDocumentIntakeRepository(runtime, w);
  let receiptCalls = 0;
  const receiptIntelligence = {
    model: 'synthetic-model',
    reviewIntake: () => {
      receiptCalls++;
      return Promise.resolve({
        decision: 'admit' as const,
        completeness: 'complete' as const,
        contentKind: 'article' as const,
        reason: 'Synthetic complete material.',
      });
    },
    planRecall: () =>
      Promise.reject(new Error('Receipt review must not recall')),
  };
  const receiptIntake = new DocumentIntakeService({
    provider: receiptIntelligence,
    workspaceId: w,
    repository: receiptRepository,
    evidence: repo.evidenceRead,
    capture: repo.evidence,
    blobStore,
    readWeb: () =>
      Promise.reject(new Error('Synthetic receipt must not fetch')),
    assertBodyChangeAllowed: async (ids) => {
      assert(
        !(await repo.informationEntries.loadCurrentEntries(w, false)).some(
          (entry) => ids.includes(entry.snapshotId),
        ),
      );
    },
  });
  const taskRepo = new PostgresAgentTaskRepository(runtime);
  const publication = new DocumentPublicationService(
    w,
    receiptRepository,
    receiptIntake,
    repo.informationEntries,
    () => taskRepo.listPublicationTasks(w),
  );
  const knowledgeEntries = publishedEntryRepository(
    repo.informationEntries,
    async (entries) =>
      unpublishedSnapshots(
        await receiptRepository.list(),
        await taskRepo.listPublicationTasks(w),
        entries,
      ),
  );
  const common = {
    publication,
    intelligence: receiptIntelligence,
    intake: receiptIntake,
    workspaceId: w,
    evidence: repo.evidenceRead,
    entries: repo.informationEntries,
    associations: repo.informationEntryAssociations,
    processing: repo.processingRuns,
    associationProcessing: repo.aiAssociationProposals,
    splitProcessing: repo.processingRuns,
    blobStore,
  };
  let failSplit = false,
    providerCalls = 0;
  const metadata = {
    providerKey: 'openai-responses-v1' as const,
    model: 'synthetic-model',
    promptVersion: 'synthetic-v1',
  };
  const split = new AiSplitProposalService({
    ...common,
    provider: {
      ...metadata,
      proposeSplit: (sections) => {
        providerCalls++;
        if (failSplit)
          return Promise.reject(
            new AiSplitProposalProviderError('ai_provider_unavailable'),
          );
        return Promise.resolve({
          summary: 'Synthetic partition',
          groups: sections.map((s) => ({
            titlePath: 'Synthetic ' + s.ordinal.toString(),
            startOrdinal: s.ordinal,
            endOrdinal: s.ordinal,
          })),
        });
      },
    },
  });
  const tagResult = {
    summary: 'Synthetic tags',
    contentKeywords: ['synthetic'],
    typeKeyword: 'knowledge_explanation' as const,
    domains: [{keyword: 'engineering_computing' as const}],
  };
  const tags = new AiTagProposalService({
    ...common,
    provider: {
      ...metadata,
      proposeTags: () => {
        providerCalls++;
        return Promise.resolve(tagResult);
      },
    },
  });
  const relations = new AiAssociationProposalService({
    ...common,
    processing: repo.aiAssociationProposals,
    provider: {
      ...metadata,
      proposeAssociation: () => {
        providerCalls++;
        return Promise.resolve({
          summary: 'Synthetic link',
          relationLabel: 'related',
          direction: 'symmetric' as const,
        });
      },
    },
  });
  const tasks = new AgentTaskService(
    w,
    taskRepo,
    new AgentTaskActions({...common, split, tags, relations}),
    (t) => ingestion.guard(t),
  );
  services.push(tasks);
  const auto = ExecutionAuthority.automation(w, INGESTION_ACTOR_ID);
  const ingestion: IngestionService = new IngestionService(
    w,
    queue,
    {
      start: (snapshotId, policy) =>
        tasks.start(auto, ingestionTaskKey(snapshotId), {
          kind: 'document',
          snapshotId,
          maxEntries: policy.settings.maxEntries,
          maxRelations: policy.settings.maxRelations,
          maxModelCalls: policy.settings.maxModelCalls,
          intake: policy.settings.intake ?? {fetchFullText: true},
        }),
      read: (id) => tasks.read(auto, id),
      resume: (t) => tasks.control(auto, t.taskId, t.version, 'resume'),
      cancel: (t) => tasks.control(auto, t.taskId, t.version, 'cancel'),
    },
    () => metadata.model,
    async () => (await subscriptions.list()).subscriptions,
  );
  const policy = await ingestion.savePolicy(owner, 0, {
    ...ingestionSettingsSchema.parse({}),
    enabled: true,
    manualUploads: true,
    paused: true,
    intake: {fetchFullText: false},
    model: metadata.model,
    subscriptionIds: [sub],
    maxEntries: 12,
    maxRelations: 2,
    maxModelCalls: 20,
  });
  assert(policy);
  const imported = await capture.check(agent, sub, 'first');
  assert(imported.snapshotId);
  const snapshotId = imported.snapshotId;
  assert.equal((await queue.read(snapshotId))?.status, 'pending');
  assert.equal(
    (await capture.check(agent, sub, 'first')).runId,
    imported.runId,
  );
  await ingestion.poll();
  assert.equal(providerCalls, 0);
  assert.equal((await queue.read(snapshotId))?.taskId, undefined);
  assert.equal(
    (await receiptRepository.read(snapshotId))?.value.receipt,
    'pending',
  );
  assert.equal((await queue.list(true, 25)).length, 1);
  const receiptTask = await tasks.start(owner, 'receipt-only', {
    kind: 'intake',
    snapshotId,
    expectedVersion: 1,
    intake: {fetchFullText: false},
  });
  await settled(tasks);
  assert.equal(
    (await tasks.read(owner, receiptTask.taskId)).state.status,
    'succeeded',
  );
  assert.equal(receiptCalls, 1);
  assert.equal(
    (await receiptRepository.read(snapshotId))?.value.deferProcessing,
    true,
  );
  assert.equal(
    (await repo.informationEntries.loadCurrentEntries(w, false)).filter(
      (e) => e.snapshotId === snapshotId,
    ).length,
    0,
  );
  await ingestion.poll();
  assert.equal(providerCalls, 0);
  assert.equal((await queue.read(snapshotId))?.taskId, undefined);
  assert.equal((await queue.list(true, 25)).length, 0);
  const decision = await receiptIntake.receive(
    [{snapshotId, expectedVersion: 3}],
    'accept',
  );
  assert.equal(decision.failed.length, 0);
  assert.equal(decision.records[0]?.value.decision, 'admitted');
  assert.equal(decision.records[0].value.deferProcessing, undefined);
  await ingestion.savePolicy(owner, policy.revision, {
    ...policy.settings,
    paused: false,
  });
  await ingestion.poll();
  await settled(tasks);
  await ingestion.poll();
  const completed = await queue.read(snapshotId);
  assert.equal(completed?.status, 'completed', JSON.stringify(completed));
  const entries = (
    await repo.informationEntries.loadCurrentEntries(w, false)
  ).filter((e) => e.snapshotId === snapshotId);
  assert(entries.length >= 2);
  assert.equal(
    (await receiptRepository.read(snapshotId))?.value.publication?.origin,
    'internal_ai',
  );
  assert.equal(
    (await knowledgeEntries.loadCurrentEntries(w, false)).filter(
      (e) => e.snapshotId === snapshotId,
    ).length,
    entries.length,
  );
  assert(
    entries.every(
      (e) =>
        e.revision === 2 &&
        e.value.contentKeywords.some((k) => k.normalizedValue === 'synthetic'),
    ),
  );
  const links = await repo.informationEntryAssociations.loadAssociationSnapshot(
    w,
    false,
  );
  assert(links.overrides.length > 0);
  const summary = await queue.summary();
  assert.equal(summary.admittedToday, 1);
  assert.equal(summary.counts.completed, 1);
  assert.equal(summary.modelAttempts, providerCalls);
  assert.equal((await queue.list(false, 10))[0]?.sourceLabel, 'synthetic');
  const unchanged = await capture.check(agent, sub, 'second');
  assert.equal(unchanged.outcome, 'unchanged');
  assert.equal((await queue.list(false, 100)).length, 1);
  mark(
    'subscription → inbox pending → legacy receipt-only AI acceptance → owner processing choice → durable queue → split → tags → relations → publication; replay and actual call accounting',
  );

  failSplit = true;
  const failure = await capture.importText(agent, {
    requestKey: 'failure',
    title: 'Synthetic retry',
    markdown: sourceText,
  });
  assert('snapshotId' in failure);
  await ingestion.poll();
  await settled(tasks);
  await ingestion.poll();
  const attention = await queue.read(failure.snapshotId);
  assert.equal(attention?.status, 'attention');
  assert(attention);
  failSplit = false;
  await ingestion.control(
    owner,
    failure.snapshotId,
    attention.version,
    'retry',
  );
  await ingestion.poll();
  await settled(tasks);
  await ingestion.poll();
  assert.equal((await queue.read(failure.snapshotId))?.status, 'completed');
  assert.equal(
    (await receiptRepository.read(failure.snapshotId))?.value.receipt,
    'accepted',
  );
  assert.equal(
    (await receiptRepository.read(failure.snapshotId))?.value.publication
      ?.origin,
    'internal_ai',
  );
  mark(
    'new pending receipt runs unified AI review; provider failure retains capture; explicit retry reuses the task and publishes',
  );

  const saved = await queue.policy();
  await ingestion.savePolicy(owner, saved.revision, {
    ...saved.settings,
    enabled: false,
  });
  const externalTasks = new AgentTaskService(
    w,
    taskRepo,
    new AgentTaskActions(common),
  );
  services.push(externalTasks);
  const useCases = {
    knowledgeEntries,
    documentIntakeRepository: receiptRepository,
    blobStore,
    evidenceReadRepository: repo.evidenceRead,
    informationEntryRepository: repo.informationEntries,
    informationDocumentTagRepository: repo.informationDocumentTags,
    informationDocumentWorkingCopyRepository:
      repo.informationDocumentWorkingCopies,
    informationEntryAssociationRepository: repo.informationEntryAssociations,
    reviewPreferences: preferences,
  };
  const commands = new AgentCommands(agent, {
    documents: new DocumentUseCases(agent, useCases),
    entries: new EntryUseCases(agent, useCases),
    relations: new RelationUseCases(agent, useCases),
    tasks: externalTasks,
    capture,
    publication,
  });
  const external = await capture.importText(agent, {
    requestKey: 'external',
    title: 'Synthetic external',
    markdown: sourceText,
  });
  assert('snapshotId' in external);
  assert.equal(
    (
      await capture.importText(agent, {
        requestKey: 'external',
        title: 'Synthetic external',
        markdown: sourceText,
      })
    ).status,
    'existing',
  );
  await assert.rejects(() =>
    capture.importText(agent, {
      requestKey: 'external',
      title: 'Synthetic external',
      markdown: sourceText + 'changed',
    }),
  );
  const doc = await new DocumentUseCases(agent, useCases).read(
    external.snapshotId,
  );
  assert.equal(doc.snapshot.structures[0]?.normalizedText, sourceText);
  const sections = await new DocumentUseCases(agent, useCases).sections(
    external.snapshotId,
  );
  const partition = {
    kind: 'split' as const,
    snapshotId: external.snapshotId,
    result: {
      summary: 'External synthetic partition',
      groups: sections.sections.map((s) => ({
        titlePath: 'External ' + s.ordinal.toString(),
        startOrdinal: s.ordinal,
        endOrdinal: s.ordinal,
      })),
    },
  };
  assert.equal(
    (
      await receiptIntake.receive(
        [{snapshotId: external.snapshotId, expectedVersion: 1}],
        'accept',
      )
    ).failed.length,
    0,
  );
  const externalRun = await externalTasks.start(
    agent,
    'external-split',
    partition,
  );
  await settled(externalTasks);
  assert.equal(
    (await externalTasks.read(agent, externalRun.taskId)).state.status,
    'succeeded',
  );
  assert.equal(
    (await externalTasks.start(agent, 'external-split', partition)).taskId,
    externalRun.taskId,
  );
  const externalEntries = (
    await repo.informationEntries.loadCurrentEntries(w, false)
  ).filter((e) => e.snapshotId === external.snapshotId);
  assert.equal(externalEntries.length, sections.sections.length);
  const first = externalEntries[0],
    second = externalEntries[1];
  assert(first && second);
  const tagging = {
    kind: 'tags' as const,
    entryId: first.entryId,
    expectedRevision: first.revision,
    result: tagResult,
  };
  const tagTask = await externalTasks.start(agent, 'external-tag', tagging);
  await settled(externalTasks);
  assert.equal(
    (await externalTasks.read(agent, tagTask.taskId)).state.status,
    'succeeded',
  );
  await assert.rejects(() => externalTasks.start(agent, 'stale-tag', tagging), {
    code: 'stale_entry_revision',
  });
  const linkTask = await externalTasks.start(agent, 'external-relation', {
    kind: 'relation',
    entryId: first.entryId,
    relatedEntryId: second.entryId,
    expectedRevision: 2,
    expectedRelatedRevision: 1,
    expectedOverrideRevision: 0,
    result: {
      summary: 'Synthetic external relation',
      relationLabel: 'related',
      direction: 'symmetric',
    },
  });
  await settled(externalTasks);
  assert.equal(
    (await externalTasks.read(agent, linkTask.taskId)).state.status,
    'succeeded',
  );
  assert.equal(
    (await externalTasks.read(agent, linkTask.taskId)).state.calls,
    0,
  );
  await assert.rejects(
    () => commands.execute('entry_read', {entryId: first.entryId}),
    {code: 'information_entry_not_found'},
  );
  await commands.execute('document_publish', {
    snapshotId: external.snapshotId,
    expectedEntries: (
      await repo.informationEntries.loadCurrentEntries(w, false)
    )
      .filter((entry) => entry.snapshotId === external.snapshotId)
      .map((entry) => ({entryId: entry.entryId, revision: entry.revision})),
  });
  assert(
    await commands.execute('entries_search', {
      text: 'synthetic',
      textMode: 'substring',
      limit: 2,
    }),
  );
  assert(await commands.execute('entry_read', {entryId: first.entryId}));
  assert(await commands.execute('documents_list', {limit: 1}));
  mark(
    'external Agent independently captures, splits, tags, relates and searches with internal model absent',
  );

  const invalid = await capture.importText(agent, {
    requestKey: 'bad-split',
    title: 'Synthetic invalid partition',
    markdown: sourceText,
  });
  assert('snapshotId' in invalid);
  assert.equal(
    (
      await receiptIntake.receive(
        [{snapshotId: invalid.snapshotId, expectedVersion: 1}],
        'accept',
      )
    ).failed.length,
    0,
  );
  const bad = await externalTasks.start(agent, 'invalid-partition', {
    kind: 'split',
    snapshotId: invalid.snapshotId,
    result: {
      summary: 'Invalid',
      groups: [{titlePath: 'Invalid', startOrdinal: 0, endOrdinal: 63}],
    },
  });
  await settled(externalTasks);
  assert.equal(
    (await externalTasks.read(agent, bad.taskId)).state.status,
    'failed',
  );
  assert(
    !(await repo.informationEntries.loadCurrentEntries(w, false)).some(
      (e) => e.snapshotId === invalid.snapshotId,
    ),
  );
  const privateId = randomUUID(),
    resourceId = randomUUID();
  const privateCapture = await importMarkdownEvidence(
    {blobStore, evidenceRepository: captureRepo({kind: 'upload'})},
    {
      workspaceId: w,
      commandIdempotencyKey: 'synthetic-private',
      resource: {
        workspaceId: w,
        resourceId,
        resourceKind: 'manual_text',
        sourceKey: 'Synthetic private',
        isPrivate: true,
      },
      snapshot: {
        workspaceId: w,
        resourceId,
        snapshotId: privateId,
        mediaType: 'text/markdown',
        capturedAt: new Date().toISOString(),
      },
      gitObservations: [],
      profile: 'commonmark-v1',
      sourceUtf8: new TextEncoder().encode(sourceText),
    },
  );
  assert.equal(
    privateCapture.status,
    'created',
    JSON.stringify(privateCapture),
  );
  assert.equal(await queue.read(privateId), undefined);
  await assert.rejects(
    () => commands.execute('document_sections', {snapshotId: privateId}),
    {code: 'private_content_requires_opt_in'},
  );
  await assert.rejects(
    () =>
      externalTasks.start(agent, 'private-split', {
        ...partition,
        snapshotId: privateId,
      }),
    {code: 'private_model_transfer_forbidden'},
  );
  await assert.rejects(
    () =>
      externalTasks.start(readOnly, 'denied', {
        ...partition,
        snapshotId: privateId,
      }),
    {code: 'operation_not_authorized'},
  );
  mark(
    'invalid partition writes no entries; private content and missing grants rejected',
  );
  const intakeRepository = new PostgresDocumentIntakeRepository(runtime, w);
  let fullFetches = 0;
  const syntheticIntelligence = {
    model: metadata.model,
    reviewIntake: () =>
      Promise.resolve({
        completeness: 'complete' as const,
        contentKind: 'article' as const,
        decision: 'admit' as const,
        reason: 'Complete synthetic article',
      }),
    planRecall: () =>
      Promise.resolve({
        concepts: [{term: 'Synthetic', variants: ['synthetic', '合成']}],
      }),
  };
  const intake = new DocumentIntakeService({
    workspaceId: w,
    repository: intakeRepository,
    evidence: repo.evidenceRead,
    capture: repo.evidence,
    blobStore,
    provider: syntheticIntelligence,
    assertBodyChangeAllowed: async (ids) => {
      assert.equal(
        (await repo.informationEntries.loadCurrentEntries(w, true)).some(
          (entry) => ids.includes(entry.snapshotId),
        ),
        false,
      );
    },
    readWeb: () => {
      fullFetches++;
      return Promise.resolve({
        status: 'changed',
        cursor: 'synthetic',
        documents: [
          {
            externalId: 'synthetic-page',
            version: 'v1',
            canonicalUri: 'https://example.invalid/intake',
            mediaType: 'text/html',
            profile: 'commonmark-v1',
            sourceUtf8: new TextEncoder().encode(
              '# Synthetic full article\n\nComplete synthetic evidence and context.\n',
            ),
            rawSourceBytes: new TextEncoder().encode(
              '<article><h1>Synthetic full article</h1><p>Complete synthetic evidence and context.</p></article>',
            ),
          },
        ],
      });
    },
  });
  const intakeSource = randomUUID(),
    intakeResource = randomUUID();
  assert.equal(
    (
      await importMarkdownEvidence(
        {blobStore, evidenceRepository: repo.evidence},
        {
          workspaceId: w,
          commandIdempotencyKey: 'intake-synthetic-feed',
          resource: {
            workspaceId: w,
            resourceId: intakeResource,
            resourceKind: 'remote_document',
            sourceKey: 'Synthetic intake feed',
            canonicalUri: 'https://example.invalid/intake',
          },
          snapshot: {
            workspaceId: w,
            resourceId: intakeResource,
            snapshotId: intakeSource,
            capturedAt: '2040-01-01T00:00:00.000Z',
            mediaType: 'text/markdown',
          },
          gitObservations: [],
          profile: 'commonmark-v1',
          sourceUtf8: new TextEncoder().encode(
            '# Synthetic feed title\n\nShort synthetic excerpt.\n',
          ),
        },
      )
    ).status,
    'created',
  );
  const preparationPolicy = {
    fetchFullText: true,
    blockedKinds: [],
    preferredTopics: [],
    excludedTopics: [],
  };
  const firstCapture = await intake.prepare(intakeSource, preparationPolicy);
  assert(firstCapture?.value.preparedSnapshotId);
  const receivedChoice = await intake.prepare(intakeSource, preparationPolicy, {
    source: 'received',
    refresh: false,
    expectedVersion: firstCapture.version,
  });
  assert.equal(receivedChoice?.value.bodySource, 'received');
  assert.equal(receivedChoice.value.decision, 'pending');
  const refreshedCapture = await intake.prepare(
    intakeSource,
    preparationPolicy,
    {
      source: 'web_article',
      refresh: true,
      expectedVersion: receivedChoice.version,
    },
  );
  assert(refreshedCapture?.value.preparedSnapshotId);
  assert.notEqual(
    refreshedCapture.value.preparedSnapshotId,
    firstCapture.value.preparedSnapshotId,
  );
  assert.deepEqual(refreshedCapture.value.previousPreparedSnapshotIds, [
    firstCapture.value.preparedSnapshotId,
  ]);
  assert.equal(
    await intake.guard(firstCapture.value.preparedSnapshotId),
    'intake_body_not_selected',
  );
  const intakeTasks = new AgentTaskService(
    w,
    taskRepo,
    new AgentTaskActions({
      ...common,
      split,
      tags,
      relations,
      intake,
      intelligence: syntheticIntelligence,
    }),
  );
  services.push(intakeTasks);
  const intakeTask = await intakeTasks.start(owner, 'intake-recall-smoke', {
    kind: 'document',
    snapshotId: intakeSource,
    intake: {fetchFullText: true},
    maxRelationCandidates: 3,
    maxRelations: 1,
    maxModelCalls: 12,
  });
  await settled(intakeTasks);
  const intakeResult = await intakeTasks.read(owner, intakeTask.taskId);
  assert.equal(
    intakeResult.state.status,
    'succeeded',
    JSON.stringify(intakeResult.state),
  );
  const intakeRow = await intakeRepository.read(intakeSource);
  assert(intakeRow?.value.preparedSnapshotId);
  assert.equal(intakeRow.value.decision, 'admitted');
  const prepared = intakeRow.value.preparedSnapshotId;
  assert.notEqual(prepared, intakeSource);
  const intakeEntries = await repo.informationEntries.loadCurrentEntries(
    w,
    false,
  );
  assert(!intakeEntries.some((e) => e.snapshotId === intakeSource));
  assert(
    intakeEntries.some(
      (e) =>
        e.snapshotId === prepared &&
        e.value.body.includes('Complete synthetic evidence and context.'),
    ),
  );
  assert(
    intakeResult.state.steps.some(
      (step) => step.kind === 'recall' && step.recallPlan,
    ),
  );
  await intake.prepare(intakeSource, {
    fetchFullText: true,
    blockedKinds: [],
    preferredTopics: [],
    excludedTopics: [],
  });
  assert.equal(fullFetches, 2);
  assert.equal((await taskRepo.listForSnapshots(w, [intakeSource])).length, 1);
  assert.equal((await taskRepo.listForSnapshots(w, [privateId])).length, 0);
  const reports = new ReportService({
    workspaceId: w,
    repository: new PostgresReportRepository(runtime, w),
    entries: knowledgeEntries,
    evidence: repo.evidenceRead,
    intake,
    provider: {
      model: 'synthetic-report-model',
      plan: (input) =>
        Promise.resolve({
          groups: [
            {
              title: 'Synthetic report',
              sources: input.sources.map((source) => source.handle),
              recommended: true,
            },
          ],
        }),
      summarize: (input) =>
        Promise.resolve({
          title: 'Synthetic report',
          points: [
            {
              text: 'Complete synthetic evidence and context.',
              sources: input.sources.map((source) => source.handle),
            },
          ],
        }),
    },
  });
  reportServices.push(reports);
  const report = (
    await reports.create(
      owner,
      'synthetic-report',
      reportRequestSchema.parse({
        kind: 'daily',
        date: '2040-01-01',
        timeZone: 'UTC',
      }),
    )
  ).report;
  assert.equal(report.state.sources[0]?.snapshotId, prepared);
  assert.equal(report.state.sources[0].intakeSnapshotId, intakeSource);
  await reports.generate(owner, report.reportId, report.version);
  for (
    let i = 0;
    i < 200 && (await reports.read(owner, report.reportId)).active;
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 25));
  const readyReport = (await reports.read(owner, report.reportId)).report;
  assert.equal(readyReport.state.status, 'ready');
  assert.equal(readyReport.state.calls, 2);
  const exportedReport = await new ReportCommands(readOnly, reports).execute(
    'report_export',
    {reportId: report.reportId},
  );
  assert(
    JSON.stringify(exportedReport).includes(
      'Complete synthetic evidence and context.',
    ),
  );
  await assert.rejects(
    () => reports.generate(readOnly, report.reportId, readyReport.version),
    {code: 'report_owner_required'},
  );
  mark(
    'daily report preview, bounded generation, source citations and read-only Agent export use runtime grants',
  );
  await intake.control(
    prepared,
    intakeRow.version,
    'block',
    'Synthetic manual block',
  );
  assert.equal(await intake.guard(prepared), 'intake_blocked');
  assert.equal(await intake.guard(intakeSource), 'intake_blocked');
  await assert.rejects(
    () => intake.control(intakeSource, intakeRow.version, 'admit', 'Stale'),
    {code: 'stale_intake_version'},
  );
  await assert.rejects(
    () =>
      intake.needsReview(privateId, {
        fetchFullText: true,
        blockedKinds: [],
        preferredTopics: [],
        excludedTopics: [],
      }),
    {code: 'private_model_transfer_forbidden'},
  );
  mark(
    'full-text evidence stays separate; intake CAS, private rejection and multilingual task run through runtime grants',
  );
  const transfer = new PostgresM1cDomainTransferRepository(runtime);
  const exported = await transfer.exportWorkspace(w);
  assert.equal(
    exported.processing.schemaVersion,
    'struinfo.m1e-processing.v15',
  );
  const restoredWorkspace = randomUUID();
  const relocated = JSON.parse(
    JSON.stringify(exported).replaceAll(w, restoredWorkspace),
  ) as typeof exported;
  await transfer.restoreEmptyWorkspace(restoredWorkspace, relocated);
  const restored = new PostgresDocumentIntakeRepository(
    runtime,
    restoredWorkspace,
  );
  assert.equal((await restored.read(snapshotId))?.value.receipt, 'accepted');
  const restoredReceiptTask = await new PostgresAgentTaskRepository(
    runtime,
  ).read(restoredWorkspace, receiptTask.taskId);
  assert.equal(restoredReceiptTask?.request.kind, 'intake');
  assert.equal(restoredReceiptTask.state.steps[0]?.outcome, 'accepted');
  assert.equal((await restored.read(intakeSource))?.value.decision, 'blocked');
  assert.deepEqual(
    (await restored.read(intakeSource))?.value.previousPreparedSnapshotIds,
    [firstCapture.value.preparedSnapshotId],
  );
  assert.equal(
    (await restored.read(intakeSource))?.value.preparedSnapshotId,
    prepared,
  );
  assert.equal(
    (await new PostgresIngestionRepository(runtime, restoredWorkspace).policy())
      .settings.paused,
    true,
  );
  assert.deepEqual(
    (
      await new PostgresReportRepository(runtime, restoredWorkspace).read(
        report.reportId,
      )
    )?.state,
    readyReport.state,
  );
  mark(
    'v15 database export and empty-workspace restore preserve intake links, report drafts and spent budgets; unattended processing stays paused',
  );
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(
      {
        checks,
        model: 'synthetic injected provider; no network model calls',
        providerCalls,
        entryCount: (await repo.informationEntries.loadCurrentEntries(w, false))
          .length,
      },
      null,
      2,
    ),
  );
} finally {
  for (const service of [...services, ...reportServices]) service.stop();
  await Promise.all(
    [...services, ...reportServices].map((service) => service.drain()),
  );
  await runtime?.end();
  await admin.end();
}
