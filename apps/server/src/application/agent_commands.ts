import {
  researchCommandSchemas,
  researchOwnerSchemas,
} from './research_contract.js';
import type {ResearchService} from './research_service.js';
import type {ReportPipeline} from './report_pipeline.js';
import {
  topicCommandSchemas,
  topicOwnerSchemas,
  type TopicService,
} from './topic_service.js';
import {
  annotationCommandSchemas,
  annotationOwnerSchemas,
  type AnnotationService,
} from './annotation_service.js';
import {annotationFilterSchema} from '../modules/entries/structured_annotations.js';
import {
  splitRecipeReadSchemas,
  splitRecipeOwnerSchemas,
  type SourceSplitService,
} from './source_split_service.js';
import {
  historySchemas,
  type SourceHistoryService,
} from './source_history_service.js';
import type {SourceDescriptionService} from './source_description_service.js';
import {
  type SourceQualityService,
  sourceQualityOwnerSchemas,
} from './source_quality_service.js';
import {DocumentQueue, documentQueueApplySchema} from './document_queue.js';
import {
  documentPublishSchema,
  type DocumentPublicationService,
} from './document_publication.js';
import type {InboxPreviewService} from './inbox_preview_service.js';
import type {AiPriceService} from './ai_price_service.js';
import {
  ReportCommands,
  REPORT_OPERATIONS,
  reportReadCommandSchemas,
} from './report_commands.js';
import type {ReportService} from './report_service.js';
import {
  ENTRY_TEXT_SEARCH_MODES,
  ENTRY_TYPE_KEYWORDS,
  ENTRY_DOMAIN_KEYWORDS,
} from '../modules/entries/index.js';
import {
  captureTextSchema,
  publicSubscriptionSchema,
  type AgentCaptureService,
} from './agent_capture_service.js';
import {z} from 'zod';
import type {DocumentIntakeService} from './document_intake_service.js';
import {
  intakePolicySchema,
  intakePreparationSchema,
} from './document_intake_contract.js';
import {
  ingestionSettingsSchema,
  ingestionStatusQuerySchema,
} from './ingestion_contract.js';
import type {IngestionService} from './ingestion_service.js';
import {
  decodeEntrySearchBody,
  ENTRY_SEARCH_TEXT_LIMIT,
  ENTRY_SEARCH_CONTENT_KEYWORD_LIMIT,
} from '../modules/entries/information_entry_search_request.js';
import {agentTaskRequestSchema} from './agent_task_contract.js';
import type {AgentTaskService} from './agent_task_service.js';
import type {DocumentUseCases} from './document_use_cases.js';
import type {EntryUseCases} from './entry_use_cases.js';
import type {RelationUseCases} from './relation_use_cases.js';
import type {ExecutionAuthority} from './execution_authority.js';
import {OperationError} from './operation_error.js';
import {
  DOCUMENT_PROCESSING_STAGES,
  DOCUMENT_PROCESSING_STANDARD_VERSION,
  documentProcessingInstructions,
} from '../modules/processing/document_processing_standard.js';

const id = z.uuid();
const cursor = z
  .object({
    schemaVersion: z.literal(2),
    querySha256: z.string().regex(/^[0-9a-f]{64}$/u),
    associationDepth: z.number().int().min(0),
    textScore: z.number().min(0),
    matchReasonCount: z.number().int().min(0),
    associationScore: z.number().min(0),
    capturedAt: z.string().max(50),
    documentOrder: z.number().int().min(0),
    entryId: id,
  })
  .strict();
