import {useEffect, useState} from 'react';
import type {InformationEntry} from '../api/m1c_api_contract.js';
import type {Loadable} from '../components/product_types.js';
import {
  InformationEntryReadOnlyDetail,
  type InformationEntryServices,
} from './information_entry_components.js';
import type {EntrySavedQueryServices} from './information_entry_saved_queries.js';

export function InformationEntryRestoredSelection({
  entryId,
  includePrivate,
  onlyPrivate,
  onRead,
  onOpenEvidence,
  onOpenGraph,
}: {
  readonly entryId: string;
  readonly includePrivate: boolean;
  readonly onlyPrivate: boolean;
  readonly onRead: EntrySavedQueryServices['onReadQueryContext'];
  readonly onOpenEvidence: InformationEntryServices['onOpenEvidence'];
  readonly onOpenGraph?: (entry: Readonly<InformationEntry>) => void;
}) {
  const [state, setState] = useState<Loadable<Readonly<InformationEntry>>>({
    status: 'loading',
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const isCurrent = (): boolean => active;
    async function read() {
      if (!isCurrent()) return;
      setState({status: 'loading'});
      try {
        const response = await onRead({entryId, includePrivate, onlyPrivate});
        if (!isCurrent()) return;
        setState(
          response.body.status === 'ok'
            ? {status: 'ready', value: response.body.entry}
            : {
                status: 'error',
                message:
                  response.body.status === 'not_found'
                    ? '上次查看的条目已不存在、已被重组，或不在本次可见范围内。仍可继续查看查询结果。'
                    : '无法读取上次查看的条目，可重试或选择当前结果。',
              },
        );
      } catch {
        if (isCurrent())
          setState({
            status: 'error',
            message: '本地接口不可达，可重试或选择当前结果。',
          });
      }
    }
    globalThis.queueMicrotask(() => {
      void read();
    });
    return () => {
      active = false;
    };
  }, [attempt, entryId, includePrivate, onRead, onlyPrivate]);
  return (
    <section className="saved-query-selection" aria-label="上次查看的位置">
      <h2>上次查看的位置</h2>
      <p>此条目不在本页结果中，以下按当前可见范围单独读取。</p>
      {state.status === 'loading' ? (
        <p role="status">正在读取当前条目…</p>
      ) : null}
      {state.status === 'error' ? (
        <>
          <p role="status">{state.message}</p>
          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              setAttempt((value) => value + 1);
            }}
          >
            重试读取条目
          </button>
        </>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <InformationEntryReadOnlyDetail
            entry={state.value}
            variant="query"
            onOpenEvidence={onOpenEvidence}
          />
          {onOpenGraph === undefined ? null : (
            <button
              type="button"
              className="secondary-action"
              onClick={() => {
                onOpenGraph(state.value);
              }}
            >
              {state.value.value.isPrivate
                ? '含隐私在图谱中查看'
                : '在图谱中查看'}
            </button>
          )}
        </>
      ) : null}
    </section>
  );
}
