import {useEffect, useMemo, useRef, useState} from 'react';

import type {EvidenceFragment} from '../api/m1c_api_contract.js';
import type {EvidencePanelState} from './product_types.js';

export interface EvidenceRailProps {
  readonly onClose: () => void;
  readonly onRetry: (snapshotId: string) => void;
  readonly onSelectFragment: (fragmentId: string) => void;
  readonly state: EvidencePanelState;
}

export function EvidenceRail({
  onClose,
  onRetry,
  onSelectFragment,
  state,
}: EvidenceRailProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const rail = useRef<HTMLElement>(null);
  const [overlay, setOverlay] = useState(
    () =>
      typeof globalThis.matchMedia === 'function' &&
      globalThis.matchMedia('(max-width: 74.9375rem)').matches,
  );
  useEffect(() => {
    const media = globalThis.matchMedia('(max-width: 74.9375rem)');
    const update = () => {
      setOverlay(media.matches);
    };
    media.addEventListener('change', update);
    return () => {
      media.removeEventListener('change', update);
    };
  }, []);
  const isOpen = state.status !== 'closed';
  useEffect(() => {
    if (!isOpen || !overlay) return;
    const siblings = Array.from(
      rail.current?.parentElement?.children ?? [],
    ).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== rail.current,
    );
    const previous = siblings.map((element) => element.inert);
    siblings.forEach((element) => {
      element.inert = true;
    });
    return () => {
      siblings.forEach((element, index) => {
        element.inert = previous[index] ?? false;
      });
    };
  }, [isOpen, overlay]);
  const fragments = useMemo(
    () =>
      state.status === 'ready'
        ? state.snapshot.structures.flatMap((structure) => structure.fragments)
        : [],
    [state],
  );
  const activeSnapshotId =
    state.status === 'closed'
      ? undefined
      : state.status === 'ready'
        ? state.snapshot.snapshotId
        : state.snapshotId;
  useEffect(() => {
    if (activeSnapshotId !== undefined) {
      closeButton.current?.focus();
    }
  }, [activeSnapshotId]);

  if (state.status === 'closed') return null;

  return (
    <aside
      className="evidence-rail"
      ref={rail}
      role={overlay ? 'dialog' : undefined}
      aria-modal={overlay ? true : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
          return;
        }
        if (!overlay || event.key !== 'Tab') return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      aria-labelledby="evidence-rail-title"
      aria-live="polite"
    >
      <header className="evidence-rail__header">
        <div>
          <h2 id="evidence-rail-title">来源原文</h2>
        </div>
        <button
          className="icon-action"
          ref={closeButton}
          type="button"
          onClick={onClose}
          aria-label="关闭来源原文"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      {state.status === 'loading' ? (
        <div className="rail-state" role="status" aria-busy="true">
          <span className="state-rule" aria-hidden="true" />
          <p>正在读取原文与片段位置…</p>
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="rail-state rail-state--error" role="alert">
          <h3>无法打开来源原文</h3>
          <p>{state.message}</p>
          <button
            className="secondary-action"
            type="button"
            onClick={() => {
              onRetry(state.snapshotId);
            }}
          >
            重试读取
          </button>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <EvidenceDossier
          snapshot={state.snapshot}
          fragments={fragments}
          selectedFragmentId={state.selectedFragmentId}
          onSelectFragment={onSelectFragment}
        />
      ) : null}
    </aside>
  );
}

function EvidenceDossier({
  fragments,
  onSelectFragment,
  selectedFragmentId,
  snapshot,
}: {
  readonly fragments: readonly Readonly<EvidenceFragment>[];
  readonly onSelectFragment: (fragmentId: string) => void;
  readonly selectedFragmentId?: string | undefined;
  readonly snapshot: Extract<EvidencePanelState, {status: 'ready'}>['snapshot'];
}) {
  const selected =
    fragments.find((fragment) => fragment.fragmentId === selectedFragmentId) ??
    fragments[0];
  return (
    <div className="evidence-dossier">
      <section className="dossier-identity" aria-labelledby="source-identity">
        {snapshot.isPrivate === true ? (
          <p className="signal-label">私密文档</p>
        ) : null}
        <h3 id="source-identity">{snapshot.sourceKey}</h3>
        {snapshot.isPrivate === true ? (
          <p className="privacy-disclosure">
            此全文、由其拆出的私密条目以及涉及私密条目的关系，默认不会出现在查询中。
          </p>
        ) : null}
        {snapshot.canonicalUri === undefined ? null : (
          <a href={snapshot.canonicalUri} target="_blank" rel="noreferrer">
            打开原网页
          </a>
        )}
        <dl className="compact-facts">
          <div>
            <dt>导入时间</dt>
            <dd>{formatDate(snapshot.capturedAt)}</dd>
          </div>
          <div>
            <dt>资源类型</dt>
            <dd>{resourceKindLabel(snapshot.resourceKind)}</dd>
          </div>
        </dl>
      </section>

      <section
        className="fragment-browser"
        aria-labelledby="fragment-list-title"
      >
        <header className="subsection-heading">
          <div>
            <h3 id="fragment-list-title">
              原文片段（{fragments.length.toString()}）
            </h3>
          </div>
        </header>
        {fragments.length === 0 ? (
          <p className="empty-copy">该文档没有可查看的原文片段。</p>
        ) : (
          <ol className="fragment-index">
            {fragments.map((fragment, index) => (
              <li key={fragment.fragmentId}>
                <button
                  type="button"
                  data-active={fragment.fragmentId === selected?.fragmentId}
                  onClick={() => {
                    onSelectFragment(fragment.fragmentId);
                  }}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{fragmentLabel(fragment)}</strong>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      {selected === undefined ? null : (
        <section className="excerpt-panel" aria-labelledby="excerpt-title">
          <h3 id="excerpt-title">选中原文</h3>
          <blockquote>{selected.selectedText}</blockquote>
          <p className="fragment-location">{fragmentLabel(selected)}</p>
        </section>
      )}

      <details className="source-text-disclosure">
        <summary>
          {snapshot.isPrivate === true
            ? '查看私密文档完整正文'
            : '查看整理后的正文'}
        </summary>
        {snapshot.structures.map((structure) => (
          <pre key={structure.structureId}>{structure.normalizedText}</pre>
        ))}
      </details>
    </div>
  );
}

function fragmentLabel(fragment: Readonly<EvidenceFragment>): string {
  if (fragment.lineRange !== undefined) {
    return `第 ${fragment.lineRange.start.toString()}–${fragment.lineRange.end.toString()} 行`;
  }
  return `第 ${fragment.codePointRange.start.toString()}–${fragment.codePointRange.end.toString()} 个字符`;
}

function resourceKindLabel(kind: string): string {
  if (kind === 'git_file') return 'Git 文件';
  if (kind === 'uploaded_file') return '本地文件';
  if (kind === 'remote_document') return '订阅文档';
  if (kind === 'manual_text') return '手动输入';
  return '其他';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.valueOf())
    ? `${date.toLocaleString('zh-CN', {hour12: false})} · 本机时区`
    : value;
}
