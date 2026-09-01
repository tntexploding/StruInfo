import {
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TYPE_KEYWORDS,
  type EntryChunkMode,
  type EntryDomainAssignment,
  type EntryDomainKeyword,
  type EntryTypeKeyword,
} from './information_entry_contract.js';

export const DETERMINISTIC_ENTRY_CLASSIFICATION_RULE_VERSION =
  'struinfo.entry-classification.deterministic.v4';

export const ENTRY_CLASSIFICATION_PROFILE_FORMAT =
  'struinfo.entry-classification-profile';
export const ENTRY_CLASSIFICATION_PROFILE_VERSION = 1;
export const MAXIMUM_ENTRY_CLASSIFICATION_PROFILE_ALIASES = 256;
export const MAXIMUM_ENTRY_CLASSIFICATION_PROFILE_MAPPINGS = 256;
export const MAXIMUM_ENTRY_CLASSIFICATION_PROFILE_EXCLUSIONS = 256;
export const MAXIMUM_ENTRY_CLASSIFICATION_PROFILE_TERM_CODE_POINTS = 96;

type ClassifiedEntryTypeKeyword = Exclude<EntryTypeKeyword, 'other'>;
type ClassifiedEntryDomainKeyword = Exclude<EntryDomainKeyword, 'other'>;

export interface EntryClassificationAlias {
  readonly source: string;
  readonly canonical: string;
}

export interface EntryClassificationTypeMapping {
  readonly term: string;
  readonly keyword: ClassifiedEntryTypeKeyword;
}

export interface EntryClassificationDomainMapping {
  readonly term: string;
  readonly keyword: ClassifiedEntryDomainKeyword;
}

export interface EntryClassificationProfile {
  readonly format: typeof ENTRY_CLASSIFICATION_PROFILE_FORMAT;
  readonly version: typeof ENTRY_CLASSIFICATION_PROFILE_VERSION;
  readonly revision: number;
  readonly aliases: readonly Readonly<EntryClassificationAlias>[];
  readonly typeMappings: readonly Readonly<EntryClassificationTypeMapping>[];
  readonly domainMappings: readonly Readonly<EntryClassificationDomainMapping>[];
  readonly exclusions: readonly string[];
}

export const DEFAULT_ENTRY_CLASSIFICATION_PROFILE: Readonly<EntryClassificationProfile> =
  Object.freeze({
    format: ENTRY_CLASSIFICATION_PROFILE_FORMAT,
    version: ENTRY_CLASSIFICATION_PROFILE_VERSION,
    revision: 0,
    aliases: Object.freeze([]),
    typeMappings: Object.freeze([]),
    domainMappings: Object.freeze([]),
    exclusions: Object.freeze([]),
  });

export type DeterministicClassificationDiagnosticReason =
  'assigned' | 'no_signal' | 'below_threshold' | 'tied' | 'low_margin';

export interface DeterministicClassificationDiagnostic<
  TKeyword extends string,
