import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import {InformationEntryRetrievalOptions} from './information_entry_search_controls.js';

describe('InformationEntryRetrievalOptions', () => {
  it('distinguishes an absent Provider from an index awaiting rebuild', () => {
    const unavailable = render(false, false);
    const awaitingIndex = render(true, false);

    expect(unavailable).toContain('未配置 Embedding 模型');
    expect(awaitingIndex).toContain('模型已配置');
    expect(awaitingIndex).toContain('向量索引尚未就绪');
    expect(awaitingIndex).not.toContain('未配置 Embedding 模型');
  });

  it('enables semantic choices only for a ready public text query', () => {
    const ready = render(true, true);
    const privateScope = render(true, true, false);

    expect(ready).toContain('语义与混合模式使用当前可重建向量索引');
    expect(ready.match(/disabled=""/gu)).toBeNull();
    expect(privateScope).toContain('隐私范围仅使用本地词法查询');
    expect(privateScope.match(/disabled=""/gu)).toHaveLength(2);
  });
});

function render(
  semanticAvailable: boolean,
  semanticReady: boolean,
  publicScope = true,
): string {
  return renderToStaticMarkup(
    <InformationEntryRetrievalOptions
      mode="lexical"
      semanticAvailable={semanticAvailable}
      semanticReady={semanticReady}
      publicScope={publicScope}
      queryPresent
      onChange={() => undefined}
    />,
  );
}
