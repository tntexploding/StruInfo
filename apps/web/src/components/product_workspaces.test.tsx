import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import type {CurationState, EvidenceSnapshot} from '../api/m1c_api_contract.js';
import {READY_HEALTH_FIXTURE} from '../health/mock_health_client.js';
import {MaterialsWorkspace} from '../workspaces/materials_workspace.js';
import {InformationEntryWorkspace} from '../workspaces/information_entry_workspace.js';
import {KnowledgeWorkspace} from '../workspaces/knowledge_workspace.js';
import {ReviewWorkspace} from '../workspaces/review_workspace.js';
import {SearchWorkspace} from '../workspaces/search_workspace.js';
import {ApplicationFailureFallback} from './application_error_boundary.js';
import {ProductAppShell} from './product_app_shell.js';

const EMPTY_CURATION: Readonly<CurationState> = Object.freeze({
  terms: [],
  targets: [],
  assignments: [],
  decisions: [],
  assessments: [],
});

const REVIEW_EVIDENCE: Readonly<EvidenceSnapshot> = Object.freeze({
  workspaceId: '11111111-1111-4111-8111-111111111111',
  resourceId: '22222222-2222-4222-8222-222222222222',
  snapshotId: '33333333-3333-4333-8333-333333333333',
  resourceKind: 'manual_text',
  sourceKey: 'synthetic:tool-entry',
  capturedAt: '2040-01-02T03:04:05.000Z',
  fragmentCount: 1,
  rawSha256: 'a'.repeat(64),
  canonicalContentSha256: 'b'.repeat(64),
  canonicalizationVersion: 'utf8-lf-v1',
  structures: [
    {
      structureId: '44444444-4444-4444-8444-444444444444',
      parserName: 'commonmark',
      parserVersion: '1',
      textNormalizationVersion: 'utf8-lf-v1',
      structureSha256: 'c'.repeat(64),
      textBlob: {
        algorithm: 'sha256' as const,
        digest: 'd'.repeat(64),
        byteLength: 48,
      },
      normalizedText: '## TinyPNG\n\n一项实用的图片压缩工具。',
      fragments: [
        {
          fragmentId: '55555555-5555-4555-8555-555555555555',
          structureId: '44444444-4444-4444-8444-444444444444',
          nodeId: 'synthetic-node',
          nodeKind: 'section' as const,
          codePointRange: {start: 0, end: 24},
          lineRange: {start: 1, end: 3},
          selectedTextSha256: 'e'.repeat(64),
          selectedText: 'TinyPNG\n\n一项实用的图片压缩工具。',
        },
      ],
    },
  ],
});

const REVIEWED_CURATION: Readonly<CurationState> = Object.freeze({
  terms: [],
  assignments: [],
  assessments: [],
  targets: [
    {
      workspaceId: '11111111-1111-4111-8111-111111111111',
      targetId: '66666666-6666-4666-8666-666666666666',
      currentVersion: 1,
      kind: 'fragment' as const,
      fragmentId: '55555555-5555-4555-8555-555555555555',
    },
  ],
  decisions: [
    {
      decisionId: '77777777-7777-4777-8777-777777777777',
      targetId: '66666666-6666-4666-8666-666666666666',
      currentRevision: 1,
      currentRevisionId: '88888888-8888-4888-8888-888888888888',
      value: {action: 'full' as const, reasonCodes: []},
    },
  ],
});

