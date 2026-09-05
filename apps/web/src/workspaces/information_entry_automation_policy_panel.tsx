import type {ReactNode} from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';

import type {
  EntryAutomationExecutionView,
  EntryAutomationPolicy,
  EntryAutomationReason,
  EntryAutomationRoute,
  InformationEntryAutomationExecuteResponse,
  InformationEntryAutomationExecutionListResponse,
  InformationEntryAutomationExecutionResponse,
  InformationEntryAutomationPolicyResponse,
  InformationEntryAutomationPolicyWriteResponse,
  InformationEntryAutomationTrialResponse,
  M1cHttpResponse,
} from '../api/m1c_api_contract.js';
import {createLatestRequestTracker} from './latest_request.js';

type PolicyState =
  | Readonly<{status: 'loading'}>
  | Readonly<{
      status: 'ready';
      value: Extract<InformationEntryAutomationPolicyResponse, {status: 'ok'}>;
    }>
  | Readonly<{status: 'error'; message: string}>;

type TrialState =
  | Readonly<{status: 'idle'}>
  | Readonly<{status: 'loading'}>
  | Readonly<{
      status: 'ready';
      value: Extract<
        InformationEntryAutomationTrialResponse,
        {status: 'complete'}
      >;
      selectionKey: string;
    }>
  | Readonly<{status: 'error'; message: string}>;

type RunState =
  | Readonly<{status: 'loading'}>
  | Readonly<{status: 'ready'; values: readonly EntryAutomationExecutionView[]}>
  | Readonly<{status: 'error'; message: string}>;

export type EntryAutomationExecutionAuditState =
  | Readonly<{status: 'idle'}>
  | Readonly<{status: 'loading'; runId: string}>
  | Readonly<{status: 'ready'; value: Readonly<EntryAutomationExecutionView>}>
  | Readonly<{status: 'error'; runId: string; message: string}>;

interface DraftState {
  readonly baseRevision: number;
  readonly value: Readonly<EntryAutomationPolicy>;
}

export interface InformationEntryAutomationPolicyPanelProps {
  readonly enabled: boolean;
  readonly onLoad: () => Promise<
    M1cHttpResponse<InformationEntryAutomationPolicyResponse>
  >;
  readonly onSave: (
    body: Readonly<{
      expectedRevision: number;
      enabled: boolean;
      paused: boolean;
      profileRevision: number;
      minimumMatchedRuleCount: number;
      advanceThresholds: Readonly<EntryAutomationPolicy['advanceThresholds']>;
      deferThresholds: Readonly<EntryAutomationPolicy['deferThresholds']>;
      budgets: Readonly<EntryAutomationPolicy['budgets']>;
      advanceActions?: Readonly<
        NonNullable<EntryAutomationPolicy['advanceActions']>
      >;
      failureMode: 'pause';
    }>,
  ) => Promise<M1cHttpResponse<InformationEntryAutomationPolicyWriteResponse>>;
  readonly onTrial: (
    body: Readonly<{
      includePrivate: boolean;
      expectedPolicyRevision: number;
      expectedProfileRevision: number;
      policy: Readonly<EntryAutomationPolicy>;
      manualTakeoverEntryIds?: readonly string[];
    }>,
  ) => Promise<M1cHttpResponse<InformationEntryAutomationTrialResponse>>;
  readonly onExecute: (
    body: Readonly<{
      idempotencyKey: string;
      includePrivate: boolean;
      expectedPolicyRevision: number;
      expectedProfileRevision: number;
      expectedEntries: readonly Readonly<{
        entryId: string;
        revision: number;
      }>[];
      manualTakeoverEntryIds?: readonly string[];
    }>,
  ) => Promise<M1cHttpResponse<InformationEntryAutomationExecuteResponse>>;
  readonly onListRuns: (
    limit?: number,
  ) => Promise<
    M1cHttpResponse<InformationEntryAutomationExecutionListResponse>
  >;
  readonly onLoadRun: (
    runId: string,
  ) => Promise<M1cHttpResponse<InformationEntryAutomationExecutionResponse>>;
}

const ROUTE_LABELS: Readonly<Record<EntryAutomationRoute, string>> = {
  advance_candidate: '建议继续处理',
  manual_review: '人工审核',
  defer_candidate: '建议暂缓',
};

const REASON_LABELS: Readonly<Record<EntryAutomationReason, string>> = {
  advance_threshold_met: '达到推进阈值',
  defer_threshold_met: '达到暂缓阈值',
  threshold_not_met: '未达到阈值',
  insufficient_profile_evidence: '参考数据不足',
  mixed_signals: '有用与有趣信号冲突',
  manual_takeover: '用户人工接管',
  run_budget_exhausted: '本次条目预算已用完',
  advance_budget_exhausted: '继续处理数量已达上限',
  defer_budget_exhausted: '暂缓数量已达上限',
};

