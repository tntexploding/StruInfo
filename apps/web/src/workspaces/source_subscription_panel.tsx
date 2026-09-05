import {useCallback, useEffect, useMemo, useState} from 'react';

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
  SourceConnectorCapabilityList,
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

  function addSubscription() {
    setState((current) =>
      current.status !== 'ready' || current.drafts.length >= 32
        ? current
        : {
            ...current,
            drafts: Object.freeze([
              ...current.drafts,
              Object.freeze({
                kind: 'github_markdown' as const,
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
      subscriptionId: subscription.subscriptionId,
      label: subscription.label,
      enabled: subscription.enabled,
      sourceAlias: subscription.sourceAlias,
      isPrivate: subscription.isPrivate,
      routeAfterImport: subscription.routeAfterImport,
      intervalMinutes: subscription.intervalMinutes,
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
        connectors: state.connectors,
        saved: response.body.subscriptions,
        drafts: Object.freeze(response.body.subscriptions.map(toWrite)),
      });
      setFeedback({
        kind: 'success',
        title: response.body.status === 'applied' ? '订阅已保存' : '配置未变化',
        detail: '设置已保存。只有开启“定期检查”的订阅才会自动检查更新。',
      });
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
            ? response.body.automationRunId === undefined
              ? response.body.importedDocumentCount === undefined
                ? '新文档已进入导入历史；后续拆分和标签仍由你决定。'
                : `已逐条保存 ${String(response.body.importedDocumentCount)} 个外部记录；后续拆分与标签步骤仍由你单独决定。`
              : `已生成 ${String(response.body.materializedEntryCount ?? 0)} 个条目，并加入“标签”页的待处理列表。`
            : '没有重复导入文档。',
      });
      await load();
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
              支持 GitHub 文档、RSS/Atom、JSON
              API、网页和已安装插件。可以随时手动检查；定期检查默认关闭。
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
          <SourceConnectorCapabilityList connectors={state.connectors} />
          {state.drafts.length === 0 ? (
            <p className="empty-copy">
              尚无订阅。新增后先保存，再执行一次手动检查。
            </p>
          ) : (
            <ol className="source-subscription-list">
              {state.drafts.map((subscription) => {
                const saved = state.saved.find(
                  (candidate) =>
                    candidate.subscriptionId === subscription.subscriptionId,
                );
                return (
                  <li key={subscription.subscriptionId}>
                    <header>
                      <div>
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
                        <span>来源类型</span>
                        <select
                          value={subscription.kind}
                          onChange={(event) => {
                            changeSubscriptionKind(
                              subscription,
                              event.currentTarget
                                .value as SourceSubscriptionWrite['kind'],
                            );
                          }}
                        >
                          <option value="github_markdown">
                            GitHub Markdown 文件
                          </option>
                          <option value="rss_atom">RSS / Atom 订阅</option>
                          <option value="json_api">JSON API</option>
                          <option value="web">受限网页</option>
                          {subscription.kind === 'plugin' ||
                          state.connectors.some(
                            (connector) => connector.origin === 'plugin',
                          ) ? (
                            <option value="plugin">已安装插件</option>
                          ) : null}
                        </select>
                      </label>
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
                              <option value="commonmark-v1">
                                通用 Markdown
                              </option>
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
                              仅 HTTPS RSS/Atom；不会跟随重定向或抓取条目链接。
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
                              仅发出公开 HTTPS GET；不会执行脚本或跟随重定向。
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
                                  recordLimit: Number(
                                    event.currentTarget.value,
                                  ),
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
                                      : Object.freeze({kind: 'none' as const}),
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
                                只保存变量名；令牌不会写入个人配置。
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
                                        queryParameter:
                                          event.currentTarget.value,
                                        responsePath:
                                          subscription.pageCursor
                                            ?.responsePath ?? '',
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
                          {subscription.incrementalCursor ===
                          undefined ? null : (
                            <>
                              <label className="field">
                                <span>增量请求参数</span>
                                <input
                                  value={
                                    subscription.incrementalCursor
                                      .queryParameter
                                  }
                                  onChange={(event) => {
                                    updateDraft(subscription.subscriptionId, {
                                      incrementalCursor: Object.freeze({
                                        queryParameter:
                                          event.currentTarget.value,
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
                : '当前内容已保存。'}
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
        <h2 id="source-subscription-title">信源订阅</h2>
      </div>
    </header>
  );
}

function toWrite(
  subscription: Readonly<SourceSubscriptionView>,
): Readonly<SourceSubscriptionWrite> {
  const common = {
    subscriptionId: subscription.subscriptionId,
    label: subscription.label,
    enabled: subscription.enabled,
    sourceAlias: subscription.sourceAlias,
    isPrivate: subscription.isPrivate,
    routeAfterImport: subscription.routeAfterImport,
    intervalMinutes: subscription.intervalMinutes,
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
  if (code === 'source_too_large') return '来源文件超过 1 MiB 导入上限。';
  if (code === 'source_invalid') {
    return '来源地址、字段设置或返回内容不符合导入要求。';
  }
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
