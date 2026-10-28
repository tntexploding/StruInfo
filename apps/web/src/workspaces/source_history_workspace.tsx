import type {SourceSubscriptionView} from '../api/m1c_api_contract.js';
import {TwoPane} from '../components/two_pane.js';
import {ReadingContent} from '../components/reading_content.js';
import {useSourceHistory, STATUS, failure} from './use_source_history.js';
import './source_history_workspace.css';
export function SourceHistoryWorkspace({
  sources,
  initialSource,
  onClose,
  onImported,
}: {
  sources: readonly SourceSubscriptionView[];
  initialSource: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const {
    supported,
    applied,
    limitText,
    setLimitText,
    validLimit,
    validDates,
    canQuery,
    currentQuery,
    selectedCounts,
    resultSource,
    setResultSource,
    canAdd,
    chooseArticles,
    chosen,
    setChosen,
    archives,
    setArchives,
    session,
    states,
    directory,
    checked,
    setChecked,
    text,
    setText,
    from,
    setFrom,
    to,
    setTo,
    offset,
    setOffset,
    busy,
    message,
    loading,
    results,
    progress,
    requestStop,
    preview,
    dialog,
    read,
    toggle,
    selectFiltered,
    importSelected,
    showPreview,
    enrich,
    closePreview,
    rows,
    eligible,
  } = useSourceHistory({sources, initialSource, onImported});
  return (
    <section
      className="workspace-view journey-workspace history-workspace"
      aria-label="补收往期"
    >
      <header className="workflow-page-heading">
        <div>
          <h1>补收往期</h1>
          <p>选择来源、时间与数量，先查询和挑选，再加入文档入口待审核。</p>
        </div>
        <button
          className="secondary-action"
          disabled={Boolean(busy)}
          onClick={onClose}
        >
          返回文档入口
        </button>
      </header>
      <TwoPane
        name="source-history"
        left={
          <>
            <div className="journey-list-heading">
              <h2>选择来源</h2>
              <button
                className="text-action"
                disabled={Boolean(busy)}
                onClick={() => {
                  setChosen(
                    chosen.size === supported.length
                      ? new Set()
                      : new Set(supported.map((s) => s.subscriptionId)),
                  );
                  setOffset(0);
                }}
              >
                {chosen.size === supported.length ? '取消全选' : '全选来源'}
              </button>
            </div>
            <div className="history-source-limit">
              <label>
                每个来源最多补收
                <span>
                  <input
                    type="number"
                    min="1"
                    max="5000"
                    step="1"
                    placeholder="不限"
                    value={limitText}
                    disabled={Boolean(busy)}
                    aria-invalid={!validLimit}
                    onChange={(e) => {
                      setLimitText(e.target.value);
                    }}
                  />{' '}
                  篇
                </span>
              </label>
              <small>
                {validLimit
                  ? '每次补收分别计数；留空不限，优先预选较新的文章。'
                  : '请输入 1–5,000，或留空不限。'}
              </small>
            </div>
            <div className="history-sources">
              {supported.map((s) => {
                const state = states.find(
                  (v) => v.subscriptionId === s.subscriptionId,
                );
                return (
                  <section
                    className="history-source"
                    key={s.subscriptionId}
                    data-selected={chosen.has(s.subscriptionId)}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={chosen.has(s.subscriptionId)}
                        disabled={Boolean(busy)}
                        onChange={() => {
                          toggle(s.subscriptionId);
                        }}
                      />
                      <strong>{s.label}</strong>
                    </label>
                    {state ? (
                      <p>
                        {state.count.toLocaleString()} 篇 ·{' '}
                        {STATUS[state.status] ?? state.status}
                        <small>
                          本次已选 {selectedCounts.get(s.subscriptionId) ?? 0}{' '}
                          篇
                        </small>
                        <small>{state.methods.join(' / ')}</small>
                      </p>
                    ) : (
                      <p>尚未读取历史目录</p>
                    )}
                    <details>
                      <summary>目录地址与读取详情</summary>
                      <label>
                        自定义历史目录（可选）
                        <input
                          type="url"
                          placeholder="同一网站的归档或 Sitemap 地址"
                          value={archives[s.subscriptionId] ?? ''}
                          disabled={Boolean(busy)}
                          onChange={(e) => {
                            setArchives((old) => ({
                              ...old,
                              [s.subscriptionId]: e.target.value,
                            }));
                          }}
                        />
                      </label>
                      <small>留空自动探测。修改后点击“重新探测”。</small>
                      {state?.errors.map((e, i) => (
                        <p className="history-warning" key={i}>
                          {failure(e.code)}
                          <small>{e.url}</small>
                        </p>
                      ))}
                    </details>
                  </section>
                );
              })}
              {!supported.length ? (
                <p>请先添加公开的 RSS 或网页订阅。</p>
              ) : null}
            </div>
            {session ? (
              <details className="history-source-actions">
                <summary>目录读取工具</summary>
                <div>
                  <button
                    className="secondary-action"
                    disabled={!canQuery || Boolean(busy)}
                    onClick={() => void read(true)}
                  >
                    重新探测目录
                  </button>
                  <button
                    className="text-action"
                    disabled={
                      !canQuery ||
                      Boolean(busy) ||
                      !states.some((s) => s.errors.length)
                    }
                    onClick={() => void read(false, true)}
                  >
                    重试失败目录
                  </button>
                </div>
              </details>
            ) : null}
          </>
        }
      >
        <form
          className="history-filters"
          onSubmit={(e) => {
            e.preventDefault();
            if (canQuery && !busy) void read();
          }}
        >
          <label className="history-search">
            查找文章
            <input
              value={text}
              placeholder="标题或网址"
              onChange={(e) => {
                setText(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <label>
            发布于
            <input
              type="date"
              disabled={Boolean(busy)}
              aria-invalid={!validDates}
              value={from}
              max={to || undefined}
              onChange={(e) => {
                setFrom(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <span aria-hidden="true">—</span>
          <label>
            截止到
            <input
              type="date"
              disabled={Boolean(busy)}
              aria-invalid={!validDates}
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setTo(e.target.value);
                setOffset(0);
              }}
            />
          </label>
        </form>
        <div className="history-directory-tools">
          <label className="history-result-source">
            结果来源
            <select
              aria-label="筛选查询结果来源"
              value={resultSource}
              disabled={!applied || Boolean(busy)}
              onChange={(e) => {
                setResultSource(e.target.value);
                setOffset(0);
              }}
            >
              <option value="all">全部查询来源</option>
              {supported
                .filter((s) =>
                  applied?.subscriptionIds.includes(s.subscriptionId),
                )
                .map((s) => (
                  <option key={s.subscriptionId} value={s.subscriptionId}>
                    {s.label}
                  </option>
                ))}
            </select>
          </label>
          <span>
            {directory
              ? `${directory.total.toLocaleString()} 篇符合条件`
              : '尚未加载目录'}
            {loading ? ' · 刷新中' : ''}
          </span>
          <button
            className="secondary-action"
            disabled={
              !currentQuery || loading || Boolean(busy) || !directory?.total
            }
            onClick={() => void selectFiltered()}
          >
            按限额选择当前结果
          </button>
          <button
            className="text-action"
            disabled={
              !session ||
              Boolean(busy) ||
              !rows.some((a) => !a.publishedAt || a.titleFromUrl)
            }
            onClick={() => void enrich()}
          >
            补全本页日期与标题
          </button>
        </div>
        {applied && !currentQuery ? (
          <p className="history-note history-warning">
            来源、时间或数量已更改，请点击底部按钮重新查询后再加入队列。
          </p>
        ) : null}
        {directory?.undated ? (
          <p className="history-note">
            所选来源有 {directory.undated}{' '}
            篇发布日期未知；时间筛选不包含它们。清空日期可逐篇选择或补全日期。路径标题会在预览时更新。
          </p>
        ) : null}
        <div
          className="history-articles"
          aria-label="历史文章目录"
          aria-busy={loading}
        >
          {rows.length ? (
            <label className="history-page-selection">
              <input
                type="checkbox"
                disabled={
                  !currentQuery ||
                  loading ||
                  Boolean(busy) ||
                  !eligible.some(canAdd)
                }
                checked={
                  Boolean(eligible.length) &&
                  eligible.filter(canAdd).every((a) => checked.has(a.id))
                }
                onChange={(e) => {
                  chooseArticles(eligible, e.target.checked);
                }}
              />
              选择本页未接收文章（遵守每来源限额）
            </label>
          ) : (
            <p className="history-empty">
              {session
                ? '此范围内尚无文章。可以调整来源或日期，再点击底部查询按钮。'
                : '先选择来源、时间与数量，再点击底部“查询选定时间段的内容”。'}
            </p>
          )}
          {rows.map((a) => (
            <article
              className="history-article"
              key={a.id}
              data-selected={checked.has(a.id)}
            >
              <input
                type="checkbox"
                aria-label={'选择 ' + a.title}
                checked={checked.has(a.id)}
                disabled={
                  !canAdd(a) ||
                  loading ||
                  Boolean(busy) ||
                  Boolean(a.existingSnapshotId) ||
                  ['imported', 'existing'].includes(results[a.id]?.status ?? '')
                }
                onChange={() => {
                  chooseArticles([a], !checked.has(a.id));
                }}
              />
              <div>
                <h2>{a.title}</h2>
                <p>
                  {
                    sources.find((s) => s.subscriptionId === a.subscriptionId)
                      ?.label
                  }{' '}
                  ·{' '}
                  {a.publishedAt ? a.publishedAt.slice(0, 10) : '发布日期未知'}
                  {a.dateInferred ? '（据网址）' : ''}
                  {a.titleFromUrl ? ' · 路径标题' : ''}
                  {a.access === 'restricted' ? ' · 可能仅有公开预览' : ''}
                </p>
                {a.existingSnapshotId ||
                results[a.id]?.status === 'existing' ? (
                  <small>已存在，保留原审核结果</small>
                ) : results[a.id]?.status === 'imported' ? (
                  <small className="history-success">已放入待审核</small>
                ) : results[a.id]?.status === 'failed' ? (
                  <small className="history-warning">
                    {failure(results[a.id]?.code ?? 'history_import_failed')}
                  </small>
                ) : null}
              </div>
              <button
                className="secondary-action"
                disabled={Boolean(busy)}
                onClick={() => {
                  showPreview(a);
                }}
              >
                预览
              </button>
              <a href={a.url} target="_blank" rel="noreferrer">
                原网页
              </a>
            </article>
          ))}
        </div>
        <footer className="history-footer">
          <div className="journey-pagination">
            <button
              className="secondary-action"
              disabled={!offset || loading || Boolean(busy)}
              onClick={() => {
                setOffset((n) => Math.max(0, n - 50));
              }}
            >
              上一页
            </button>
            <span>
              {directory?.total ? Math.floor(offset / 50) + 1 : 0} /{' '}
              {Math.ceil((directory?.total ?? 0) / 50)}
            </span>
            <button
              className="secondary-action"
              disabled={
                offset + 50 >= (directory?.total ?? 0) ||
                loading ||
                Boolean(busy)
              }
              onClick={() => {
                setOffset((n) => n + 50);
              }}
            >
              下一页
            </button>
          </div>
          <div className="history-batch">
            <span>
              已选 {checked.size} 篇 · {selectedCounts.size} 个来源
              {resultSource !== 'all'
                ? `（当前来源 ${String(selectedCounts.get(resultSource) ?? 0)} 篇）`
                : ''}
            </span>
            <button
              className="text-action"
              disabled={Boolean(busy) || !checked.size}
              onClick={() => {
                setChecked(new Map());
              }}
            >
              清空选择
            </button>
          </div>
        </footer>
      </TwoPane>
      <footer className="history-flow" aria-label="补收步骤">
        <div className="history-flow-actions">
          <button
            className="primary-action"
            disabled={!canQuery || Boolean(busy)}
            onClick={() => void read()}
          >
            <span aria-hidden="true" className="history-step-number">
              1
            </span>
            查询选定时间段的内容
          </button>
          <span className="history-flow-arrow" aria-hidden="true">
            →
          </span>
          <button
            className="primary-action"
            disabled={
              !currentQuery || loading || !checked.size || Boolean(busy)
            }
            onClick={() => void importSelected()}
          >
            <span aria-hidden="true" className="history-step-number">
              2
            </span>
            加入待审核队列{checked.size ? `（${String(checked.size)}）` : ''}
          </button>
          {busy ? (
            <button className="secondary-action" onClick={requestStop}>
              停止{busy}
            </button>
          ) : null}
        </div>
        <div className="history-feedback" role="status">
          {busy ? <span>{busy}… </span> : null}
          {progress ? (
            <span>
              {progress.action} {progress.done} / {progress.total} ·{' '}
            </span>
          ) : null}
          {message ||
            '查询发布方的公开目录。已删除、未公开或付费全文可能缺失。补收后进入待审核。'}
        </div>
      </footer>
      <dialog
        className="history-preview"
        ref={dialog}
        onCancel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          closePreview();
        }}
      >
        <header>
          <h2>{preview?.item.title}</h2>
          <button className="secondary-action" onClick={closePreview}>
            关闭预览
          </button>
        </header>
        {preview?.access === 'restricted' ? (
          <p className="history-warning">
            此内容可能只有公开预览；不等同于完整文章。
          </p>
        ) : null}
        {preview ? (
          <ReadingContent
            text={preview.body}
            omitLeadingTitle={preview.item.title}
            baseUri={preview.item.url}
            scrollLabel="历史文章预览"
          />
        ) : null}
        <footer>
          <button
            className="primary-action"
            disabled={
              !preview ||
              !canAdd(preview.item) ||
              Boolean(busy) ||
              Boolean(preview.item.existingSnapshotId)
            }
            onClick={() => {
              if (preview) chooseArticles([preview.item], true);
              closePreview();
            }}
          >
            加入选择
          </button>
          <a href={preview?.item.url} target="_blank" rel="noreferrer">
            打开原网页
          </a>
        </footer>
      </dialog>
    </section>
  );
}
