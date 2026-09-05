import {useCallback, useEffect, useRef, useState} from 'react';

import type {
  InformationEntrySearchIndexResponse,
  InformationEntrySearchIndexRefreshResponse,
  InformationEntrySearchIndexRefreshProgress,
  InformationEntrySearchIndexStatus,
  M1cHttpResponse,
} from '../api/m1c_api_contract.js';

interface IndexState {
  readonly phase:
    | 'loading'
    | 'ready'
    | 'refreshing'
    | 'pausing'
    | 'paused'
    | 'rebuilding'
    | 'error';
  readonly value: Readonly<InformationEntrySearchIndexStatus> | undefined;
  readonly progress:
    Readonly<InformationEntrySearchIndexRefreshProgress> | undefined;
  readonly message: string | undefined;
}

export function InformationEntrySearchIndexPanel({
  semanticEnabled,
  onLoad,
  onReadyChange,
  onRefresh,
  onRebuild,
}: {
  readonly semanticEnabled: boolean;
  readonly onLoad: () => Promise<
    M1cHttpResponse<InformationEntrySearchIndexResponse>
  >;
  readonly onReadyChange: (ready: boolean) => void;
  readonly onRefresh?: () => Promise<
    M1cHttpResponse<InformationEntrySearchIndexRefreshResponse>
  >;
  readonly onRebuild: () => Promise<
    M1cHttpResponse<InformationEntrySearchIndexResponse>
  >;
}) {
  const [state, setState] = useState<IndexState>({
    phase: 'loading',
    value: undefined,
    progress: undefined,
    message: undefined,
  });
  const generation = useRef(0);
  const stopRequested = useRef(false);
  const accept = useCallback(
    (response: M1cHttpResponse<InformationEntrySearchIndexResponse>) => {
      if (response.body.status !== 'ok') {
        onReadyChange(false);
        setState((current) => ({
          ...current,
          phase: 'error',
          message: '无法读取搜索索引状态，可以重新读取。',
        }));
        return;
      }
      onReadyChange(response.body.index.semanticSearchReady);
      setState({
        phase: 'ready',
        value: response.body.index,
        progress: undefined,
        message: undefined,
      });
    },
    [onReadyChange],
  );

  const reload = useCallback(() => {
    const request = ++generation.current;
    return Promise.resolve()
      .then(onLoad)
      .then(
        (response) => {
          if (request === generation.current) accept(response);
        },
        () => {
          if (request !== generation.current) return;
          onReadyChange(false);
          setState((current) => ({
            ...current,
            phase: 'error',
            message: '索引服务当前不可达，可以重新读取。',
          }));
        },
      );
  }, [accept, onLoad, onReadyChange]);

  useEffect(() => {
    void reload();
    return () => {
      stopRequested.current = true;
      generation.current += 1;
    };
  }, [reload]);

  function isStopped(): boolean {
    return stopRequested.current;
  }

  async function refresh(): Promise<void> {
    if (onRefresh === undefined) return;
    const request = ++generation.current;
    stopRequested.current = false;
    onReadyChange(false);
    setState((current) => ({
      ...current,
      phase: 'refreshing',
      progress: undefined,
      message: undefined,
    }));
    try {
      while (request === generation.current && !isStopped()) {
        const response = await onRefresh();
        if (request !== generation.current) return;
        if (response.body.status !== 'ok') {
          const issue =
            'issue' in response.body ? response.body.issue.code : undefined;
          setState((current) => ({
            ...current,
            phase: 'error',
            message:
              issue === 'search_index_maintenance_busy'
                ? '另一项索引维护正在进行。请稍后读取状态或重试。'
                : '本批刷新未完成；已保存的进度会保留，可以重试。',
          }));
          return;
        }
        const {index, progress} = response.body;
        onReadyChange(index.semanticSearchReady);
        const failed = progress.outcome === 'provider_failed';
        const complete = progress.outcome === 'complete';
        setState({
          phase: failed
            ? 'error'
            : complete
              ? 'ready'
              : isStopped()
                ? 'paused'
                : 'refreshing',
          value: index,
          progress,
          message: failed
            ? '内容相似索引生成失败；文字索引和已完成部分已保留，可以重试或继续文字查询。'
            : complete
              ? '索引已更新到当前状态。'
              : isStopped()
                ? '已暂停。下次将继续处理剩余变化项。'
                : undefined,
        });
        if (failed || complete || isStopped()) return;
      }
    } catch {
      if (request !== generation.current) return;
      onReadyChange(false);
      setState((current) => ({
        ...current,
        phase: 'error',
        message: '刷新连接中断；重新刷新会先检查已保存进度。',
      }));
    }
  }

  async function rebuild(): Promise<void> {
    const request = ++generation.current;
    onReadyChange(false);
    setState((current) => ({
      ...current,
      phase: 'rebuilding',
      progress: undefined,
      message: undefined,
    }));
    try {
      const response = await onRebuild();
      if (request !== generation.current) return;
      if (response.body.status === 'ok') {
        accept(response);
      } else {
        setState((current) => ({
          ...current,
          phase: 'error',
          message: '完整重建没有完成，可以重试；原文和条目未被修改。',
        }));
      }
    } catch {
      if (request !== generation.current) return;
      setState((current) => ({
        ...current,
        phase: 'error',
        message: '完整重建没有完成，可以重试；原文和条目未被修改。',
      }));
    }
  }

  const refreshing = state.phase === 'refreshing' || state.phase === 'pausing';
  const busy =
    state.phase === 'loading' || refreshing || state.phase === 'rebuilding';
  const pending =
    state.value === undefined
      ? undefined
      : Math.max(
          0,
          state.value.publicEntryCount -
            (state.value.semanticSearchAvailable
              ? state.value.embeddedProjectionCount
              : state.value.currentProjectionCount),
        );

  return (
    <aside
      className="entry-search-index-panel"
      aria-label="搜索索引维护"
      aria-live="polite"
    >
      <div>
        <h3>搜索索引</h3>
        {state.value === undefined ? null : (
          <p>
            已收录 {state.value.currentProjectionCount.toString()} /{' '}
            {state.value.publicEntryCount.toString()}
            {' · '}内容相似索引 {state.value.embeddedProjectionCount.toString()}
            {' · '}待刷新 {pending?.toString()}
            {' · '}过期投影 {state.value.staleProjectionCount.toString()}
            {state.value.embeddingModel === undefined
              ? ''
              : ' · ' + state.value.embeddingModel}
          </p>
        )}
        {state.phase === 'loading' ? <p>正在读取索引状态…</p> : null}
        <small>
          只处理公开条目。刷新会复用未变化的内容；每批最多 32
          项，离开页面后可继续。
        </small>
      </div>
      <div className="entry-search-index-panel__actions">
        {onRefresh === undefined ? null : (
          <button
            className="primary-action"
            type="button"
            disabled={busy}
            onClick={() => void refresh()}
          >
            {refreshing
              ? '正在分批刷新…'
              : state.phase === 'paused'
                ? '继续刷新'
                : state.phase === 'error'
                  ? '重试刷新'
                  : '刷新变化项'}
          </button>
        )}
        {refreshing ? (
          <button
            className="secondary-action"
            type="button"
            disabled={state.phase === 'pausing'}
            onClick={() => {
              stopRequested.current = true;
              setState((current) => ({
                ...current,
                phase: 'pausing',
                message: '本批完成后暂停，已完成部分会保留。',
              }));
            }}
          >
            本批后暂停
          </button>
        ) : (
          <button
            className="secondary-action"
            type="button"
            disabled={busy}
            onClick={() => {
              setState((current) => ({
                ...current,
                phase: 'loading',
                message: undefined,
              }));
              void reload();
            }}
          >
            读取状态
          </button>
        )}
      </div>
      {state.progress === undefined ? null : (
        <p className="entry-search-index-panel__feedback">
          本批更新 {state.progress.updatedEntryCount.toString()} · 清理{' '}
          {state.progress.removedProjectionCount.toString()}
          {' · '}复用相似索引 {state.progress.reusedEmbeddingCount.toString()} ·
          重新生成 {state.progress.embeddingInputCount.toString()}
          {' · '}版本已变化 {state.progress.staleEntryCount.toString()}
          {' · '}剩余刷新 {state.progress.remainingEntryCount.toString()} / 清理{' '}
          {state.progress.remainingObsoleteCount.toString()}
        </p>
      )}
      {state.message === undefined ? null : (
        <p
          className="entry-search-index-panel__feedback"
          role={state.phase === 'error' ? 'alert' : 'status'}
        >
          {state.message}
        </p>
      )}
      <details className="entry-search-index-panel__repair">
        <summary>完整重建与修复</summary>
        {state.value === undefined ? null : (
          <p>
            词项数 {state.value.postingCount.toString()}
            {' · '}分词版本 {state.value.tokenizerVersion}
            {' · '}索引版本 {state.value.indexVersion}
          </p>
        )}
        <p>
          索引损坏时可完整重建。此操作重新读取全部公开条目；配置了内容相似模型时会重新生成全部向量，可能产生调用费用。
        </p>
        <button
          className="secondary-action"
          type="button"
          disabled={busy}
          onClick={() => void rebuild()}
        >
          {state.phase === 'rebuilding'
            ? '正在重建…'
            : semanticEnabled
              ? '重建全部索引'
              : '重建文字索引'}
        </button>
      </details>
    </aside>
  );
}
