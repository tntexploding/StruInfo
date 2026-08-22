import {useCallback, useEffect, useMemo, useState} from 'react';
import type {SyntheticEvent} from 'react';

import {
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TYPE_KEYWORDS,
  type EntryDomainKeyword,
  type EntryTypeKeyword,
  type EvidenceSnapshotSummary,
  type InformationEntryAssociationAction,
  type InformationEntryAssociationListResponse,
  type InformationEntryAssociationOverrideResponse,
  type InformationEntryAssociationRebuildResponse,
  type InformationDocumentTagWriteResponse,
  type InformationEntry,
  type InformationEntryDocumentListResponse,
  type InformationEntryDocumentView,
  type InformationEntryMaterializeResponse,
  type InformationEntryRevisionResponse,
  type InformationEntrySearchResponse,
  type M1cHttpResponse,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import type {ActionFeedback} from '../components/product_types.js';

const TYPE_LABELS: Readonly<Record<EntryTypeKeyword, string>> = {
  factual_material: '纪实资料',
  knowledge_explanation: '知识解释',
  operating_guideline: '操作规范',
  investigation_analysis: '调查分析',
  argument: '观点论证',
  personal_experience: '个人体验',
  interactive_collaboration: '互动协作',
  public_communication: '公共传播',
  literary_creation: '文学创作',
  other: '其他',
};

const DOMAIN_LABELS: Readonly<Record<EntryDomainKeyword, string>> = {
  mathematics_formal: '数理与形式系统',
  nature_environment: '自然与环境',
  engineering_computing: '工程、计算与技术',
  life_health: '生命、医学与健康',
  society_public_affairs: '社会与公共事务',
  economy_business: '经济、商业与组织',
  law_policy_governance: '法律、政策与治理',
  humanities_history: '人文、历史与思想',
  language_education: '语言、传播与教育',
  culture_arts: '文化、艺术与娱乐',
  daily_life: '日常生活、个人与家庭',
  other: '其他',
};

type EntryViewState =
  | Readonly<{status: 'loading'}>
  | Readonly<{
      status: 'ready';
      response: Extract<InformationEntrySearchResponse, {status: 'ok'}>;
    }>
  | Readonly<{status: 'error'; message: string}>;

type DocumentViewState =
  | Readonly<{status: 'loading'}>
  | Readonly<{
      status: 'ready';
      response: Extract<InformationEntryDocumentListResponse, {status: 'ok'}>;
    }>
  | Readonly<{status: 'error'; message: string}>;

export interface InformationEntryWorkspaceProps {
  readonly snapshots: readonly Readonly<EvidenceSnapshotSummary>[];
  readonly onMaterialize: (
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntryMaterializeResponse>>;
  readonly onRevise: (
    entryId: string,
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntryRevisionResponse>>;
  readonly onSearch: (
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntrySearchResponse>>;
  readonly onRebuildAssociations: (
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntryAssociationRebuildResponse>>;
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
  readonly onOpenEvidence: (
    snapshotId: string,
    fragmentId: string | undefined,
    includePrivate: boolean,
  ) => void;
}

export function InformationEntryWorkspace({
  snapshots,
  onAggregateDocumentTags,
  onListAssociations,
  onListDocuments,
  onMaterialize,
  onOpenEvidence,
  onRebuildAssociations,
  onRevise,
  onReviseAssociation,
  onReviseDocumentTags,
  onSearch,
}: InformationEntryWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [snapshotId, setSnapshotId] = useState('');
  const [typeKeyword, setTypeKeyword] = useState<'' | EntryTypeKeyword>('');
  const [domainKeyword, setDomainKeyword] = useState<'' | EntryDomainKeyword>(
    '',
  );
  const [includePrivate, setIncludePrivate] = useState(false);
  const [view, setView] = useState<EntryViewState>({status: 'loading'});
  const [documentView, setDocumentView] = useState<DocumentViewState>({
    status: 'loading',
  });
  const [selectedEntryId, setSelectedEntryId] = useState<string>();
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const [materializing, setMaterializing] = useState(false);

  const refreshDocuments = useCallback(async () => {
    setDocumentView({status: 'loading'});
    try {
      const response = await onListDocuments(includePrivate);
      if (response.body.status !== 'ok') {
        setDocumentView({
          status: 'error',
          message: describeFailure(response.body),
        });
        return;
      }
      setDocumentView({status: 'ready', response: response.body});
    } catch {
      setDocumentView({
        status: 'error',
        message: '无法读取 Document 聚合视图；现有 Entry 没有被修改。',
      });
    }
  }, [includePrivate, onListDocuments]);

  const executeSearch = useCallback(async () => {
    setView({status: 'loading'});
    try {
      const response = await onSearch({
        ...(query.trim() === '' ? {} : {text: query.trim()}),
        ...(snapshotId === '' ? {} : {snapshotId}),
        ...(typeKeyword === '' ? {} : {typeKeyword}),
        ...(domainKeyword === '' ? {} : {domainKeyword}),
        includePrivate,
        limit: 100,
      });
      if (response.body.status !== 'ok') {
        setView({status: 'error', message: describeFailure(response.body)});
        return;
      }
      setView({status: 'ready', response: response.body});
      setSelectedEntryId((current) =>
        response.body.status === 'ok' &&
        response.body.items.some((item) => item.entry.entryId === current)
          ? current
          : response.body.status === 'ok'
            ? response.body.items[0]?.entry.entryId
            : undefined,
      );
    } catch {
      setView({
        status: 'error',
        message: '本地 Entry 接口当前不可达；现有条目没有被修改。',
      });
    }
  }, [domainKeyword, includePrivate, onSearch, query, snapshotId, typeKeyword]);

  useEffect(() => {
    globalThis.queueMicrotask(() => void executeSearch());
  }, [executeSearch]);

  useEffect(() => {
    globalThis.queueMicrotask(() => void refreshDocuments());
  }, [refreshDocuments]);

  const selectedEntry = useMemo(() => {
    if (view.status !== 'ready') return undefined;
    return view.response.items.find(
      (item) => item.entry.entryId === selectedEntryId,
    )?.entry;
  }, [selectedEntryId, view]);

  const selectedDocument = useMemo(() => {
    if (documentView.status !== 'ready' || snapshotId === '') return undefined;
    return documentView.response.documents.find(
      (document) => document.snapshotId === snapshotId,
    );
  }, [documentView, snapshotId]);

  async function materialize() {
    if (snapshotId === '' || materializing) {
      setFeedback({
        kind: 'error',
        title: '请选择来源文档',
        detail: 'Entry 必须从当前工作区中的一个精确 Snapshot 生成。',
      });
      return;
    }
    setMaterializing(true);
    setFeedback(undefined);
    try {
      const response = await onMaterialize({
        snapshotId,
        chunkMode: 'split',
        includePrivate,
      });
      if (
        response.body.status !== 'created' &&
        response.body.status !== 'existing'
      ) {
        setFeedback({
          kind: 'error',
          title: '条目没有生成',
          detail: describeFailure(response.body),
        });
        return;
      }
      setFeedback({
        kind: 'success',
        title:
          response.body.status === 'created'
            ? '信息条目已生成'
            : '相同条目已经存在',
        detail:
          response.body.status === 'created'
            ? `新增 ${response.body.createdCount.toString()} 个可追溯 Entry。`
            : '幂等重试没有创建重复条目或修订。',
      });
      await executeSearch();
      await refreshDocuments();
    } catch {
      setFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: 'Entry 没有生成；Evidence 与正式知识保持不变。',
      });
    } finally {
      setMaterializing(false);
    }
  }

  function submitSearch(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(undefined);
    void executeSearch();
  }

  return (
    <div className="workspace-view entry-workspace">
      <header className="workspace-heading">
        <div>
          <p className="section-index">03 / INFORMATION ENTRY</p>
          <h1>文档条目</h1>
          <p>
            从不可变 Snapshot 生成轻量
            Entry，编辑内容、类型和领域关键词，再按正文、关键词与来源找回。
          </p>
        </div>
        <span className="origin-label origin-label--deterministic">
          来源绑定 · 无需 AI
        </span>
      </header>

      <InformationDocumentNavigator
        state={documentView}
        selectedSnapshotId={snapshotId}
        onSelect={(nextSnapshotId) => {
          setFeedback(undefined);
          setSnapshotId(nextSnapshotId);
        }}
        onRetry={() => void refreshDocuments()}
      />

      <section
        className="entry-command-panel"
        aria-labelledby="entry-command-title"
      >
        <header className="console-heading">
          <div>
            <p className="section-index">BUILD / FIND</p>
            <h2 id="entry-command-title">生成与查找</h2>
          </div>
          <span className="record-count">
            {view.status === 'ready'
              ? `${view.response.totalCount.toString()} 条`
              : '读取中'}
          </span>
        </header>
        <form
          className="entry-search-form"
          role="search"
          onSubmit={submitSearch}
        >
          <label className="field entry-search-query">
            <span>正文或关键词</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
              }}
              placeholder="留空浏览当前 Entry"
            />
          </label>
          <label className="field">
            <span>来源文档</span>
            <select
              value={snapshotId}
              onChange={(event) => {
                setSnapshotId(event.currentTarget.value);
              }}
            >
              <option value="">全部 Snapshot</option>
              {snapshots.map((snapshot) => (
                <option key={snapshot.snapshotId} value={snapshot.snapshotId}>
                  {snapshot.sourceKey}
                  {snapshot.isPrivate === true ? '（私密）' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>类型关键词</span>
            <select
              value={typeKeyword}
              onChange={(event) => {
                setTypeKeyword(
                  event.currentTarget.value as '' | EntryTypeKeyword,
                );
              }}
            >
              <option value="">全部类型</option>
              {ENTRY_TYPE_KEYWORDS.map((keyword) => (
                <option key={keyword} value={keyword}>
                  {TYPE_LABELS[keyword]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>领域关键词</span>
            <select
              value={domainKeyword}
              onChange={(event) => {
                setDomainKeyword(
                  event.currentTarget.value as '' | EntryDomainKeyword,
                );
              }}
            >
              <option value="">全部领域</option>
              {ENTRY_DOMAIN_KEYWORDS.map((keyword) => (
                <option key={keyword} value={keyword}>
                  {DOMAIN_LABELS[keyword]}
                </option>
              ))}
            </select>
          </label>
          <label className="privacy-query-toggle entry-private-toggle">
            <input
              type="checkbox"
              checked={includePrivate}
              onChange={(event) => {
                setIncludePrivate(event.currentTarget.checked);
              }}
            />
            查询隐私文档
          </label>
          <div className="entry-command-actions">
            <button
              className="secondary-action"
              type="button"
              onClick={() => void materialize()}
              disabled={materializing}
            >
              {materializing ? '正在生成…' : '按结构生成条目'}
            </button>
            <button className="primary-action" type="submit">
              查找 Entry
            </button>
          </div>
        </form>
        <ActionNotice feedback={feedback} />
      </section>

      {selectedDocument === undefined ? null : (
        <InformationDocumentPanel
          key={`${selectedDocument.snapshotId}:${selectedDocument.currentTags?.revision.toString() ?? '0'}`}
          document={selectedDocument}
          includePrivate={includePrivate}
          onOpenDocument={() => {
            onOpenEvidence(
              selectedDocument.snapshotId,
              undefined,
              selectedDocument.isPrivate === true,
            );
          }}
          onAggregate={onAggregateDocumentTags}
          onRevise={onReviseDocumentTags}
          onChanged={async (nextFeedback) => {
            setFeedback(nextFeedback);
            await refreshDocuments();
          }}
        />
      )}

      {view.status === 'loading' ? (
        <div className="entry-loading" role="status">
          正在读取当前条目…
        </div>
      ) : view.status === 'error' ? (
        <div className="error-state entry-state" role="alert">
          <h2>Entry 读取失败</h2>
          <p>{view.message}</p>
          <button
            className="secondary-action"
            type="button"
            onClick={() => void executeSearch()}
          >
            重试
          </button>
        </div>
      ) : view.response.items.length === 0 ? (
        <div className="empty-state entry-state">
          <h2>当前范围还没有 Entry</h2>
          <p>
            选择一个来源文档并执行“按结构生成条目”，不会改写原始 Snapshot
            或正式知识。
          </p>
        </div>
      ) : (
        <div className="entry-workbench">
          <section className="entry-result-list" aria-label="Entry 搜索结果">
            <header>
              <span>ORDER / RESULT</span>
              <strong>{view.response.totalCount.toString()}</strong>
            </header>
            <ol>
              {view.response.items.map(({entry, matchReasons}) => (
                <li key={entry.entryId}>
                  <button
                    type="button"
                    data-active={entry.entryId === selectedEntryId}
                    onClick={() => {
                      setSelectedEntryId(entry.entryId);
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
                        {entry.sourceKey} · r{entry.revision.toString()}
                        {entry.value.isPrivate ? ' · 私密' : ''}
                      </small>
                      {matchReasons.length > 0 ? (
                        <em>
                          {matchReasons.map(matchReasonLabel).join(' / ')}
                        </em>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>

          {selectedEntry === undefined ? null : (
            <div className="entry-detail-stack">
              <InformationEntryEditor
                key={`${selectedEntry.entryId}:${selectedEntry.revision.toString()}`}
                entry={selectedEntry}
                includePrivate={includePrivate}
                onOpenEvidence={onOpenEvidence}
                onLocateDocument={() => {
                  setSnapshotId(selectedEntry.snapshotId);
                }}
                onRevise={onRevise}
                onSaved={async (nextFeedback) => {
                  setFeedback(nextFeedback);
                  await executeSearch();
                  await refreshDocuments();
                }}
              />
              <InformationEntryAssociationPanel
                key={`${selectedEntry.entryId}:${selectedEntry.revision.toString()}:${includePrivate ? 'private' : 'public'}`}
                entry={selectedEntry}
                includePrivate={includePrivate}
                onList={onListAssociations}
                onOpenEvidence={onOpenEvidence}
                onRebuild={onRebuildAssociations}
                onRevise={onReviseAssociation}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InformationDocumentNavigator({
  onRetry,
  onSelect,
  selectedSnapshotId,
  state,
}: {
  readonly onRetry: () => void;
  readonly onSelect: (snapshotId: string) => void;
  readonly selectedSnapshotId: string;
  readonly state: DocumentViewState;
}) {
  return (
    <section
      className="entry-document-navigator"
      aria-labelledby="entry-document-navigator-title"
    >
      <header className="console-heading">
        <div>
          <p className="section-index">DOCUMENT / ENTRY MAP</p>
          <h2 id="entry-document-navigator-title">来源文档导航</h2>
        </div>
        <span className="record-count">
          {state.status === 'ready'
            ? `${state.response.totalCount.toString()} 份`
            : '读取中'}
        </span>
      </header>
      {state.status === 'error' ? (
        <div className="entry-document-navigator__error" role="alert">
          <span>{state.message}</span>
          <button className="text-action" type="button" onClick={onRetry}>
            重试
          </button>
        </div>
      ) : state.status === 'loading' ? (
        <p className="entry-document-navigator__loading" role="status">
          正在汇总 Document 与 Entry…
        </p>
      ) : (
        <div className="entry-document-navigator__rail">
          <button
            type="button"
            aria-pressed={selectedSnapshotId === ''}
            data-active={selectedSnapshotId === ''}
            onClick={() => {
              onSelect('');
            }}
          >
            <strong>全部文档</strong>
            <small>
              {state.response.documents
                .reduce((sum, document) => sum + document.entryCount, 0)
                .toString()}{' '}
              Entries
            </small>
          </button>
          {state.response.documents.map((document) => (
            <button
              key={document.snapshotId}
              type="button"
              aria-pressed={selectedSnapshotId === document.snapshotId}
              data-active={selectedSnapshotId === document.snapshotId}
              onClick={() => {
                onSelect(document.snapshotId);
              }}
            >
              <strong>{document.sourceKey}</strong>
              <small>
                {document.entryCount.toString()} Entries ·{' '}
                {(document.currentTags?.value.tags.length ?? 0).toString()} 标签
                {document.isPrivate === true ? ' · 私密' : ''}
              </small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function InformationDocumentPanel({
  document,
  includePrivate,
  onAggregate,
  onChanged,
  onOpenDocument,
  onRevise,
}: {
  readonly document: Readonly<InformationEntryDocumentView>;
  readonly includePrivate: boolean;
  readonly onAggregate: InformationEntryWorkspaceProps['onAggregateDocumentTags'];
  readonly onChanged: (feedback: ActionFeedback) => Promise<void>;
  readonly onOpenDocument: () => void;
  readonly onRevise: InformationEntryWorkspaceProps['onReviseDocumentTags'];
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tagsText, setTagsText] = useState(
    document.currentTags?.value.tags
      .map((tag) => tag.displayValue)
      .join('，') ?? '',
  );
  const [localFeedback, setLocalFeedback] = useState<ActionFeedback>();
  const expectedRevision = document.currentTags?.revision ?? 0;

  async function aggregate() {
    if (busy) return;
    setBusy(true);
    setLocalFeedback(undefined);
    try {
      const response = await onAggregate(document.snapshotId, {
        expectedRevision,
        includePrivate,
      });
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        setLocalFeedback({
          kind: 'error',
          title: '文档标签没有更新',
          detail: describeFailure(response.body),
        });
        return;
      }
      await onChanged({
        kind: 'success',
        title:
          response.body.status === 'applied'
            ? '文档标签已重新聚合'
            : '聚合结果没有变化',
        detail: '全文命中频次决定主顺序，Entry 关键词覆盖率作为辅助证据。',
      });
    } catch {
      setLocalFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '没有创建标签修订；Document 与 Entry 保持不变。',
      });
    } finally {
      setBusy(false);
    }
  }

  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const tags = tagsText
      .split(/[，,\n]/u)
      .map((value) => value.trim())
      .filter((value) => value !== '');
    setBusy(true);
    setLocalFeedback(undefined);
    try {
      const response = await onRevise(document.snapshotId, {
        expectedRevision,
        includePrivate,
        tags,
      });
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        setLocalFeedback({
          kind: 'error',
          title: '人工标签没有保存',
          detail: describeFailure(response.body),
        });
        return;
      }
      setEditing(false);
      await onChanged({
        kind: 'success',
        title:
          response.body.status === 'applied'
            ? '人工标签修订已保存'
            : '人工标签没有变化',
        detail: '这次修改独立成版；后续重新聚合也必须由用户明确触发。',
      });
    } catch {
      setLocalFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '没有创建人工标签修订。',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="entry-document-panel"
      aria-labelledby="entry-document-panel-title"
    >
      <header className="console-heading">
        <div>
          <p className="section-index">CURRENT DOCUMENT</p>
          <h2 id="entry-document-panel-title">{document.sourceKey}</h2>
          <p>
            {document.entryCount.toString()} 个 Entry ·{' '}
            {document.annotatedEntryCount.toString()} 个已标注
            {document.currentTags === undefined
              ? ' · 尚无文档标签'
              : ` · 标签修订 r${document.currentTags.revision.toString()}`}
          </p>
        </div>
        <button
          className="secondary-action"
          type="button"
          onClick={onOpenDocument}
        >
          查看完整 Document
        </button>
      </header>
      <div className="entry-document-panel__body">
        <div>
          <div className="entry-document-tags" aria-label="当前文档标签">
            {(document.currentTags?.value.tags.length ?? 0) === 0 ? (
              <span className="entry-document-tags__empty">
                标注 Entry 的内容关键词后，可按全文倾向聚合文档标签。
              </span>
            ) : (
              document.currentTags?.value.tags.map((tag) => (
                <span key={tag.normalizedValue} className="entry-document-tag">
                  <strong>{tag.displayValue}</strong>
                  <small>
                    全文 {tag.fullTextOccurrences.toString()} · Entry{' '}
                    {tag.entryCoverageCount.toString()}/
                    {document.currentTags?.value.entryCount.toString()}
                  </small>
                </span>
              ))
            )}
          </div>
          <p className="entry-document-panel__rule">
            {document.currentTags === undefined
              ? '尚未执行聚合'
              : `${document.currentTags.value.revisionKind === 'manual' ? '人工修订' : '确定性聚合'} · ${document.currentTags.value.ruleVersion}`}
          </p>
        </div>
        <div className="entry-document-panel__actions">
          <button
            className="secondary-action"
            type="button"
            disabled={busy}
            onClick={() => void aggregate()}
          >
            {busy ? '处理中…' : '按全文重新聚合'}
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={() => {
              setEditing((current) => !current);
            }}
          >
            {editing ? '取消编辑' : '人工编辑标签'}
          </button>
        </div>
      </div>
      {editing ? (
        <form
          className="entry-document-tag-editor"
          onSubmit={(event) => {
            void save(event);
          }}
        >
          <label className="field field--full">
            <span>文档标签（逗号或换行分隔）</span>
            <textarea
              rows={3}
              value={tagsText}
              onChange={(event) => {
                setTagsText(event.currentTarget.value);
              }}
              placeholder="留空并保存可清除当前文档标签"
            />
          </label>
          <button className="primary-action" type="submit" disabled={busy}>
            保存标签修订
          </button>
        </form>
      ) : null}
      <ActionNotice feedback={localFeedback} />
    </section>
  );
}

function InformationEntryEditor({
  entry,
  includePrivate,
  onOpenEvidence,
  onLocateDocument,
  onRevise,
  onSaved,
}: {
  readonly entry: Readonly<InformationEntry>;
  readonly includePrivate: boolean;
  readonly onOpenEvidence: InformationEntryWorkspaceProps['onOpenEvidence'];
  readonly onLocateDocument: () => void;
  readonly onRevise: InformationEntryWorkspaceProps['onRevise'];
  readonly onSaved: (feedback: ActionFeedback) => Promise<void>;
}) {
  const [body, setBody] = useState(entry.value.body);
  const [contentKeywords, setContentKeywords] = useState(
    entry.value.contentKeywords.map((value) => value.displayValue).join('，'),
  );
  const [typeKeyword, setTypeKeyword] = useState<EntryTypeKeyword>(
    entry.value.typeKeyword ?? 'factual_material',
  );
  const [typeCustomName, setTypeCustomName] = useState(
    entry.value.typeCustomName ?? '',
  );
  const initialDomains = entry.value.domains.map((value) => value.keyword);
  const initialCustomDomains = entry.value.domains.map(
    (value) => value.customName ?? '',
  );
  const [primaryDomain, setPrimaryDomain] = useState<'' | EntryDomainKeyword>(
    initialDomains[0] ?? '',
  );
  const [secondaryDomain, setSecondaryDomain] = useState<
    '' | EntryDomainKeyword
  >(initialDomains[1] ?? '');
  const [thirdDomain, setThirdDomain] = useState<'' | EntryDomainKeyword>(
    initialDomains[2] ?? '',
  );
  const [domainCustomNames, setDomainCustomNames] = useState([
    initialCustomDomains[0] ?? '',
    initialCustomDomains[1] ?? '',
    initialCustomDomains[2] ?? '',
  ]);
  const [saving, setSaving] = useState(false);
  const [localFeedback, setLocalFeedback] = useState<ActionFeedback>();

  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const keywords = contentKeywords
      .split(/[，,\n]/u)
      .map((value) => value.trim())
      .filter((value) => value !== '');
    if (primaryDomain === '') {
      setLocalFeedback({
        kind: 'error',
        title: '请选择一个主领域',
        detail: '主领域用于文档聚合；不会从来源或用户偏好中静默猜测。',
      });
      return;
    }
    const selections = [
      {keyword: primaryDomain, customName: domainCustomNames[0] ?? ''},
      ...(secondaryDomain === ''
        ? []
        : [
            {
              keyword: secondaryDomain,
              customName: domainCustomNames[1] ?? '',
            },
          ]),
      ...(thirdDomain === ''
        ? []
        : [
            {
              keyword: thirdDomain,
              customName: domainCustomNames[2] ?? '',
            },
          ]),
    ];
    if (keywords.length === 0) {
      setLocalFeedback({
        kind: 'error',
        title: '至少需要一个内容关键词',
        detail: '关键词用于 Entry 搜索与后续关联候选，不会替代正文。',
      });
      return;
    }
    setSaving(true);
    setLocalFeedback(undefined);
    try {
      const response = await onRevise(entry.entryId, {
        expectedRevision: entry.revision,
        includePrivate,
        annotation: {
          body,
          contentKeywords: keywords,
          typeKeyword,
          ...(typeKeyword === 'other' ? {typeCustomName} : {}),
          domains: selections.map(({customName, keyword}) => ({
            keyword,
            ...(keyword === 'other' ? {customName} : {}),
          })),
        },
      });
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        setLocalFeedback({
          kind: 'error',
          title: '条目标注没有保存',
          detail: describeFailure(response.body),
        });
        return;
      }
      await onSaved({
        kind: 'success',
        title:
          response.body.status === 'applied'
            ? 'Entry 新修订已保存'
            : 'Entry 内容没有变化',
        detail:
          response.body.status === 'applied'
            ? '旧修订仍保留；搜索现在读取新的当前修订。'
            : '没有创建重复修订。',
      });
    } catch {
      setLocalFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '本次编辑没有写入；原始 Snapshot 与当前 Entry 保持不变。',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="entry-editor" aria-labelledby="entry-editor-title">
      <header className="console-heading">
        <div>
          <p className="section-index">
            CURRENT REVISION / {entry.revision.toString()}
          </p>
          <h2 id="entry-editor-title">
            {entry.value.titlePath || '未命名条目'}
          </h2>
        </div>
        <div className="entry-editor__document-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={onLocateDocument}
          >
            返回所属 Document
          </button>
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
        </div>
      </header>
      <form
        className="entry-editor-form"
        onSubmit={(event) => void save(event)}
      >
        <label className="field field--full">
          <span>Entry 正文</span>
          <textarea
            rows={12}
            value={body}
            onChange={(event) => {
              setBody(event.currentTarget.value);
            }}
          />
          <small>编辑会追加修订，不会修改原始 Fragment。</small>
        </label>
        <label className="field field--full">
          <span>内容关键词（逗号或换行分隔）</span>
          <textarea
            rows={3}
            value={contentKeywords}
            onChange={(event) => {
              setContentKeywords(event.currentTarget.value);
            }}
            placeholder="例如：PostgreSQL，全文检索，个人知识库"
          />
        </label>
        <label className="field">
          <span>类型关键词</span>
          <select
            value={typeKeyword}
            onChange={(event) => {
              setTypeKeyword(event.currentTarget.value as EntryTypeKeyword);
            }}
          >
            {ENTRY_TYPE_KEYWORDS.map((keyword) => (
              <option key={keyword} value={keyword}>
                {TYPE_LABELS[keyword]}
              </option>
            ))}
          </select>
        </label>
        {typeKeyword === 'other' ? (
          <label className="field">
            <span>自定义类型名称</span>
            <input
              value={typeCustomName}
              onChange={(event) => {
                setTypeCustomName(event.currentTarget.value);
              }}
              required
            />
          </label>
        ) : null}
        <DomainField
          label="主领域"
          value={primaryDomain}
          customName={domainCustomNames[0] ?? ''}
          required
          onChange={(value) => {
            if (value !== '') setPrimaryDomain(value);
          }}
          onCustomNameChange={(value) => {
            setDomainCustomNames((current) => [
              value,
              current[1] ?? '',
              current[2] ?? '',
            ]);
          }}
        />
        <DomainField
          label="副领域 1（可选）"
          value={secondaryDomain}
          customName={domainCustomNames[1] ?? ''}
          onChange={setSecondaryDomain}
          onCustomNameChange={(value) => {
            setDomainCustomNames((current) => [
              current[0] ?? '',
              value,
              current[2] ?? '',
            ]);
          }}
        />
        <DomainField
          label="副领域 2（可选）"
          value={thirdDomain}
          customName={domainCustomNames[2] ?? ''}
          onChange={setThirdDomain}
          onCustomNameChange={(value) => {
            setDomainCustomNames((current) => [
              current[0] ?? '',
              current[1] ?? '',
              value,
            ]);
          }}
        />
        <ActionNotice feedback={localFeedback} />
        <div className="form-commit field--full">
          <p>保存后形成不可变修订；类型、领域和内容关键词彼此独立。</p>
          <button className="primary-action" type="submit" disabled={saving}>
            {saving ? '正在保存…' : '保存 Entry 修订'}
          </button>
        </div>
      </form>
    </section>
  );
}

type AssociationViewState =
  | Readonly<{status: 'loading'}>
  | Readonly<{
      status: 'ready';
      response: Extract<
        InformationEntryAssociationListResponse,
        {status: 'ok'}
      >;
    }>
  | Readonly<{status: 'error'; message: string}>;

function InformationEntryAssociationPanel({
  entry,
  includePrivate,
  onList,
  onOpenEvidence,
  onRebuild,
  onRevise,
}: {
  readonly entry: Readonly<InformationEntry>;
  readonly includePrivate: boolean;
  readonly onList: InformationEntryWorkspaceProps['onListAssociations'];
  readonly onOpenEvidence: InformationEntryWorkspaceProps['onOpenEvidence'];
  readonly onRebuild: InformationEntryWorkspaceProps['onRebuildAssociations'];
  readonly onRevise: InformationEntryWorkspaceProps['onReviseAssociation'];
}) {
  const [view, setView] = useState<AssociationViewState>({status: 'loading'});
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const [rebuilding, setRebuilding] = useState(false);
  const [updatingId, setUpdatingId] = useState<string>();

  const refresh = useCallback(async () => {
    setView({status: 'loading'});
    try {
      const response = await onList(entry.entryId, includePrivate);
      if (response.body.status !== 'ok') {
        setView({status: 'error', message: describeFailure(response.body)});
        return;
      }
      setView({status: 'ready', response: response.body});
    } catch {
      setView({
        status: 'error',
        message: '无法读取相关内容；Entry 与人工决定没有被修改。',
      });
    }
  }, [entry.entryId, includePrivate, onList]);

  useEffect(() => {
    globalThis.queueMicrotask(() => void refresh());
  }, [refresh]);

  async function rebuild() {
    if (rebuilding) return;
    setRebuilding(true);
    setFeedback(undefined);
    try {
      const response = await onRebuild({includePrivate});
      if (response.body.status !== 'rebuilt') {
        setFeedback({
          kind: 'error',
          title: '关联没有重建',
          detail: describeFailure(response.body),
        });
        return;
      }
      setFeedback({
        kind: 'success',
        title: '当前范围关联已重建',
        detail: `${response.body.entryCount.toString()} 个 Entry 生成 ${response.body.projectedCount.toString()} 条选择性关联；人工决定保持不变。`,
      });
      await refresh();
    } catch {
      setFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '没有替换派生关联；人工决定保持不变。',
      });
    } finally {
      setRebuilding(false);
    }
  }

  async function revise(
    relatedEntryId: string,
    expectedRevision: number,
    action: InformationEntryAssociationAction,
  ) {
    if (updatingId !== undefined) return;
    setUpdatingId(relatedEntryId);
    setFeedback(undefined);
    try {
      const response = await onRevise(entry.entryId, relatedEntryId, {
        expectedRevision,
        action,
        includePrivate,
      });
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        setFeedback({
          kind: 'error',
          title: '人工关联决定没有保存',
          detail: describeFailure(response.body),
        });
        return;
      }
      setFeedback({
        kind: 'success',
        title: '人工关联决定已保存',
        detail: `${associationActionLabel(action)}采用独立修订记录，后续重算不会覆盖。`,
      });
      await refresh();
    } catch {
      setFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '人工关联决定没有保存。',
      });
    } finally {
      setUpdatingId(undefined);
    }
  }

  const headingId = `entry-association-title-${entry.entryId}`;
  return (
    <section className="entry-association-panel" aria-labelledby={headingId}>
      <header className="console-heading">
        <div>
          <p className="section-index">SELECTIVE ASSOCIATION</p>
          <h2 id={headingId}>可能相关</h2>
          <p>
            本地索引先缩小候选，再分别计算内容、类型与领域相似度；这不是正式语义关系。
          </p>
        </div>
        <span className="record-count">
          {view.status === 'ready'
            ? `${view.response.totalCount.toString()} 条`
            : '读取中'}
        </span>
      </header>

      <div className="entry-association-toolbar">
        <p>
          {includePrivate
            ? '当前明确包含隐私 Entry；任一私密端点都只在本次范围内显示。'
            : '当前为普通范围，隐私 Entry 及涉及它们的关联均已排除。'}
        </p>
        <button
          className="secondary-action"
          type="button"
          disabled={rebuilding}
          onClick={() => void rebuild()}
        >
          {rebuilding ? '正在重建…' : '重建当前范围关联'}
        </button>
      </div>
      <ActionNotice feedback={feedback} />

      <div className="entry-association-state" aria-live="polite">
        {view.status === 'loading' ? (
          <p className="entry-association-message">正在读取相关内容…</p>
        ) : view.status === 'error' ? (
          <div className="entry-association-message" role="alert">
            <p>{view.message}</p>
            <button
              className="text-action"
              type="button"
              onClick={() => void refresh()}
            >
              重试
            </button>
          </div>
        ) : view.response.associations.length === 0 ? (
          <div className="entry-association-message">
            <p>当前还没有超过阈值的选择性关联。</p>
            <small>
              先为多个 Entry
              设置内容、类型和领域关键词，再执行“重建当前范围关联”。
            </small>
          </div>
        ) : (
          <ul className="entry-association-list">
            {view.response.associations.map((association) => {
              const related = association.relatedEntry;
              const overrideRevision = association.override?.revision ?? 0;
              const busy = updatingId === related.entryId;
              return (
                <li key={related.entryId} data-blocked={association.isBlocked}>
                  <article>
                    <header>
                      <div>
                        <span className="entry-association-score">
                          {association.isBlocked
                            ? '已屏蔽'
                            : `${scorePercentage(association.effectiveScore)}%`}
                        </span>
                        <h3>{related.value.titlePath || '未命名条目'}</h3>
                        <small>
                          {related.sourceKey} · r{related.revision.toString()}
                          {related.value.isPrivate ? ' · 私密' : ''}
                        </small>
                      </div>
                      <button
                        className="text-action"
                        type="button"
                        onClick={() => {
                          onOpenEvidence(
                            related.snapshotId,
                            related.value.fragmentIds[0],
                            related.value.isPrivate,
                          );
                        }}
                      >
                        查看来源
                      </button>
                    </header>
                    <p className="entry-association-excerpt">
                      {excerpt(related.value.body)}
                    </p>
                    <dl className="entry-association-metrics">
                      <div>
                        <dt>内容</dt>
                        <dd>
                          {scorePercentage(
                            association.projection?.contentSimilarity ?? 0,
                          )}
                          %
                        </dd>
                      </div>
                      <div>
                        <dt>类型</dt>
                        <dd>
                          {scorePercentage(
                            association.projection?.typeSimilarity ?? 0,
                          )}
                          %
                        </dd>
                      </div>
                      <div>
                        <dt>领域</dt>
                        <dd>
                          {scorePercentage(
                            association.projection?.domainSimilarity ?? 0,
                          )}
                          %
                        </dd>
                      </div>
                      <div>
                        <dt>基础分</dt>
                        <dd>
                          {scorePercentage(
                            association.projection?.baseScore ?? 0,
                          )}
                          %
                        </dd>
                      </div>
                    </dl>
                    <div
                      className="entry-association-basis"
                      aria-label="候选依据"
                    >
                      {(association.projection?.candidateBasis ?? []).map(
                        (basis) => (
                          <span key={basis}>
                            {associationBasisLabel(basis)}
                          </span>
                        ),
                      )}
                      {association.override === undefined ? null : (
                        <span data-manual="true">
                          人工：
                          {associationActionLabel(
                            association.override.value.action,
                          )}
                        </span>
                      )}
                    </div>
                    <div className="entry-association-actions">
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void revise(
                            related.entryId,
                            overrideRevision,
                            'enhance',
                          )
                        }
                      >
                        增强
                      </button>
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void revise(
                            related.entryId,
                            overrideRevision,
                            'weaken',
                          )
                        }
                      >
                        削弱
                      </button>
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={busy || association.isBlocked}
                        onClick={() =>
                          void revise(
                            related.entryId,
                            overrideRevision,
                            'block',
                          )
                        }
                      >
                        屏蔽
                      </button>
                      <button
                        className="text-action"
                        type="button"
                        disabled={
                          busy ||
                          association.override === undefined ||
                          association.override.value.action === 'restore'
                        }
                        onClick={() =>
                          void revise(
                            related.entryId,
                            overrideRevision,
                            'restore',
                          )
                        }
                      >
                        恢复自动结果
                      </button>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function DomainField({
  customName,
  label,
  onChange,
  onCustomNameChange,
  required = false,
  value,
}: {
  readonly customName: string;
  readonly label: string;
  readonly onChange: (value: '' | EntryDomainKeyword) => void;
  readonly onCustomNameChange: (value: string) => void;
  readonly required?: boolean;
  readonly value: '' | EntryDomainKeyword;
}) {
  return (
    <div className="entry-domain-field">
      <label className="field">
        <span>{label}</span>
        <select
          value={value}
          required={required}
          onChange={(event) => {
            onChange(event.currentTarget.value as '' | EntryDomainKeyword);
          }}
        >
          <option value="" disabled={required}>
            {required ? '选择主领域' : '不设置'}
          </option>
          {ENTRY_DOMAIN_KEYWORDS.map((keyword) => (
            <option key={keyword} value={keyword}>
              {DOMAIN_LABELS[keyword]}
            </option>
          ))}
        </select>
      </label>
      {value === 'other' ? (
        <label className="field">
          <span>自定义领域名称</span>
          <input
            value={customName}
            onChange={(event) => {
              onCustomNameChange(event.currentTarget.value);
            }}
            required
          />
        </label>
      ) : null}
    </div>
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

function associationActionLabel(
  value: InformationEntryAssociationAction,
): string {
  switch (value) {
    case 'enhance':
      return '增强';
    case 'weaken':
      return '削弱';
    case 'block':
      return '屏蔽';
    case 'restore':
      return '恢复自动结果';
  }
}

function associationBasisLabel(value: string): string {
  switch (value) {
    case 'content_keyword':
      return '内容词';
    case 'text_term':
      return '本地正文';
    case 'type_keyword':
      return '类型';
    case 'domain_keyword':
      return '领域';
    case 'manual_override':
      return '人工决定';
    default:
      return value;
  }
}

function scorePercentage(value: number): string {
  return (value / 100).toFixed(value % 100 === 0 ? 0 : 1);
}

function excerpt(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}…`;
}

function describeFailure(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '返回协议无法识别。';
  const issue = Reflect.get(value, 'issue') as unknown;
  if (typeof issue !== 'object' || issue === null) return '返回协议无法识别。';
  const code: unknown = Reflect.get(issue, 'code');
  return typeof code === 'string' ? code : 'unknown_failure';
}
