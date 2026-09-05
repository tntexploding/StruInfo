import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import type {InformationEntryQuerySynthesisResponse} from '../api/m1c_api_contract.js';
import {
  InformationEntryQuerySynthesis,
  InformationEntryQuerySynthesisAnswer,
} from './information_entry_query_synthesis.js';

describe('InformationEntryQuerySynthesis', () => {
  it('keeps an unavailable Provider visibly secondary to local Query', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryQuerySynthesis
        enabled={false}
        includePrivate={false}
        onlyPrivate={false}
        resultCount={3}
        searchRequest={{text: 'synthetic'}}
        onOpenEvidence={() => undefined}
        onSynthesize={() => Promise.reject(new Error('must not run'))}
      />,
    );

    expect(markup).toContain(
      '<h2 id="entry-query-synthesis-title">AI 回答</h2>',
    );
    expect(markup).toContain('AI 未启用');
    expect(markup).toContain('本地查询仍可使用');
    expect(markup).toContain('隐私内容不会发送');
    expect(markup).toContain('disabled');
    expect(markup).not.toContain('maxlength=');
  });

  it('does not present a send action as available in a private scope', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryQuerySynthesis
        enabled={true}
        includePrivate={true}
        onlyPrivate={false}
        resultCount={2}
        searchRequest={{includePrivate: true}}
        onOpenEvidence={() => undefined}
        onSynthesize={() => Promise.reject(new Error('must not run'))}
      />,
    );

    expect(markup).toContain('查看隐私内容不等于允许外发');
    expect(markup).toContain('disabled');
  });

  it('renders evidence status, claims, local source actions and limitations', () => {
    const response = successfulResponse();
    const markup = renderToStaticMarkup(
      <InformationEntryQuerySynthesisAnswer
        response={response}
        onOpenEvidence={() => undefined}
      />,
    );

    expect(markup).toContain('部分内容没有引用');
    expect(markup).not.toContain('synthetic-model');
    expect(markup).not.toContain('struinfo.openai-entry-query-synthesis.v1');
    expect(markup).toContain('查看来源 E01');
    expect(markup).toContain('来源 E01 · 合成方法');
    expect(markup).toContain('这里只显示部分正文');
    expect(markup).toContain('缺少长期结果证据');
    expect(markup).not.toContain('11111111-1111-4111-8111-111111111111');
  });
});

function successfulResponse(): Extract<
  InformationEntryQuerySynthesisResponse,
  {status: 'ok'}
> {
  return Object.freeze({
    status: 'ok',
    requestId: 'query-synthesis:1',
    querySha256: 'a'.repeat(64),
    providerKey: 'openai-responses-v1',
    model: 'synthetic-model',
    promptVersion: 'struinfo.openai-entry-query-synthesis.v1',
    answer: '这些公开结果共同描述了一个可复核的方法。',
    evidenceStatus: 'partial',
    claims: Object.freeze([
      Object.freeze({
        statement: '该方法具有明确步骤。',
        evidenceRefs: Object.freeze(['E01']),
      }),
    ]),
    limitations: Object.freeze(['缺少长期结果证据。']),
    evidence: Object.freeze([
      Object.freeze({
        handle: 'E01',
        entryId: '11111111-1111-4111-8111-111111111111',
        entryRevision: 1,
        snapshotId: '22222222-2222-4222-8222-222222222222',
        fragmentIds: Object.freeze(['33333333-3333-4333-8333-333333333333']),
        titlePath: '合成方法',
        excerpt: '这是用于测试展示边界的合成公开证据。',
        truncated: true,
        contentKeywords: Object.freeze(['合成关键词']),
        typeKeyword: Object.freeze({keyword: 'operating_guideline'}),
        domains: Object.freeze([
          Object.freeze({keyword: 'engineering_computing'}),
        ]),
      }),
    ]),
  });
}
