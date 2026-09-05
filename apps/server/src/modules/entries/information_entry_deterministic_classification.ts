import {
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TYPE_KEYWORDS,
  type EntryChunkMode,
  type EntryDomainAssignment,
  type EntryDomainKeyword,
  type EntryTypeKeyword,
} from './information_entry_contract.js';
import {
  decodeEntryTypeLearningState,
  DEFAULT_ENTRY_TYPE_LEARNING_STATE,
  isEntryTypeLearningModelActivationEligible,
  predictEntryType,
  type EntryTypeLearningState,
} from './information_entry_type_learning.js';

export const DETERMINISTIC_ENTRY_CLASSIFICATION_RULE_VERSION =
  'struinfo.entry-classification.deterministic.v5';

export const ENTRY_CLASSIFICATION_PROFILE_FORMAT =
  'struinfo.entry-classification-profile';
export const ENTRY_CLASSIFICATION_PROFILE_VERSION = 3;
export const MAXIMUM_ENTRY_CLASSIFICATION_PROFILE_ALIASES = 1_024;
export const MAXIMUM_ENTRY_CLASSIFICATION_PROFILE_MAPPINGS = 4_096;
export const MAXIMUM_ENTRY_CLASSIFICATION_PROFILE_TEXT_MAPPINGS = 256;
export const MAXIMUM_ENTRY_CLASSIFICATION_PROFILE_EXCLUSIONS = 1_024;
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
  readonly scope?: EntryClassificationMappingScope;
}

export interface EntryClassificationDomainMapping {
  readonly term: string;
  readonly keyword: ClassifiedEntryDomainKeyword;
  readonly scope?: EntryClassificationMappingScope;
}

export type EntryClassificationMappingScope = 'text' | 'content_keyword';

export interface EntryClassificationThreshold<TKeyword extends string> {
  readonly keyword: TKeyword;
  readonly minimumScore: number;
  readonly minimumMargin: number;
}

export interface EntryClassificationNeighborPolicy {
  readonly enabled: boolean;
  readonly minimumReferenceCount: number;
  readonly minimumConsensusBasisPoints: number;
  readonly minimumSharedKeywordCount: number;
  readonly minimumSimilarityBasisPoints: number;
  readonly maximumNeighbors: number;
  readonly maximumReferencesPerKeyword: number;
  readonly evidenceScore: number;
}

export interface EntryClassificationNeighborEvidence<TKeyword extends string> {
  readonly keyword: TKeyword;
  readonly referenceCount: number;
  readonly consensusBasisPoints: number;
  readonly score: number;
}

export interface DeterministicEntryClassificationNeighborEvidence {
  readonly type?: Readonly<
    EntryClassificationNeighborEvidence<ClassifiedEntryTypeKeyword>
  >;
  readonly domains: readonly Readonly<
    EntryClassificationNeighborEvidence<ClassifiedEntryDomainKeyword>
  >[];
}

export interface EntryClassificationProfile {
  readonly format: typeof ENTRY_CLASSIFICATION_PROFILE_FORMAT;
  readonly version: 1 | 2 | typeof ENTRY_CLASSIFICATION_PROFILE_VERSION;
  readonly revision: number;
  readonly aliases: readonly Readonly<EntryClassificationAlias>[];
  readonly typeMappings: readonly Readonly<EntryClassificationTypeMapping>[];
  readonly domainMappings: readonly Readonly<EntryClassificationDomainMapping>[];
  readonly exclusions: readonly string[];
  readonly typeThresholds?: readonly Readonly<
    EntryClassificationThreshold<ClassifiedEntryTypeKeyword>
  >[];
  readonly domainThresholds?: readonly Readonly<
    EntryClassificationThreshold<ClassifiedEntryDomainKeyword>
  >[];
  readonly neighborPolicy?: Readonly<EntryClassificationNeighborPolicy>;
  readonly typeLearning?: Readonly<EntryTypeLearningState>;
}

