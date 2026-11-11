import {z} from 'zod';
import {MAXIMUM_AI_SPLIT_ENTRIES} from '../processing/ai_split_proposal.js';

export const sourceSplitRoutingSchema = z
  .object({
    samplesPerFormat: z.number().int().min(2).max(12).default(3),
    sampleLimit: z.number().int().min(2).max(96).default(24),
    minimumScore: z.number().min(1).max(100).default(80),
    minimumMargin: z.number().min(1).max(100).default(10),
    reviewWindow: z.number().int().min(5).max(100).default(20),
    lowScoreRate: z.number().min(0.01).max(1).default(0.3),
  })
  .strict()
  .refine((v) => v.sampleLimit >= v.samplesPerFormat);
export type SourceSplitRouting = z.infer<typeof sourceSplitRoutingSchema>;
export const DEFAULT_SOURCE_SPLIT_ROUTING = sourceSplitRoutingSchema.parse({});

/** Owner-authored source hints are workspace data, never executable rules. */
export const sourceProcessingProfileSchema = z
  .object({
    maxEntriesPerDocument: z
      .number()
      .int()
      .min(1)
      .max(MAXIMUM_AI_SPLIT_ENTRIES)
      .optional(),
    split: z.string().max(4000),
    tags: z.string().max(4000),
    relations: z.string().max(4000),
    splitRouting: sourceSplitRoutingSchema.optional(),
    accent: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/u)
      .default('#c4b08b'),
  })
  .strict();
export type SourceProcessingProfile = z.infer<
  typeof sourceProcessingProfileSchema
>;
