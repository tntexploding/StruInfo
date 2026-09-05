import {useCallback, useEffect, useMemo, useState} from 'react';

import type {
  M1cHttpResponse,
  ProcessingRunCancelResponse,
  ProcessingRunListResponse,
  ProcessingRunView,
  ProcessingStage,
  WorkspaceResponse,
} from '../api/m1c_api_contract.js';

export interface ProcessingRunRailProps {
  readonly workspace?: Readonly<WorkspaceResponse> | undefined;
  readonly refreshToken: number;
  readonly onListRuns: (
    limit: number,
  ) => Promise<M1cHttpResponse<ProcessingRunListResponse>>;
  readonly onCancelRun: (
    runId: string,
    expectedVersion: number,
  ) => Promise<M1cHttpResponse<ProcessingRunCancelResponse>>;
}

type RunState =
  | Readonly<{status: 'loading'}>
  | Readonly<{status: 'ready'; runs: readonly Readonly<ProcessingRunView>[]}>
  | Readonly<{status: 'error'}>;

const STAGES: readonly Readonly<{
  key: ProcessingStage;
  index: string;
  label: string;
}>[] = Object.freeze([
  {key: 'import', index: '01', label: '导入'},
  {key: 'split', index: '02', label: '拆分'},
  {key: 'tags', index: '03', label: '标签'},
  {key: 'associations', index: '04', label: '联系'},
  {key: 'query', index: '05', label: '查询'},
]);

export function ProcessingRunRail({
  onCancelRun,
  onListRuns,
  refreshToken,
  workspace,
}: ProcessingRunRailProps) {
  const processingEnabled =
    workspace?.capabilities.includes('processing_runs') === true;
  const aiEnabled =
    workspace?.capabilities.some(
      (capability) => capability === 'ai' || capability.startsWith('ai_'),
    ) === true;
  const [state, setState] = useState<RunState>(
    processingEnabled
      ? {status: 'loading'}
      : {status: 'ready', runs: Object.freeze([])},
  );
  const [cancelling, setCancelling] = useState<string>();

  const load = useCallback(async () => {
    if (!processingEnabled) {
      setState({status: 'ready', runs: Object.freeze([])});
      return;
    }
    setState({status: 'loading'});
    try {
      const response = await onListRuns(20);
      setState(
        response.body.status === 'ok'
          ? {status: 'ready', runs: response.body.runs}
          : {status: 'error'},
      );
    } catch {
      setState({status: 'error'});
    }
  }, [onListRuns, processingEnabled]);

  useEffect(() => {
    void refreshToken;
    globalThis.queueMicrotask(() => void load());
  }, [load, refreshToken]);

  const latest = state.status === 'ready' ? state.runs[0] : undefined;
  const progress = useMemo(() => progressLabel(latest), [latest]);

  const cancel = useCallback(async () => {
    if (
      latest === undefined ||
      (latest.status !== 'queued' && latest.status !== 'running')
    ) {
      return;
    }
    setCancelling(latest.runId);
    try {
      await onCancelRun(latest.runId, latest.version);
      await load();
    } finally {
      setCancelling(undefined);
    }
  }, [latest, load, onCancelRun]);

  return (
    <aside className="workflow-overview__ai" aria-labelledby="ai-flow-title">
      <header>
        <h2 id="ai-flow-title">处理任务进度</h2>
        <span
          className="status-chip"
          data-state={latest?.status === 'running' ? 'ready' : 'neutral'}
        >
          {state.status === 'loading'
            ? '读取中'
            : state.status === 'error'
              ? '任务状态不可用'
              : latest === undefined
                ? aiEnabled
                  ? 'AI 已启用，当前没有任务'
                  : 'AI 未启用，当前没有任务'
                : runStatusLabel(latest)}
        </span>
      </header>

      <ol className="ai-stage-list">
        {STAGES.map((stage) => (
          <li key={stage.key} data-state={stageState(stage.key, latest)}>
            <span className="ai-stage-list__node" aria-hidden="true" />
            <div>
              <strong>
                {stage.index} / {stage.label}
              </strong>
              <small>{stageDescription(stage.key, latest)}</small>
            </div>
          </li>
        ))}
      </ol>

      <div className="ai-operation-status" aria-live="polite">
        <span>当前操作</span>
        <strong>
          {state.status === 'loading'
            ? '正在读取任务状态'
            : state.status === 'error'
              ? '任务状态暂不可用'
              : (latest?.currentStep ?? '没有处理任务')}
        </strong>
        <p>
          {latest === undefined
            ? '当前没有处理任务。'
            : `${progress} · ${latest.proposals.length.toString()} 条 AI 建议`}
        </p>
        {latest !== undefined &&
        (latest.status === 'queued' || latest.status === 'running') ? (
          <button
            className="secondary-action"
            type="button"
            disabled={cancelling === latest.runId}
            onClick={() => void cancel()}
          >
            {cancelling === latest.runId ? '正在取消…' : '取消任务'}
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function stageState(
  stage: ProcessingStage,
  run: Readonly<ProcessingRunView> | undefined,
): 'waiting' | 'active' | 'complete' | 'failed' {
  if (run === undefined) return 'waiting';
  const order = STAGES.map((candidate) => candidate.key);
  const current = order.indexOf(run.currentStage);
  const candidate = order.indexOf(stage);
  if (candidate < current) return 'complete';
  if (candidate > current) return 'waiting';
  if (run.status === 'failed') return 'failed';
  return run.status === 'succeeded' ? 'complete' : 'active';
}

function stageDescription(
  stage: ProcessingStage,
  run: Readonly<ProcessingRunView> | undefined,
): string {
  const state = stageState(stage, run);
  if (state === 'complete') return '已完成';
  if (state === 'failed') return '失败';
  if (state === 'active') return run?.status === 'queued' ? '排队中' : '处理中';
  return '等待';
}

function progressLabel(run: Readonly<ProcessingRunView> | undefined): string {
  if (run === undefined) return '没有运行记录';
  if (run.totalUnits === undefined) {
    return `已完成 ${run.completedUnits.toString()} 项`;
  }
  const percent = Math.floor((run.completedUnits / run.totalUnits) * 100);
  return `${run.completedUnits.toString()} / ${run.totalUnits.toString()} · ${percent.toString()}%`;
}

function runStatusLabel(run: Readonly<ProcessingRunView>): string {
  switch (run.status) {
    case 'queued':
      return '排队中';
    case 'running':
      return run.origin === 'ai' ? 'AI 处理中' : '自动处理中';
    case 'succeeded':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
  }
}