export const DEFAULT_ENTRY_CLASSIFICATION_TYPE_THRESHOLDS = Object.freeze([
  threshold('factual_material', 12, 3),
  threshold('knowledge_explanation', 6, 3),
  threshold('operating_guideline', 6, 3),
  threshold('investigation_analysis', 6, 3),
  threshold('argument', 6, 3),
  threshold('personal_experience', 12, 3),
  threshold('interactive_collaboration', 18, 6),
  threshold('public_communication', 12, 3),
  threshold('literary_creation', 6, 3),
] as const satisfies readonly Readonly<
  EntryClassificationThreshold<ClassifiedEntryTypeKeyword>
>[]);

export const DEFAULT_ENTRY_CLASSIFICATION_DOMAIN_THRESHOLDS = Object.freeze(
  ENTRY_DOMAIN_KEYWORDS.filter(
    (keyword): keyword is ClassifiedEntryDomainKeyword => keyword !== 'other',
  ).map((keyword) => threshold(keyword, 6, 3)),
);

export const DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY: Readonly<EntryClassificationNeighborPolicy> =
  Object.freeze({
    enabled: true,
    minimumReferenceCount: 4,
    minimumConsensusBasisPoints: 8_500,
    minimumSharedKeywordCount: 1,
    minimumSimilarityBasisPoints: 1_500,
    maximumNeighbors: 12,
    maximumReferencesPerKeyword: 64,
    evidenceScore: 12,
  });

