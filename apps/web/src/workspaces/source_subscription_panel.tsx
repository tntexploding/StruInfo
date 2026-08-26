import {useCallback, useEffect, useMemo, useState} from 'react';

import type {
  M1cHttpResponse,
  SourceSubscriptionListResponse,
  SourceSubscriptionReplaceResponse,
  SourceSubscriptionRunResponse,
  SourceSubscriptionView,
  SourceSubscriptionWrite,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import {
  createClientUuid,
  createCommandKey,
} from '../components/client_identity.js';
import type {ActionFeedback} from '../components/product_types.js';

type SubscriptionPanelState =
  | Readonly<{status: 'loading'}>
  | Readonly<{status: 'error'; message: string}>
  | Readonly<{
      status: 'ready';
      revision: number;
      saved: readonly Readonly<SourceSubscriptionView>[];
      drafts: readonly Readonly<SourceSubscriptionWrite>[];
    }>;

export interface SourceSubscriptionPanelProps {
  readonly enabled: boolean;
  readonly onList: () => Promise<
    M1cHttpResponse<SourceSubscriptionListResponse>
  >;
  readonly onReplace: (
    expectedRevision: number,
    subscriptions: readonly Readonly<SourceSubscriptionWrite>[],
  ) => Promise<M1cHttpResponse<SourceSubscriptionReplaceResponse>>;
  readonly onRun: (
    subscriptionId: string,
    requestKey: string,
  ) => Promise<M1cHttpResponse<SourceSubscriptionRunResponse>>;
}

export function SourceSubscriptionPanel({
  enabled,
  onList,
  onReplace,
  onRun,
}: SourceSubscriptionPanelProps) {
  const [state, setState] = useState<SubscriptionPanelState>({
    status: 'loading',
  });
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string>();

  const load = useCallback(async () => {
    if (!enabled) return;
    setState({status: 'loading'});
    try {
      const response = await onList();
      if (response.body.status !== 'ok') {
        setState({
          status: 'error',
          message: '外部个人配置当前不可读；没有改变任何订阅。',
        });
        return;
      }
      setState({
        status: 'ready',
        revision: response.body.revision,
        saved: response.body.subscriptions,
        drafts: Object.freeze(response.body.subscriptions.map(toWrite)),
      });
    } catch {
      setState({
        status: 'error',
        message: '本地服务当前不可达；订阅没有被修改。',
      });
    }
  }, [enabled, onList]);

  useEffect(() => {
    if (!enabled) return;
    void Promise.resolve().then(load);
  }, [enabled, load]);

  const dirty = useMemo(
    () =>
      state.status === 'ready' &&
      JSON.stringify(state.drafts) !== JSON.stringify(state.saved.map(toWrite)),
    [state],
  );

  if (!enabled) {
    return (
      <section
        className="source-subscription-panel"
        aria-labelledby="source-subscription-title"
      >
        <PanelHeading />
        <p className="empty-copy" role="status">
          当前服务未启用信源订阅边界。仍可使用上方的手动文本、固定 Git
          文件或本地文件导入。
        </p>
      </section>
    );
  }

  function updateDraft(
    subscriptionId: string,
    change: Partial<SourceSubscriptionWrite>,
  ) {
    setState((current) =>
      current.status !== 'ready'
        ? current
        : {
            ...current,
            drafts: Object.freeze(
              current.drafts.map((subscription) =>
                subscription.subscriptionId === subscriptionId
                  ? Object.freeze({...subscription, ...change})
                  : subscription,
              ),
            ),
          },
    );
    setFeedback(undefined);
  }

  function addSubscription() {
    setState((current) =>
      current.status !== 'ready' || current.drafts.length >= 32
        ? current
        : {
            ...current,
            drafts: Object.freeze([
              ...current.drafts,
              Object.freeze({
                subscriptionId: createClientUuid(),
                label: '',
                enabled: false,
                repositoryUri: '',
                repositoryRef: 'main',
                repositoryPath: '',
                profile: 'commonmark-v1' as const,
                sourceAlias: '',
                isPrivate: false,
                routeAfterImport: false,
                intervalMinutes: 1_440,
              }),
            ]),
          },
    );
    setFeedback(undefined);
  }

  function removeSubscription(subscriptionId: string) {
    setState((current) =>
      current.status !== 'ready'
        ? current
        : {
            ...current,
            drafts: Object.freeze(
              current.drafts.filter(
                (subscription) =>
                  subscription.subscriptionId !== subscriptionId,
              ),
            ),
          },
    );
    setFeedback(undefined);
  }

  async function saveSubscriptions() {
    if (
      state.status !== 'ready' ||
      saving ||
      !draftsAreComplete(state.drafts)
    ) {
      return;
    }
    setSaving(true);
    setFeedback(undefined);
    try {
      const response = await onReplace(state.revision, state.drafts);
      if ('issue' in response.body) {
        setFeedback({
          kind: 'error',
          title: '订阅未保存',
          detail:
            response.body.issue.code === 'source_subscription_stale'
              ? '配置已在其他操作中改变，请重新加载后再编辑。'
              : '请检查仓库、文件路径、显示名称和检查间隔。',
        });
        return;
      }
      setState({
        status: 'ready',
        revision: response.body.revision,
        saved: response.body.subscriptions,
        drafts: Object.freeze(response.body.subscriptions.map(toWrite)),
      });
      setFeedback({
        kind: 'success',
        title: response.body.status === 'applied' ? '订阅已保存' : '配置未变化',
        detail:
          '设置保存在外部个人配置中。只有开启“定期检查”的订阅会被调度器轮询。',
      });
    } catch {
      setFeedback({
        kind: 'error',
        title: '订阅未保存',
        detail: '本地服务当前不可达；外部个人配置保持不变。',
      });
    } finally {
      setSaving(false);
    }
  }

  async function runSubscription(subscriptionId: string) {
    if (state.status !== 'ready' || runningId !== undefined || dirty) return;
    setRunningId(subscriptionId);
    setFeedback(undefined);
    try {
      const response = await onRun(
        subscriptionId,
        createCommandKey('source-check'),
      );
      if ('issue' in response.body) {
        setFeedback({
          kind: 'error',
          title: '本次检查未完成',
          detail: sourceRunIssue(response.body.issue.code),
        });
        return;
      }
      setFeedback({
        kind: 'success',
        title:
          response.body.status === 'imported'
            ? '发现变化并已导入'
            : response.body.status === 'unchanged'
              ? '来源没有内容变化'
              : '相同检查已执行',
        detail:
          response.body.status === 'imported'
            ? response.body.automationRunId === undefined
              ? '新的不可变 Snapshot 已进入导入历史；后续拆分与标签步骤仍由你单独决定。'
              : `已确定性拆分 ${String(response.body.materializedEntryCount ?? 0)} 个 Entry，并生成可在“标签”页处理的分流工作项。`
            : '没有创建重复 Snapshot。',
      });
      await load();
    } catch {
      setFeedback({
        kind: 'error',
        title: '本次检查未完成',
        detail: '本地接口或远端 Git 来源当前不可达；现有数据保持不变。',
      });
    } finally {
      setRunningId(undefined);
    }
  }

  return (
    <section
      className="source-subscription-panel"
      aria-labelledby="source-subscription-title"
    >
      <PanelHeading />
      {state.status === 'loading' ? (
        <p className="empty-copy" role="status">
          正在读取外部订阅配置…
        </p>
      ) : null}
      {state.status === 'error' ? (
        <div className="source-subscription-panel__error" role="alert">
          <p>{state.message}</p>
          <button
            className="secondary-action"
            type="button"
            onClick={() => {
              void load();
            }}
          >
            重新读取
          </button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <div className="source-subscription-toolbar">
            <p>
              精确支持 GitHub 仓库中的单个 Markdown 文件。手动检查始终可用；
              定期检查默认关闭。
            </p>
            <button
              className="secondary-action"
              type="button"
              disabled={state.drafts.length >= 32}
              onClick={addSubscription}
            >
              新增订阅
            </button>
          </div>
          {state.drafts.length === 0 ? (
            <p className="empty-copy">
              尚无订阅。新增后先保存，再执行一次手动检查。
            </p>
          ) : (
            <ol className="source-subscription-list">
              {state.drafts.map((subscription, index) => {
                const saved = state.saved.find(
                  (candidate) =>
                    candidate.subscriptionId === subscription.subscriptionId,
                );
                return (
                  <li key={subscription.subscriptionId}>
                    <header>
                      <div>
                        <p className="section-index">
                          SOURCE {String(index + 1).padStart(2, '0')}
                        </p>
                        <h3>{subscription.label.trim() || '未命名信源'}</h3>
                      </div>
                      <button
                        className="text-action"
                        type="button"
                        onClick={() => {
                          removeSubscription(subscription.subscriptionId);
                        }}
                      >
                        删除
                      </button>
                    </header>
                    <div className="source-subscription-fields">
                      <label className="field">
                        <span>显示名称</span>
                        <input
                          value={subscription.label}
                          maxLength={80}
                          onChange={(event) => {
                            updateDraft(subscription.subscriptionId, {
                              label: event.currentTarget.value,
                            });
                          }}
                        />
                      </label>
                      <label className="field">
                        <span>来源别名</span>
                        <input
                          value={subscription.sourceAlias}
                          maxLength={120}
                          onChange={(event) => {
                            updateDraft(subscription.subscriptionId, {
                              sourceAlias: event.currentTarget.value,
                            });
                          }}
                        />
                      </label>
                      <label className="field field--wide">
                        <span>GitHub 仓库</span>
                        <input
                          value={subscription.repositoryUri}
                          placeholder="https://github.com/owner/repository"
                          onChange={(event) => {
                            updateDraft(subscription.subscriptionId, {
                              repositoryUri: event.currentTarget.value,
                            });
                          }}
                        />
                      </label>
                      <label className="field">
                        <span>分支或引用</span>
                        <input
                          value={subscription.repositoryRef}
                          maxLength={200}
                          onChange={(event) => {
                            updateDraft(subscription.subscriptionId, {
                              repositoryRef: event.currentTarget.value,
                            });
                          }}
                        />
                      </label>
                      <label className="field">
                        <span>仓库内文件路径</span>
                        <input
                          value={subscription.repositoryPath}
                          placeholder="docs/weekly.md"
                          maxLength={500}
                          onChange={(event) => {
                            updateDraft(subscription.subscriptionId, {
                              repositoryPath: event.currentTarget.value,
                            });
                          }}
                        />
                      </label>
                      <label className="field">
                        <span>解析规则</span>
                        <select
                          value={subscription.profile}
                          onChange={(event) => {
                            updateDraft(subscription.subscriptionId, {
                              profile: event.currentTarget.value as
                                'commonmark-v1' | 'ruanyf-weekly-v1',
                            });
                          }}
                        >
                          <option value="commonmark-v1">通用 Markdown</option>
                          <option value="ruanyf-weekly-v1">周刊结构</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>检查间隔（分钟）</span>
                        <input
                          type="number"
                          min={15}
                          max={10_080}
                          step={15}
                          value={subscription.intervalMinutes}
                          onChange={(event) => {
                            updateDraft(subscription.subscriptionId, {
                              intervalMinutes: Number(
                                event.currentTarget.value,
                              ),
                            });
                          }}
                        />
                      </label>
                    </div>
                    <div className="source-subscription-options">
                      <label>
                        <input
                          type="checkbox"
                          checked={subscription.enabled}
                          onChange={(event) => {
                            updateDraft(subscription.subscriptionId, {
                              enabled: event.currentTarget.checked,
                            });
                          }}
                        />
                        开启定期检查
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={subscription.isPrivate}
                          onChange={(event) => {
                            updateDraft(subscription.subscriptionId, {
                              isPrivate: event.currentTarget.checked,
                            });
                          }}
                        />
                        导入为隐私文档
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={subscription.routeAfterImport}
                          onChange={(event) => {
                            updateDraft(subscription.subscriptionId, {
                              routeAfterImport: event.currentTarget.checked,
                            });
                          }}
                        />
                        变化后自动拆分并分流
                      </label>
                      <span>
                        {saved?.lastSuccessAt === undefined
                          ? '尚未成功检查'
                          : `上次成功：${formatLocalTime(saved.lastSuccessAt)}`}
                      </span>
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={dirty || runningId !== undefined}
                        onClick={() => {
                          void runSubscription(subscription.subscriptionId);
                        }}
                      >
                        {runningId === subscription.subscriptionId
                          ? '正在检查…'
                          : '立即检查'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="source-subscription-commit">
            <p>
              {dirty
                ? '有尚未保存的变更；保存后才能手动检查。'
                : '当前编辑内容已与外部个人配置一致。'}
            </p>
            <button
              className="primary-action"
              type="button"
              disabled={!dirty || saving || !draftsAreComplete(state.drafts)}
              onClick={() => {
                void saveSubscriptions();
              }}
            >
              {saving ? '正在保存…' : '保存订阅设置'}
            </button>
          </div>
          <ActionNotice feedback={feedback} />
        </>
      ) : null}
    </section>
  );
}

function PanelHeading() {
  return (
    <header className="subsection-heading">
      <div>
        <p className="section-index">SOURCE SUBSCRIPTIONS / EXTERNAL</p>
        <h2 id="source-subscription-title">信源订阅</h2>
      </div>
      <span className="origin-label origin-label--deterministic">
        变化导入 · 可选确定性分流
      </span>
    </header>
  );
}

function toWrite(
  subscription: Readonly<SourceSubscriptionView>,
): Readonly<SourceSubscriptionWrite> {
  return Object.freeze({
    subscriptionId: subscription.subscriptionId,
    label: subscription.label,
    enabled: subscription.enabled,
    repositoryUri: subscription.repositoryUri,
    repositoryRef: subscription.repositoryRef,
    repositoryPath: subscription.repositoryPath,
    profile: subscription.profile,
    sourceAlias: subscription.sourceAlias,
    isPrivate: subscription.isPrivate,
    routeAfterImport: subscription.routeAfterImport,
    intervalMinutes: subscription.intervalMinutes,
  });
}

function draftsAreComplete(
  subscriptions: readonly Readonly<SourceSubscriptionWrite>[],
): boolean {
  return subscriptions.every(
    (subscription) =>
      subscription.label.trim() !== '' &&
      subscription.sourceAlias.trim() !== '' &&
      subscription.repositoryUri.trim() !== '' &&
      subscription.repositoryRef.trim() !== '' &&
      subscription.repositoryPath.trim() !== '' &&
      Number.isSafeInteger(subscription.intervalMinutes) &&
      subscription.intervalMinutes >= 15 &&
      subscription.intervalMinutes <= 10_080,
  );
}

function sourceRunIssue(code: string): string {
  if (code === 'source_not_found') return '没有找到指定仓库、引用或文件。';
  if (code === 'source_too_large') return '来源文件超过当前 1 MiB 导入边界。';
  if (code === 'source_invalid') return '来源不是有效的 UTF-8 Markdown 文件。';
  if (code === 'source_subscription_stale') {
    return '订阅配置已改变，请重新读取后再检查。';
  }
  return '远端来源、外部存储或数据库当前不可用；现有数据保持不变。';
}

function formatLocalTime(value: string): string {
  const instant = new Date(value);
  return Number.isNaN(instant.valueOf())
    ? value
    : new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(instant);
}