const inboxOwnerSchemas = {
  intake_origins: z
    .object({
      snapshotIds: z.array(id).min(1).max(100),
      includePrivate: z.boolean().default(false),
    })
    .strict(),
  intake_previews: z
    .object({
      snapshotIds: z.array(id).min(1).max(20),
      includePrivate: z.boolean().default(false),
    })
    .strict(),
  intake_translate: z.object({snapshotId: id}).strict(),
  intake_summarize: z.object({snapshotId: id}).strict(),
};
export const agentCommandSchemas = {
  ...splitRecipeReadSchemas,
  ...annotationCommandSchemas,
  ...topicCommandSchemas,
  ...researchCommandSchemas,
  ...reportReadCommandSchemas,
  system_status: z.object({}).strict(),
  processing_standard: z
    .object({stage: z.enum(DOCUMENT_PROCESSING_STAGES).optional()})
    .strict(),
  document_import: captureTextSchema,
  document_sections: z.object({snapshotId: id}).strict(),
  entry_read: z.object({entryId: id}).strict(),
  subscriptions_read: z.object({}).strict(),
  subscription_put: z
    .object({
      expectedRevision: z.number().int().min(0),
      subscription: publicSubscriptionSchema,
    })
    .strict(),
  subscription_check: z
    .object({
      subscriptionId: id,
      requestKey: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/u),
    })
    .strict(),

  intake_status: z.object({}).strict(),
  intake_receive: z
    .object({
      processAccepted: z.boolean().optional(),
      items: z
        .array(
          z
            .object({snapshotId: id, expectedVersion: z.number().int().min(0)})
            .strict(),
        )
        .min(1)
        .max(100)
        .refine(
          (items) =>
            new Set(items.map((item) => item.snapshotId)).size === items.length,
        ),
      action: z.enum(['accept', 'reject', 'reset']),
    })
    .strict(),
  intake_control: z
    .object({
      snapshotId: id,
      expectedVersion: z.number().int().min(0),
      action: z.enum(['block', 'admit', 'reset']),
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
  intake_prepare: z
    .object({snapshotId: id, selection: intakePreparationSchema.optional()})
    .strict(),
  ingestion_status: ingestionStatusQuerySchema,
  ingestion_policy_save: z
    .object({
      expectedRevision: z.number().int().min(0),
      settings: ingestionSettingsSchema,
    })
    .strict(),
  ingestion_item_control: z
    .object({
      snapshotId: id,
      expectedVersion: z.number().int().min(1),
      action: z.enum(['pause', 'retry', 'take_over']),
    })
    .strict(),
  subscriptions_list: z.object({}).strict(),
  documents_list: z
    .object({
      limit: z.number().int().min(1).max(100).default(20),
      text: z.string().trim().max(300).default(''),
      after: z
        .object({capturedAt: z.string().max(50), snapshotId: id})
        .strict()
        .optional(),
    })
    .strict(),
  document_read: z.object({snapshotId: id}).strict(),
  document_publish: documentPublishSchema,
  document_publication_status: z.object({snapshotId: id}).strict(),
  entries_search: z
    .object({
      annotationFilter: annotationFilterSchema.optional(),
      text: z.string().max(ENTRY_SEARCH_TEXT_LIMIT).default(''),
      textMode: z.enum(ENTRY_TEXT_SEARCH_MODES).optional(),
      sourceKey: z.string().max(2048).optional(),
      typeKeyword: z.enum(ENTRY_TYPE_KEYWORDS).optional(),
      typeCustomName: z.string().max(80).optional(),
      domainKeyword: z.enum(ENTRY_DOMAIN_KEYWORDS).optional(),
      domainCustomName: z.string().max(80).optional(),
      time: z
        .object({
          field: z.enum(['captured', 'published']),
          from: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/u)
            .optional(),
          to: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/u)
            .optional(),
        })
        .strict()
        .optional(),
      limit: z.number().int().min(1).max(50).default(20),
      after: cursor.optional(),
      snapshotId: id.optional(),
      contentKeyword: z
        .string()
        .max(ENTRY_SEARCH_CONTENT_KEYWORD_LIMIT)
        .optional(),
    })
    .strict(),
  relations_read: z.object({entryId: id}).strict(),
  tasks_list: z
    .object({
      snapshotIds: z.array(id).min(1).max(50).optional(),
      prioritizeActive: z.boolean().optional(),
    })
    .strict(),
  task_read: z.object({taskId: id}).strict(),
  task_start: z
    .object({
      requestKey: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/u),
      request: agentTaskRequestSchema,
    })
    .strict(),
  task_control: z
    .object({
      taskId: id,
      expectedVersion: z.number().int().min(1),
      action: z.enum(['pause', 'resume', 'cancel']),
      regenerateSplit: z.boolean().optional(),
    })
    .strict(),
};

