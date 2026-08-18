import type {
  AssessmentDimension,
  EpistemicRole,
  IntakeAction,
  IntakeReason,
  KnowledgeKind,
  KnowledgeReviewState,
} from '../api/m1c_api_contract.js';

export const KNOWLEDGE_KIND_LABELS: Readonly<Record<KnowledgeKind, string>> = {
  entity: '实体',
  concept: '概念',
  assertion: '论断',
  event: '事件',
  method: '方法',
  framework: '框架',
  resource: '资源',
  work: '作品',
};

export const EPISTEMIC_ROLE_LABELS: Readonly<Record<EpistemicRole, string>> = {
  source_claim: '来源主张',
  summary: '人工摘要',
  inference: '人工推论',
  user_assertion: '用户断言',
};

export const REVIEW_STATE_LABELS: Readonly<
  Record<KnowledgeReviewState, string>
> = {
  draft: '草稿',
  pending_review: '待审核',
  confirmed: '用户已确认',
  disputed: '有争议',
  rejected: '已驳回',
  withdrawn: '已撤回',
};

export const INTAKE_ACTION_LABELS: Readonly<Record<IntakeAction, string>> = {
  full: '完整处理',
  split: '拆分入库',
  condense: '压缩入库',
  source_only: '仅保留来源',
  ignore: '忽略',
  needs_review: '待定',
};

export const INTAKE_REASON_LABELS: Readonly<Record<IntakeReason, string>> = {
  already_known: '已经知道',
  low_information_value: '信息量低',
  high_noise_or_marketing: '噪声或营销内容多',
  unreliable_source: '来源不可靠',
  insufficient_evidence: '证据不足',
  temporarily_not_needed: '暂时不需要',
  not_interested: '当前不感兴趣',
  worth_exploring: '陌生但值得探索',
  recommendation_direction_right_sample_wrong: '方向正确但样本不合适',
  other: '其他',
};

export const ASSESSMENT_LABELS: Readonly<Record<AssessmentDimension, string>> =
  {
    information_density: '信息密度',
    breadth: '覆盖广度',
    depth: '内容深度',
    current_interest: '当前兴趣',
    serendipity: '意外发现价值',
    noise_marketing: '噪声 / 营销',
    source_reliability: '来源可靠性',
  };
