import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import type {InformationEntry} from '../api/m1c_api_contract.js';
import {InformationEntryAiTags} from './information_entry_ai_tags.js';

describe('InformationEntryAiTags', () => {
  it('keeps the complete manual path visible when no Provider is configured', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryAiTags
        {...services()}
        enabled={false}
        entry={entry(false)}
        onAccepted={() => Promise.resolve()}
      />,
    );

    expect(markup).toContain('OpenAI 未启用');
    expect(markup).toContain('仍可使用人工评分和自动标签建议');
    expect(markup).not.toContain('生成 AI 标签建议</button>');
  });

  it('never offers Provider submission for a private Entry', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryAiTags
        {...services()}
        enabled
        entry={entry(true)}
        onAccepted={() => Promise.resolve()}
      />,
    );

    expect(markup).toContain('隐私条目不会发送给 OpenAI');
    expect(markup).not.toContain('生成 AI 标签建议</button>');
  });

  it('explains the external disclosure and manual acceptance boundary', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryAiTags
        {...services()}
        enabled
        entry={entry(false)}
        onAccepted={() => Promise.resolve()}
      />,
    );

    expect(markup).toContain('当前条目的标题、正文和标签会发送给 OpenAI');
    expect(markup).toContain('结果需要你确认后才会保存');
    expect(markup).toContain('生成 AI 标签建议');
    expect(markup).not.toContain('origin-label');
  });
});

function services() {
  return {
    onListAiTagProposals: () =>
      Promise.resolve({
        statusCode: 200,
        body: {status: 'ok' as const, proposals: []},
      }),
    onStartAiTagProposal: () =>
      Promise.resolve({
        statusCode: 409,
        body: {
          status: 'rejected' as const,
          issue: {code: 'unused'},
        },
      }),
    onAcceptAiTagProposal: () =>
      Promise.resolve({
        statusCode: 409,
        body: {
          status: 'rejected' as const,
          issue: {code: 'unused'},
        },
      }),
    onRejectAiTagProposal: () =>
      Promise.resolve({
        statusCode: 409,
        body: {
          status: 'rejected' as const,
          issue: {code: 'unused'},
        },
      }),
  };
}

function entry(isPrivate: boolean): Readonly<InformationEntry> {
  return Object.freeze({
    workspaceId: '11111111-1111-4111-8111-111111111111',
    entryId: '22222222-2222-4222-8222-222222222222',
    resourceId: '33333333-3333-4333-8333-333333333333',
    snapshotId: '44444444-4444-4444-8444-444444444444',
    revision: 1,
    revisionId: '55555555-5555-4555-8555-555555555555',
    sourceKey: 'synthetic:entry',
    capturedAt: '2040-01-02T03:04:05.000Z',
    value: Object.freeze({
      documentOrder: 0,
      titlePath: 'Synthetic Entry',
      body: 'Synthetic body',
      bodySha256: 'a'.repeat(64),
      chunkMode: 'split',
      splitRuleVersion: 'struinfo.entry-split.section.v1',
      isPrivate,
      contentKeywords: Object.freeze([]),
      domains: Object.freeze([]),
      fragmentIds: Object.freeze(['66666666-6666-4666-8666-666666666666']),
    }),
  });
}
