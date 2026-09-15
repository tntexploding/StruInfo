import {z} from 'zod';

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
export const intakeRecordValueSchema = z
  .object({
    decision: z.enum(['pending', 'admitted', 'held', 'blocked']),
    origin: z.enum(['system', 'model', 'manual']),
    reason: z.string().trim().max(500),
    preparedSnapshotId: z.uuid().optional(),
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
export interface DocumentIntakeRepository {
  read(snapshotId: string): Promise<IntakeRecord | undefined>;
  list(): Promise<readonly IntakeRecord[]>;
  save(
    snapshotId: string,
    expectedVersion: number,
    value: IntakeRecordValue,
  ): Promise<boolean>;
  withLock<T>(snapshotId: string, action: () => Promise<T>): Promise<T>;
}
export interface IntakeReviewInput {
  readonly text: string;
  readonly preparation: 'received' | 'web_article';
  readonly policy: IntakePolicy;
  readonly publishedAt?: string;
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
export interface DocumentIntelligenceProvider {
  readonly model: string;
  reviewIntake(input: IntakeReviewInput): Promise<IntakeAssessment>;
  planRecall(input: {
    title: string;
    body: string;
    keywords: readonly string[];
  }): Promise<RelationRecallPlan>;
}
