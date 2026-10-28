import {createPortal} from 'react-dom';
import {useState} from 'react';
import {ContentDialog} from '../components/content_dialog.js';
import {ReportWorkspace} from './report_workspace.js';
import {useReports} from './use_reports.js';
import {REPORT_STATUS} from '../api/report_client.js';
import {ReportPipelinePanel} from './report_pipeline_panel.js';

export function DatabaseReports({
  onOpenSource,
  container,
  active,
  initiallyOpen = false,
}: {
  readonly container: HTMLElement | null;
  readonly active: boolean;
  readonly onOpenSource: (snapshotId: string) => void;
  readonly initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [selectionRequest, setSelectionRequest] = useState(0);
  const [previousRoute, setPreviousRoute] = useState(initiallyOpen);
  if (previousRoute !== initiallyOpen) {
    setPreviousRoute(initiallyOpen);
    if (initiallyOpen) setOpen(true);
  }
  const reports = useReports(active && !open);
  return (
    <>
      {container
        ? createPortal(
            <>
              <div className="report-side-actions">
                <button
                  className="secondary-action"
                  onClick={() => {
                    setSelected(undefined);
                    setSelectionRequest((v) => v + 1);
                    setOpen(true);
                  }}
                >
                  新建报告
                </button>
              </div>
              <div className="side-scroll report-history">
                {reports.error ? (
                  <p role="alert">{reports.error}</p>
                ) : !reports.list ? (
                  <p>正在读取…</p>
                ) : !reports.list.reports.length ? (
                  <p>还没有报告</p>
                ) : (
                  reports.list.reports.map((r) => (
                    <button
                      className="database-report-card"
                      key={r.reportId}
                      onClick={() => {
                        setSelected(r.reportId);
                        setSelectionRequest((v) => v + 1);
                        setOpen(true);
                      }}
                    >
                      <strong>{r.title}</strong>
                      <span>{REPORT_STATUS[r.status]}</span>
                      <small>
                        {r.period.from} — {r.period.to}
                      </small>
                    </button>
                  ))
                )}
              </div>
              <div className="scope-footer report-footer">
                <button
                  className="text-action"
                  onClick={() => {
                    setScheduleOpen(true);
                  }}
                >
                  定时计划与通知
                </button>
              </div>
            </>,
            container,
          )
        : null}
      <ContentDialog
        open={active && scheduleOpen}
        title="定时报告与通知"
        onClose={() => {
          setScheduleOpen(false);
        }}
      >
        <ReportPipelinePanel active={active && scheduleOpen} />
      </ContentDialog>
      <ContentDialog
        keepMounted
        open={active && open}
        title="报告"
        className="content-report-dialog"
        onClose={() => {
          setOpen(false);
        }}
      >
        <ReportWorkspace
          active={active && open}
          initialReportId={selected}
          selectionRequest={selectionRequest}
          onOpenSource={onOpenSource}
        />
      </ContentDialog>
    </>
  );
}