export type AgentCommandName = keyof typeof agentCommandSchemas;
export interface AgentCommandDependencies {
  readonly sourceSplit?: SourceSplitService;
  readonly annotations?: AnnotationService;
  readonly topics?: TopicService;
  readonly research?: ResearchService;
  readonly reportPipeline?: ReportPipeline;
  readonly sourceDescription?: SourceDescriptionService;
  readonly sourceHistory?: SourceHistoryService;
  readonly sourceQuality?: SourceQualityService;
  readonly publication?: DocumentPublicationService;
  readonly aiPrice?: AiPriceService;
  readonly reports?: ReportService;
  readonly capture?: AgentCaptureService;
  readonly runtimeStatus?: Readonly<{
    model?: string;
    role: string;
    agentEnabled: boolean;
    grants: readonly string[];
  }>;
  readonly ingestion?: IngestionService;
  readonly intake?: DocumentIntakeService;
  readonly inbox?: InboxPreviewService;
  readonly subscriptions?: () => Promise<unknown>;
  readonly documents: DocumentUseCases;
  readonly entries: EntryUseCases;
  readonly relations: RelationUseCases;
  readonly tasks: AgentTaskService;
}
export class AgentCommands {
  public constructor(
    private readonly authority: ExecutionAuthority,
    private readonly deps: AgentCommandDependencies,
  ) {}
  private capture() {
    if (!this.deps.capture)
      throw new OperationError('rejected', 'capture_unavailable');
    return this.deps.capture;
  }
  private intake() {
    if (!this.deps.intake)
      throw new OperationError('rejected', 'intake_unavailable');
    return this.deps.intake;
  }
  private ingestion() {
    if (!this.deps.ingestion)
      throw new OperationError('rejected', 'ingestion_unavailable');
    return this.deps.ingestion;
  }
  public async execute(name: string, input: unknown): Promise<unknown> {
    if (
      Object.hasOwn(researchOwnerSchemas, name) ||
      name === 'report_pipeline_status'
    ) {
      if (!this.deps.reportPipeline)
        throw new OperationError('rejected', 'research_unavailable');
      return this.deps.reportPipeline.execute(this.authority, name, input);
    }
    if (Object.hasOwn(researchCommandSchemas, name)) {
      if (!this.deps.research)
        throw new OperationError('rejected', 'research_unavailable');
      return this.deps.research.execute(this.authority, name, input);
    }

    if (
      Object.hasOwn(topicCommandSchemas, name) ||
      Object.hasOwn(topicOwnerSchemas, name)
    ) {
      if (!this.deps.topics)
        throw new OperationError('rejected', 'topics_unavailable');
      return this.deps.topics.execute(this.authority, name, input);
    }
    if (
      Object.hasOwn(annotationCommandSchemas, name) ||
      Object.hasOwn(annotationOwnerSchemas, name)
    ) {
      if (!this.deps.annotations)
        throw new OperationError('rejected', 'annotations_unavailable');
      return this.deps.annotations.execute(this.authority, name, input);
    }
    if (
      Object.hasOwn(splitRecipeReadSchemas, name) ||
      Object.hasOwn(splitRecipeOwnerSchemas, name)
    ) {
      if (!this.deps.sourceSplit)
        throw new OperationError('rejected', 'split_recipes_unavailable');
      return this.deps.sourceSplit.execute(this.authority, name, input);
    }
    if (Object.hasOwn(historySchemas, name)) {
      if (this.authority.identity.kind !== 'owner')
        throw new OperationError('forbidden', 'operation_not_authorized');
      this.authority.require(
        name === 'history_import' ? 'sources.capture' : 'documents.read',
      );
      if (!this.deps.sourceHistory)
        throw new OperationError('rejected', 'history_unavailable');
      return this.deps.sourceHistory.execute(
        name as keyof typeof historySchemas,
        input,
      );
    }
    if (REPORT_OPERATIONS.includes(name)) {
      if (!this.deps.reports)
        throw new OperationError('rejected', 'reports_unavailable');
      return new ReportCommands(this.authority, this.deps.reports).execute(
        name,
        input,
      );
    }
    switch (name) {
      case 'source_description_generate':
        if (this.authority.identity.kind !== 'owner')
          throw new OperationError('forbidden', 'operation_not_authorized');
        if (!this.deps.sourceDescription)
          throw new OperationError('rejected', 'ai_not_configured');
        return this.deps.sourceDescription.generate(this.authority, input);
      case 'ai_price_status':
        parse(agentCommandSchemas.system_status, input);
        this.authority.require('processing.read');
        if (!this.deps.aiPrice)
          throw new OperationError('rejected', 'ai_price_unavailable');
        return this.deps.aiPrice.status();
      case 'ai_operations_save':
        if (!this.deps.aiPrice)
          throw new OperationError('rejected', 'ai_price_unavailable');
        return this.deps.aiPrice.save(this.authority, input, true);
      case 'ai_execution_save':
        if (!this.deps.aiPrice)
          throw new OperationError('rejected', 'ai_price_unavailable');
        return this.deps.aiPrice.save(this.authority, input, 'execution');
      case 'ai_price_save':
        if (!this.deps.aiPrice)
          throw new OperationError('rejected', 'ai_price_unavailable');
        return this.deps.aiPrice.save(this.authority, input);
      case 'processing_standard': {
        this.authority.require('processing.read');
        const {stage} = parse(agentCommandSchemas.processing_standard, input);
        return {
          version: DOCUMENT_PROCESSING_STANDARD_VERSION,
          stages: stage ? [stage] : [...DOCUMENT_PROCESSING_STAGES],
          instructions: documentProcessingInstructions(stage),
        };
      }
      case 'system_status':
        parse(agentCommandSchemas.system_status, input);
        this.authority.require('processing.read');
        return {
          ...(this.deps.runtimeStatus ?? {
            role: 'unknown',
            agentEnabled: false,
            grants: [],
          }),
          ...(this.deps.aiPrice
            ? {aiPrice: await this.deps.aiPrice.status()}
            : {}),
        };
      case 'document_import':
        return this.capture().importText(
          this.authority,
          parse(captureTextSchema, input),
        );
      case 'document_sections':
        return this.deps.documents.sections(
          parse(agentCommandSchemas.document_sections, input).snapshotId,
        );
      case 'entry_read':
        return this.deps.entries.read(
          parse(agentCommandSchemas.entry_read, input).entryId,
        );
      case 'subscriptions_read':
        parse(agentCommandSchemas.subscriptions_read, input);
        return this.capture().list(this.authority);
      case 'subscription_put': {
        const request = parse(agentCommandSchemas.subscription_put, input);
        return this.capture().put(
          this.authority,
          request.expectedRevision,
          request.subscription,
        );
      }
      case 'subscription_check': {
        const request = parse(agentCommandSchemas.subscription_check, input);
        return this.capture().check(
          this.authority,
          request.subscriptionId,
          request.requestKey,
        );
      }

      case 'source_quality_status':
      case 'source_quality_control': {
        if (this.authority.identity.kind !== 'owner')
          throw new OperationError('forbidden', 'operation_not_authorized');
        this.authority.require('documents.read');
        if (!this.deps.sourceQuality)
          throw new OperationError('rejected', 'source_quality_unavailable');
        if (name === 'source_quality_status') {
          parse(sourceQualityOwnerSchemas.source_quality_status, input);
          return this.deps.sourceQuality.status();
        }
        this.authority.require('ingestion.manage');
        return this.deps.sourceQuality.control(
          parse(sourceQualityOwnerSchemas.source_quality_control, input),
        );
      }
      case 'intake_origins': {
        if (this.authority.identity.kind !== 'owner')
          throw new OperationError('forbidden', 'operation_not_authorized');
        const request = parse(inboxOwnerSchemas.intake_origins, input);
        this.authority.require('documents.read', request.includePrivate);
        if (!this.deps.inbox)
          throw new OperationError('rejected', 'intake_unavailable');
        return this.deps.inbox.origins(
          request.snapshotIds,
          request.includePrivate,
        );
      }
      case 'intake_previews': {
        if (this.authority.identity.kind !== 'owner')
          throw new OperationError('forbidden', 'operation_not_authorized');
        const inputValue = parse(inboxOwnerSchemas.intake_previews, input);
        this.authority.require('documents.read', inputValue.includePrivate);
        if (!this.deps.inbox)
          throw new OperationError('rejected', 'intake_unavailable');
        return this.deps.inbox.preview(
          inputValue.snapshotIds,
          inputValue.includePrivate,
        );
      }
      case 'intake_translate': {
        if (this.authority.identity.kind !== 'owner')
          throw new OperationError('forbidden', 'operation_not_authorized');
        this.authority.require('models.use');
        this.authority.require('documents.read');
        if (!this.deps.inbox)
          throw new OperationError('rejected', 'intake_unavailable');
        return this.deps.inbox.translate(
          parse(inboxOwnerSchemas.intake_translate, input).snapshotId,
        );
      }
      case 'intake_summarize': {
        if (this.authority.identity.kind !== 'owner')
          throw new OperationError('forbidden', 'operation_not_authorized');
        this.authority.require('models.use');
        if (!this.deps.inbox)
          throw new OperationError('rejected', 'intake_unavailable');
        return this.deps.inbox.summarize(
          parse(inboxOwnerSchemas.intake_summarize, input).snapshotId,
        );
      }
      case 'intake_status':
        parse(agentCommandSchemas.intake_status, input);
        this.authority.require('documents.read');
        return {records: await this.intake().list()};
      case 'intake_receive': {
        const request = parse(agentCommandSchemas.intake_receive, input);
        this.authority.require('ingestion.manage');
        if (request.processAccepted && request.action === 'accept') {
          this.authority.require('models.use');
          this.authority.require('tasks.control');
        }
        const received = await this.intake().receive(
          request.items,
          request.action,
        );
        const queued: string[] = [],
          queueFailed: {snapshotId: string; code: string}[] = [];
        if (request.processAccepted && request.action === 'accept') {
          const status = await this.ingestion().status(this.authority, {
            limit: 1,
          });
          for (const record of received.records) {
            try {
              if (!status.modelConfigured)
                throw new OperationError('rejected', 'ai_not_configured');
              const prior = (
                await this.deps.tasks.list(this.authority, [record.snapshotId])
              ).find(
                (task) =>
                  task.request.kind === 'document' &&
                  !task.request.reprocess &&
                  task.state.status !== 'cancelled',
              );
              const task = prior
                ? ['paused', 'failed'].includes(prior.state.status)
                  ? await this.deps.tasks.control(
                      this.authority,
                      prior.taskId,
                      prior.version,
                      'resume',
                    )
                  : prior
                : await this.deps.tasks.start(
                    this.authority,
                    'accepted-' +
                      record.snapshotId +
                      '-' +
                      record.version.toString(),
                    {
                      kind: 'document',
                      snapshotId: record.snapshotId,
                      maxEntries: status.policy.settings.maxEntries,
                      maxModelCalls: status.policy.settings.maxModelCalls,
                      intake: status.policy.settings.intake ?? {
                        fetchFullText: true,
                      },
                    },
                  );
              queued.push(task.taskId);
            } catch (error) {
              queueFailed.push({
                snapshotId: record.snapshotId,
                code:
                  error instanceof OperationError
                    ? error.code
                    : 'task_start_failed',
              });
            }
          }
        }
        return {...received, queued, queueFailed};
      }
      case 'intake_control': {
        const request = parse(agentCommandSchemas.intake_control, input);
        this.authority.require('ingestion.manage');
        return this.intake().control(
          request.snapshotId,
          request.expectedVersion,
          request.action,
          request.reason,
        );
      }
      case 'intake_prepare': {
        const request = parse(agentCommandSchemas.intake_prepare, input);
        if (request.selection) this.authority.require('ingestion.manage');
        if (request.selection?.source !== 'received')
          this.authority.require('sources.capture');
        return (
          (await this.intake().prepare(
            request.snapshotId,
            intakePolicySchema.parse({fetchFullText: true}),
            request.selection,
          )) ?? null
        );
      }
      case 'subscriptions_list':
        parse(agentCommandSchemas.subscriptions_list, input);
        this.authority.require('documents.read');
        return this.deps.subscriptions?.() ?? [];
      case 'ingestion_status':
        return this.ingestion().status(
          this.authority,
          parse(agentCommandSchemas.ingestion_status, input),
        );
      case 'ingestion_policy_save': {
        const request = parse(agentCommandSchemas.ingestion_policy_save, input);
        return this.ingestion().savePolicy(
          this.authority,
          request.expectedRevision,
          request.settings,
        );
      }
      case 'ingestion_item_control': {
        const request = parse(
          agentCommandSchemas.ingestion_item_control,
          input,
        );
        return this.ingestion().control(
          this.authority,
          request.snapshotId,
          request.expectedVersion,
          request.action,
        );
      }
      case 'documents_list': {
        const request = parse(agentCommandSchemas.documents_list, input);
        const result = await this.deps.documents.list();
        const all = result.documents
          .filter((d) =>
            [d.sourceKey, d.canonicalUri ?? ''].some((text) =>
              text
                .toLocaleLowerCase()
                .includes(request.text.toLocaleLowerCase()),
            ),
          )
          .sort(
            (a, b) =>
              b.capturedAt.localeCompare(a.capturedAt) ||
              b.snapshotId.localeCompare(a.snapshotId),
          );
        const page = all.filter(
          (d) =>
            !request.after ||
            d.capturedAt < request.after.capturedAt ||
            (d.capturedAt === request.after.capturedAt &&
              d.snapshotId < request.after.snapshotId),
        );
        const documents = page.slice(0, request.limit),
          last = documents.at(-1);
        return {
          status: 'ok',
          totalCount: all.length,
          documents,
          ...(page.length > request.limit && last
            ? {
                nextCursor: {
                  capturedAt: last.capturedAt,
                  snapshotId: last.snapshotId,
                },
              }
            : {}),
        };
      }
      case 'document_publication_status': {
        if (!this.deps.publication)
          throw new OperationError('rejected', 'publication_unavailable');
        return this.deps.publication.status(
          this.authority,
          parse(agentCommandSchemas.document_publication_status, input)
            .snapshotId,
        );
      }
      case 'document_publish': {
        if (!this.deps.publication)
          throw new OperationError('rejected', 'publication_unavailable');
        return this.deps.publication.confirm(
          this.authority,
          parse(documentPublishSchema, input),
        );
      }
      case 'document_read':
        return this.deps.documents.read(
          parse(agentCommandSchemas.document_read, input).snapshotId,
        );
      case 'entries_search': {
        const request = parse(agentCommandSchemas.entries_search, input);
        const decoded = decodeEntrySearchBody({
          ...request,
          includePrivate: false,
        });
        if (!decoded)
          throw new OperationError('invalid_input', 'invalid_request');
        return this.deps.entries.search(decoded);
      }
      case 'relations_read':
        return this.deps.relations.list(
          parse(agentCommandSchemas.relations_read, input).entryId,
        );
      case 'document_queue_status':
        parse(agentCommandSchemas.system_status, input);
        return new DocumentQueue(this.authority, this.deps).status();
      case 'document_queue_apply':
        return new DocumentQueue(this.authority, this.deps).apply(
          parse(documentQueueApplySchema, input),
        );
      case 'tasks_list': {
        const query = parse(agentCommandSchemas.tasks_list, input);
        return this.deps.tasks.list(
          this.authority,
          query.snapshotIds,
          query.prioritizeActive,
        );
      }
      case 'task_read':
        return this.deps.tasks.read(
          this.authority,
          parse(agentCommandSchemas.task_read, input).taskId,
        );
      case 'task_start': {
        const request = parse(agentCommandSchemas.task_start, input);
        return this.deps.tasks.start(
          this.authority,
          request.requestKey,
          request.request,
        );
      }
      case 'task_control': {
        const request = parse(agentCommandSchemas.task_control, input);
        return this.deps.tasks.control(
          this.authority,
          request.taskId,
          request.expectedVersion,
          request.action,
          request.regenerateSplit,
        );
      }
      default:
        throw new OperationError('invalid_input', 'unknown_agent_operation');
    }
  }
}
function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new OperationError('invalid_input', 'invalid_agent_input');
  return parsed.data;
}
