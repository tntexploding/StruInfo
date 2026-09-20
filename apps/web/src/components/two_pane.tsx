import {useEffect, useRef, useState, type ReactNode} from 'react';
/** Stores layout only, never source text or drafts. */
export function TwoPane({
  name,
  left,
  children,
}: {
  name: string;
  left: ReactNode;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => {
    try {
      const value = Number(localStorage.getItem('struinfo:pane:v2:' + name));
      return value >= 240 && value <= 520 ? value : 320;
    } catch {
      return 320;
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
  const actual = Math.min(width, Math.max(240, available - 480));
  const change = (value: number) => {
    const next = Math.round(
      Math.max(240, Math.min(520, available - 480, value)),
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
      className="journey-two-pane"
      style={{gridTemplateColumns: String(actual) + 'px 12px minmax(0,1fr)'}}
    >
      <aside className="journey-pane journey-pane--list">{left}</aside>
      <div
        className="journey-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整列表宽度"
        aria-valuemin={240}
        aria-valuemax={Math.max(240, Math.min(520, available - 480))}
        aria-valuenow={actual}
        tabIndex={0}
        onPointerDown={(e) => {
          drag.current = {x: e.clientX, width: actual};
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            change(drag.current.width + e.clientX - drag.current.x);
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onPointerCancel={() => {
          drag.current = undefined;
        }}
        onKeyDown={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            change(
              e.key === 'Home'
                ? 240
                : e.key === 'End'
                  ? 520
                  : width + (e.key === 'ArrowRight' ? 20 : -20),
            );
          }
        }}
      />
      <div className="journey-pane journey-pane--body">{children}</div>
    </div>
  );
}
