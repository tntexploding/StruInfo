import type {ReactNode} from 'react';

import type {
  AiTagProposalDecisionResponse,
  AiTagProposalListResponse,
  AiTagProposalStartResponse,
  InformationEntryAssociationListResponse,
  InformationEntryAssociationOverrideResponse,
  InformationEntryAssociationPolicyWriteResponse,
  InformationEntryAssociationRebuildResponse,
  InformationEntryExplorationPolicyWriteResponse,
  InformationEntryExplorationResponse,
  InformationEntrySearchIndexResponse,
  InformationEntryPreferenceProfileWriteResponse,
  InformationEntryPreferenceSuggestionResponse,
  InformationEntryPreferenceTrialResponse,
  InformationEntryAutomationExecuteResponse,
  InformationEntryAutomationExecutionListResponse,
  InformationEntryAutomationExecutionResponse,
  InformationEntryAutomationPolicyResponse,
  InformationEntryAutomationPolicyWriteResponse,
  InformationEntryAutomationTrialResponse,
  InformationDocumentTagWriteResponse,
  InformationEntry,
  InformationEntryDocumentListResponse,
  InformationEntryMaterializeResponse,
  InformationEntryRevisionResponse,
  InformationEntryRestructureApplyResponse,
  InformationEntryRestructurePreviewResponse,
  InformationEntrySearchResponse,
  M1cHttpResponse,
  ReviewPreferencesResponse,
  ReviewPreferencesWrite,
  EntryPreferenceProfile,
  EntryPreferenceRule,
  EntryAutomationPolicy,
  EntryAutomationWorkItemState,
  InformationEntryAutomationWorkItemWriteResponse,
  InformationEntryAutomationActionWriteResponse,
  InformationEntryAutomationWorkQueueResponse,
} from '../api/m1c_api_contract.js';
import {DOMAIN_LABELS, TYPE_LABELS} from './information_entry_shared.js';

export type InformationEntryViewState =
  | Readonly<{status: 'loading'}>
  | Readonly<{
      status: 'ready';
      response: Extract<InformationEntrySearchResponse, {status: 'ok'}>;
    }>
  | Readonly<{status: 'error'; message: string}>;

export type InformationDocumentViewState =
  | Readonly<{status: 'loading'}>
  | Readonly<{
      status: 'ready';
      response: Extract<InformationEntryDocumentListResponse, {status: 'ok'}>;
    }>
  | Readonly<{status: 'error'; message: string}>;

