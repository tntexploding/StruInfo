import {useLayoutEffect, useRef, type ReactNode} from 'react';

/** Shared modal surface for source review, task controls and reading tools. */
export function ContentDialog({
  open,
  title,
  onClose,
  children,
  className = '',
  keepMounted = false,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string;
  readonly keepMounted?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const trigger = document.activeElement;
    if (!dialog.open) dialog.showModal();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`content-dialog ef-glass ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="content-dialog__heading">
        <h2>{title}</h2>
        <button type="button" className="secondary-action" onClick={onClose}>
          关闭
        </button>
      </header>
      <div className="content-dialog__body">
        {open || keepMounted ? children : null}
      </div>
    </dialog>
  );
}
