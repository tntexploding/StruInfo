import {useEffect, useRef, useState, type ReactNode} from 'react';
interface PaneProps {
  name: string;
  left: ReactNode;
  children: ReactNode;
}

export function TwoPane({name, left, children}: PaneProps) {
  return (
    <ResizablePanes
      name={name}
      className="journey-two-pane"
      left={<aside className="journey-pane journey-pane--list">{left}</aside>}
    >
      <div className="journey-pane journey-pane--body">{children}</div>
    </ResizablePanes>
  );
}

/** Stores layout only, never source text or drafts. */
export function ResizablePanes({
  name,
  className,
  left,
  children,
  side = 'left',
  resizeLabel = side === 'left' ? '调整列表宽度' : '调整旁注宽度',
  minimum = 240,
  maximum = 520,
  initial = 320,
  contentMinimum = 492,
}: PaneProps & {
  className: string;
  side?: 'left' | 'right';
  resizeLabel?: string;
  minimum?: number;
  maximum?: number;
  initial?: number;
  contentMinimum?: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => {
    try {
      const value = Number(localStorage.getItem('struinfo:pane:v2:' + name));
      return value >= minimum && value <= maximum ? value : initial;
    } catch {
      return initial;
    }
  });
  const [available, setAvailable] = useState(1200);
  const drag = useRef<{x: number; width: number} | undefined>(undefined);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailable(entry.contentRect.width);
    });
    observer.observe(root.current);
    return () => {
      observer.disconnect();
    };
  }, []);
  const actual = Math.min(width, Math.max(minimum, available - contentMinimum));
  const change = (value: number) => {
    const next = Math.round(
      Math.max(minimum, Math.min(maximum, available - contentMinimum, value)),
    );
    setWidth(next);
    try {
      localStorage.setItem('struinfo:pane:v2:' + name, String(next));
    } catch {
      /* Optional layout storage. */
    }
  };
  return (
    <div
      ref={root}
      className={className}
      style={{
        gridTemplateColumns:
          side === 'left'
            ? String(actual) + 'px 12px minmax(0,1fr)'
            : 'minmax(0,1fr) 12px ' + String(actual) + 'px',
      }}
    >
      {side === 'left' ? left : children}
      <div
        className="journey-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label={resizeLabel}
        aria-valuemin={minimum}
        aria-valuemax={Math.max(
          minimum,
          Math.min(maximum, available - contentMinimum),
        )}
        aria-valuenow={actual}
        aria-valuetext={String(Math.round(actual)) + ' 像素'}
        title="拖动或按左右方向键调整宽度，双击恢复默认"
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.focus();
          drag.current = {x: e.clientX, width: actual};
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            change(
              drag.current.width +
                (e.clientX - drag.current.x) * (side === 'left' ? 1 : -1),
            );
        }}
        onPointerUp={(e) => {
          drag.current = undefined;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onLostPointerCapture={() => {
          drag.current = undefined;
        }}
        onDoubleClick={() => {
          change(initial);
        }}
        onPointerCancel={() => {
          drag.current = undefined;
        }}
        onKeyDown={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            change(
              e.key === 'Home'
                ? minimum
                : e.key === 'End'
                  ? maximum
                  : actual +
                    (e.key === 'ArrowRight' ? 20 : -20) *
                      (side === 'left' ? 1 : -1),
            );
          }
        }}
      />
      {side === 'left' ? children : left}
    </div>
  );
}
