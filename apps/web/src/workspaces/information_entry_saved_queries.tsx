import {useCallback, useEffect, useRef, useState} from 'react';
import type {M1cApiClient} from '../api/m1c_api_client.js';
import type {
  EntryQueryContext,
  EntrySavedQuery,
  EntrySavedQueries,
} from '../api/m1c_api_contract.js';

export interface EntrySavedQueryServices {
  readonly onLoadSavedQueries: M1cApiClient['loadEntrySavedQueries'];
  readonly onWriteSavedQuery: M1cApiClient['writeEntrySavedQuery'];
  readonly onReadQueryContext: M1cApiClient['readEntryQueryContext'];
}

export function InformationEntrySavedQueries({
  context,
  onLoad,
  onWrite,
  onOpen,
}: {
  readonly context: Readonly<EntryQueryContext>;
  readonly onLoad: EntrySavedQueryServices['onLoadSavedQueries'];
  readonly onWrite: EntrySavedQueryServices['onWriteSavedQuery'];
  readonly onOpen: (view: Readonly<EntrySavedQuery>) => void;
}) {
  const [state, setState] = useState<Readonly<EntrySavedQueries>>();
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const selected = state?.views.find((view) => view.viewId === selectedId);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const response = await onLoad();
      if (generation.current !== request) return;
      if (!('savedQueries' in response.body)) {
        setMessage('保存的查询暂时无法读取，请重试。');
        return;
      }
      setState(response.body.savedQueries);
      setMessage('');
    } catch {
      if (generation.current === request)
        setMessage('本地接口不可达，请重新读取保存的查询。');
    } finally {
      if (generation.current === request) setLoading(false);
    }
  }, [onLoad]);
  useEffect(() => {
    let cancelled = false;
    globalThis.queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
      generation.current += 1;
    };
  }, [load]);

  async function write(
    operation: 'save' | 'rename' | 'delete',
    create = false,
  ) {
    if (
      state === undefined ||
      busy ||
      loading ||
      (!create && selected === undefined)
    )
      return;
    const viewId = create ? globalThis.crypto.randomUUID() : selectedId;
    const request = ++generation.current;
    setBusy(true);
    setMessage('');
    try {
      const response = await onWrite({
        expectedRevision: state.revision,
        operation,
        viewId,
        ...(operation === 'delete' ? {} : {name}),
        ...(operation === 'save' ? context : {}),
      });
      if (generation.current !== request) return;
      if (!('savedQueries' in response.body)) {
        const code = 'issue' in response.body ? response.body.issue.code : '';
        setMessage(
          code === 'saved_queries_revision_conflict'
            ? '保存的查询已在另一处更改，请重新读取后再操作。'
            : code === 'saved_query_name_exists'
              ? '这个名称已被使用，请换一个名称。'
              : code === 'saved_query_limit'
                ? '最多保存 20 个查询，请先删除不再使用的查询。'
                : '没有保存，请检查名称和查询条件后重试。',
        );
        return;
      }
      setState(response.body.savedQueries);
      setSelectedId(operation === 'delete' ? '' : viewId);
      if (operation === 'delete') setName('');
      setMessage(
        operation === 'delete'
          ? '查询已删除，条目和来源保留。'
          : operation === 'rename'
            ? '查询已重命名。'
            : '查询条件与当前位置已保存。',
      );
    } catch {
      if (generation.current === request)
        setMessage('本地接口不可达，保存结果尚未确认；请重新读取。');
    } finally {
      if (generation.current === request) setBusy(false);
    }
  }
  return (
    <details className="workflow-tool-drawer saved-query-panel">
      <summary>
        保存的查询
        {state === undefined ? '' : ' · ' + state.views.length.toString()}
      </summary>
      <div className="saved-query-panel__body" aria-busy={busy || loading}>
        <p>保存条件和当前条目位置，打开时查询最新数据。</p>
        <label className="field">
          <span>已保存查询</span>
          <select
            value={selectedId}
            disabled={busy || loading}
            onChange={(event) => {
              const id = event.currentTarget.value;
              setSelectedId(id);
              setName(
                state?.views.find((view) => view.viewId === id)?.name ?? '',
              );
              setMessage('');
            }}
          >
            <option value="">选择查询</option>
            {state?.views.map((view) => (
              <option key={view.viewId} value={view.viewId}>
                {view.name}
                {view.query.includePrivate ? '（含隐私范围）' : ''}
              </option>
            ))}
          </select>
        </label>
        {state?.views.length === 0 ? (
          <p>还没有保存查询。设置条件后，为它起一个名称。</p>
        ) : null}
        <div className="entry-command-actions">
          <button
            className="secondary-action"
            type="button"
            disabled={busy || loading || selected === undefined}
            onClick={() => {
              if (selected !== undefined) onOpen(selected);
            }}
          >
            打开查询
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={busy || loading}
            onClick={() => void load()}
          >
            重新读取
          </button>
        </div>
        <label className="field">
          <span>查询名称</span>
          <input
            value={name}
            maxLength={160}
            disabled={busy}
            onChange={(event) => {
              setName(event.currentTarget.value);
            }}
          />
        </label>
        <div className="entry-command-actions">
          <button
            className="primary-action"
            type="button"
            disabled={
              busy || loading || state === undefined || name.trim() === ''
            }
            onClick={() => void write('save', true)}
          >
            另存当前查询
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={
              busy || loading || selected === undefined || name.trim() === ''
            }
            onClick={() => void write('save')}
          >
            更新条件与位置
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={
              busy || loading || selected === undefined || name.trim() === ''
            }
            onClick={() => void write('rename')}
          >
            重命名
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={busy || loading || selected === undefined}
            onClick={() => void write('delete')}
          >
            删除查询
          </button>
        </div>
        {loading ? <p role="status">正在读取保存的查询…</p> : null}
        {message === '' ? null : <p role="status">{message}</p>}
      </div>
    </details>
  );
}