export interface InformationEntryServices {
  readonly onMaterialize: (
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntryMaterializeResponse>>;
  readonly onMaterializeManual: (
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntryMaterializeResponse>>;
  readonly onPreviewRestructure: (
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntryRestructurePreviewResponse>>;
  readonly onApplyRestructure: (
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntryRestructureApplyResponse>>;
  readonly onRevise: (
    entryId: string,
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntryRevisionResponse>>;
  readonly onSearch: (
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntrySearchResponse>>;
  readonly onLoadSearchIndex: () => Promise<
    M1cHttpResponse<InformationEntrySearchIndexResponse>
  >;
  readonly onRebuildSearchIndex: () => Promise<
    M1cHttpResponse<InformationEntrySearchIndexResponse>
  >;
  readonly onExplore: (
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntryExplorationResponse>>;
  readonly onRebuildAssociations: (
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntryAssociationRebuildResponse>>;
  readonly onReviseAssociationPolicy: (
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntryAssociationPolicyWriteResponse>>;
  readonly onReviseExplorationPolicy: (
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntryExplorationPolicyWriteResponse>>;
  readonly onListAssociations: (
    entryId: string,
    includePrivate: boolean,
  ) => Promise<M1cHttpResponse<InformationEntryAssociationListResponse>>;
  readonly onReviseAssociation: (
    entryId: string,
    relatedEntryId: string,
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntryAssociationOverrideResponse>>;
  readonly onListDocuments: (
    includePrivate: boolean,
  ) => Promise<M1cHttpResponse<InformationEntryDocumentListResponse>>;
  readonly onAggregateDocumentTags: (
    snapshotId: string,
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationDocumentTagWriteResponse>>;
  readonly onReviseDocumentTags: (
    snapshotId: string,
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationDocumentTagWriteResponse>>;
  readonly onListAiTagProposals: (
    entryId: string,
  ) => Promise<M1cHttpResponse<AiTagProposalListResponse>>;
  readonly onStartAiTagProposal: (
    entryId: string,
    requestKey: string,
  ) => Promise<M1cHttpResponse<AiTagProposalStartResponse>>;
  readonly onAcceptAiTagProposal: (
    entryId: string,
    proposalId: string,
  ) => Promise<M1cHttpResponse<AiTagProposalDecisionResponse>>;
  readonly onRejectAiTagProposal: (
    entryId: string,
    proposalId: string,
  ) => Promise<M1cHttpResponse<AiTagProposalDecisionResponse>>;
  readonly onSaveReviewPreferences: (
    value: Readonly<ReviewPreferencesWrite>,
  ) => Promise<M1cHttpResponse<ReviewPreferencesResponse>>;
  readonly onSaveEntryPreferenceProfile: (
    body: Readonly<{
      expectedRevision: number;
      enabled: boolean;
      rules: readonly Readonly<EntryPreferenceRule>[];
    }>,
  ) => Promise<M1cHttpResponse<InformationEntryPreferenceProfileWriteResponse>>;
  readonly onSuggestEntryPreferenceProfile: (
    includePrivate: boolean,
  ) => Promise<M1cHttpResponse<InformationEntryPreferenceSuggestionResponse>>;
  readonly onTrialEntryPreferenceProfile: (
    body: Readonly<{
      includePrivate: boolean;
      expectedProfileRevision: number;
      profile: Readonly<EntryPreferenceProfile>;
    }>,
  ) => Promise<M1cHttpResponse<InformationEntryPreferenceTrialResponse>>;
  readonly onLoadEntryAutomationPolicy: () => Promise<
    M1cHttpResponse<InformationEntryAutomationPolicyResponse>
  >;
  readonly onSaveEntryAutomationPolicy: (
    body: Readonly<{
      expectedRevision: number;
      enabled: boolean;
      paused: boolean;
      profileRevision: number;
      minimumMatchedRuleCount: number;
      advanceThresholds: Readonly<EntryAutomationPolicy['advanceThresholds']>;
      deferThresholds: Readonly<EntryAutomationPolicy['deferThresholds']>;
      budgets: Readonly<EntryAutomationPolicy['budgets']>;
      advanceActions?: Readonly<
        NonNullable<EntryAutomationPolicy['advanceActions']>
      >;
      failureMode: 'pause';
    }>,
  ) => Promise<M1cHttpResponse<InformationEntryAutomationPolicyWriteResponse>>;
  readonly onTrialEntryAutomationPolicy: (
    body: Readonly<{
      includePrivate: boolean;
      expectedPolicyRevision: number;
      expectedProfileRevision: number;
      policy: Readonly<EntryAutomationPolicy>;
      expectedEntries?: readonly Readonly<{
        entryId: string;
        revision: number;
      }>[];
      manualTakeoverEntryIds?: readonly string[];
    }>,
  ) => Promise<M1cHttpResponse<InformationEntryAutomationTrialResponse>>;
  readonly onExecuteEntryAutomation: (
    body: Readonly<{
      idempotencyKey: string;
      includePrivate: boolean;
      expectedPolicyRevision: number;
      expectedProfileRevision: number;
      expectedEntries: readonly Readonly<{
        entryId: string;
        revision: number;
      }>[];
      manualTakeoverEntryIds?: readonly string[];
    }>,
  ) => Promise<M1cHttpResponse<InformationEntryAutomationExecuteResponse>>;
  readonly onListEntryAutomationExecutions: (
    limit?: number,
  ) => Promise<
    M1cHttpResponse<InformationEntryAutomationExecutionListResponse>
  >;
  readonly onLoadEntryAutomationExecution: (
    runId: string,
  ) => Promise<M1cHttpResponse<InformationEntryAutomationExecutionResponse>>;
  readonly onListEntryAutomationWorkQueue: (
    includePrivate: boolean,
  ) => Promise<M1cHttpResponse<InformationEntryAutomationWorkQueueResponse>>;
  readonly onUpdateEntryAutomationWorkItem: (
    runId: string,
    claimOrdinal: number,
    body: Readonly<{
      expectedVersion: number;
      state: EntryAutomationWorkItemState;
      includePrivate: boolean;
    }>,
  ) => Promise<
    M1cHttpResponse<InformationEntryAutomationWorkItemWriteResponse>
  >;
  readonly onExecuteEntryAutomationWorkItemAction: (
    runId: string,
    claimOrdinal: number,
    body: Readonly<{
      expectedVersion: number;
      operation: 'apply' | 'undo';
      includePrivate: boolean;
    }>,
  ) => Promise<M1cHttpResponse<InformationEntryAutomationActionWriteResponse>>;
  readonly onOpenEvidence: (
    snapshotId: string,
    fragmentId: string | undefined,
    includePrivate: boolean,
  ) => void;
}

export function InformationEntryPrivacyScope({
  includePrivate,
  onChange,
  onlyPrivate,
}: {
  readonly includePrivate: boolean;
  readonly onChange: (scope: 'public' | 'all' | 'private') => void;
  readonly onlyPrivate: boolean;
}) {
  return (
    <label className="field entry-private-toggle">
      <span>隐私结果</span>
      <select
        value={onlyPrivate ? 'private' : includePrivate ? 'all' : 'public'}
        onChange={(event) => {
          onChange(event.currentTarget.value as 'public' | 'all' | 'private');
        }}
      >
        <option value="public">仅公开结果</option>
        <option value="all">公开与隐私结果</option>
        <option value="private">只看隐私结果</option>
      </select>
    </label>
  );
}
export function InformationEntryResults({
  ariaLabel,
  children,
  emptyDescription,
  onNextPage,
  onPreviousPage,
  onRetry,
  onSelectEntry,
  pageIndex,
  selectedEntryId,
  state,
}: {
  readonly ariaLabel: string;
  readonly children?: ReactNode;
  readonly emptyDescription: string;
  readonly onNextPage: () => void;
  readonly onPreviousPage: () => void;
  readonly onRetry: () => void;
  readonly onSelectEntry: (entryId: string) => void;
  readonly pageIndex: number;
  readonly selectedEntryId: string | undefined;
  readonly state: InformationEntryViewState;
}) {
  if (state.status === 'loading') {
    return (
      <div className="entry-loading" role="status">
        正在读取当前条目…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="error-state entry-state" role="alert">
        <h2>Entry 读取失败</h2>
        <p>{state.message}</p>
        <button className="secondary-action" type="button" onClick={onRetry}>
          重试
        </button>
      </div>
    );
  }
  if (state.response.items.length === 0) {
    return (
      <div className="empty-state entry-state">
        <h2>当前范围还没有 Entry</h2>
        <p>{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="entry-workbench">
      <section className="entry-result-list" aria-label={ariaLabel}>
        <header>
          <span>ORDER / RESULT</span>
          <strong>{state.response.totalCount.toString()}</strong>
        </header>
        <ol>
          {state.response.items.map(
            ({
              association,
              entry,
              filterReasons,
              matchReasons,
              retrievalScore,
              semanticMatch,
              textMatch,
            }) => (
              <li key={entry.entryId}>
                <button
                  type="button"
                  data-active={entry.entryId === selectedEntryId}
                  onClick={() => {
                    onSelectEntry(entry.entryId);
                  }}
                >
                  <span className="entry-result-list__order">
                    {(entry.value.documentOrder + 1)
                      .toString()
                      .padStart(2, '0')}
                  </span>
                  <span>
                    <strong>{entry.value.titlePath || '未命名条目'}</strong>
                    <small>
                      {entry.sourceKey} · v{entry.revision.toString()}
                      {entry.value.isPrivate ? ' · 私密' : ''}
                    </small>
                    {matchReasons.length > 0 ? (
                      <em>
                        命中：{matchReasons.map(matchReasonLabel).join(' / ')}
                        {textMatch === undefined ? null : (
                          <>
                            {' · '}
                            {textSearchModeLabel(textMatch.mode)} 词法分{' '}
                            {scorePercentage(textMatch.score)}/100
                          </>
                        )}
                      </em>
                    ) : null}
                    {semanticMatch === undefined ? null : (
                      <em>
                        语义相似度 {scorePercentage(semanticMatch.score)}/100
                        {retrievalScore === undefined
                          ? null
                          : ` · 综合排序分 ${scorePercentage(retrievalScore)}/100`}
                      </em>
                    )}
                    {filterReasons.length > 0 ? (
                      <em className="entry-result-list__filters">
                        筛选：{filterReasons.map(filterReasonLabel).join(' / ')}
                      </em>
                    ) : null}
                    {association === undefined ? null : (
                      <em className="entry-result-list__association">
                        {association.depth.toString()} 跳 · 路径最低分{' '}
                        {scorePercentage(association.effectiveScore)}%
                      </em>
                    )}
                  </span>
                </button>
              </li>
            ),
          )}
        </ol>
        <footer className="entry-pagination" aria-label="Entry 结果分页">
          <button
            className="secondary-action"
            type="button"
            disabled={pageIndex === 0}
            onClick={onPreviousPage}
          >
            上一页
          </button>
          <span>第 {(pageIndex + 1).toString()} 页 · 每页最多 20 条</span>
          <button
            className="secondary-action"
            type="button"
            disabled={state.response.nextCursor === undefined}
            onClick={onNextPage}
          >
            下一页
          </button>
        </footer>
      </section>
      {children === undefined ? null : (
        <div className="entry-detail-stack">{children}</div>
      )}
    </div>
  );
}

export function InformationEntryReadOnlyDetail({
  entry,
  variant,
  onOpenEvidence,
}: {
  readonly entry: Readonly<InformationEntry>;
  readonly variant: 'query' | 'split';
  readonly onOpenEvidence: InformationEntryServices['onOpenEvidence'];
}) {
  return (
    <article
      className="entry-readonly-detail"
      aria-labelledby="entry-readonly-title"
    >
      <header className="console-heading">
        <div>
          <p className="section-index">
            {variant === 'split' ? 'SPLIT PREVIEW' : 'RESULT DETAIL'} / r
            {entry.revision.toString()}
          </p>
          <h2 id="entry-readonly-title">
            {entry.value.titlePath || '未命名条目'}
          </h2>
          <p>
            {entry.sourceKey} · 第 {(entry.value.documentOrder + 1).toString()}{' '}
            条{entry.value.isPrivate ? ' · 隐私内容' : ''}
          </p>
        </div>
        <button
          className="secondary-action"
          type="button"
          onClick={() => {
            onOpenEvidence(
              entry.snapshotId,
              entry.value.fragmentIds[0],
              entry.value.isPrivate,
            );
          }}
        >
          查看精确来源
        </button>
      </header>
      <div className="entry-readonly-detail__body">{entry.value.body}</div>
      <dl className="entry-readonly-detail__facts">
        <div>
          <dt>拆分方式</dt>
          <dd>
            {entry.value.chunkMode === 'split' ? '按结构拆分' : '全文条目'}
          </dd>
        </div>
        <div>
          <dt>类型</dt>
          <dd>
            {entry.value.typeKeyword === undefined
              ? '未标注'
              : TYPE_LABELS[entry.value.typeKeyword]}
          </dd>
        </div>
        <div>
          <dt>领域</dt>
          <dd>
            {entry.value.domains.length === 0
              ? '未标注'
              : entry.value.domains
                  .map(
                    (domain) =>
                      domain.customName ?? DOMAIN_LABELS[domain.keyword],
                  )
                  .join(' / ')}
          </dd>
        </div>
      </dl>
      <div className="entry-readonly-detail__keywords" aria-label="内容关键词">
        {entry.value.contentKeywords.length === 0 ? (
          <span>尚无内容关键词</span>
        ) : (
          entry.value.contentKeywords.map((keyword) => (
            <span key={keyword.normalizedValue}>{keyword.displayValue}</span>
          ))
        )}
      </div>
      {variant === 'split' ? (
        <p className="workflow-boundary-note">
          原始 Snapshot
          是不可变证据。这里检查生成后的段落；若要修改拆分前全文，请在“导入”页保存为一个新的
          Snapshot，再重新生成 Entry。
        </p>
      ) : null}
    </article>
  );
}
function matchReasonLabel(value: string): string {
  switch (value) {
    case 'title':
      return '标题';
    case 'body':
      return '正文';
    case 'content_keyword':
      return '内容词';
    case 'type_keyword':
      return '类型';
    case 'domain_keyword':
      return '领域';
    default:
      return value;
  }
}

function textSearchModeLabel(value: string): string {
  switch (value) {
    case 'exact':
      return '精确';
    case 'substring':
      return '包含';
    case 'fuzzy':
      return '近似';
    default:
      return value;
  }
}
function filterReasonLabel(value: string): string {
  switch (value) {
    case 'content_keyword':
      return '内容词';
    case 'source':
      return '来源';
    case 'document':
      return '文档';
    case 'type':
      return '类型';
    case 'domain':
      return '领域';
    case 'chunk_mode':
      return '拆分方式';
    case 'published_time':
      return '发布日期';
    case 'captured_time':
      return '采集时间';
    case 'private_scope':
      return '隐私范围';
    default:
      return value;
  }
}

function scorePercentage(value: number): string {
  return (value / 100).toFixed(value % 100 === 0 ? 0 : 1);
}
