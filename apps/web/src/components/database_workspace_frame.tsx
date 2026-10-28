import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import '../theme/prototypes/database.css';

function useColumn(name: string, initial: number) {
  const [value, set] = useState(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem('struinfo:database:' + name) ?? 'null',
      ) as {width: number; closed?: boolean} | null;
      return saved && Number.isFinite(saved.width)
        ? {
            width: Math.max(160, Math.min(380, saved.width)),
            closed:
              window.matchMedia('(max-width: 950px)').matches ||
              saved.closed === true,
          }
        : {
            width: initial,
            closed: window.matchMedia('(max-width: 950px)').matches,
          };
    } catch {
      return {width: initial, closed: false};
    }
  });
  useEffect(() => {
    const media = window.matchMedia('(max-width: 950px)');
    const listener = () => {
      if (media.matches) set((v) => ({...v, closed: true}));
    };
    media.addEventListener('change', listener);
    return () => {
      media.removeEventListener('change', listener);
    };
  }, []);
  const change = (next: typeof value) => {
    set(next);
    try {
      localStorage.setItem('struinfo:database:' + name, JSON.stringify(next));
    } catch {
      /* Layout storage is optional. */
    }
  };
  const drag = useRef<{x: number; width: number} | undefined>(undefined);
  const resize = (width: number) => {
    change({...value, width: Math.max(160, Math.min(380, width))});
  };
  const begin = (x: number) => {
    drag.current = {x, width: value.width};
  };
  const move = (x: number, direction: number) => {
    if (drag.current)
      resize(drag.current.width + (x - drag.current.x) * direction);
  };
  const end = () => {
    drag.current = undefined;
  };
  return {value, change, begin, move, end, resize};
}
export function DatabaseWorkspaceFrame({
  categories,
  reports,
  children,
  searched,
}: {
  readonly categories: ReactNode;
  readonly reports: ReactNode;
  readonly children: ReactNode;
  readonly searched: boolean;
}) {
  const left = useColumn('scope', 208),
    right = useColumn('reports', 232);
  const side = (
    column: ReturnType<typeof useColumn>,
    name: 'left' | 'right',
    title: string,
    content: ReactNode,
  ) => (
    <aside className={'side-region side-' + name} aria-label={title}>
      <button
        type="button"
        className="side-opener"
        hidden={!column.value.closed}
        aria-expanded={!column.value.closed}
        aria-label={'展开' + title}
        onClick={() => {
          column.change({...column.value, closed: false});
        }}
      >
        {name === 'left' ? '☷' : '▤'}
        <span>{title}</span>
      </button>
      <section className="side-panel" hidden={column.value.closed}>
        <header>
          <h2>{title}</h2>
          <button
            type="button"
            className="collapse-button"
            aria-label={'收起' + title}
            aria-expanded={!column.value.closed}
            onClick={() => {
              column.change({...column.value, closed: true});
            }}
          >
            {name === 'left' ? '‹' : '›'}
          </button>
        </header>
        {content}
      </section>
      {!column.value.closed ? (
        <div
          className="database-side-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label={'调整' + title + '宽度'}
          aria-valuemin={160}
          aria-valuemax={380}
          aria-valuenow={column.value.width}
          tabIndex={0}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            column.begin(e.clientX);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            column.move(e.clientX, name === 'left' ? 1 : -1);
          }}
          onPointerUp={column.end}
          onPointerCancel={column.end}
          onLostPointerCapture={column.end}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              column.resize(
                column.value.width +
                  (e.key === 'ArrowRight' ? 12 : -12) *
                    (name === 'left' ? 1 : -1),
              );
            }
          }}
          onDoubleClick={() => {
            column.resize(name === 'left' ? 208 : 232);
          }}
        />
      ) : null}
    </aside>
  );
  return (
    <div
      className={
        'db-layout' +
        (left.value.closed ? ' left-closed' : '') +
        (right.value.closed ? ' right-closed' : '')
      }
      data-view={searched ? 'results' : 'idle'}
      style={
        {
          '--left': left.value.closed
            ? '52px'
            : String(left.value.width) + 'px',
          '--right': right.value.closed
            ? '52px'
            : String(right.value.width) + 'px',
        } as CSSProperties
      }
    >
      {side(left, 'left', '内容范围', categories)}
      <section className="search-stage" aria-label="搜索与结果">
        {children}
      </section>
      {side(right, 'right', '报告', reports)}
    </div>
  );
}
