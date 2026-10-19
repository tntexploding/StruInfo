import {useCallback, useEffect, useRef, useState} from 'react';
import {aiWorkflowCommand, aiError} from '../api/ai_workflow_client.js';
export interface InboxSummary {
  text: string;
  model: string;
  promptVersion: string;
  createdAt: string;
}
export interface InboxPreview {
  snapshotId: string;
  title?: string;
  excerpt: string;
  source: {name: string; kind: string; host: string};
  summary?: InboxSummary;
}
function summaryError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  return code === 'ai_price_window_closed'
    ? '当前为高价时段，请在低价时段手动重试。'
    : code === 'inbox_summary_empty_source'
      ? '接收原文没有可概括的正文，请查看原文。'
      : code === 'ai_intake_input_too_large'
        ? '接收原文超出单次摘要范围，请直接查看原文。'
        : aiError(error);
}
export function useInboxPreviews(
  ids: readonly string[],
  includePrivate: boolean,
  enabled: boolean,
) {
  const [previews, setPreviews] = useState<ReadonlyMap<string, InboxPreview>>(
    new Map(),
  );
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [summaryErrors, setSummaryErrors] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const scope = ids.join(',');
  const running = useRef(false);
  const allowed = useRef(enabled);
  useEffect(() => {
    allowed.current = enabled;
  }, [enabled]);
  const generation = useRef(0);
  const isAllowed = () => allowed.current;
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const load = useCallback(async () => {
    const current = ++generation.current;
    if (!scope) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await aiWorkflowCommand<{
        previews: InboxPreview[];
        failed: {snapshotId: string; code: string}[];
      }>('intake_previews', {snapshotIds: scope.split(','), includePrivate});
      if (current !== generation.current) return;
      if (!Array.isArray(result.previews) || !Array.isArray(result.failed))
        throw new Error('inbox_preview_failed');
      setPreviews((old) => {
        const next = new Map(old);
        for (const preview of result.previews)
          next.set(preview.snapshotId, preview);
        return next;
      });
      setErrors(
        new Map(
          result.failed.map((item) => [
            item.snapshotId,
            '原文预览暂不可用，仍可查看原文。',
          ]),
        ),
      );
    } catch {
      if (current === generation.current)
        setErrors(
          new Map(
            scope.split(',').map((id) => [id, '来源与预览读取失败，请重试。']),
          ),
        );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [scope, includePrivate]);
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      invalidate();
      globalThis.clearTimeout(timer);
    };
  }, [load, invalidate]);
  async function summarize(snapshotIds: readonly string[]) {
    if (running.current || !isAllowed() || !snapshotIds.length) return;
    if (snapshotIds.length > 20) {
      setMessage('每批最多生成 20 份摘要，请减少选择。');
      return;
    }
    running.current = true;
    setBusy(true);
    setMessage('');
    let completed = 0,
      failed = 0;
    try {
      for (const id of snapshotIds) {
        if (!isAllowed()) break;
        setActiveId(id);
        setSummaryErrors((old) => {
          const next = new Map(old);
          next.delete(id);
          return next;
        });
        try {
          const summary = await aiWorkflowCommand<InboxSummary>(
            'intake_summarize',
            {snapshotId: id},
          );
          setPreviews((old) => {
            const next = new Map(old);
            const item = next.get(id);
            if (item) next.set(id, {...item, summary});
            return next;
          });
          completed++;
        } catch (error) {
          failed++;
          setSummaryErrors((old) => new Map(old).set(id, summaryError(error)));
          if (
            error instanceof Error &&
            [
              'ai_operations_paused',
              'ai_price_window_closed',
              'ai_not_configured',
            ].includes(error.message)
          )
            break;
        }
      }
      setMessage(
        `已完成 ${completed.toString()} 份摘要${failed ? `，${failed.toString()} 份未完成` : ''}。${!isAllowed() ? '摘要已关闭，剩余资料未调用。' : '接收决定保持不变。'}`,
      );
      await load();
    } finally {
      running.current = false;
      setBusy(false);
      setActiveId(undefined);
    }
  }
  return {
    previews,
    errors,
    summaryErrors,
    loading,
    activeId,
    busy,
    message,
    load,
    summarize,
  };
}