export function InformationEntryAutomationPolicyPanel({
  enabled,
  onExecute,
  onListRuns,
  onLoad,
  onLoadRun,
  onSave,
  onTrial,
}: InformationEntryAutomationPolicyPanelProps) {
  const [state, setState] = useState<PolicyState>({status: 'loading'});
  const [draftState, setDraftState] = useState<DraftState>();
  const [includePrivate, setIncludePrivate] = useState(false);
  const [manualTakeoverEntryIds, setManualTakeoverEntryIds] = useState<
    readonly string[]
  >([]);
  const [trial, setTrial] = useState<TrialState>({status: 'idle'});
  const [runs, setRuns] = useState<RunState>({status: 'loading'});
  const [runAudit, setRunAudit] = useState<EntryAutomationExecutionAuditState>({
    status: 'idle',
  });
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [message, setMessage] = useState<string>();
  const mounted = useRef(true);
  const policyRequests = useRef(createLatestRequestTracker());
  const saveRequests = useRef(createLatestRequestTracker());
  const trialRequests = useRef(createLatestRequestTracker());
  const executeRequests = useRef(createLatestRequestTracker());
  const runListRequests = useRef(createLatestRequestTracker());
  const runAuditRequests = useRef(createLatestRequestTracker());

  const loadControlState = useCallback(
    async (options: Readonly<{preserveMessage?: boolean}> = {}) => {
      const policyRequestId = policyRequests.current.begin();
      const runListRequestId = runListRequests.current.begin();
      trialRequests.current.invalidate();
      runAuditRequests.current.invalidate();
      setState({status: 'loading'});
      setRuns({status: 'loading'});
      setRunAudit({status: 'idle'});
      setTrial({status: 'idle'});
      setManualTakeoverEntryIds([]);
      if (options.preserveMessage !== true) setMessage(undefined);
      try {
        const [policyResult, runResult] = await Promise.allSettled([
          onLoad(),
          onListRuns(10),
        ]);
        if (
          mounted.current &&
          policyRequests.current.isCurrent(policyRequestId)
        ) {
          if (
            policyResult.status === 'fulfilled' &&
            policyResult.value.body.status === 'ok'
          ) {
            setState({status: 'ready', value: policyResult.value.body});
            setDraftState(undefined);
          } else {
            setState({
              status: 'error',
              message: '无法读取自动分流设置；条目和标签没有被修改。',
            });
          }
        }
        if (
          mounted.current &&
          runListRequests.current.isCurrent(runListRequestId)
        ) {
          if (
            runResult.status === 'fulfilled' &&
            runResult.value.body.status === 'ok'
          ) {
            setRuns({status: 'ready', values: runResult.value.body.executions});
          } else {
            setRuns({
              status: 'error',
              message: '暂时无法读取自动分流运行记录。',
            });
          }
        }
      } catch {
        if (
          mounted.current &&
          policyRequests.current.isCurrent(policyRequestId)
        ) {
          setState({
            status: 'error',
            message: '本地服务当前不可用，无法读取自动分流设置。',
          });
        }
        if (
          mounted.current &&
          runListRequests.current.isCurrent(runListRequestId)
        ) {
          setRuns({status: 'error', message: '无法读取自动分流运行记录。'});
        }
      }
    },
    [onListRuns, onLoad],
  );

  const reloadRuns = useCallback(async () => {
    const requestId = runListRequests.current.begin();
    runAuditRequests.current.invalidate();
    setRuns({status: 'loading'});
    setRunAudit({status: 'idle'});
    try {
      const response = await onListRuns(10);
      if (!mounted.current || !runListRequests.current.isCurrent(requestId)) {
        return;
      }
      setRuns(
        response.body.status === 'ok'
          ? {status: 'ready', values: response.body.executions}
          : {status: 'error', message: '无法读取自动分流运行记录。'},
      );
    } catch {
      if (!mounted.current || !runListRequests.current.isCurrent(requestId)) {
        return;
      }
      setRuns({status: 'error', message: '无法读取自动分流运行记录。'});
    }
  }, [onListRuns]);

  const loadRunAudit = useCallback(
    async (runId: string) => {
      const requestId = runAuditRequests.current.begin();
      setRunAudit({status: 'loading', runId});
      try {
        const response = await onLoadRun(runId);
        if (
          !mounted.current ||
          !runAuditRequests.current.isCurrent(requestId)
        ) {
          return;
        }
        setRunAudit(
          response.body.status === 'ok'
            ? {status: 'ready', value: response.body.execution}
            : {
                status: 'error',
                runId,
                message:
                  response.body.status === 'not_found'
                    ? '该运行已不存在或不属于当前工作区。'
                    : '无法读取这次运行的详细记录。',
              },
        );
      } catch {
        if (
          !mounted.current ||
          !runAuditRequests.current.isCurrent(requestId)
        ) {
          return;
        }
        setRunAudit({
          status: 'error',
          runId,
          message: '本地服务当前不可用，无法读取运行详情。',
        });
      }
    },
    [onLoadRun],
  );

  useEffect(() => {
    const policyRequestTracker = policyRequests.current;
    const saveRequestTracker = saveRequests.current;
    const trialRequestTracker = trialRequests.current;
    const executeRequestTracker = executeRequests.current;
    const runListRequestTracker = runListRequests.current;
    const runAuditRequestTracker = runAuditRequests.current;
    mounted.current = true;
    const scheduledLoad = enabled
      ? setTimeout(() => {
          void loadControlState();
        }, 0)
      : undefined;
    return () => {
      if (scheduledLoad !== undefined) clearTimeout(scheduledLoad);
      mounted.current = false;
      policyRequestTracker.invalidate();
      saveRequestTracker.invalidate();
      trialRequestTracker.invalidate();
      executeRequestTracker.invalidate();
      runListRequestTracker.invalidate();
      runAuditRequestTracker.invalidate();
    };
  }, [enabled, loadControlState]);

  if (!enabled) {
    return <UnavailableState />;
  }
  if (state.status === 'loading') {
    return <LoadingState />;
  }
  if (state.status === 'error') {
    return (
      <PanelFrame>
        <div
          className="error-state entry-automation-policy__state"
          role="alert"
        >
          <p>{state.message}</p>
          <button
            className="secondary-action"
            type="button"
            onClick={() => void loadControlState()}
          >
            重新读取
          </button>
        </div>
      </PanelFrame>
    );
  }

  const saved = state.value.policy;
  const profile = state.value.profile;
  const draft =
    draftState?.baseRevision === saved.revision ? draftState.value : saved;
  const dirty = !samePolicyValue(saved, draft);
  const selectionKey = manualTakeoverEntryIds.join(',');
  const trialCurrent =
    trial.status === 'ready' && trial.selectionKey === selectionKey;

  function replaceDraft(value: Readonly<EntryAutomationPolicy>) {
    trialRequests.current.invalidate();
    executeRequests.current.invalidate();
    setDraftState({baseRevision: saved.revision, value});
    setTrial({status: 'idle'});
    setMessage(undefined);
  }

  async function savePolicy() {
    const requestId = saveRequests.current.begin();
    policyRequests.current.invalidate();
    trialRequests.current.invalidate();
    executeRequests.current.invalidate();
    setSaving(true);
    setTrial({status: 'idle'});
    setMessage(undefined);
    try {
      const response = await onSave({
        expectedRevision: saved.revision,
        enabled: draft.enabled,
        paused: draft.paused,
        profileRevision: draft.profileRevision,
        minimumMatchedRuleCount: draft.minimumMatchedRuleCount,
        advanceThresholds: draft.advanceThresholds,
        deferThresholds: draft.deferThresholds,
        budgets: draft.budgets,
        advanceActions: actionSettings(draft),
        failureMode: 'pause',
      });
      if (!mounted.current || !saveRequests.current.isCurrent(requestId)) {
        return;
      }
      if (
        response.body.status === 'applied' ||
        response.body.status === 'unchanged'
      ) {
        setState({
          status: 'ready',
          value: {
            status: 'ok',
            policy: response.body.policy,
            profile: response.body.profile,
          },
        });
        setDraftState(undefined);
        setMessage(
          response.body.status === 'applied'
            ? '自动分流设置已保存。'
            : '自动分流设置没有变化。',
        );
      } else {
        const issue =
          'issue' in response.body
            ? response.body.issue
            : {code: 'entry_automation_policy_failed'};
        setMessage(
          issue.code === 'stale_entry_automation_policy_revision'
            ? '自动分流设置已在其他操作中更新，请重新读取。'
            : issue.code === 'stale_entry_preference_profile_revision'
              ? '偏好规则已经更新，请重新选择并保存。'
              : '设置保存失败；现有配置没有被修改。',
        );
      }
    } catch {
      if (!mounted.current || !saveRequests.current.isCurrent(requestId)) {
        return;
      }
      setMessage('本地服务当前不可用；设置没有保存。');
    } finally {
      if (mounted.current && saveRequests.current.isCurrent(requestId)) {
        setSaving(false);
      }
    }
  }

  async function runTrial() {
    const requestId = trialRequests.current.begin();
    setTrial({status: 'loading'});
    setMessage(undefined);
    try {
      const response = await onTrial({
        includePrivate,
        expectedPolicyRevision: saved.revision,
        expectedProfileRevision: profile.revision,
        policy: draft,
        ...(manualTakeoverEntryIds.length === 0
          ? {}
          : {manualTakeoverEntryIds}),
      });
      if (!mounted.current || !trialRequests.current.isCurrent(requestId)) {
        return;
      }
      if (response.body.status === 'complete') {
        setTrial({
          status: 'ready',
          value: response.body,
          selectionKey,
        });
        return;
      }
      setTrial({
        status: 'error',
        message:
          response.body.status === 'stale_policy' ||
          response.body.status === 'stale_profile' ||
          response.body.status === 'stale_entries'
            ? '设置、偏好或条目已变化，请重新读取后再试算。'
            : '试算失败；没有创建运行记录或修改条目。',
      });
    } catch {
      if (!mounted.current || !trialRequests.current.isCurrent(requestId)) {
        return;
      }
      setTrial({
        status: 'error',
        message: '本地服务当前不可用，未执行试算。',
      });
    }
  }

  async function startRun() {
    if (trial.status !== 'ready' || !trialCurrent || dirty) return;
    const idempotencyKey = createIdempotencyKey();
    const requestId = executeRequests.current.begin();
    policyRequests.current.invalidate();
    runListRequests.current.invalidate();
    runAuditRequests.current.invalidate();
    setRunAudit({status: 'idle'});
    setExecuting(true);
    setMessage(undefined);
    try {
      const response = await onExecute({
        idempotencyKey,
        includePrivate,
        expectedPolicyRevision: saved.revision,
        expectedProfileRevision: profile.revision,
        expectedEntries: trial.value.items.map((item) => ({
          entryId: item.entryId,
          revision: item.revision,
        })),
        ...(manualTakeoverEntryIds.length === 0
          ? {}
          : {manualTakeoverEntryIds}),
      });
      if (!mounted.current || !executeRequests.current.isCurrent(requestId)) {
        return;
      }
      if (response.body.status === 'succeeded') {
        setMessage(
          response.body.replayed
            ? '同一请求已执行过，已读取原运行记录。'
            : '分流记录已完成；条目、标签、联系和查询均未改变。',
        );
      } else if (response.body.status === 'failed') {
        setMessage(
          response.body.recoveryPending
            ? '运行失败且恢复仍待确认；自动分流已尽力暂停，请查看运行记录。'
            : '运行失败并已恢复；自动分流已暂停或被更新。',
        );
      } else if (response.body.status === 'not_ready') {
        setMessage(
          '当前设置暂时不能执行，请重新读取并检查启用、暂停和偏好规则。',
        );
      } else {
        setMessage('这次运行与已有记录冲突；没有创建新的分流记录。');
      }
      await loadControlState({preserveMessage: true});
    } catch {
      if (!mounted.current || !executeRequests.current.isCurrent(requestId)) {
        return;
      }
      setMessage('本地服务当前不可用；无法确认运行结果。');
    } finally {
      if (mounted.current && executeRequests.current.isCurrent(requestId)) {
        setExecuting(false);
      }
    }
  }

  return (
    <PanelFrame>
      <div className="entry-automation-policy__summary">
        <div>
          <span
            className="status-chip"
            data-tone={
              !draft.enabled ? 'muted' : draft.paused ? 'warning' : 'ready'
            }
          >
            {!draft.enabled ? '默认关闭' : draft.paused ? '已暂停' : '已启用'}
          </span>
          <span>{profile.ruleCount.toString()} 条偏好规则</span>
        </div>
        <button
          className="secondary-action"
          type="button"
          disabled={dirty || saving || executing || trial.status === 'loading'}
          onClick={() => void loadControlState()}
        >
          重新读取
        </button>
      </div>

      <PolicyEditor
        draft={draft}
        dirty={dirty}
        profile={profile}
        disabled={saving || executing}
        saving={saving}
        includePrivate={includePrivate}
        onIncludePrivateChange={(value) => {
          trialRequests.current.invalidate();
          executeRequests.current.invalidate();
          setIncludePrivate(value);
          setManualTakeoverEntryIds([]);
          setTrial({status: 'idle'});
        }}
        onChange={replaceDraft}
        onDiscard={() => {
          trialRequests.current.invalidate();
          executeRequests.current.invalidate();
          setDraftState(undefined);
          setTrial({status: 'idle'});
          setManualTakeoverEntryIds([]);
          setMessage(undefined);
        }}
        onSave={() => void savePolicy()}
      />

      {message === undefined ? null : (
        <p className="entry-automation-policy__message" aria-live="polite">
          {message}
        </p>
      )}

      <div className="entry-automation-policy__workbench">
        <section aria-labelledby="entry-automation-trial-title">
          <header>
            <div>
              <h3 id="entry-automation-trial-title">试算与人工处理</h3>
            </div>
            <button
              className="secondary-action"
              type="button"
              disabled={trial.status === 'loading' || saving || executing}
              onClick={() => void runTrial()}
            >
              {trial.status === 'loading' ? '正在试算…' : '重新试算'}
            </button>
          </header>
          <TrialResults
            state={trial}
            selectionCurrent={trialCurrent}
            manualTakeoverEntryIds={manualTakeoverEntryIds}
            onManualTakeoverChange={(entryId, checked) => {
              setManualTakeoverEntryIds((current) =>
                checked
                  ? [...current, entryId].sort()
                  : current.filter((candidate) => candidate !== entryId),
              );
            }}
          />
          <div className="entry-automation-run-action">
            <p>执行只记录处理去向，不会修改条目、标签、联系或搜索结果。</p>
            <button
              className="primary-action"
              type="button"
              disabled={
                executing ||
                saving ||
                dirty ||
                !trialCurrent ||
                trial.value.activation !== 'ready' ||
                trial.value.items.length === 0
              }
              onClick={() => void startRun()}
            >
              {executing ? '正在记录…' : '确认并记录本次分流'}
            </button>
          </div>
        </section>

        <section aria-labelledby="entry-automation-runs-title">
          <header>
            <div>
              <h3 id="entry-automation-runs-title">最近运行</h3>
            </div>
            <button
              className="secondary-action"
              type="button"
              disabled={runs.status === 'loading' || saving || executing}
              onClick={() => void reloadRuns()}
            >
              {runs.status === 'loading' ? '正在读取…' : '刷新记录'}
            </button>
          </header>
          <ExecutionResults
            state={runs}
            audit={runAudit}
            disabled={saving || executing}
            onLoadRun={(runId) => void loadRunAudit(runId)}
          />
        </section>
      </div>
    </PanelFrame>
  );
}

