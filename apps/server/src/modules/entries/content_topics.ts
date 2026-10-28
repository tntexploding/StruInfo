import {z} from 'zod';
import {createHash} from 'node:crypto';
import type {CurrentInformationEntry} from './information_entry_contract.js';

export const TOPIC_RULE_VERSION = 'topics.v1';
const id = z.uuid();
export const topicScopeSchema = z
  .object({
    entryId: id,
    candidateLimit: z.number().int().min(1).max(12).default(8),
    maxRelations: z.number().int().min(0).max(4).default(0),
    publishedFrom: z.iso.datetime().optional(),
    publishedTo: z.iso.datetime().optional(),
    crossConditions: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) =>
      !v.publishedFrom || !v.publishedTo || v.publishedFrom <= v.publishedTo,
  );
export type TopicScope = z.infer<typeof topicScopeSchema>;
export const topicEvidenceSchema = z
  .object({
    entryId: id,
    revision: z.number().int().positive(),
    quote: z.string().trim().min(1).max(2000),
  })
  .strict();
export const topicMemberSchema = topicEvidenceSchema.extend({
  reason: z.string().trim().min(1).max(500),
  decision: z.enum(['included', 'pinned', 'excluded']),
  origin: z.enum(['ai', 'manual', 'external_agent']),
});
export const topicRelationSchema = z
  .object({
    from: topicEvidenceSchema,
    to: topicEvidenceSchema,
    kind: z.enum(['supports', 'contradicts', 'continues', 'replaces']),
    reason: z.string().trim().min(1).max(500),
    origin: z.enum(['ai', 'manual', 'external_agent']),
    blocked: z.boolean(),
  })
  .strict();
export const topicValueSchema = z
  .object({
    kind: z.literal('topic'),
    name: z.string().trim().min(1).max(160),
    scope: z.string().trim().min(1).max(800),
    origin: z.enum(['ai', 'manual', 'external_agent']),
    members: z.array(topicMemberSchema).max(256),
    relations: z.array(topicRelationSchema).max(64),
    summary: z.string().max(2000),
    summaryVersions: z
      .array(
        z.object({entryId: id, revision: z.number().int().positive()}).strict(),
      )
      .max(256),
    ruleVersion: z.string().max(80),
  })
  .strict();
export type TopicValue = z.infer<typeof topicValueSchema>;
export const topicResponseSchema = z
  .object({
    topics: z
      .array(
        z
          .object({
            topicId: id.nullable(),
            name: z.string().trim().min(1).max(160),
            scope: z.string().trim().min(1).max(800),
            summary: z.string().max(2000),
            members: z
              .array(
                topicEvidenceSchema.extend({
                  reason: z.string().trim().min(1).max(500),
                }),
              )
              .min(2)
              .max(12),
          })
          .strict(),
      )
      .max(4),
    relations: z
      .array(topicRelationSchema.omit({origin: true, blocked: true}))
      .max(4),
    note: z.string().max(500),
  })
  .strict();
export type TopicResponse = z.infer<typeof topicResponseSchema>;
export interface TopicCandidate {
  entryId: string;
  revision: number;
  title: string;
  source: string;
  score: number;
  reasons: string[];
  samples: number;
  uncertain: boolean;
}
export const topicInputEntrySchema = z
  .object({
    entryId: id,
    revision: z.number().int().positive(),
    snapshotId: id,
    source: z.string(),
    publishedAt: z.string().nullable(),
    title: z.string(),
    body: z.string(),
    ownerRelationGuidance: z.string().max(4000).optional(),
    labels: z.array(
      z.object({id: z.string(), label: z.string(), role: z.string()}).strict(),
    ),
  })
  .strict();
export const topicInputSchema = z
  .object({
    ruleVersion: z.string(),
    scope: topicScopeSchema,
    vocabularyRevision: z.number().int().nonnegative(),
    entries: z.array(topicInputEntrySchema).min(1).max(12),
    topics: z
      .array(
        z
          .object({
            id,
            version: z.number().int().positive(),
            value: topicValueSchema,
          })
          .strict(),
      )
      .max(8),
    protectedPairs: z.array(z.string()).max(512),
  })
  .strict();
