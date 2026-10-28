import {reportError, type ReportRequest} from './report_client.js';
export async function researchCommand<T>(
  operation: string,
  input: unknown = {},
): Promise<T> {
  const response = await fetch('/api/v1/research/commands', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({operation, input}),
  });
  const body = (await response.json()) as {result?: T; error?: {code?: string}};
  if (!response.ok || !('result' in body))
    throw new Error(body.error?.code ?? 'research_unavailable');
  return body.result;
}
export function researchError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  return (
    (
      {
        ai_provider_incomplete_response: 'AI 回答尚未完整生成，请稍后重试。',
        ai_query_invalid_citations: 'AI 回答缺少有效引用，请重试。',
        web_search_disabled: '联网搜索尚未开启。',
        deepseek_search_unconfigured: '请先配置 DeepSeek API 密钥。',
        web_daily_limit: '今天的联网请求已达到上限。',
        web_provider_failed: '搜索服务未返回结果，请稍后再试。',
        web_body_required: '该结果只有摘要，需要取得正文后才能保存。',
        web_session_expired: '这次搜索已过期，请重新搜索。',
        research_revision_conflict: '配置已更新，请重新读取后再保存。',
        report_budget_required: '定时 AI 报告需要选择当前可用预算。',
        web_query_required: '请填写要发送给搜索服务的公开搜索词。',
        research_session_limit: '当前会话较多，请稍后再试。',
        research_evidence_unavailable: '引用资料已隐藏或移除，请重新查询。',
        report_resume_required: '上次生成被中断，请打开报告检查后继续。',
        report_material_too_large: '选材内容过多，请缩小来源或时间范围。',
        research_unavailable: '这项功能暂时不可用。',
        report_version_conflict: '报告已变化，请重新打开后发布。',
        ai_query_private_scope_forbidden: '请先切换到公开资料范围。',
      } as Record<string, string>
    )[code] ?? reportError(error)
  );
}
export interface ResearchSettings {
  enabled: boolean;
  dailyRequests: number;
  resultLimit: number;
  fetchMissing: boolean;
  notices: {
    enabled: boolean;
    sources: string[];
    urgentTerms: string[];
    timeZone: string;
    quietFrom: string;
    quietTo: string;
    intervalMinutes: number;
  };
}
export interface ResearchStatus {
  version: number;
  settings: ResearchSettings;
  configured: boolean;
  requests: number;
  estimatedCny: number;
}
export interface WebEvidence {
  title: string;
  url: string;
  summary: string;
  content: string;
  contentKind: 'body' | 'summary';
  retrievedAt: string;
  publishedAt?: string;
}
export interface ResearchAnswer {
  answer: string;
  evidenceStatus: string;
  claims: {statement: string; evidenceRefs: string[]}[];
  limitations: string[];
  evidence: {
    handle: string;
    titlePath: string;
    excerpt: string;
    origin: 'local' | 'web';
    entryId?: string;
    url?: string;
    contentKind?: string;
    retrievedAt?: string;
    sessionId?: string;
    index?: number;
  }[];
}
export interface ReportSchedule {
  name: string;
  enabled: boolean;
  timeZone: string;
  localTime: string;
  cadence: 'daily' | 'weekly' | 'monthly';
  missed: 'once' | 'skip';
  publish: boolean;
  request: ReportRequest & {batchId?: string};
}
export interface PipelineRow {
  id: string;
  version: number;
  updatedAt: string;
  value: {
    kind: string;
    schedule?: ReportSchedule;
    status?: string;
    reportId?: string;
    title?: string;
    markdown?: string;
    read?: boolean;
    urgent?: boolean;
    correction?: boolean;
    createdAt?: string;
    visibleAt?: string;
    errorCode?: string;
    slot?: string;
  };
}
export interface PipelineStatus {
  settings: ResearchSettings;
  settingsVersion: number;
  budget: {batchId: string; paused: boolean; remainingCny: number} | null;
  schedules: PipelineRow[];
  runs: PipelineRow[];
  notices: PipelineRow[];
}
