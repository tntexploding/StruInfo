import {useMemo, useState} from 'react';

import type {
  CurationState,
  EvidenceSnapshot,
  EvidenceSnapshotSummary,
  ReviewPreferencesResponse,
  ReviewPreferencesWrite,
} from '../api/m1c_api_contract.js';
import type {ActionFeedback, Loadable} from '../components/product_types.js';
import {KnowledgeChangeEditor} from './knowledge_change_editor.js';
import {createReviewTargetOptions} from './review_queue_model.js';
import {ReviewedKnowledgeQueue} from './reviewed_knowledge_queue.js';
import type {KnowledgeSearchTransport} from './reviewed_knowledge_queue_model.js';
import {VocabularyWorkbench} from './vocabulary_workbench.js';

export interface KnowledgeWorkspaceProps {
  readonly curation: Loadable<Readonly<CurationState>>;
  readonly evidence?: Readonly<EvidenceSnapshot> | undefined;
  readonly onApplyKnowledge: (body: unknown) => Promise<ActionFeedback>;
  readonly onApplyCuration: (body: unknown) => Promise<ActionFeedback>;
  readonly onOpenEvidence: (
    snapshotId: string,
    fragmentId: string,
    includePrivate: boolean,
  ) => void;
  readonly onPutTerm: (body: unknown) => Promise<ActionFeedback>;
  readonly onRefresh: () => void;
  readonly onSearch: KnowledgeSearchTransport;
  readonly onSelectEvidence: (
    snapshotId: string,
    includePrivate: boolean,
  ) => Promise<ActionFeedback>;
  readonly onSaveReviewPreferences: (
    preferences: Readonly<ReviewPreferencesWrite>,
  ) => Promise<ActionFeedback>;
  readonly reviewPreferences: Loadable<Readonly<ReviewPreferencesResponse>>;
  readonly snapshots: readonly Readonly<EvidenceSnapshotSummary>[];
}

export function KnowledgeWorkspace({
  curation,
  evidence,
  onApplyCuration,
  onApplyKnowledge,
  onOpenEvidence,
  onPutTerm,
  onRefresh,
  onSearch,
  onSelectEvidence,
  onSaveReviewPreferences,
  reviewPreferences,
  snapshots,
}: KnowledgeWorkspaceProps) {
  const [advancedTargetKey, setAdvancedTargetKey] = useState<string>();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const targetOptions = useMemo(
    () => createReviewTargetOptions(snapshots, evidence),
    [evidence, snapshots],
  );

  return (
    <div className="workspace-view knowledge-workspace">
      <header className="workspace-heading">
        <div>
          <p className="section-index">03 / ADVANCED MANUAL KNOWLEDGE</p>
          <h1>知识维护</h1>
          <p>
            将已审核 Fragment
            转为可检索知识；复杂条目再进入拆分、重组与关系编辑。
          </p>
        </div>
        <span className="origin-label origin-label--manual">非 AI 路径</span>
      </header>

      <aside className="knowledge-workspace__notice">
        <strong>两步而不是一次黑箱提交</strong>
        <p>
          审核保存处理判断；这里确认正式知识的标题、类型和正文。写入后立即用同一搜索边界回读，来源、修订与隐私范围保持可见。
        </p>
      </aside>

      {curation.status === 'ready' && reviewPreferences.status === 'ready' ? (
        <ReviewedKnowledgeQueue
          curation={curation.value}
          evidence={evidence}
          snapshots={snapshots}
          vocabularyPreferences={reviewPreferences.value.vocabulary}
          onApplyKnowledge={onApplyKnowledge}
          onOpenEvidence={onOpenEvidence}
          onSearch={onSearch}
          onSelectEvidence={onSelectEvidence}
          onUseAdvancedEditor={(targetId) => {
            setAdvancedTargetKey(targetId);
            setAdvancedOpen(true);
            globalThis.setTimeout(() => {
              globalThis.document
                .getElementById('advanced-knowledge-editor')
                ?.scrollIntoView({behavior: 'smooth', block: 'start'});
            }, 0);
          }}
        />
      ) : (
        <section className="reviewed-knowledge-queue empty-state" role="status">
          <h2>审核转知识暂不可用</h2>
          <p>需要先读取当前审核版本与外部工作区词表规则。</p>
        </section>
      )}

      {curation.status === 'ready' && reviewPreferences.status === 'ready' ? (
        <VocabularyWorkbench
          state={curation.value}
          preferences={reviewPreferences.value}
          onApplyCuration={onApplyCuration}
          onPutTerm={onPutTerm}
          onRefresh={onRefresh}
          onSavePreferences={onSaveReviewPreferences}
        />
      ) : (
        <section className="vocabulary-workbench empty-state" role="status">
          <h2>词表整理暂不可用</h2>
          <p>需要同时读取当前分类版本和外部工作区词表规则。</p>
        </section>
      )}

      <details
        className="knowledge-change-section"
        id="advanced-knowledge-editor"
        open={advancedOpen}
        onToggle={(event) => {
          setAdvancedOpen(event.currentTarget.open);
        }}
      >
        <summary>高级拆分、修订与关系编辑</summary>
        <div className="knowledge-change-section__body">
          <header className="console-heading">
            <div>
              <p className="section-index">APPEND-ONLY REVISIONS / RELATIONS</p>
              <h2>高级知识编辑</h2>
            </div>
            <span className="origin-label origin-label--manual">
              最高权限人工编辑
            </span>
          </header>
          <p className="section-introduction">
            仅在需要拆成多项、修订已有知识或建立类型化关系时使用；普通短条目使用上方队列即可。
          </p>
          <KnowledgeChangeEditor
            key={advancedTargetKey ?? 'manual-edit'}
            curation={curation.status === 'ready' ? curation.value : undefined}
            evidence={evidence}
            initialAuthorizationKey={advancedTargetKey}
            onApply={onApplyKnowledge}
            targetOptions={targetOptions}
            vocabularyPreferences={
              reviewPreferences.status === 'ready'
                ? reviewPreferences.value.vocabulary
                : undefined
            }
          />
        </div>
      </details>
    </div>
  );
}