> {
  readonly reason: DeterministicClassificationDiagnosticReason;
  readonly winner?: TKeyword;
  readonly winnerScore: number;
  readonly runnerUpScore: number;
}

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
      /(?:教程|指南|操作步骤|使用方法|快速开始|how[ -]to|tutorial|getting started|quickstart|walkthrough)/iu,
      6,
    ),
    signal(/(?:入门|安装|配置|实践|示例|命令行|guide)/iu, 3),
  ]),
  rule('investigation_analysis', [
    signal(
      /(?:调查报告|深入分析|研究报告|评测|基准测试|benchmark|analysis|research report|survey)/iu,
      6,
    ),
    signal(/(?:调查|分析|研究|数据表明|实验结果|对比测试|case study)/iu, 3),
  ]),
  rule('knowledge_explanation', [
    signal(
      /(?:工作原理|原理解析|为什么|是什么|机制解释|explained|explanation|what is|how .* works)/iu,
      6,
    ),
    signal(/(?:原理|解释|概念|机制|基础知识|概览|overview|introduction)/iu, 3),
  ]),
  rule('public_communication', [
    signal(
      /(?:发布公告|正式发布|新闻稿|版本说明|press release|release notes?|announcement)/iu,
      6,
    ),
    signal(/(?:宣布|公告|版本更新|上线|发布|released?|launch(?:ed)?)/iu, 3),
  ]),
  rule('argument', [
    signal(
      /(?:我认为|作者认为|本文主张|反驳|opinion|commentary|argu(?:e|ment))/iu,
      6,
    ),
    signal(/(?:观点|评论|主张|争论|应该|不应该|利弊|pros and cons)/iu, 3),
  ]),
  rule('personal_experience', [
    signal(/(?:亲身经历|个人体验|项目复盘|my experience|retrospective)/iu, 6),
    signal(/(?:亲历|经历|体验|复盘|journey|故事|回忆|心得)/iu, 3),
  ]),
  rule('interactive_collaboration', [
    signal(/(?:访谈|采访|问答|圆桌|interview|q&a|roundtable)/iu, 6),
    signal(/(?:讨论|协作|对话|discussion|collaboration)/iu, 3),
  ]),
  rule('literary_creation', [
    signal(/(?:小说|诗歌|散文|文学作品|fiction|novel|poem|short story)/iu, 6),
  ]),
  rule('factual_material', [
    signal(
      /(?:数据集|资料汇总|事实记录|统计数据|dataset|reference data|statistics)/iu,
      6,
    ),
  ]),
];

const FACTUAL_MATERIAL_NEGATIVE_PATTERN =
  /(?:教程|指南|操作步骤|使用方法|深入分析|调查报告|研究报告|评测|基准测试|我认为|作者认为|本文主张|反驳|发布公告|正式发布|新闻稿|版本说明|亲身经历|个人体验|项目复盘|访谈|采访|问答|圆桌|小说|诗歌|散文|how[ -]to|tutorial|getting started|quickstart|walkthrough|benchmark|analysis|research report|opinion|commentary|press release|release notes?|my experience|retrospective|interview|q&a|roundtable|fiction|novel|poem|short story)/iu;

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
  readonly chunkMode?: EntryChunkMode;
  readonly profile?: Readonly<EntryClassificationProfile>;
  readonly originVersion?: string;
}

export interface DeterministicEntryClassification {
  readonly typeKeyword?: EntryTypeKeyword;
  readonly domains: readonly Readonly<EntryDomainAssignment>[];
  readonly diagnostics: Readonly<{
    type: Readonly<DeterministicClassificationDiagnostic<EntryTypeKeyword>>;
    domain: Readonly<DeterministicClassificationDiagnostic<EntryDomainKeyword>>;
  }>;
}

export function classifyInformationEntryDeterministically(
  input: Readonly<DeterministicEntryClassificationInput>,
): Readonly<DeterministicEntryClassification> {
  const profile = input.profile ?? DEFAULT_ENTRY_CLASSIFICATION_PROFILE;
  const fields = normalizeClassificationFields(input, profile);
  const typeScores = scoreRules(
    TYPE_RULES,
    fields,
    profile.typeMappings,
    input,
  );
  const domainScores = scoreRules(
    DOMAIN_RULES,
    fields,
    profile.domainMappings,
    input,
  );
  const typeDiagnostic = classifyScores<EntryTypeKeyword>(typeScores);
  const domainDiagnostic = classifyScores<EntryDomainKeyword>(domainScores);
  const originVersion =
    input.originVersion ??
    `${DETERMINISTIC_ENTRY_CLASSIFICATION_RULE_VERSION}:profile-${profile.revision.toString()}`;
  const domains =
    domainDiagnostic.reason === 'assigned' &&
    domainDiagnostic.winner !== undefined
      ? Object.freeze(
          selectDomains(domainScores, domainDiagnostic.winner).map((keyword) =>
            Object.freeze({
              keyword,
              origin: 'rule' as const,
              originVersion,
            }),
          ),
        )
      : Object.freeze([]);
  return Object.freeze({
    ...(typeDiagnostic.reason === 'assigned' &&
    typeDiagnostic.winner !== undefined
      ? {typeKeyword: typeDiagnostic.winner}
      : {}),
    domains,
    diagnostics: Object.freeze({
      type: Object.freeze(typeDiagnostic),
      domain: Object.freeze(domainDiagnostic),
    }),
  });
}