export type TopicInput = z.infer<typeof topicInputSchema>;
export const topicUsageSchema = z
  .object({
    id,
    batchId: z.string(),
    reservedNanoCny: z.number().int().nonnegative(),
    chargedNanoCny: z.number().int().nonnegative().optional(),
    usageKnown: z.boolean().optional(),
  })
  .strict();
export type TopicUsage = z.infer<typeof topicUsageSchema>;
export const topicJobSchema = z
  .object({
    kind: z.literal('job'),
    input: topicInputSchema,
    fingerprint: z.string().length(64),
    candidates: z.array(
      z
        .object({
          entryId: id,
          revision: z.number(),
          title: z.string(),
          source: z.string(),
          score: z.number(),
          reasons: z.array(z.string()),
          samples: z.number(),
          uncertain: z.boolean(),
        })
        .strict(),
    ),
    budgetId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/u),
    status: z.enum([
      'queued',
      'running',
      'succeeded',
      'failed',
      'paused',
      'cancelled',
    ]),
    attempts: z.number().int().nonnegative(),
    maxAttempts: z.number().int().min(1).max(4),
    usage: z.array(topicUsageSchema).max(4),
    errorCode: z.string().max(160).optional(),
    result: topicResponseSchema.optional(),
    appliedTopicIds: z.array(id).default([]),
  })
  .strict();
export type TopicJob = z.infer<typeof topicJobSchema>;
export const topicRecordValueSchema = z.discriminatedUnion('kind', [
  topicValueSchema,
  topicJobSchema,
]);
export type TopicRecordValue = z.infer<typeof topicRecordValueSchema>;
export interface TopicRecord {
  id: string;
  version: number;
  updatedAt: string;
  value: TopicRecordValue;
}
export interface TopicRepository {
  read(id: string): Promise<TopicRecord | undefined>;
  list(kind: 'topic' | 'job'): Promise<TopicRecord[]>;
  save(
    writes: readonly {
      id: string;
      expectedVersion: number;
      value: TopicRecordValue;
    }[],
  ): Promise<boolean>;
  withLock<T>(action: () => Promise<T>): Promise<T>;
}
export interface TopicProvider {
  generate(
    input: TopicInput,
    budgetId: string,
    onUsage: (usage: TopicUsage) => Promise<void>,
  ): Promise<TopicResponse>;
}
export function topicFingerprint(input: TopicInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        ...input,
        topics: input.topics
          .filter(
            (t) =>
              t.value.origin !== 'ai' ||
              t.value.members.some((m) => m.origin !== 'ai') ||
              t.value.relations.some((r) => r.origin !== 'ai'),
          )
          .map((t) => ({
            id: t.id,
            name: t.value.origin !== 'ai' ? t.value.name : undefined,
            scope: t.value.origin !== 'ai' ? t.value.scope : undefined,
            members: t.value.members.filter((m) => m.origin !== 'ai'),
            relations: t.value.relations.filter((r) => r.origin !== 'ai'),
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      }),
    )
    .digest('hex');
}
export function topicPair(a: string, b: string): string {
  return [a, b].sort().join(':');
}
export function checkTopicEvidence(
  value: z.infer<typeof topicEvidenceSchema>,
  entries: readonly {entryId: string; revision: number; body: string}[],
) {
  const entry = entries.find((e) => e.entryId === value.entryId);
  if (entry?.revision !== value.revision || !entry.body.includes(value.quote))
    throw new Error('topic_evidence_changed');
}
export function topicSummaryStale(
  topic: TopicValue,
  entries: readonly CurrentInformationEntry[],
): boolean {
  const members = topic.members.filter((m) => m.decision !== 'excluded');
  return (
    !topic.summary ||
    members.length !== topic.summaryVersions.length ||
    members.some(
      (m) =>
        !topic.summaryVersions.some(
          (v) => v.entryId === m.entryId && v.revision === m.revision,
        ) ||
        !entries.some(
          (e) => e.entryId === m.entryId && e.revision === m.revision,
        ),
    )
  );
}
