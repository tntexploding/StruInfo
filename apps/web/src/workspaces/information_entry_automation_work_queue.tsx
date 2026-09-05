import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import type {
  EntryAutomationWorkItemState,
  EntryAutomationWorkQueueItemView,
  InformationEntry,
  InformationEntryAutomationWorkItemWriteResponse,
  InformationEntryAutomationActionWriteResponse,
  InformationEntryAutomationWorkQueueResponse,
  M1cHttpResponse,
} from '../api/m1c_api_contract.js';
import {createLatestRequestTracker} from './latest_request.js';

type QueueState =
  | Readonly<{status: 'loading'}>
  | Readonly<{status: 'error'; message: string}>
  | Readonly<{
      status: 'ready';
      items: readonly Readonly<EntryAutomationWorkQueueItemView>[];
    }>;

export interface InformationEntryAutomationWorkQueueProps {
  readonly enabled: boolean;
  readonly onList: (
    includePrivate: boolean,
  ) => Promise<M1cHttpResponse<InformationEntryAutomationWorkQueueResponse>>;
  readonly onUpdate: (
    runId: string,
    claimOrdinal: number,
    body: Readonly<{
      expectedVersion: number;
      state: EntryAutomationWorkItemState;
      includePrivate: boolean;
    }>,
  ) => Promise<
    M1cHttpResponse<InformationEntryAutomationWorkItemWriteResponse>
  >;
  readonly onOpenEntry: (entry: Readonly<InformationEntry>) => void;
  readonly onExecuteAction?: (
    runId: string,
    claimOrdinal: number,
    body: Readonly<{
      expectedVersion: number;
      operation: 'apply' | 'undo';
      includePrivate: boolean;
    }>,
  ) => Promise<M1cHttpResponse<InformationEntryAutomationActionWriteResponse>>;
}

