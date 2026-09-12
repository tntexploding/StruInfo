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
export const agentCommandSchemas = {
  system_status: z.object({}).strict(),
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
  entries_search: z
    .object({
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
  tasks_list: z.object({}).strict(),
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
    })
    .strict(),
};
export type AgentCommandName = keyof typeof agentCommandSchemas;
export interface AgentCommandDependencies {
  readonly capture?: AgentCaptureService;
  readonly runtimeStatus?: Readonly<{
    model?: string;
    role: string;
    agentEnabled: boolean;
    grants: readonly string[];
  }>;
  readonly ingestion?: IngestionService;
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
  private ingestion() {
    if (!this.deps.ingestion)
      throw new OperationError('rejected', 'ingestion_unavailable');
    return this.deps.ingestion;
  }
  public async execute(name: string, input: unknown): Promise<unknown> {
    switch (name) {
      case 'system_status':
        parse(agentCommandSchemas.system_status, input);
        this.authority.require('processing.read');
        return (
          this.deps.runtimeStatus ?? {
            role: 'unknown',
            agentEnabled: false,
            grants: [],
          }
        );
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
      case 'tasks_list':
        parse(agentCommandSchemas.tasks_list, input);
        return this.deps.tasks.list(this.authority);
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
