import {FloatingToolPanel} from '../components/floating_tool_panel.js';
import {SourceHistoryWorkspace} from './source_history_workspace.js';
import {DocumentIntakePanel} from './document_intake_panel.js';
import {useRememberedDisclosure} from '../components/use_remembered_disclosure.js';
import {useEffect, useRef, useState} from 'react';
import type {M1cApiClient} from '../api/m1c_api_client.js';
import type {EvidenceSnapshot} from '../api/m1c_api_contract.js';
import {
  aiError,
  aiWorkflowCommand,
  type IntakeRecord,
} from '../api/ai_workflow_client.js';
import {ReadingContent} from '../components/reading_content.js';
import {
  sourceDisplayName,
  safeReadingLink,
} from '../components/reading_text.js';
import {TwoPane} from '../components/two_pane.js';
import {
  MaterialsWorkspace,
  type MaterialsWorkspaceProps,
} from './materials_workspace.js';
import {SourceSubscriptionPanel} from './source_subscription_panel.js';
import {useInboxPreviews} from './use_inbox_previews.js';
import {useInboxAiReview, receiptTaskStatus} from './use_inbox_ai_review.js';
import {intakeReviewKind} from './inbox_review_state.js';
import {useIntakeDirectory} from './use_intake_directory.js';
import {
  isManualIntakeOrigin,
  matchesIntakeSource,
} from './intake_source_state.js';
const KINDS: Record<string, string> = {
  rss_atom: 'RSS / Atom',
  json_api: '信息接口',
  github_markdown: 'Git 文档',
  web: '网页',
  plugin: '连接器',
  subscription: '订阅',
  remote_document: '网页资料',
  manual_text: '手动输入',
  uploaded_file: '文件上传',
  git_file: 'Git 文档',
};
export function IntakeWorkspace({
  api,
  ...props
}: MaterialsWorkspaceProps & {
  api: Pick<M1cApiClient, 'loadEvidenceSnapshot'>;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [includePrivate, setIncludePrivate] = useState(false);
  const {sources, origins, byId, received, error, ready, reload} =
    useIntakeDirectory(props, includePrivate);
  const [translations, setTranslations] = useState<
    ReadonlyMap<string, {title: string; body: string}>
  >(new Map());
  const [translatedDocument, setTranslatedDocument] = useState<string>();
  const [translating, setTranslating] = useState(false);
  const translationLock = useRef(false);
  const [sourceId, setSourceId] = useState(
    props.reviewTarget?.subscriptionId ?? 'all',
  );
  const [selectedId, setSelectedId] = useState(
    props.reviewTarget?.snapshotId ?? '',
  );
  const [filter, setFilter] = useState(
    props.reviewTarget?.snapshotId || props.reviewTarget?.subscriptionId
      ? 'all'
      : props.reviewTarget
        ? 'review'
        : 'pending',
  );
  const [sourceFilter, setSourceFilter] = useState('');
  const [sort, setSort] = useState('pending');
  const [reviewDocument, setReviewDocument] = useState<{
    snapshotId: string;
    title: string;
  }>();
  const [tool, setTool] = useState<'capture' | 'sources' | 'review'>();
  const [source, setSource] = useState<EvidenceSnapshot>();
  const [readFailure, setReadFailure] = useState<{
    id: string;
    message: string;
  }>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const lock = useRef(false);
  const [summaryEnabled, setSummaryEnabled] =
    useRememberedDisclosure('inbox-ai-summary');
  const visibleSources = sources.filter((s) => includePrivate || !s.isPrivate);
  const subscriptionIds = new Set(visibleSources.map((s) => s.subscriptionId));
  const matchesSource = (id: string, key = sourceId) =>
    matchesIntakeSource(origins.get(id), key, subscriptionIds);
  const sourceDocuments = received.filter((s) => matchesSource(s.snapshotId));
  const documents = sourceDocuments
    .filter(
      (s) =>
        filter === 'all' ||
        (filter === 'review'
          ? intakeReviewKind(byId.get(s.snapshotId))
          : (byId.get(s.snapshotId)?.value.receipt ?? 'accepted') === filter),
    )
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  const totalPages = Math.max(1, Math.ceil(documents.length / 20));
  const currentPage = Math.min(page, totalPages - 1);
  const current = documents.slice(currentPage * 20, (currentPage + 1) * 20);
  const selected =
    documents.find((s) => s.snapshotId === selectedId) ?? current[0];
  const selectedRecord = selected ? byId.get(selected.snapshotId) : undefined;
  const preview = useInboxPreviews(
    current.map((s) => s.snapshotId),
    includePrivate,
    summaryEnabled,
  );
  const sourceName = (snapshotId: string) => {
    const origin = origins.get(snapshotId);
    return (
      preview.previews.get(snapshotId)?.source.name ??
      visibleSources.find((s) => s.subscriptionId === origin?.subscriptionId)
        ?.label ??
      (isManualIntakeOrigin(origin) ? '手动放入' : '来源待识别')
    );
  };
  const ai = useInboxAiReview(
    current.map((s) => s.snapshotId),
    () => {
      void reload();
      props.onRefresh();
    },
  );
  const pending = sourceDocuments.filter(
    (s) => byId.get(s.snapshotId)?.value.receipt === 'pending',
  );
  const history = sourceDocuments
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    .slice(0, 3);
  const historyPreview = useInboxPreviews(
    history.map((s) => s.snapshotId),
    includePrivate,
    false,
  );
  const selectedSnapshot = selected?.snapshotId;
  const selectedTask = ai.tasks.find(
    (task) => task.request.snapshotId === selectedSnapshot,
  );
  useEffect(() => {
    const request = new AbortController();
    if (!selectedSnapshot) return;
    void api
      .loadEvidenceSnapshot(selectedSnapshot, {
        includePrivate,
        signal: request.signal,
      })
      .then((response) => {
        if (request.signal.aborted) return;
        if (response.body.status !== 'ok')
          throw new Error('全文暂不可用，请重新选择或刷新。');
        setSource(response.body.snapshot);
        setReadFailure(undefined);
      })
      .catch((e: unknown) => {
        if (!request.signal.aborted)
          setReadFailure({
            id: selectedSnapshot,
            message: e instanceof Error ? e.message : '全文读取失败',
          });
      });
    return () => {
      request.abort();
    };
  }, [selectedSnapshot, api, includePrivate]);
  const readError =
    readFailure && readFailure.id === selectedSnapshot
      ? readFailure.message
      : '';
  async function decide(
    action: 'accept' | 'reject' | 'reset',
    target: string[],
  ) {
    if (lock.current || !ready || !target.length) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    let saved = 0,
      queued = 0;
    const queueErrors: string[] = [];
    try {
      for (let start = 0; start < target.length; start += 100) {
        const items = target.slice(start, start + 100).flatMap((snapshotId) => {
          const r = byId.get(snapshotId);
          return r ? [{snapshotId, expectedVersion: r.version}] : [];
        });
        if (!items.length) continue;
        const result = await aiWorkflowCommand<{
          records: IntakeRecord[];
          failed: {code: string}[];
          queued?: string[];
          queueFailed?: {code: string}[];
        }>('intake_receive', {
          action,
          items,
          processAccepted: action === 'accept',
        });
        saved += result.records.length;
        queued += result.queued?.length ?? 0;
        queueErrors.push(
          ...(result.queueFailed ?? []).map((failure) =>
            aiError(new Error(failure.code)),
          ),
        );
        if (result.failed.length) throw new Error(result.failed[0]?.code);
      }
      setMessage(
        '已' +
          (action === 'accept'
            ? '接受'
            : action === 'reject'
              ? '拒绝'
              : '恢复') +
          ' ' +
          String(saved) +
          ' 份文档。' +
          (action === 'accept'
            ? '已提交 ' + String(queued) + ' 项整理任务。'
            : '') +
          (queueErrors.length ? '部分未排队：' + (queueErrors[0] ?? '') : ''),
      );
      setChecked(new Set());
    } catch (e) {
      setMessage('已完成 ' + String(saved) + ' 份。' + aiError(e));
    } finally {
      lock.current = false;
      setBusy(false);
      await reload();
      props.onRefresh();
    }
  }
  const chooseSource = (id: string) => {
    setSourceId(id);
    setSelectedId('');
    setTranslatedDocument(undefined);
    setPage(0);
    setChecked(new Set());
    setTool(id === 'manual' ? 'capture' : undefined);
  };
  const selectedSource = sources.find((s) => s.subscriptionId === sourceId);
  const listedSources = sources
    .filter(
      (s) =>
        (includePrivate || !s.isPrivate) &&
        (s.label + ' ' + s.sourceAlias)
          .toLowerCase()
          .includes(sourceFilter.toLowerCase()),
    )
    .map((s) => ({
      ...s,
      count: received.filter(
        (d) =>
          matchesSource(d.snapshotId, s.subscriptionId) &&
          byId.get(d.snapshotId)?.value.receipt === 'pending',
      ).length,
    }))
    .sort((a, b) => {
      if (sort === 'active' && a.enabled !== b.enabled)
        return Number(b.enabled) - Number(a.enabled);
      return sort === 'name'
        ? a.label.localeCompare(b.label, 'zh-CN')
        : b.count - a.count || a.label.localeCompare(b.label, 'zh-CN');
    });
  const otherDocuments = received.filter((s) =>
    matchesSource(s.snapshotId, 'other'),
  );
  const otherPending = otherDocuments.filter(
    (s) => byId.get(s.snapshotId)?.value.receipt === 'pending',
  ).length;
  const manualDocuments = received.filter((s) =>
    matchesSource(s.snapshotId, 'manual'),
  );
  const manualPending = manualDocuments.filter(
    (s) => byId.get(s.snapshotId)?.value.receipt === 'pending',
  ).length;
  const allPending = received.filter(
    (s) => byId.get(s.snapshotId)?.value.receipt === 'pending',
  ).length;
  const sourceHistory = (
    <>
      <h3>最近接收</h3>
      {history.length ? (
        history.map((item) => (
          <button
            key={item.snapshotId}
            className="text-action"
            onClick={() => {
              setTool(undefined);
              setFilter('all');
              setSelectedId(item.snapshotId);
              setTranslatedDocument(undefined);
            }}
          >
            {historyPreview.previews.get(item.snapshotId)?.title ??
              sourceDisplayName(item)}
          </button>
        ))
      ) : (
        <p>尚未接收到文章。</p>
      )}
    </>
  );
  const canDecide = ready && !error && !busy && !ai.busy;
  const decisionIds = new Set(
    received
      .filter((s) => !s.isPrivate && byId.has(s.snapshotId))
      .map((s) => s.snapshotId),
  );
  const receiptIds = checked.size
    ? [...checked].filter((id) => decisionIds.has(id))
    : selected && decisionIds.has(selected.snapshotId)
      ? [selected.snapshotId]
      : [];
  async function translate() {
    if (!selected || selected.isPrivate || translationLock.current) return;
    if (translations.has(selected.snapshotId)) {
      setTranslatedDocument(
        translatedDocument === selected.snapshotId
          ? undefined
          : selected.snapshotId,
      );
      return;
    }
    const id = selected.snapshotId;

    translationLock.current = true;
    setTranslating(true);
    setMessage('');
    try {
      const value = await aiWorkflowCommand<{title: string; body: string}>(
        'intake_translate',
        {snapshotId: id},
      );
      setTranslations((prior) => new Map(prior).set(id, value));
      setTranslatedDocument(id);
    } catch (e) {
      setMessage(
        e instanceof Error && e.message === 'ai_price_window_closed'
          ? '当前为高价时段，请在低价时段重新点击翻译。'
          : aiError(e),
      );
    } finally {
      translationLock.current = false;
      setTranslating(false);
    }
  }
  const documentHeading = selected ? (
    <div className="intake-document-meta">
      <h2>
        {preview.previews.get(selected.snapshotId)?.title ??
          historyPreview.previews.get(selected.snapshotId)?.title ??
          sourceDisplayName(selected)}
      </h2>
      <p>
        来源：{sourceName(selected.snapshotId)}
        {preview.previews.get(selected.snapshotId)?.source.kind
          ? ' · ' +
            (KINDS[
              preview.previews.get(selected.snapshotId)?.source.kind ?? ''
            ] ?? '订阅资料')
          : ''}
        {' · 接收于 '}
        {new Date(selected.capturedAt).toLocaleString('zh-CN')}
        {safeReadingLink(selected.canonicalUri) ? (
          <>
            {' '}
            ·{' '}
            <a
              href={safeReadingLink(selected.canonicalUri)}
              target="_blank"
              rel="noreferrer"
            >
              原网页
            </a>
          </>
        ) : null}
      </p>
      {selectedTask ? (
        <p className="intake-ai-status">{receiptTaskStatus(selectedTask)}</p>
      ) : null}
      {selectedRecord &&
      ['held', 'blocked'].includes(selectedRecord.value.decision) ? (
        <p className="intake-held-reason">
          需要核对：{selectedRecord.value.reason}
        </p>
      ) : null}
      {preview.previews.get(selected.snapshotId)?.summary ? (
        <p className="intake-summary">
          AI 摘要 · {preview.previews.get(selected.snapshotId)?.summary?.text}
        </p>
      ) : null}
    </div>
  ) : null;
  if (historyOpen)
    return (
      <SourceHistoryWorkspace
        sources={sources}
        initialSource={sourceId}
        onClose={() => {
          setHistoryOpen(false);
          void reload();
          props.onRefresh();
        }}
        onImported={() => {
          void reload();
          props.onRefresh();
        }}
      />
    );
  return (
    <section
      className="workspace-view journey-workspace intake-journey"
      aria-label="文档入口"
    >
      <header className="workflow-page-heading">
        <div>
          <h1>文档入口</h1>
          <p>查看订阅新文章或放入文件，审核后送入工作台。</p>
        </div>
        <div className="journey-action-group workspace-page-actions ef-glass">
          <button
            className="secondary-action"
            onClick={() => {
              setHistoryOpen(true);
            }}
          >
            补收往期
          </button>
          <button
            className="secondary-action"
            onClick={() => {
              void reload();
              props.onRefresh();
            }}
          >
            刷新列表
          </button>
        </div>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      <TwoPane
        name="intake"
        left={
          <div className="editorial-intake-collection">
            <FloatingToolPanel title="选择来源" preferredWidth={420}>
              <div className="journey-list-heading">
                <h2>来源</h2>
                <button
                  className="text-action"
                  onClick={() => {
                    setTool('sources');
                  }}
                >
                  管理订阅
                </button>
              </div>
              <div className="journey-source-search">
                <input
                  aria-label="筛选来源"
                  placeholder="查找来源"
                  value={sourceFilter}
                  onChange={(e) => {
                    setSourceFilter(e.target.value);
                  }}
                />
                <select
                  aria-label="来源排序"
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value);
                  }}
                >
                  <option value="pending">待审优先</option>
                  <option value="active">活跃订阅优先</option>
                  <option value="name">来源名称</option>
                </select>
              </div>
              <label className="journey-private-choice">
                <input
                  type="checkbox"
                  checked={includePrivate}
                  onChange={(e) => {
                    setIncludePrivate(e.target.checked);
                    setChecked(new Set());
                    setSelectedId('');
                    setTranslatedDocument(undefined);
                  }}
                />
                本次显示隐私文档
              </label>
              <div className="journey-source-list">
                <section
                  className="journey-source-card"
                  data-selected={sourceId === 'all'}
                >
                  <button
                    className="journey-source-title"
                    aria-pressed={sourceId === 'all'}
                    onClick={() => {
                      chooseSource('all');
                    }}
                  >
                    <strong>全部来源</strong>
                    <span>{allPending} 待审</span>
                  </button>
                </section>
                <section
                  className="journey-source-card journey-manual-source"
                  data-pending={manualPending > 0}
                  data-selected={sourceId === 'manual'}
                >
                  <button
                    className="journey-source-title"
                    aria-label="手动放入文档"
                    aria-pressed={sourceId === 'manual'}
                    onClick={() => {
                      chooseSource('manual');
                    }}
                  >
                    <strong>手动放入文档</strong>
                    <span>
                      {manualPending
                        ? String(manualPending) + ' 待审'
                        : '本地输入'}
                    </span>
                  </button>
                  {sourceId === 'manual' ? (
                    <div className="journey-source-detail">
                      <p>
                        粘贴文字或上传文件。放入的文档在这里审核，接受后进入工作台。
                      </p>
                      {sourceHistory}
                    </div>
                  ) : null}
                </section>
                {ready && otherDocuments.length > 0 ? (
                  <section
                    className="journey-source-card"
                    data-selected={sourceId === 'other'}
                    data-pending={otherPending > 0}
                  >
                    <button
                      className="journey-source-title"
                      aria-pressed={sourceId === 'other'}
                      onClick={() => {
                        chooseSource('other');
                      }}
                    >
                      <strong>其他接收来源</strong>
                      <span>
                        {otherPending
                          ? String(otherPending) + ' 待审'
                          : String(otherDocuments.length) + ' 份'}
                      </span>
                    </button>
                    {sourceId === 'other' ? (
                      <div className="journey-source-detail">
                        <p>
                          这些资料保留了原始来源，但未匹配到当前订阅。它们不属于手动放入的文档。
                        </p>
                        {sourceHistory}
                      </div>
                    ) : null}
                  </section>
                ) : null}
                {listedSources.map((s) => (
                  <section
                    className="journey-source-card"
                    key={s.subscriptionId}
                    data-pending={s.count > 0}
                    data-selected={sourceId === s.subscriptionId}
                  >
                    <button
                      className="journey-source-title"
                      aria-expanded={sourceId === s.subscriptionId}
                      onClick={() => {
                        chooseSource(
                          sourceId === s.subscriptionId
                            ? 'all'
                            : s.subscriptionId,
                        );
                      }}
                    >
                      <strong>{s.label}</strong>
                      <span className="journey-source-badges">
                        <span
                          className="journey-source-status"
                          data-state={s.enabled ? 'active' : 'paused'}
                        >
                          {s.enabled ? '已订阅' : '已暂停'}
                        </span>
                        {s.count > 0 ? <span>{s.count} 待审</span> : null}
                      </span>
                    </button>
                    {sourceId === s.subscriptionId ? (
                      <div className="journey-source-detail">
                        <p>
                          {KINDS[s.kind] ?? s.kind} ·{' '}
                          {s.enabled
                            ? '每 ' + String(s.intervalMinutes) + ' 分钟检查'
                            : '接收已暂停'}
                        </p>
                        <p>
                          {'description' in s &&
                          typeof s.description === 'string' &&
                          s.description
                            ? s.description
                            : '尚未填写内容说明。可在管理订阅中补充；以下是实际收到的文章。'}
                        </p>
                        {sourceHistory}
                      </div>
                    ) : null}
                  </section>
                ))}
              </div>
            </FloatingToolPanel>
            <header className="intake-reading-header">
              <div>
                <h2>
                  {selectedSource?.label ??
                    (sourceId === 'manual'
                      ? '手动放入文档'
                      : sourceId === 'other'
                        ? '其他接收来源'
                        : '全部来源')}
                </h2>
                <span
                  className="journey-flow-arrow"
                  data-active={pending.length > 0}
                >
                  → {pending.length} 待审核
                </span>
              </div>
              <select
                aria-label="接收状态"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setChecked(new Set());
                  setPage(0);
                  setSelectedId('');
                  setTranslatedDocument(undefined);
                }}
              >
                <option value="pending">待审核</option>
                <option value="review">需要人工核对</option>
                <option value="accepted">已接受</option>
                <option value="rejected">已拒绝</option>
                <option value="all">全部记录</option>
              </select>
            </header>
            <div className="intake-article-strip" aria-label="此来源的文章">
              {current.map((s) => (
                <div
                  key={s.snapshotId}
                  className="intake-article-choice"
                  data-selected={selected?.snapshotId === s.snapshotId}
                >
                  <input
                    type="checkbox"
                    aria-label={
                      '选择 ' +
                      (preview.previews.get(s.snapshotId)?.title ??
                        sourceDisplayName(s))
                    }
                    checked={checked.has(s.snapshotId)}
                    onChange={(e) => {
                      setChecked((old) => {
                        const next = new Set(old);
                        if (e.target.checked) next.add(s.snapshotId);
                        else next.delete(s.snapshotId);
                        return next;
                      });
                    }}
                  />
                  <button
                    onClick={() => {
                      setSelectedId(s.snapshotId);
                      setTranslatedDocument(undefined);
                    }}
                    title={
                      preview.previews.get(s.snapshotId)?.title ??
                      sourceDisplayName(s)
                    }
                  >
                    <span className="intake-article-title">
                      {preview.previews.get(s.snapshotId)?.title ??
                        sourceDisplayName(s)}
                    </span>
                    <span className="intake-article-source">
                      来源：{sourceName(s.snapshotId)}
                    </span>
                  </button>
                </div>
              ))}
            </div>
            {documents.length > 20 ? (
              <div className="journey-pagination">
                <button
                  disabled={currentPage === 0}
                  onClick={() => {
                    setPage(currentPage - 1);
                  }}
                >
                  上一页
                </button>
                <span>
                  {currentPage + 1} / {totalPages}
                </span>
                <button
                  disabled={currentPage + 1 >= totalPages}
                  onClick={() => {
                    setPage(currentPage + 1);
                  }}
                >
                  下一页
                </button>
              </div>
            ) : null}
          </div>
        }
      >
        {tool ? (
          <div className="journey-full-tool">
            <header>
              <h2>
                {tool === 'capture'
                  ? '手动放入文档'
                  : tool === 'review'
                    ? '接收详情'
                    : '订阅管理'}
              </h2>
              <button
                className="secondary-action"
                onClick={() => {
                  setTool(undefined);
                  if (tool === 'capture') setFilter('all');
                  void reload();
                }}
              >
                {tool === 'capture'
                  ? '查看已放入文档（' + String(manualDocuments.length) + '）'
                  : '返回待审文章'}
              </button>
            </header>
            {tool === 'capture' ? (
              <MaterialsWorkspace {...props} presentation="capture" />
            ) : tool === 'review' && reviewDocument ? (
              <section aria-label="接收审核与拦截">
                <DocumentIntakePanel
                  key={reviewDocument.snapshotId}
                  snapshotId={reviewDocument.snapshotId}
                  title={reviewDocument.title}
                  onChanged={() => {
                    void reload();
                    props.onRefresh();
                  }}
                  onOpenDocument={props.onOpenEvidence}
                />
              </section>
            ) : (
              <SourceSubscriptionPanel
                enabled={props.sourceSubscriptionsEnabled}
                onList={props.onListSourceSubscriptions}
                onReplace={props.onReplaceSourceSubscriptions}
                onRun={props.onRunSourceSubscription}
              />
            )}
          </div>
        ) : (
          <>
            {!ready && !error ? (
              <p role="status">正在读取来源与接收状态…</p>
            ) : null}
            {selected ? (
              <>
                <div className="intake-full-reading">
                  {source?.snapshotId !== selected.snapshotId ||
                  source.structures.length === 0
                    ? documentHeading
                    : null}
                  {source?.snapshotId === selected.snapshotId ? (
                    translatedDocument === selected.snapshotId &&
                    translations.has(selected.snapshotId) ? (
                      <ReadingContent
                        text={translations.get(selected.snapshotId)?.body ?? ''}
                        baseUri={selected.canonicalUri}
                        leadingContent={documentHeading}
                        scrollLabel="待审文档临时译文"
                      />
                    ) : (
                      source.structures.map((s, index) => (
                        <ReadingContent
                          key={s.structureId}
                          text={s.normalizedText}
                          omitLeadingTitle={
                            preview.previews.get(selected.snapshotId)?.title
                          }
                          baseUri={selected.canonicalUri}
                          leadingContent={
                            index === 0 ? documentHeading : undefined
                          }
                          scrollLabel="待审核文档全文"
                        />
                      ))
                    )
                  ) : readError ? (
                    <p role="alert">{readError}</p>
                  ) : (
                    <p role="status">正在读取全文…</p>
                  )}
                </div>
              </>
            ) : (
              <div className="journey-empty">
                <h2>
                  {!ready
                    ? '正在读取文档'
                    : pending.length === 0
                      ? '当前范围已审核完成'
                      : '暂无匹配文档'}
                </h2>
                <p>可以检查其他来源，或手动放入新的文档。</p>
                {sourceDocuments.some(
                  (s) =>
                    (byId.get(s.snapshotId)?.value.receipt ?? 'accepted') ===
                    'accepted',
                ) ? (
                  <button
                    className="journey-proceed"
                    onClick={() => {
                      const item = sourceDocuments.find(
                        (s) =>
                          (byId.get(s.snapshotId)?.value.receipt ??
                            'accepted') === 'accepted',
                      );
                      if (item)
                        props.onOpenDocument?.(
                          item.snapshotId,
                          Boolean(item.isPrivate),
                        );
                    }}
                  >
                    → 进入工作台
                  </button>
                ) : null}
              </div>
            )}
            {selected &&
            pending.length === 0 &&
            (selectedRecord?.value.receipt ?? 'accepted') === 'accepted' ? (
              <button
                className="journey-proceed journey-proceed--inline"
                onClick={() =>
                  props.onOpenDocument?.(
                    selected.snapshotId,
                    Boolean(selected.isPrivate),
                  )
                }
              >
                审核完成 → 在工作台打开
              </button>
            ) : null}
            <footer className="journey-floating-bar">
              <div className="intake-action-section">
                <div className="journey-action-group">
                  <button
                    aria-describedby="intake-manual-explanation"
                    className="primary-action"
                    disabled={!canDecide || !receiptIds.length}
                    onClick={() => void decide('accept', receiptIds)}
                  >
                    {checked.size
                      ? '接受所选并整理（' + String(checked.size) + '）'
                      : '我已审核，接受并整理'}
                  </button>
                  <button
                    className="danger-action"
                    disabled={!canDecide || !receiptIds.length}
                    onClick={() => void decide('reject', receiptIds)}
                  >
                    {checked.size ? '拒绝所选' : '拒绝'}
                  </button>
                  <details className="journey-action-menu">
                    <summary>更多</summary>
                    <div>
                      <button
                        disabled={!selected}
                        onClick={() => {
                          if (selected) {
                            setReviewDocument({
                              snapshotId: selected.snapshotId,
                              title:
                                preview.previews.get(selected.snapshotId)
                                  ?.title ?? sourceDisplayName(selected),
                            });
                            setTool('review');
                          }
                        }}
                      >
                        接收详情与正文恢复
                      </button>
                      <button
                        disabled={!canDecide || !pending.length}
                        onClick={() =>
                          void decide(
                            'accept',
                            pending.map((s) => s.snapshotId),
                          )
                        }
                      >
                        接受并整理当前来源全部待审（{pending.length}）
                      </button>
                      <button
                        disabled={!canDecide || !receiptIds.length}
                        onClick={() => void decide('reset', receiptIds)}
                      >
                        恢复为待审
                      </button>
                    </div>
                  </details>
                </div>
                <p
                  className="intake-action-hint"
                  id="intake-manual-explanation"
                >
                  采用你的接收决定；随后由 AI 拆分、添加标签与联系，完成后入库。
                </p>
              </div>
              <div className="intake-action-section journey-ai-actions">
                <div className="journey-action-group">
                  <button
                    className="secondary-action"
                    disabled={
                      !selected ||
                      Boolean(selected.isPrivate) ||
                      translating ||
                      (!ai.modelConfigured &&
                        !translations.has(selected.snapshotId))
                    }
                    onClick={() => void translate()}
                  >
                    {translating
                      ? '正在翻译…'
                      : translatedDocument &&
                          translatedDocument === selected?.snapshotId
                        ? '查看原文'
                        : translations.has(selected?.snapshotId ?? '')
                          ? '查看译文'
                          : 'AI 临时翻译'}
                  </button>
                  <button
                    className="secondary-action"
                    aria-describedby="intake-ai-explanation"
                    disabled={
                      !canDecide ||
                      !ai.ready ||
                      !ai.modelConfigured ||
                      ai.busy ||
                      !receiptIds.some(
                        (id) => byId.get(id)?.value.receipt === 'pending',
                      )
                    }
                    onClick={() =>
                      void ai.start(
                        receiptIds.flatMap((id) => {
                          const r = byId.get(id);
                          return r?.value.receipt === 'pending'
                            ? [{snapshotId: id, expectedVersion: r.version}]
                            : [];
                        }),
                      )
                    }
                  >
                    {ai.busy ? '正在提交…' : '交给 AI 审核并整理'}
                  </button>
                  <details className="journey-action-menu">
                    <summary>摘要</summary>
                    <div>
                      <label>
                        <input
                          type="checkbox"
                          checked={summaryEnabled}
                          onChange={(e) => {
                            setSummaryEnabled(e.target.checked);
                          }}
                        />
                        启用按需 AI 摘要
                      </label>
                      <button
                        disabled={
                          !summaryEnabled ||
                          preview.busy ||
                          !selected ||
                          selected.isPrivate
                        }
                        onClick={() => {
                          if (selected)
                            void preview.summarize(
                              checked.size
                                ? [...checked]
                                : [selected.snapshotId],
                            );
                        }}
                      >
                        {checked.size ? '生成所选摘要' : '生成本篇摘要'}
                      </button>
                    </div>
                  </details>
                </div>
                <p className="intake-action-hint" id="intake-ai-explanation">
                  先由 AI
                  判断是否接收：通过后自动接受并完成同样的整理；不确定则留待你决定。
                </p>
              </div>
              <p className="intake-dispatch-hint">
                AI 任务按 AI
                开关和价格时段排队，进度见总览。翻译、摘要和接收分别操作。
              </p>
            </footer>
            <div className="journey-feedback" role="status">
              {translatedDocument && translatedDocument === selected?.snapshotId
                ? '临时译文仅在本页阅读，未接受资料或写入知识库。 '
                : ''}
              {message ? message : ai.message ? ai.message : preview.message}
              {selected ? preview.summaryErrors.get(selected.snapshotId) : ''}
            </div>
          </>
        )}
      </TwoPane>
    </section>
  );
}