export function InformationEntryAutomationWorkQueue({
  enabled,
  onList,
  onExecuteAction,
  onOpenEntry,
  onUpdate,
}: InformationEntryAutomationWorkQueueProps) {
  const [includePrivate, setIncludePrivate] = useState(false);
  const [filter, setFilter] = useState<'all' | EntryAutomationWorkItemState>(
    'pending',
  );
  const [state, setState] = useState<QueueState>({status: 'loading'});
  const [busyKey, setBusyKey] = useState<string>();
  const requests = useRef(createLatestRequestTracker());

  const load = useCallback(async () => {
    if (!enabled) return;
    const requestId = requests.current.begin();
    setState({status: 'loading'});
    try {
      const response = await onList(includePrivate);
      if (!requests.current.isCurrent(requestId)) return;
      if (response.body.status !== 'ok') {
        setState({status: 'error', message: '无法读取自动分流工作队列。'});
        return;
      }
      setState({status: 'ready', items: response.body.items});
    } catch {
      if (!requests.current.isCurrent(requestId)) return;
      setState({
        status: 'error',
        message: '本地服务当前不可达；已保存的工作项没有改变。',
      });
    }
  }, [enabled, includePrivate, onList]);

  useEffect(() => {
    const tracker = requests.current;
    if (enabled) void Promise.resolve().then(load);
    return () => {
      tracker.invalidate();
    };
  }, [enabled, load]);

  const visible = useMemo(
    () =>
      state.status !== 'ready' || filter === 'all'
        ? state.status === 'ready'
          ? state.items
          : Object.freeze([])
        : state.items.filter((item) => item.state === filter),
    [filter, state],
  );

  async function changeState(
    item: Readonly<EntryAutomationWorkQueueItemView>,
    nextState: EntryAutomationWorkItemState,
  ) {
    const key = `${item.runId}:${String(item.claimOrdinal)}`;
    if (busyKey !== undefined) return;
    setBusyKey(key);
    try {
      const response = await onUpdate(item.runId, item.claimOrdinal, {
        expectedVersion: item.version,
        state: nextState,
        includePrivate,
      });
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        setState({
          status: 'error',
          message:
            response.body.status === 'stale'
              ? '工作项已在其他操作中改变，请重新读取。'
              : '工作项没有更新；当前数据保持不变。',
        });
        return;
      }
      await load();
    } catch {
      setState({
        status: 'error',
        message: '本地服务当前不可达；工作项没有更新。',
      });
    } finally {
      setBusyKey(undefined);
    }
  }

  async function executeAction(
    item: Readonly<EntryAutomationWorkQueueItemView>,
    operation: 'apply' | 'undo',
  ) {
    const action = item.action;
    if (
      action === undefined ||
      busyKey !== undefined ||
      onExecuteAction === undefined
    )
      return;
    const key = `${item.runId}:${String(item.claimOrdinal)}`;
    setBusyKey(key);
    try {
      const response = await onExecuteAction(item.runId, item.claimOrdinal, {
        expectedVersion: action.version,
        operation,
        includePrivate,
      });
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        setState({
          status: 'error',
          message:
            response.body.status === 'stale'
              ? '条目或自动处理结果已变化；为保护人工修改，本次操作已停止。'
              : '自动处理没有完成；当前条目与人工联系保持不变。',
        });
        return;
      }
      await load();
    } catch {
      setState({
        status: 'error',
        message: '本地服务当前不可达；自动处理没有继续。',
      });
    } finally {
      setBusyKey(undefined);
    }
  }

  return (
    <section
      className="entry-automation-work-queue"
      aria-labelledby="entry-automation-work-queue-title"
    >
      <header className="subsection-heading">
        <div>
          <h2 id="entry-automation-work-queue-title">自动分流工作队列</h2>
        </div>
      </header>

      {!enabled ? (
        <p className="empty-copy" role="status">
          当前服务未启用自动分流，仍可逐条编辑。
        </p>
      ) : (
        <>
          <div className="entry-automation-work-queue__controls">
            <label>
              <span>显示状态</span>
              <select
                value={filter}
                onChange={(event) => {
                  setFilter(
                    event.currentTarget.value as
                      'all' | EntryAutomationWorkItemState,
                  );
                }}
              >
                <option value="pending">待处理</option>
                <option value="completed">已完成</option>
                <option value="dismissed">已跳过</option>
                <option value="all">全部</option>
              </select>
            </label>
            <label className="entry-automation-work-queue__privacy">
              <input
                type="checkbox"
                checked={includePrivate}
                disabled={busyKey !== undefined}
                onChange={(event) => {
                  setIncludePrivate(event.currentTarget.checked);
                }}
              />
              显示隐私条目
            </label>
            <button
              className="secondary-action"
              type="button"
              onClick={() => void load()}
            >
              刷新队列
            </button>
          </div>

          {state.status === 'loading' ? (
            <p className="empty-copy" role="status">
              正在读取工作队列…
            </p>
          ) : null}
          {state.status === 'error' ? (
            <div className="error-state" role="alert">
              <p>{state.message}</p>
              <button
                className="secondary-action"
                type="button"
                onClick={() => void load()}
              >
                重新读取
              </button>
            </div>
          ) : null}
          {state.status === 'ready' && visible.length === 0 ? (
            <p className="empty-copy">当前筛选下没有工作项。</p>
          ) : null}
          {state.status === 'ready' && visible.length > 0 ? (
            <ol className="entry-automation-work-queue__list">
              {visible.map((item) => {
                const key = `${item.runId}:${String(item.claimOrdinal)}`;
                return (
                  <li key={key}>
                    <div>
                      <p>
                        {routeLabel(item.route)} · {reasonLabel(item.reason)}
                      </p>
                      <h3>{item.entry.value.titlePath}</h3>
                      <p>
                        状态：{stateLabel(item.state)}
                        {item.stale ? ' · 条目已有新版本' : ''}
                        {item.entry.value.isPrivate ? ' · 隐私' : ''}
                      </p>
                      {item.action === undefined ? null : (
                        <p className="entry-automation-work-queue__action-status">
                          自动处理：{actionStateLabel(item.action.state)}
                          {item.action.deterministicTagsEnabled
                            ? ` · 新增标签 ${item.action.addedTagCount.toString()}`
                            : ''}
                          {item.action.rebuildAssociationsEnabled &&
                          item.action.associationProjectionCount !== undefined
                            ? ` · 当前联系 ${item.action.associationProjectionCount.toString()}`
                            : ''}
                        </p>
                      )}
                    </div>
                    <div className="entry-automation-work-queue__actions">
                      {item.action?.state === 'pending' ||
                      item.action?.state === 'tags_applied' ? (
                        <button
                          className="secondary-action"
                          type="button"
                          disabled={busyKey !== undefined || item.stale}
                          onClick={() => void executeAction(item, 'apply')}
                        >
                          {busyKey === key ? '正在处理…' : '继续自动处理'}
                        </button>
                      ) : null}
                      {item.action?.state === 'applied' ? (
                        <button
                          className="text-action"
                          type="button"
                          disabled={busyKey !== undefined || item.stale}
                          onClick={() => void executeAction(item, 'undo')}
                        >
                          撤销本次自动处理
                        </button>
                      ) : null}
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => {
                          onOpenEntry(item.entry);
                        }}
                      >
                        打开条目
                      </button>
                      {item.state !== 'pending' ? (
                        <button
                          className="secondary-action"
                          type="button"
                          disabled={busyKey !== undefined}
                          onClick={() => void changeState(item, 'pending')}
                        >
                          重新打开
                        </button>
                      ) : (
                        <>
                          <button
                            className="primary-action"
                            type="button"
                            disabled={busyKey !== undefined}
                            onClick={() => void changeState(item, 'completed')}
                          >
                            {busyKey === key ? '正在保存…' : '标记完成'}
                          </button>
                          <button
                            className="text-action"
                            type="button"
                            disabled={busyKey !== undefined}
                            onClick={() => void changeState(item, 'dismissed')}
                          >
                            跳过
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </>
      )}
    </section>
  );
}

function routeLabel(route: EntryAutomationWorkQueueItemView['route']): string {
  if (route === 'advance_candidate') return '建议继续处理';
  if (route === 'manual_review') return '需要人工检查';
  return '建议暂缓';
}

function reasonLabel(
  reason: EntryAutomationWorkQueueItemView['reason'],
): string {
  const labels: Record<EntryAutomationWorkQueueItemView['reason'], string> = {
    advance_threshold_met: '评分适合继续处理',
    defer_threshold_met: '评分适合暂缓',
    threshold_not_met: '评分不足以自动决定',
    insufficient_profile_evidence: '参考数据不足',
    mixed_signals: '信号不一致',
    manual_takeover: '已改为人工处理',
    run_budget_exhausted: '本次处理数量已达上限',
    advance_budget_exhausted: '继续处理数量已达上限',
    defer_budget_exhausted: '暂缓数量已达上限',
  };
  return labels[reason];
}

function stateLabel(state: EntryAutomationWorkItemState): string {
  if (state === 'pending') return '待处理';
  if (state === 'completed') return '已完成';
  return '已跳过';
}

function actionStateLabel(
  state: NonNullable<EntryAutomationWorkQueueItemView['action']>['state'],
): string {
  switch (state) {
    case 'pending':
      return '等待执行';
    case 'tags_applied':
      return '标签已写入，正在重建联系';
    case 'applied':
      return '已完成';
    case 'undo_pending':
      return '标签已撤销，正在重建联系';
    case 'undone':
      return '已撤销';
    case 'cancelled':
      return '已取消';
  }
}