export const DEFAULT_ENTRY_CLASSIFICATION_PROFILE: Readonly<EntryClassificationProfile> =
  Object.freeze({
    format: ENTRY_CLASSIFICATION_PROFILE_FORMAT,
    version: ENTRY_CLASSIFICATION_PROFILE_VERSION,
    revision: 0,
    aliases: Object.freeze([]),
    typeMappings: Object.freeze([]),
    domainMappings: Object.freeze([]),
    exclusions: Object.freeze([]),
    typeThresholds: DEFAULT_ENTRY_CLASSIFICATION_TYPE_THRESHOLDS,
    domainThresholds: DEFAULT_ENTRY_CLASSIFICATION_DOMAIN_THRESHOLDS,
    neighborPolicy: DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY,
    typeLearning: DEFAULT_ENTRY_TYPE_LEARNING_STATE,
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
  readonly minimumScore?: number;
  readonly minimumMargin?: number;
  readonly evidenceSource?: 'neighbor_consensus' | 'learned_type_model';
  readonly referenceCount?: number;
  readonly consensusBasisPoints?: number;
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
  readonly neighborEvidence?: Readonly<DeterministicEntryClassificationNeighborEvidence>;
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
  const baseTypeScores = scoreRules(
    TYPE_RULES,
    fields,
    profile.typeMappings,
    input,
    Object.freeze([]),
  );
  const domainScores = scoreRules(
    DOMAIN_RULES,
    fields,
    profile.domainMappings,
    input,
    input.neighborEvidence?.domains ?? Object.freeze([]),
  );
  const baseTypeDiagnostic = classifyScores<EntryTypeKeyword>(
    baseTypeScores,
    profile.typeThresholds ?? DEFAULT_ENTRY_CLASSIFICATION_TYPE_THRESHOLDS,
    Object.freeze([]),
  );
  const learnedPrediction =
    baseTypeDiagnostic.reason === 'assigned'
      ? undefined
      : predictEntryTypeForClassification(input, profile);
  const typeScores =
    learnedPrediction === undefined
      ? scoreRules(
          TYPE_RULES,
          fields,
          profile.typeMappings,
          input,
          input.neighborEvidence?.type === undefined
            ? Object.freeze([])
            : Object.freeze([input.neighborEvidence.type]),
        )
      : baseTypeScores;
  const typeDiagnostic =
    baseTypeDiagnostic.reason === 'assigned'
      ? baseTypeDiagnostic
      : learnedPrediction === undefined
        ? classifyScores<EntryTypeKeyword>(
            typeScores,
            profile.typeThresholds ??
              DEFAULT_ENTRY_CLASSIFICATION_TYPE_THRESHOLDS,
            input.neighborEvidence?.type === undefined
              ? Object.freeze([])
              : Object.freeze([input.neighborEvidence.type]),
          )
        : Object.freeze({
            reason: 'assigned' as const,
            winner: learnedPrediction.keyword,
            winnerScore: learnedPrediction.score,
            runnerUpScore: learnedPrediction.runnerUpScore,
            minimumScore: learnedPrediction.minimumScore,
            minimumMargin: learnedPrediction.minimumMargin,
            evidenceSource: 'learned_type_model' as const,
          });
  const domainDiagnostic = classifyScores<EntryDomainKeyword>(
    domainScores,
    profile.domainThresholds ?? DEFAULT_ENTRY_CLASSIFICATION_DOMAIN_THRESHOLDS,
    input.neighborEvidence?.domains ?? Object.freeze([]),
  );
  const originVersion =
    input.originVersion ??
    `${DETERMINISTIC_ENTRY_CLASSIFICATION_RULE_VERSION}:profile-${profile.revision.toString()}`;
  const domains =
    domainDiagnostic.reason === 'assigned' &&
    domainDiagnostic.winner !== undefined
      ? Object.freeze(
          selectDomains(
            domainScores,
            domainDiagnostic.winner,
            profile.domainThresholds ??
              DEFAULT_ENTRY_CLASSIFICATION_DOMAIN_THRESHOLDS,
          ).map((keyword) =>
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
  const legacyKeys = [
    'format',
    'version',
    'revision',
    'aliases',
    'typeMappings',
    'domainMappings',
    'exclusions',
  ] as const;
  const currentOptionalKeys = [
    'typeThresholds',
    'domainThresholds',
    'neighborPolicy',
    'typeLearning',
  ] as const;
  if (
    !isRecord(value) ||
    !hasRequiredAndAllowedKeys(value, legacyKeys, currentOptionalKeys) ||
    value.format !== ENTRY_CLASSIFICATION_PROFILE_FORMAT ||
    (value.version !== 1 &&
      value.version !== 2 &&
      value.version !== ENTRY_CLASSIFICATION_PROFILE_VERSION) ||
    (value.version === 1 &&
      currentOptionalKeys.some((key) => Object.hasOwn(value, key))) ||
    (value.version === 2 && Object.hasOwn(value, 'typeLearning')) ||
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
    value.version === 1,
  );
  const domainMappings = decodeMappings(
    value.domainMappings,
    ENTRY_DOMAIN_KEYWORDS,
    MAXIMUM_ENTRY_CLASSIFICATION_PROFILE_MAPPINGS,
    value.version === 1,
  );
  const exclusions = decodeTerms(
    value.exclusions,
    MAXIMUM_ENTRY_CLASSIFICATION_PROFILE_EXCLUSIONS,
  );
  const typeThresholds =
    value.typeThresholds === undefined
      ? DEFAULT_ENTRY_CLASSIFICATION_TYPE_THRESHOLDS
      : decodeThresholds(
          value.typeThresholds,
          ENTRY_TYPE_KEYWORDS,
          DEFAULT_ENTRY_CLASSIFICATION_TYPE_THRESHOLDS,
        );
  const domainThresholds =
    value.domainThresholds === undefined
      ? DEFAULT_ENTRY_CLASSIFICATION_DOMAIN_THRESHOLDS
      : decodeThresholds(
          value.domainThresholds,
          ENTRY_DOMAIN_KEYWORDS,
          DEFAULT_ENTRY_CLASSIFICATION_DOMAIN_THRESHOLDS,
        );
  const neighborPolicy =
    value.neighborPolicy === undefined
      ? DEFAULT_ENTRY_CLASSIFICATION_NEIGHBOR_POLICY
      : decodeNeighborPolicy(value.neighborPolicy);
  const typeLearning =
    value.typeLearning === undefined
      ? DEFAULT_ENTRY_TYPE_LEARNING_STATE
      : decodeEntryTypeLearningState(value.typeLearning);
  if (
    aliases === undefined ||
    typeMappings === undefined ||
    domainMappings === undefined ||
    exclusions === undefined ||
    typeThresholds === undefined ||
    domainThresholds === undefined ||
    neighborPolicy === undefined ||
    typeLearning === undefined
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
    typeThresholds,
    domainThresholds,
    neighborPolicy,
    typeLearning,
  });
}

function predictEntryTypeForClassification(
  input: Readonly<DeterministicEntryClassificationInput>,
  profile: Readonly<EntryClassificationProfile>,
) {
  const activeModel = profile.typeLearning?.activeModel;
  if (!isEntryTypeLearningModelActivationEligible(activeModel))
    return undefined;
  return predictEntryType(
    Object.freeze({
      workspaceId: '00000000-0000-0000-0000-000000000000',
      entryId: '00000000-0000-0000-0000-000000000000',
      resourceId: '00000000-0000-0000-0000-000000000000',
      snapshotId: '00000000-0000-0000-0000-000000000000',
      revision: 1,
      revisionId: '00000000-0000-0000-0000-000000000000',
      sourceKey: 'classification-input',
      capturedAt: '2000-01-01T00:00:00.000Z',
      value: Object.freeze({
        documentOrder: 0,
        titlePath: input.titlePath,
        body: input.body,
        bodySha256: '0'.repeat(64),
        chunkMode: input.chunkMode ?? 'split',
        splitRuleVersion: 'classification-input',
        isPrivate: false,
        contentKeywords: Object.freeze(
          input.contentKeywords.map((keyword) =>
            Object.freeze({
              displayValue: keyword,
              normalizedValue: keyword,
              origin: 'rule' as const,
              originVersion: 'classification-input',
            }),
          ),
        ),
        domains: Object.freeze([]),
        fragmentIds: Object.freeze([]),
      }),
    }),
    activeModel,
  );
}

interface ClassificationFields {
  readonly title: string;
  readonly keywords: string;
  readonly body: string;
  readonly exactContentKeywords: ReadonlySet<string>;
}

interface ScoredCandidate<TKeyword extends string> {
  readonly keyword: TKeyword;
  readonly score: number;
}

interface CompiledMappings {
  readonly text: readonly Readonly<{term: string; keyword: string}>[];
  readonly exact: ReadonlyMap<
    string,
    readonly Readonly<{term: string; keyword: string}>[]
  >;
}

const compiledMappingCache = new WeakMap<object, Readonly<CompiledMappings>>();
const compiledAliasCache = new WeakMap<
  object,
  Readonly<{replacements: ReadonlyMap<string, string>; pattern: RegExp}>
>();
const compiledExclusionCache = new WeakMap<object, RegExp>();

function normalizeClassificationFields(
  input: Readonly<DeterministicEntryClassificationInput>,
  profile: Readonly<EntryClassificationProfile>,
): Readonly<ClassificationFields> {
  const exactContentKeywords = new Set(
    input.contentKeywords.map((keyword) => applyProfile(keyword, profile)),
  );
  return Object.freeze({
    title: applyProfile(input.titlePath, profile),
    keywords: [...exactContentKeywords].join('\n'),
    body: applyProfile(input.body.slice(0, 32_000), profile),
    exactContentKeywords,
  });
}

function applyProfile(
  value: string,
  profile: Readonly<EntryClassificationProfile>,
): string {
  return replaceExclusionsOnce(
    replaceAliasesOnce(normalizeTerm(value), profile.aliases),
    profile.exclusions,
  );
}

function replaceAliasesOnce(
  value: string,
  aliases: readonly Readonly<EntryClassificationAlias>[],
): string {
  if (aliases.length === 0) return value;
  const compiled = compileAliases(aliases);
  return value.replace(
    compiled.pattern,
    (matched) => compiled.replacements.get(matched) ?? matched,
  );
}

function compileAliases(
  aliases: readonly Readonly<EntryClassificationAlias>[],
): Readonly<{replacements: ReadonlyMap<string, string>; pattern: RegExp}> {
  const cached = compiledAliasCache.get(aliases);
  if (cached !== undefined) return cached;
  const replacements = new Map(
    aliases.map((alias) => [
      normalizeTerm(alias.source),
      normalizeTerm(alias.canonical),
    ]),
  );
  const compiled = Object.freeze({
    replacements,
    pattern: new RegExp(
      [...replacements.keys()]
        .sort((left, right) =>
          right.length === left.length
            ? left.localeCompare(right)
            : right.length - left.length,
        )
        .map(escapeRegExp)
        .join('|'),
      'gu',
    ),
  });
  compiledAliasCache.set(aliases, compiled);
  return compiled;
}

function replaceExclusionsOnce(
  value: string,
  exclusions: readonly string[],
): string {
  if (exclusions.length === 0) return value;
  let pattern = compiledExclusionCache.get(exclusions);
  if (pattern === undefined) {
    pattern = new RegExp(
      exclusions
        .map(normalizeTerm)
        .sort((left, right) =>
          right.length === left.length
            ? left.localeCompare(right)
            : right.length - left.length,
        )
        .map(escapeRegExp)
        .join('|'),
      'gu',
    );
    compiledExclusionCache.set(exclusions, pattern);
  }
  return value.replace(pattern, ' ');
}

function scoreRules<TKeyword extends string>(
  rules: readonly WeightedRule<TKeyword>[],
  fields: Readonly<ClassificationFields>,
  mappings: readonly Readonly<{
    term: string;
    keyword: TKeyword;
    scope?: EntryClassificationMappingScope;
  }>[],
  input: Readonly<DeterministicEntryClassificationInput>,
  neighborEvidence: readonly Readonly<
    EntryClassificationNeighborEvidence<TKeyword>
  >[],
): readonly Readonly<ScoredCandidate<TKeyword>>[] {
  const mappingScores = new Map<TKeyword, number>();
  const compiledMappings = compileMappings(mappings);
  for (const mapping of compiledMappings.text) {
    const score =
      (fields.title.includes(mapping.term) ? 12 : 0) +
      (fields.keywords.includes(mapping.term) ? 12 : 0) +
      (fields.body.includes(mapping.term) ? 8 : 0);
    mappingScores.set(
      mapping.keyword,
      (mappingScores.get(mapping.keyword) ?? 0) + score,
    );
  }
  for (const keyword of fields.exactContentKeywords) {
    for (const mapping of compiledMappings.exact.get(keyword) ?? []) {
      mappingScores.set(
        mapping.keyword,
        (mappingScores.get(mapping.keyword) ?? 0) + 12,
      );
    }
  }
  const neighborScores = new Map(
    neighborEvidence.map((evidence) => [evidence.keyword, evidence.score]),
  );
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
              (mappingScores.get(candidate.keyword) ?? 0) +
              (neighborScores.get(candidate.keyword) ?? 0),
          ),
        }),
      )
      .sort(
        (left, right) =>
          right.score - left.score || left.keyword.localeCompare(right.keyword),
      ),
  );
}