function PanelFrame({children}: {readonly children: ReactNode}) {
  return (
    <section
      className="entry-automation-policy"
      aria-labelledby="entry-automation-policy-title"
    >
      <header className="entry-automation-policy__heading">
        <div>
          <h2 id="entry-automation-policy-title">自动分流</h2>
          <p>
            按已保存的偏好把条目标为继续处理、人工审核或暂缓。可先试算，再确认执行。
          </p>
        </div>
      </header>
      {children}
    </section>
  );
}

function LoadingState() {
  return (
    <PanelFrame>
      <p className="entry-automation-policy__state" role="status">
        正在读取自动分流设置与运行记录…
      </p>
    </PanelFrame>
  );
}

function UnavailableState() {
  return (
    <PanelFrame>
      <p className="entry-automation-policy__state">
        当前服务未启用自动分流，仍可逐条编辑标签和评分。
      </p>
    </PanelFrame>
  );
}

function PolicyEditor({
  disabled,
  dirty,
  draft,
  includePrivate,
  onChange,
  onDiscard,
  onIncludePrivateChange,
  onSave,
  profile,
  saving,
}: {
  readonly disabled: boolean;
  readonly dirty: boolean;
  readonly draft: Readonly<EntryAutomationPolicy>;
  readonly includePrivate: boolean;
  readonly onChange: (value: Readonly<EntryAutomationPolicy>) => void;
  readonly onDiscard: () => void;
  readonly onIncludePrivateChange: (value: boolean) => void;
  readonly onSave: () => void;
  readonly profile: Readonly<
    Extract<InformationEntryAutomationPolicyResponse, {status: 'ok'}>['profile']
  >;
  readonly saving: boolean;
}) {
  return (
    <div className="entry-automation-policy__editor">
      <header>
        <div>
          <h3>分流设置</h3>
        </div>
        <span>{dirty ? '有未保存修改' : '与外部配置一致'}</span>
      </header>

      <div className="entry-automation-toggle-row">
        <ToggleField
          label="启用分流执行"
          checked={draft.enabled}
          disabled={disabled}
          onChange={(value) => {
            onChange({...draft, enabled: value});
          }}
        />
        <ToggleField
          label="暂停新运行"
          checked={draft.paused}
          disabled={disabled}
          onChange={(value) => {
            onChange({...draft, paused: value});
          }}
        />
        <ToggleField
          label="本次试算和运行包含隐私条目"
          checked={includePrivate}
          disabled={disabled}
          onChange={onIncludePrivateChange}
        />
      </div>

      <div
        className="entry-automation-toggle-row"
        aria-label="继续处理后的自动操作"
      >
        <ToggleField
          label="继续处理后生成自动标签"
          checked={actionSettings(draft).deterministicTags}
          disabled={disabled}
          onChange={(value) => {
            onChange({
              ...draft,
              advanceActions: {
                ...actionSettings(draft),
                deterministicTags: value,
              },
            });
          }}
        />
        <ToggleField
          label="标签处理后重建相似联系"
          checked={actionSettings(draft).rebuildAssociations}
          disabled={disabled}
          onChange={(value) => {
            onChange({
              ...draft,
              advanceActions: {
                ...actionSettings(draft),
                rebuildAssociations: value,
              },
            });
          }}
        />
        <p className="entry-automation-policy__action-note">
          两项默认关闭，只处理“建议继续处理”的条目。自动标签会遵守排除词与别名；更新联系不会覆盖人工设置和知识图谱关系。
        </p>
      </div>

      <div className="entry-automation-policy-grid">
        <IntegerField
          label="最少匹配规则数"
          value={draft.minimumMatchedRuleCount}
          min={1}
          max={64}
          disabled={disabled}
          onChange={(value) => {
            onChange({...draft, minimumMatchedRuleCount: value});
          }}
        />
        <IntegerField
          label="继续处理：最低有用评分"
          value={draft.advanceThresholds.usefulness}
          min={1}
          max={320}
          disabled={disabled}
          onChange={(value) => {
            onChange({
              ...draft,
              advanceThresholds: {
                ...draft.advanceThresholds,
                usefulness: value,
              },
            });
          }}
        />
        <IntegerField
          label="继续处理：最低有趣评分"
          value={draft.advanceThresholds.interest}
          min={1}
          max={320}
          disabled={disabled}
          onChange={(value) => {
            onChange({
              ...draft,
              advanceThresholds: {
                ...draft.advanceThresholds,
                interest: value,
              },
            });
          }}
        />
        <DimensionField
          label="推进需满足维度"
          value={draft.advanceThresholds.requiredDimensions}
          disabled={disabled}
          onChange={(value) => {
            onChange({
              ...draft,
              advanceThresholds: {
                ...draft.advanceThresholds,
                requiredDimensions: value,
              },
            });
          }}
        />
        <IntegerField
          label="暂缓：最高有用评分"
          value={draft.deferThresholds.usefulness}
          min={1}
          max={320}
          disabled={disabled}
          onChange={(value) => {
            onChange({
              ...draft,
              deferThresholds: {
                ...draft.deferThresholds,
                usefulness: value,
              },
            });
          }}
        />
        <IntegerField
          label="暂缓：最高有趣评分"
          value={draft.deferThresholds.interest}
          min={1}
          max={320}
          disabled={disabled}
          onChange={(value) => {
            onChange({
              ...draft,
              deferThresholds: {
                ...draft.deferThresholds,
                interest: value,
              },
            });
          }}
        />
        <DimensionField
          label="暂缓需满足维度"
          value={draft.deferThresholds.requiredDimensions}
          disabled={disabled}
          onChange={(value) => {
            onChange({
              ...draft,
              deferThresholds: {
                ...draft.deferThresholds,
                requiredDimensions: value,
              },
            });
          }}
        />
        <IntegerField
          label="每次最多检查"
          value={draft.budgets.maximumEntriesPerRun}
          min={1}
          max={100}
          disabled={disabled}
          onChange={(value) => {
            onChange({
              ...draft,
              budgets: {
                maximumEntriesPerRun: value,
                maximumAdvanceCandidatesPerRun: Math.min(
                  value,
                  draft.budgets.maximumAdvanceCandidatesPerRun,
                ),
                maximumDeferCandidatesPerRun: Math.min(
                  value,
                  draft.budgets.maximumDeferCandidatesPerRun,
                ),
              },
            });
          }}
        />
        <IntegerField
          label="继续处理上限"
          value={draft.budgets.maximumAdvanceCandidatesPerRun}
          min={0}
          max={draft.budgets.maximumEntriesPerRun}
          disabled={disabled}
          onChange={(value) => {
            onChange({
              ...draft,
              budgets: {
                ...draft.budgets,
                maximumAdvanceCandidatesPerRun: value,
              },
            });
          }}
        />
        <IntegerField
          label="暂缓上限"
          value={draft.budgets.maximumDeferCandidatesPerRun}
          min={0}
          max={draft.budgets.maximumEntriesPerRun}
          disabled={disabled}
          onChange={(value) => {
            onChange({
              ...draft,
              budgets: {
                ...draft.budgets,
                maximumDeferCandidatesPerRun: value,
              },
            });
          }}
        />
      </div>

      <div className="entry-automation-profile-binding">
        <div>
          <strong>使用的偏好规则</strong>
          <span>当前偏好规则{profile.enabled ? '已启用' : '未启用'}</span>
        </div>
        <button
          className="secondary-action"
          type="button"
          disabled={disabled || draft.profileRevision === profile.revision}
          onClick={() => {
            onChange({...draft, profileRevision: profile.revision});
          }}
        >
          使用当前偏好规则
        </button>
      </div>

      <div className="entry-automation-policy__actions">
        <button
          className="secondary-action"
          type="button"
          disabled={disabled}
          onClick={onDiscard}
        >
          放弃草稿
        </button>
        <button
          className="primary-action"
          type="button"
          disabled={disabled || !dirty}
          onClick={onSave}
        >
          {saving ? '正在保存…' : '保存分流设置'}
        </button>
      </div>
    </div>
  );
}

