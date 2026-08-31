import type {
  EntryDomainAssignment,
  EntryDomainKeyword,
  EntryTypeKeyword,
} from './information_entry_contract.js';

export const DETERMINISTIC_ENTRY_CLASSIFICATION_RULE_VERSION =
  'struinfo.entry-classification.deterministic.v1';

interface WeightedRule<TKeyword extends string> {
  readonly keyword: TKeyword;
  readonly signals: readonly Readonly<{
    readonly pattern: RegExp;
    readonly weight: number;
  }>[];
}

const TYPE_RULES: readonly WeightedRule<EntryTypeKeyword>[] = [
  rule('operating_guideline', [
    signal(
      /(?:教程|指南|入门|安装|配置|操作步骤|使用方法|how[ -]to|tutorial|guide|getting started)/iu,
      3,
    ),
    signal(/(?:实践|示例|命令行|quickstart|walkthrough)/iu, 1),
  ]),
  rule('investigation_analysis', [
    signal(
      /(?:调查|分析|研究报告|评测|基准测试|benchmark|analysis|research|survey)/iu,
      3,
    ),
    signal(/(?:数据表明|实验结果|对比测试|case study)/iu, 1),
  ]),
  rule('knowledge_explanation', [
    signal(
      /(?:原理|解释|为什么|是什么|概念|机制|explained|explanation|what is|how .* works)/iu,
      3,
    ),
    signal(/(?:基础知识|概览|overview|introduction)/iu, 1),
  ]),
  rule('public_communication', [
    signal(
      /(?:发布公告|正式发布|宣布|公告|新闻稿|press release|announc(?:e|ed|ement)|released?)/iu,
      3,
    ),
    signal(/(?:版本更新|上线|launch(?:ed)?)/iu, 1),
  ]),
  rule('argument', [
    signal(
      /(?:观点|评论|主张|争论|反驳|我认为|作者认为|opinion|argu(?:e|ment)|commentary)/iu,
      3,
    ),
    signal(/(?:应该|不应该|利弊|pros and cons)/iu, 1),
  ]),
  rule('personal_experience', [
    signal(
      /(?:亲历|经历|体验|复盘|访谈|采访|interview|my experience|journey|retrospective)/iu,
      3,
    ),
    signal(/(?:故事|回忆|心得)/iu, 1),
  ]),
  rule('interactive_collaboration', [
    signal(
      /(?:讨论|问答|圆桌|协作|对话|discussion|q&a|roundtable|collaboration)/iu,
      3,
    ),
  ]),
  rule('literary_creation', [
    signal(/(?:小说|诗歌|散文|文学作品|fiction|novel|poem|short story)/iu, 3),
  ]),
  rule('factual_material', [
    signal(
      /(?:数据集|资料汇总|事实记录|统计数据|dataset|reference data|statistics)/iu,
      3,
    ),
  ]),
];

