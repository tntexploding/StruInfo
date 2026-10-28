import {z} from 'zod';
import {receptionSchema} from '../modules/subscriptions/source_receiving.js';

export const INTAKE_CONTENT_KINDS = [
  'article',
  'research',
  'reference',
  'event_notice',
  'promotion',
  'update_notice',
  'other',
] as const;
export const intakePolicySchema = z
  .object({
    fetchFullText: z.boolean().default(true),
    blockedKinds: z.array(z.enum(INTAKE_CONTENT_KINDS)).max(7).default([]),
    preferredTopics: z
      .array(z.string().trim().min(1).max(100))
      .max(16)
      .default([]),
    excludedTopics: z
      .array(z.string().trim().min(1).max(100))
      .max(16)
      .default([]),
  })
  .strict();
export type IntakePolicy = z.infer<typeof intakePolicySchema>;
export const intakeAssessmentSchema = z
  .object({
    completeness: z.enum(['complete', 'summary', 'uncertain']),
    contentKind: z.enum(INTAKE_CONTENT_KINDS),
    decision: z.enum(['admit', 'hold']),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type IntakeAssessment = z.infer<typeof intakeAssessmentSchema>;
export const inboxSummarySchema = z
  .object({
    text: z.string().trim().min(1).max(260),
    model: z.string().min(1).max(160),
    promptVersion: z.literal('struinfo.inbox-summary.v1'),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type InboxSummary = z.infer<typeof inboxSummarySchema>;
export interface InboxSummaryProvider {
  readonly model: string;
  summarizeInbox(input: {text: string}): Promise<{text: string}>;
}

export const intakeRecordValueSchema = z
  .object({
    reception: receptionSchema.optional(),
    // Receipt provenance is independent of the optional unattended-processing policy.
    captureOrigin: z
      .discriminatedUnion('kind', [
        z.object({kind: z.literal('upload')}).strict(),
        z
          .object({kind: z.literal('subscription'), subscriptionId: z.uuid()})
          .strict(),
      ])
      .optional(),
    // Derived reading metadata does not participate in receipt decision versions.
    inboxSummary: inboxSummarySchema.optional(),
    publication: z
      .object({
        origin: z.enum(['manual', 'external_agent', 'internal_ai']),
        draft: z.boolean().optional(),
        confirmedAt: z.iso.datetime(),
        entries: z
          .array(
            z
              .object({entryId: z.uuid(), revision: z.number().int().min(1)})
              .strict(),
          )
          .max(512),
      })
      .strict()
      .optional(),
    // Subscription receipt is an owner choice, independent of AI quality review.
    receipt: z.enum(['pending', 'accepted', 'rejected']).optional(),
    receiptOrigin: z.enum(['manual', 'model']).optional(),
    receiptTaskId: z.uuid().optional(),
    deferProcessing: z.boolean().optional(),
    decision: z.enum(['pending', 'admitted', 'held', 'blocked']),
    origin: z.enum(['system', 'model', 'manual']),
    reason: z.string().trim().max(500),
    manualReviewNote: z.string().trim().max(500).optional(),
    appliedManualReviews: z
      .array(
        z
          .object({snapshotId: z.uuid(), version: z.number().int().min(1)})
          .strict(),
      )
      .max(8)
      .optional(),
    preparedSnapshotId: z.uuid().optional(),
    bodySource: z.enum(['received', 'web_article']).optional(),
    previousPreparedSnapshotIds: z.array(z.uuid()).max(16).optional(),
    preparation: z.enum(['received', 'web_article']).default('received'),
    assessment: intakeAssessmentSchema.optional(),
    policy: intakePolicySchema.optional(),
    model: z.string().max(160).optional(),
  })
  .strict();
export type IntakeRecordValue = z.infer<typeof intakeRecordValueSchema>;
export interface IntakeRecord {
  readonly snapshotId: string;
  readonly version: number;
  readonly value: IntakeRecordValue;
  readonly updatedAt: string;
}
/** Missing bodySource preserves the selection made by older records. */
export function intakeTargetSnapshot(record: IntakeRecord): string {
  return record.value.bodySource === 'received'
    ? record.snapshotId
    : (record.value.preparedSnapshotId ?? record.snapshotId);
}
export function intakeSnapshotIds(record: IntakeRecord): string[] {
  return [
    record.snapshotId,
    ...(record.value.preparedSnapshotId
      ? [record.value.preparedSnapshotId]
      : []),
    ...(record.value.previousPreparedSnapshotIds ?? []),
  ];
}
export const intakePreparationSchema = z
  .object({
    source: z.enum(['received', 'web_article']),
    expectedVersion: z.number().int().min(0),
    refresh: z.boolean().default(false),
  })
  .strict()
  .refine((value) => !value.refresh || value.source === 'web_article');
export type IntakePreparation = z.infer<typeof intakePreparationSchema>;
export interface DocumentIntakeRepository {
  read(snapshotId: string): Promise<IntakeRecord | undefined>;
  list(): Promise<readonly IntakeRecord[]>;
  save(
    snapshotId: string,
    expectedVersion: number,
    value: IntakeRecordValue,
  ): Promise<boolean>;
  saveInboxSummary?(snapshotId: string, summary: InboxSummary): Promise<void>;
  withLock<T>(snapshotId: string, action: () => Promise<T>): Promise<T>;
}
export interface IntakeReviewInput {
  readonly text: string;
  readonly preparation: 'received' | 'web_article';
  readonly policy: IntakePolicy;
  readonly publishedAt?: string;
  readonly manualReviews?: readonly Readonly<{
    decision: 'accept' | 'reject';
    excerpt: string;
    ownerReason?: string;
    previousAiAssessment?: IntakeAssessment;
  }>[];
}
export const relationRecallPlanSchema = z
  .object({
    concepts: z
      .array(
        z
          .object({
            term: z.string().trim().min(1).max(80),
            variants: z.array(z.string().trim().min(1).max(80)).min(1).max(5),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
export type RelationRecallPlan = z.infer<typeof relationRecallPlanSchema>;
export interface RelationRecallInput {
  title: string;
  body: string;
  keywords: readonly string[];
}
export interface DocumentIntelligenceProvider {
  readonly model: string;
  reviewIntake(input: IntakeReviewInput): Promise<IntakeAssessment>;
  planRecall(input: RelationRecallInput): Promise<RelationRecallPlan>;
  /** Exactly one provider request, with independently grounded results in order. */
  planRecalls?(
    inputs: readonly RelationRecallInput[],
  ): Promise<readonly RelationRecallPlan[]>;
}
