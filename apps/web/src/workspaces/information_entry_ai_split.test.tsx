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

    expect(markup).toContain('未配置 OpenAI Provider');
    expect(markup).toContain('按结构拆分仍可完整离线使用');
    expect(markup).not.toContain('生成 AI 拆分提案</button>');
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

    expect(markup).toContain('隐私文档不会发送给外部 Provider');
    expect(markup).not.toContain('生成 AI 拆分提案</button>');
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

    expect(markup).toContain('段落原文才会发送');
    expect(markup).toContain('结果不会自动写入');
    expect(markup).toContain('AI 生成 · 待人工确认');
    expect(markup).toContain('生成 AI 拆分提案');
    expect(markup).toContain('确定性结构规则');
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
