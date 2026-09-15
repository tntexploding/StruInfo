import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export function FloatingToolPanel({
  title,
  className = '',
  preferredWidth = 640,
  children,
}: {
  readonly title: string;
  readonly className?: string;
  readonly preferredWidth?: number;
  readonly children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);

  const positionPanel = useCallback(() => {
    const button = trigger.current;
    const surface = panel.current;
    if (button === null || surface === null) return;
    const anchor = button.getBoundingClientRect();
    const viewport = window.visualViewport;
    const margin = 12;
    const gap = 8;
    const left = (viewport?.offsetLeft ?? 0) + margin;
    const top = (viewport?.offsetTop ?? 0) + margin;
    const right = left + (viewport?.width ?? window.innerWidth) - 2 * margin;
    const bottom = top + (viewport?.height ?? window.innerHeight) - 2 * margin;
    const width = Math.min(
      Math.max(anchor.width, preferredWidth),
      right - left,
    );
    const below = bottom - anchor.bottom - gap;
    const above = anchor.top - gap - top;
    const upwards = below < 240 && above > below;
    const edge = upwards
      ? Math.min(anchor.top - gap, bottom)
      : Math.max(anchor.bottom + gap, top);
    Object.assign(surface.style, {
      width: width.toString() + 'px',
      left:
        Math.max(left, Math.min(anchor.left, right - width)).toString() + 'px',
      top: upwards ? 'auto' : edge.toString() + 'px',
      bottom: upwards ? (window.innerHeight - edge).toString() + 'px' : 'auto',
      maxHeight:
        Math.max(0, upwards ? edge - top : bottom - edge).toString() + 'px',
    });
  }, [preferredWidth]);

  useEffect(() => {
    if (!open) return;
    positionPanel();
    const observer = new ResizeObserver(positionPanel);
    if (trigger.current !== null) observer.observe(trigger.current);
    window.addEventListener('resize', positionPanel);
    window.addEventListener('scroll', positionPanel, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', positionPanel);
    viewport?.addEventListener('scroll', positionPanel);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', positionPanel);
      window.removeEventListener('scroll', positionPanel, true);
      viewport?.removeEventListener('resize', positionPanel);
      viewport?.removeEventListener('scroll', positionPanel);
    };
  }, [open, positionPanel]);

  return (
    <div className={`floating-tool-panel ${className}`}>
      <button
        ref={trigger}
        id={id + '-trigger'}
        type="button"
        className="secondary-action floating-tool-panel__trigger"
        popoverTarget={id}
        aria-controls={id}
        aria-expanded={open}
      >
        <span>{title}</span>
        <span className="floating-tool-panel__chevron" aria-hidden="true" />
      </button>
      <section
        ref={panel}
        id={id}
        popover="auto"
        className="floating-tool-panel__surface"
        aria-labelledby={id + '-trigger'}
        onBeforeToggle={(event) => {
          if (event.target === event.currentTarget && event.newState === 'open')
            positionPanel();
        }}
        onToggle={(event) => {
          if (event.target !== event.currentTarget) return;
          const isOpen = event.newState === 'open';
          setOpen(isOpen);
          if (
            !isOpen &&
            (document.activeElement === document.body ||
              event.currentTarget.contains(document.activeElement))
          ) {
            trigger.current?.focus({preventScroll: true});
          }
        }}
      >
        <header className="floating-tool-panel__header">
          <strong>{title}</strong>
          <button
            type="button"
            className="secondary-action"
            popoverTarget={id}
            popoverTargetAction="hide"
            aria-label={'收起' + title}
          >
            收起
          </button>
        </header>
        <div className="floating-tool-panel__body">{children}</div>
      </section>
    </div>
  );
}
