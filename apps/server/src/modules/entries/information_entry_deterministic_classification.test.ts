import {describe, expect, it} from 'vitest';

import {
  classifyInformationEntryDeterministically,
  DETERMINISTIC_ENTRY_CLASSIFICATION_RULE_VERSION,
} from './information_entry_deterministic_classification.js';

describe('deterministic InformationEntry classification', () => {
  it('assigns a high-confidence type and domain without inventing custom values', () => {
    expect(
      classifyInformationEntryDeterministically({
        titlePath: 'Docker 入门配置指南',
        body: '这是一份面向开发者的软件安装教程，包含命令行示例。',
        contentKeywords: ['Docker', '软件开发'],
      }),
    ).toEqual({
      typeKeyword: 'operating_guideline',
      domains: [
        {
          keyword: 'engineering_computing',
          origin: 'rule',
          originVersion: DETERMINISTIC_ENTRY_CLASSIFICATION_RULE_VERSION,
        },
      ],
    });
  });

  it('leaves ambiguous type and domain empty for Codex review', () => {
    expect(
      classifyInformationEntryDeterministically({
        titlePath: '一则短消息',
        body: '今天记录了一件事情。',
        contentKeywords: [],
      }),
    ).toEqual({domains: []});
  });

  it('fails closed on tied domain evidence', () => {
    expect(
      classifyInformationEntryDeterministically({
        titlePath: '跨领域研究',
        body: '这项医学研究同时讨论软件、数据库与健康、疾病。',
        contentKeywords: [],
      }).domains,
    ).toEqual([]);
  });
});
