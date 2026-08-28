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
  advance_candidate: '可推进候选',
  manual_review: '人工审核',
  defer_candidate: '暂缓候选',
};

const REASON_LABELS: Readonly<Record<EntryAutomationReason, string>> = {
  advance_threshold_met: '达到推进阈值',
  defer_threshold_met: '达到暂缓阈值',
  threshold_not_met: '未达到阈值',
  insufficient_profile_evidence: '偏好证据不足',
  mixed_signals: '有用与有趣信号冲突',
  manual_takeover: '用户人工接管',
  run_budget_exhausted: '本次条目预算已用完',
  advance_budget_exhausted: '推进候选预算已用完',
  defer_budget_exhausted: '暂缓候选预算已用完',
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
              message: '无法读取自动分流设置；Entry 与标签数据没有被修改。',
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
                    : '无法读取该运行的完整审计记录。',
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
          message: '本地服务当前不可用，无法读取完整运行审计。',
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
            ? '自动分流策略已保存到外部个人配置。'
            : '自动分流策略没有变化。',
        );
      } else {
        const issue =
          'issue' in response.body
            ? response.body.issue
            : {code: 'entry_automation_policy_failed'};
        setMessage(
          issue.code === 'stale_entry_automation_policy_revision'
            ? '策略已在其他操作中更新，请重新读取。'
            : issue.code === 'stale_entry_preference_profile_revision'
              ? '偏好规则版本已变化，请重新绑定并保存策略。'
              : '策略保存失败；现有配置没有被修改。',
        );
      }
    } catch {
      if (!mounted.current || !saveRequests.current.isCurrent(requestId)) {
        return;
      }
      setMessage('本地服务当前不可用；策略没有保存。');
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
            ? '策略、偏好或 Entry 已变化，请重新读取后再试算。'
            : '试算失败；没有创建运行记录或修改 Entry。',
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
            : '分流记录已完成；Entry、标签、联系和查询均未被改写。',
        );
      } else if (response.body.status === 'failed') {
        setMessage(
          response.body.recoveryPending
            ? '运行失败且恢复仍待确认；策略已尽力暂停，请查看运行记录。'
            : '运行失败并已补偿；策略已暂停或被更新。',
        );
      } else if (response.body.status === 'not_ready') {
        setMessage(
          '当前策略未处于可执行状态，请重新读取并检查启用、暂停和版本绑定。',
        );
      } else {
        setMessage('本次运行标识发生冲突；没有创建新的分流记录。');
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
          <span>策略修订 {saved.revision.toString()}</span>
          <span>绑定偏好修订 {draft.profileRevision.toString()}</span>
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
              <p className="section-index">PLAN / READ ONLY</p>
              <h3 id="entry-automation-trial-title">试算与人工接管</h3>
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
            <p>
              执行只保存本次分流事实；不会自动修改
              Entry、标签、联系、知识图谱或查询排序。
            </p>
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
              <p className="section-index">AUDIT / RECOVERY</p>
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
          <p className="section-index">SECONDARY / AUTOMATION AUTHORITY</p>
          <h2 id="entry-automation-policy-title">可恢复自动分流</h2>
          <p>
            基于已保存偏好把当前 Entry
            记录为“可推进、人工审核或暂缓”候选。默认关闭；用户可先试算、逐项人工接管，再显式启动。
          </p>
        </div>
        <span className="status-chip" data-tone="muted">
          只记录去向
        </span>
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
        当前运行时未提供可恢复自动分流边界。标签、评分和偏好规则仍可照常使用。
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
          <p className="section-index">AUTHORITY / POLICY</p>
          <h3>分流权限与阈值</h3>
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
          label="本次试算与运行包含隐私 Entry"
          checked={includePrivate}
          disabled={disabled}
          onChange={onIncludePrivateChange}
        />
      </div>

      <div
        className="entry-automation-toggle-row"
        aria-label="推进候选自动动作"
      >
        <ToggleField
          label="推进候选后生成确定性标签"
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
          两项默认关闭，仅作用于“建议继续处理”。确定性标签遵守排除词与别名；联系重建不覆盖人工联系和知识图谱边。
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
          label="推进 · 有用阈值"
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
          label="推进 · 有趣阈值"
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
          label="暂缓 · 有用阈值"
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
          label="暂缓 · 有趣阈值"
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
          label="推进候选上限"
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
          label="暂缓候选上限"
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
          <strong>偏好版本绑定</strong>
          <span>
            当前偏好修订 {profile.revision.toString()} ·
            {profile.enabled ? ' 已启用' : ' 未启用'}
          </span>
        </div>
        <button
          className="secondary-action"
          type="button"
          disabled={disabled || draft.profileRevision === profile.revision}
          onClick={() => {
            onChange({...draft, profileRevision: profile.revision});
          }}
        >
          绑定当前偏好版本
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
          {saving ? '正在保存…' : '保存分流策略'}
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
        尚未试算。草稿可直接试算；正式运行前必须先保存并再次试算。
      </p>
    );
  }
  if (state.status === 'loading') {
    return <p role="status">正在读取当前 Entry 并计算候选去向…</p>;
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
          <strong>人工接管已变化，需要重新试算</strong>
        ) : null}
      </div>
      {state.value.items.length === 0 ? (
        <p className="entry-automation-policy__empty">当前范围没有 Entry。</p>
      ) : (
        <div
          className="entry-automation-table"
          tabIndex={0}
          aria-label="自动分流试算结果"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Entry</th>
                <th scope="col">分流</th>
                <th scope="col">依据</th>
                <th scope="col">总分</th>
                <th scope="col">人工接管</th>
              </tr>
            </thead>
            <tbody>
              {state.value.items.map((item) => (
                <tr key={item.entryId}>
                  <td>
                    <code>{shortId(item.entryId)}</code>
                    <span>修订 {item.revision.toString()}</span>
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
                <span>{execution.claims.length.toString()} 条分流事实</span>
              </div>
              <p>
                策略修订 {execution.policyRevision.toString()} · 偏好修订{' '}
                {execution.profileRevision.toString()} ·
                {execution.includePrivate ? ' 包含隐私范围' : ' 仅公开范围'}
              </p>
              <button
                className="secondary-action"
                type="button"
                disabled={
                  disabled ||
                  (audit.status === 'loading' &&
                    audit.runId === execution.runId)
                }
                aria-label={`读取运行 ${shortId(execution.runId)} 的完整审计`}
                onClick={() => {
                  onLoadRun(execution.runId);
                }}
              >
                {audit.status === 'loading' && audit.runId === execution.runId
                  ? '正在读取…'
                  : '读取完整审计'}
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
        选择一条运行读取完整审计。列表摘要不会代替精确运行读取。
      </p>
    );
  }
  if (state.status === 'loading') {
    return (
      <p className="entry-automation-policy__empty" role="status">
        正在读取运行 {shortId(state.runId)} 的完整审计…
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
          重试完整审计
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
          <p className="section-index">EXACT RUN / OWNER AUDIT</p>
          <h4 id="entry-automation-run-audit-title">完整运行审计</h4>
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
          <dt>运行</dt>
          <dd>
            <code>{execution.runId}</code>
          </dd>
        </div>
        <div>
          <dt>运行版本</dt>
          <dd>{execution.version.toString()}</dd>
        </div>
        <div>
          <dt>策略 / 偏好</dt>
          <dd>
            {execution.policyRevision.toString()} /{' '}
            {execution.profileRevision.toString()}
          </dd>
        </div>
        <div>
          <dt>隐私范围</dt>
          <dd>{execution.includePrivate ? '本次包含隐私' : '仅公开 Entry'}</dd>
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
        aria-label="运行分流事实"
      >
        <table>
          <thead>
            <tr>
              <th scope="col">序号 / Entry</th>
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
                  <span>Entry 修订 {claim.entryRevision.toString()}</span>
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
    return `仍有 ${openClaimCount.toString()} 条分流事实没有结算；保留审计记录并稍后重新读取。Entry、标签、联系和知识图谱均未被本运行改写。`;
  }
  switch (execution.status) {
    case 'succeeded':
      return '全部分流事实已经结算；本运行只记录去向，没有改写任何业务内容。';
    case 'failed':
      return '失败已经留痕，开放分流事实已补偿；现有 Entry 与人工编辑保持不变。';
    case 'cancelled':
      return '运行已取消；已保存的审计事实仍可检查，业务内容没有被改写。';
    case 'queued':
    case 'running':
      return '运行尚未结束；当前页面只显示持久化审计状态，不推断未提交结果。';
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
      return '策略未启用';
    case 'paused':
      return '策略已暂停';
    case 'profile_disabled':
      return '偏好规则未启用';
    case 'profile_revision_mismatch':
      return '偏好版本未绑定';
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
      return '已失败并补偿';
    case 'cancelled':
      return '已取消';
  }
}

function claimStatusLabel(
  status: EntryAutomationExecutionView['claims'][number]['status'],
): string {
  switch (status) {
    case 'claimed':
      return '待结算';
    case 'completed':
      return '已记录';
    case 'compensated':
      return '已补偿';
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
