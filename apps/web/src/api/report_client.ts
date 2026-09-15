export interface ReportRequest {
  kind: 'daily' | 'weekly';
  date: string;
  timeZone: string;
  timeField: 'received' | 'published';
  topics: string[];
  sources: string[];
  excludedEntryIds: string[];
  selectedEntryIds?: string[];
  maxItems: number;
  maxModelCalls: number;
}
export interface ReportSource {
  handle: number;
  entryId: string;
  revision: number;
  snapshotId: string;
  intakeSnapshotId: string;
  title: string;
  sourceKey: string;
  url?: string;
  date: string;
  receivedDate?: string;
  publishedDate?: string;
  publicationInferred?: boolean;
  excerpt: string;
  keywords: string[];
  reason: string;
}
export interface ReportStory {
  title: string;
  points: {
    text: string;
    sources: number[];
    role?: 'finding' | 'evidence' | 'limitation';
  }[];
}
export interface ReportEdit {
  title: string;
  items: {included: boolean; story: ReportStory}[];
  reviewed: boolean;
}
export type ReportStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'ready'
  | 'reviewed'
  | 'failed'
  | 'cancelled';
export interface ReportPreview {
  period: {from: string; to: string};
  sources: ReportSource[];
  totalEligible: number;
  duplicateCount: number;
}
export interface ReportRecord {
  reportId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  state: ReportPreview & {
    request: ReportRequest;
    title: string;
    status: ReportStatus;
    calls: number;
    model?: string;
    errorCode?: string;
    planned: boolean;
    otherGroups?: {title: string; sources: number[]}[];
    items: {
      group: {title: string; sources: number[]};
      included: boolean;
      draft?: ReportStory;
      edited?: ReportStory;
    }[];
  };
}
export interface ReportView {
  report: ReportRecord;
  active: boolean;
  staleSources: string[];
  model: string | null;
}
export interface ReportSummary {
  reportId: string;
  version: number;
  title: string;
  kind: ReportRequest['kind'];
  period: ReportPreview['period'];
  status: ReportStatus;
  itemCount: number;
  stale: boolean;
}
export interface ReportList {
  reports: ReportSummary[];
  model: string | null;
}
export const REPORT_STATUS: Record<ReportStatus, string> = {
  draft: '已选材',
  queued: '排队中',
  running: '生成中',
  ready: '待核对',
  reviewed: '已核对',
  failed: '生成中断',
  cancelled: '已取消',
};
export async function reportCommand<T>(
  operation: string,
  input: unknown = {},
): Promise<T> {
  const response = await fetch('/api/v1/reports/commands', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({operation, input}),
  });
  const body: unknown = await response.json();
  if (body && typeof body === 'object' && 'error' in body) {
    const error = body.error;
    throw new Error(
      error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string'
        ? error.code
        : 'report_unavailable',
    );
  }
  if (!response.ok || !body || typeof body !== 'object' || !('result' in body))
    throw new Error('report_unavailable');
  return body.result as T;
}
export function reportError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  const messages: Record<string, string> = {
    no_report_sources:
      '本周期没有符合条件的已放行条目。请调整日期或筛选，或先在收件箱完成审核与入库。',
    ai_not_configured: '尚未配置模型，可以先手动编写报告。',
    report_sources_changed:
      '材料已被修改。请保留当前报告作比较，重新选材创建一份报告。',
    report_sources_unavailable:
      '部分材料已拒收、移除或设为隐私，报告已停止展示与导出。',
    stale_report_version:
      '报告已被其他操作更新，本次编辑仍保留。请复制需要的修改，再放弃本次编辑并重新打开最新版本。',
    invalid_report_date: '请选择有效日期。',
    invalid_report_timezone:
      '时区无效，请使用 Asia/Shanghai 等 IANA 时区名称。',
    invalid_report_citation:
      '出处编号不属于本条材料，请使用编辑器中列出的编号。',
    invalid_report_group: '材料分组有重复或无效的出处编号。',
    incomplete_report_selection:
      '选题结果遗漏了候选材料，本次未生成摘要。可在原额度内重试。',
    report_generation_failed:
      '生成未完成，已完成的内容仍保留。可继续生成或手动编辑。',
    report_call_budget_exhausted:
      '本报告调用额度已用尽，已完成的内容仍保留，可手动编辑。',
    report_interrupted: '服务重启或停止中断了生成，可继续处理剩余内容。',
    report_model_changed:
      '模型配置已改变，请手动完成本报告，或重新选材创建报告。',
    ai_provider_unavailable: '模型服务暂不可用，可稍后继续。',
    ai_price_window_closed:
      '等待 DeepSeek 低价时段，届时自动继续生成。可在设置 → AI 接入查看恢复时间。',
    ai_price_resume_required: '此报告由数据包恢复，请确认后手动继续生成。',
    ai_provider_timeout: '模型响应超时，已完成内容保留。',
    ai_intake_input_too_large:
      '材料超出单次模型输入范围，正文未截断。可手动编写或减少合并材料。',
    report_not_editable: '报告正在处理，请稍后编辑。',
    report_not_ready: '请先完成报告内容，再导出。',
    report_unavailable: '暂时无法读取报告，请确认服务已升级后重试。',
  };
  return (
    messages[code] ??
    (code && /^[a-z_]{1,80}$/u.test(code)
      ? '操作未完成：' + code
      : '暂时无法连接服务，请重试。')
  );
}
