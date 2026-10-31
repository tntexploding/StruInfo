import {modelUsageScope} from '../platform/ai/model_usage_scope.js';
import {SystemAssistant} from '../application/system_assistant.js';
import {createAssistantCommandTools} from '../application/assistant_tools.js';
import {createAssistantApiTools} from '../transport/assistant_api_tools.js';
import {LocalAssistantSessionStore} from '../storage/assistant_session_store.js';
import {ResponsesAssistantProvider} from '../platform/ai/responses_assistant_provider.js';
import {decodeEntrySearchBody} from '../modules/entries/information_entry_search_request.js';
import {ResearchService} from '../application/research_service.js';
import {ReportPipeline} from '../application/report_pipeline.js';
import {PostgresResearchRepository} from '../platform/database/postgresql/postgres_research_repository.js';
import {DeepSeekSearchProvider} from '../platform/ai/deepseek_search_provider.js';
import {AiWorkQueue} from '../application/ai_work_queue.js';
import {matchesAnnotationFilter} from '../modules/entries/structured_annotations.js';
import {TopicService} from '../application/topic_service.js';
import {PostgresTopicRepository} from '../platform/database/postgresql/postgres_topic_repository.js';
import {ResponsesTopicProvider} from '../platform/ai/responses_topic_provider.js';
import {AnnotationService} from '../application/annotation_service.js';
import {EMPTY_ANNOTATION_VOCABULARY} from '../modules/entries/structured_annotations.js';
import {SourceHistoryService} from '../application/source_history_service.js';
import {SourceDescriptionService} from '../application/source_description_service.js';
import {SourceSplitService} from '../application/source_split_service.js';
import {SourceDescriptionReader} from '../platform/sources/source_description_reader.js';
import {PublicSourceHistoryReader} from '../platform/sources/source_history_reader.js';
import {importSourceConnectorDocuments} from '../modules/subscriptions/source_connector.js';
import {
  DEFAULT_SOURCE_RECEIVING,
  type Reception,
} from '../modules/subscriptions/source_receiving.js';
import {SourceQualityService} from '../application/source_quality_service.js';
import {PostgresDocumentPublicationRepository} from '../platform/database/postgresql/postgres_document_publication_repository.js';
import {
  DocumentPublicationService,
  publishedEntryRepository,
  unpublishedSnapshots,
} from '../application/document_publication.js';
import {InboxPreviewService} from '../application/inbox_preview_service.js';
import {ReportService} from '../application/report_service.js';
import {PostgresReportRepository} from '../platform/database/postgresql/postgres_report_repository.js';
import {ResponsesReportProvider} from '../platform/ai/responses_report_provider.js';
import {DocumentIntakeService} from '../application/document_intake_service.js';
import {OperationError} from '../application/operation_error.js';
import {PostgresDocumentIntakeRepository} from '../platform/database/postgresql/postgres_document_intake_repository.js';
import {ResponsesDocumentIntelligenceProvider} from '../platform/ai/responses_document_intelligence_provider.js';
import {AgentCaptureService} from '../application/agent_capture_service.js';
import {IngestionService} from '../application/ingestion_service.js';
import {AiPriceService} from '../application/ai_price_service.js';
import {priceAwareFetch} from '../platform/ai/price_aware_fetch.js';
import {LocalModelUsageJournal} from '../platform/ai/model_usage_journal.js';
import {
  INGESTION_ACTOR_ID,
  ingestionTaskKey,
  type IngestionOrigin,
} from '../application/ingestion_contract.js';
import {
  PostgresIngestionRepository,
  recordIngestionCapture,
} from '../platform/database/postgresql/postgres_ingestion_repository.js';
import {PostgresEvidenceRepository} from '../platform/database/postgresql/postgres_evidence_repository.js';
import {IngestionScheduler} from '../lifecycle/ingestion_scheduler.js';
import {AgentTaskActions} from '../application/agent_task_actions.js';
import {AgentTaskService} from '../application/agent_task_service.js';
import {AgentCommands} from '../application/agent_commands.js';
import {DocumentUseCases} from '../application/document_use_cases.js';
import {EntryUseCases} from '../application/entry_use_cases.js';
import {RelationUseCases} from '../application/relation_use_cases.js';
import {
  ExecutionAuthority,
  DELEGATED_READ_OPERATIONS,
  type AgentWriteOperation,
} from '../application/execution_authority.js';
import {PostgresAgentTaskRepository} from '../platform/database/postgresql/postgres_agent_task_repository.js';
import {EntryTranslationService} from '../modules/entries/information_entry_translation.js';
import {ResponsesEntryTranslationProvider} from '../platform/ai/responses_entry_translation_provider.js';
import {EntryMarkdownExportService} from '../modules/entries/information_entry_markdown_export_service.js';
import type {RuntimeConfig} from '../config/runtime_config.js';
import {
  InformationEntryQuerySynthesisService,
  InformationEntryRetrievalService,
} from '../modules/entries/index.js';
import {
  AiAssociationProposalService,
  AiSplitProposalService,
  AiTagProposalService,
} from '../modules/processing/index.js';
import {
  SourceConnectorRegistry,
  SourceSubscriptionService,
  type GitSourceSubscriptionReaderPort,
  type SourceConnectorPort,
} from '../modules/subscriptions/index.js';
import {
  ResponsesEntryAssociationProvider,
  ResponsesEntrySplitProvider,
  ResponsesEntryTagProvider,
  ResponsesInformationEntryQuerySynthesisProvider,
  OpenAiInformationEntryEmbeddingProvider,
} from '../platform/ai/index.js';
import {
  GithubGitSourceSubscriptionReader,
  JsonApiSourceConnector,
  RssAtomSourceConnector,
  WebSourceConnector,
} from '../platform/sources/index.js';
import {
  createRuntimeDatabase,
  type DatabasePoolFactory,
} from '../database/database_readiness.js';
import {
  ReadinessGate,
  OperationalHealthService,
} from '../health/operational_health.js';
import {NodeTimerScheduler, SystemDeadline} from '../lifecycle/deadline.js';
import {
  SourceSubscriptionScheduler,
  type SourceSubscriptionSchedulerDependencies,
} from '../lifecycle/source_subscription_scheduler.js';
import {
  ProcessExitDecision,
  ProcessSignalSource,
  ShutdownCoordinator,
  type ExitDecision,
  type SignalSource,
} from '../lifecycle/shutdown_coordinator.js';
import {
  closeResourcesInReverse,
  startOwnedResources,
  toError,
  type ResourceStarter,
  type RuntimeResource,
} from '../lifecycle/runtime_resource.js';
import type {RuntimeLogger} from '../logging/structured_logger.js';
import {createLocalStorageServices} from '../platform/storage/local_storage_services.js';
import {
  createPostgresRepositories,
  type PostgresRepositorySet,
} from '../platform/database/postgresql/index.js';
import {
  createPgBossOptions,
  PgBossRuntime,
  roleUsesPgBoss,
  SystemPgBossFactory,
  type PgBossFactory,
} from '../queue/pg_boss_runtime.js';
import type {
  StorageServices,
  StorageServicesFactory,
} from '../storage/storage_services.js';
import {
  NestHealthListenerFactory,
  type HealthListenerFactory,
} from '../transport/nest_health_listener.js';
import {M1cApiService} from '../transport/m1c_api_service.js';
import {M1cWorkspaceTransfer} from '../workspace_transfer/m1c_workspace_transfer.js';