export function decodeEntryClassificationProfile(
  value: unknown,
): Readonly<EntryClassificationProfile> | undefined {
  if (
    !isClosedRecord(value, [
      'format',
      'version',
      'revision',
      'aliases',
      'typeMappings',
      'domainMappings',
      'exclusions',
    ]) ||
    value.format !== ENTRY_CLASSIFICATION_PROFILE_FORMAT ||
    value.version !== ENTRY_CLASSIFICATION_PROFILE_VERSION ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0
  ) {
    return undefined;
  }
  const aliases = decodeAliases(value.aliases);
  const typeMappings = decodeMappings(
    value.typeMappings,
    ENTRY_TYPE_KEYWORDS,
    MAXIMUM_ENTRY_CLASSIFICATION_PROFILE_MAPPINGS,
  );
  const domainMappings = decodeMappings(
    value.domainMappings,
    ENTRY_DOMAIN_KEYWORDS,
    MAXIMUM_ENTRY_CLASSIFICATION_PROFILE_MAPPINGS,
  );
  const exclusions = decodeTerms(
    value.exclusions,
    MAXIMUM_ENTRY_CLASSIFICATION_PROFILE_EXCLUSIONS,
  );
  if (
    aliases === undefined ||
    typeMappings === undefined ||
    domainMappings === undefined ||
    exclusions === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    format: ENTRY_CLASSIFICATION_PROFILE_FORMAT,
    version: ENTRY_CLASSIFICATION_PROFILE_VERSION,
    revision: value.revision as number,
    aliases,
    typeMappings,
    domainMappings,
    exclusions,
  });
}

interface ClassificationFields {
  readonly title: string;
  readonly keywords: string;
  readonly body: string;
}

interface ScoredCandidate<TKeyword extends string> {
  readonly keyword: TKeyword;
  readonly score: number;
}

function normalizeClassificationFields(
  input: Readonly<DeterministicEntryClassificationInput>,
  profile: Readonly<EntryClassificationProfile>,
): Readonly<ClassificationFields> {
  return Object.freeze({
    title: applyProfile(input.titlePath, profile),
    keywords: applyProfile(input.contentKeywords.join('\n'), profile),
    body: applyProfile(input.body.slice(0, 32_000), profile),
  });
}

function applyProfile(
  value: string,
  profile: Readonly<EntryClassificationProfile>,
): string {
  let result = replaceAliasesOnce(normalizeTerm(value), profile.aliases);
  for (const exclusion of profile.exclusions) {
    result = replaceLiteral(result, normalizeTerm(exclusion), ' ');
  }
  return result;
}

function replaceAliasesOnce(
  value: string,
  aliases: readonly Readonly<EntryClassificationAlias>[],
): string {
  if (aliases.length === 0) return value;
  const replacements = new Map(
    aliases.map((alias) => [
      normalizeTerm(alias.source),
      normalizeTerm(alias.canonical),
    ]),
  );
  const pattern = new RegExp(
    [...replacements.keys()]
      .sort((left, right) =>
        right.length === left.length
          ? left.localeCompare(right)
          : right.length - left.length,
      )
      .map(escapeRegExp)
      .join('|'),
    'gu',
  );
  return value.replace(
    pattern,
    (matched) => replacements.get(matched) ?? matched,
  );
}

