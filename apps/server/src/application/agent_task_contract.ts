import {
  frozenSourceSplitSchema,
  sourceSplitDecisionSchema,
} from '../modules/entries/source_split_recipe.js';
import {
  MAXIMUM_AI_SPLIT_ENTRIES,
  MAXIMUM_AI_SPLIT_FRAGMENTS,
} from '../modules/processing/ai_split_proposal.js';
import {z} from 'zod';
import {
  intakePolicySchema,
  relationRecallPlanSchema,
} from './document_intake_contract.js';
import {
  ENTRY_TYPE_KEYWORDS,
  ENTRY_DOMAIN_KEYWORDS,
} from '../modules/entries/index.js';

const id = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
const version = z.number().int().min(1).max(2147483646);
export const agentTagResultSchema = z
  .object({
    summary: z.string().trim().min(1).max(240),
    contentKeywords: z.array(z.string().trim().min(1).max(120)).max(24),
    typeKeyword: z.enum(ENTRY_TYPE_KEYWORDS),
    typeCustomName: z.string().trim().min(1).max(120).optional(),
    domains: z
      .array(
        z
          .object({
            keyword: z.enum(ENTRY_DOMAIN_KEYWORDS),
            customName: z.string().trim().min(1).max(120).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();
export const agentRelationResultSchema = z
  .object({
    summary: z.string().trim().min(1).max(240),
    relationLabel: z.string().trim().min(1).max(80),
    direction: z.enum(['symmetric', 'low_to_high', 'high_to_low']),
  })
  .strict();
/** Historical task payloads remain readable; active writes use the schema below. */
export const storedAgentTaskRequestSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('intake'),
        snapshotId: id,
        expectedVersion: version,
        intake: intakePolicySchema,
        maxModelCalls: z.number().int().min(1).max(3).default(3),
      })
      .strict(),
    z
      .object({
        kind: z.literal('split'),
        snapshotId: id,
        result: z
          .object({
            summary: z.string().trim().min(1).max(240),
            groups: z
              .array(
                z
                  .object({
                    titlePath: z.string().trim().min(1).max(240),
                    startOrdinal: z
                      .number()
                      .int()
                      .min(0)
                      .max(MAXIMUM_AI_SPLIT_FRAGMENTS - 1),
                    endOrdinal: z
                      .number()
                      .int()
                      .min(0)
                      .max(MAXIMUM_AI_SPLIT_FRAGMENTS - 1),
                  })
                  .strict(),
              )
              .min(1)
              .max(MAXIMUM_AI_SPLIT_ENTRIES),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('document'),
        reprocess: z.literal('tags').optional(),
        expectedReceiptVersion: version.optional(),
        snapshotId: id,
        maxEntries: z
          .number()
          .int()
          .min(1)
          .max(MAXIMUM_AI_SPLIT_ENTRIES)
          .default(12),
        maxRelations: z.number().int().min(0).max(8).default(0),
        maxModelCalls: z.number().int().min(1).max(64).default(24),
        intake: intakePolicySchema.optional(),
        maxRelationCandidates: z.number().int().min(0).max(24).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('tags'),
        entryId: id,
        expectedRevision: version,
        result: agentTagResultSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal('relation'),
        entryId: id,
        relatedEntryId: id,
        expectedRevision: version,
        expectedRelatedRevision: version,
        expectedOverrideRevision: z.number().int().min(0).max(2147483646),
        result: agentRelationResultSchema,
      })
      .strict(),
  ])
  .refine(
    (request) => Buffer.byteLength(JSON.stringify(request), 'utf8') <= 32_768,
    {message: 'Task request exceeds the 32 KiB storage limit.'},
  );
export const agentTaskRequestSchema = storedAgentTaskRequestSchema.refine(
  (request) =>
    request.kind !== 'document' ||
    (request.maxRelations === 0 && !request.maxRelationCandidates),
  {message: 'Document publication does not run relations. Use a topic job.'},
);
export type AgentTaskRequest = z.infer<typeof storedAgentTaskRequestSchema>;
export const DOCUMENT_WORKFLOW = 'confirmed-content-v1' as const;
export const agentTaskStepSchema = z
  .object({
    sourceSplit: sourceSplitDecisionSchema.optional(),
    kind: z.enum(['intake', 'split', 'tags', 'recall', 'relation']),
    targetId: id,
    relatedEntryId: id.optional(),
    expectedRevision: version.optional(),
    expectedRelatedRevision: version.optional(),
    expectedOverrideRevision: z.number().int().min(0).optional(),
    attempt: z.number().int().min(0).max(64),
    runId: id.optional(),
    reviewRunId: id.optional(),
    reviewAttempt: z.number().int().min(0).max(3).optional(),
    previousRunIds: z.array(id).max(3).optional(),
    proposalId: id.optional(),
    complete: z.boolean(),
    outcome: z
      .enum(['no_relation', 'edge_budget_reached', 'accepted', 'held'])
      .optional(),
    receiptVersion: version.optional(),
    recallPlan: relationRecallPlanSchema.optional(),
    candidateReasons: z.array(z.string().max(240)).max(12).optional(),
  })
  .strict();
export type AgentTaskStep = z.infer<typeof agentTaskStepSchema>;
export const agentTaskStateSchema = z
  .object({
    workflow: z.literal(DOCUMENT_WORKFLOW).optional(),
    sourceSplit: frozenSourceSplitSchema.optional(),
    status: z.enum([
      'queued',
      'running',
      'paused',
      'failed',
      'succeeded',
      'cancelled',
    ]),
    calls: z.number().int().min(0).max(64),
    relationReviewRequired: z.boolean().optional(),
    supersededBy: id.optional(),
    automaticRetry: z
      .object({
        limit: z.number().int().min(1).max(2),
        used: z.number().int().min(0).max(2),
        notBefore: z.iso.datetime().optional(),
      })
      .strict()
      .optional(),
    recovery: z
      .object({
        previousTaskId: id,
        firstStartedAt: z.iso.datetime(),
        previousCalls: z.number().int().min(0),
      })
      .strict()
      .optional(),
    phase: z.enum([
      'intake',
      'split',
      'tags',
      'recall',
      'relations',
      'publish',
      'complete',
    ]),
    // Intake and split, then tags/recall per Entry and up to 24 relation candidates.
    steps: z
      .array(agentTaskStepSchema)
      .max(2 + 2 * MAXIMUM_AI_SPLIT_ENTRIES + 24),
    errorCode: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,119}$/u)
      .optional(),
  })
  .strict();
export type AgentTaskState = z.infer<typeof agentTaskStateSchema>;
export interface AgentTask {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly actorKind: 'owner' | 'external_agent' | 'automation';
  readonly actorId: string;
  readonly policyVersion: 'struinfo.agent-task.v1';
  readonly requestKey: string;
  readonly request: AgentTaskRequest;
  readonly model: string;
  readonly state: AgentTaskState;
  readonly pauseRequested: boolean;
  readonly cancelRequested: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface AgentTaskRepository {
  create(task: AgentTask): Promise<boolean>;
  read(workspaceId: string, taskId: string): Promise<AgentTask | undefined>;
  list(
    workspaceId: string,
    snapshotIds?: readonly string[],
    prioritizeActive?: boolean,
  ): Promise<readonly AgentTask[]>;
  listPublicationTasks?(workspaceId: string): Promise<readonly AgentTask[]>;
  listPriceDeferred?(workspaceId: string): Promise<readonly AgentTask[]>;
  listRetryDeferred?(workspaceId: string): Promise<readonly AgentTask[]>;
  saveState(
    workspaceId: string,
    taskId: string,
    state: AgentTaskState,
  ): Promise<void>;
  control(
    workspaceId: string,
    taskId: string,
    version: number,
    action: 'pause' | 'resume' | 'cancel',
  ): Promise<boolean>;
  withLock<T>(
    workspaceId: string,
    taskId: string,
    action: () => Promise<T>,
  ): Promise<T>;
}