function compileMappings<TKeyword extends string>(
  mappings: readonly Readonly<{
    term: string;
    keyword: TKeyword;
    scope?: EntryClassificationMappingScope;
  }>[],
): Readonly<{
  text: readonly Readonly<{term: string; keyword: TKeyword}>[];
  exact: ReadonlyMap<
    string,
    readonly Readonly<{term: string; keyword: TKeyword}>[]
  >;
}> {
  const cached = compiledMappingCache.get(mappings);
  if (cached !== undefined) {
    return cached as Readonly<{
      text: readonly Readonly<{term: string; keyword: TKeyword}>[];
      exact: ReadonlyMap<
        string,
        readonly Readonly<{term: string; keyword: TKeyword}>[]
      >;
    }>;
  }
  const text: Readonly<{term: string; keyword: TKeyword}>[] = [];
  const exact = new Map<
    string,
    Readonly<{term: string; keyword: TKeyword}>[]
  >();
  for (const mapping of mappings) {
    const normalized = Object.freeze({
      term: normalizeTerm(mapping.term),
      keyword: mapping.keyword,
    });
    if ((mapping.scope ?? 'text') === 'content_keyword') {
      const current = exact.get(normalized.term) ?? [];
      exact.set(normalized.term, [...current, normalized]);
    } else {
      text.push(normalized);
    }
  }
  const compiled = Object.freeze({
    text: Object.freeze(text),
    exact: new Map(
      [...exact.entries()].map(([term, values]) => [
        term,
        Object.freeze(values),
      ]),
    ),
  });
  compiledMappingCache.set(mappings, compiled);
  return compiled;
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
  thresholds: readonly Readonly<EntryClassificationThreshold<TKeyword>>[],
  neighborEvidence: readonly Readonly<
    EntryClassificationNeighborEvidence<TKeyword>
  >[],
): DeterministicClassificationDiagnostic<TKeyword> {
  const first = scores[0];
  const second = scores[1];
  const winnerScore = first?.score ?? 0;
  const runnerUpScore = second?.score ?? 0;
  if (first === undefined || winnerScore === 0) {
    return {reason: 'no_signal', winnerScore, runnerUpScore};
  }
  const threshold = thresholds.find(
    (candidate) => candidate.keyword === first.keyword,
  ) ?? {minimumScore: 6, minimumMargin: 3};
  const base = {
    winnerScore,
    runnerUpScore,
    minimumScore: threshold.minimumScore,
    minimumMargin: threshold.minimumMargin,
  };
  if (winnerScore < threshold.minimumScore) {
    return {reason: 'below_threshold', ...base};
  }
  if (winnerScore === runnerUpScore) {
    return {reason: 'tied', ...base};
  }
  if (winnerScore - runnerUpScore < threshold.minimumMargin) {
    return {reason: 'low_margin', ...base};
  }
  const evidence = neighborEvidence.find(
    (candidate) => candidate.keyword === first.keyword,
  );
  return {
    reason: 'assigned',
    winner: first.keyword,
    ...base,
    ...(evidence === undefined
      ? {}
      : {
          evidenceSource: 'neighbor_consensus' as const,
          referenceCount: evidence.referenceCount,
          consensusBasisPoints: evidence.consensusBasisPoints,
        }),
  };
}

