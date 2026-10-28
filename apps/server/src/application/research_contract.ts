import {z} from 'zod';
import {reportRequestSchema} from './report_contract.js';

const id = z.uuid();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u);
export const researchSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    dailyRequests: z.number().int().min(1).max(200).default(20),
    resultLimit: z.number().int().min(1).max(8).default(5),
    fetchMissing: z.boolean().default(false),
    notices: z
      .object({
        enabled: z.boolean().default(false),
        sources: z.array(z.string().min(1).max(200)).max(32).default([]),
        urgentTerms: z.array(z.string().min(2).max(80)).max(16).default([]),
        timeZone: z.string().min(1).max(80).default('Asia/Shanghai'),
        quietFrom: time.default('22:00'),
        quietTo: time.default('08:00'),
        intervalMinutes: z.number().int().min(1).max(1440).default(60),
      })
      .strict()
      .default({
        enabled: false,
        sources: [],
        urgentTerms: [],
        timeZone: 'Asia/Shanghai',
        quietFrom: '22:00',
        quietTo: '08:00',
        intervalMinutes: 60,
      }),
  })
  .strict();
export type ResearchSettings = z.infer<typeof researchSettingsSchema>;
export const scheduleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
    timeZone: z.string().min(1).max(80),
    localTime: time,
    cadence: z.enum(['daily', 'weekly', 'monthly']),
    missed: z.enum(['once', 'skip']),
    publish: z.boolean().default(false),
    request: reportRequestSchema,
  })
  .strict();
export type ReportSchedule = z.infer<typeof scheduleSchema>;
const settingsValue = z
  .object({
    kind: z.literal('settings'),
    settings: researchSettingsSchema,
    watchSince: z.iso.datetime(),
  })
  .strict();
const scheduleValue = z
  .object({
    kind: z.literal('schedule'),
    schedule: scheduleSchema,
    activatedAt: z.iso.datetime(),
  })
  .strict();
const runValue = z
  .object({
    kind: z.literal('run'),
    scheduleId: id,
    scheduleVersion: z.number().int().positive(),
    slot: z.string().max(40),
    cutoff: z.iso.datetime(),
    request: reportRequestSchema,
    publish: z.boolean(),
    status: z.enum([
      'queued',
      'generating',
      'ready',
      'published',
      'failed',
      'skipped',
      'paused',
    ]),
    reportId: id.optional(),
    errorCode: z.string().max(160).optional(),
  })
  .strict();
const noticeValue = z
  .object({
    kind: z.literal('notice'),
    category: z.enum(['report', 'content']),
    title: z.string().max(4096),
    entryIds: z.array(id).max(512),
    reportId: id.optional(),
    reportVersion: z.number().int().positive().optional(),
    markdown: z.string().max(700000).optional(),
    eventKey: z.string().max(500),
    fingerprint: z.string().max(64),
    correction: z.boolean(),
    urgent: z.boolean(),
    read: z.boolean(),
    visibleAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  })
  .strict();
const chargeValue = z
  .object({
    kind: z.literal('charge'),
    operation: z.enum(['search', 'fetch']),
    at: z.iso.datetime(),
    status: z.enum(['reserved', 'charged', 'free', 'unknown']),
    estimatedCny: z.number().min(0).max(1),
  })
  .strict();
export const researchRecordValueSchema = z.discriminatedUnion('kind', [
  settingsValue,
  scheduleValue,
  runValue,
  noticeValue,
  chargeValue,
]);
export type ResearchValue = z.infer<typeof researchRecordValueSchema>;
export interface ResearchRecord {
  id: string;
  version: number;
  updatedAt: string;
  value: ResearchValue;
}
export interface ResearchRepository {
  read(id: string): Promise<ResearchRecord | undefined>;
  list(kind: ResearchValue['kind']): Promise<ResearchRecord[]>;
  save(
    writes: readonly {
      id: string;
      expectedVersion: number;
      value: ResearchValue;
    }[],
  ): Promise<boolean>;
  withLock<T>(action: () => Promise<T>): Promise<T>;
}
export interface WebEvidence {
  title: string;
  url: string;
  summary: string;
  content: string;
  publishedAt?: string;
  retrievedAt: string;
  contentKind: 'body' | 'summary';
}
export interface WebSearchProvider {
  search(query: string, count: number): Promise<WebEvidence[]>;
  fetch(url: string): Promise<WebEvidence>;
}
export const researchReadSchemas = {
  research_status: z.object({}).strict(),
  report_pipeline_status: z.object({}).strict(),
};
export const researchCommandSchemas = {
  ...researchReadSchemas,
  web_search: z
    .object({
      requestKey: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/u),
      query: z
        .string()
        .trim()
        .min(1)
        .max(256)
        .refine((s) => Array.from(s).length <= 128),
    })
    .strict(),
  web_capture: z
    .object({sessionId: id, index: z.number().int().min(0).max(7)})
    .strict(),
  research_answer: z
    .object({
      requestKey: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/u),
      question: z.string().trim().min(1).max(600),
      mode: z.enum(['local', 'web', 'mixed']),
      webQuery: z
        .string()
        .trim()
        .min(1)
        .max(256)
        .refine((s) => Array.from(s).length <= 128)
        .optional(),
      query: z.record(z.string(), z.unknown()),
    })
    .strict(),
};
export const researchOwnerSchemas = {
  research_settings_save: z
    .object({
      expectedVersion: z.number().int().min(0),
      settings: researchSettingsSchema,
    })
    .strict(),
  report_schedule_save: z
    .object({
      id: id,
      expectedVersion: z.number().int().min(0),
      schedule: scheduleSchema,
    })
    .strict(),
  report_publish: z
    .object({reportId: id, expectedVersion: z.number().int().positive()})
    .strict(),
  notice_read: z
    .object({id: id, expectedVersion: z.number().int().positive()})
    .strict(),
};
