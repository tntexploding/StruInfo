import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import type {InformationEntry} from '../api/m1c_api_contract.js';
import {InformationEntryAiAssociations} from './information_entry_ai_associations.js';

describe('InformationEntryAiAssociations', () => {
  it('keeps manual and deterministic relation paths visible without a Provider', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryAiAssociations
        {...services()}
        enabled={false}
        entry={entry('2', false)}
        relatedEntry={entry('3', false)}
        onAccepted={() => Promise.resolve()}
      />,
    );

    expect(markup).toContain('未配置 OpenAI Provider');
    expect(markup).toContain('相似度关系和人工关系编辑仍可完整使用');
    expect(markup).not.toContain('生成关系提案</button>');
  });

  it('never offers Provider submission when either selected Entry is private', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryAiAssociations
        {...services()}
        enabled
        entry={entry('2', false)}
        relatedEntry={entry('3', true)}
        onAccepted={() => Promise.resolve()}
      />,
    );

    expect(markup).toContain('隐私条目不会发送给外部 Provider');
    expect(markup).not.toContain('生成关系提案</button>');
  });

  it('states the explicit pair disclosure and manual acceptance boundary', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryAiAssociations
        {...services()}
        enabled
        entry={entry('2', false)}
        relatedEntry={entry('3', false)}
        onAccepted={() => Promise.resolve()}
      />,
    );

    expect(markup).toContain('当前选中的两个公开条目');
    expect(markup).toContain('不会扫描其他条目');
    expect(markup).toContain('不会自动写入图谱');
    expect(markup).toContain('生成关系提案');
    expect(markup).toContain('AI 生成 · 待审核');
  });
});

function services() {
  return {
    onListAiAssociationProposals: () =>
      Promise.resolve({
        statusCode: 200,
        body: {status: 'ok' as const, proposals: []},
      }),
    onStartAiAssociationProposal: () =>
      Promise.resolve({
        statusCode: 409,
        body: {status: 'rejected' as const, issue: {code: 'unused'}},
      }),
    onAcceptAiAssociationProposal: () =>
      Promise.resolve({
        statusCode: 409,
        body: {status: 'rejected' as const, issue: {code: 'unused'}},
      }),
    onRejectAiAssociationProposal: () =>
      Promise.resolve({
        statusCode: 409,
        body: {status: 'rejected' as const, issue: {code: 'unused'}},
      }),
  };
}

function entry(
  suffix: '2' | '3',
  isPrivate: boolean,
): Readonly<InformationEntry> {
  return Object.freeze({
    workspaceId: '11111111-1111-4111-8111-111111111111',
    entryId: `${suffix.repeat(8)}-${suffix.repeat(4)}-4${suffix.repeat(3)}-8${suffix.repeat(3)}-${suffix.repeat(12)}`,
    resourceId: '44444444-4444-4444-8444-444444444444',
    snapshotId: '55555555-5555-4555-8555-555555555555',
    revision: 1,
    revisionId:
      suffix === '2'
        ? '66666666-6666-4666-8666-666666666666'
        : '77777777-7777-4777-8777-777777777777',
    sourceKey: `synthetic:entry:${suffix}`,
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: Object.freeze({
      documentOrder: Number(suffix),
      titlePath: `Synthetic Entry ${suffix}`,
      body: `Synthetic body ${suffix}`,
      bodySha256: suffix.repeat(64),
      chunkMode: 'split',
      splitRuleVersion: 'struinfo.entry-split.section.v1',
      isPrivate,
      contentKeywords: Object.freeze([]),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze([
        suffix === '2'
          ? '88888888-8888-4888-8888-888888888888'
          : '99999999-9999-4999-8999-999999999999',
      ]),
    }),
  });
}
