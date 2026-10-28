import type {ReactNode} from 'react';
import {SourceReceivingFields} from './source_receiving_fields.js';
import {SourceDescriptionField} from './source_description_field.js';
import {ContentDialog} from '../components/content_dialog.js';
import {SourceAiScopeToggle} from './source_ai_scope_toggle.js';
import {DEFAULT_SOURCE_RECEIVING} from '../api/source_receiving_contract.js';
import {SourceProcessingHints} from './source_processing_hints.js';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import type {
  M1cHttpResponse,
  SourceConnectorCapabilityView,
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
import {
  PluginSourceSubscriptionFields,
  WebSourceSubscriptionFields,
} from './source_subscription_connector_fields.js';

type SubscriptionPanelState =
  | Readonly<{status: 'loading'}>
  | Readonly<{status: 'error'; message: string}>
  | Readonly<{
      status: 'ready';
      revision: number;
      connectors: readonly Readonly<SourceConnectorCapabilityView>[];
      saved: readonly Readonly<SourceSubscriptionView>[];
      drafts: readonly Readonly<SourceSubscriptionWrite>[];
    }>;

export interface SourceSubscriptionPanelProps {
  readonly selectedId?: string | undefined;
  readonly onHistory?: (() => void) | undefined;
  readonly recipeTools?: ReactNode;
  readonly newRequest?: number | undefined;
  readonly onCreated?: ((id: string) => void) | undefined;
  readonly onSaved?: (() => void) | undefined;
  readonly sampleSnapshotId?: string | undefined;
  readonly sampleIsPrivate?: boolean | undefined;
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
  selectedId,
  onHistory,
  recipeTools,
  newRequest,
  onCreated,
  onSaved,
  sampleSnapshotId,
  sampleIsPrivate,
}: SourceSubscriptionPanelProps) {
  const [state, setState] = useState<SubscriptionPanelState>({
    status: 'loading',
  });
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const [saving, setSaving] = useState(false);
  const [connectionId, setConnectionId] = useState<string>();
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [runningId, setRunningId] = useState<string>();
  const handledNewRequest = useRef(0);

  const load = useCallback(async () => {
    if (!enabled) return;
    setState({status: 'loading'});
    try {
      const response = await onList();
      if (response.body.status !== 'ok') {
        setState({
          status: 'error',
          message: '个人设置当前无法读取；没有改变任何订阅。',
        });
        return;
      }
      setState({
        status: 'ready',
        revision: response.body.revision,
        connectors: response.body.connectors,
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

  useEffect(() => {
    if (
      !newRequest ||
      handledNewRequest.current === newRequest ||
      state.status !== 'ready'
    )
      return;
    handledNewRequest.current = newRequest;
    const subscriptionId = createClientUuid();
    setState((current) =>
      current.status !== 'ready' || current.drafts.length >= 32
        ? current
        : {
            ...current,
            drafts: [
              ...current.drafts,
              {
                kind: 'rss_atom',
                subscriptionId,
                label: '',
                enabled: false,
                feedUrl: '',
                itemLimit: 20,
                sourceAlias: subscriptionId,
                isPrivate: false,
                intervalMinutes: 1440,
              },
            ],
          },
    );
    onCreated?.(subscriptionId);
  }, [newRequest, state.status, onCreated]);

  const [removal, setRemoval] = useState<string>();
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
          当前服务未启用订阅功能。仍可使用上方的手动文本、Git
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
                  ? (Object.freeze({
                      ...subscription,
                      ...change,
                    }) as Readonly<SourceSubscriptionWrite>)
                  : subscription,
              ),
            ),
          },
    );
    setFeedback(undefined);
  }

  function removeJsonApiCursorMapping(
    subscriptionId: string,
    field: 'pageCursor' | 'incrementalCursor',
  ) {
    setState((current) =>
      current.status !== 'ready'
        ? current
        : {
            ...current,
            drafts: Object.freeze(
              current.drafts.map((subscription) => {
                if (
                  subscription.subscriptionId !== subscriptionId ||
                  subscription.kind !== 'json_api'
                ) {
                  return subscription;
                }
                if (field === 'pageCursor') {
                  const remaining = {...subscription};
                  delete remaining.pageCursor;
                  return Object.freeze(remaining);
                }
                const remaining = {...subscription};
                delete remaining.incrementalCursor;
                return Object.freeze(remaining);
              }),
            ),
          },
    );
    setFeedback(undefined);
  }

  async function removeSubscription(subscriptionId: string) {
    if (state.status !== 'ready' || saving) return;

    const next = state.drafts.filter(
      (s) => s.subscriptionId !== subscriptionId,
    );
    if (state.saved.some((s) => s.subscriptionId === subscriptionId)) {
      if (!(await saveSubscriptions(next))) return;
    } else setState({...state, drafts: next});
    setRemoval(undefined);
    onCreated?.(next[0]?.subscriptionId ?? 'all');
  }

  function changeSubscriptionKind(
    subscription: Readonly<SourceSubscriptionWrite>,
    kind: SourceSubscriptionWrite['kind'],
  ) {
    const firstPluginId =
      state.status === 'ready'
        ? state.connectors.find((connector) => connector.origin === 'plugin')
            ?.connectorId
        : undefined;
    const common = {
      ...(subscription.processingProfile
        ? {processingProfile: subscription.processingProfile}
        : {}),
      subscriptionId: subscription.subscriptionId,
      label: subscription.label,
      ...(subscription.description
        ? {description: subscription.description}
        : {}),
      enabled: subscription.enabled,
      sourceAlias: subscription.sourceAlias,
      isPrivate: subscription.isPrivate,
      intervalMinutes: subscription.intervalMinutes,
      ...(subscription.receiving ? {receiving: subscription.receiving} : {}),
    };
    const next: Readonly<SourceSubscriptionWrite> =
      kind === 'rss_atom'
        ? Object.freeze({
            ...common,
            kind,
            feedUrl: '',
            itemLimit: 20,
          })
        : kind === 'json_api'
          ? Object.freeze({
              ...common,
              kind,
              endpointUrl: '',
              recordsPath: 'items',
              externalIdPath: 'id',
              titlePath: 'title',
              bodyPath: 'body',
              recordLimit: 32,
              authentication: Object.freeze({kind: 'none' as const}),
            })
          : kind === 'web'
            ? Object.freeze({
                ...common,
                kind,
                pageUrl: '',
                additionalPaths: Object.freeze([]),
              })
            : kind === 'plugin'
              ? Object.freeze({
                  ...common,
                  kind,
                  connectorId: firstPluginId ?? '',
                  configurationRef: '',
                })
              : Object.freeze({
                  ...common,
                  kind,
                  repositoryUri: '',
                  repositoryRef: 'main',
                  repositoryPath: '',
                  profile: 'commonmark-v1' as const,
                });
    setState((current) =>
      current.status !== 'ready'
        ? current
        : {
            ...current,
            drafts: Object.freeze(
              current.drafts.map((candidate) =>
                candidate.subscriptionId === subscription.subscriptionId
                  ? next
                  : candidate,
              ),
            ),
          },
    );
    setFeedback(undefined);
  }

  async function saveSubscriptions(
    drafts = state.status === 'ready' ? state.drafts : [],
  ) {
    if (state.status !== 'ready' || saving || !draftsAreComplete(drafts)) {
      return;
    }
    setSaving(true);
    setFeedback(undefined);
    try {
      const response = await onReplace(state.revision, drafts);
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
        connectors: state.connectors,
        saved: response.body.subscriptions,
        drafts: Object.freeze(response.body.subscriptions.map(toWrite)),
      });
      setFeedback({
        kind: 'success',
        title: response.body.status === 'applied' ? '订阅已保存' : '配置未变化',
        detail: '设置已保存。只有开启“定期检查”的订阅才会自动检查更新。',
      });
      onSaved?.();
      return true;
    } catch {
      setFeedback({
        kind: 'error',
        title: '订阅未保存',
        detail: '本地服务当前不可达；订阅设置保持不变。',
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
            ? `已接收 ${String(response.body.importedDocumentCount ?? 1)} 份文档，可在底部接收记录中审核。`
            : '没有重复导入文档。',
      });
      await load();
      onSaved?.();
    } catch {
      setFeedback({
        kind: 'error',
        title: '本次检查未完成',
        detail: '本地接口或远端来源当前不可达；现有数据保持不变。',
      });
    } finally {
      setRunningId(undefined);
    }
  }

  return (
    <section
      className="source-subscription-panel source-subscription-panel--single"
      aria-label="来源设置"
    >
      {state.status !== 'ready' ? (
        <div
          className="source-form-state"
          role={state.status === 'error' ? 'alert' : 'status'}
        >
          <p>{state.status === 'error' ? state.message : '正在读取来源…'}</p>
          {state.status === 'error' ? (
            <button type="button" onClick={() => void load()}>
              重新读取
            </button>
          ) : null}
        </div>
      ) : (
        state.drafts
          .filter(
            (subscription) =>
              selectedId === undefined ||
              subscription.subscriptionId === selectedId,
          )
          .map((subscription) => {
            const receiving =
              subscription.receiving ?? DEFAULT_SOURCE_RECEIVING;
            const change = (patch: Partial<SourceSubscriptionWrite>) => {
              updateDraft(subscription.subscriptionId, patch);
            };
            return (
              <div
                className="source-edit-layout"
                key={subscription.subscriptionId}
              >
                <header className="selected-source">
                  <div>
                    <span
                      className="selection-dot"
                      style={{
                        background: subscription.processingProfile?.accent,
                      }}
                    />
                    <h2>{subscription.label || '添加来源'}</h2>
                  </div>
                  <div className="source-save">
                    <span>{dirty ? '未保存' : '已保存'}</span>
                    <button
                      type="button"
                      className="compact-button primary"
                      disabled={
                        saving || !dirty || !draftsAreComplete(state.drafts)
                      }
                      onClick={() => void saveSubscriptions()}
                    >
                      {saving ? '正在保存…' : '保存设置'}
                    </button>
                  </div>
                </header>
                <div className="editor-regions">
                  <div className="common-settings">
                    <section className="category basic-settings">
                      <header>
                        <h3>基础设置</h3>
                        <span className="section-index">01</span>
                      </header>
                      <div className="basic-grid">
                        <label className="setting-field name-field">
                          <span>来源名称</span>
                          <input
                            value={subscription.label}
                            maxLength={80}
                            onChange={(e) => {
                              change({label: e.target.value});
                            }}
                          />
                        </label>
                        <label className="setting-field color-field">
                          <span>来源颜色</span>
                          <input
                            type="color"
                            value={
                              subscription.processingProfile?.accent ??
                              '#c4b08b'
                            }
                            onChange={(e) => {
                              change({
                                processingProfile: {
                                  split: '',
                                  tags: '',
                                  relations: '',
                                  ...subscription.processingProfile,
                                  accent: e.target.value,
                                },
                              });
                            }}
                          />
                        </label>
                        <label className="setting-field">
                          <span>接入类型</span>
                          <select
                            value={subscription.kind}
                            onChange={(e) => {
                              changeSubscriptionKind(
                                subscription,
                                e.target
                                  .value as SourceSubscriptionWrite['kind'],
                              );
                            }}
                          >
                            <option value="rss_atom">RSS / Atom</option>
                            <option value="github_markdown">Git 文档</option>
                            <option value="json_api">JSON API</option>
                            <option value="web">网页</option>
                            {state.connectors.some(
                              (c) => c.origin === 'plugin',
                            ) || subscription.kind === 'plugin' ? (
                              <option value="plugin">连接组件</option>
                            ) : null}
                          </select>
                        </label>
                        <label className="setting-field">
                          <span>文档隐私</span>
                          <select
                            value={String(subscription.isPrivate)}
                            onChange={(e) => {
                              change({isPrivate: e.target.value === 'true'});
                            }}
                          >
                            <option value="false">公开</option>
                            <option value="true">私密</option>
                          </select>
                        </label>
                        <label className="setting-field">
                          <span>来源优先级</span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={receiving.preference}
                            onChange={(e) => {
                              change({
                                receiving: {
                                  ...receiving,
                                  preference: e.target.valueAsNumber,
                                },
                              });
                            }}
                          />
                        </label>
                        <SourceDescriptionField
                          subscription={subscription}
                          disabled={saving}
                          onChange={(description) => {
                            change({description});
                          }}
                        />
                      </div>
                    </section>
                    <section className="category receiving-settings">
                      <header>
                        <h3>接收设置</h3>
                        <label className="switch-label">
                          <span>自动检查</span>
                          <input
                            type="checkbox"
                            role="switch"
                            checked={subscription.enabled}
                            onChange={(e) => {
                              change({enabled: e.target.checked});
                            }}
                          />
                          <i aria-hidden="true" />
                        </label>
                      </header>
                      <SourceReceivingFields
                        value={receiving}
                        interval={subscription.intervalMinutes}
                        onInterval={(intervalMinutes) => {
                          change({intervalMinutes});
                        }}
                        onChange={(receiving) => {
                          change({receiving});
                        }}
                      />
                      <div className="parameter-field">
                        <div className="field-heading">
                          <span>接收参数</span>
                          <button
                            type="button"
                            className="text-action"
                            onClick={() => {
                              setConnectionId(subscription.subscriptionId);
                            }}
                          >
                            编辑参数 ↗
                          </button>
                        </div>
                        <div className="connection-summary">
                          <span>
                            {subscription.kind === 'rss_atom'
                              ? subscription.feedUrl
                              : subscription.kind === 'github_markdown'
                                ? subscription.repositoryUri
                                : subscription.kind === 'json_api'
                                  ? subscription.endpointUrl
                                  : subscription.kind === 'web'
                                    ? subscription.pageUrl
                                    : subscription.configurationRef ||
                                      '地址待填写'}
                          </span>
                        </div>
                      </div>
                    </section>
                  </div>
                  <SourceProcessingHints
                    value={subscription.processingProfile}
                    snapshotId={sampleSnapshotId}
                    isPrivate={
                      sampleIsPrivate === true || subscription.isPrivate
                    }
                    onChange={(processingProfile) => {
                      change({processingProfile});
                    }}
                    onRecipe={() => {
                      setRecipeOpen(true);
                    }}
                    scopeToggle={
                      <SourceAiScopeToggle
                        subscriptionId={subscription.subscriptionId}
                        isPrivate={subscription.isPrivate}
                        saved={state.saved.some(
                          (s) =>
                            s.subscriptionId === subscription.subscriptionId,
                        )}
                      />
                    }
                  />
                  <section className="special-settings">
                    <h3>特殊设置</h3>
                    <button
                      type="button"
                      className="compact-button"
                      onClick={onHistory}
                    >
                      往期补收 ↗
                    </button>
                    <button
                      type="button"
                      className="compact-button"
                      disabled={dirty || runningId !== undefined}
                      onClick={() =>
                        void runSubscription(subscription.subscriptionId)
                      }
                    >
                      {runningId === subscription.subscriptionId
                        ? '正在检查…'
                        : '立即检查'}
                    </button>
                    <button
                      type="button"
                      className="text-action"
                      disabled={
                        saving ||
                        (dirty &&
                          state.saved.some(
                            (s) =>
                              s.subscriptionId === subscription.subscriptionId,
                          ))
                      }
                      onClick={() => {
                        setRemoval(subscription.subscriptionId);
                      }}
                    >
                      删除来源
                    </button>
                  </section>
                  <ActionNotice feedback={feedback} />
                </div>
                <ContentDialog
                  open={removal === subscription.subscriptionId}
                  title="删除来源"
                  onClose={() => {
                    if (!saving) setRemoval(undefined);
                  }}
                >
                  <p>删除来源配置，已接收的文档保留。</p>
                  <button
                    className="secondary-action"
                    disabled={saving}
                    onClick={() =>
                      void removeSubscription(subscription.subscriptionId)
                    }
                  >
                    确认删除
                  </button>
                </ContentDialog>
                <ContentDialog
                  open={connectionId === subscription.subscriptionId}
                  title="接收参数"
                  onClose={() => {
                    setConnectionId(undefined);
                  }}
                  className="layout-dialog source-connection-dialog"
                >
                  <div className="dialog-form">
                    {subscription.kind === 'github_markdown' ? (
                      <>
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
                      </>
                    ) : subscription.kind === 'rss_atom' ? (
                      <>
                        <label className="field field--wide">
                          <span>RSS / Atom 地址</span>
                          <input
                            type="url"
                            value={subscription.feedUrl}
                            placeholder="https://example.invalid/feed.xml"
                            onChange={(event) => {
                              updateDraft(subscription.subscriptionId, {
                                feedUrl: event.currentTarget.value,
                              });
                            }}
                          />
                          <small>
                            仅 HTTPS
                            RSS/Atom。此处只读取订阅正文，跳转地址暂不支持。
                          </small>
                        </label>
                        <label className="field">
                          <span>每次最多处理条目</span>
                          <input
                            type="number"
                            min={1}
                            max={20}
                            step={1}
                            value={subscription.itemLimit}
                            onChange={(event) => {
                              updateDraft(subscription.subscriptionId, {
                                itemLimit: Number(event.currentTarget.value),
                              });
                            }}
                          />
                        </label>
                      </>
                    ) : subscription.kind === 'json_api' ? (
                      <>
                        <label className="field field--wide">
                          <span>JSON API 地址</span>
                          <input
                            type="url"
                            value={subscription.endpointUrl}
                            placeholder="https://api.example.invalid/entries"
                            onChange={(event) => {
                              updateDraft(subscription.subscriptionId, {
                                endpointUrl: event.currentTarget.value,
                              });
                            }}
                          />
                          <small>
                            读取公开 HTTPS 接口，暂不支持脚本或地址跳转。
                          </small>
                        </label>
                        <label className="field">
                          <span>记录数组路径</span>
                          <input
                            value={subscription.recordsPath}
                            placeholder="data.items（留空表示根数组）"
                            onChange={(event) => {
                              updateDraft(subscription.subscriptionId, {
                                recordsPath: event.currentTarget.value,
                              });
                            }}
                          />
                        </label>
                        <label className="field">
                          <span>每次记录上限</span>
                          <input
                            type="number"
                            min={1}
                            max={32}
                            step={1}
                            value={subscription.recordLimit}
                            onChange={(event) => {
                              updateDraft(subscription.subscriptionId, {
                                recordLimit: Number(event.currentTarget.value),
                              });
                            }}
                          />
                        </label>
                        <label className="field">
                          <span>记录 ID 路径</span>
                          <input
                            value={subscription.externalIdPath}
                            placeholder="id"
                            onChange={(event) => {
                              updateDraft(subscription.subscriptionId, {
                                externalIdPath: event.currentTarget.value,
                              });
                            }}
                          />
                        </label>
                        <label className="field">
                          <span>标题路径</span>
                          <input
                            value={subscription.titlePath}
                            placeholder="title"
                            onChange={(event) => {
                              updateDraft(subscription.subscriptionId, {
                                titlePath: event.currentTarget.value,
                              });
                            }}
                          />
                        </label>
                        <label className="field">
                          <span>正文路径</span>
                          <input
                            value={subscription.bodyPath}
                            placeholder="content.body"
                            onChange={(event) => {
                              updateDraft(subscription.subscriptionId, {
                                bodyPath: event.currentTarget.value,
                              });
                            }}
                          />
                        </label>
                        <label className="field">
                          <span>原文地址路径（可选）</span>
                          <input
                            value={subscription.canonicalUriPath ?? ''}
                            placeholder="url"
                            onChange={(event) => {
                              updateDraft(subscription.subscriptionId, {
                                canonicalUriPath: event.currentTarget.value,
                              });
                            }}
                          />
                        </label>
                        <label className="field">
                          <span>发布时间路径（可选）</span>
                          <input
                            value={subscription.publishedAtPath ?? ''}
                            placeholder="published_at"
                            onChange={(event) => {
                              updateDraft(subscription.subscriptionId, {
                                publishedAtPath: event.currentTarget.value,
                              });
                            }}
                          />
                        </label>
                        <label className="field">
                          <span>远端版本路径（可选）</span>
                          <input
                            value={subscription.versionPath ?? ''}
                            placeholder="updated_at"
                            onChange={(event) => {
                              updateDraft(subscription.subscriptionId, {
                                versionPath: event.currentTarget.value,
                              });
                            }}
                          />
                        </label>
                        <label className="field">
                          <span>认证方式</span>
                          <select
                            value={subscription.authentication.kind}
                            onChange={(event) => {
                              updateDraft(subscription.subscriptionId, {
                                authentication:
                                  event.currentTarget.value === 'bearer_env'
                                    ? Object.freeze({
                                        kind: 'bearer_env' as const,
                                        variable: '',
                                      })
                                    : Object.freeze({
                                        kind: 'none' as const,
                                      }),
                              });
                            }}
                          >
                            <option value="none">无认证</option>
                            <option value="bearer_env">
                              Bearer（环境变量）
                            </option>
                          </select>
                        </label>
                        {subscription.authentication.kind === 'bearer_env' ? (
                          <label className="field">
                            <span>令牌环境变量名</span>
                            <input
                              value={subscription.authentication.variable}
                              placeholder="STRUIINFO_JSON_API_TOKEN"
                              onChange={(event) => {
                                updateDraft(subscription.subscriptionId, {
                                  authentication: Object.freeze({
                                    kind: 'bearer_env' as const,
                                    variable: event.currentTarget.value,
                                  }),
                                });
                              }}
                            />
                            <small>
                              填写服务器环境变量名，令牌由服务器读取。
                            </small>
                          </label>
                        ) : null}
                        <label className="source-subscription-inline-option">
                          <input
                            type="checkbox"
                            checked={subscription.pageCursor !== undefined}
                            onChange={(event) => {
                              if (event.currentTarget.checked) {
                                updateDraft(subscription.subscriptionId, {
                                  pageCursor: Object.freeze({
                                    queryParameter: 'cursor',
                                    responsePath: 'next_cursor',
                                  }),
                                });
                              } else {
                                removeJsonApiCursorMapping(
                                  subscription.subscriptionId,
                                  'pageCursor',
                                );
                              }
                            }}
                          />
                          使用分页游标（最多 5 页）
                        </label>
                        {subscription.pageCursor === undefined ? null : (
                          <>
                            <label className="field">
                              <span>分页请求参数</span>
                              <input
                                value={subscription.pageCursor.queryParameter}
                                onChange={(event) => {
                                  updateDraft(subscription.subscriptionId, {
                                    pageCursor: Object.freeze({
                                      queryParameter: event.currentTarget.value,
                                      responsePath:
                                        subscription.pageCursor?.responsePath ??
                                        '',
                                    }),
                                  });
                                }}
                              />
                            </label>
                            <label className="field">
                              <span>下一页游标路径</span>
                              <input
                                value={subscription.pageCursor.responsePath}
                                onChange={(event) => {
                                  updateDraft(subscription.subscriptionId, {
                                    pageCursor: Object.freeze({
                                      queryParameter:
                                        subscription.pageCursor
                                          ?.queryParameter ?? '',
                                      responsePath: event.currentTarget.value,
                                    }),
                                  });
                                }}
                              />
                            </label>
                          </>
                        )}
                        <label className="source-subscription-inline-option">
                          <input
                            type="checkbox"
                            checked={
                              subscription.incrementalCursor !== undefined
                            }
                            onChange={(event) => {
                              if (event.currentTarget.checked) {
                                updateDraft(subscription.subscriptionId, {
                                  incrementalCursor: Object.freeze({
                                    queryParameter: 'since',
                                    responsePath: 'checkpoint',
                                  }),
                                });
                              } else {
                                removeJsonApiCursorMapping(
                                  subscription.subscriptionId,
                                  'incrementalCursor',
                                );
                              }
                            }}
                          />
                          使用增量游标
                        </label>
                        {subscription.incrementalCursor === undefined ? null : (
                          <>
                            <label className="field">
                              <span>增量请求参数</span>
                              <input
                                value={
                                  subscription.incrementalCursor.queryParameter
                                }
                                onChange={(event) => {
                                  updateDraft(subscription.subscriptionId, {
                                    incrementalCursor: Object.freeze({
                                      queryParameter: event.currentTarget.value,
                                      responsePath:
                                        subscription.incrementalCursor
                                          ?.responsePath ?? '',
                                    }),
                                  });
                                }}
                              />
                            </label>
                            <label className="field">
                              <span>增量标记路径</span>
                              <input
                                value={
                                  subscription.incrementalCursor.responsePath
                                }
                                onChange={(event) => {
                                  updateDraft(subscription.subscriptionId, {
                                    incrementalCursor: Object.freeze({
                                      queryParameter:
                                        subscription.incrementalCursor
                                          ?.queryParameter ?? '',
                                      responsePath: event.currentTarget.value,
                                    }),
                                  });
                                }}
                              />
                            </label>
                          </>
                        )}
                      </>
                    ) : subscription.kind === 'web' ? (
                      <WebSourceSubscriptionFields
                        subscription={subscription}
                        onChange={(change) => {
                          updateDraft(subscription.subscriptionId, change);
                        }}
                      />
                    ) : (
                      <PluginSourceSubscriptionFields
                        subscription={subscription}
                        connectors={state.connectors}
                        onChange={(change) => {
                          updateDraft(subscription.subscriptionId, change);
                        }}
                      />
                    )}
                  </div>
                  <footer className="panel-footer">
                    <button
                      type="button"
                      className="compact-button primary"
                      onClick={() => {
                        setConnectionId(undefined);
                      }}
                    >
                      完成编辑
                    </button>
                  </footer>
                </ContentDialog>
                <ContentDialog
                  open={recipeOpen}
                  title="完整拆分方案"
                  onClose={() => {
                    setRecipeOpen(false);
                  }}
                  className="layout-dialog"
                >
                  {recipeTools ?? <p>收到文档后，可生成并试读拆分规则。</p>}
                </ContentDialog>
              </div>
            );
          })
      )}
    </section>
  );
}
function PanelHeading() {
  return <h2>来源设置</h2>;
}

