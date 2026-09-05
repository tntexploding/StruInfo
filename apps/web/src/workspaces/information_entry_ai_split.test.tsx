import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import {InformationEntryAiSplit} from './information_entry_ai_split.js';

describe('InformationEntryAiSplit', () => {
  it('keeps deterministic local splitting available without a Provider', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryAiSplit
        {...services()}
        enabled={false}
        snapshotId="11111111-1111-4111-8111-111111111111"
        isPrivate={false}
        alreadyMaterialized={false}
      />,
    );

    expect(markup).toContain('OpenAI 未启用');
    expect(markup).toContain('仍可使用人工拆分和结构规则');
    expect(markup).not.toContain('生成 AI 拆分建议</button>');
  });

  it('never offers external submission for a private document', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryAiSplit
        {...services()}
        enabled
        snapshotId="11111111-1111-4111-8111-111111111111"
        isPrivate
        alreadyMaterialized={false}
      />,
    );

    expect(markup).toContain('隐私文档不会发送给 OpenAI');
    expect(markup).not.toContain('生成 AI 拆分建议</button>');
  });

  it('makes disclosure, AI origin, manual acceptance and local fallback visible', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryAiSplit
        {...services()}
        enabled
        snapshotId="11111111-1111-4111-8111-111111111111"
        isPrivate={false}
        alreadyMaterialized={false}
      />,
    );

    expect(markup).toContain('当前公开文档的段落会发送给 OpenAI');
    expect(markup).toContain('结果需要你确认后才会保存');
    expect(markup).toContain('生成 AI 拆分建议');
    expect(markup).toContain('上方的结构规则');
    expect(markup).not.toContain('origin-label');
  });
});

function services() {
  return {
    onLoadSnapshot: () =>
      Promise.resolve({statusCode: 404, body: {status: 'not_found' as const}}),
    onList: () =>
      Promise.resolve({
        statusCode: 200,
        body: {status: 'ok' as const, proposals: []},
      }),
    onStart: () =>
      Promise.resolve({
        statusCode: 409,
        body: {status: 'rejected' as const, issue: {code: 'unused'}},
      }),
    onAccept: () =>
      Promise.resolve({
        statusCode: 409,
        body: {status: 'rejected' as const, issue: {code: 'unused'}},
      }),
    onReject: () =>
      Promise.resolve({
        statusCode: 409,
        body: {status: 'rejected' as const, issue: {code: 'unused'}},
      }),
    onAccepted: () => Promise.resolve(),
  };
}
