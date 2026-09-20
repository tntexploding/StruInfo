import {useState} from 'react';
import {
  REPORT_STATUS,
  reportError,
  type ReportRecord,
  type ReportSource,
  type ReportView,
} from '../api/report_client.js';
import {TwoPane} from '../components/two_pane.js';
import {useReports} from './use_reports.js';
import {ReportCreateForm} from './report_create_form.js';
import {ReportEditor} from './report_editor.js';
import {ReportEditWorkbench} from './report_edit_workbench.js';
import '../reports.css';
const REPORT_KIND = {
  daily: '日报',
  weekly: '周报',
  monthly: '月报',
  topic: '专题',
};
export function ReportWorkspace({
  active,
  onOpenSource,
}: {
  active: boolean;
  onOpenSource: (snapshotId: string) => void;
}) {
  const reports = useReports(active);
  const [editingReport, setEditingReport] = useState<ReportRecord>();
  const [editorOpen, setEditorOpen] = useState(false);
  const view = reports.value,
    state = view?.report.state;
  const editing = Boolean(editingReport);
  const ready = Boolean(
    state &&
    ['ready', 'reviewed'].includes(state.status) &&
    state.items.some((i) => i.included),
  );
  const stale = Boolean(view?.staleSources.length);
  const pending = Boolean(
    state && ['draft', 'failed', 'queued', 'running'].includes(state.status),
  );
  return (
    <section
      className="workspace-view journey-workspace report-workspace report-journey"
      hidden={!active}
      aria-label="报告"
    >
      <header className="workflow-page-heading">
        <div>
          <h1>报告</h1>
          <p>确定主题与范围，在右侧查看生成队列和过往报告。</p>
        </div>
        <button
          className="secondary-action"
          disabled={reports.busy}
          onClick={() => void reports.refresh()}
        >
          刷新任务
        </button>
      </header>
      {reports.error && !editorOpen ? (
        <p role="alert">{reports.error}</p>
      ) : null}
      <TwoPane
        name="reports"
        left={
          <div className="report-configuration">
            {reports.list && !reports.list.model ? (
              <p className="field-help">
                模型尚未启用。选材、手动编写和导出仍可使用。
              </p>
            ) : null}
            <ReportCreateForm
              busy={reports.busy || editing}
              onOpenSource={onOpenSource}
              onCreate={reports.create}
            />
            <div className="report-publication">
              <h3>本地导出</h3>
              <p>
                打开右侧已生成的报告后，导出 Markdown 或通过打印保存为
                PDF。当前未接推送渠道。
              </p>
            </div>
          </div>
        }
      >
        <div className="report-queue-heading">
          <h2>报告任务与历史</h2>
          <span>{reports.list?.reports.length ?? '—'} 份</span>
        </div>
        <div className="report-queue">
          {!reports.list ? (
            <p role="status">正在读取报告…</p>
          ) : reports.list.reports.length === 0 ? (
            <div className="journey-empty">
              <h2>第一份报告从左侧开始</h2>
              <p>预览材料后创建。任务进度和生成内容会出现在这里。</p>
            </div>
          ) : (
            reports.list.reports.map((record) => {
              const expanded = view?.report.reportId === record.reportId;
              return (
                <section
                  className="report-queue-item"
                  data-expanded={expanded}
                  key={record.reportId}
                >
                  <button
                    className="report-queue-title"
                    aria-expanded={expanded}
                    disabled={reports.busy || editing}
                    onClick={() => {
                      if (expanded) reports.clear();
                      else void reports.open(record.reportId);
                    }}
                  >
                    <span className="report-queue-kind">
                      {REPORT_KIND[record.kind]}
                    </span>
                    <span>
                      <strong>{record.title}</strong>
                      <small>
                        {record.kind === 'topic'
                          ? '专题材料'
                          : record.period.from + ' — ' + record.period.to}
                      </small>
                    </span>
                    <span
                      className="report-queue-status"
                      data-status={record.status}
                    >
                      {REPORT_STATUS[record.status]}
                      {record.active
                        ? ' · ' +
                          String(record.completedItemCount ?? 0) +
                          '/' +
                          (record.itemCount
                            ? String(record.itemCount)
                            : '待规划')
                        : ''}
                    </span>
                    <span aria-hidden="true">{expanded ? '−' : '+'}</span>
                  </button>
                  {expanded && state ? (
                    <div className="report-queue-body">
                      <div className="report-actions">
                        {pending ? (
                          <button
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
                            {state.calls ? '继续生成' : '开始 AI 生成'}
                          </button>
                        ) : null}
                        <button
                          className="secondary-action"
                          disabled={
                            reports.busy ||
                            view.active ||
                            ['queued', 'running', 'cancelled'].includes(
                              state.status,
                            ) ||
                            stale
                          }
                          onClick={() => {
                            if (!editingReport) setEditingReport(view.report);
                            setEditorOpen(true);
                          }}
                        >
                          {editingReport ? '继续编辑草稿' : '核对与编辑'}
                        </button>
                        <button
                          className="secondary-action"
                          disabled={reports.busy || !ready || stale || editing}
                          onClick={() => void reports.exportReport()}
                        >
                          导出 Markdown
                        </button>
                        <button
                          className="secondary-action"
                          disabled={reports.busy || !ready || stale || editing}
                          onClick={() => void reports.exportPdf()}
                        >
                          导出 PDF
                        </button>
                        {pending ? (
                          <button
                            className="text-action"
                            disabled={reports.busy || editing}
                            onClick={() => void reports.cancel()}
                          >
                            取消生成
                          </button>
                        ) : null}
                      </div>
                      <ReportBody view={view} onOpenSource={onOpenSource} />
                      <p className="report-muted">
                        {state.model ??
                          (state.origin === 'search_results'
                            ? '检索摘录，无模型调用'
                            : '模型未配置')}{' '}
                        · 已用 {state.calls} / {state.request.maxModelCalls}{' '}
                        次调用
                      </p>
                    </div>
                  ) : null}
                </section>
              );
            })
          )}
        </div>
      </TwoPane>
      {editingReport ? (
        <ReportEditWorkbench
          open={active && editorOpen}
          onCollapse={() => {
            setEditorOpen(false);
          }}
        >
          {reports.error ? <p role="alert">{reports.error}</p> : null}
          <ReportEditor
            key={editingReport.reportId}
            report={editingReport}
            busy={reports.busy}
            onOpenSource={onOpenSource}
            onSave={(edit) => reports.save(edit, editingReport)}
            onClose={() => {
              setEditingReport(undefined);
              setEditorOpen(false);
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
      ) : !['ai_price_window_closed', 'ai_operations_paused'].includes(
          state.errorCode ?? '',
        ) && ['queued', 'running'].includes(state.status) ? (
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
                        ? state.origin === 'search_results'
                          ? '检索摘录'
                          : 'AI 草稿'
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
