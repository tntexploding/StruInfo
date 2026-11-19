import {z} from 'zod';

const path = z
  .string()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_-]{0,99}(?:\.[A-Za-z_][A-Za-z0-9_-]{0,99}){0,7}$/u,
  );
const parameter = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/u);

export const jsonSourceOptionsSchema = z.object({
  requestAsAjax: z.boolean().optional(),
  pollingCursor: z
    .object({
      queryParameter: parameter,
      recordPath: path.optional(),
      responsePath: path.optional(),
    })
    .strict()
    .refine(
      (value) => Boolean(value.recordPath) !== Boolean(value.responsePath),
      'choose_one_cursor_path',
    )
    .optional(),
  timeZoneOffset: z
    .string()
    .regex(/^(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/u)
    .optional(),
  paidContentPath: path.optional(),
  querySignature: z
    .object({algorithm: z.literal('sha1_md5'), parameter})
    .strict()
    .optional(),
});
export type JsonSourceOptions = z.infer<typeof jsonSourceOptionsSchema>;
