import {z} from 'zod';
import {
  agentCommandSchemas,
  inboxOwnerSchemas,
  type AgentCommands,
} from './agent_commands.js';
import {annotationOwnerSchemas} from './annotation_service.js';
import {topicOwnerSchemas} from './topic_service.js';
import {researchOwnerSchemas} from './research_contract.js';
import {reportOwnerCommandSchemas} from './report_commands.js';
import {splitRecipeOwnerSchemas} from './source_split_service.js';
import {historySchemas} from './source_history_service.js';
import {sourceQualityOwnerSchemas} from './source_quality_service.js';
import {aiPricePolicySchema} from '../modules/processing/ai_price_policy.js';
import {documentQueueApplySchema} from './document_queue.js';
import type {AiPriceService} from './ai_price_service.js';
import type {ExecutionAuthority} from './execution_authority.js';
import {OperationError} from './operation_error.js';
import {sourceDescriptionRequest} from './source_description_service.js';

export interface AssistantTool {
  title: string;
  schema: z.ZodType;
  effect: 'read' | 'change';
  execute(input: unknown): Promise<unknown>;
}
export type AssistantTools = Record<string, AssistantTool>;
const empty = z.object({}).strict();
// Reads are enumerated. New application writes never become silent assistant reads.
const readNames = new Set([
  'system_status',
  'processing_standard',
  'documents_list',
  'document_read',
  'document_sections',
  'document_publication_status',
  'entries_search',
  'entry_read',
  'relations_read',
  'subscriptions_read',
  'subscriptions_list',
  'tasks_list',
  'task_read',
  'intake_status',
  'intake_origins',
  'intake_previews',
  'ingestion_status',
  'annotation_vocabulary',
  'entry_annotations_read',
  'topics_list',
  'topics_preview',
  'split_recipes_read',
  'split_recipe_preview',
  'research_status',
  'report_pipeline_status',
  'report_preview',
  'reports_list',
  'report_read',
  'report_export',
  'source_quality_status',
  'history_list',
  'history_select',
  'history_preview',
  'history_prepare_import',
  'ai_price_status',
  'document_queue_status',
]);
const descriptions: Record<string, string> = {
  entries_search:
    '搜索已确认条目：标题、正文、标签、来源、类型、日期。返回条目编号及文档编号。',
  documents_list:
    '查找接收文档；text 只匹配来源名和地址。按标题查找请用 entries_search 或 documents_browse。',
  document_read: '读取文档原文与已有条目。',
  document_sections:
    '按顺序读取文档段落。手动分段所需的原文片段编号由 source_document_read 提供。',
  task_start: '启动文档审核、拆分和标注任务；使用已有范围与预算。',
  task_control: '暂停、继续或取消任务。先 task_read 取得当前版本。',
  subscription_put:
    '新增公开来源。修改现有来源请先 sources_read，再 sources_save 保留完整配置。',
  subscription_check: '立即接收一个来源；requestKey 用于防重复。',
  document_publish:
    '确认发布文档。先取得 document_publication_status 中的版本。',
  intake_receive:
    '接受、拒绝或重新待审。先读取接收记录的版本；接受可启动整理。',
  research_answer:
    '知识库问答和联网综合回答。mode 为 local/web/mixed，结果带引用。',
  web_search: '联网搜索。返回会话及结果，保存到待审核请用 web_capture。',
  report_create:
    '创建报告。先 report_preview 确认范围，再 report_generate 启动生成。',
  report_generate:
    '生成已有报告，返回持久化报告任务；通过 report_read 继续查看。',
  report_export: '导出已生成报告的 Markdown 内容。',
  split_recipe_save: '保存来源的拆分方案。保留基础模板与来源特化版本。',
  entry_annotations_save:
    '修改结构化标注，保留当前条目版本、词表版本和原文证据。',
  topic_relation_set: '修改主题中的联系与证据。',
  source_quality_control: '处理来源质量复核：保持现状或关闭来源。',
  system_status: '读取系统、模型、许可及预算状态。',
  processing_standard: '读取当前文档处理规范。',
  document_import: '手动导入公开 Markdown 文档，进入待审核。',
  entry_read: '读取条目正文、标签、来源及版本。',
  document_publication_status: '读取文档发布状态与修订。',
  relations_read: '读取条目联系与证据。',
  subscriptions_read: '读取公开来源配置。',
  subscriptions_list: '读取公开来源列表。',
  tasks_list: '读取文档任务列表、进度和等待原因。',
  task_read: '读取单个文档任务及版本。',
  intake_status: '读取接收记录和审核状态。',
  intake_origins: '读取文档的来源。',
  intake_previews: '读取文档预览与摘要。',
  intake_translate: '翻译待审核文档。',
  intake_summarize: '生成待审核文档的简短摘要。',
  intake_control: '调整文档审核决定及原因。',
  intake_prepare: '获取完整正文，准备审核。',
  ingestion_status: '读取自动接收配置、处理记录。',
  ingestion_policy_save: '修改自动处理范围和限额。',
  ingestion_item_control: '暂停、重试或人工接管接收任务。',
  annotation_vocabulary: '读取结构化词表与版本。',
  annotation_vocabulary_save: '保存词表、同义词与维度。',
  entry_annotations_read: '读取条目的结构化标注。',
  topics_list: '读取主题、成员及后台归组任务。',
  topics_preview: '预览主题候选及预算范围。',
  topic_save: '创建或修改主题。',
  topic_member_set: '固定或排除主题成员。',
  topic_job_start: '启动独立的后台主题归组任务。',
  topic_job_control: '继续或取消主题归组。',
  split_recipes_read: '读取拆分模板和来源专属方案。',
  split_recipe_preview: '预览拆分方案。',
  split_recipe_trial: '在选定样本上试用来源拆分方案。',
  split_recipe_control: '启用、回退或调整来源拆分方案状态。',
  split_recipe_suggest: '根据来源样本生成拆分建议。',
  split_recipe_apply: '应用已核对的来源拆分方案。',
  research_status: '读取联网配置、用量和研究记录。',
  report_pipeline_status: '读取报告计划、执行记录和通知。',
  web_capture: '将选定联网结果存入待审核。',
  report_preview: '预览报告的候选内容。',
  reports_list: '读取报告及生成队列。',
  report_read: '读取报告内容和生成状态。',
  report_cancel: '取消报告生成任务。',
  report_edit: '修改已有报告。',
  report_publish: '发布报告到站内消息。',
  report_schedule_save: '新增或修改定时报告计划。',
  research_settings_save: '修改联网搜索、额度和通知配置。',
  notice_read: '将站内消息标记已读。',
  history_open: '为所选来源打开往期补收目录。',
  history_scan: '读取来源下一页往期目录。',
  history_list: '筛选往期条目。',
  history_select: '按来源与日期选择往期内容。',
  history_preview: '读取往期文章正文。',
  history_prepare_import: '预览补收清单。',
  history_import: '按已确认清单补收内容。',
  history_close: '关闭本次补收目录。',
  history_restore: '恢复已有往期目录清单。',
  ai_price_status: '读取模型许可、队列开关、价格时段及版本。',
  ai_operations_save: '修改 AI 总开关。',
  ai_execution_save: '修改模型并发和失败重试次数。',
  ai_price_save: '修改低价时段限制开关。',
  source_quality_status: '读取来源质量与需复核样本。',
  source_description_generate: '生成来源简介。',
  document_queue_status: '读取可继续和重启的文档任务。',
  document_queue_apply: '批量继续、重启或取消文档任务。',
};
export function createAssistantCommandTools(
  owner: Pick<AgentCommands, 'execute'>,
  price: AiPriceService,
  authority: ExecutionAuthority,
): AssistantTools {
  const schemas: Record<string, z.ZodType> = {
    ...agentCommandSchemas,
    ...inboxOwnerSchemas,
    ...annotationOwnerSchemas,
    ...topicOwnerSchemas,
    ...researchOwnerSchemas,
    ...reportOwnerCommandSchemas,
    ...splitRecipeOwnerSchemas,
    ...historySchemas,
    ...sourceQualityOwnerSchemas,
    source_quality_status: empty,
    ai_price_status: empty,
    document_queue_status: empty,
    document_queue_apply: documentQueueApplySchema,
    source_description_generate: sourceDescriptionRequest,
    ai_operations_save: aiPricePolicySchema
      .pick({revision: true})
      .extend({operationsAllowed: z.boolean()}),
    ai_execution_save: aiPricePolicySchema.pick({revision: true}).extend({
      maxConcurrentRequests:
        aiPricePolicySchema.shape.maxConcurrentRequests.unwrap(),
      automaticRetryLimit:
        aiPricePolicySchema.shape.automaticRetryLimit.unwrap(),
    }),
    ai_price_save: aiPricePolicySchema.pick({revision: true, enabled: true}),
  };
  const tools: AssistantTools = {};
  for (const [name, schema] of Object.entries(schemas))
    tools[name] = {
      title: descriptions[name] ?? name,
      schema,
      effect: readNames.has(name) ? 'read' : 'change',
      execute: (input) => owner.execute(name, input),
    };
  tools.queue_control = {
    title: '暂停或恢复后台文档和报告队列。助手仍可响应。',
    schema: z
      .object({paused: z.boolean(), revision: z.number().int().nonnegative()})
      .strict(),
    effect: 'change',
    execute: (input) => {
      const r = z
        .object({paused: z.boolean(), revision: z.number()})
        .parse(input);
      return price.save(
        authority,
        {revision: r.revision, backgroundPaused: r.paused},
        'queue',
      );
    },
  };
  tools.assistant_settings_save = {
    title: '设置助手指令模型是否遵守低价时段。总禁用、并发及已有预算继续有效。',
    schema: z
      .object({
        revision: z.number().int().nonnegative(),
        assistantPriceRestricted: z.boolean(),
      })
      .strict(),
    effect: 'change',
    execute: (input) => price.save(authority, input, 'assistant'),
  };
  return tools;
}
export function describeAssistantTool(tools: AssistantTools, name: string) {
  const tool = tools[name];
  if (!tool)
    throw new OperationError('invalid_input', 'assistant_unknown_tool');
  return {
    name,
    title: tool.title,
    effect: tool.effect,
    inputSchema: z.toJSONSchema(tool.schema, {unrepresentable: 'any'}),
  };
}
export function parseAssistantTool(
  tools: AssistantTools,
  name: string,
  input: unknown,
) {
  const tool = tools[name];
  if (!tool)
    throw new OperationError('invalid_input', 'assistant_unknown_tool');
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success)
    throw new OperationError(
      'invalid_input',
      'assistant_invalid_tool_input',
      parsed.error.issues
        .map((i) => i.path.join('.') + ': ' + i.message)
        .join('; ')
        .slice(0, 1600),
    );
  return {tool, input: parsed.data};
}