describe('M1C product workspaces', () => {
  it('renders a visible recovery surface instead of an empty application root', () => {
    const markup = renderToStaticMarkup(<ApplicationFailureFallback />);

    expect(markup).toContain('界面未能继续显示');
    expect(markup).toContain('重新载入');
    expect(markup).toContain('role="alert"');
  });

  it('renders the five real product routes without claiming AI capability', () => {
    const markup = renderToStaticMarkup(
      <ProductAppShell
        activeSection="materials"
        health={{kind: 'ready', response: READY_HEALTH_FIXTURE}}
        transportMode="live"
        workspace={{
          status: 'ok',
          workspaceId: '11111111-1111-4111-8111-111111111111',
          capabilities: ['manual-core'],
        }}
        onNavigate={() => undefined}
        evidencePanel={null}
      >
        <h1>材料与证据</h1>
      </ProductAppShell>,
    );

    expect(markup).toContain('材料');
    expect(markup).toContain('审核');
    expect(markup).toContain('条目');
    expect(markup).toContain('知识');
    expect(markup).toContain('搜索');
    expect(markup).toContain('<dd>未启用</dd>');
    expect(markup).toContain('NON-AI CORE · MANUAL AUTHORITY');
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain('href="#main-workspace"');
    expect(markup).toContain('aria-current="page"');
  });

  it('renders the Entry-first build, filter, privacy, and source controls', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryWorkspace
        snapshots={[REVIEW_EVIDENCE]}
        onListDocuments={() =>
          Promise.resolve({
            statusCode: 200,
            body: {
              status: 'ok',
              totalCount: 1,
              documents: [
                {
                  ...REVIEW_EVIDENCE,
                  entryCount: 0,
                  annotatedEntryCount: 0,
                },
              ],
            },
          })
        }
        onMaterialize={() =>
          Promise.resolve({
            statusCode: 201,
            body: {
              status: 'created',
              snapshotId: REVIEW_EVIDENCE.snapshotId,
              createdCount: 1,
              entries: [],
            },
          })
        }
        onRevise={() =>
          Promise.resolve({
            statusCode: 200,
            body: {status: 'unchanged'},
          })
        }
        onAggregateDocumentTags={() =>
          Promise.resolve({
            statusCode: 200,
            body: {status: 'unchanged'},
          })
        }
        onReviseDocumentTags={() =>
          Promise.resolve({
            statusCode: 200,
            body: {status: 'unchanged'},
          })
        }
        onSearch={() =>
          Promise.resolve({
            statusCode: 200,
            body: {status: 'ok', totalCount: 0, items: []},
          })
        }
        onOpenEvidence={() => undefined}
      />,
    );

    expect(markup).toContain('文档条目');
    expect(markup).toContain('来源文档导航');
    expect(markup).toContain('按结构生成条目');
    expect(markup).toContain('正文或关键词');
    expect(markup).toContain('类型关键词');
    expect(markup).toContain('领域关键词');
    expect(markup).toContain('查询隐私文档');
    expect(markup).toContain('来源绑定 · 无需 AI');
  });

  it('renders rapid review separately from advanced knowledge maintenance', () => {
    const materials = renderToStaticMarkup(
      <MaterialsWorkspace
        snapshots={{status: 'empty'}}
        onImport={() =>
          Promise.resolve({kind: 'success', title: 'synthetic', detail: ''})
        }
        onOpenEvidence={() => undefined}
        onRefresh={() => undefined}
        onExport={() =>
          Promise.resolve({kind: 'success', title: 'synthetic', detail: ''})
        }
        onRestore={() =>
          Promise.resolve({kind: 'success', title: 'synthetic', detail: ''})
        }
      />,
    );
    const review = renderToStaticMarkup(
      <ReviewWorkspace
        curation={{status: 'ready', value: EMPTY_CURATION}}
        evidence={REVIEW_EVIDENCE}
        reviewPreferences={{
          status: 'ready',
          value: {
            status: 'ok',
            workspaceId: '00000000-0000-4000-8000-000000000001',
            quickTags: ['实用工具'],
            automaticKeywords: {
              enabled: true,
              includeLinkDomains: false,
              excludedKeywords: [],
            },
            vocabulary: {aliases: [], links: [], knowledgeKinds: []},
          },
        }}
        snapshots={[REVIEW_EVIDENCE]}
        onApplyCuration={() =>
          Promise.resolve({kind: 'success', title: 'synthetic', detail: ''})
        }
        onOpenEvidence={() => undefined}
        onPutTerm={() =>
          Promise.resolve({kind: 'success', title: 'synthetic', detail: ''})
        }
        onSaveReviewPreferences={() =>
          Promise.resolve({kind: 'success', title: 'synthetic', detail: ''})
        }
        onRefresh={() => undefined}
      />,
    );
    const knowledge = renderToStaticMarkup(
      <KnowledgeWorkspace
        curation={{status: 'ready', value: REVIEWED_CURATION}}
        evidence={REVIEW_EVIDENCE}
        snapshots={[REVIEW_EVIDENCE]}
        reviewPreferences={{
          status: 'ready',
          value: {
            status: 'ok',
            workspaceId: '00000000-0000-4000-8000-000000000001',
            quickTags: [],
            automaticKeywords: {
              enabled: true,
              includeLinkDomains: false,
              excludedKeywords: [],
            },
            vocabulary: {aliases: [], links: [], knowledgeKinds: []},
          },
        }}
        onApplyCuration={() =>
          Promise.resolve({kind: 'success', title: 'synthetic', detail: ''})
        }
        onApplyKnowledge={() =>
          Promise.resolve({kind: 'success', title: 'synthetic', detail: ''})
        }
        onLoadKnowledgeItem={() =>
          Promise.resolve({statusCode: 404, body: {status: 'not_found'}})
        }
        onOpenEvidence={() => undefined}
        onPutTerm={() =>
          Promise.resolve({kind: 'success', title: 'synthetic', detail: ''})
        }
        onRefresh={() => undefined}
        onSearch={() =>
          Promise.resolve({
            statusCode: 200,
            body: {
              status: 'ok',
              querySha256: '0'.repeat(64),
              totalCount: 0,
              items: [],
            },
          })
        }
        onSelectEvidence={() =>
          Promise.resolve({kind: 'success', title: 'synthetic', detail: ''})
        }
        onSaveReviewPreferences={() =>
          Promise.resolve({kind: 'success', title: 'synthetic', detail: ''})
        }
      />,
    );

    expect(materials).toContain('保存并拆解材料');
    expect(materials).toContain('作为隐私文档录入');
    expect(materials).toContain('拆出的知识与相关关系自动继承私密范围');
    expect(materials).toContain('内容不会写入 Git 或前端包体');
    expect(materials).toContain('当前工作区还没有材料');
    expect(materials).toContain('工作区迁移');
    expect(materials).toContain('恢复到空工作区');
    expect(review).toContain('有用程度');
    expect(review).toContain('有趣程度');
    expect(review).toContain('完整处理');
    expect(review).toContain('压缩入库');
    expect(review).toContain('处理倾向');
    expect(review).toContain('短条目单项');
    expect(review).toContain('实用工具');
    expect(review).toContain('个人快捷标记');
    expect(review).toContain('很低');
    expect(review).toContain('很高');
    expect(review).toContain('自动标签提取');
    expect(review).toContain('启用自动标签');
    expect(review).toContain('允许链接域名进入候选');
    expect(review).toContain('自动排除词');
    expect(review).toContain('拒绝本条与其他条目建立联系');
    expect(review).not.toContain('知识变更集');
    expect(knowledge).toContain('审核转知识');
    expect(knowledge).toContain('写入后立即用同一搜索边界回读');
    expect(knowledge).toContain('写入知识并继续');
    expect(knowledge).toContain('返回上一条');
    expect(knowledge).toContain('内容如何形成');
    expect(knowledge).toContain('来源原文所述');
    expect(knowledge).toContain('内容直接来自原文陈述，不加入新的归纳');
    expect(knowledge).toContain('查看精确原文');
    expect(knowledge).toContain('高级拆分、修订与关系编辑');
    expect(knowledge).toContain('词表整理');
    expect(knowledge).toContain('添加拆分项');
    expect(knowledge).toContain('最高权限人工编辑');
  });

  it('renders deterministic search with source and one-hop filters', () => {
    const markup = renderToStaticMarkup(
      <SearchWorkspace
        snapshots={[]}
        onOpenEvidence={() => undefined}
        onSearch={() =>
          Promise.resolve({
            statusCode: 200,
            body: {
              status: 'ok',
              querySha256: '0'.repeat(64),
              totalCount: 0,
              items: [],
            },
          })
        }
      />,
    );

    expect(markup).toContain('确定性查询');
    expect(markup).toContain('查询隐私文档');
    expect(markup).toContain('直接来源');
    expect(markup).toContain('形成方式');
    expect(markup).toContain('一跳关系锚点 Item ID');
    expect(markup).toContain('留空可浏览当前知识');
    expect(markup).toContain('可复现排序 · 非 AI');
  });
});
