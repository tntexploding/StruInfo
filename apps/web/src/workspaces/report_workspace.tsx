import {useState} from 'react';
import {
  REPORT_STATUS,
  reportError,
  type ReportRecord,
  type ReportSource,
  type ReportView,
} from '../api/report_client.js';
import {FloatingToolPanel} from '../components/floating_tool_panel.js';
import {useReports} from './use_reports.js';
import {ReportCreateForm} from './report_create_form.js';
import {ReportEditor} from './report_editor.js';
import {ReportEditWorkbench} from './report_edit_workbench.js';
import '../reports.css';

export function ReportWorkspace({
  active,
  onOpenSource,
}: {
  active: boolean;
  onOpenSource: (snapshotId: string) => void;
}) {
  const reports = useReports(active);
  const [creating, setCreating] = useState(true);
  const [editingReport, setEditingReport] = useState<ReportRecord>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const view = reports.value,
    report = view?.report,
    state = report?.state;
  const editing = Boolean(editingReport);
  const stale = Boolean(view?.staleSources.length);
  const pending =
    state && ['draft', 'failed', 'queued', 'running'].includes(state.status);
  const editable =
    state &&
    !view?.active &&
    !['queued', 'running', 'cancelled'].includes(state.status) &&
    !stale;
  const ready =
    state &&
    ['ready', 'reviewed'].includes(state.status) &&
    state.items.some((i) => i.included);
  return (
    <section
      className="workspace-view report-workspace"
      hidden={!active}
      aria-label="日报与周报"
    >
      <header className="workflow-page-heading report-page-heading">
        <div>
          <h1>报告</h1>
          <p>从已放行的材料中整理日报与周报，每条摘要都有出处。</p>
        </div>
        <div className="report-actions">
          <FloatingToolPanel
            title={'报告历史 · ' + String(reports.list?.reports.length ?? '—')}
            preferredWidth={368}
          >
            <div className="report-history">
              <div className="report-history-list">
                {reports.list ? (
                  reports.list.reports.length ? (
                    reports.list.reports.map((r) => (
                      <button
                        type="button"
                        className="report-history-item"
                        key={r.reportId}
                        disabled={reports.busy || editing}
                        aria-current={
                          !creating && report?.reportId === r.reportId
                            ? 'true'
                            : undefined
                        }
                        onClick={(event) => {
                          event.currentTarget
                            .closest<HTMLElement>('[popover]')
                            ?.hidePopover();
                          setCreating(false);
                          void reports.open(r.reportId);
                        }}
                      >
                        <span>
                          {r.kind === 'daily' ? '日报' : '周报'} ·{' '}
                          {r.period.from}
                        </span>
                        <strong>{r.title}</strong>
                        <small>
                          {REPORT_STATUS[r.status]} · {r.itemCount} 条
                          {r.stale ? ' · 来源已更新' : ''}
                        </small>
                      </button>
                    ))
                  ) : (
                    <p className="report-muted">
                      还没有报告。选一段时间，创建第一份草稿。
                    </p>
                  )
                ) : (
                  <p role="status">正在读取报告历史…</p>
                )}
              </div>
              <p className="report-muted">最近 100 份 · 保存在当前工作区</p>
              {editing ? (
                <p className="report-muted">保存或放弃本次编辑后可切换报告。</p>
              ) : null}
            </div>
          </FloatingToolPanel>
          <button
            className="secondary-action"
            type="button"
            disabled={reports.busy || editing}
            onClick={() => void reports.refresh()}
          >
            刷新报告
          </button>
          {!creating ? (
            <button
              type="button"
              className="primary-action"
              disabled={reports.busy || editing}
              onClick={() => {
                reports.clear();
                setCreating(true);
                setFormKey((n) => n + 1);
              }}
            >
              新建报告
            </button>
          ) : null}
        </div>
      </header>
      {reports.error ? (
        <p className="report-notice" role="alert">
          {reports.error}
        </p>
      ) : null}
      {editing && !view && !reports.busy ? (
        <button
          className="secondary-action"
          type="button"
          onClick={() => {
            setEditingReport(undefined);
            setEditorOpen(false);
            reports.clearError();
          }}
        >
          放弃本次编辑
        </button>
      ) : null}
      <div className="report-layout">
        <article
          className="report-paper"
          aria-label={creating ? '新建报告' : '报告正文'}
        >
          <div className="report-reading-content">
            {reports.list?.model === null ? (
              <p className="report-notice">
                模型尚未启用。选材、手动编写和导出仍可使用。
              </p>
            ) : null}
            {creating ? (
              <ReportCreateForm
                key={formKey}
                busy={reports.busy}
                onOpenSource={onOpenSource}
                onCreate={async (request, key) => {
                  const success = await reports.create(request, key);
                  if (success) setCreating(false);
                  return success;
                }}
              />
            ) : report && state ? (
              <>
                <header className="report-title">
                  <p className="report-eyebrow">
                    {state.request.kind === 'daily' ? '日报' : '周报'} /{' '}
                    {REPORT_STATUS[state.status]}
                  </p>
                  <h2>{state.title}</h2>
                  <p className="report-muted">
                    {state.period.from} — {state.period.to} ·{' '}
                    {state.request.timeZone} · 按
                    {state.request.timeField === 'received' ? '接收' : '发布'}
                    日期
                  </p>
                  <div
                    className="report-actions report-reading-actions"
                    role="group"
                    aria-label="报告操作"
                  >
                    {pending ? (
                      <button
                        type="button"
                        className="primary-action"
                        disabled={
                          reports.busy ||
                          view.active ||
                          !view.model ||
                          stale ||
                          state.calls >= state.request.maxModelCalls ||
                          editing
                        }
                        onClick={() => void reports.generate()}
                      >
                        {state.calls ? '继续生成' : '生成草稿'}
                      </button>
                    ) : null}
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={reports.busy || (!editing && !editable)}
                      onClick={() => {
                        if (!editingReport) setEditingReport(report);
                        setEditorOpen(true);
                      }}
                    >
                      {editing
                        ? '继续编辑'
                        : state.items.length
                          ? '核对与编辑'
                          : '手动编写'}
                    </button>
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={reports.busy || !ready || stale || editing}
                      onClick={() => void reports.exportReport()}
                    >
                      导出 Markdown
                    </button>
                    {pending ? (
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={reports.busy || editing}
                        onClick={() => void reports.cancel()}
                      >
                        取消生成
                      </button>
                    ) : null}
                  </div>
                  {editing ? (
                    <p className="report-muted" role="status">
                      本次编辑已保留，点击“继续编辑”回到工作台。保存或放弃后可切换报告。
                    </p>
                  ) : ready ? (
                    <p className="report-muted">
                      {state.status === 'reviewed'
                        ? '已人工核对，可导出使用。'
                        : '草稿仍待核对，导出文件会注明此状态。'}
                    </p>
                  ) : null}
                </header>
                <ReportBody view={view} onOpenSource={onOpenSource} />
                <details className="report-options">
                  <summary>
                    生成记录 · {state.calls} / {state.request.maxModelCalls}{' '}
                    次调用
                  </summary>
                  <p className="report-muted">
                    {state.model ?? reports.list?.model ?? '模型未配置'} ·{' '}
                    {REPORT_STATUS[state.status]}
                  </p>
                </details>
              </>
            ) : (
              <p className="report-empty" role="status">
                {reports.busy
                  ? '正在读取报告…'
                  : '打开报告历史，或创建新一期。'}
              </p>
            )}
          </div>
        </article>
      </div>
      {editingReport ? (
        <ReportEditWorkbench
          open={active && editorOpen && Boolean(view)}
          onCollapse={() => {
            setEditorOpen(false);
          }}
        >
          {reports.error ? (
            <p className="report-notice" role="alert">
              {reports.error}
            </p>
          ) : null}
          <ReportEditor
            key={editingReport.reportId}
            report={editingReport}
            busy={reports.busy}
            onOpenSource={onOpenSource}
            onSave={(edit) => reports.save(edit, editingReport)}
            onClose={() => {
              setEditorOpen(false);
              setEditingReport(undefined);
              reports.clearError();
            }}
          />
        </ReportEditWorkbench>
      ) : null}
    </section>
  );
}