export interface StartedRoleRuntime {
  readonly workspaceId: string;
  readonly resources: readonly RuntimeResource[];
  readonly storage: Readonly<StorageServices>;
  readonly repositories: Readonly<PostgresRepositorySet>;
  readonly shutdown: ShutdownCoordinator;
  disposeSignalHandlers(): void;
}

export interface RoleRuntimeDependencies {
  readonly databasePoolFactory?: DatabasePoolFactory;
  readonly pgBossFactory?: PgBossFactory;
  readonly healthListenerFactory?: HealthListenerFactory;
  readonly signalSource?: SignalSource;
  readonly exitDecision?: ExitDecision;
  readonly storageServicesFactory?: StorageServicesFactory;
  readonly sourceSubscriptionReader?: GitSourceSubscriptionReaderPort;
  /** Trusted adapters supplied by the installed host; never loaded from prefs. */
  readonly sourceConnectors?: readonly SourceConnectorPort[];
  readonly sourceSubscriptionSchedulerStarter?: (
    dependencies: Readonly<SourceSubscriptionSchedulerDependencies>,
  ) => Promise<RuntimeResource>;
}

export async function startRoleRuntime(
  config: Readonly<RuntimeConfig>,
  logger: RuntimeLogger,
  dependencies: Readonly<RoleRuntimeDependencies> = {},
): Promise<StartedRoleRuntime> {
  const storage = await (
    dependencies.storageServicesFactory ?? createLocalStorageServices
  )(config.dataRoot);
  const deadline = new SystemDeadline(new NodeTimerScheduler());
  const database = createRuntimeDatabase(
    config,
    deadline,
    dependencies.databasePoolFactory,
  );
  const gate = new ReadinessGate();
  const repositories = createPostgresRepositories(database.pool);
  const health = new OperationalHealthService({
    role: config.role,
    gate,
    database: database.readiness,
  });
  const starters: ResourceStarter[] = [() => Promise.resolve(database)];

  if (roleUsesPgBoss(config.role)) {
    const factory = dependencies.pgBossFactory ?? new SystemPgBossFactory();
    starters.push(() =>
      PgBossRuntime.start({
        factory,
        config: createPgBossOptions(config, database.pool),
        shutdownTimeoutMs: config.shutdownTimeoutMs,
      }),
    );
  }

  const listenerFactory =
    dependencies.healthListenerFactory ?? new NestHealthListenerFactory();
  const address = listenerAddress(config);
  const aiPrice = new AiPriceService(
    config.workspaceId,
    storage.reviewPreferences,
    config.aiProposalProvider?.providerKey,
  );
  const usageJournal = new LocalModelUsageJournal(
    config.dataRoot + '/exports',
    config.workspaceId,
  );
  const sharedAiQueue = new AiWorkQueue(
    async () => (await aiPrice.executionSettings()).maxConcurrentRequests,
  );
  const modelFetch = priceAwareFetch(
    aiPrice,
    globalThis.fetch,
    usageJournal,
    sharedAiQueue,
  );
  const aiSplitProposals =
    config.aiProposalProvider === undefined
      ? undefined
      : new AiSplitProposalService({
          workspaceId: config.workspaceId,
          blobStore: storage.blobStore,
          evidence: repositories.evidenceRead,
          entries: repositories.informationEntries,
          processing: repositories.processingRuns,
          provider: new ResponsesEntrySplitProvider(
            config.aiProposalProvider,
            modelFetch,
          ),
        });
  const aiTagProposals =
    config.aiProposalProvider === undefined
      ? undefined
      : new AiTagProposalService({
          workspaceId: config.workspaceId,
          entries: repositories.informationEntries,
          processing: repositories.processingRuns,
          provider: new ResponsesEntryTagProvider(
            config.aiProposalProvider,
            modelFetch,
            async () =>
              (await storage.reviewPreferences.load(config.workspaceId))
                .annotationVocabulary ?? EMPTY_ANNOTATION_VOCABULARY,
          ),
        });
  const aiAssociationProposals =
    config.aiProposalProvider === undefined
      ? undefined
      : new AiAssociationProposalService({
          workspaceId: config.workspaceId,
          entries: repositories.informationEntries,
          associations: repositories.informationEntryAssociations,
          processing: repositories.aiAssociationProposals,
          provider: new ResponsesEntryAssociationProvider(
            config.aiProposalProvider,
            modelFetch,
          ),
        });
  const confirmedEntryAliases = async () =>
    (await storage.reviewPreferences.load(config.workspaceId)).vocabulary
      ?.aliases ?? [];
  const agentTaskRepository = new PostgresAgentTaskRepository(database.pool);
  const documentIntakeRepository = new PostgresDocumentIntakeRepository(
    database.pool,
    config.workspaceId,
  );
  const documentPublications = new PostgresDocumentPublicationRepository(
    database.pool,
    config.workspaceId,
  );
  const knowledgeEntries = publishedEntryRepository(
    repositories.informationEntries,
    async (entries) => {
      const [records, tasks] = await Promise.all([
        documentIntakeRepository.list(),
        agentTaskRepository.listPublicationTasks(config.workspaceId),
      ]);
      return unpublishedSnapshots(records, tasks, entries);
    },
    documentPublications,
  );
  const informationEntryRetrieval = new InformationEntryRetrievalService({
    annotationVocabulary: async () =>
      (await storage.reviewPreferences.load(config.workspaceId))
        .annotationVocabulary ?? EMPTY_ANNOTATION_VOCABULARY,
    aliases: confirmedEntryAliases,
    workspaceId: config.workspaceId,
    entries: knowledgeEntries,
    associations: repositories.informationEntryAssociations,
    index: repositories.informationEntrySearchIndex,
    translations: repositories.entryTranslations,
    ...(config.embeddingProvider === undefined
      ? {}
      : {
          embeddingProvider: new OpenAiInformationEntryEmbeddingProvider(
            config.embeddingProvider,
          ),
        }),
  });
  const aiQuerySynthesis =
    config.aiProposalProvider === undefined
      ? undefined
      : new InformationEntryQuerySynthesisService({
          workspaceId: config.workspaceId,
          entries: knowledgeEntries,
          associations: repositories.informationEntryAssociations,
          retrieval: informationEntryRetrieval,
          provider: new ResponsesInformationEntryQuerySynthesisProvider(
            config.aiProposalProvider,
            modelFetch,
          ),
        });
  const entryTranslations = new EntryTranslationService({
    workspaceId: config.workspaceId,
    repository: repositories.entryTranslations,
    loadPublicEntry: async (entryId) =>
      (
        await repositories.informationEntries.loadCurrentEntriesByIds?.(
          config.workspaceId,
          false,
          [entryId],
        )
      )?.[0],
    ...(config.aiProposalProvider === undefined
      ? {}
      : {
          provider: new ResponsesEntryTranslationProvider(
            config.aiProposalProvider,
            modelFetch,
          ),
        }),
  });
  const ingestionRepository = new PostgresIngestionRepository(
    database.pool,
    config.workspaceId,
  );
  const captureRepository = (origin: IngestionOrigin, reception?: Reception) =>
    new PostgresEvidenceRepository(database.pool, (client, capture) =>
      recordIngestionCapture(
        client,
        capture,
        origin,
        reception ? {reception} : {},
      ),
    );
  const intelligence = config.aiProposalProvider
    ? new ResponsesDocumentIntelligenceProvider(
        config.aiProposalProvider,
        modelFetch,
      )
    : undefined;
  const intakeWeb = new WebSourceConnector();
  const sourceDescriptionReader = new SourceDescriptionReader();
  const sourceDescription = new SourceDescriptionService({
    ...(intelligence ? {provider: intelligence} : {}),
    checkModelCall: () => aiPrice.assertAllowed(),
    read: (kind, url) => sourceDescriptionReader.read(kind, url),
  });

  const intake = new DocumentIntakeService({
    workspaceId: config.workspaceId,
    repository: documentIntakeRepository,
    evidence: repositories.evidenceRead,
    capture: repositories.evidence,
    blobStore: storage.blobStore,
    assertBodyChangeAllowed: async (snapshotIds) => {
      const [entries, tasks] = await Promise.all([
        repositories.informationEntries.loadCurrentEntries(
          config.workspaceId,
          true,
        ),
        agentTaskRepository.listForSnapshots(config.workspaceId, snapshotIds),
      ]);
      if (entries.some((entry) => snapshotIds.includes(entry.snapshotId)))
        throw new OperationError('conflict', 'intake_body_already_processed');
      const linked = tasks.filter(
        (task) =>
          task.request.kind === 'document' &&
          snapshotIds.includes(task.request.snapshotId),
      );
      if (
        linked.some((task) => ['queued', 'running'].includes(task.state.status))
      )
        throw new OperationError('conflict', 'intake_task_active');
      if (
        linked.some((task) =>
          task.state.steps.some((step) => step.kind === 'split'),
        )
      )
        throw new OperationError('conflict', 'intake_body_already_processed');
    },
    readWeb: (snapshotId, pageUrl) =>
      intakeWeb.read({
        subscriptionId: snapshotId,
        configuration: {pageUrl, additionalPaths: []},
      }),
    ...(intelligence ? {provider: intelligence} : {}),
  });
  const publication = new DocumentPublicationService(
    config.workspaceId,
    documentIntakeRepository,
    intake,
    repositories.informationEntries,
    () => agentTaskRepository.listPublicationTasks(config.workspaceId),
    documentPublications,
  );
  const topicRepository = new PostgresTopicRepository(
    database.pool,
    config.workspaceId,
  );
  const topics = new TopicService({
    sourceGuidance: async (snapshotId) =>
      (await sourceSplit.freeze(snapshotId)).processingProfile?.relations ?? '',
    budgetStatus: () => usageJournal.budgetStatus(),
    workspaceId: config.workspaceId,
    repository: topicRepository,
    entries: knowledgeEntries,
    associations: repositories.informationEntryAssociations,
    publications: documentPublications,
    vocabulary: async () =>
      (await storage.reviewPreferences.load(config.workspaceId))
        .annotationVocabulary ?? EMPTY_ANNOTATION_VOCABULARY,
    checkModelCall: () => aiPrice.assertBackgroundAllowed(),
    executionSettings: () => aiPrice.executionSettings(),
    ...(config.aiProposalProvider
      ? {
          provider: new ResponsesTopicProvider(
            config.aiProposalProvider,
            modelFetch,
          ),
        }
      : {}),
  });
  const annotations = new AnnotationService({
    workspaceId: config.workspaceId,
    preferences: storage.reviewPreferences,
    entries: repositories.informationEntries,
    stage: (id) => publication.stage(id),
  });
  const sourceSplit = new SourceSplitService({
    workspaceId: config.workspaceId,
    preferences: storage.reviewPreferences,
    evidence: repositories.evidenceRead,
    blobStore: storage.blobStore,
    entries: repositories.informationEntries,
    intake: documentIntakeRepository,
    workingCopyPending: async (id) =>
      (
        await repositories.informationDocumentWorkingCopies.load(
          config.workspaceId,
          id,
        )
      )?.state === 'editing',
    stage: (id) => publication.stage(id),
    checkModelCall: () => aiPrice.assertAllowed(),
    ...(intelligence ? {provider: intelligence} : {}),
  });
  const inbox = new InboxPreviewService({
    workspaceId: config.workspaceId,
    evidence: repositories.evidenceRead,
    blobStore: storage.blobStore,
    repository: documentIntakeRepository,
    origin: async (id) => (await ingestionRepository.read(id))?.origin,
    sources: async () => (await sourceSubscriptions.list()).subscriptions,
    checkModelCall: () => aiPrice.assertAllowed(),
    ...(intelligence ? {provider: intelligence} : {}),
    ...(config.aiProposalProvider
      ? {
          translationProvider: new ResponsesEntryTranslationProvider(
            config.aiProposalProvider,
            modelFetch,
          ),
        }
      : {}),
  });
  const reports = new ReportService({
    withBudget: (batchId, call) =>
      modelUsageScope.run(
        {
          batchId,
          record: async () => {
            /* Costs remain in the shared durable journal. */
          },
        },
        call,
      ),
    filterEntries: async (request, entries) => {
      const confirmed = request.cutoff
        ? await documentPublications.confirmationTimes()
        : new Map<string, string>();
      const vocab =
        (await storage.reviewPreferences.load(config.workspaceId))
          .annotationVocabulary ?? EMPTY_ANNOTATION_VOCABULARY;
      const topicRows = request.topicIds?.length
        ? await topicRepository.list('topic')
        : [];
      return entries.filter(
        (e) =>
          (!request.cutoff ||
            (confirmed.get(e.snapshotId) ?? e.capturedAt) <= request.cutoff) &&
          matchesAnnotationFilter(
            e.value.annotations,
            e.value.bodySha256,
            decodeEntrySearchBody({annotationFilter: request.annotationFilter})
              ?.annotationFilter,
            vocab,
          ) &&
          (!request.topicIds?.length ||
            topicRows.some(
              (t) =>
                request.topicIds?.includes(t.id) &&
                t.value.kind === 'topic' &&
                t.value.members.some(
                  (m) =>
                    m.entryId === e.entryId &&
                    m.decision !== 'excluded' &&
                    m.revision === e.revision,
                ),
            )),
      );
    },
    workspaceId: config.workspaceId,
    repository: new PostgresReportRepository(database.pool, config.workspaceId),
    entries: knowledgeEntries,
    evidence: repositories.evidenceRead,
    intake,
    checkModelCall: () => aiPrice.assertBackgroundAllowed(),
    checkOperations: () => aiPrice.assertBackgroundOperationsAllowed(),
    ...(config.aiProposalProvider
      ? {
          provider: new ResponsesReportProvider(
            config.aiProposalProvider,
            modelFetch,
          ),
        }
      : {}),
  });
  const researchRepository = new PostgresResearchRepository(
    database.pool,
    config.workspaceId,
  );
  const reportPipeline = new ReportPipeline({
    workspaceId: config.workspaceId,
    repository: researchRepository,
    reports,
    eventEntries: async () => {
      const [entries, times] = await Promise.all([
        knowledgeEntries.loadCurrentEntries(config.workspaceId, false),
        documentPublications.confirmationTimes(),
      ]);
      return entries.map((e) => ({
        ...e,
        capturedAt: times.get(e.snapshotId) ?? e.capturedAt,
      }));
    },
    entries: () =>
      knowledgeEntries.loadCurrentEntries(config.workspaceId, false),
    budgetStatus: () => usageJournal.budgetStatus(),
  });
  const agentTasks = new AgentTaskService(
    config.workspaceId,
    agentTaskRepository,
    new AgentTaskActions({
      sourceSplit,
      publication,
      knowledgeEntries,
      intake,
      ...(intelligence ? {intelligence} : {}),
      aliases: confirmedEntryAliases,
      workspaceId: config.workspaceId,
      blobStore: storage.blobStore,
      splitProcessing: repositories.processingRuns,
      evidence: repositories.evidenceRead,
      entries: repositories.informationEntries,
      associations: repositories.informationEntryAssociations,
      processing: repositories.processingRuns,
      associationProcessing: repositories.aiAssociationProposals,
      ...(aiSplitProposals ? {split: aiSplitProposals} : {}),
      ...(aiTagProposals ? {tags: aiTagProposals} : {}),
      ...(aiAssociationProposals ? {relations: aiAssociationProposals} : {}),
    }),
    (task) => ingestion.guard(task),
    {
      check: () => aiPrice.assertBackgroundAllowed(),
      executionSettings: () => aiPrice.executionSettings(),
      checkOperations: () => aiPrice.assertBackgroundOperationsAllowed(),
      canResume: async (task) =>
        task.actorKind !== 'external_agent' ||
        (config.agentInterface?.identity === task.actorId &&
          config.agentInterface.processDocuments &&
          ((task.request.kind !== 'intake' &&
            !(
              task.request.kind === 'document' &&
              task.request.intake &&
              (await intake.record(task.request.snapshotId))?.value.receipt ===
                'pending'
            )) ||
            config.agentInterface.automate) &&
          (!(
            (task.request.kind === 'document' ||
              task.request.kind === 'intake') &&
            task.request.intake?.fetchFullText
          ) ||
            config.agentInterface.capture)),
    },
  );
  const sourceSubscriptions = new SourceSubscriptionService({
    workspaceId: config.workspaceId,
    preferences: storage.reviewPreferences,
    processing: repositories.processingRuns,
    reader:
      dependencies.sourceSubscriptionReader ??
      new GithubGitSourceSubscriptionReader(),
    connectors: new SourceConnectorRegistry([
      new RssAtomSourceConnector(),
      new JsonApiSourceConnector(),
      new WebSourceConnector(),
      ...(dependencies.sourceConnectors ?? []),
    ]),
    blobStore: storage.blobStore,
    evidence: repositories.evidence,
    evidenceForSubscription: (subscriptionId, reception) =>
      captureRepository({kind: 'subscription', subscriptionId}, reception),
    pendingCounts: () => ingestionRepository.pendingSourceCounts(),
    evidenceRead: repositories.evidenceRead,
  });
  const automationAuthority = ExecutionAuthority.automation(
    config.workspaceId,
    INGESTION_ACTOR_ID,
  );
  const ingestion: IngestionService = new IngestionService(
    config.workspaceId,
    ingestionRepository,
    {
      start: (snapshotId, policy) =>
        agentTasks.start(automationAuthority, ingestionTaskKey(snapshotId), {
          kind: 'document',
          snapshotId,
          maxEntries: policy.settings.maxEntries,
          maxModelCalls: policy.settings.maxModelCalls,
          intake: policy.settings.intake ?? {fetchFullText: true},
        }),
      read: (taskId) => agentTasks.read(automationAuthority, taskId),
      resume: (task) =>
        agentTasks.control(
          automationAuthority,
          task.taskId,
          task.version,
          'resume',
        ),
      cancel: (task) =>
        agentTasks.control(
          automationAuthority,
          task.taskId,
          task.version,
          'cancel',
        ),
    },
    () => config.aiProposalProvider?.model,
    async () => (await sourceSubscriptions.list()).subscriptions,
  );
  if (
    config.role === 'worker' ||
    config.role === 'api' ||
    config.role === 'all'
  ) {
    starters.push(() =>
      Promise.resolve(
        new IngestionScheduler(async () => {
          if (config.role !== 'api') await ingestion.poll();
          await agentTasks.pollPriceDeferred();
          await reports.pollPriceDeferred();
          await topics.poll();
          await reportPipeline.poll();
        }, logger),
      ),
    );
  }
  if (config.role === 'scheduler' || config.role === 'all') {
    starters.push(() =>
      (
        dependencies.sourceSubscriptionSchedulerStarter ??
        SourceSubscriptionScheduler.start
      )({
        subscriptions: sourceSubscriptions,
        logger,
      }),
    );
  }
  const entryMarkdownExports = new EntryMarkdownExportService({
    workspaceId: config.workspaceId,
    repository: repositories.entryMarkdownExports,
    blobStore: storage.blobStore,
    files: storage.entryMarkdownFiles,
  });
  const api =
    config.role === 'api' || config.role === 'all'
      ? new M1cApiService({
          documentIntakeRepository,
          workspaceId: config.workspaceId,
          blobStore: storage.blobStore,
          reviewPreferences: storage.reviewPreferences,
          evidenceRepository: repositories.evidence,
          manualImportEvidenceRepository: captureRepository({kind: 'upload'}),
          evidenceReadRepository: repositories.evidenceRead,
          informationEntryRepository: repositories.informationEntries,
          knowledgeEntries,
          stageDocument: (id) => publication.stage(id, 'manual'),
          informationDocumentWorkingCopyRepository:
            repositories.informationDocumentWorkingCopies,
          informationDocumentTagRepository:
            repositories.informationDocumentTags,
          informationEntryAssociationRepository:
            repositories.informationEntryAssociations,
          informationEntryRetrieval,
          entryTranslations,
          entryTranslationSearch: repositories.entryTranslations,
          informationEntryRestructureRepository:
            repositories.informationEntryRestructures,
          processingRunRepository: repositories.processingRuns,
          sourceSubscriptions,
          ...(aiSplitProposals === undefined ? {} : {aiSplitProposals}),
          ...(aiTagProposals === undefined ? {} : {aiTagProposals}),
          ...(aiAssociationProposals === undefined
            ? {}
            : {aiAssociationProposals}),
          ...(aiQuerySynthesis === undefined ? {} : {aiQuerySynthesis}),
          entryMarkdownExports,
          workspaceTransfer: new M1cWorkspaceTransfer({
            repository: repositories.workspaceTransfer,
            blobStore: storage.blobStore,
            reviewPreferences: storage.reviewPreferences,
            fileStore: storage.workspaceBundleFiles,
          }),
        })
      : undefined;
  const commandDependencies = {
    stageDocument: (id: string) => publication.stage(id, 'external_agent'),
    knowledgeEntries,
    documentIntakeRepository,
    blobStore: storage.blobStore,
    evidenceReadRepository: repositories.evidenceRead,
    informationEntryRepository: repositories.informationEntries,
    informationDocumentTagRepository: repositories.informationDocumentTags,
    informationDocumentWorkingCopyRepository:
      repositories.informationDocumentWorkingCopies,
    informationEntryAssociationRepository:
      repositories.informationEntryAssociations,
    informationEntryRetrieval,
    entryAliases: confirmedEntryAliases,
    annotationVocabulary: async () =>
      (await storage.reviewPreferences.load(config.workspaceId))
        .annotationVocabulary ?? EMPTY_ANNOTATION_VOCABULARY,
    reviewPreferences: storage.reviewPreferences,
    entryTranslationSearch: repositories.entryTranslations,
  };
  const capture = new AgentCaptureService(config.workspaceId, {
    blobStore: storage.blobStore,
    evidence: captureRepository({kind: 'upload'}),
    evidenceRead: repositories.evidenceRead,
    subscriptions: sourceSubscriptions,
  });
  const webCapture = new AgentCaptureService(config.workspaceId, {
    blobStore: storage.blobStore,
    evidence: new PostgresEvidenceRepository(database.pool, (client, item) =>
      recordIngestionCapture(
        client,
        item,
        {kind: 'upload'},
        {reviewOnly: true},
      ),
    ),
    evidenceRead: repositories.evidenceRead,
    subscriptions: sourceSubscriptions,
  });
  const research = new ResearchService({
    workspaceId: config.workspaceId,
    repository: researchRepository,
    queue: sharedAiQueue,
    checkAllowed: () => aiPrice.assertAllowed(),
    visibleEntryIds: async () =>
      new Set(
        (
          await knowledgeEntries.loadCurrentEntries(config.workspaceId, false)
        ).map((e) => e.entryId),
      ),
    ...(aiQuerySynthesis ? {local: aiQuerySynthesis} : {}),
    ...(config.aiProposalProvider
      ? {
          answer: new ResponsesInformationEntryQuerySynthesisProvider(
            config.aiProposalProvider,
            modelFetch,
          ),
        }
      : {}),
    ...(config.aiProposalProvider?.providerKey === 'deepseek-responses-v1'
      ? {web: new DeepSeekSearchProvider(config.aiProposalProvider.apiKey)}
      : {}),
    capture: (authority, key, doc) =>
      webCapture.importText(
        authority,
        {
          requestKey: key,
          title: doc.title.slice(0, 120) || doc.url.slice(0, 120),
          markdown: doc.content,
        },
        {
          url: doc.url,
          ...(doc.publishedAt ? {publishedAt: doc.publishedAt} : {}),
        },
      ),
  });
  const sourceQuality = new SourceQualityService(config.workspaceId, {
    preferences: storage.reviewPreferences,
    intake,
    snapshots: () =>
      repositories.evidenceRead.listSnapshots(config.workspaceId),
  });
  const sourceHistory = new SourceHistoryService({
    receiptSources: async () =>
      new Map(
        (await documentIntakeRepository.list()).flatMap((record) =>
          record.value.captureOrigin?.kind === 'subscription'
            ? [
                [
                  record.snapshotId,
                  record.value.captureOrigin.subscriptionId,
                ] as const,
              ]
            : [],
        ),
      ),
    sources: async () => (await sourceSubscriptions.list()).subscriptions,
    snapshots: () =>
      repositories.evidenceRead.listSnapshots(config.workspaceId),
    reader: new PublicSourceHistoryReader(),
    importArticle: async (source, document) => {
      const result = await importSourceConnectorDocuments(
        {
          blobStore: storage.blobStore,
          evidenceRepository: new PostgresEvidenceRepository(
            database.pool,
            (client, capture) =>
              recordIngestionCapture(
                client,
                capture,
                {kind: 'subscription', subscriptionId: source.subscriptionId},
                {
                  reviewOnly: true,
                  reception: {
                    channel: 'history',
                    strategy: source.receiving ?? DEFAULT_SOURCE_RECEIVING,
                  },
                },
              ),
          ),
          evidenceRead: repositories.evidenceRead,
        },
        {
          workspaceId: config.workspaceId,
          subscriptionId: source.subscriptionId,
          sourceAlias: source.sourceAlias,
          isPrivate: false,
          connectorId: 'builtin.history.v1',
          capturedAt: new Date().toISOString(),
          result: {status: 'changed', cursor: 'history', documents: [document]},
        },
      );
      const saved =
        result.status === 'complete' ? result.documents[0] : undefined;
      if (!saved) throw new Error('history_import_failed');
      return {snapshotId: saved.snapshotId, outcome: saved.outcome};
    },
  });
  const commands = (authority: ExecutionAuthority) =>
    new AgentCommands(authority, {
      documents: new DocumentUseCases(authority, commandDependencies),
      entries: new EntryUseCases(authority, commandDependencies),
      relations: new RelationUseCases(authority, commandDependencies),
      tasks: agentTasks,
      publication,
      sourceQuality,
      sourceHistory,
      sourceDescription,
      sourceSplit,
      annotations,
      topics,
      research,
      reportPipeline,
      aiPrice,
      reports,
      capture,
      intake,
      inbox,
      runtimeStatus: {
        ...(config.aiProposalProvider
          ? {model: config.aiProposalProvider.model}
          : {}),
        role: config.role,
        agentEnabled: Boolean(config.agentInterface),
        grants: config.agentInterface
          ? [
              ...(config.agentInterface.read ? ['read'] : []),
              ...(config.agentInterface.annotate ? ['annotate'] : []),
              ...(config.agentInterface.structure ? ['structure'] : []),
              ...(config.agentInterface.capture ? ['capture'] : []),
              ...(config.agentInterface.processDocuments ? ['process'] : []),
              ...(config.agentInterface.automate ? ['automate'] : []),
            ]
          : [],
      },
      ingestion,
      subscriptions: async () =>
        (await sourceSubscriptions.list()).subscriptions
          .filter((s) => !s.isPrivate)
          .map((s) => ({
            subscriptionId: s.subscriptionId,
            label: s.label,
            kind: s.kind ?? 'github_markdown',
            enabled: s.enabled,
            lastRunId: s.lastRunId,
            lastSuccessAt: s.lastSuccessAt,
          })),
    });
  const grants: AgentWriteOperation[] = [];
  if (config.agentInterface?.annotate)
    grants.push('tasks.control', 'agent.tags', 'agent.relations');
  if (config.agentInterface?.processDocuments)
    grants.push('tasks.control', 'models.use');
  if (config.agentInterface?.automate) grants.push('ingestion.manage');
  if (config.agentInterface?.capture) grants.push('sources.capture');
  if (config.agentInterface?.structure)
    grants.push('tasks.control', 'agent.split');
  const agentHttp = {
    owner: commands(ExecutionAuthority.owner(config.workspaceId)),
    ...(config.agentInterface
      ? {
          agent: {
            token: config.agentInterface.token,
            commands: commands(
              ExecutionAuthority.agent(
                config.workspaceId,
                config.agentInterface.identity,
                [
                  ...(config.agentInterface.read
                    ? DELEGATED_READ_OPERATIONS
                    : ['processing.read' as const]),
                  ...grants,
                ],
              ),
            ),
          },
        }
      : {}),
  };
  const assistantHttp =
    config.assistantToken && api
      ? {
          token: config.assistantToken,
          service: new SystemAssistant({
            store: new LocalAssistantSessionStore(
              config.dataRoot + '/assistant/' + config.workspaceId,
            ),
            tools: {
              ...createAssistantCommandTools(
                agentHttp.owner,
                aiPrice,
                ExecutionAuthority.owner(config.workspaceId),
              ),
              ...createAssistantApiTools(api),
            },
            ...(config.aiProposalProvider
              ? {
                  provider: new ResponsesAssistantProvider(
                    config.aiProposalProvider,
                    priceAwareFetch(
                      {
                        assertAllowed: () => aiPrice.assertAssistantAllowed(),
                        executionSettings: () => aiPrice.executionSettings(),
                      },
                      globalThis.fetch,
                      usageJournal,
                      sharedAiQueue,
                    ),
                  ),
                }
              : {}),
            checkModelCall: () => aiPrice.assertAssistantAllowed(),
          }),
        }
      : undefined;
  starters.push(() =>
    Promise.resolve({
      name: 'agent-tasks',
      stopAccepting: () => {
        assistantHttp?.service.stop();
        agentTasks.stop();
        reports.stop();
        reportPipeline.stop();
      },
      drain: async () => {
        await Promise.all([
          agentTasks.drain(),
          reports.drain(),
          topics.drain(),
          assistantHttp?.service.settle(),
        ]);
      },
      close: () => {
        return Promise.resolve();
      },
    }),
  );
  starters.push(() =>
    listenerFactory.start({
      health,
      ...(api === undefined ? {} : {api, agentHttp}),
      ...(api !== undefined && assistantHttp ? {assistantHttp} : {}),
      host: address.host,
      port: address.port,
    }),
  );

  const resources = await startOwnedResources(starters);
  const shutdown = new ShutdownCoordinator({
    readiness: gate,
    resources,
    deadline,
    timeoutMs: config.shutdownTimeoutMs,
    logger,
    exitDecision: dependencies.exitDecision ?? new ProcessExitDecision(),
  });
  let disposeSignalHandlers: (() => void) | undefined;
  try {
    disposeSignalHandlers = shutdown.bind(
      dependencies.signalSource ?? new ProcessSignalSource(),
    );
    gate.markInitialized();
    logger.write('info', 'startup_completed', {
      listener_host: address.host,
      listener_port: address.port,
    });
    return {
      workspaceId: config.workspaceId,
      resources,
      storage,
      repositories,
      shutdown,
      disposeSignalHandlers,
    };
  } catch (startupFailure) {
    gate.beginShutdown();
    const cleanupFailures = [...(await closeResourcesInReverse(resources))];
    if (disposeSignalHandlers !== undefined) {
      try {
        disposeSignalHandlers();
      } catch (cleanupFailure) {
        cleanupFailures.push(toError(cleanupFailure));
      }
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [toError(startupFailure), ...cleanupFailures],
        'Runtime startup and cleanup failed.',
        {cause: startupFailure},
      );
    }
    throw toError(startupFailure);
  }
}

function listenerAddress(config: Readonly<RuntimeConfig>): Readonly<{
  host: string;
  port: number;
}> {
  if (config.role === 'api' || config.role === 'all') {
    return {host: config.host, port: config.port};
  }
  return {host: config.healthHost, port: config.healthPort};
}
