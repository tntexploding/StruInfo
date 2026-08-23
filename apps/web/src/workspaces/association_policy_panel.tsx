import type {InformationEntryAssociationListResponse} from '../api/m1c_api_contract.js';

type AssociationPolicy = Extract<
  InformationEntryAssociationListResponse,
  {status: 'ok'}
>['policy'];

export function AssociationPolicyPanel({
  policy,
}: {
  readonly policy: Readonly<AssociationPolicy>;
}) {
  return (
    <aside
      className="association-policy-panel"
      aria-labelledby="association-policy-title"
    >
      <header>
        <div>
          <p className="section-index">SCORING PARAMETERS</p>
          <h3 id="association-policy-title">联系参数</h3>
        </div>
        <span>{policy.version}</span>
      </header>
      <PolicyMeter
        label="内容相似度权重"
        value={policy.contentWeight}
        maximum={100}
      />
      <PolicyMeter
        label="类型相似度权重"
        value={policy.typeWeight}
        maximum={100}
      />
      <PolicyMeter
        label="领域相似度权重"
        value={policy.domainWeight}
        maximum={100}
      />
      <PolicyMeter
        label="候选最低分"
        value={policy.threshold}
        maximum={10_000}
        percent
      />
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
      <p>
        当前版本只读显示已生效策略。可在候选上直接增强、削弱或屏蔽；全局权重写入接口尚未开放，因此这里不会提供无效滑块。
      </p>
    </aside>
  );
}

function PolicyMeter({
  label,
  maximum,
  percent = false,
  value,
}: {
  readonly label: string;
  readonly maximum: number;
  readonly percent?: boolean;
  readonly value: number;
}) {
  const display = percent ? `${(value / 100).toFixed(0)}%` : value.toString();
  return (
    <div className="association-policy-meter">
      <label>
        <span>{label}</span>
        <output>{display}</output>
        <input
          type="range"
          min={0}
          max={maximum}
          value={value}
          aria-readonly="true"
          disabled
          readOnly
        />
      </label>
    </div>
  );
}
