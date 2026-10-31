import {extraDefaults} from './extra-settings.js';
export const sections = [
  ['appearance', '外观与阅读', 'eye', '主题、光效和正文显示。'],
  ['ai', 'AI 执行', 'bolt', '运行许可、并发和调用时段。'],
  ['automation', '自动处理', 'layers', '选择处理范围，设置审核和用量。'],
  ['vocabulary', '标签与词表', 'tag', '统一标签的维度、用词和别名。'],
  ['network', '联网与通知', 'globe', '联网检索和站内消息。'],
  ['data', '数据与维护', 'database', '备份、恢复和外部接入。'],
];
export const defaults = {
  appearance: {
    theme: 'dark',
    glow: 70,
    glass: true,
    motion: true,
    flowMotion: true,
    readingSize: 20,
    readingMeasure: 78,
  },
  ai: {
    operationsAllowed: false,
    backgroundPaused: false,
    assistantPriceRestricted: true,
    maxConcurrentRequests: 1,
    automaticRetryLimit: 0,
    priceEnabled: false,
  },
  automation: {
    enabled: false,
    paused: false,
    manualUploads: false,
    subscriptionIds: [],
    maxDocumentsPerDay: 10,
    maxEntries: 12,
    maxModelCalls: 24,
    review: true,
    intake: {
      fetchFullText: true,
      blockedKinds: [],
      preferredTopics: '',
      excludedTopics: '',
    },
  },
  vocabulary: {
    dimensions: [],
    terms: [],
    aliases: [],
    relations: [],
    quickTags: '',
    excludedKeywords: '',
    automaticKeywords: true,
    includeLinkDomains: false,
    weights: {content: 60, type: 20, domain: 20, threshold: 30},
  },
  network: {
    enabled: false,
    dailyRequests: 20,
    resultLimit: 5,
    fetchMissing: false,
    notices: {
      enabled: false,
      sources: '',
      urgentTerms: '',
      timeZone: 'Asia/Shanghai',
      quietFrom: '22:00',
      quietTo: '08:00',
      intervalMinutes: 60,
    },
  },
  data: {},
};
for (const [section, values] of Object.entries(extraDefaults))
  Object.assign(defaults[section], structuredClone(values));
export const roles = {
  form: '内容类型',
  domain: '领域',
  entity: '对象',
  issue: '议题',
  purpose: '用途',
  condition: '条件',
  custom: '自定义',
};
export {settingsEndpoints as backendSupport} from './contract-map.js';