function toWrite(
  subscription: Readonly<SourceSubscriptionView>,
): Readonly<SourceSubscriptionWrite> {
  const common = {
    ...(subscription.processingProfile
      ? {processingProfile: subscription.processingProfile}
      : {}),
    subscriptionId: subscription.subscriptionId,
    label: subscription.label,
    ...(subscription.description === undefined
      ? {}
      : {description: subscription.description}),
    enabled: subscription.enabled,
    sourceAlias: subscription.sourceAlias,
    isPrivate: subscription.isPrivate,
    intervalMinutes: subscription.intervalMinutes,
    ...(subscription.receiving ? {receiving: subscription.receiving} : {}),
  };
  return subscription.kind === 'rss_atom'
    ? Object.freeze({
        ...common,
        kind: subscription.kind,
        feedUrl: subscription.feedUrl,
        itemLimit: subscription.itemLimit,
      })
    : subscription.kind === 'json_api'
      ? Object.freeze({
          ...common,
          kind: subscription.kind,
          endpointUrl: subscription.endpointUrl,
          recordsPath: subscription.recordsPath,
          externalIdPath: subscription.externalIdPath,
          titlePath: subscription.titlePath,
          bodyPath: subscription.bodyPath,
          ...(subscription.canonicalUriPath === undefined
            ? {}
            : {canonicalUriPath: subscription.canonicalUriPath}),
          ...(subscription.publishedAtPath === undefined
            ? {}
            : {publishedAtPath: subscription.publishedAtPath}),
          ...(subscription.versionPath === undefined
            ? {}
            : {versionPath: subscription.versionPath}),
          recordLimit: subscription.recordLimit,
          ...(subscription.pageCursor === undefined
            ? {}
            : {
                pageCursor: Object.freeze({...subscription.pageCursor}),
              }),
          ...(subscription.incrementalCursor === undefined
            ? {}
            : {
                incrementalCursor: Object.freeze({
                  ...subscription.incrementalCursor,
                }),
              }),
          authentication: Object.freeze({...subscription.authentication}),
        })
      : subscription.kind === 'web'
        ? Object.freeze({
            ...common,
            kind: subscription.kind,
            pageUrl: subscription.pageUrl,
            additionalPaths: Object.freeze([...subscription.additionalPaths]),
          })
        : subscription.kind === 'plugin'
          ? Object.freeze({
              ...common,
              kind: subscription.kind,
              connectorId: subscription.connectorId,
              configurationRef: subscription.configurationRef,
            })
          : Object.freeze({
              ...common,
              kind: subscription.kind,
              repositoryUri: subscription.repositoryUri,
              repositoryRef: subscription.repositoryRef,
              repositoryPath: subscription.repositoryPath,
              profile: subscription.profile,
            });
}

