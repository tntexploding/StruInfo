import {useRef, useState, type SyntheticEvent} from 'react';

import {
  DEFAULT_REVIEW_EXPLORATION_POLICY,
  type InformationEntryExplorationResponse,
  type ReviewExplorationPolicyPreferences,
  type ReviewPreferencesResponse,
} from '../api/m1c_api_contract.js';
import type {Loadable} from '../components/product_types.js';
import type {InformationEntryServices} from './information_entry_components.js';
import type {InformationEntrySearchItem} from './information_entry_query_state.js';

type ExplorationResponse = Extract<
  InformationEntryExplorationResponse,
  {status: 'ok'}
>;

type ExplorationView =
  | Readonly<{status: 'idle'}>
  | Readonly<{status: 'loading'}>
  | Readonly<{status: 'ready'; response: Readonly<ExplorationResponse>}>
  | Readonly<{status: 'error'; message: string}>;

const REASON_LABELS = Object.freeze({
  neighbor_expansion: '邻域扩展',
  cross_domain: '跨领域连接',
  serendipity: '偶然发现',
});

const BASIS_LABELS = Object.freeze({
  content_keyword: '内容关键词',
  text_term: '正文词项',
  type_keyword: '类型',
  domain_keyword: '领域',
});

export interface InformationEntryExplorationProps extends Pick<
  InformationEntryServices,
  'onExplore' | 'onOpenEvidence' | 'onReviseExplorationPolicy'
> {
  readonly includePrivate: boolean;
  readonly onlyPrivate: boolean;
  readonly pageItems: readonly Readonly<InformationEntrySearchItem>[];
  readonly reviewPreferences: Loadable<Readonly<ReviewPreferencesResponse>>;
  readonly selectedItem: Readonly<InformationEntrySearchItem> | undefined;
}

