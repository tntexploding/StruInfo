import {useCallback, useEffect, useState} from 'react';
import {
  researchCommand,
  researchError,
  type PipelineStatus,
  type PipelineRow,
} from '../api/research_client.js';
import {ContentDialog} from '../components/content_dialog.js';
import {ReadingContent} from '../components/reading_content.js';

export function OverviewNotices() {
  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const result = await researchCommand<PipelineStatus>(
      'report_pipeline_status',
    );
    setRows(result.notices);
    setError('');
  }, []);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const result = await researchCommand<PipelineStatus>(
          'report_pipeline_status',
        );
        if (live) {
          setRows(result.notices);
          setError('');
        }
      } catch (cause) {
        if (live) setError(researchError(cause));
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const notice = rows.find((row) => row.id === selected);
  return (
    <>
      {error ? <p role="alert">站内消息未能读取：{error}</p> : null}
      {rows
        .filter((row) => !row.value.read)
        .slice(0, 8)
        .map((row) => (
          <button
            key={row.id}
            className="overview-message"
            onClick={() => {
              setSelected(row.id);
            }}
          >
            <strong>
              {row.value.urgent ? '紧急 · ' : ''}
              {row.value.title}
            </strong>
            <small>
              {new Date(row.value.createdAt ?? row.updatedAt).toLocaleString()}
            </small>
          </button>
        ))}
      <ContentDialog
        open={Boolean(notice)}
        title={notice?.value.title ?? '站内消息'}
        onClose={() => {
          setSelected(undefined);
        }}
      >
        <ReadingContent text={notice?.value.markdown ?? ''} />
        <button
          className="secondary-action"
          disabled={busy || !notice || notice.value.read}
          onClick={() => {
            if (!notice || busy) return;
            setBusy(true);
            void researchCommand('notice_read', {
              id: notice.id,
              expectedVersion: notice.version,
            })
              .then(load)
              .catch((cause: unknown) => {
                setError(researchError(cause));
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          {notice?.value.read ? '已读' : '标为已读'}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </ContentDialog>
    </>
  );
}
