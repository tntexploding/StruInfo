import {useMemo} from 'react';

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
import {VocabularyWorkbench} from './vocabulary_workbench.js';

export interface KnowledgeWorkspaceProps {
  readonly curation: Loadable<Readonly<CurationState>>;
  readonly evidence?: Readonly<EvidenceSnapshot> | undefined;
  readonly onApplyKnowledge: (body: unknown) => Promise<ActionFeedback>;
  readonly onApplyCuration: (body: unknown) => Promise<ActionFeedback>;
  readonly onPutTerm: (body: unknown) => Promise<ActionFeedback>;
  readonly onRefresh: () => void;
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
  onPutTerm,
  onRefresh,
  onSaveReviewPreferences,
  reviewPreferences,
  snapshots,
}: KnowledgeWorkspaceProps) {
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
            面向需要精确控制的高级操作：创建不可变修订、重组知识并提交类型化关系。
          </p>
        </div>
        <span className="origin-label origin-label--manual">非 AI 路径</span>
      </header>

      <aside className="knowledge-workspace__notice">
        <strong>为什么它不在审核页？</strong>
        <p>
          快速审核只决定如何处理当前
          Fragment；知识变更集是正式写入知识项和关系的高级命令。两者保持分离，避免每次审核都填写底层结构。
        </p>
      </aside>

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

      <section
        className="knowledge-change-section"
        aria-labelledby="knowledge-change-title"
      >
        <header className="console-heading">
          <div>
            <p className="section-index">CHANGE SET / APPEND-ONLY REVISIONS</p>
            <h2 id="knowledge-change-title">知识变更集</h2>
          </div>
          <span className="origin-label origin-label--manual">
            最高权限人工编辑
          </span>
        </header>
        <p className="section-introduction">
          一次提交可以创建或修订多个知识项并建立关系；来源主张、摘要、推论和用户断言继续分开标记。
        </p>
        <KnowledgeChangeEditor
          curation={curation.status === 'ready' ? curation.value : undefined}
          evidence={evidence}
          onApply={onApplyKnowledge}
          targetOptions={targetOptions}
          vocabularyPreferences={
            reviewPreferences.status === 'ready'
              ? reviewPreferences.value.vocabulary
              : undefined
          }
        />
      </section>
    </div>
  );
}