function scoreRules<TKeyword extends string>(
  rules: readonly WeightedRule<TKeyword>[],
  fields: Readonly<ClassificationFields>,
  mappings: readonly Readonly<{term: string; keyword: TKeyword}>[],
  input: Readonly<DeterministicEntryClassificationInput>,
): readonly Readonly<ScoredCandidate<TKeyword>>[] {
  const mappingScores = new Map<TKeyword, number>();
  for (const mapping of mappings) {
    const term = normalizeTerm(mapping.term);
    const score =
      (fields.title.includes(term) ? 12 : 0) +
      (fields.keywords.includes(term) ? 10 : 0) +
      (fields.body.includes(term) ? 8 : 0);
    mappingScores.set(
      mapping.keyword,
      (mappingScores.get(mapping.keyword) ?? 0) + score,
    );
  }
  return Object.freeze(
    rules
      .map((candidate) =>
        Object.freeze({
          keyword: candidate.keyword,
          score: Math.max(
            0,
            scoreSignals(candidate.signals, fields) +
              structuralScore(candidate.keyword, input) -
              negativeScore(candidate.keyword, fields) +
              (mappingScores.get(candidate.keyword) ?? 0),
          ),
        }),
      )
      .sort(
        (left, right) =>
          right.score - left.score || left.keyword.localeCompare(right.keyword),
      ),
  );
}

function scoreSignals(
  signals: readonly Readonly<{pattern: RegExp; weight: number}>[],
  fields: Readonly<ClassificationFields>,
): number {
  return signals.reduce(
    (total, item) =>
      total +
      (item.pattern.test(fields.title) ? item.weight * 3 : 0) +
      (item.pattern.test(fields.keywords) ? item.weight * 2 : 0) +
      (item.pattern.test(fields.body) ? item.weight : 0),
    0,
  );
}

function structuralScore(
  keyword: string,
  input: Readonly<DeterministicEntryClassificationInput>,
): number {
  if (
    keyword === 'operating_guideline' &&
    (/(?:^|\n)\s*(?:\d+[.)]|[-*])\s+/u.test(input.body) ||
      input.body.includes('```'))
  ) {
    return 2;
  }
  if (
    keyword === 'factual_material' &&
    input.chunkMode === 'whole' &&
    (input.body.match(/(?:^|\n)\s*[-*]\s+/gu)?.length ?? 0) >= 3
  ) {
    return 2;
  }
  if (
    keyword === 'public_communication' &&
    /(?:^|\s)v?\d+\.\d+(?:\.\d+)?(?:\s|$)/iu.test(input.titlePath)
  ) {
    return 1;
  }
  return 0;
}

function negativeScore(
  keyword: string,
  fields: Readonly<ClassificationFields>,
): number {
  const pattern =
    keyword === 'operating_guideline'
      ? /(?:观点|评论|新闻稿|opinion|commentary|press release)/iu
      : keyword === 'public_communication'
        ? /(?:教程|指南|深入分析|tutorial|benchmark)/iu
        : keyword === 'argument'
          ? /(?:数据集|安装步骤|release notes?|dataset)/iu
          : keyword === 'factual_material'
            ? FACTUAL_MATERIAL_NEGATIVE_PATTERN
            : undefined;
  return pattern === undefined
    ? 0
    : (pattern.test(fields.title) ? 6 : 0) +
        (pattern.test(fields.keywords) ? 4 : 0) +
        (pattern.test(fields.body) ? 3 : 0);
}

function classifyScores<TKeyword extends string>(
  scores: readonly Readonly<ScoredCandidate<TKeyword>>[],
): DeterministicClassificationDiagnostic<TKeyword> {
  const first = scores[0];
  const second = scores[1];
  const winnerScore = first?.score ?? 0;
  const runnerUpScore = second?.score ?? 0;
  if (first === undefined || winnerScore === 0) {
    return {reason: 'no_signal', winnerScore, runnerUpScore};
  }
  if (winnerScore < 6) {
    return {reason: 'below_threshold', winnerScore, runnerUpScore};
  }
  if (winnerScore === runnerUpScore) {
    return {reason: 'tied', winnerScore, runnerUpScore};
  }
  if (winnerScore - runnerUpScore < 3) {
    return {reason: 'low_margin', winnerScore, runnerUpScore};
  }
  return {
    reason: 'assigned',
    winner: first.keyword,
    winnerScore,
    runnerUpScore,
  };
}

