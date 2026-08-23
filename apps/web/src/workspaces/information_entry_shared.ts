import type {
  EntryDomainKeyword,
  EntryTypeKeyword,
} from '../api/m1c_api_contract.js';

export const TYPE_LABELS: Readonly<Record<EntryTypeKeyword, string>> = {
  factual_material: '纪实资料',
  knowledge_explanation: '知识解释',
  operating_guideline: '操作规范',
  investigation_analysis: '调查分析',
  argument: '观点论证',
  personal_experience: '个人体验',
  interactive_collaboration: '互动协作',
  public_communication: '公共传播',
  literary_creation: '文学创作',
  other: '其他',
};

export const DOMAIN_LABELS: Readonly<Record<EntryDomainKeyword, string>> = {
  mathematics_formal: '数理与形式系统',
  nature_environment: '自然与环境',
  engineering_computing: '工程、计算与技术',
  life_health: '生命、医学与健康',
  society_public_affairs: '社会与公共事务',
  economy_business: '经济、商业与组织',
  law_policy_governance: '法律、政策与治理',
  humanities_history: '人文、历史与思想',
  language_education: '语言、传播与教育',
  culture_arts: '文化、艺术与娱乐',
  daily_life: '日常生活、个人与家庭',
  other: '其他',
};

export function describeInformationEntryFailure(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '返回协议无法识别。';
  const issue = Reflect.get(value, 'issue') as unknown;
  if (typeof issue !== 'object' || issue === null) return '返回协议无法识别。';
  const code: unknown = Reflect.get(issue, 'code');
  return typeof code === 'string' ? code : 'unknown_failure';
}
