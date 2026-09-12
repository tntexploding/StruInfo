import {z} from 'zod';
import type {AgentTask} from './agent_task_contract.js';

export const INGESTION_ACTOR_ID = 'new-materials-policy';
export const ingestionSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    paused: z.boolean().default(false),
    subscriptionIds: z.array(z.uuid()).max(128).default([]),
    manualUploads: z.boolean().default(false),
    model: z.string().trim().max(160).default(''),
    maxEntries: z.number().int().min(1).max(24).default(12),
    maxRelations: z.number().int().min(0).max(8).default(4),
    maxModelCalls: z.number().int().min(1).max(64).default(24),
    maxDocumentsPerDay: z.number().int().min(1).max(100).default(10),
  })
  .strict()
  .refine((s) => new Set(s.subscriptionIds).size === s.subscriptionIds.length);
export type IngestionSettings = z.infer<typeof ingestionSettingsSchema>;
export interface IngestionPolicy {
  readonly revision: number;
  readonly authorizedBy?: Readonly<{
    kind: 'owner' | 'external_agent';
    id: string;
  }>;
  readonly settings: IngestionSettings;
}
export type IngestionOrigin =
  | Readonly<{kind: 'upload'}>
  | Readonly<{kind: 'subscription'; subscriptionId: string}>;
export type IngestionStatus =
  'pending' | 'running' | 'paused' | 'attention' | 'completed' | 'taken_over';
export interface IngestionItem {
  readonly snapshotId: string;
  readonly sourceLabel?: string;
  readonly origin: IngestionOrigin;
  readonly policy: IngestionPolicy;
  readonly status: IngestionStatus;
  readonly taskId?: string;
  readonly errorCode?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly admittedAt?: string;
}
export const EMPTY_INGESTION_POLICY: IngestionPolicy = Object.freeze({
  revision: 0,
  settings: Object.freeze(ingestionSettingsSchema.parse({})),
});
export function ingestionScopeMatches(
  settings: IngestionSettings,
  origin: IngestionOrigin,
): boolean {
  return origin.kind === 'upload'
    ? settings.manualUploads
    : settings.subscriptionIds.includes(origin.subscriptionId);
}
export function ingestionTaskKey(snapshotId: string) {
  return 'ingest-' + snapshotId;
}
export const ingestionStatusQuerySchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
    status: z
      .enum([
        'pending',
        'running',
        'paused',
        'attention',
        'completed',
        'taken_over',
      ])
      .optional(),
    after: z
      .object({
        createdAt: z
          .string()
          .max(40)
          .refine(
            (v) =>
              /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)),
          ),
        snapshotId: z.uuid(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type IngestionStatusQuery = z.infer<typeof ingestionStatusQuerySchema>;
export interface IngestionRepository {
  summary?(): Promise<{
    counts: Readonly<Record<string, number>>;
    admittedToday: number;
    modelAttempts: number;
  }>;

  policy(): Promise<IngestionPolicy>;
  savePolicy(
    expectedRevision: number,
    settings: IngestionSettings,
    authorizedBy: NonNullable<IngestionPolicy['authorizedBy']>,
  ): Promise<boolean>;
  read(snapshotId: string): Promise<IngestionItem | undefined>;
  list(
    activeOnly: boolean,
    limit: number,
    after?: IngestionStatusQuery['after'],
    status?: IngestionStatus,
  ): Promise<readonly IngestionItem[]>;
  update(
    snapshotId: string,
    expectedVersion: number,
    status: IngestionStatus,
    taskId?: string,
    errorCode?: string,
  ): Promise<boolean>;
  reserve(snapshotId: string, maximum: number): Promise<boolean>;
  withPollLock(action: () => Promise<void>): Promise<void>;
}
export interface IngestionTaskPort {
  start: (snapshotId: string, policy: IngestionPolicy) => Promise<AgentTask>;
  read: (taskId: string) => Promise<AgentTask & {runtimeStatus: string}>;
  resume: (task: AgentTask) => Promise<unknown>;
  cancel: (task: AgentTask) => Promise<unknown>;
}
