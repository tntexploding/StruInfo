import {useEffect, useRef, type ReactNode} from 'react';
import {WorkspaceToolPanel} from '../components/workspace_tool_panel.js';

export function ReportEditWorkbench({
  open,
  onCollapse,
  children,
}: {
  open: boolean;
  onCollapse: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) element.showModal();
    else element.close();
    return () => {
      element.close();
    };
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="report-edit-workbench"
      aria-label="报告核对工作台"
      onCancel={(event) => {
        event.preventDefault();
        onCollapse();
      }}
    >
      <WorkspaceToolPanel title="核对与编辑" open={open} onClose={onCollapse}>
        {children}
      </WorkspaceToolPanel>
    </dialog>
  );
}
