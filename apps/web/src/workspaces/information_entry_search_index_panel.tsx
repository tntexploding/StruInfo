import {useCallback, useEffect, useRef, useState} from 'react';

import type {
  InformationEntrySearchIndexResponse,
  InformationEntrySearchIndexStatus,
  M1cHttpResponse,
} from '../api/m1c_api_contract.js';

type IndexState =
  | Readonly<{status: 'loading'}>
  | Readonly<{status: 'error'; message: string}>
  | Readonly<{
      status: 'ready' | 'rebuilding';
      value: Readonly<InformationEntrySearchIndexStatus>;
    }>;

export function InformationEntrySearchIndexPanel({
  semanticEnabled,
  onLoad,
  onReadyChange,
  onRebuild,
}: {
  readonly semanticEnabled: boolean;
  readonly onLoad: () => Promise<
    M1cHttpResponse<InformationEntrySearchIndexResponse>
  >;
  readonly onReadyChange: (ready: boolean) => void;
  readonly onRebuild: () => Promise<
    M1cHttpResponse<InformationEntrySearchIndexResponse>
  >;
}) {
  const [state, setState] = useState<IndexState>({status: 'loading'});
  const generation = useRef(0);
  const accept = useCallback(
    (response: M1cHttpResponse<InformationEntrySearchIndexResponse>) => {
      if (response.body.status !== 'ok') {
        onReadyChange(false);
        setState({status: 'error', message: '无法读取检索索引状态。'});
        return;
      }
      onReadyChange(response.body.index.semanticSearchReady);
      setState({status: 'ready', value: response.body.index});
    },
    [onReadyChange],
  );

  useEffect(() => {
    const request = ++generation.current;
    void onLoad()
      .then((response) => {
        if (request === generation.current) accept(response);
      })
      .catch(() => {
        if (request !== generation.current) return;
        onReadyChange(false);
        setState({status: 'error', message: '检索索引接口当前不可达。'});
      });
    return () => {
      generation.current += 1;
    };
  }, [accept, onLoad, onReadyChange]);

  async function rebuild(): Promise<void> {
    const request = ++generation.current;
    setState((current) =>
      current.status === 'ready'
        ? {status: 'rebuilding', value: current.value}
        : current,
    );
    try {
      const response = await onRebuild();
      if (request === generation.current) accept(response);
    } catch {
      if (request !== generation.current) return;
      onReadyChange(false);
      setState({
        status: 'error',
        message: '索引重建没有完成；现有查询未被修改。',
      });
    }
  }

  return (
    <aside className="entry-search-index-panel" aria-live="polite">
      <div>
        <p className="section-index">DERIVED INDEX / REBUILDABLE</p>
        <h3>本地检索索引</h3>
        {state.status === 'loading' ? (
          <p>正在读取索引状态…</p>
        ) : state.status === 'error' ? (
          <p role="alert">{state.message}</p>
        ) : (
          <p>
            词项 {state.value.postingCount.toString()} · 当前投影{' '}
            {state.value.currentProjectionCount.toString()} /{' '}
            {state.value.publicEntryCount.toString()} · 向量{' '}
            {state.value.embeddedProjectionCount.toString()}
            {state.value.embeddingModel === undefined
              ? ''
              : ` · ${state.value.embeddingModel}`}
          </p>
        )}
        <small>
          索引只保存公开 Entry
          的派生词项与向量，可随时删除重建；原文与正式数据仍以 Entry
          和来源证据为准。
        </small>
      </div>
      <button
        className="secondary-action"
        type="button"
        disabled={state.status === 'loading' || state.status === 'rebuilding'}
        onClick={() => void rebuild()}
      >
        {state.status === 'rebuilding'
          ? '正在重建…'
          : semanticEnabled
            ? '重建词项与向量'
            : '重建本地词项'}
      </button>
    </aside>
  );
}