function ReportBody({
  view,
  onOpenSource,
}: {
  view: ReportView;
  onOpenSource: (snapshotId: string) => void;
}) {
  const state = view.report.state;
  const stale = Boolean(view.staleSources.length);
  return (
    <>
      {stale ? (
        <p className="report-notice" role="status">
          部分材料已修改。当前内容仅供比较；请重新选材生成报告后再核对、导出。
        </p>
      ) : null}
      {state.errorCode ? (
        <p className="report-notice" role="status">
          {reportError(new Error(state.errorCode))}
        </p>
      ) : null}
      {view.active ? (
        <p className="report-notice" role="status">
          {state.planned ? '正在整理摘要' : '正在选题与合并重复内容'} · 已完成{' '}
          {state.items.filter((i) => i.draft).length} /{' '}
          {state.items.length || '待规划'} 条 · 已调用 {state.calls} 次
        </p>
      ) : state.errorCode !== 'ai_price_window_closed' &&
        ['queued', 'running'].includes(state.status) ? (
        <p className="report-notice">
          生成已中断。点击“继续生成”完成剩余内容。
        </p>
      ) : null}
      {state.items.length ? (
        state.items.map((item, index) => {
          const story = item.edited ?? item.draft;
          const cited = new Set(
            story
              ? story.points.flatMap((point) => point.sources)
              : item.group.sources,
          );
          const sources = state.sources.filter((s) => cited.has(s.handle));
          return (
            <section
              key={index}
              className="report-story"
              data-excluded={!item.included}
            >
              <div className="report-story-kicker">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <span>
                  {!item.included
                    ? '已移出本期'
                    : item.edited
                      ? '人工编辑'
                      : story
                        ? 'AI 草稿'
                        : '待生成'}
                </span>
              </div>
              <h3>{story?.title ?? item.group.title}</h3>
              {story ? (
                story.points.map((point, i) => (
                  <p className="report-point" data-role={point.role} key={i}>
                    {point.text}
                    {cited.size > 1 ? (
                      <span className="report-point-references">
                        {' '}
                        {point.sources
                          .map((id) => '[' + String(id) + ']')
                          .join(' ')}
                      </span>
                    ) : null}
                  </p>
                ))
              ) : (
                <p className="report-muted">本条摘要尚未完成，原文仍可阅读。</p>
              )}
              <div
                className="report-citations"
                role="group"
                aria-label="本条来源"
              >
                <span className="report-muted">来源</span>
                {sources.map((source) => (
                  <SourceLink
                    key={source.handle}
                    source={source}
                    onOpenSource={onOpenSource}
                  />
                ))}
              </div>
              <div className="report-source-dates">
                {sources.map((s) => (
                  <p className="report-muted" key={s.handle}>
                    [{s.handle}] {sourceDates(s, state)}
                  </p>
                ))}
              </div>
              {item.edited && item.draft ? (
                <details className="report-options">
                  <summary>查看 AI 初稿</summary>
                  <h4>{item.draft.title}</h4>
                  {item.draft.points.map((p, i) => (
                    <p key={i}>
                      {p.text}{' '}
                      {p.sources.map((id) => '[' + String(id) + ']').join(' ')}
                    </p>
                  ))}
                </details>
              ) : null}
            </section>
          );
        })
      ) : (
        <div className="report-empty">
          <h3>{state.planned ? '本期暂无入选内容' : '材料已选好'}</h3>
          <p>
            {state.planned
              ? '模型没有选出适合本期的内容。可以查看材料后手动编写。'
              : '生成带出处的中文草稿，或根据原文手动编写。'}
          </p>
        </div>
      )}
      {state.otherGroups?.length ? (
        <details className="report-options report-other-reading">
          <summary>其他阅读 · {state.otherGroups.length} 个事件</summary>
          <p className="report-muted">
            未纳入本期摘要，保留独立事件及出处供继续阅读。
          </p>
          {state.otherGroups.map((group, index) => (
            <section className="report-source" key={index}>
              <h4>{group.title}</h4>
              {state.sources
                .filter((s) => group.sources.includes(s.handle))
                .map((s) => (
                  <div key={s.handle}>
                    <SourceLink source={s} onOpenSource={onOpenSource} />
                    <p className="report-muted">{sourceDates(s, state)}</p>
                  </div>
                ))}
            </section>
          ))}
        </details>
      ) : null}
      <details
        className="report-options report-source-list"
        open={!state.items.length}
      >
        <summary>选材记录 · {state.sources.length} 条</summary>
        <p className="report-muted">
          {state.totalEligible} 条符合条件，排除 {state.duplicateCount}{' '}
          条重复记录。未被引用的材料保留在此处供回看。
        </p>
        {state.sources.map((source) => (
          <div className="report-source" key={source.handle}>
            <SourceLink source={source} onOpenSource={onOpenSource} />
            <p className="report-muted">{source.reason}</p>
          </div>
        ))}
      </details>
    </>
  );
}
function SourceLink({
  source,
  onOpenSource,
}: {
  source: ReportSource;
  onOpenSource: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="report-source-link"
      onClick={() => {
        onOpenSource(source.snapshotId);
      }}
      title={source.title + ' · ' + source.sourceKey}
    >
      [{source.handle}] {source.title}
    </button>
  );
}
function sourceDates(
  source: ReportSource,
  state: {
    request: {timeField: 'received' | 'published'};
    period: {from: string};
  },
) {
  const published =
    source.publishedDate ??
    (state.request.timeField === 'published' ? source.date : undefined);
  const received =
    source.receivedDate ??
    (state.request.timeField === 'received' ? source.date : undefined);
  return (
    '发布 ' +
    (published ?? '未知') +
    (source.publicationInferred ? '（推定）' : '') +
    ' · 接收 ' +
    (received ?? '未知') +
    (published && published < state.period.from
      ? ' · 补充阅读（早于本期）'
      : '')
  );
}
