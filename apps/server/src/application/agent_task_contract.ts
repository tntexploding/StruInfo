import {z} from 'zod';
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
      .max(12),
  })
  .strict();
export const agentRelationResultSchema = z
  .object({
    summary: z.string().trim().min(1).max(240),
    relationLabel: z.string().trim().min(1).max(80),
    direction: z.enum(['symmetric', 'low_to_high', 'high_to_low']),
  })
  .strict();
export const agentTaskRequestSchema = z.discriminatedUnion('kind', [
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
                  startOrdinal: z.number().int().min(0).max(63),
                  endOrdinal: z.number().int().min(0).max(63),
                })
                .strict(),
            )
            .min(1)
            .max(24),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('document'),
      snapshotId: id,
      maxEntries: z.number().int().min(1).max(24).default(12),
      maxRelations: z.number().int().min(0).max(8).default(4),
      maxModelCalls: z.number().int().min(1).max(64).default(24),
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
]);
export type AgentTaskRequest = z.infer<typeof agentTaskRequestSchema>;
export const agentTaskStepSchema = z
  .object({
    kind: z.enum(['split', 'tags', 'relation']),
    targetId: id,
    relatedEntryId: id.optional(),
    expectedRevision: version.optional(),
    expectedRelatedRevision: version.optional(),
    expectedOverrideRevision: z.number().int().min(0).optional(),
    attempt: z.number().int().min(0).max(64),
    runId: id.optional(),
    proposalId: id.optional(),
    complete: z.boolean(),
  })
  .strict();
export type AgentTaskStep = z.infer<typeof agentTaskStepSchema>;
export const agentTaskStateSchema = z
  .object({
    status: z.enum([
      'queued',
      'running',
      'paused',
      'failed',
      'succeeded',
      'cancelled',
    ]),
    calls: z.number().int().min(0).max(64),
    phase: z.enum(['split', 'tags', 'relations', 'complete']),
    steps: z.array(agentTaskStepSchema).max(64),
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
  list(workspaceId: string): Promise<readonly AgentTask[]>;
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
