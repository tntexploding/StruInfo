import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import {
  DEFAULT_REVIEW_ASSOCIATION_POLICY,
  type EvidenceSnapshot,
  type InformationEntry,
} from '../api/m1c_api_contract.js';
import {READY_HEALTH_FIXTURE} from '../health/mock_health_client.js';
import {MaterialsWorkspace} from '../workspaces/materials_workspace.js';
import {InformationEntryPrivacyScope} from '../workspaces/information_entry_components.js';
import {InformationEntryTextSearchOptions} from '../workspaces/information_entry_search_controls.js';
import {InformationEntrySplitWorkspace} from '../workspaces/information_entry_split_workspace.js';
import {InformationEntryRestructure} from '../workspaces/information_entry_restructure.js';
import {InformationEntryReviewControls} from '../workspaces/information_entry_review_controls.js';
import {InformationEntryPreferenceProfilePanel} from '../workspaces/information_entry_preference_profile_panel.js';
import {AssociationPolicyPanel} from '../workspaces/association_policy_panel.js';
import {PrivateDocumentResults} from '../workspaces/private_document_results.js';
import {FormalKnowledgeWorkspace} from '../workspaces/formal_knowledge_workspace.js';

import {WorkflowOverview} from '../workspaces/workflow_overview.js';
import {ApplicationFailureFallback} from './application_error_boundary.js';
import {ProductAppShell} from './product_app_shell.js';

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

