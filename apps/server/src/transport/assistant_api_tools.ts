import {z} from 'zod';
import {randomUUID, createHash} from 'node:crypto';
import type {AssistantTools} from '../application/assistant_tools.js';
import {OperationError} from '../application/operation_error.js';
import type {M1cApiServicePort, M1cHttpResult} from './m1c_api_service.js';
import {agentCommandSchemas} from '../application/agent_commands.js';
import {publicSubscriptionSchema} from '../application/agent_capture_service.js';
import {sourceProcessingProfileSchema} from '../modules/subscriptions/source_processing_profile.js';
import {
  ENTRY_TYPE_KEYWORDS,
  ENTRY_DOMAIN_KEYWORDS,
  INFORMATION_ENTRY_GRAPH_DIRECTIONS,
  INFORMATION_ENTRY_GRAPH_SEMANTIC_KINDS,
  INFORMATION_ENTRY_GRAPH_VERIFICATION_STATUSES,
  INFORMATION_ENTRY_GRAPH_MAXIMUM_NEIGHBORS,
} from '../modules/entries/index.js';
import {sourceReceivingSchema} from '../modules/subscriptions/source_receiving.js';

/** Owner UI operations reuse their existing decoders and application services. */
export function createAssistantApiTools(
  api: M1cApiServicePort,
): AssistantTools {
  const tools: AssistantTools = {};
  const id = z.uuid(),
    empty = z.object({}).strict(),
    privateFlag = z.boolean().default(false),
    revision = z.number().int().nonnegative();
  const document = z
    .object({snapshotId: id, includePrivate: privateFlag})
    .strict();
  const body = <S extends z.ZodType>(schema: S) =>
    z.object({body: schema}).strict();
  const mapping = z
    .object({queryParameter: z.string(), responsePath: z.string()})
    .strict();
  const sourceOptions = publicSubscriptionSchema.options.map((option) =>
    option.extend({
      isPrivate: privateFlag,
      processingProfile: sourceProcessingProfileSchema.optional(),
      ...(option.shape.kind.value === 'json_api'
        ? {
            authentication: z.discriminatedUnion('kind', [
              z.object({kind: z.literal('none')}).strict(),
              z
                .object({kind: z.literal('bearer_env'), variable: z.string()})
                .strict(),
            ]),
            pageCursor: mapping.optional(),
            incrementalCursor: mapping.optional(),
          }
        : {}),
    }),
  );
  const subscription = z.union([
    ...sourceOptions,
    z
      .object({
        kind: z.literal('plugin'),
        subscriptionId: id,
        label: z.string(),
        description: z.string().optional(),
        sourceAlias: z.string(),
        enabled: z.boolean(),
        isPrivate: privateFlag,
        intervalMinutes: z.number().int().min(15),
        connectorId: z.string(),
        configurationRef: z.string(),
        receiving: sourceReceivingSchema.optional(),
        processingProfile: sourceProcessingProfileSchema.optional(),
      })
      .strict(),
  ]);
  const group = z
    .object({
      titlePath: z.string(),
      fragments: z
        .array(
          z.object({
            fragmentId: id,
            startCodePoint: revision,
            endCodePoint: revision,
          }),
        )
        .min(1),
    })
    .strict();
  const structure = document.extend({groups: z.array(group).min(1)});
  const selection = z
    .object({
      title: z.string().min(1).max(120),
      privacyScope: z.enum(['public', 'include_private', 'private_only']),
      entries: z
        .array(
          z.object({entryId: id, revision: revision.min(1), revisionId: id}),
        )
        .min(1)
        .max(20),
    })
    .strict();
  const query = agentCommandSchemas.entries_search.omit({
    limit: true,
    after: true,
  });
  const add = <S extends z.ZodType>(
    name: string,
    title: string,
    schema: S,
    effect: 'read' | 'change',
    call: (input: z.output<S>) => Promise<M1cHttpResult> | M1cHttpResult,
  ) => {
    tools[name] = {
      title,
      schema,
      effect,
      execute: async (input) => {
        const result = await call(schema.parse(input));
        const body = result.body as {
          error?: {code?: string};
          issue?: {code?: string};
          status?: string;
        };
        if (result.statusCode >= 500)
          throw new Error('Assistant business service unavailable');
        if (
          result.statusCode >= 400 ||
          [
            'rejected',
            'stale',
            'conflict',
            'failed',
            'not_found',
            'unavailable',
          ].includes(body.status ?? '')
        )
          throw new OperationError(
            result.statusCode === 409 ? 'conflict' : 'rejected',
            body.error?.code ??
              body.issue?.code ??
              body.status ??
              'assistant_tool_failed',
          );
        return result.body;
      },
    };
  };
  add('workspace_read', '读取当前工作区和能力状态。', empty, 'read', () =>
    api.workspace(),
  );
  add('overview_read', '读取文档、条目、标签等统计。', empty, 'read', () =>
    api.readOverviewSummary(),
  );
  add(
    'documents_browse',
    '按关键词、类别和阅读状态浏览文档。',
    z
      .object({
        includePrivate: privateFlag,
        options: z
          .object({
            limit: z.number().int().min(1).max(100).optional(),
            query: z.string().optional(),
            type: z.string().optional(),
            readingState: z
              .enum(['unread', 'reading', 'read', 'archived'])
              .optional(),
            snapshotId: id.optional(),
            after: z
              .object({capturedAt: z.string(), snapshotId: id})
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    'read',
    (r) => api.listInformationEntryDocuments(r.includePrivate, r.options),
  );
  add('source_document_read', '读取原始文档。', document, 'read', (r) =>
    api.loadEvidenceSnapshot(r.snapshotId, r.includePrivate),
  );
  add(
    'document_draft_read',
    '读取正文草稿和当前修订。',
    document,
    'read',
    (r) =>
      api.loadInformationDocumentWorkingCopy(r.snapshotId, r.includePrivate),
  );
  add(
    'document_draft_save',
    '保存全文修改。保持原文，后续提交和基础发布分别执行。',
    document.extend({
      expectedRevision: revision,
      text: z.string().min(1).max(160000),
    }),
    'change',
    (r) =>
      api.saveInformationDocumentWorkingCopy(r.snapshotId, {
        expectedRevision: r.expectedRevision,
        text: r.text,
        includePrivate: r.includePrivate,
      }),
  );
  add(
    'document_draft_restore',
    '恢复原文，丢弃当前正文草稿。',
    document.extend({expectedRevision: revision}),
    'change',
    (r) =>
      api.restoreInformationDocumentWorkingCopy(r.snapshotId, {
        expectedRevision: r.expectedRevision,
        includePrivate: r.includePrivate,
      }),
  );
  add(
    'document_draft_commit',
    '提交正文草稿；基础发布仍需 document_publish。',
    document.extend({expectedRevision: revision}),
    'change',
    (r) =>
      api.commitInformationDocumentWorkingCopy(r.snapshotId, {
        expectedRevision: r.expectedRevision,
        includePrivate: r.includePrivate,
      }),
  );
  add('document_tags_read', '读取文档标签与版本。', document, 'read', (r) =>
    api.aggregateInformationDocumentTags(r.snapshotId, {
      includePrivate: r.includePrivate,
    }),
  );
  add(
    'document_tags_save',
    '编辑文档标签。',
    document.extend({
      expectedRevision: revision,
      tags: z.array(z.string()).max(128),
    }),
    'change',
    (r) =>
      api.reviseInformationDocumentTags(r.snapshotId, {
        expectedRevision: r.expectedRevision,
        tags: r.tags,
        includePrivate: r.includePrivate,
      }),
  );
  add(
    'entry_edit',
    '修改条目正文及原有标签。先 entry_read 取得完整 annotation 及版本。',
    z
      .object({
        entryId: id,
        body: z
          .object({
            expectedRevision: revision.min(1),
            includePrivate: privateFlag,
            annotation: z
              .object({
                body: z.string(),
                contentKeywords: z.array(z.string()),
                typeKeyword: z.enum(ENTRY_TYPE_KEYWORDS),
                typeCustomName: z.string().optional(),
                domains: z.array(
                  z.object({
                    keyword: z.enum(ENTRY_DOMAIN_KEYWORDS),
                    customName: z.string().optional(),
                  }),
                ),
                usefulnessScore: z.number().int().min(0).max(100).optional(),
                interestScore: z.number().int().min(0).max(100).optional(),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
    'change',
    (r) => api.reviseInformationEntry(r.entryId, r.body),
  );
  add(
    'structure_preview',
    '预览分段，获得 planSha256 和受影响的标注、联系。范围使用原文片段的 Unicode 码点偏移。',
    body(structure),
    'read',
    (r) => api.previewInformationEntryRestructure(r.body),
  );
  add(
    'structure_apply',
    '应用已预览分段；保留冲突及影响确认检查。',
    body(
      structure.extend({
        planSha256: z.string().regex(/^[a-f0-9]{64}$/u),
        acknowledgeAnnotationChanges: z.boolean(),
        acknowledgeRelationshipChanges: z.boolean(),
      }),
    ),
    'change',
    (r) => api.applyInformationEntryRestructure(r.body),
  );
  add(
    'structure_materialize',
    '为尚无条目的文档手动创建分段。',
    body(structure),
    'change',
    (r) => api.materializeManualInformationEntries(r.body),
  );
  add(
    'graph_read',
    '读取联系星图及证据。',
    body(
      z
        .object({
          centerEntryId: id.optional(),
          query: z.string().max(300).optional(),
          includePrivate: privateFlag,
          onlyPrivate: privateFlag,
          candidateLimit: z.number().int().min(1).max(12).optional(),
          neighborLimit: z
            .number()
            .int()
            .min(1)
            .max(INFORMATION_ENTRY_GRAPH_MAXIMUM_NEIGHBORS)
            .optional(),
        })
        .strict(),
    ),
    'read',
    (r) => api.readInformationEntryKnowledgeGraph(r.body),
  );
  add(
    'relation_save',
    '创建或修改联系，或拦截/恢复联系；先 relations_read 或 graph_read 读取版本。',
    z
      .object({
        entryId: id,
        relatedEntryId: id,
        body: z.discriminatedUnion('operation', [
          z
            .object({
              operation: z.literal('edit'),
              expectedRevision: revision,
              includePrivate: privateFlag,
              label: z.string(),
              direction: z.enum(INFORMATION_ENTRY_GRAPH_DIRECTIONS),
              semanticKind: z.enum(INFORMATION_ENTRY_GRAPH_SEMANTIC_KINDS),
              verificationStatus: z.enum(
                INFORMATION_ENTRY_GRAPH_VERIFICATION_STATUSES,
              ),
              note: z.string(),
              expectedEntryRevisions: z
                .object({
                  entryLowRevision: revision.min(1),
                  entryHighRevision: revision.min(1),
                })
                .optional(),
            })
            .strict(),
          z
            .object({
              operation: z.enum(['block', 'restore']),
              expectedRevision: revision,
              includePrivate: privateFlag,
            })
            .strict(),
        ]),
      })
      .strict(),
    'change',
    (r) =>
      api.reviseInformationEntryKnowledgeGraphEdge(
        r.entryId,
        r.relatedEntryId,
        r.body,
      ),
  );
  add(
    'translation_read',
    '读取条目的已有译文。',
    z.object({entryId: id, revision: revision.min(1)}).strict(),
    'read',
    (r) => api.readEntryTranslation(r.entryId, String(r.revision)),
  );
  add(
    'translation_generate',
    '生成条目译文；保留原文。',
    z
      .object({
        entryId: id,
        body: z
          .object({
            expectedRevision: revision.min(1),
            expectedTranslatedAt: z.string().optional(),
          })
          .strict(),
      })
      .strict(),
    'change',
    (r) => api.generateEntryTranslation(r.entryId, r.body),
  );
  add(
    'translation_import',
    '导入条目译文。',
    z
      .object({
        entryId: id,
        body: z
          .object({
            expectedRevision: revision.min(1),
            sourceRevisionId: id,
            title: z.string(),
            body: z.string(),
          })
          .strict(),
      })
      .strict(),
    'change',
    (r) => api.importEntryTranslation(r.entryId, r.body),
  );
  add('sources_read', '读取所有来源配置、版本和运行状态。', empty, 'read', () =>
    api.listSourceSubscriptions(),
  );
  add(
    'sources_save',
    '新增、修改、删除来源。先 sources_read；subscriptions 是完整配置列表，保留其他来源，省略 cursor、receivingStatus 等运行字段。',
    body(
      z
        .object({
          expectedRevision: revision,
          subscriptions: z.array(subscription),
        })
        .strict(),
    ),
    'change',
    (r) => api.replaceSourceSubscriptions(r.body),
  );
  add(
    'document_file_import',
    '导入调用方提供的文件内容；使用标准 Base64。文本可直接使用 document_import。',
    z
      .object({
        requestKey: z.string().max(100),
        name: z.string().min(1).max(240),
        format: z.enum(['markdown', 'text', 'html', 'pdf']),
        sourceBase64: z.string().min(1),
        isPrivate: privateFlag,
      })
      .strict(),
    'change',
    (r) => {
      const resourceId = randomUUID(),
        snapshotId = randomUUID(),
        bytes = Buffer.from(r.sourceBase64, 'base64');
      const mediaType = {
        markdown: 'text/markdown',
        text: 'text/plain',
        html: 'text/html',
        pdf: 'application/pdf',
      }[r.format];
      const input = {
        commandIdempotencyKey: r.requestKey,
        resource: {
          resourceId,
          resourceKind: 'uploaded_file',
          sourceKey:
            r.name +
            '#sha256:' +
            createHash('sha256').update(bytes).digest('hex'),
          isPrivate: r.isPrivate,
        },
        snapshot: {
          snapshotId,
          resourceId,
          capturedAt: new Date().toISOString(),
          mediaType,
        },
        gitObservations: [],
        profile: 'commonmark-v1',
        sourceBase64: r.sourceBase64,
        ...(['html', 'pdf'].includes(r.format)
          ? {documentFormat: r.format}
          : {}),
      };
      return ['html', 'pdf'].includes(r.format)
        ? api.importDocument(input)
        : api.importMarkdown(input);
    },
  );
  add('saved_queries_read', '读取保存的查询。', empty, 'read', () =>
    api.loadEntrySavedQueries(),
  );
  add(
    'saved_query_save',
    '新增、更新或删除保存的查询。',
    body(
      z.discriminatedUnion('operation', [
        z
          .object({
            operation: z.literal('save'),
            expectedRevision: revision,
            viewId: id,
            view: z
              .object({
                viewId: id,
                name: z.string().min(1).max(80),
                query,
                selectedEntryId: id.optional(),
              })
              .strict(),
          })
          .strict(),
        z
          .object({
            operation: z.literal('rename'),
            expectedRevision: revision,
            viewId: id,
            name: z.string().min(1).max(80),
          })
          .strict(),
        z
          .object({
            operation: z.literal('delete'),
            expectedRevision: revision,
            viewId: id,
          })
          .strict(),
      ]),
    ),
    'change',
    (r) => api.writeEntrySavedQuery(r.body),
  );
  add(
    'query_context',
    '读取一个条目的查询上下文。',
    body(
      z
        .object({
          entryId: id,
          includePrivate: privateFlag,
          onlyPrivate: privateFlag,
        })
        .strict(),
    ),
    'read',
    (r) => api.readEntryQueryContext(r.body),
  );
  add(
    'entry_export_preview',
    '预览条目 Markdown 导出。',
    body(selection),
    'read',
    (r) => api.previewEntryMarkdownExport(r.body),
  );
  add(
    'entry_export',
    '生成条目 Markdown 导出；先预览取得 expectedSha256。',
    body(
      selection.extend({expectedSha256: z.string().regex(/^[a-f0-9]{64}$/u)}),
    ),
    'change',
    (r) => api.generateEntryMarkdownExport(r.body),
  );
  add('ui_settings_read', '读取页面外观与布局偏好。', empty, 'read', () =>
    api.loadWorkspaceUiPreferences(),
  );
  add(
    'ui_settings_save',
    '保存主题与页面偏好；先读取完整结构，保留 sidebars。',
    body(
      z
        .object({
          revision,
          theme: z.enum(['system', 'light', 'dark']),
          sidebars: z
            .object({
              inbox: z.array(z.string()),
              documents: z.array(z.string()),
              topics: z.array(z.string()),
              query: z.array(z.string()),
              settings: z.array(z.string()),
            })
            .strict(),
        })
        .strict(),
    ),
    'change',
    (r) => api.saveWorkspaceUiPreferences(r.body),
  );
  add(
    'review_settings_read',
    '读取全局词表、规则及阅读偏好。',
    empty,
    'read',
    () => api.loadReviewPreferences(),
  );
  add(
    'review_settings_save',
    '保存快捷标签、自动关键词和别名；先读取，完整保留不需修改的字段。',
    body(
      z
        .object({
          quickTags: z.array(z.string()),
          automaticKeywords: z
            .object({
              enabled: z.boolean(),
              includeLinkDomains: z.boolean(),
              excludedKeywords: z.array(z.string()),
            })
            .strict(),
          vocabulary: z
            .object({
              aliases: z.array(
                z.object({source: z.string(), canonical: z.string()}).strict(),
              ),
            })
            .strict(),
        })
        .strict(),
    ),
    'change',
    (r) => api.saveReviewPreferences(r.body),
  );
  add('split_settings_read', '读取手动拆分规则。', empty, 'read', () =>
    api.loadInformationEntrySplitRuleProfile(),
  );
  add(
    'split_settings_save',
    '保存手动拆分规则。',
    body(
      z
        .object({
          expectedRevision: revision,
          mode: z.enum(['one_section', 'merge_short_adjacent']),
          minimumGroupCodePoints: z.number().int().min(1).max(200000),
          maximumGroupCodePoints: z.number().int().min(1).max(200000),
          maximumFragmentsPerGroup: z.number().int().min(1).max(64),
        })
        .strict(),
    ),
    'change',
    (r) => api.saveInformationEntrySplitRuleProfile(r.body),
  );
  add(
    'association_settings_save',
    '修改联系检索权重及阈值；三项权重合计 100。',
    body(
      z
        .object({
          expectedRevision: revision,
          contentWeight: revision.max(100),
          typeWeight: revision.max(100),
          domainWeight: revision.max(100),
          threshold: revision.max(10000),
        })
        .strict(),
    ),
    'change',
    (r) => api.reviseInformationEntryAssociationPolicy(r.body),
  );
  add(
    'exploration_settings_save',
    '修改检索扩展配置。',
    body(
      z
        .object({
          expectedRevision: revision,
          enabled: z.boolean(),
          resultShare: revision.max(100),
          neighborExpansion: z.boolean(),
          crossDomain: z.boolean(),
          serendipity: z.boolean(),
        })
        .strict(),
    ),
    'change',
    (r) => api.reviseInformationEntryExplorationPolicy(r.body),
  );
  add('index_status', '查看搜索索引状态。', empty, 'read', () =>
    api.informationEntrySearchIndexStatus(),
  );
  add('index_rebuild', '重建搜索索引。', empty, 'change', () =>
    api.rebuildInformationEntrySearchIndex(),
  );
  add(
    'workspace_export',
    '导出工作区备份。结果仅交给用户，不送入模型。',
    empty,
    'change',
    () => api.exportWorkspaceBundle(),
  );
  add(
    'workspace_restore',
    '恢复备份目录中的文件；现有恢复规则检查工作区身份及空库。',
    body(z.object({fileName: z.string().min(1)}).strict()),
    'change',
    (r) => api.restoreWorkspaceBundle(r.body),
  );
  return tools;
}
