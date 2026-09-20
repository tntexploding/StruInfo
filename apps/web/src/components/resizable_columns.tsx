import {useEffect, useRef, useState, type CSSProperties} from 'react';

type Side = 'start' | 'end';
type Widths = Record<Side, number>;
const DEFAULTS: Record<'documents' | 'inbox', Widths> = {
  documents: {start: 280, end: 320},
  inbox: {start: 0, end: 400},
};
/** Only presentation dimensions are kept in this browser; no document state is stored. */
export function useResizableColumns(page: 'documents' | 'inbox') {
  const root = useRef<HTMLDivElement>(null);
  const key = 'struinfo:column-widths:v1:' + page;
  const defaults = DEFAULTS[page];
  const [widths, setWidths] = useState<Widths>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (
        typeof value === 'object' &&
        value !== null &&
        'start' in value &&
        'end' in value &&
        typeof value.start === 'number' &&
        Number.isFinite(value.start) &&
        typeof value.end === 'number' &&
        Number.isFinite(value.end)
      )
        return {
          start: Math.max(200, Math.min(480, value.start)),
          end: Math.max(280, Math.min(600, value.end)),
        };
    } catch {
      /* Browser storage is optional. */
    }
    return defaults;
  });
  const current = useRef(widths);
  const [container, setContainer] = useState(0);
  const [three, setThree] = useState(false);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const update = () => {
      setContainer(element.clientWidth);
      setThree(matchMedia('(min-width: 80rem)').matches);
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener('resize', update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
  const available = Math.max(
    0,
    container - (page === 'inbox' ? 16 : three ? 28 : 14) - 360,
  );
  const end =
    page === 'documents' && !three
      ? 0
      : Math.min(
          widths.end,
          Math.max(280, available - (page === 'documents' ? 200 : 0)),
        );
  const start =
    page === 'inbox'
      ? 0
      : Math.min(widths.start, Math.max(200, available - end));
  const actual = {start, end};
  const drag = useRef<{side: Side; x: number; width: number} | undefined>(
    undefined,
  );
  function change(side: Side, value: number) {
    const other = side === 'start' ? end : start;
    const min = side === 'start' ? 200 : 280;
    const max = Math.max(
      min,
      Math.min(side === 'start' ? 480 : 600, available - other),
    );
    const next = {
      ...current.current,
      [side]: Math.round(Math.min(max, Math.max(min, value))),
    };
    current.current = next;
    setWidths(next);
  }
  function persist() {
    try {
      localStorage.setItem(key, JSON.stringify(current.current));
    } catch {
      /* Optional. */
    }
  }
  function separator(side: Side, label: string) {
    const min = side === 'start' ? 200 : 280;
    const max = Math.max(
      min,
      Math.min(
        side === 'start' ? 480 : 600,
        available - actual[side === 'start' ? 'end' : 'start'],
      ),
    );
    return (
      <div
        className={'column-resizer column-resizer--' + side}
        role="separator"
        tabIndex={0}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={min}
        aria-valuemax={Math.round(max)}
        aria-valuenow={Math.round(actual[side])}
        aria-valuetext={String(Math.round(actual[side])) + ' 像素'}
        title={label + '：拖动或按左右方向键调整，双击恢复默认'}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          drag.current = {side, x: event.clientX, width: actual[side]};
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          if (d?.side === side)
            change(
              side,
              d.width + (event.clientX - d.x) * (side === 'start' ? 1 : -1),
            );
        }}
        onPointerUp={(event) => {
          drag.current = undefined;
          event.currentTarget.releasePointerCapture(event.pointerId);
          persist();
        }}
        onLostPointerCapture={() => {
          drag.current = undefined;
          persist();
        }}
        onDoubleClick={() => {
          change(side, defaults[side]);
          persist();
        }}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
            return;
          event.preventDefault();
          change(
            side,
            event.key === 'Home'
              ? min
              : event.key === 'End'
                ? max
                : actual[side] +
                  (event.key === 'ArrowRight' ? 16 : -16) *
                    (side === 'start' ? 1 : -1),
          );
          persist();
        }}
      >
        <span aria-hidden="true" />
      </div>
    );
  }
  return {
    root,
    style: {
      '--workspace-start-width': String(start) + 'px',
      '--workspace-end-width': String(end) + 'px',
    } as CSSProperties,
    separator,
  };
}
