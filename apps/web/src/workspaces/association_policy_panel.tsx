import {useState} from 'react';
import type {SyntheticEvent} from 'react';

import type {InformationEntryAssociationListResponse} from '../api/m1c_api_contract.js';

type AssociationPolicy = Extract<
  InformationEntryAssociationListResponse,
  {status: 'ok'}
>['policy'];

export interface AssociationPolicyDraft {
  readonly contentWeight: number;
  readonly typeWeight: number;
  readonly domainWeight: number;
  readonly threshold: number;
}

export function AssociationPolicyPanel({
  onSave,
  policy,
  saving,
}: {
  readonly onSave: (draft: Readonly<AssociationPolicyDraft>) => void;
  readonly policy: Readonly<AssociationPolicy>;
  readonly saving: boolean;
}) {
  const [draft, setDraft] = useState<AssociationPolicyDraft>(() =>
    policyDraft(policy),
  );

  const totalWeight =
    draft.contentWeight + draft.typeWeight + draft.domainWeight;
  const valid = totalWeight === 100;

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || saving) return;
    onSave(Object.freeze({...draft}));
  }

  return (
    <aside
      className="association-policy-panel"
      aria-labelledby="association-policy-title"
    >
      <header>
        <div>
          <p className="section-index">SCORING PARAMETERS</p>
          <h3 id="association-policy-title">联系策略权重</h3>
        </div>
        <span>修订 {policy.revision.toString()}</span>
      </header>
      <form onSubmit={submit}>
        <PolicyControl
          label="内容相似度"
          value={draft.contentWeight}
          maximum={100}
          onChange={(contentWeight) => {
            setDraft((current) => ({...current, contentWeight}));
          }}
        />
        <PolicyControl
          label="类型相似度"
          value={draft.typeWeight}
          maximum={100}
          onChange={(typeWeight) => {
            setDraft((current) => ({...current, typeWeight}));
          }}
        />
        <PolicyControl
          label="领域相似度"
          value={draft.domainWeight}
          maximum={100}
          onChange={(domainWeight) => {
            setDraft((current) => ({...current, domainWeight}));
          }}
        />
        <PolicyControl
          label="候选最低分"
          value={draft.threshold}
          maximum={10_000}
          step={100}
          percent
          onChange={(threshold) => {
            setDraft((current) => ({...current, threshold}));
          }}
        />
        <p
          className={
            valid
              ? 'association-policy-total'
              : 'association-policy-total association-policy-total--invalid'
          }
          role={valid ? 'status' : 'alert'}
        >
          三项相似度权重合计 {totalWeight.toString()}%；保存要求恰好为 100%。
        </p>
        <dl>
          <div>
            <dt>每条候选上限</dt>
            <dd>{policy.candidateLimit.toString()}</dd>
          </div>
          <div>
            <dt>人工调整步长</dt>
            <dd>{(policy.adjustmentStep / 100).toFixed(0)}%</dd>
          </div>
        </dl>
        <div className="association-policy-actions">
          <button
            className="primary-action"
            type="submit"
            disabled={!valid || saving}
          >
            {saving ? '保存并重建中…' : '保存权重并重建联系'}
          </button>
        </div>
        <p>
          权重保存在外部个人配置中；保存后只重算自动候选，人工增强、削弱、屏蔽和图谱关系不会被覆盖。
        </p>
      </form>
    </aside>
  );
}

function PolicyControl({
  label,
  maximum,
  onChange,
  percent = false,
  step = 1,
  value,
}: {
  readonly label: string;
  readonly maximum: number;
  readonly onChange: (value: number) => void;
  readonly percent?: boolean;
  readonly step?: number;
  readonly value: number;
}) {
  const display = percent
    ? `${(value / 100).toFixed(0)}%`
    : `${value.toString()}%`;
  return (
    <div className="association-policy-meter">
      <label>
        <span>{label}</span>
        <output>{display}</output>
        <input
          type="range"
          min={0}
          max={maximum}
          step={step}
          value={value}
          onChange={(event) => {
            onChange(Number(event.currentTarget.value));
          }}
        />
      </label>
      <label className="association-policy-number">
        <span>{label}数值</span>
        <input
          type="number"
          min={0}
          max={maximum}
          step={step}
          value={value}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isSafeInteger(next)) onChange(next);
          }}
        />
      </label>
    </div>
  );
}

function policyDraft(
  policy: Readonly<AssociationPolicy>,
): AssociationPolicyDraft {
  return {
    contentWeight: policy.contentWeight,
    typeWeight: policy.typeWeight,
    domainWeight: policy.domainWeight,
    threshold: policy.threshold,
  };
}
