import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import {InformationEntryTypeReviewPanel} from './information_entry_type_review_panel.js';

describe('InformationEntryTypeReviewPanel', () => {
  it('renders a focused, privacy-explicit correction surface before loading', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryTypeReviewPanel
        onOpenEvidence={() => undefined}
        onReviewTypes={() =>
          Promise.reject(new Error('effects do not run during static render'))
        }
        onRevise={() =>
          Promise.reject(new Error('no write during static render'))
        }
      />,
    );

    expect(markup).toContain('类型覆盖与快速纠错');
    expect(markup).toContain('未分类（优先处理）');
    expect(markup).toContain('包含隐私条目');
    expect(markup).toContain('正在读取类型覆盖率与当前队列');
    expect(markup).not.toContain('批量接受');
  });
});
