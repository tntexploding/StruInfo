import {z} from 'zod';

/** Owner-authored source hints are workspace data, never executable rules. */
export const sourceProcessingProfileSchema = z
  .object({
    split: z.string().max(4000),
    tags: z.string().max(4000),
    relations: z.string().max(4000),
    accent: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/u)
      .default('#c4b08b'),
  })
  .strict();
export type SourceProcessingProfile = z.infer<
  typeof sourceProcessingProfileSchema
>;
