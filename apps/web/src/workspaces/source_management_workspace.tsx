import '../theme/prototypes/sources.css';
import '../theme/prototype_adapters.css';
import {useCallback, useMemo, useState} from 'react';
import type {M1cApiClient} from '../api/m1c_api_client.js';
import {ContentDialog} from '../components/content_dialog.js';
import {SourceRecordPicker} from '../components/source_record_picker.js';
import {SourceSubscriptionPanel} from './source_subscription_panel.js';
import {SourceReceivingSummary} from './source_receiving_fields.js';
import {SourceSplitRecipePanel} from './source_split_recipe_panel.js';
import {
  MaterialsWorkspace,
  type MaterialsWorkspaceProps,
} from './materials_workspace.js';
import {IntakeWorkspace} from './intake_workspace.js';
import {SourceHistoryWorkspace} from './source_history_workspace.js';
import {useIntakeDirectory} from './use_intake_directory.js';
import {matchesIntakeSource} from './intake_source_state.js';

const kinds: Record<string, string> = {
  rss_atom: 'RSS / Atom',
  github_markdown: 'Git 文档',
  json_api: '信息接口',
  web: '网页',
  plugin: '连接器',
};

export function SourceManagementWorkspace({
  api,
  ...props
}: MaterialsWorkspaceProps & {
  readonly api: Pick<M1cApiClient, 'loadEvidenceSnapshot'>;
}) {
  const [includePrivate, setIncludePrivate] = useState(false);
  const directory = useIntakeDirectory(props, includePrivate);
  const [selected, setSelected] = useState(
    props.reviewTarget?.subscriptionId ?? '',
  );
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const [kind, setKind] = useState('all');
  const [newRequest, setNewRequest] = useState(0);
  const [recentOpen, setRecentOpen] = useState(Boolean(props.reviewTarget));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const selection = selected.length
    ? selected
    : (directory.sources.find((s) => includePrivate || !s.isPrivate)
        ?.subscriptionId ?? 'all');
  const current = directory.sources.find((s) => s.subscriptionId === selection);
  const known = new Set(directory.sources.map((s) => s.subscriptionId));
  const selectedDocuments = directory.received.filter((d) =>
    matchesIntakeSource(directory.origins.get(d.snapshotId), selection, known),
  );
  const latest = selectedDocuments.toSorted((a, b) =>
    b.capturedAt.localeCompare(a.capturedAt),
  )[0];
  const cards = useMemo(
    () =>
      directory.sources
        .filter(
          (s) =>
            (includePrivate || !s.isPrivate) &&
            (kind === 'all' || s.kind === kind) &&
            `${s.label} ${s.description ?? ''}`
              .toLocaleLowerCase()
              .includes(search.toLocaleLowerCase()),
        )
        .map((s) => ({
          id: s.subscriptionId,
          name: s.label,
          detail: `${kinds[s.kind] ?? '订阅'} · ${s.enabled ? '已启用' : '已暂停'}`,
          active: s.enabled,
          accent: s.processingProfile?.accent,
          pending: directory.received.filter(
            (d) =>
              directory.origins.get(d.snapshotId)?.subscriptionId ===
                s.subscriptionId &&
              directory.byId.get(d.snapshotId)?.value.receipt === 'pending',
          ).length,
        }))
        .sort((a, b) =>
          sort === 'active'
            ? Number(b.active) - Number(a.active) ||
              a.name.localeCompare(b.name, 'zh-CN')
            : sort === 'pending'
              ? b.pending - a.pending || a.name.localeCompare(b.name, 'zh-CN')
              : a.name.localeCompare(b.name, 'zh-CN'),
        ),
    [
      directory.sources,
      directory.received,
      directory.origins,
      directory.byId,
      includePrivate,
      kind,
      search,
      sort,
    ],
  );
  const created = useCallback((id: string) => {
    setSelected(id);
  }, []);
  const refresh = () => {
    void directory.reload();
    props.onRefresh();
    setRevision((v) => v + 1);
  };
  return (
    <section className="workspace-view source-map" aria-label="源管理">
      <header className="map-heading">
        <div>
          <h1>源管理</h1>
          <p>选择来源，安排接收和处理。</p>
        </div>
      </header>
      {directory.error ? <p role="alert">{directory.error}</p> : null}
      <div className="source-layout">
        <aside className="record-stage" aria-label="来源选择区">
          <SourceRecordPicker
            cards={cards}
            selected={selection}
            onSelect={setSelected}
          />
          <div
            className="record-floating record-top ef-glass"
            aria-label="唱片顶部悬浮条"
          >
            <label className="record-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                placeholder="来源搜索"
                aria-label="来源搜索"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
              />
            </label>
            <button
              type="button"
              className="record-tools"
              aria-label="筛选与排序"
              onClick={() => {
                setSelectorOpen(true);
              }}
            >
              ☷
            </button>
          </div>
          <div
            className="record-floating record-bottom ef-glass"
            aria-label="唱片底部悬浮条"
          >
            <button
              type="button"
              disabled={
                !props.sourceSubscriptionsEnabled ||
                directory.sources.length >= 32
              }
              onClick={() => {
                setSelected('new');
                setNewRequest((v) => v + 1);
              }}
            >
              ＋ 添加来源
            </button>
            <span className="bar-divider" />
            <button
              type="button"
              onClick={() => {
                setSelected('manual');
              }}
            >
              手动放入
            </button>
          </div>
          <div className="record-caption">
            <span>来源选择</span>
            <small>滚轮 · 拖动 · ↑ ↓</small>
          </div>
        </aside>
        <section
          className="source-detail-map"
          aria-label="所选来源设置"
          data-mode={selection === 'manual' ? 'manual' : 'source'}
        >
          <div
            className="source-edit-host"
            hidden={selection === 'manual' || selection === 'all'}
          >
            <SourceSubscriptionPanel
              enabled={props.sourceSubscriptionsEnabled}
              selectedId={selection}
              newRequest={newRequest}
              onCreated={created}
              onSaved={refresh}
              sampleSnapshotId={latest?.snapshotId}
              sampleIsPrivate={latest?.isPrivate === true}
              onList={props.onListSourceSubscriptions}
              onReplace={props.onReplaceSourceSubscriptions}
              onRun={props.onRunSourceSubscription}
              onHistory={() => {
                setHistoryOpen(true);
              }}
              recipeTools={
                latest ? (
                  <SourceSplitRecipePanel
                    key={latest.snapshotId}
                    snapshotId={latest.snapshotId}
                    includePrivate={includePrivate}
                    isPrivate={latest.isPrivate === true}
                    hasEntries={false}
                    configurationOnly
                    onApplied={refresh}
                  />
                ) : undefined
              }
            />
          </div>
          {selection === 'manual' ? (
            <>
              <header className="selected-source">
                <h2>手动放入</h2>
              </header>
              <div className="alternate-view">
                <MaterialsWorkspace {...props} presentation="capture" />
              </div>
            </>
          ) : null}
          {selection === 'all' ? (
            <>
              <header className="selected-source">
                <h2>
                  {directory.sources.length ? '全部接收记录' : '尚无来源'}
                </h2>
              </header>
              <div className="editor-regions">
                <p className="empty-copy">从唱片底部添加来源或手动放入文档。</p>
                <button
                  type="button"
                  className="compact-button"
                  onClick={() => {
                    setRecentOpen(true);
                  }}
                >
                  查看全部接收记录
                </button>
              </div>
            </>
          ) : null}
          <section
            className={
              'source-bottom ef-glass' + (recentOpen ? ' is-open' : '')
            }
            aria-label="底部接收与记录"
          >
            <button
              type="button"
              className="recent-trigger"
              aria-expanded={recentOpen}
              aria-controls="source-receipts"
              onClick={() => {
                setRecentOpen((v) => !v);
              }}
            >
              <span aria-hidden="true">◷</span>
              <span>接收记录与计划</span>
              <small>{selectedDocuments.length} 份资料</small>
              <span className="dock-state">{recentOpen ? '收起' : '展开'}</span>
              <span className="dock-chevron" aria-hidden="true">
                ⌃
              </span>
            </button>
            <div
              className="dock-content"
              id="source-receipts"
              inert={!recentOpen}
              aria-hidden={!recentOpen}
            >
              {recentOpen ? (
                <>
                  <div className="dock-top">
                    {current ? (
                      <SourceReceivingSummary
                        status={current.receivingStatus}
                      />
                    ) : (
                      <span>全部来源</span>
                    )}
                    <button
                      type="button"
                      className="text-action"
                      onClick={() => {
                        setSelected('all');
                      }}
                    >
                      查看全部
                    </button>
                  </div>
                  <IntakeWorkspace
                    key={selection + ':' + String(revision)}
                    {...props}
                    api={api}
                    embedded
                    initialIncludePrivate={includePrivate}
                    initialSourceId={selection}
                  />
                </>
              ) : null}
            </div>
          </section>
        </section>
      </div>
      <ContentDialog
        open={selectorOpen}
        title="筛选与排序"
        onClose={() => {
          setSelectorOpen(false);
        }}
        className="layout-dialog"
      >
        <div className="dialog-form">
          <label className="setting-field">
            <span>来源类型</span>
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
              }}
            >
              <option value="all">全部类型</option>
              {Object.entries(kinds).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="setting-field">
            <span>排列方式</span>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
              }}
            >
              <option value="name">名称</option>
              <option value="pending">待审优先</option>
              <option value="active">启用优先</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={includePrivate}
              onChange={(e) => {
                setIncludePrivate(e.target.checked);
                setSelected('');
              }}
            />
            本次包含私密来源
          </label>
        </div>
      </ContentDialog>
      <ContentDialog
        open={historyOpen}
        title="补收往期"
        onClose={() => {
          setHistoryOpen(false);
        }}
        className="layout-dialog source-history-dialog"
      >
        <SourceHistoryWorkspace
          sources={directory.sources}
          initialSource={selection}
          onClose={() => {
            setHistoryOpen(false);
            refresh();
          }}
          onImported={refresh}
        />
      </ContentDialog>
    </section>
  );
}
