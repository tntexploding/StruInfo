import {useMemo, useState} from 'react';
import type {SyntheticEvent} from 'react';

import {
  EPISTEMIC_ROLES,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_REVIEW_STATES,
  type EpistemicRole,
  type EvidenceSnapshotSummary,
  type KnowledgeKind,
  type KnowledgeReviewState,
  type KnowledgeSearchCursor,
  type KnowledgeSearchItem,
  type KnowledgeSearchResponse,
  type M1cHttpResponse,
  type PrivateDocumentSearchResult,
} from '../api/m1c_api_contract.js';
import {
  EPISTEMIC_ROLE_LABELS,
  KNOWLEDGE_KIND_LABELS,
  REVIEW_STATE_LABELS,
} from '../components/product_labels.js';

type SearchViewState =
  | Readonly<{status: 'idle'}>
  | Readonly<{status: 'loading'}>
  | Readonly<{
      status: 'ready';
      response: Extract<KnowledgeSearchResponse, {status: 'ok'}>;
      request: Readonly<Record<string, unknown>>;
      includePrivate: boolean;
    }>
  | Readonly<{status: 'error'; title: string; detail: string}>;

export interface SearchWorkspaceProps {
  readonly onOpenEvidence: (
    snapshotId: string,
    returnFocus?: HTMLElement,
    fragmentId?: string,
    includePrivate?: boolean,
  ) => void;
  readonly onSearch: (
    body: unknown,
  ) => Promise<M1cHttpResponse<KnowledgeSearchResponse>>;
  readonly snapshots: readonly Readonly<EvidenceSnapshotSummary>[];
}

