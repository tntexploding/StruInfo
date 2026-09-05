import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';

import {InformationEntryAutomationWorkQueue} from './information_entry_automation_work_queue.js';

const unavailable = () => Promise.reject(new Error('not called'));

describe('InformationEntryAutomationWorkQueue', () => {
  it('keeps the unavailable state honest and does not call inactive services', () => {
    const onList = vi.fn(unavailable);
    const onUpdate = vi.fn(unavailable);
    const onOpenEntry = vi.fn();

    const markup = renderToStaticMarkup(
      <InformationEntryAutomationWorkQueue
        enabled={false}
        onList={onList}
        onUpdate={onUpdate}
        onOpenEntry={onOpenEntry}
      />,
    );

    expect(markup).toContain('自动分流工作队列');
    expect(markup).toContain('当前服务未启用自动分流');
    expect(markup).toContain('仍可逐条编辑');
    expect(markup).not.toContain('标记完成');
    expect(onList).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onOpenEntry).not.toHaveBeenCalled();
  });

  it('renders explicit loading, privacy and refresh controls while data loads', () => {
    const markup = renderToStaticMarkup(
      <InformationEntryAutomationWorkQueue
        enabled
        onList={vi.fn(unavailable)}
        onUpdate={vi.fn(unavailable)}
        onOpenEntry={vi.fn()}
      />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('正在读取工作队列');
    expect(markup).toContain('显示隐私条目');
    expect(markup).toContain('刷新队列');
  });
});