export function InformationEntryExploration({
  includePrivate,
  onlyPrivate,
  onExplore,
  onOpenEvidence,
  onReviseExplorationPolicy,
  pageItems,
  reviewPreferences,
  selectedItem,
}: InformationEntryExplorationProps) {
  const persistedPolicy =
    reviewPreferences.status === 'ready'
      ? (reviewPreferences.value.explorationPolicy ??
        DEFAULT_REVIEW_EXPLORATION_POLICY)
      : DEFAULT_REVIEW_EXPLORATION_POLICY;
  const [draft, setDraft] =
    useState<Readonly<ReviewExplorationPolicyPreferences>>(persistedPolicy);
  const [view, setView] = useState<ExplorationView>({status: 'idle'});
  const [saveState, setSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const requestSequence = useRef(0);

  const isDirty = !samePolicy(draft, persistedPolicy);
  const previewLimit =
    draft.enabled && draft.resultShare > 0
      ? Math.min(12, Math.ceil((pageItems.length * draft.resultShare) / 100))
      : 0;

  async function savePolicy(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reviewPreferences.status !== 'ready' || !isDirty) return;
    setSaveState('saving');
    try {
      const response = await onReviseExplorationPolicy({
        expectedRevision: persistedPolicy.revision,
        enabled: draft.enabled,
        resultShare: draft.resultShare,
        neighborExpansion: draft.neighborExpansion,
        crossDomain: draft.crossDomain,
        serendipity: draft.serendipity,
      });
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        setSaveState('error');
        return;
      }
      setDraft(response.body.policy);
      setSaveState('saved');
      requestSequence.current += 1;
      setView({status: 'idle'});
    } catch {
      setSaveState('error');
    }
  }

  async function loadCandidates(): Promise<void> {
    if (
      selectedItem === undefined ||
      reviewPreferences.status !== 'ready' ||
      isDirty ||
      !draft.enabled ||
      draft.resultShare === 0
    ) {
      return;
    }
    const requestId = ++requestSequence.current;
    setView({status: 'loading'});
    try {
      const response = await onExplore({
        anchorEntryId: selectedItem.entry.entryId,
        excludeEntryIds: pageItems.map((item) => item.entry.entryId),
        pageResultCount: pageItems.length,
        includePrivate,
        onlyPrivate,
      });
      if (requestId !== requestSequence.current) return;
      if (response.body.status !== 'ok') {
        setView({
          status: 'error',
          message:
            response.body.status === 'not_found'
              ? '当前锚点已不在这个可见范围内，请重新查询。'
              : '探索候选没有生成；普通查询结果不受影响。',
        });
        return;
      }
      setView({status: 'ready', response: response.body});
    } catch {
      if (requestId !== requestSequence.current) return;
      setView({
        status: 'error',
        message: '探索接口当前不可达；普通查询结果不受影响。',
      });
    }
  }

  return (
    <section
      className="entry-exploration"
      aria-labelledby="entry-exploration-title"
    >
      <header className="console-heading">
        <div>
          <p className="section-index">EXPLORATION / LOCAL</p>
          <h2 id="entry-exploration-title">探索候选</h2>
        </div>
        <span className="origin-label origin-label--deterministic">
          本地联系 · 独立于搜索排序
        </span>
      </header>

      <p className="entry-exploration__boundary">
        只从当前选中条目的可见直接联系中挑选，不插入普通结果，也不代表事实关系或
        AI 推荐。
      </p>

      {reviewPreferences.status === 'loading' ? (
        <p className="entry-exploration__notice" aria-live="polite">
          正在读取外部探索策略…
        </p>
      ) : reviewPreferences.status === 'error' ? (
        <p className="entry-exploration__notice" role="alert">
          无法读取外部探索策略；普通查询仍可继续使用。
        </p>
      ) : reviewPreferences.status === 'empty' ? (
        <p className="entry-exploration__notice" role="alert">
          当前工作区没有可用的探索策略记录。
        </p>
      ) : (
        <form
          className="entry-exploration-policy"
          onSubmit={(event) => {
            void savePolicy(event);
          }}
        >
          <label className="entry-exploration-policy__toggle">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => {
                setDraft({...draft, enabled: event.currentTarget.checked});
                setSaveState('idle');
              }}
            />
            <span>
              <strong>启用独立探索</strong>
              <small>默认关闭；关闭时不会生成候选。</small>
            </span>
          </label>
          <label className="field">
            <span>当前页探索份额</span>
            <input
              type="number"
              min={0}
              max={50}
              step={1}
              value={draft.resultShare}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  resultShare: Number(event.currentTarget.value),
                });
                setSaveState('idle');
              }}
            />
            <small>
              允许 0–50%；按当前页折算，本次最多 {previewLimit.toString()} 条。
            </small>
          </label>
          <fieldset className="entry-exploration-policy__reasons">
            <legend>允许的探索类型</legend>
            <ExplorationReasonToggle
              checked={draft.neighborExpansion}
              label="邻域扩展"
              description="保留同领域或人工建立的直接联系。"
              onChange={(checked) => {
                setDraft({...draft, neighborExpansion: checked});
                setSaveState('idle');
              }}
            />
            <ExplorationReasonToggle
              checked={draft.crossDomain}
              label="跨领域连接"
              description="两个端点具有不同的首要领域。"
              onChange={(checked) => {
                setDraft({...draft, crossDomain: checked});
                setSaveState('idle');
              }}
            />
            <ExplorationReasonToggle
              checked={draft.serendipity}
              label="偶然发现"
              description="来自另一文档、仅由本地正文词项联系。"
              onChange={(checked) => {
                setDraft({...draft, serendipity: checked});
                setSaveState('idle');
              }}
            />
          </fieldset>
          <div className="entry-exploration-policy__actions">
            <span aria-live="polite">
              {saveState === 'saved'
                ? '策略已保存到外部个人配置。'
                : saveState === 'error'
                  ? '策略未保存，请重试。'
                  : isDirty
                    ? '有尚未保存的修改。'
                    : `策略修订 ${persistedPolicy.revision.toString()}`}
            </span>
            <button
              className="secondary-action"
              type="submit"
              disabled={!isDirty || saveState === 'saving'}
            >
              {saveState === 'saving' ? '保存中…' : '保存探索策略'}
            </button>
          </div>
        </form>
      )}

      <div className="entry-exploration__run">
        <div>
          <strong>
            {selectedItem === undefined
              ? '请先选择一个普通查询结果'
              : selectedItem.entry.value.titlePath || '未命名条目'}
          </strong>
          <span>
            {previewLimit === 0
              ? '当前策略不会产生候选'
              : `本次最多返回 ${previewLimit.toString()} 条`}
          </span>
        </div>
        <button
          className="primary-action"
          type="button"
          disabled={
            selectedItem === undefined ||
            reviewPreferences.status !== 'ready' ||
            isDirty ||
            !draft.enabled ||
            draft.resultShare === 0 ||
            view.status === 'loading'
          }
          onClick={() => void loadCandidates()}
        >
          {view.status === 'loading' ? '生成中…' : '生成探索候选'}
        </button>
      </div>

      {isDirty ? (
        <p className="entry-exploration__notice" aria-live="polite">
          请先保存策略，再按已保存版本生成候选。
        </p>
      ) : view.status === 'idle' ? (
        <p className="entry-exploration__notice" aria-live="polite">
          探索不会自动运行；选择锚点后由你明确启动。
        </p>
      ) : view.status === 'loading' ? (
        <p className="entry-exploration__notice" aria-live="polite">
          正在本地检查可见联系…
        </p>
      ) : view.status === 'error' ? (
        <p className="entry-exploration__notice" role="alert">
          {view.message}
        </p>
      ) : view.response.items.length === 0 ? (
        <p className="entry-exploration__notice">
          当前锚点在已启用类型中没有页外候选。普通搜索结果保持不变。
        </p>
      ) : (
        <>
          <p className="entry-exploration__summary" aria-live="polite">
            显示 {view.response.items.length.toString()} /{' '}
            {view.response.totalEligibleCount.toString()} 个合格候选 · 策略修订{' '}
            {view.response.policy.revision.toString()}
          </p>
          <div className="entry-exploration-candidates">
            {view.response.items.map((candidate) => (
              <article
                className="entry-exploration-card"
                key={candidate.entry.entryId}
              >
                <header>
                  <span className="entry-exploration-card__reason">
                    {REASON_LABELS[candidate.reason]}
                  </span>
                  <span>
                    联系强度 {(candidate.effectiveScore / 100).toFixed(0)}%
                  </span>
                </header>
                <h3>{candidate.entry.value.titlePath || '未命名条目'}</h3>
                <p>{excerpt(candidate.entry.value.body)}</p>
                <dl>
                  <div>
                    <dt>本地依据</dt>
                    <dd>
                      {candidate.candidateBasis.length === 0
                        ? '人工联系'
                        : candidate.candidateBasis
                            .map((basis) => BASIS_LABELS[basis])
                            .join(' / ')}
                    </dd>
                  </div>
                  <div>
                    <dt>来源范围</dt>
                    <dd>
                      {candidate.differentSnapshot ? '另一文档' : '同一文档'}
                      {candidate.entry.value.isPrivate ? ' · 隐私' : ' · 公开'}
                    </dd>
                  </div>
                </dl>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => {
                    onOpenEvidence(
                      candidate.entry.snapshotId,
                      candidate.entry.value.fragmentIds[0],
                      candidate.entry.value.isPrivate,
                    );
                  }}
                >
                  查看精确来源
                </button>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ExplorationReasonToggle({
  checked,
  description,
  label,
  onChange,
}: {
  readonly checked: boolean;
  readonly description: string;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
      />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}

function samePolicy(
  left: Readonly<ReviewExplorationPolicyPreferences>,
  right: Readonly<ReviewExplorationPolicyPreferences>,
): boolean {
  return (
    left.revision === right.revision &&
    left.enabled === right.enabled &&
    left.resultShare === right.resultShare &&
    left.neighborExpansion === right.neighborExpansion &&
    left.crossDomain === right.crossDomain &&
    left.serendipity === right.serendipity
  );
}

function excerpt(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  const codePoints = Array.from(normalized);
  return codePoints.length <= 180
    ? normalized
    : `${codePoints.slice(0, 177).join('')}…`;
}