function draftsAreComplete(
  subscriptions: readonly Readonly<SourceSubscriptionWrite>[],
): boolean {
  return subscriptions.every(
    (subscription) =>
      subscription.label.trim() !== '' &&
      subscription.sourceAlias.trim() !== '' &&
      subscriptionConfigurationIsComplete(subscription) &&
      Number.isSafeInteger(subscription.intervalMinutes) &&
      subscription.intervalMinutes >= 15 &&
      subscription.intervalMinutes <= 10_080,
  );
}

function subscriptionConfigurationIsComplete(
  subscription: Readonly<SourceSubscriptionWrite>,
): boolean {
  if (subscription.kind === 'rss_atom') {
    return (
      subscription.feedUrl.trim() !== '' &&
      Number.isSafeInteger(subscription.itemLimit) &&
      subscription.itemLimit >= 1 &&
      subscription.itemLimit <= 20
    );
  }
  if (subscription.kind === 'github_markdown') {
    return (
      subscription.repositoryUri.trim() !== '' &&
      subscription.repositoryRef.trim() !== '' &&
      subscription.repositoryPath.trim() !== ''
    );
  }
  if (subscription.kind === 'web') {
    return (
      subscription.pageUrl.trim() !== '' &&
      subscription.additionalPaths.length <= 7 &&
      subscription.additionalPaths.every(
        (path) =>
          path.startsWith('/') &&
          !path.startsWith('//') &&
          !path.includes('\\') &&
          !path.includes('#') &&
          Array.from(path).length <= 500,
      ) &&
      new Set(subscription.additionalPaths).size ===
        subscription.additionalPaths.length
    );
  }
  if (subscription.kind === 'plugin') {
    return (
      /^plugin(?:[._-][a-z0-9]+){1,7}$/u.test(subscription.connectorId) &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(subscription.configurationRef)
    );
  }
  return (
    subscription.endpointUrl.trim() !== '' &&
    pathIsValid(subscription.recordsPath, true) &&
    pathIsValid(subscription.externalIdPath, false) &&
    pathIsValid(subscription.titlePath, false) &&
    pathIsValid(subscription.bodyPath, false) &&
    optionalPathIsValid(subscription.canonicalUriPath) &&
    optionalPathIsValid(subscription.publishedAtPath) &&
    optionalPathIsValid(subscription.versionPath) &&
    Number.isSafeInteger(subscription.recordLimit) &&
    subscription.recordLimit >= 1 &&
    subscription.recordLimit <= 32 &&
    cursorMappingIsComplete(subscription.pageCursor) &&
    cursorMappingIsComplete(subscription.incrementalCursor) &&
    (subscription.pageCursor === undefined ||
      subscription.incrementalCursor?.queryParameter !==
        subscription.pageCursor.queryParameter) &&
    (subscription.authentication.kind === 'none' ||
      /^[A-Z_][A-Z0-9_]{0,99}$/u.test(subscription.authentication.variable))
  );
}

function cursorMappingIsComplete(
  value: Readonly<{queryParameter: string; responsePath: string}> | undefined,
): boolean {
  return (
    value === undefined ||
    (/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/u.test(value.queryParameter) &&
      pathIsValid(value.responsePath, false))
  );
}

function optionalPathIsValid(value: string | undefined): boolean {
  return value === undefined || value === '' || pathIsValid(value, false);
}

function pathIsValid(value: string, allowEmpty: boolean): boolean {
  return (
    (allowEmpty && value === '') ||
    /^(?:[A-Za-z_][A-Za-z0-9_-]{0,99})(?:\.(?:[A-Za-z_][A-Za-z0-9_-]{0,99})){0,7}$/u.test(
      value,
    )
  );
}

function sourceRunIssue(code: string): string {
  if (code === 'source_not_found') return '没有找到指定的远端来源。';
  if (code === 'source_too_large') return '来源响应超过当前容量限制。';
  if (code === 'source_invalid') {
    return '来源地址、字段设置或返回内容不符合导入要求。';
  }
  if (code === 'source_subscription_stale') {
    return '订阅配置已改变，请重新读取后再检查。';
  }
  return '远端来源、外部存储或数据库当前不可用；现有数据保持不变。';
}