export function SearchWorkspace({
  onOpenEvidence,
  onSearch,
  snapshots,
}: SearchWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'exact' | 'substring'>('substring');
  const [titleField, setTitleField] = useState(true);
  const [bodyField, setBodyField] = useState(true);
  const [knowledgeKind, setKnowledgeKind] = useState<'' | KnowledgeKind>('');
  const [epistemicRole, setEpistemicRole] = useState<'' | EpistemicRole>('');
  const [reviewState, setReviewState] = useState<'' | KnowledgeReviewState>('');
  const [sourceSnapshotId, setSourceSnapshotId] = useState('');
  const [anchorItemId, setAnchorItemId] = useState('');
  const [relationDirection, setRelationDirection] = useState<
    'outgoing' | 'incoming' | 'either'
  >('either');
  const [relationTypeKeys, setRelationTypeKeys] = useState('');
  const [includePrivate, setIncludePrivate] = useState(false);
  const [view, setView] = useState<SearchViewState>({status: 'idle'});

  const sourceNames = useMemo(
    () =>
      new Map(
        snapshots.map((snapshot) => [snapshot.snapshotId, snapshot.sourceKey]),
      ),
    [snapshots],
  );

  async function execute(
    request: Readonly<Record<string, unknown>>,
    includePrivateForRequest: boolean,
    after?: Readonly<KnowledgeSearchCursor>,
  ) {
    setView({status: 'loading'});
    const page = request.page as Readonly<Record<string, unknown>>;
    const nextRequest = {
      ...request,
      page: {...page, ...(after === undefined ? {} : {after})},
    };
    try {
      const response = await onSearch({
        includePrivate: includePrivateForRequest,
        request: nextRequest,
      });
      if (response.body.status === 'ok') {
        setView({
          status: 'ready',
          response: response.body,
          request,
          includePrivate: includePrivateForRequest,
        });
        return;
      }
      setView({
        status: 'error',
        title:
          response.body.status === 'rejected'
            ? '查询条件未被接受'
            : '知识读取失败',
        detail: describeIssue(response.body.issue),
      });
    } catch {
      setView({
        status: 'error',
        title: '无法连接本地搜索接口',
        detail: '当前知识未被修改。确认本机 API 已启动后可以重试。',
      });
    }
  }

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = [
      ...(titleField ? ['title' as const] : []),
      ...(bodyField ? ['body' as const] : []),
    ];
    if (query.trim() !== '' && fields.length === 0) {
      setView({
        status: 'error',
        title: '请选择文本范围',
        detail: '有查询文本时，标题或正文至少选择一项。',
      });
      return;
    }
    const typeKeys = relationTypeKeys
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value !== '');
    const request = {
      ...(query.trim() === '' ? {} : {text: {value: query, mode, fields}}),
      filters: {
        knowledgeKinds: knowledgeKind === '' ? [] : [knowledgeKind],
        epistemicRoles: epistemicRole === '' ? [] : [epistemicRole],
        reviewStates: reviewState === '' ? [] : [reviewState],
        source:
          sourceSnapshotId === ''
            ? {kind: 'any'}
            : {
                kind: 'snapshot',
                snapshotId: sourceSnapshotId,
                inputKinds: ['citation', 'derivation'],
              },
        relation:
          anchorItemId.trim() === ''
            ? {kind: 'any'}
            : {
                kind: 'connected_to',
                anchorItemId: anchorItemId.trim(),
                direction: relationDirection,
                relationTypeKeys: typeKeys,
                reviewStates: [],
              },
      },
      page: {limit: 25},
    };
    void execute(request, includePrivate);
  }

  return (
    <div className="workspace-view search-workspace">
      <header className="workspace-heading">
        <div>
          <p className="section-index">03 / DETERMINISTIC RETRIEVAL</p>
          <h1>搜索与来源回溯</h1>
          <p>
            无需 AI
            或向量服务：按标题、正文、类型、审核状态、直接来源与一跳关系确定性查询。
          </p>
        </div>
        <span className="origin-label origin-label--deterministic">
          可复现排序 · 非 AI
        </span>
      </header>

      <form className="search-console" role="search" onSubmit={submit}>
        <label className="field search-query">
          <span>搜索已保存知识</span>
          <input
            type="search"
            maxLength={300}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
            placeholder="留空可浏览当前知识"
          />
        </label>
        <label className="field search-mode">
          <span>文本模式</span>
          <select
            value={mode}
            onChange={(event) => {
              setMode(event.currentTarget.value as 'exact' | 'substring');
            }}
          >
            <option value="substring">包含</option>
            <option value="exact">精确</option>
          </select>
        </label>
        <fieldset className="inline-choice">
          <legend>文本范围</legend>
          <label>
            <input
              type="checkbox"
              checked={titleField}
              onChange={(event) => {
                setTitleField(event.currentTarget.checked);
              }}
            />
            标题
          </label>
          <label>
            <input
              type="checkbox"
              checked={bodyField}
              onChange={(event) => {
                setBodyField(event.currentTarget.checked);
              }}
            />
            正文
          </label>
        </fieldset>
        <label className="privacy-query-toggle search-privacy-toggle">
          <input
            type="checkbox"
            checked={includePrivate}
            onChange={(event) => {
              setIncludePrivate(event.currentTarget.checked);
            }}
          />
          查询隐私文档
        </label>
        <button className="primary-action search-submit" type="submit">
          执行搜索
        </button>

        <details className="search-filters">
          <summary>结构化筛选</summary>
          <div className="search-filter-grid">
            <label className="field">
              <span>知识类型</span>
              <select
                value={knowledgeKind}
                onChange={(event) => {
                  setKnowledgeKind(
                    event.currentTarget.value as '' | KnowledgeKind,
                  );
                }}
              >
                <option value="">全部类型</option>
                {KNOWLEDGE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KNOWLEDGE_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>认识论角色</span>
              <select
                value={epistemicRole}
                onChange={(event) => {
                  setEpistemicRole(
                    event.currentTarget.value as '' | EpistemicRole,
                  );
                }}
              >
                <option value="">全部角色</option>
                {EPISTEMIC_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {EPISTEMIC_ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>审核状态</span>
              <select
                value={reviewState}
                onChange={(event) => {
                  setReviewState(
                    event.currentTarget.value as '' | KnowledgeReviewState,
                  );
                }}
              >
                <option value="">全部状态</option>
                {KNOWLEDGE_REVIEW_STATES.map((state) => (
                  <option key={state} value={state}>
                    {REVIEW_STATE_LABELS[state]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>直接来源</span>
              <select
                value={sourceSnapshotId}
                onChange={(event) => {
                  setSourceSnapshotId(event.currentTarget.value);
                }}
              >
                <option value="">任意来源</option>
                {snapshots.map((snapshot) => (
                  <option key={snapshot.snapshotId} value={snapshot.snapshotId}>
                    {snapshot.sourceKey}
                    {snapshot.isPrivate === true ? '（私密）' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>一跳关系锚点 Item ID（可选）</span>
              <input
                value={anchorItemId}
                onChange={(event) => {
                  setAnchorItemId(event.currentTarget.value);
                }}
              />
            </label>
            <label className="field">
              <span>关系方向</span>
              <select
                value={relationDirection}
                onChange={(event) => {
                  setRelationDirection(
                    event.currentTarget.value as
                      'outgoing' | 'incoming' | 'either',
                  );
                }}
              >
                <option value="either">任意方向</option>
                <option value="outgoing">从锚点出发</option>
                <option value="incoming">指向锚点</option>
              </select>
            </label>
            <label className="field field--wide">
              <span>关系类型键（逗号分隔，可选）</span>
              <input
                value={relationTypeKeys}
                onChange={(event) => {
                  setRelationTypeKeys(event.currentTarget.value);
                }}
              />
            </label>
          </div>
        </details>
      </form>

      <SearchResults
        sourceNames={sourceNames}
        state={view}
        onOpenEvidence={onOpenEvidence}
        onNext={(request, includePrivateForRequest, cursor) =>
          void execute(request, includePrivateForRequest, cursor)
        }
      />
    </div>
  );
}

function SearchResults({
  onNext,
  onOpenEvidence,
  sourceNames,
  state,
}: {
  readonly onNext: (
    request: Readonly<Record<string, unknown>>,
    includePrivate: boolean,
    cursor: Readonly<KnowledgeSearchCursor>,
  ) => void;
  readonly onOpenEvidence: (
    snapshotId: string,
    returnFocus?: HTMLElement,
    fragmentId?: string,
    includePrivate?: boolean,
  ) => void;
  readonly sourceNames: ReadonlyMap<string, string>;
  readonly state: SearchViewState;
}) {
  if (state.status === 'idle') {
    return (
      <section
        className="search-results"
        aria-labelledby="search-results-title"
      >
        <div className="empty-state">
          <p className="section-index">READY / NO QUERY</p>
          <h2 id="search-results-title">输入文本或直接浏览</h2>
          <p>结果会保留匹配原因、认识论角色、审核状态与直接来源。</p>
        </div>
      </section>
    );
  }
  if (state.status === 'loading') {
    return (
      <section className="search-results" aria-busy="true">
        <div className="loading-state" role="status">
          <span aria-hidden="true" />
          正在执行确定性查询…
        </div>
      </section>
    );
  }
  if (state.status === 'error') {
    return (
      <section className="search-results">
        <div className="error-state" role="alert">
          <h2>{state.title}</h2>
          <p>{state.detail}</p>
        </div>
      </section>
    );
  }
  const nextCursor = state.response.nextCursor;
  return (
    <section className="search-results" aria-labelledby="search-results-title">
      <header className="subsection-heading">
        <div>
          <p className="section-index">RESULT / {state.response.totalCount}</p>
          <h2 id="search-results-title">知识结果</h2>
        </div>
        <span className="query-identity" title={state.response.querySha256}>
          QUERY {state.response.querySha256.slice(0, 10)}…
        </span>
      </header>
      {state.response.items.length === 0 ? (
        <div className="empty-state" role="status">
          <h3>当前条件没有可见结果</h3>
          <p>
            {state.response.totalCount === 0
              ? '可以减少筛选条件，或先在审核工作区提交知识变更。'
              : '这是合法的续页空页；完整匹配总数保持不变。'}
          </p>
        </div>
      ) : (
        <ol className="knowledge-results">
          {state.response.items.map((item) => (
            <li key={item.itemId}>
              <KnowledgeResult
                item={item}
                sourceNames={sourceNames}
                onOpenEvidence={onOpenEvidence}
              />
            </li>
          ))}
        </ol>
      )}
      <PrivateDocumentResults
        documents={state.response.privateDocuments ?? []}
        totalCount={state.response.privateDocumentTotalCount ?? 0}
        enabled={state.includePrivate}
        onOpenEvidence={onOpenEvidence}
      />
      {nextCursor === undefined ? null : (
        <div className="pagination-strip">
          <span>
            当前页 {state.response.items.length} 项 · 全部{' '}
            {state.response.totalCount} 项
          </span>
          <button
            className="secondary-action"
            type="button"
            onClick={() => {
              onNext(state.request, state.includePrivate, nextCursor);
            }}
          >
            下一页
          </button>
        </div>
      )}
    </section>
  );
}

function KnowledgeResult({
  item,
  onOpenEvidence,
  sourceNames,
}: {
  readonly item: Readonly<KnowledgeSearchItem>;
  readonly onOpenEvidence: (
    snapshotId: string,
    returnFocus?: HTMLElement,
    fragmentId?: string,
    includePrivate?: boolean,
  ) => void;
  readonly sourceNames: ReadonlyMap<string, string>;
}) {
  return (
    <article className="knowledge-result">
      <header>
        <div className="result-labels">
          {item.isPrivate === true ? (
            <span className="privacy-badge">私密条目</span>
          ) : null}
          <span>{KNOWLEDGE_KIND_LABELS[item.value.knowledgeKind]}</span>
          <span data-role={item.value.epistemicRole}>
            {item.value.epistemicRole === 'source_excerpt'
              ? '来源摘录'
              : EPISTEMIC_ROLE_LABELS[item.value.epistemicRole]}
          </span>
          <span data-review={item.value.reviewState}>
            {REVIEW_STATE_LABELS[item.value.reviewState]}
          </span>
        </div>
        <p className="result-revision">REV {item.revision}</p>
      </header>
      <h3>{item.value.title}</h3>
      {item.value.body === undefined ? null : (
        <p className="result-body">{item.value.body}</p>
      )}
      <details className="result-identity">
        <summary>用于修订的稳定身份</summary>
        <dl>
          <div>
            <dt>Item ID</dt>
            <dd>
              <code>{item.itemId}</code>
            </dd>
          </div>
          <div>
            <dt>当前修订</dt>
            <dd>{item.revision}</dd>
          </div>
          <div>
            <dt>Revision ID</dt>
            <dd>
              <code>{item.revisionId}</code>
            </dd>
          </div>
        </dl>
        <p>在“审核与知识”中复用 Item ID，并把预期现有修订设为当前值。</p>
      </details>
      <dl className="match-facts">
        <div>
          <dt>匹配等级</dt>
          <dd>{matchRankLabel(item.matchRank)}</dd>
        </div>
        <div>
          <dt>文本命中</dt>
          <dd>
            {item.textMatches.length === 0
              ? '无 · 结构化筛选'
              : item.textMatches
                  .map(
                    (match) =>
                      `${match.field === 'title' ? '标题' : '正文'}${match.kind === 'exact' ? '精确' : '包含'}`,
                  )
                  .join('、')}
          </dd>
        </div>
        <div>
          <dt>关系命中</dt>
          <dd>
            {item.relationMatchCount}
            {item.relationMatchesTruncated ? '（显示部分）' : ''}
          </dd>
        </div>
      </dl>
      {item.sourceMatches.length === 0 ? (
        <p className="evidence-absence">
          当前查询未展开完整来源；使用“直接来源”筛选可返回精确 Fragment
          匹配。完整来源明细属于后续知识详情能力。
        </p>
      ) : (
        <div className="source-links" aria-label="直接来源">
          {item.sourceMatches.map((source) => (
            <button
              type="button"
              key={`${source.fragmentId}:${source.inputKind}:${source.inputOrdinal.toString()}`}
              onClick={(event) => {
                onOpenEvidence(
                  source.snapshotId,
                  event.currentTarget,
                  source.fragmentId,
                  item.isPrivate === true,
                );
              }}
            >
              <span>{source.inputKind === 'citation' ? '引用' : '派生'}</span>
              {sourceNames.get(source.snapshotId) ?? '打开来源 Snapshot'}
            </button>
          ))}
        </div>
      )}
      {item.relationMatches.length === 0 ? null : (
        <details className="relation-matches">
          <summary>查看一跳关系（{item.relationMatchCount}）</summary>
          <ul>
            {item.relationMatches.map((relation) => (
              <li key={`${relation.relationId}:${relation.direction}`}>
                <strong>{relation.relationTypeKey}</strong>
                {relation.isPrivate === true ? (
                  <span className="privacy-badge">私密关系</span>
                ) : null}
                <span>
                  {relation.direction === 'outgoing' ? '出向' : '入向'}
                </span>
                <span>{REVIEW_STATE_LABELS[relation.reviewState]}</span>
                {relation.qualifier === undefined ? null : (
                  <p>{relation.qualifier}</p>
                )}
                <code title="Relation ID">{relation.relationId}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function PrivateDocumentResults({
  documents,
  enabled,
  onOpenEvidence,
  totalCount,
}: {
  readonly documents: readonly Readonly<PrivateDocumentSearchResult>[];
  readonly enabled: boolean;
  readonly onOpenEvidence: (
    snapshotId: string,
    returnFocus?: HTMLElement,
    fragmentId?: string,
    includePrivate?: boolean,
  ) => void;
  readonly totalCount: number;
}) {
  if (!enabled) return null;
  return (
    <section
      className="private-document-results"
      aria-labelledby="private-documents-title"
    >
      <header className="subsection-heading">
        <div>
          <p className="section-index">PRIVATE FULL TEXT / {totalCount}</p>
          <h3 id="private-documents-title">隐私文档全文</h3>
        </div>
        <span className="privacy-badge">已显式解锁本次查询</span>
      </header>
      {documents.length === 0 ? (
        <p className="empty-copy">当前查询没有命中的隐私文档全文。</p>
      ) : (
        <ol className="private-document-list">
          {documents.map((document) => (
            <li key={document.snapshotId}>
              <article>
                <span className="privacy-badge">私密全文备份</span>
                <h4>{document.sourceKey}</h4>
                <p>{document.excerpt}</p>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={(event) => {
                    onOpenEvidence(
                      document.snapshotId,
                      event.currentTarget,
                      undefined,
                      true,
                    );
                  }}
                >
                  单独查看完整文档
                </button>
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function matchRankLabel(rank: 0 | 1 | 2 | 3 | 4): string {
  switch (rank) {
    case 0:
      return '标题精确';
    case 1:
      return '标题包含';
    case 2:
      return '正文精确';
    case 3:
      return '正文包含';
    case 4:
      return '结构化筛选';
  }
}

function describeIssue(
  issue: Readonly<{code: string; path?: string; budget?: string}>,
): string {
  const location = issue.path === undefined ? '' : ` · ${issue.path}`;
  const budget = issue.budget === undefined ? '' : ` · 上限 ${issue.budget}`;
  return `${issue.code}${location}${budget}`;
}
