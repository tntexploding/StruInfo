import {useState, useRef, useLayoutEffect, type ReactNode} from 'react';
import {ContentDialog} from './content_dialog.js';
import {ResizablePanes} from './two_pane.js';
import {VisualSettings} from '../workspaces/visual_settings.js';
import '../theme/prototypes/reading.css';

/** Accepted A reading layout: full text with notes, document selection on demand. */
export function ReadingWorkspaceFrame({
  left,
  notes,
  children,
  editing,
  onEdit,
  selectedId,
  readingKey,
  title,
  stateControl,
  onRefresh,
}: {
  readonly left: ReactNode;
  readonly notes: ReactNode;
  readonly children: ReactNode;
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly selectedId: string;
  readonly readingKey: string;
  readonly title: string;
  readonly stateControl?: ReactNode;
  readonly onRefresh: () => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    if (scroll.current)
      scroll.current.scrollTop = positions.current.get(readingKey) ?? 0;
  }, [readingKey]);
  const [picker, setPicker] = useState(false);
  const [openedFor, setOpenedFor] = useState(selectedId);
  const [options, setOptions] = useState(false);
  return (
    <div className="reading-frame content-reading-frame" data-editing={editing}>
      <div className="reading-toolbar">
        <button
          className="document-switch secondary-action"
          onClick={() => {
            setOpenedFor(selectedId);
            setPicker(true);
          }}
        >
          <span>
            <b>选择文档</b>
            <small>{title}</small>
          </span>
          <span aria-hidden="true">⌄</span>
        </button>
        <div className="reading-tools">
          {stateControl}
          <span className="tool-divider" />
          <button
            className="secondary-action"
            onClick={() => {
              setOptions(true);
            }}
          >
            阅读设置
          </button>
          <button
            className="secondary-action"
            aria-pressed={editing}
            onClick={onEdit}
          >
            编辑
          </button>
        </div>
      </div>
      <ResizablePanes
        name="reader-notes"
        className="reading-stage content-reading-columns"
        side="right"
        left={
          <aside className="annotation-rail" aria-label="文档旁注">
            {notes}
          </aside>
        }
      >
        <div
          className="reading-scroll content-reading-main"
          ref={scroll}
          onScroll={(e) => {
            positions.current.set(readingKey, e.currentTarget.scrollTop);
          }}
        >
          {children}
        </div>
      </ResizablePanes>
      <footer className="reading-status">
        <span>全文与旁注</span>
        <button type="button" className="text-action" onClick={onRefresh}>
          刷新文档
        </button>
      </footer>
      <ContentDialog
        open={picker && openedFor === selectedId}
        title="选择文档"
        keepMounted
        onClose={() => {
          setPicker(false);
        }}
        className="content-document-picker"
      >
        {left}
      </ContentDialog>
      <ContentDialog
        open={options}
        title="阅读设置"
        onClose={() => {
          setOptions(false);
        }}
        className="reading-options-dialog"
      >
        <VisualSettings readingOnly />
      </ContentDialog>
    </div>
  );
}
