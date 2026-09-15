import {z} from 'zod';
import {reportEditSchema, reportRequestSchema} from './report_contract.js';
import type {ReportService} from './report_service.js';
import type {ExecutionAuthority} from './execution_authority.js';
import {OperationError} from './operation_error.js';

const selected = z.object({reportId: z.uuid()}).strict();
const versioned = {
  reportId: z.uuid(),
  expectedVersion: z.number().int().positive(),
};
export const reportReadCommandSchemas = {
  report_preview: reportRequestSchema,
  reports_list: z.object({}).strict(),
  report_read: selected,
  report_export: selected,
};
export const reportOwnerCommandSchemas = {
  report_create: z
    .object({
      requestKey: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/u),
      request: reportRequestSchema,
    })
    .strict(),
  report_generate: z.object(versioned).strict(),
  report_cancel: z.object(versioned).strict(),
  report_edit: z.object({...versioned, edit: reportEditSchema}).strict(),
};
export const REPORT_OPERATIONS = Object.freeze([
  ...Object.keys(reportReadCommandSchemas),
  ...Object.keys(reportOwnerCommandSchemas),
]);
export class ReportCommands {
  public constructor(
    private readonly authority: ExecutionAuthority,
    private readonly reports: ReportService,
  ) {}
  public async execute(name: string, input: unknown) {
    switch (name) {
      case 'report_preview':
        return this.reports.preview(
          this.authority,
          parse(reportReadCommandSchemas.report_preview, input),
        );
      case 'reports_list':
        parse(reportReadCommandSchemas.reports_list, input);
        return this.reports.list(this.authority);
      case 'report_read':
        return this.reports.read(
          this.authority,
          parse(selected, input).reportId,
        );
      case 'report_export':
        return this.reports.export(
          this.authority,
          parse(selected, input).reportId,
        );
      case 'report_create': {
        const r = parse(reportOwnerCommandSchemas.report_create, input);
        return this.reports.create(this.authority, r.requestKey, r.request);
      }
      case 'report_generate': {
        const r = parse(reportOwnerCommandSchemas.report_generate, input);
        return this.reports.generate(
          this.authority,
          r.reportId,
          r.expectedVersion,
        );
      }
      case 'report_cancel': {
        const r = parse(reportOwnerCommandSchemas.report_cancel, input);
        return this.reports.cancel(
          this.authority,
          r.reportId,
          r.expectedVersion,
        );
      }
      case 'report_edit': {
        const r = parse(reportOwnerCommandSchemas.report_edit, input);
        return this.reports.edit(
          this.authority,
          r.reportId,
          r.expectedVersion,
          r.edit,
        );
      }
      default:
        throw new OperationError('invalid_input', 'unknown_report_operation');
    }
  }
}
function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success)
    throw new OperationError('invalid_input', 'invalid_report_input');
  return r.data;
}
