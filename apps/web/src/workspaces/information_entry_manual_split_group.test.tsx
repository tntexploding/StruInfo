import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';

import {ManualSplitGroupEditor} from './information_entry_manual_split_group.js';

const FRAGMENT_ID = '55555555-5555-4555-8555-555555555555';

describe('ManualSplitGroupEditor', () => {
  it('renders a read-only source segment and explicit keyboard-reachable split action', () => {
    const markup = renderToStaticMarkup(
      <ManualSplitGroupEditor
        busy={false}
        group={{
          titlePath: 'Synthetic title',
          pieces: [
            {
              fragment: {
                fragmentId: FRAGMENT_ID,
                structureId: '44444444-4444-4444-8444-444444444444',
                nodeId: FRAGMENT_ID,
                nodeKind: 'section',
                codePointRange: {start: 0, end: 4},
                selectedTextSha256: 'a'.repeat(64),
                selectedText: 'A😀Z',
              },
              startCodePoint: 0,
              endCodePoint: 3,
            },
          ],
        }}
        groupIndex={0}
        onMergePrevious={vi.fn()}
        onSplitBefore={vi.fn()}
        onSplitWithin={vi.fn()}
        onTitleChange={vi.fn()}
      />,
    );

    expect(markup).toContain('<textarea readOnly=""');
    expect(markup).toContain('在光标处分开');
    expect(markup).toContain('字符 0–3');
    expect(markup).toContain('aria-label="条目 1 来源段 1 正文"');
  });
});
