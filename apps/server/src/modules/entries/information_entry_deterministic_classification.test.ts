import {describe, expect, it} from 'vitest';

import {
  classifyInformationEntryDeterministically,
  decodeEntryClassificationProfile,
  DETERMINISTIC_ENTRY_CLASSIFICATION_RULE_VERSION,
  ENTRY_CLASSIFICATION_PROFILE_FORMAT,
  ENTRY_CLASSIFICATION_PROFILE_VERSION,
} from './information_entry_deterministic_classification.js';

describe('deterministic InformationEntry classification', () => {
  it('weights title, keyword and body fields instead of flattening them', () => {
    const result = classifyInformationEntryDeterministically({
      titlePath: 'Docker 入门配置指南',
      body: '作者评论了软件安装体验，但正文并不是新闻稿。',
      contentKeywords: ['Docker', '软件开发'],
      chunkMode: 'split',
    });

    expect(result.typeKeyword).toBe('operating_guideline');
    expect(result.domains[0]).toEqual({
      keyword: 'engineering_computing',
      origin: 'rule',
      originVersion: `${DETERMINISTIC_ENTRY_CLASSIFICATION_RULE_VERSION}:profile-0`,
    });
    expect(result.diagnostics.type.reason).toBe('assigned');
    expect(result.diagnostics.domain.reason).toBe('assigned');
  });

  it('reports no signal without guessing either classification dimension', () => {
    expect(
      classifyInformationEntryDeterministically({
        titlePath: '一则短消息',
        body: '今天记录了一件事情。',
        contentKeywords: [],
      }),
    ).toEqual({
      domains: [],
      diagnostics: {
        type: {reason: 'no_signal', winnerScore: 0, runnerUpScore: 0},
        domain: {reason: 'no_signal', winnerScore: 0, runnerUpScore: 0},
      },
    });
  });

  it('does not treat a short linked tool card as factual material', () => {
    const result = classifyInformationEntryDeterministically({
      titlePath: 'TinyGraph 开源工具',
      body: '一个用于查看本地关系图的开源命令行工具：https://example.test/tinygraph',
      contentKeywords: ['TinyGraph'],
      chunkMode: 'split',
    });

    expect(result.typeKeyword).toBeUndefined();
    expect(result.diagnostics.type.reason).toBe('below_threshold');
  });

  it('keeps explicit datasets and statistics as factual material', () => {
    const result = classifyInformationEntryDeterministically({
      titlePath: '年度统计数据集',
      body: '这里汇总了可复核的统计数据与事实记录。',
      contentKeywords: ['dataset'],
      chunkMode: 'split',
    });

    expect(result.typeKeyword).toBe('factual_material');
    expect(result.diagnostics.type).toMatchObject({
      reason: 'assigned',
      winner: 'factual_material',
    });
  });

  it('keeps an explicit linked tutorial as an operating guideline', () => {
    const result = classifyInformationEntryDeterministically({
      titlePath: 'TinyGraph 使用教程',
      body: '这个开源工具的操作步骤见 https://example.test/guide 。',
      contentKeywords: ['TinyGraph'],
    });

    expect(result.typeKeyword).toBe('operating_guideline');
  });

  it('accepts an explicit body-only analysis signal', () => {
    const result = classifyInformationEntryDeterministically({
      titlePath: '年度结果',
      body: '这是一份对多个实现进行对比的基准测试与深入分析。',
      contentKeywords: [],
    });

    expect(result.typeKeyword).toBe('investigation_analysis');
  });

  it('does not guess a type from a generic software mention without a link', () => {
    const result = classifyInformationEntryDeterministically({
      titlePath: '一个软件',
      body: '这里提到一个普通软件。',
      contentKeywords: [],
    });

    expect(result.typeKeyword).toBeUndefined();
    expect(result.diagnostics.type.reason).toBe('no_signal');
  });

  it('fails closed and exposes tied domain evidence', () => {
    const result = classifyInformationEntryDeterministically({
      titlePath: '跨领域研究',
      body: '这项研究同时讨论两个方向。',
      contentKeywords: ['医学健康', '软件数据库'],
    });

    expect(result.domains).toEqual([]);
    expect(result.diagnostics.domain).toMatchObject({
      reason: 'tied',
      winnerScore: 6,
      runnerUpScore: 6,
    });
  });

  it('returns one primary and at most two stable secondary domains', () => {
    const result = classifyInformationEntryDeterministically({
      titlePath: '软件开发平台',
      body: '跨领域材料。',
      contentKeywords: ['艺术设计', '教育教学', '金融投资'],
    });

    expect(result.domains.map((domain) => domain.keyword)).toEqual([
      'engineering_computing',
      'culture_arts',
      'economy_business',
    ]);
    expect(result.domains).toHaveLength(3);
  });

  it('applies external aliases, mappings and exclusions without custom values', () => {
    const profile = decodeEntryClassificationProfile({
      format: ENTRY_CLASSIFICATION_PROFILE_FORMAT,
      version: ENTRY_CLASSIFICATION_PROFILE_VERSION,
      revision: 7,
      aliases: [{source: '容器平台', canonical: 'Docker'}],
      typeMappings: [{term: '动手实验', keyword: 'operating_guideline'}],
      domainMappings: [
        {term: 'Docker', keyword: 'engineering_computing'},
        {term: '教学专题', keyword: 'language_education'},
      ],
      exclusions: ['金融'],
    });
    expect(profile).toBeDefined();
    if (profile === undefined) throw new Error('synthetic profile rejected');

    const result = classifyInformationEntryDeterministically({
      titlePath: '容器平台动手实验',
      body: '金融噪声。',
      contentKeywords: ['教学专题'],
      profile,
      originVersion: 'profile-known-answer',
    });

    expect(result.typeKeyword).toBe('operating_guideline');
    expect(result.domains.map((domain) => domain.keyword)).toEqual([
      'engineering_computing',
      'language_education',
    ]);
    expect(
      result.domains.every(
        (domain) => domain.originVersion === 'profile-known-answer',
      ),
    ).toBe(true);
  });

  it('applies aliases once without order-dependent cascading expansion', () => {
    const profile = decodeEntryClassificationProfile({
      format: ENTRY_CLASSIFICATION_PROFILE_FORMAT,
      version: ENTRY_CLASSIFICATION_PROFILE_VERSION,
      revision: 3,
      aliases: [
        {source: 'first', canonical: 'second'},
        {source: 'second', canonical: 'tutorial'},
      ],
      typeMappings: [],
      domainMappings: [],
      exclusions: [],
    });
    expect(profile).toBeDefined();
    if (profile === undefined) throw new Error('synthetic profile rejected');

    const first = classifyInformationEntryDeterministically({
      titlePath: 'first',
      body: '',
      contentKeywords: [],
      profile,
    });
    const second = classifyInformationEntryDeterministically({
      titlePath: 'second',
      body: '',
      contentKeywords: [],
      profile,
    });

    expect(first.typeKeyword).toBeUndefined();
    expect(second.typeKeyword).toBe('operating_guideline');
  });

  it('rejects open, cyclic and other-valued profile rules', () => {
    const base = {
      format: ENTRY_CLASSIFICATION_PROFILE_FORMAT,
      version: ENTRY_CLASSIFICATION_PROFILE_VERSION,
      revision: 1,
      aliases: [],
      typeMappings: [],
      domainMappings: [],
      exclusions: [],
    };

    expect(
      decodeEntryClassificationProfile({...base, unknown: true}),
    ).toBeUndefined();
    expect(
      decodeEntryClassificationProfile({
        ...base,
        aliases: [
          {source: 'alpha', canonical: 'beta'},
          {source: 'beta', canonical: 'alpha'},
        ],
      }),
    ).toBeUndefined();
    expect(
      decodeEntryClassificationProfile({
        ...base,
        typeMappings: [{term: 'misc', keyword: 'other'}],
      }),
    ).toBeUndefined();
  });

  it('upgrades a closed legacy v1 profile and preserves its text mappings', () => {
    const profile = decodeEntryClassificationProfile({
      format: ENTRY_CLASSIFICATION_PROFILE_FORMAT,
      version: 1,
      revision: 2,
      aliases: [],
      typeMappings: [{term: 'owner phrase', keyword: 'argument'}],
      domainMappings: [],
      exclusions: [],
    });

    expect(profile).toMatchObject({
      version: ENTRY_CLASSIFICATION_PROFILE_VERSION,
      revision: 2,
      typeMappings: [
        {term: 'owner phrase', keyword: 'argument', scope: 'text'},
      ],
    });
    expect(profile?.typeThresholds).toHaveLength(9);
    expect(profile?.domainThresholds).toHaveLength(11);
    expect(profile?.neighborPolicy).toMatchObject({enabled: true});
  });

  it('uses exact content-keyword mappings without matching body substrings', () => {
    const profile = decodeEntryClassificationProfile({
      format: ENTRY_CLASSIFICATION_PROFILE_FORMAT,
      version: ENTRY_CLASSIFICATION_PROFILE_VERSION,
      revision: 4,
      aliases: [],
      typeMappings: [
        {
          term: 'owner-tool',
          keyword: 'operating_guideline',
          scope: 'content_keyword',
        },
      ],
      domainMappings: [],
      exclusions: [],
    });
    expect(profile).toBeDefined();
    if (profile === undefined) throw new Error('synthetic profile rejected');

    expect(
      classifyInformationEntryDeterministically({
        titlePath: '短条目',
        body: '没有体裁线索。',
        contentKeywords: ['owner-tool'],
        profile,
      }).typeKeyword,
    ).toBe('operating_guideline');
    expect(
      classifyInformationEntryDeterministically({
        titlePath: '短条目',
        body: '正文只是顺带写到 owner-tool。',
        contentKeywords: [],
        profile,
      }).typeKeyword,
    ).toBeUndefined();
  });

  it('admits large exact maps but keeps substring maps deliberately bounded', () => {
    const exactMappings = Array.from({length: 300}, (_, index) => ({
      term: `term-${index.toString()}`,
      keyword: 'knowledge_explanation',
      scope: 'content_keyword',
    }));
    const base = {
      format: ENTRY_CLASSIFICATION_PROFILE_FORMAT,
      version: ENTRY_CLASSIFICATION_PROFILE_VERSION,
      revision: 1,
      aliases: [],
      domainMappings: [],
      exclusions: [],
    };

    expect(
      decodeEntryClassificationProfile({...base, typeMappings: exactMappings}),
    ).toBeDefined();
    expect(
      decodeEntryClassificationProfile({
        ...base,
        typeMappings: exactMappings.slice(0, 257).map((mapping) => ({
          term: mapping.term,
          keyword: mapping.keyword,
          scope: 'text',
        })),
      }),
    ).toBeUndefined();
  });

  it('uses stricter thresholds only for empirically noisier categories', () => {
    const weakAnnouncement = classifyInformationEntryDeterministically({
      titlePath: '项目消息',
      body: 'This is an announcement.',
      contentKeywords: [],
    });
    const explicitAnnouncement = classifyInformationEntryDeterministically({
      titlePath: 'Project announcement',
      body: 'A concise update.',
      contentKeywords: [],
    });

    expect(weakAnnouncement.typeKeyword).toBeUndefined();
    expect(weakAnnouncement.diagnostics.type).toMatchObject({
      reason: 'below_threshold',
      minimumScore: 12,
    });
    expect(explicitAnnouncement.typeKeyword).toBe('public_communication');
  });
});
