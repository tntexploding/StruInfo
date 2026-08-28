import {useEffect, useMemo, useRef} from 'react';

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
  const fragments = useMemo(
    () =>
      state.status === 'ready'
        ? state.snapshot.structures.flatMap((structure) => structure.fragments)
        : [],
    [state],
  );
  const readySnapshotId =
    state.status === 'ready' ? state.snapshot.snapshotId : undefined;
  useEffect(() => {
    if (readySnapshotId !== undefined) {
      closeButton.current?.focus();
    }
  }, [readySnapshotId]);

  if (state.status === 'closed') return null;

  return (
    <aside
      className="evidence-rail"
      aria-labelledby="evidence-rail-title"
      aria-live="polite"
    >
      <header className="evidence-rail__header">
        <div>
          <p className="section-index">DOSSIER / SOURCE EVIDENCE</p>
          <h2 id="evidence-rail-title">来源档案</h2>
        </div>
        <button
          className="icon-action"
          ref={closeButton}
          type="button"
          onClick={onClose}
          aria-label="关闭来源档案"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      {state.status === 'loading' ? (
        <div className="rail-state" role="status" aria-busy="true">
          <span className="state-rule" aria-hidden="true" />
          <p>正在读取规范正文与 Fragment 定位…</p>
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="rail-state rail-state--error" role="alert">
          <h3>无法打开来源档案</h3>
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
        <p className="signal-label">
          {snapshot.isPrivate === true
            ? '私密 · 已显式查看 · 完整备份'
            : '可追溯 · 原始来源'}
        </p>
        <h3 id="source-identity">{snapshot.sourceKey}</h3>
        {snapshot.isPrivate === true ? (
          <p className="privacy-disclosure">
            此全文、由其拆出的私密条目以及涉及私密条目的关系，默认不会出现在查询中。
          </p>
        ) : null}
        {snapshot.canonicalUri === undefined ? null : (
          <a href={snapshot.canonicalUri} target="_blank" rel="noreferrer">
            打开规范来源
          </a>
        )}
        <dl className="compact-facts">
          <div>
            <dt>捕获时间</dt>
            <dd>{formatDate(snapshot.capturedAt)}</dd>
          </div>
          <div>
            <dt>资源类型</dt>
            <dd>{snapshot.resourceKind}</dd>
          </div>
          <div>
            <dt>Snapshot</dt>
            <dd title={snapshot.snapshotId}>
              {shortHash(snapshot.snapshotId)}
            </dd>
          </div>
          <div>
            <dt>内容摘要</dt>
            <dd title={snapshot.canonicalContentSha256}>
              {shortHash(snapshot.canonicalContentSha256)}
            </dd>
          </div>
        </dl>
      </section>

      <section
        className="fragment-browser"
        aria-labelledby="fragment-list-title"
      >
        <header className="subsection-heading">
          <div>
            <p className="section-index">FRAGMENTS / {fragments.length}</p>
            <h3 id="fragment-list-title">结构片段</h3>
          </div>
        </header>
        {fragments.length === 0 ? (
          <p className="empty-copy">该 Snapshot 没有可审核 Fragment。</p>
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
          <p className="section-index">EXACT EXCERPT</p>
          <h3 id="excerpt-title">选中原文</h3>
          <blockquote>{selected.selectedText}</blockquote>
          <dl className="compact-facts compact-facts--single">
            <div>
              <dt>定位</dt>
              <dd>{fragmentLabel(selected)}</dd>
            </div>
            <div>
              <dt>摘要</dt>
              <dd title={selected.selectedTextSha256}>
                {shortHash(selected.selectedTextSha256)}
              </dd>
            </div>
          </dl>
        </section>
      )}

      <details className="source-text-disclosure">
        <summary>
          {snapshot.isPrivate === true
            ? '查看私密文档完整正文'
            : '查看规范化 Markdown 正文'}
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
  return `Code point ${fragment.codePointRange.start.toString()}–${fragment.codePointRange.end.toString()}`;
}

function shortHash(value: string): string {
  return value.length <= 18
    ? value
    : `${value.slice(0, 12)}…${value.slice(-6)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.valueOf())
    ? `${date.toLocaleString('zh-CN', {hour12: false})} · 本机时区`
    : value;
}
