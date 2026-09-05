import {useCallback, useEffect, useRef, useState} from 'react';

import type {
  InformationEntry,
  InformationEntryAssociationAction,
  InformationEntryAssociationListResponse,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import type {ActionFeedback} from '../components/product_types.js';
import {
  AssociationPolicyPanel,
  type AssociationPolicyDraft,
} from './association_policy_panel.js';
import type {InformationEntryServices} from './information_entry_components.js';
import {describeInformationEntryFailure} from './information_entry_shared.js';
import {createLatestRequestTracker} from './latest_request.js';

type AssociationViewState =
  | Readonly<{status: 'loading'}>
  | Readonly<{
      status: 'ready';
      response: Extract<
        InformationEntryAssociationListResponse,
        {status: 'ok'}
      >;
    }>
  | Readonly<{status: 'error'; message: string}>;

export function InformationEntryAssociationPanel({
  entry,
  targetEntry,
  includePrivate,
  onList,
  onOpenEvidence,
  onRebuild,
  onRevisePolicy,
  onRevise,
  onSelectRelated,
  onSearchNeighborhood,
}: {
  readonly entry: Readonly<InformationEntry>;
  readonly targetEntry: Readonly<InformationEntry> | undefined;
  readonly includePrivate: boolean;
  readonly onList: InformationEntryServices['onListAssociations'];
  readonly onOpenEvidence: InformationEntryServices['onOpenEvidence'];
  readonly onRebuild: InformationEntryServices['onRebuildAssociations'];
  readonly onRevisePolicy: InformationEntryServices['onReviseAssociationPolicy'];
  readonly onRevise: InformationEntryServices['onReviseAssociation'];
  readonly onSelectRelated: (entry: Readonly<InformationEntry>) => void;
  readonly onSearchNeighborhood: () => void;
}) {
  const [view, setView] = useState<AssociationViewState>({status: 'loading'});
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const [rebuilding, setRebuilding] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [updatingId, setUpdatingId] = useState<string>();
  const listRequests = useRef(createLatestRequestTracker());

  const refresh = useCallback(async () => {
    const requestId = listRequests.current.begin();
    setView({status: 'loading'});
    try {
      const response = await onList(entry.entryId, includePrivate);
      if (!listRequests.current.isCurrent(requestId)) return;
      if (response.body.status !== 'ok') {
        setView({
          status: 'error',
          message: describeInformationEntryFailure(response.body),
        });
        return;
      }
      setView({status: 'ready', response: response.body});
    } catch {
      if (!listRequests.current.isCurrent(requestId)) return;
      setView({
        status: 'error',
        message: '无法读取相关内容；条目和人工设置没有被修改。',
      });
    }
  }, [entry.entryId, includePrivate, onList]);

  useEffect(() => {
    const tracker = listRequests.current;
    let cancelled = false;
    globalThis.queueMicrotask(() => {
      if (!cancelled) void refresh();
    });
    return () => {
      cancelled = true;
      tracker.invalidate();
    };
  }, [refresh]);

  async function rebuild() {
    if (rebuilding) return;
    setRebuilding(true);
    setFeedback(undefined);
    try {
      const response = await onRebuild({includePrivate});
      if (response.body.status !== 'rebuilt') {
        setFeedback({
          kind: 'error',
          title: '关联没有重建',
          detail: describeInformationEntryFailure(response.body),
        });
        return;
      }
      setFeedback({
        kind: 'success',
        title: '推荐联系已更新',
        detail: `${response.body.entryCount.toString()} 个条目生成 ${response.body.projectedCount.toString()} 条推荐联系；人工设置保持不变。`,
      });
      await refresh();
    } catch {
      setFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '自动联系没有变化；人工设置保持不变。',
      });
    } finally {
      setRebuilding(false);
    }
  }

  async function savePolicy(draft: Readonly<AssociationPolicyDraft>) {
    if (savingPolicy || view.status !== 'ready') return;
    setSavingPolicy(true);
    setFeedback(undefined);
    try {
      const saved = await onRevisePolicy({
        expectedRevision: view.response.policy.revision,
        ...draft,
      });
      if (
        saved.body.status !== 'applied' &&
        saved.body.status !== 'unchanged'
      ) {
        setFeedback({
          kind: 'error',
          title: '联系设置没有保存',
          detail: describeInformationEntryFailure(saved.body),
        });
        return;
      }
      if (saved.body.status === 'unchanged') {
        setFeedback({
          kind: 'success',
          title: '联系设置没有变化',
          detail: '自动推荐继续使用现有权重；人工设置保持不变。',
        });
        return;
      }
      const rebuilt = await onRebuild({includePrivate});
      if (rebuilt.body.status !== 'rebuilt') {
        setFeedback({
          kind: 'error',
          title: '设置已保存，但推荐联系尚未更新',
          detail:
            '联系权重已经保存；服务恢复后请再次更新推荐联系。人工设置不受影响。',
        });
        await refresh();
        return;
      }
      setFeedback({
        kind: 'success',
        title: '联系设置已保存并生效',
        detail: `${rebuilt.body.entryCount.toString()} 个条目已按新权重生成 ${rebuilt.body.projectedCount.toString()} 条推荐联系；人工设置保持不变。`,
      });
      await refresh();
    } catch {
      setFeedback({
        kind: 'error',
        title: '联系设置没有完整应用',
        detail:
          '本地服务当前不可达。重试后可确认设置是否保存；人工联系保持不变。',
      });
    } finally {
      setSavingPolicy(false);
    }
  }

  async function revise(
    relatedEntryId: string,
    expectedRevision: number,
    action: InformationEntryAssociationAction,
  ) {
    if (updatingId !== undefined) return;
    setUpdatingId(relatedEntryId);
    setFeedback(undefined);
    try {
      const response = await onRevise(entry.entryId, relatedEntryId, {
        expectedRevision,
        action,
        includePrivate,
      });
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        setFeedback({
          kind: 'error',
          title: '人工关联决定没有保存',
          detail: describeInformationEntryFailure(response.body),
        });
        return;
      }
      setFeedback({
        kind: 'success',
        title: '人工关联决定已保存',
        detail: `${associationActionLabel(action)}已保存为当前人工控制，后续重算不会覆盖。`,
      });
      await refresh();
    } catch {
      setFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '人工关联决定没有保存。',
      });
    } finally {
      setUpdatingId(undefined);
    }
  }

  const headingId = `entry-association-title-${entry.entryId}`;
  const targetedAssociation =
    view.status === 'ready' && targetEntry !== undefined
      ? view.response.associations.find(
          ({relatedEntry}) => relatedEntry.entryId === targetEntry.entryId,
        )
      : undefined;
  return (
    <section className="entry-association-panel" aria-labelledby={headingId}>
      <header className="console-heading">
        <div>
          <h2 id={headingId}>可能相关</h2>
          <p>根据内容、类型和领域推荐相似条目。结果只表示相似，不代表事实。</p>
        </div>
        <span className="record-count">
          {view.status === 'ready'
            ? `${view.response.totalCount.toString()} 条`
            : '读取中'}
        </span>
      </header>

      <section className="association-pair-editor" aria-label="联系编辑">
        <article>
          <span>起点</span>
          <strong>{entry.value.titlePath || '未命名条目'}</strong>
        </article>
        <div aria-hidden="true">↔</div>
        <article>
          <span>终点</span>
          <strong>
            {targetEntry?.value.titlePath ?? '从右侧选择一个条目'}
          </strong>
        </article>
        <div className="association-pair-editor__actions">
          <button
            className="primary-action"
            type="button"
            disabled={targetEntry === undefined || updatingId !== undefined}
            onClick={() => {
              if (targetEntry === undefined) return;
              void revise(
                targetEntry.entryId,
                targetedAssociation?.override?.revision ?? 0,
                'enhance',
              );
            }}
          >
            {targetedAssociation === undefined ? '保存新联系' : '增强此联系'}
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={targetEntry === undefined || updatingId !== undefined}
            onClick={() => {
              if (targetEntry === undefined) return;
              void revise(
                targetEntry.entryId,
                targetedAssociation?.override?.revision ?? 0,
                'weaken',
              );
            }}
          >
            削弱
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={targetEntry === undefined || updatingId !== undefined}
            onClick={() => {
              if (targetEntry === undefined) return;
              void revise(
                targetEntry.entryId,
                targetedAssociation?.override?.revision ?? 0,
                'block',
              );
            }}
          >
            屏蔽
          </button>
        </div>
      </section>

      <div className="entry-association-toolbar">
        <p>
          {includePrivate
            ? '当前会显示隐私条目及其联系。'
            : '当前不显示隐私条目及其联系。'}
        </p>
        <div className="entry-association-toolbar__actions">
          <button
            className="secondary-action"
            type="button"
            onClick={onSearchNeighborhood}
          >
            从此条目展开
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={rebuilding}
            onClick={() => void rebuild()}
          >
            {rebuilding ? '正在更新…' : '更新推荐联系'}
          </button>
        </div>
      </div>
      <ActionNotice feedback={feedback} />

      <div className="entry-association-state" aria-live="polite">
        {view.status === 'loading' ? (
          <p className="entry-association-message">正在读取相关内容…</p>
        ) : view.status === 'error' ? (
          <div className="entry-association-message" role="alert">
            <p>{view.message}</p>
            <button
              className="text-action"
              type="button"
              onClick={() => void refresh()}
            >
              重试
            </button>
          </div>
        ) : view.response.associations.length === 0 ? (
          <div className="entry-association-message">
            <p>当前还没有达到最低分的推荐联系。</p>
            <small>先为多个条目设置内容、类型和领域标签，再重建联系。</small>
          </div>
        ) : (
          <ul className="entry-association-list">
            {view.response.associations.map((association) => {
              const related = association.relatedEntry;
              const overrideRevision = association.override?.revision ?? 0;
              const busy = updatingId === related.entryId;
              return (
                <li key={related.entryId} data-blocked={association.isBlocked}>
                  <article>
                    <header>
                      <div>
                        <span className="entry-association-score">
                          {association.isBlocked
                            ? '已屏蔽'
                            : `${scorePercentage(association.effectiveScore)}%`}
                        </span>
                        <h3>{related.value.titlePath || '未命名条目'}</h3>
                        <small>
                          {related.sourceKey} · v{related.revision.toString()}
                          {related.value.isPrivate ? ' · 私密' : ''}
                        </small>
                      </div>
                      <button
                        className="text-action"
                        type="button"
                        onClick={() => {
                          onOpenEvidence(
                            related.snapshotId,
                            related.value.fragmentIds[0],
                            related.value.isPrivate,
                          );
                        }}
                      >
                        查看来源
                      </button>
                    </header>
                    <p className="entry-association-excerpt">
                      {excerpt(related.value.body)}
                    </p>
                    <dl className="entry-association-metrics">
                      <div>
                        <dt>内容</dt>
                        <dd>
                          {scorePercentage(
                            association.projection?.contentSimilarity ?? 0,
                          )}
                          %
                        </dd>
                      </div>
                      <div>
                        <dt>类型</dt>
                        <dd>
                          {scorePercentage(
                            association.projection?.typeSimilarity ?? 0,
                          )}
                          %
                        </dd>
                      </div>
                      <div>
                        <dt>领域</dt>
                        <dd>
                          {scorePercentage(
                            association.projection?.domainSimilarity ?? 0,
                          )}
                          %
                        </dd>
                      </div>
                      <div>
                        <dt>自动匹配分</dt>
                        <dd>
                          {scorePercentage(
                            association.projection?.baseScore ?? 0,
                          )}
                          %
                        </dd>
                      </div>
                    </dl>
                    <div
                      className="entry-association-basis"
                      aria-label="推荐原因"
                    >
                      {(association.projection?.candidateBasis ?? []).map(
                        (basis) => (
                          <span key={basis}>
                            {associationBasisLabel(basis)}
                          </span>
                        ),
                      )}
                      {association.override === undefined ? null : (
                        <span data-manual="true">
                          人工：
                          {associationActionLabel(
                            association.override.value.action,
                          )}
                        </span>
                      )}
                    </div>
                    <div className="entry-association-actions">
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => {
                          onSelectRelated(related);
                        }}
                      >
                        载入编辑区
                      </button>
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void revise(
                            related.entryId,
                            overrideRevision,
                            'enhance',
                          )
                        }
                      >
                        增强
                      </button>
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void revise(
                            related.entryId,
                            overrideRevision,
                            'weaken',
                          )
                        }
                      >
                        削弱
                      </button>
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={busy || association.isBlocked}
                        onClick={() =>
                          void revise(
                            related.entryId,
                            overrideRevision,
                            'block',
                          )
                        }
                      >
                        屏蔽
                      </button>
                      <button
                        className="text-action"
                        type="button"
                        disabled={
                          busy ||
                          association.override === undefined ||
                          association.override.value.action === 'restore'
                        }
                        onClick={() =>
                          void revise(
                            related.entryId,
                            overrideRevision,
                            'restore',
                          )
                        }
                      >
                        恢复自动结果
                      </button>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {view.status === 'ready' ? (
        <section className="association-policy-dock" aria-label="联系权重">
          <AssociationPolicyPanel
            key={view.response.policy.revision}
            policy={view.response.policy}
            saving={savingPolicy}
            onSave={(draft) => {
              void savePolicy(draft);
            }}
          />
        </section>
      ) : null}
    </section>
  );
}
function associationActionLabel(
  value: InformationEntryAssociationAction,
): string {
  switch (value) {
    case 'enhance':
      return '增强';
    case 'weaken':
      return '削弱';
    case 'block':
      return '屏蔽';
    case 'restore':
      return '恢复自动结果';
  }
}

function associationBasisLabel(value: string): string {
  switch (value) {
    case 'content_keyword':
      return '内容词';
    case 'text_term':
      return '本地正文';
    case 'type_keyword':
      return '类型';
    case 'domain_keyword':
      return '领域';
    case 'manual_override':
      return '人工决定';
    default:
      return value;
  }
}

function scorePercentage(value: number): string {
  return (value / 100).toFixed(value % 100 === 0 ? 0 : 1);
}

function excerpt(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}…`;
}
