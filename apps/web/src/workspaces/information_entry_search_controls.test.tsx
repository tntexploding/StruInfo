import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import {InformationEntryRetrievalOptions} from './information_entry_search_controls.js';

describe('InformationEntryRetrievalOptions', () => {
  it('distinguishes an absent Provider from an index awaiting rebuild', () => {
    const unavailable = render(false, false);
    const awaitingIndex = render(true, false);

    expect(unavailable).toContain('未配置语义搜索模型');
    expect(awaitingIndex).toContain('内容相似索引尚未就绪');
    expect(awaitingIndex).not.toContain('未配置语义搜索模型');
  });

  it('enables semantic choices only for a ready public text query', () => {
    const ready = render(true, true);
    const privateScope = render(true, true, false);

    expect(ready).toContain('内容相似和综合搜索会按相似度排序');
    expect(ready.match(/disabled=""/gu)).toBeNull();
    expect(privateScope).toContain('隐私内容只在本机进行文字搜索');
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
