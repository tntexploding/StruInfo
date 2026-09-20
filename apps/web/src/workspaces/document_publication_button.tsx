import {useState} from 'react';
import {aiWorkflowCommand, aiError} from '../api/ai_workflow_client.js';
export function DocumentPublicationButton({
  snapshotId,
  entries,
  onPublished,
}: {
  snapshotId: string;
  entries: readonly {entryId: string; revision: number}[];
  onPublished: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  return (
    <div className="document-publication-action">
      <button
        className="primary-action"
        disabled={busy || !entries.length}
        onClick={() => {
          setBusy(true);
          setMessage('');
          void aiWorkflowCommand('document_publish', {
            snapshotId,
            expectedEntries: entries.map(({entryId, revision}) => ({
              entryId,
              revision,
            })),
          })
            .then(() => {
              setMessage('已确认入库');
              onPublished();
            })
            .catch((error: unknown) => {
              setMessage(aiError(error));
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {busy ? '正在确认…' : '确认入库'}
      </button>
      {message ? <span role="status">{message}</span> : null}
    </div>
  );
}