function selectDomains(
  scores: readonly Readonly<ScoredCandidate<EntryDomainKeyword>>[],
  primary: EntryDomainKeyword,
): readonly EntryDomainKeyword[] {
  const primaryScore =
    scores.find((candidate) => candidate.keyword === primary)?.score ?? 0;
  return Object.freeze(
    scores
      .filter(
        (candidate) =>
          candidate.keyword === primary ||
          (candidate.score >= 6 && candidate.score * 2 >= primaryScore),
      )
      .slice(0, 3)
      .map((candidate) => candidate.keyword),
  );
}

function decodeAliases(
  value: unknown,
): readonly Readonly<EntryClassificationAlias>[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > MAXIMUM_ENTRY_CLASSIFICATION_PROFILE_ALIASES
  ) {
    return undefined;
  }
  const aliases: EntryClassificationAlias[] = [];
  const sources = new Set<string>();
  for (const candidate of value) {
    if (!isClosedRecord(candidate, ['source', 'canonical'])) return undefined;
    const source = decodeTerm(candidate.source);
    const canonical = decodeTerm(candidate.canonical);
    if (source === undefined || canonical === undefined) return undefined;
    const identity = normalizeTerm(source);
    if (identity === normalizeTerm(canonical) || sources.has(identity)) {
      return undefined;
    }
    sources.add(identity);
    aliases.push(Object.freeze({source, canonical}));
  }
  if (hasAliasCycle(aliases)) return undefined;
  return Object.freeze(aliases);
}

function decodeMappings<TKeyword extends string>(
  value: unknown,
  keywords: readonly TKeyword[],
  maximum: number,
):
  | readonly Readonly<{term: string; keyword: Exclude<TKeyword, 'other'>}>[]
  | undefined {
  if (!Array.isArray(value) || value.length > maximum) return undefined;
  const result: {term: string; keyword: Exclude<TKeyword, 'other'>}[] = [];
  const identities = new Set<string>();
  for (const candidate of value) {
    if (!isClosedRecord(candidate, ['term', 'keyword'])) return undefined;
    const term = decodeTerm(candidate.term);
    if (
      term === undefined ||
      typeof candidate.keyword !== 'string' ||
      candidate.keyword === 'other' ||
      !keywords.includes(candidate.keyword as TKeyword)
    ) {
      return undefined;
    }
    const identity = `${normalizeTerm(term)}\u0000${candidate.keyword}`;
    if (identities.has(identity)) return undefined;
    identities.add(identity);
    result.push(
      Object.freeze({
        term,
        keyword: candidate.keyword as Exclude<TKeyword, 'other'>,
      }),
    );
  }
  return Object.freeze(result);
}

function decodeTerms(
  value: unknown,
  maximum: number,
): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > maximum) return undefined;
  const result: string[] = [];
  const identities = new Set<string>();
  for (const candidate of value) {
    const term = decodeTerm(candidate);
    if (term === undefined) return undefined;
    const identity = normalizeTerm(term);
    if (identities.has(identity)) return undefined;
    identities.add(identity);
    result.push(term);
  }
  return Object.freeze(result);
}

function decodeTerm(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const term = value.normalize('NFC').trim();
  return term.length > 0 &&
    Array.from(term).length <=
      MAXIMUM_ENTRY_CLASSIFICATION_PROFILE_TERM_CODE_POINTS &&
    !containsControlCodePoint(term)
    ? term
    : undefined;
}

function hasAliasCycle(
  aliases: readonly Readonly<EntryClassificationAlias>[],
): boolean {
  const targets = new Map(
    aliases.map((alias) => [
      normalizeTerm(alias.source),
      normalizeTerm(alias.canonical),
    ]),
  );
  for (const source of targets.keys()) {
    const visited = new Set<string>();
    let current: string | undefined = source;
    while (current !== undefined && targets.has(current)) {
      if (visited.has(current)) return true;
      visited.add(current);
      current = targets.get(current);
    }
  }
  return false;
}

function replaceLiteral(value: string, source: string, target: string): string {
  return source.length === 0
    ? value
    : value.replace(new RegExp(escapeRegExp(source), 'gu'), target);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function normalizeTerm(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('und');
}

function containsControlCodePoint(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isClosedRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  );
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