function ToggleField({
  checked,
  disabled,
  label,
  onChange,
}: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <label>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
      />
      {label}
    </label>
  );
}

function IntegerField({
  disabled,
  label,
  max,
  min,
  onChange,
  value,
}: {
  readonly disabled: boolean;
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly onChange: (value: number) => void;
  readonly value: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isSafeInteger(next) && next >= min && next <= max) {
            onChange(next);
          }
        }}
      />
    </label>
  );
}

function DimensionField({
  disabled,
  label,
  onChange,
  value,
}: {
  readonly disabled: boolean;
  readonly label: string;
  readonly onChange: (value: 1 | 2) => void;
  readonly value: 1 | 2;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.currentTarget.value === '2' ? 2 : 1);
        }}
      >
        <option value="1">任一维度</option>
        <option value="2">两个维度</option>
      </select>
    </label>
  );
}

function TrialResults({
  manualTakeoverEntryIds,
  onManualTakeoverChange,
  selectionCurrent,
  state,
}: {
  readonly manualTakeoverEntryIds: readonly string[];
  readonly onManualTakeoverChange: (entryId: string, checked: boolean) => void;
  readonly selectionCurrent: boolean;
  readonly state: TrialState;
}) {
  if (state.status === 'idle') {
    return (
      <p className="entry-automation-policy__empty">
        尚未试算。草稿可直接试算；执行前必须先保存并再次试算。
      </p>
    );
  }
  if (state.status === 'loading') {
    return <p role="status">正在读取当前条目并计算处理去向…</p>;
  }
  if (state.status === 'error') {
    return <p role="alert">{state.message}</p>;
  }
  return (
    <>
      <div className="entry-automation-trial-summary">
        <span
          className="status-chip"
          data-tone={state.value.activation === 'ready' ? 'ready' : 'warning'}
        >
          {activationLabel(state.value.activation)}
        </span>
        <span>
          {state.value.evaluatedEntryCount.toString()} /
          {state.value.visibleEntryCount.toString()} 条已试算
        </span>
        <span>
          推进 {state.value.counts.advance_candidate.toString()} · 人工{' '}
          {state.value.counts.manual_review.toString()} · 暂缓{' '}
          {state.value.counts.defer_candidate.toString()}
        </span>
        {!selectionCurrent ? (
          <strong>人工处理选择已变化，需要重新试算</strong>
        ) : null}
      </div>
      {state.value.items.length === 0 ? (
        <p className="entry-automation-policy__empty">当前范围没有条目。</p>
      ) : (
        <div
          className="entry-automation-table"
          tabIndex={0}
          aria-label="自动分流试算结果"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">条目</th>
                <th scope="col">分流</th>
                <th scope="col">依据</th>
                <th scope="col">总分</th>
                <th scope="col">改为人工处理</th>
              </tr>
            </thead>
            <tbody>
              {state.value.items.map((item) => (
                <tr key={item.entryId}>
                  <td>
                    <code>{shortId(item.entryId)}</code>
                  </td>
                  <td>{ROUTE_LABELS[item.route]}</td>
                  <td>{REASON_LABELS[item.reason]}</td>
                  <td>
                    有用 {item.totals.usefulness.toString()} / 有趣{' '}
                    {item.totals.interest.toString()}
                  </td>
                  <td>
                    <label>
                      <input
                        type="checkbox"
                        checked={manualTakeoverEntryIds.includes(item.entryId)}
                        onChange={(event) => {
                          onManualTakeoverChange(
                            item.entryId,
                            event.currentTarget.checked,
                          );
                        }}
                      />
                      转人工
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ExecutionResults({
  audit,
  disabled,
  onLoadRun,
  state,
}: Readonly<{
  state: RunState;
  audit: EntryAutomationExecutionAuditState;
  disabled: boolean;
  onLoadRun: (runId: string) => void;
}>) {
  if (state.status === 'loading') {
    return <p role="status">正在读取最近运行…</p>;
  }
  if (state.status === 'error') return <p role="alert">{state.message}</p>;
  if (state.values.length === 0) {
    return (
      <p className="entry-automation-policy__empty">
        暂无自动分流运行。试算不会出现在这里。
      </p>
    );
  }
  return (
    <>
      <ol className="entry-automation-run-list">
        {state.values.map((execution) => (
          <li key={execution.runId}>
            <div className="entry-automation-run-summary">
              <div>
                <span
                  className="status-chip"
                  data-tone={
                    execution.status === 'succeeded'
                      ? 'ready'
                      : execution.status === 'failed'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {executionStatusLabel(execution.status)}
                </span>
                <code>{shortId(execution.runId)}</code>
                <span>{execution.claims.length.toString()} 条分流记录</span>
              </div>
              <p>{execution.includePrivate ? '包含隐私范围' : '仅公开范围'}</p>
              <button
                className="secondary-action"
                type="button"
                disabled={
                  disabled ||
                  (audit.status === 'loading' &&
                    audit.runId === execution.runId)
                }
                aria-label={`读取运行 ${shortId(execution.runId)} 的详情`}
                onClick={() => {
                  onLoadRun(execution.runId);
                }}
              >
                {audit.status === 'loading' && audit.runId === execution.runId
                  ? '正在读取…'
                  : '查看详情'}
              </button>
            </div>
          </li>
        ))}
      </ol>
      <InformationEntryAutomationExecutionAudit
        state={audit}
        onRetry={onLoadRun}
      />
    </>
  );
}

export function InformationEntryAutomationExecutionAudit({
  onRetry,
  state,
}: Readonly<{
  state: EntryAutomationExecutionAuditState;
  onRetry: (runId: string) => void;
}>) {
  if (state.status === 'idle') {
    return (
      <p className="entry-automation-policy__empty">
        选择一条运行查看详细记录。
      </p>
    );
  }
  if (state.status === 'loading') {
    return (
      <p className="entry-automation-policy__empty" role="status">
        正在读取运行 {shortId(state.runId)} 的详情…
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <div
        className="error-state entry-automation-run-audit__error"
        role="alert"
      >
        <p>{state.message}</p>
        <button
          className="secondary-action"
          type="button"
          onClick={() => {
            onRetry(state.runId);
          }}
        >
          重试
        </button>
      </div>
    );
  }

  const execution = state.value;
  return (
    <section
      className="entry-automation-run-audit"
      aria-labelledby="entry-automation-run-audit-title"
      aria-live="polite"
    >
      <header>
        <div>
          <h4 id="entry-automation-run-audit-title">运行详情</h4>
        </div>
        <span
          className="status-chip"
          data-tone={
            execution.status === 'succeeded'
              ? 'ready'
              : execution.status === 'failed'
                ? 'danger'
                : 'warning'
          }
        >
          {executionStatusLabel(execution.status)}
        </span>
      </header>
      <dl className="entry-automation-run-audit__metadata">
        <div>
          <dt>运行编号</dt>
          <dd>{execution.runId}</dd>
        </div>
        <div>
          <dt>隐私范围</dt>
          <dd>{execution.includePrivate ? '本次包含隐私' : '仅公开条目'}</dd>
        </div>
      </dl>
      <p className="entry-automation-run-audit__safety">
        {executionSafetyLabel(execution)}
      </p>
      {execution.errorCode === undefined ? null : (
        <p className="entry-automation-run-audit__error-code" role="alert">
          运行错误代码：<code>{execution.errorCode}</code>
        </p>
      )}
      <div
        className="entry-automation-run-audit__claims"
        tabIndex={0}
        aria-label="运行分流记录"
      >
        <table>
          <thead>
            <tr>
              <th scope="col">序号 / 条目</th>
              <th scope="col">去向</th>
              <th scope="col">原因</th>
              <th scope="col">状态</th>
              <th scope="col">时间 / 错误</th>
            </tr>
          </thead>
          <tbody>
            {execution.claims.map((claim) => (
              <tr key={claim.ordinal}>
                <td>
                  <strong>{claim.ordinal.toString()}</strong>
                  <code>{shortId(claim.entryId)}</code>
                </td>
                <td>{ROUTE_LABELS[claim.route]}</td>
                <td>{REASON_LABELS[claim.reason]}</td>
                <td>{claimStatusLabel(claim.status)}</td>
                <td>
                  <time dateTime={claim.createdAt}>{claim.createdAt}</time>
                  {claim.finishedAt === undefined ? null : (
                    <time dateTime={claim.finishedAt}>{claim.finishedAt}</time>
                  )}
                  {claim.errorCode === undefined ? null : (
                    <code>{claim.errorCode}</code>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function executionSafetyLabel(
  execution: Readonly<EntryAutomationExecutionView>,
): string {
  const openClaimCount = execution.claims.filter(
    (claim) => claim.status === 'claimed',
  ).length;
  if (openClaimCount > 0) {
    return `仍有 ${openClaimCount.toString()} 条分流记录没有完成；请稍后重新读取。条目、标签、联系和知识图谱均未改变。`;
  }
  switch (execution.status) {
    case 'succeeded':
      return '全部分流记录均已完成；这次运行只记录处理去向，没有修改条目内容。';
    case 'failed':
      return '失败记录已保留；现有条目与人工编辑保持不变。';
    case 'cancelled':
      return '运行已取消；已保存的分流记录仍可查看，条目内容没有改变。';
    case 'queued':
    case 'running':
      return '运行尚未结束；这里只显示已经保存的状态。';
  }
}

function activationLabel(
  activation:
    | 'disabled'
    | 'paused'
    | 'profile_disabled'
    | 'profile_revision_mismatch'
    | 'ready',
): string {
  switch (activation) {
    case 'ready':
      return '可执行';
    case 'disabled':
      return '自动分流未启用';
    case 'paused':
      return '自动分流已暂停';
    case 'profile_disabled':
      return '偏好规则未启用';
    case 'profile_revision_mismatch':
      return '偏好规则已在别处更新';
  }
}

function executionStatusLabel(
  status: EntryAutomationExecutionView['status'],
): string {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'running':
      return '执行中';
    case 'succeeded':
      return '已完成';
    case 'failed':
      return '失败，已恢复';
    case 'cancelled':
      return '已取消';
  }
}

function claimStatusLabel(
  status: EntryAutomationExecutionView['claims'][number]['status'],
): string {
  switch (status) {
    case 'claimed':
      return '待完成';
    case 'completed':
      return '已记录';
    case 'compensated':
      return '已恢复';
  }
}

function samePolicyValue(
  left: Readonly<EntryAutomationPolicy>,
  right: Readonly<EntryAutomationPolicy>,
): boolean {
  return (
    left.enabled === right.enabled &&
    left.paused === right.paused &&
    left.profileRevision === right.profileRevision &&
    left.minimumMatchedRuleCount === right.minimumMatchedRuleCount &&
    left.advanceThresholds.usefulness === right.advanceThresholds.usefulness &&
    left.advanceThresholds.interest === right.advanceThresholds.interest &&
    left.advanceThresholds.requiredDimensions ===
      right.advanceThresholds.requiredDimensions &&
    left.deferThresholds.usefulness === right.deferThresholds.usefulness &&
    left.deferThresholds.interest === right.deferThresholds.interest &&
    left.deferThresholds.requiredDimensions ===
      right.deferThresholds.requiredDimensions &&
    left.budgets.maximumEntriesPerRun === right.budgets.maximumEntriesPerRun &&
    left.budgets.maximumAdvanceCandidatesPerRun ===
      right.budgets.maximumAdvanceCandidatesPerRun &&
    left.budgets.maximumDeferCandidatesPerRun ===
      right.budgets.maximumDeferCandidatesPerRun &&
    actionSettings(left).deterministicTags ===
      actionSettings(right).deterministicTags &&
    actionSettings(left).rebuildAssociations ===
      actionSettings(right).rebuildAssociations
  );
}

function actionSettings(
  policy: Readonly<EntryAutomationPolicy>,
): Readonly<{deterministicTags: boolean; rebuildAssociations: boolean}> {
  return (
    policy.advanceActions ??
    Object.freeze({deterministicTags: false, rebuildAssociations: false})
  );
}

function createIdempotencyKey(): string {
  return `entry-automation:${globalThis.crypto.randomUUID()}`;
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}
