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
});