const DOMAIN_RULES: readonly WeightedRule<EntryDomainKeyword>[] = [
  rule('engineering_computing', [
    signal(
      /(?:软件|编程|代码|开发者|数据库|服务器|网络协议|人工智能|机器学习|开源|programming|software|developer|database|server|api|javascript|typescript|python|linux|docker|github|machine learning|\bai\b)/iu,
      3,
    ),
    signal(
      /(?:算法|框架|浏览器|操作系统|芯片|硬件|cloud|web|mobile|security)/iu,
      1,
    ),
  ]),
  rule('mathematics_formal', [
    signal(
      /(?:数学|定理|证明|概率|统计学|几何|代数|逻辑学|mathematics|theorem|proof|probability|geometry|algebra)/iu,
      3,
    ),
  ]),
  rule('life_health', [
    signal(
      /(?:医学|医疗|健康|疾病|药物|生物学|基因|营养|medicine|health|disease|biology|genetic|nutrition)/iu,
      3,
    ),
  ]),
  rule('nature_environment', [
    signal(
      /(?:气候|环境|生态|动物|植物|地理|海洋|天文|物理学|化学|climate|environment|ecology|astronomy|physics|chemistry)/iu,
      3,
    ),
  ]),
  rule('economy_business', [
    signal(
      /(?:经济|商业|公司|市场|金融|投资|创业|管理|economy|business|company|market|finance|investment|startup)/iu,
      3,
    ),
  ]),
  rule('law_policy_governance', [
    signal(
      /(?:法律|法规|政策|治理|监管|法院|版权|隐私法|law|legal|policy|regulation|governance|court|copyright)/iu,
      3,
    ),
  ]),
  rule('society_public_affairs', [
    signal(
      /(?:社会|公共事务|人口|城市|社区|媒体|新闻|society|public affairs|population|urban|community|journalism)/iu,
      3,
    ),
  ]),
  rule('humanities_history', [
    signal(
      /(?:历史|哲学|宗教|考古|人类学|history|philosophy|religion|archaeology|anthropology)/iu,
      3,
    ),
  ]),
  rule('language_education', [
    signal(
      /(?:语言|教育|学习|教学|学校|课程|翻译|language|education|learning|teaching|school|translation)/iu,
      3,
    ),
  ]),
  rule('culture_arts', [
    signal(
      /(?:文化|艺术|设计|电影|音乐|摄影|绘画|文学|culture|art|design|film|music|photography|literature)/iu,
      3,
    ),
  ]),
  rule('daily_life', [
    signal(
      /(?:生活|家庭|旅行|饮食|家居|消费|life|family|travel|food|home|consumer)/iu,
      3,
    ),
  ]),
];

export interface DeterministicEntryClassificationInput {
  readonly titlePath: string;
  readonly body: string;
  readonly contentKeywords: readonly string[];
}

export interface DeterministicEntryClassification {
  readonly typeKeyword?: EntryTypeKeyword;
  readonly domains: readonly Readonly<EntryDomainAssignment>[];
}

export function classifyInformationEntryDeterministically(
  input: Readonly<DeterministicEntryClassificationInput>,
): Readonly<DeterministicEntryClassification> {
  const text = normalizeClassificationText(input);
  const typeKeyword = selectUniqueWinner(TYPE_RULES, text);
  const domainKeyword = selectUniqueWinner(DOMAIN_RULES, text);
  return Object.freeze({
    ...(typeKeyword === undefined ? {} : {typeKeyword}),
    domains:
      domainKeyword === undefined
        ? Object.freeze([])
        : Object.freeze([
            Object.freeze({
              keyword: domainKeyword,
              origin: 'rule' as const,
              originVersion: DETERMINISTIC_ENTRY_CLASSIFICATION_RULE_VERSION,
            }),
          ]),
  });
}

function normalizeClassificationText(
  input: Readonly<DeterministicEntryClassificationInput>,
): string {
  return [
    input.titlePath,
    input.titlePath,
    ...input.contentKeywords,
    input.body.slice(0, 32_000),
  ]
    .join('\n')
    .normalize('NFKC')
    .toLocaleLowerCase('und');
}

function selectUniqueWinner<TKeyword extends string>(
  rules: readonly WeightedRule<TKeyword>[],
  text: string,
): TKeyword | undefined {
  const scored = rules
    .map((candidate) => ({
      keyword: candidate.keyword,
      score: candidate.signals.reduce(
        (total, item) => total + (item.pattern.test(text) ? item.weight : 0),
        0,
      ),
    }))
    .filter((candidate) => candidate.score >= 3)
    .sort(
      (left, right) =>
        right.score - left.score || left.keyword.localeCompare(right.keyword),
    );
  const first = scored[0];
  const second = scored[1];
  return first !== undefined &&
    (second === undefined || first.score > second.score)
    ? first.keyword
    : undefined;
}

function rule<TKeyword extends string>(
  keyword: TKeyword,
  signals: readonly Readonly<{pattern: RegExp; weight: number}>[],
): Readonly<WeightedRule<TKeyword>> {
  return Object.freeze({keyword, signals: Object.freeze([...signals])});
}

function signal(pattern: RegExp, weight: number) {
  return Object.freeze({pattern, weight});
}
