import {useEffect, useRef, type ReactNode} from 'react';
export function WorkspaceToolPanel({
  title,
  open,
  onClose,
  children,
}: {
  readonly title: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) close.current?.focus();
  }, [open, title]);
  return (
    <section
      className="workspace-tool-panel"
      hidden={!open}
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          ref={close}
          type="button"
          className="secondary-action"
          onClick={onClose}
          aria-label={'关闭' + title}
        >
          关闭
        </button>
      </header>
      <div className="workspace-tool-panel__content">{children}</div>
    </section>
  );
}