function selectDomains(
  scores: readonly Readonly<ScoredCandidate<EntryDomainKeyword>>[],
  primary: EntryDomainKeyword,
  thresholds: readonly Readonly<
    EntryClassificationThreshold<EntryDomainKeyword>
  >[],
): readonly EntryDomainKeyword[] {
  const primaryScore =
    scores.find((candidate) => candidate.keyword === primary)?.score ?? 0;
  return Object.freeze(
    scores
      .filter(
        (candidate) =>
          candidate.keyword === primary ||
          (candidate.score >=
            (thresholds.find(
              (threshold_) => threshold_.keyword === candidate.keyword,
            )?.minimumScore ?? 6) &&
            candidate.score * 2 >= primaryScore),
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
  materializeDefaultScope: boolean,
):
  | readonly Readonly<{
      term: string;
      keyword: Exclude<TKeyword, 'other'>;
      scope?: EntryClassificationMappingScope;
    }>[]
  | undefined {
  if (!Array.isArray(value) || value.length > maximum) return undefined;
  const result: {
    term: string;
    keyword: Exclude<TKeyword, 'other'>;
    scope?: EntryClassificationMappingScope;
  }[] = [];
  const identities = new Set<string>();
  let textMappingCount = 0;
  for (const candidate of value) {
    if (
      !isClosedRecord(candidate, ['term', 'keyword']) &&
      !isClosedRecord(candidate, ['term', 'keyword', 'scope'])
    ) {
      return undefined;
    }
    const term = decodeTerm(candidate.term);
    const scope = candidate.scope ?? 'text';
    if (
      term === undefined ||
      typeof candidate.keyword !== 'string' ||
      candidate.keyword === 'other' ||
      !keywords.includes(candidate.keyword as TKeyword) ||
      (scope !== 'text' && scope !== 'content_keyword')
    ) {
      return undefined;
    }
    if (scope === 'text') {
      textMappingCount += 1;
      if (
        textMappingCount > MAXIMUM_ENTRY_CLASSIFICATION_PROFILE_TEXT_MAPPINGS
      ) {
        return undefined;
      }
    }
    const identity = `${normalizeTerm(term)}\u0000${candidate.keyword}`;
    if (identities.has(identity)) return undefined;
    identities.add(identity);
    result.push(
      Object.freeze({
        term,
        keyword: candidate.keyword as Exclude<TKeyword, 'other'>,
        ...(candidate.scope === undefined && !materializeDefaultScope
          ? {}
          : {scope}),
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

function decodeThresholds<TKeyword extends string>(
  value: unknown,
  keywords: readonly TKeyword[],
  defaults: readonly Readonly<
    EntryClassificationThreshold<Exclude<TKeyword, 'other'>>
  >[],
):
  | readonly Readonly<
      EntryClassificationThreshold<Exclude<TKeyword, 'other'>>
    >[]
  | undefined {
  if (!Array.isArray(value) || value.length !== defaults.length) {
    return undefined;
  }
  const expected = new Set(defaults.map((item) => item.keyword));
  const seen = new Set<string>();
  const result: EntryClassificationThreshold<Exclude<TKeyword, 'other'>>[] = [];
  for (const candidate of value) {
    if (
      !isClosedRecord(candidate, [
        'keyword',
        'minimumScore',
        'minimumMargin',
      ]) ||
      typeof candidate.keyword !== 'string' ||
      candidate.keyword === 'other' ||
      !keywords.includes(candidate.keyword as TKeyword) ||
      !expected.has(candidate.keyword as Exclude<TKeyword, 'other'>) ||
      seen.has(candidate.keyword) ||
      !isBoundedInteger(candidate.minimumScore, 1, 60) ||
      !isBoundedInteger(candidate.minimumMargin, 1, 30)
    ) {
      return undefined;
    }
    seen.add(candidate.keyword);
    result.push(
      Object.freeze({
        keyword: candidate.keyword as Exclude<TKeyword, 'other'>,
        minimumScore: candidate.minimumScore,
        minimumMargin: candidate.minimumMargin,
      }),
    );
  }
  return seen.size === expected.size
    ? Object.freeze(
        result.sort(
          (left, right) =>
            defaults.findIndex((item) => item.keyword === left.keyword) -
            defaults.findIndex((item) => item.keyword === right.keyword),
        ),
      )
    : undefined;
}

function decodeNeighborPolicy(
  value: unknown,
): Readonly<EntryClassificationNeighborPolicy> | undefined {
  if (
    !isClosedRecord(value, [
      'enabled',
      'minimumReferenceCount',
      'minimumConsensusBasisPoints',
      'minimumSharedKeywordCount',
      'minimumSimilarityBasisPoints',
      'maximumNeighbors',
      'maximumReferencesPerKeyword',
      'evidenceScore',
    ]) ||
    (value.enabled !== true && value.enabled !== false) ||
    !isBoundedInteger(value.minimumReferenceCount, 2, 32) ||
    !isBoundedInteger(value.minimumConsensusBasisPoints, 5_000, 10_000) ||
    !isBoundedInteger(value.minimumSharedKeywordCount, 1, 16) ||
    !isBoundedInteger(value.minimumSimilarityBasisPoints, 1, 10_000) ||
    !isBoundedInteger(value.maximumNeighbors, 2, 32) ||
    !isBoundedInteger(value.maximumReferencesPerKeyword, 4, 1_024) ||
    !isBoundedInteger(value.evidenceScore, 1, 24) ||
    value.minimumReferenceCount > value.maximumNeighbors
  ) {
    return undefined;
  }
  return Object.freeze({
    enabled: value.enabled,
    minimumReferenceCount: value.minimumReferenceCount,
    minimumConsensusBasisPoints: value.minimumConsensusBasisPoints,
    minimumSharedKeywordCount: value.minimumSharedKeywordCount,
    minimumSimilarityBasisPoints: value.minimumSimilarityBasisPoints,
    maximumNeighbors: value.maximumNeighbors,
    maximumReferencesPerKeyword: value.maximumReferencesPerKeyword,
    evidenceScore: value.evidenceScore,
  });
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

function hasRequiredAndAllowedKeys(
  value: Readonly<Record<string, unknown>>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): boolean {
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const keys = Object.keys(value);
  return (
    requiredKeys.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function isBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
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

function threshold<TKeyword extends string>(
  keyword: TKeyword,
  minimumScore: number,
  minimumMargin: number,
): Readonly<EntryClassificationThreshold<TKeyword>> {
  return Object.freeze({keyword, minimumScore, minimumMargin});
}
