// Request mapping copied from the approved settings page.
// Versions are retained from the displayed state and updated after each successful save.
const list = (s) =>
  s
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean);
const put = (path, body) => ({method: 'PUT', path: '/api/v1/' + path, body});
const command = (route, operation, input) => ({
  method: 'POST',
  path: '/api/v1/' + route + '/commands',
  body: {operation, input},
});
const revision = (v, name) => {
  if (!Number.isSafeInteger(v) || v < 0)
    throw new Error('Read current ' + name + ' version before saving.');
  return v;
};
export const settingsEndpoints = [
  {
    id: 'queue',
    section: 'ai',
    location: '运行控制',
    method: 'POST',
    path: '/api/v1/ai-price/commands',
    operation: 'ai_queue_save',
    read: 'ai_price_status',
    fields: ['backgroundPaused'],
    version: 'revision',
  },
  {
    id: 'assistant',
    section: 'ai',
    location: '调用时段',
    method: 'POST',
    path: '/api/v1/ai-price/commands',
    operation: 'assistant_settings_save',
    read: 'ai_price_status',
    fields: ['assistantPriceRestricted'],
    version: 'revision',
  },
  {
    id: 'interface',
    section: 'appearance',
    location: '页面外观',
    method: 'PUT',
    path: '/api/v1/preferences/interface',
    read: 'GET /api/v1/preferences/interface',
    fields: ['theme', 'sidebars'],
    version: 'revision',
  },
  {
    id: 'operations',
    section: 'ai',
    location: '运行控制',
    method: 'POST',
    path: '/api/v1/ai-price/commands',
    operation: 'ai_operations_save',
    read: 'ai_price_status',
    fields: ['operationsAllowed'],
    version: 'revision',
  },
  {
    id: 'execution',
    section: 'ai',
    location: '运行控制',
    method: 'POST',
    path: '/api/v1/ai-price/commands',
    operation: 'ai_execution_save',
    read: 'ai_price_status',
    fields: ['maxConcurrentRequests', 'automaticRetryLimit'],
    version: 'revision',
  },
  {
    id: 'price',
    section: 'ai',
    location: '调用时段',
    method: 'POST',
    path: '/api/v1/ai-price/commands',
    operation: 'ai_price_save',
    read: 'ai_price_status',
    fields: ['priceEnabled'],
    version: 'revision',
  },
  {
    id: 'ingestion',
    section: 'automation',
    location: '新资料 / 审核与用量',
    method: 'POST',
    path: '/api/v1/ingestion/commands',
    operation: 'ingestion_policy_save',
    read: 'ingestion_status',
    fields: [
      'enabled',
      'paused',
      'manualUploads',
      'subscriptionIds',
      'maxDocumentsPerDay',
      'maxEntries',
      'maxModelCalls',
      'review',
      'intake',
    ],
    version: 'expectedRevision',
  },
  {
    id: 'split',
    section: 'automation',
    location: '本地处理规则 → 手动拆分',
    method: 'PUT',
    path: '/api/v1/entries/split-rules/profile',
    read: 'GET /api/v1/entries/split-rules/profile',
    fields: ['split'],
    version: 'expectedRevision',
  },
  {
    id: 'vocabulary',
    section: 'vocabulary',
    location: '结构化词表 / 别名与关系',
    method: 'POST',
    path: '/api/v1/ingestion/commands',
    operation: 'annotation_vocabulary_save',
    read: 'annotation_vocabulary',
    fields: ['dimensions', 'terms', 'aliases', 'relations'],
    version: 'expectedRevision',
  },
  {
    id: 'review',
    section: 'vocabulary',
    location: '本地建议 → 快捷标签 / 原有标签别名',
    method: 'PUT',
    path: '/api/v1/preferences/review',
    read: 'GET /api/v1/preferences/review',
    fields: [
      'quickTags',
      'excludedKeywords',
      'automaticKeywords',
      'includeLinkDomains',
      'localAliases',
    ],
    version: null,
  },
  {
    id: 'association',
    section: 'vocabulary',
    location: '本地建议 → 相似联系',
    method: 'PUT',
    path: '/api/v1/entries/associations/policy',
    read: 'GET /api/v1/preferences/review → associationPolicy',
    fields: ['weights'],
    version: 'expectedRevision',
  },
  {
    id: 'exploration',
    section: 'vocabulary',
    location: '本地建议 → 探索推荐',
    method: 'PUT',
    path: '/api/v1/entries/exploration/policy',
    read: 'GET /api/v1/preferences/review → explorationPolicy',
    fields: ['exploration'],
    version: 'expectedRevision',
  },
  {
    id: 'research',
    section: 'network',
    location: '联网搜索 / 站内通知',
    method: 'POST',
    path: '/api/v1/research/commands',
    operation: 'research_settings_save',
    read: 'research_status',
    fields: [
      'enabled',
      'dailyRequests',
      'resultLimit',
      'fetchMissing',
      'notices',
    ],
    version: 'expectedVersion',
  },
];
export const localFields = {
  appearance: [
    'glow',
    'glass',
    'motion',
    'flowMotion',
    'readingSize',
    'readingMeasure',
  ],
};
export function prepareSettingsRequest(id, d, c) {
  if (id === 'interface')
    return put('preferences/interface', {
      revision: revision(c.ui.revision, id),
      theme: d.theme,
      sidebars: structuredClone(d.sidebars ?? c.ui.sidebars),
    });
  if (['operations', 'execution', 'price', 'queue', 'assistant'].includes(id)) {
    const fields =
      id === 'queue'
        ? {backgroundPaused: d.backgroundPaused}
        : id === 'assistant'
          ? {assistantPriceRestricted: d.assistantPriceRestricted}
          : id === 'operations'
            ? {operationsAllowed: d.operationsAllowed}
            : id === 'execution'
              ? {
                  maxConcurrentRequests: d.maxConcurrentRequests,
                  automaticRetryLimit: d.automaticRetryLimit,
                }
              : {enabled: d.priceEnabled};
    return command(
      'ai-price',
      {
        operations: 'ai_operations_save',
        queue: 'ai_queue_save',
        assistant: 'assistant_settings_save',
        execution: 'ai_execution_save',
        price: 'ai_price_save',
      }[id],
      {revision: revision(c.ai.revision, id), ...fields},
    );
  }
  if (id === 'ingestion') {
    if (
      d.enabled &&
      !d.paused &&
      (!c.model?.trim() || (!d.manualUploads && !d.subscriptionIds.length))
    )
      throw new Error('Configured model and intake scope are required.');
    if (d.subscriptionIds.some((v) => !c.subscriptionIds.includes(v)))
      throw new Error('Unknown subscription identity.');
    const {
      enabled,
      paused,
      manualUploads,
      subscriptionIds,
      maxDocumentsPerDay,
      maxEntries,
      maxModelCalls,
    } = d;
    const settings = {
      enabled,
      paused,
      manualUploads,
      subscriptionIds: [...subscriptionIds],
      model: c.model || '',
      maxDocumentsPerDay,
      maxEntries,
      maxModelCalls,
    };
    if (d.review)
      settings.intake = {
        ...d.intake,
        preferredTopics: list(d.intake.preferredTopics),
        excludedTopics: list(d.intake.excludedTopics),
      };
    return command('ingestion', 'ingestion_policy_save', {
      expectedRevision: revision(c.ingestion.revision, id),
      settings,
    });
  }
  if (id === 'split')
    return put('entries/split-rules/profile', {
      expectedRevision: revision(c.split.revision, id),
      ...structuredClone(d.split),
    });
  if (id === 'vocabulary') {
    const {dimensions, terms, aliases, relations} = d;
    const before = c.vocabulary;
    for (const t of before.terms) {
      if (
        !terms.some((v) =>
          ['id', 'dimensionId', 'label', 'meaning'].every((k) => v[k] === t[k]),
        )
      )
        throw new Error('Saved terms cannot be deleted or changed.');
    }
    for (const a of before.dimensions) {
      if (!dimensions.some((v) => v.id === a.id && v.role === a.role))
        throw new Error(
          'Saved dimension identities and roles must be retained.',
        );
    }
    return command('ingestion', 'annotation_vocabulary_save', {
      expectedRevision: revision(before.revision, id),
      vocabulary: {
        revision: before.revision,
        dimensions,
        terms,
        aliases,
        relations,
      },
    });
  }
  if (id === 'review')
    return put('preferences/review', {
      quickTags: list(d.quickTags),
      automaticKeywords: {
        enabled: d.automaticKeywords,
        includeLinkDomains: d.includeLinkDomains,
        excludedKeywords: list(d.excludedKeywords),
      },
      vocabulary: {aliases: structuredClone(d.localAliases)},
    });
  if (id === 'association')
    return put('entries/associations/policy', {
      expectedRevision: revision(c.association.revision, id),
      contentWeight: d.weights.content,
      typeWeight: d.weights.type,
      domainWeight: d.weights.domain,
      threshold: Math.round(d.weights.threshold * 100),
    });
  if (id === 'exploration')
    return put('entries/exploration/policy', {
      expectedRevision: revision(c.exploration.revision, id),
      ...d.exploration,
    });
  if (id === 'research')
    return command('research', 'research_settings_save', {
      expectedVersion: revision(c.research.version, id),
      settings: {
        ...d,
        notices: {
          ...d.notices,
          sources: list(d.notices.sources),
          urgentTerms: list(d.notices.urgentTerms),
        },
      },
    });
  throw new Error('Unknown setting group: ' + id);
}