describe('M1D product workspaces', () => {
  it('renders a visible recovery surface instead of an empty application root', () => {
    const markup = renderToStaticMarkup(<ApplicationFailureFallback />);

    expect(markup).toContain('界面未能继续显示');
    expect(markup).toContain('重新载入');
    expect(markup).toContain('role="alert"');
  });

  it('renders the seven product routes without claiming AI capability', () => {
    const markup = renderToStaticMarkup(
      <ProductAppShell
        activeSection="overview"
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
        <h1>总览</h1>
      </ProductAppShell>,
    );

    expect(markup).toContain('总览');
    expect(markup).toContain('导入');
    expect(markup).toContain('拆分');
    expect(markup).toContain('标签');
    expect(markup).toContain('联系');
    expect(markup).toContain('查询');
    expect(markup).toContain('知识');
    expect(markup.indexOf('查询')).toBeLessThan(markup.indexOf('知识'));
    expect(markup).not.toContain('M1D / FLOW');
    expect(markup).toContain('<dd>未启用</dd>');
    expect(markup).not.toContain('TRACEABLE CORE · MANUAL AUTHORITY');
    expect(markup).not.toContain('LOCAL DATA · ONE WORKSPACE');
    expect(markup).not.toContain('origin-label');
    expect(markup).not.toContain('section-index');
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain('href="#main-workspace"');
    expect(markup).toContain('aria-current="page"');
  });

  it('shows the optional tag Provider as enabled without unlocking other AI workspaces', () => {
    const markup = renderToStaticMarkup(
      <ProductAppShell
        activeSection="tags"
        health={{kind: 'ready', response: READY_HEALTH_FIXTURE}}
        transportMode="live"
        workspace={{
          status: 'ok',
          workspaceId: '11111111-1111-4111-8111-111111111111',
          capabilities: ['manual-core', 'processing_runs', 'ai_tags'],
        }}
        onNavigate={() => undefined}
        evidencePanel={null}
      >
        <h1>标签</h1>
      </ProductAppShell>,
    );

    expect(markup).toContain('<dt>AI</dt><dd>已启用</dd>');
    expect(markup).toContain('aria-current="page"');
  });

  it('renders the closed three-state privacy query scope', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryPrivacyScope
        includePrivate={true}
        onlyPrivate={true}
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain('仅公开结果');
    expect(markup).toContain('公开与隐私结果');
    expect(markup).toContain('只看隐私结果');
    expect(markup).toContain('<option value="private" selected="">');
  });

  it('renders explicit local lexical modes and field scopes', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryTextSearchOptions
        mode="fuzzy"
        fields={['title', 'tags']}
        onModeChange={() => undefined}
        onFieldsChange={() => undefined}
      />,
    );

    expect(markup).toContain('精确一致');
    expect(markup).toContain('包含文字');
    expect(markup).toContain('近似匹配');
    expect(markup).toContain('标题');
    expect(markup).toContain('正文');
    expect(markup).toContain('标签');
    expect(markup).toContain('不调用 AI');
    expect(markup).toContain('type="radio"');
    expect(markup).toContain('type="checkbox"');
  });

  it('renders real workspace metrics and a truthful AI workflow state', () => {
    const markup = renderToStaticMarkup(
      <WorkflowOverview
        snapshots={{status: 'ready', value: [REVIEW_EVIDENCE]}}
        workspace={{
          status: 'ok',
          workspaceId: REVIEW_EVIDENCE.workspaceId,
          capabilities: ['manual-core'],
        }}
        onListDocuments={() =>
          Promise.resolve({
            statusCode: 200,
            body: {status: 'ok', totalCount: 0, documents: []},
          })
        }
        onListProcessingRuns={() =>
          Promise.resolve({
            statusCode: 200,
            body: {status: 'ok', runs: []},
          })
        }
        onCancelProcessingRun={() =>
          Promise.resolve({
            statusCode: 200,
            body: {
              status: 'cancelled',
              runId: '11111111-1111-4111-8111-111111111111',
              version: 2,
            },
          })
        }
        onNavigate={() => undefined}
      />,
    );

    expect(markup).toContain('处理任务进度');
    expect(markup).toContain('AI 未启用，当前没有任务');
    expect(markup).toContain('没有处理任务');
    expect(markup).toContain('当前项目数据');
    expect(markup).toContain('来源片段');
    expect(markup).toContain('继续当前工作');
    expect(markup).toContain('原始文档始终保留');
    expect(markup).not.toContain('<main class="workflow-overview__main"');
  });

  it('keeps Split focused on document selection, materialization, and preview', () => {
    const markup = renderToStaticMarkup(
      <InformationEntrySplitWorkspace
        aiEnabled={false}
        onLoadEvidenceSnapshot={() =>
          Promise.resolve({
            statusCode: 200,
            body: {status: 'ok', snapshot: REVIEW_EVIDENCE},
          })
        }
        onLoadDocumentWorkingCopy={() =>
          Promise.resolve({
            statusCode: 200,
            body: {
              status: 'ok',
              workingCopy: {
                sourceSnapshotId: REVIEW_EVIDENCE.snapshotId,
                revision: 0,
                state: 'original',
                originalText: '## TinyPNG\n\n一项实用的图片压缩工具。',
                currentText: '## TinyPNG\n\n一项实用的图片压缩工具。',
                changed: false,
              },
            },
          })
        }
        onSaveDocumentWorkingCopy={() =>
          Promise.resolve({
            statusCode: 409,
            body: {status: 'rejected', issue: {code: 'unused'}},
          })
        }
        onRestoreDocumentWorkingCopy={() =>
          Promise.resolve({
            statusCode: 409,
            body: {status: 'rejected', issue: {code: 'unused'}},
          })
        }
        onCommitDocumentWorkingCopy={() =>
          Promise.resolve({
            statusCode: 409,
            body: {status: 'rejected', issue: {code: 'unused'}},
          })
        }
        onLoadSplitRuleProfile={() =>
          Promise.resolve({
            statusCode: 200,
            body: {
              status: 'ok',
              profile: {
                revision: 0,
                mode: 'one_section',
                minimumGroupCodePoints: 400,
                maximumGroupCodePoints: 4000,
                maximumFragmentsPerGroup: 8,
              },
            },
          })
        }
        onSaveSplitRuleProfile={() =>
          Promise.resolve({
            statusCode: 409,
            body: {status: 'rejected', issue: {code: 'unused'}},
          })
        }
        onTrialSplitRule={() =>
          Promise.resolve({
            statusCode: 409,
            body: {status: 'rejected', issue: {code: 'unused'}},
          })
        }
        onApplySplitRule={() =>
          Promise.resolve({
            statusCode: 409,
            body: {status: 'rejected', issue: {code: 'unused'}},
          })
        }
        onListAiSplitProposals={() =>
          Promise.resolve({
            statusCode: 200,
            body: {status: 'ok', proposals: []},
          })
        }
        onStartAiSplitProposal={() =>
          Promise.resolve({
            statusCode: 409,
            body: {status: 'rejected', issue: {code: 'unused'}},
          })
        }
        onAcceptAiSplitProposal={() =>
          Promise.resolve({
            statusCode: 409,
            body: {status: 'rejected', issue: {code: 'unused'}},
          })
        }
        onRejectAiSplitProposal={() =>
          Promise.resolve({
            statusCode: 409,
            body: {status: 'rejected', issue: {code: 'unused'}},
          })
        }
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
        onMaterializeManual={() =>
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
        onPreviewRestructure={() =>
          Promise.resolve({
            statusCode: 409,
            body: {status: 'rejected', issue: {code: 'unused'}},
          })
        }
        onApplyRestructure={() =>
          Promise.resolve({
            statusCode: 409,
            body: {status: 'rejected', issue: {code: 'unused'}},
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
        onSearch={() =>
          Promise.resolve({
            statusCode: 200,
            body: {
              status: 'ok',
              querySha256: 'a'.repeat(64),
              totalCount: 0,
              items: [],
              privateDocuments: {totalCount: 0, items: []},
            },
          })
        }
        onOpenEvidence={() => undefined}
      />,
    );

    expect(markup).toContain('<h1>拆分</h1>');
    expect(markup).toContain('来源文档导航');
    expect(markup).toContain('split-studio-grid__documents');
    expect(markup).toContain('split-studio-grid__preview');
    expect(markup).toContain('split-studio-grid__tools');
    expect(markup).toContain('批量构建文档条目');
    expect(markup).toContain('人工拆分工作台');
    expect(markup).toContain('结构规则');
    expect(markup).toContain('按结构直接生成');
    expect(markup.indexOf('entry-manual-split')).toBeLessThan(
      markup.indexOf('split-quick-action'),
    );
    expect(markup.match(/点击展开/g)).toHaveLength(4);
    expect(markup.match(/点击收起/g)).toHaveLength(4);
    expect(markup).not.toContain('类型关键词');
    expect(markup).not.toContain('领域关键词');
    expect(markup).not.toContain('高级筛选');
  });

  it('shows a preview-first restructuring workbench only for materialized documents', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryRestructure
        snapshotId={REVIEW_EVIDENCE.snapshotId}
        isPrivate={false}
        includePrivate={false}
        alreadyMaterialized={true}
        onLoadSnapshot={() =>
          Promise.resolve({
            statusCode: 200,
            body: {status: 'ok', snapshot: REVIEW_EVIDENCE},
          })
        }
        onPreview={() =>
          Promise.resolve({
            statusCode: 409,
            body: {status: 'rejected', issue: {code: 'unused'}},
          })
        }
        onApply={() =>
          Promise.resolve({
            statusCode: 409,
            body: {status: 'rejected', issue: {code: 'unused'}},
          })
        }
        onCommitted={() => Promise.resolve()}
      />,
    );

    expect(markup).toContain('重新拆分已有条目');
    expect(markup).toContain('先调整分组并预览影响');
    expect(markup).toContain('已导入的原文不会改变');
  });

  it('integrates manual scores and deterministic tag preferences into Tags', () => {
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
        sourceSubscriptionsEnabled={false}
        onListSourceSubscriptions={() =>
          Promise.reject(new Error('subscription boundary disabled'))
        }
        onReplaceSourceSubscriptions={() =>
          Promise.reject(new Error('subscription boundary disabled'))
        }
        onRunSourceSubscription={() =>
          Promise.reject(new Error('subscription boundary disabled'))
        }
      />,
    );
    const entry: Readonly<InformationEntry> = {
      workspaceId: REVIEW_EVIDENCE.workspaceId,
      entryId: '66666666-6666-4666-8666-666666666666',
      resourceId: REVIEW_EVIDENCE.resourceId,
      snapshotId: REVIEW_EVIDENCE.snapshotId,
      revision: 1,
      revisionId: '77777777-7777-4777-8777-777777777777',
      sourceKey: REVIEW_EVIDENCE.sourceKey,
      capturedAt: REVIEW_EVIDENCE.capturedAt,
      value: {
        documentOrder: 0,
        titlePath: 'TinyPNG',
        body: 'TinyPNG 是图片压缩工具。https://example.invalid/tool',
        bodySha256: 'f'.repeat(64),
        chunkMode: 'split',
        splitRuleVersion: 'synthetic-v1',
        isPrivate: false,
        usefulnessScore: 3,
        interestScore: 4,
        contentKeywords: [],
        domains: [],
        fragmentIds: ['55555555-5555-4555-8555-555555555555'],
      },
    };
    expect(materials).toContain('信源订阅');
    expect(materials).toContain('当前服务未启用订阅功能');
    const review = renderToStaticMarkup(
      <InformationEntryReviewControls
        entry={entry}
        contentKeywords=""
        usefulnessScore={3}
        interestScore={4}
        preferences={{
          status: 'ready',
          value: {
            status: 'ok',
            workspaceId: REVIEW_EVIDENCE.workspaceId,
            quickTags: ['实用工具'],
            automaticKeywords: {
              enabled: true,
              includeLinkDomains: false,
              excludedKeywords: ['example.invalid'],
            },
            vocabulary: {
              aliases: [{source: 'Postgres', canonical: 'PostgreSQL'}],
            },
            associationPolicy: DEFAULT_REVIEW_ASSOCIATION_POLICY,
          },
        }}
        onContentKeywordsChange={() => undefined}
        onUsefulnessScoreChange={() => undefined}
        onInterestScoreChange={() => undefined}
        onSavePreferences={() =>
          Promise.resolve({
            statusCode: 200,
            body: {
              status: 'ok',
              workspaceId: REVIEW_EVIDENCE.workspaceId,
              quickTags: ['实用工具'],
              automaticKeywords: {
                enabled: true,
                includeLinkDomains: false,
                excludedKeywords: ['example.invalid'],
              },
              vocabulary: {
                aliases: [{source: 'Postgres', canonical: 'PostgreSQL'}],
              },
              associationPolicy: DEFAULT_REVIEW_ASSOCIATION_POLICY,
            },
          })
        }
      />,
    );
    const reviewFallback = renderToStaticMarkup(
      <InformationEntryReviewControls
        entry={entry}
        contentKeywords=""
        usefulnessScore={3}
        interestScore={4}
        preferences={{status: 'error', message: 'synthetic unavailable'}}
        overridePreferences={{
          quickTags: ['会话工具'],
          automaticKeywords: {
            enabled: true,
            includeLinkDomains: false,
            excludedKeywords: [],
          },
          vocabulary: {aliases: [{source: 'tool', canonical: '工具'}]},
        }}
        onContentKeywordsChange={() => undefined}
        onUsefulnessScoreChange={() => undefined}
        onInterestScoreChange={() => undefined}
        onSavePreferences={() =>
          Promise.resolve({
            statusCode: 200,
            body: {
              status: 'ok',
              workspaceId: REVIEW_EVIDENCE.workspaceId,
              quickTags: [],
              automaticKeywords: {
                enabled: true,
                includeLinkDomains: false,
                excludedKeywords: [],
              },
              vocabulary: {aliases: []},
              associationPolicy: DEFAULT_REVIEW_ASSOCIATION_POLICY,
            },
          })
        }
      />,
    );
    const formal = renderToStaticMarkup(
      <FormalKnowledgeWorkspace
        onListSourceReviews={() =>
          Promise.resolve({
            statusCode: 200,
            body: {status: 'ok', totalCount: 0, items: []},
          })
        }
        onReviewSources={() =>
          Promise.resolve({statusCode: 200, body: {status: 'applied'}})
        }
        onCloseEvidence={() => undefined}
        aiAssociationEnabled={false}
        onAcceptAiAssociationProposal={() =>
          Promise.resolve({
            statusCode: 409,
            body: {status: 'rejected', issue: {code: 'unused'}},
          })
        }
        onListAiAssociationProposals={() =>
          Promise.resolve({
            statusCode: 200,
            body: {status: 'ok', proposals: []},
          })
        }
        onReadGraph={() =>
          Promise.resolve({
            statusCode: 200,
            body: {
              status: 'ok',
              querySha256: 'a'.repeat(64),
              candidateTotalCount: 0,
              candidates: [],
              graph: null,
            },
          })
        }
        onRejectAiAssociationProposal={() =>
          Promise.resolve({
            statusCode: 409,
            body: {status: 'rejected', issue: {code: 'unused'}},
          })
        }
        onReviseEdge={() =>
          Promise.resolve({statusCode: 200, body: {status: 'applied'}})
        }
        onStartAiAssociationProposal={() =>
          Promise.resolve({
            statusCode: 409,
            body: {status: 'rejected', issue: {code: 'unused'}},
          })
        }
        onOpenEvidence={() => undefined}
      />,
    );

    expect(materials).toContain('导入文档');
    expect(materials).toContain('作为隐私文档录入');
    expect(materials).toContain('本地文件');
    expect(materials).toContain('全部个人数据导入导出');
    expect(materials).toContain('恢复全部个人数据');
    expect(review).toContain('有用程度');
    expect(review).toContain('有趣程度');
    expect(review).toContain('自动标签建议');
    expect(review).toContain('实用工具');
    expect(review).toContain('标签别名合并');
    expect(review).not.toContain('处理方式');
    expect(review).not.toContain('判断原因');
    expect(review).not.toContain('手工联系');
    expect(reviewFallback).toContain('个人设置当前无法读取');
    expect(reviewFallback).toContain('新增快捷标签');
    expect(reviewFallback).toContain('标签别名合并');
    expect(reviewFallback).toContain('仅在当前页面有效');
    expect(formal).toContain('<h1>知识</h1>');
    expect(formal).not.toContain('origin-label');
    expect(formal).toContain('选择知识中心');
    expect(formal).toContain('搜索中心条目');
    expect(formal).toContain('设为知识中心');
    expect(formal).toContain('关系列表');
    expect(formal).not.toContain('当前不会写入数据');
  });

  it('renders editable association weights and a separate complete-private-document channel', () => {
    const policy = renderToStaticMarkup(
      <AssociationPolicyPanel
        policy={{
          revision: 2,
          version: 'struinfo.entry-association.local-index.v1',
          contentWeight: 50,
          typeWeight: 25,
          domainWeight: 25,
          threshold: 2_000,
          candidateLimit: 24,
          adjustmentStep: 500,
        }}
        saving={false}
        onSave={() => undefined}
      />,
    );
    const privateDocuments = renderToStaticMarkup(
      <PrivateDocumentResults
        totalCount={1}
        items={[
          {
            snapshot: {
              workspaceId: REVIEW_EVIDENCE.workspaceId,
              resourceId: REVIEW_EVIDENCE.resourceId,
              snapshotId: REVIEW_EVIDENCE.snapshotId,
              resourceKind: 'manual_text',
              sourceKey: 'manual:private-synthetic',
              capturedAt: REVIEW_EVIDENCE.capturedAt,
              fragmentCount: 0,
              isPrivate: true,
            },
            matchReasons: ['body'],
            entryMatchCount: 2,
            excerpt: 'Synthetic private document excerpt',
          },
        ]}
        onOpenEvidence={() => undefined}
      />,
    );

    expect(policy).toContain('联系权重');
    expect(policy).toContain('内容相似度');
    expect(policy).toContain('保存权重并重建联系');
    expect(privateDocuments).toContain('完整隐私文档');
    expect(privateDocuments).not.toContain('独立于 Entry');
    expect(privateDocuments).toContain('查看完整隐私文档');
  });

  it('renders the explainable Entry preference profile as a secondary Tags tool', () => {
    const profile = {
      revision: 2,
      enabled: false,
      rules: [
        {
          ruleId: '77777777-7777-4777-8777-777777777777',
          dimension: 'usefulness' as const,
          featureKind: 'content_keyword' as const,
          featureIdentity: 'postgresql',
          displayValue: 'PostgreSQL',
          effect: 'prefer' as const,
          weight: 4 as const,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <InformationEntryPreferenceProfilePanel
        state={{status: 'ready', value: {status: 'ok', profile}}}
        onReload={() => undefined}
        onSave={() =>
          Promise.resolve({
            statusCode: 200,
            body: {status: 'unchanged', profile},
          })
        }
        onSuggest={(includePrivate) =>
          Promise.resolve({
            statusCode: 200,
            body: {
              status: 'ok',
              includePrivate,
              visibleEntryCount: 0,
              totalCandidateCount: 0,
              truncated: false,
              candidates: [],
            },
          })
        }
        onTrial={({includePrivate}) =>
          Promise.resolve({
            statusCode: 200,
            body: {
              status: 'complete',
              profile,
              includePrivate,
              visibleEntryCount: 0,
              evaluatedEntryCount: 0,
              truncated: false,
              items: [],
            },
          })
        }
      />,
    );

    expect(markup).toContain('偏好规则');
    expect(markup).not.toContain('SECONDARY / PREFERENCE PROFILE');
    expect(markup).not.toContain('origin-label');
    expect(markup).toContain('手动新增规则');
    expect(markup).toContain('根据评分生成规则建议');
    expect(markup).toContain('试运行');
    expect(markup).toContain('本次建议与试运行包含隐私条目');
    expect(markup).toContain('不会自动修改条目');
  });
});
