import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import {type EvidenceSnapshot} from '../api/m1c_api_contract.js';
import {READY_HEALTH_FIXTURE} from '../health/mock_health_client.js';
import {InformationEntryPrivacyScope} from '../workspaces/information_entry_components.js';
import {InformationEntryTextSearchOptions} from '../workspaces/information_entry_search_controls.js';
import {AssociationPolicyPanel} from '../workspaces/association_policy_panel.js';
import {PrivateDocumentResults} from '../workspaces/private_document_results.js';

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

  it('renders the four document-centred workspaces without claiming AI capability', () => {
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
    expect(markup).toContain('源管理');
    expect(markup).toContain('文档阅读');
    expect(markup).not.toContain('>报告</strong>');
    expect(markup).toContain('数据库');
    expect(markup).toContain('设置');
    expect(markup.indexOf('文档阅读')).toBeLessThan(markup.indexOf('数据库'));
    expect(markup).not.toContain('M1D / FLOW');
    expect(markup).toContain('<dd>未配置</dd>');
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

    expect(markup).toContain('<dt>AI 接入</dt><dd>已配置</dd>');
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
        onReviewInbox={() => undefined}
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

    expect(markup).toContain('处理流程');
    expect(markup).toContain('任务队列');
    expect(markup).toContain('AI 中控');
    expect(markup).toContain('全部消息');
    expect(markup).toContain('内容统计');
    expect(markup).toContain('来源片段');
    expect(markup).not.toContain('最近文档');
    expect(markup).toContain('接收资料，整理内容，查询与阅读。');
    expect(markup).not.toContain('<main class="workflow-overview__main"');
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
});
