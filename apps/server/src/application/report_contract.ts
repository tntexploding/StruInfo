import {annotationFilterSchema} from '../modules/entries/structured_annotations.js';
import {z} from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const boundedTerms = z.array(z.string().trim().min(1).max(100)).max(16);
export const reportRequestSchema = z
  .object({
    kind: z.enum(['daily', 'weekly', 'monthly', 'topic']),
    cutoff: z.iso.datetime().optional(),
    annotationFilter: annotationFilterSchema.optional(),
    topicIds: z.array(z.uuid()).max(16).optional(),
    batchId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,100}$/u)
      .optional(),
    composition: z.enum(['ai', 'collection']).optional(),
    date,
    timeZone: z.string().trim().min(1).max(80),
    timeField: z.enum(['received', 'published']).default('received'),
    topics: boundedTerms.default([]),
    sources: boundedTerms.default([]),
    excludedEntryIds: z.array(z.uuid()).max(512).default([]),
    selectedEntryIds: z.array(z.uuid()).max(512).optional(),
    maxItems: z.number().int().min(0).max(512).default(6),
    maxModelCalls: z.number().int().min(2).max(20).default(12),
  })
  .strict();
export type ReportRequest = z.infer<typeof reportRequestSchema>;
export const reportSourceSchema = z
  .object({
    handle: z.number().int().min(1).max(512),
    entryId: z.uuid(),
    revision: z.number().int().positive(),
    snapshotId: z.uuid(),
    intakeSnapshotId: z.uuid(),
    title: z.string().max(4096),
    sourceKey: z.string().max(4096),
    url: z.string().max(4096).optional(),
    date,
    receivedDate: date.optional(),
    publishedDate: date.optional(),
    publicationInferred: z.boolean().optional(),
    excerpt: z.string().max(1200),
    frozenText: z
      .string()
      .max(24000)
      .refine((s) => Array.from(s).length <= 12000)
      .optional(),
    textTruncated: z.boolean().optional(),
    keywords: z.array(z.string().max(120)).max(64),
    reason: z.string().max(500),
  })
  .strict();
export type ReportSource = z.infer<typeof reportSourceSchema>;
const handles = z.array(z.number().int().min(1).max(512)).min(1).max(512);
export const reportGroupSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    sources: handles,
  })
  .strict();
export const reportPlanSchema = z
  .object({
    groups: z
      .array(reportGroupSchema.extend({recommended: z.boolean()}))
      .max(512),
  })
  .strict();
export const reportStorySchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    points: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(600),
            sources: handles,
            role: z.enum(['finding', 'evidence', 'limitation']).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();
export type ReportStory = z.infer<typeof reportStorySchema>;
export const reportItemSchema = z
  .object({
    group: reportGroupSchema,
    included: z.boolean(),
    draft: reportStorySchema.optional(),
    edited: reportStorySchema.optional(),
  })
  .strict();
export const reportStateSchema = z
  .object({
    request: reportRequestSchema,
    actor: z
      .object({kind: z.literal('owner'), id: z.string().max(128)})
      .strict(),
    title: z.string().trim().min(1).max(200),
    period: z.object({from: date, to: date}).strict(),
    sources: z.array(reportSourceSchema).max(512),
    totalEligible: z.number().int().nonnegative(),
    duplicateCount: z.number().int().nonnegative(),
    items: z.array(reportItemSchema).max(512),
    otherGroups: z.array(reportGroupSchema).max(512).optional(),
    planned: z.boolean(),
    status: z.enum([
      'draft',
      'queued',
      'running',
      'ready',
      'reviewed',
      'failed',
      'cancelled',
    ]),
    origin: z.enum(['internal_model', 'manual', 'search_results']).optional(),
    model: z.string().max(160).optional(),
    calls: z.number().int().min(0).max(20),
    errorCode: z
      .string()
      .regex(/^[a-z_]+$/u)
      .max(80)
      .optional(),
  })
  .strict();
export type ReportState = z.infer<typeof reportStateSchema>;
export interface ReportRecord {
  readonly reportId: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly state: ReportState;
}
export interface ReportRepository {
  read(reportId: string): Promise<ReportRecord | undefined>;
  list(prioritizeActive?: boolean): Promise<readonly ReportRecord[]>;
  listPriceDeferred?(): Promise<readonly ReportRecord[]>;
  save(
    reportId: string,
    expectedVersion: number,
    state: ReportState,
  ): Promise<boolean>;
  withLock<T>(reportId: string, action: () => Promise<T>): Promise<T>;
}
export interface ReportProvider {
  readonly model: string;
  plan(input: {
    kind: ReportRequest['kind'];
    sources: readonly Pick<
      ReportSource,
      | 'handle'
      | 'title'
      | 'excerpt'
      | 'keywords'
      | 'reason'
      | 'receivedDate'
      | 'publishedDate'
      | 'publicationInferred'
    >[];
  }): Promise<z.infer<typeof reportPlanSchema>>;
  summarize(input: {
    kind: ReportRequest['kind'];
    title: string;
    period: ReportState['period'];
    timeField: ReportRequest['timeField'];
    sources: readonly (Pick<
      ReportSource,
      | 'handle'
      | 'title'
      | 'receivedDate'
      | 'publishedDate'
      | 'publicationInferred'
    > & {text: string; textTruncated?: boolean})[];
  }): Promise<ReportStory>;
}
export const reportEditSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    items: z
      .array(
        z.object({included: z.boolean(), story: reportStorySchema}).strict(),
      )
      .min(1)
      .max(512),
    reviewed: z.boolean().default(false),
  })
  .strict();
export type ReportEdit = z.infer<typeof reportEditSchema>;
