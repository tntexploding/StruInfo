import {useCallback, useEffect, useRef, useState} from 'react';
import {aiError, aiWorkflowCommand} from '../api/ai_workflow_client.js';
interface Sample {
  snapshotId: string;
  version: number;
  title: string;
  outcome: string;
  cause: string;
  reason: string;
  reasonOrigin: string;
}
interface SourceQuality {
  subscriptionId: string;
  label: string;
  enabled: boolean;
  reviewed: number;
  accepted: number;
  manualRejected: number;
  aiHeld: number;
  technicalHolds: number;
  incomplete: number;
  needsReview: boolean;
  samples: Sample[];
}
interface QualityStatus {
  revision: number;
  manualExamples: number;
  sources: SourceQuality[];
}
const LABELS: Record<string, string> = {
  accepted: '已接受',
  manual_rejected: '人工拒绝',
  ai_held: 'AI 暂缓',
  technical_hold: '获取或解析异常',
};
export function SourceQualityPanel({
  onReviewSource,
  onReviewInbox,
}: {
  onReviewSource?: ((subscriptionId: string) => void) | undefined;
  onReviewInbox: (snapshotId?: string) => void;
}) {
  const [data, setData] = useState<QualityStatus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const token = ++generation.current;
    try {
      const result = await aiWorkflowCommand<QualityStatus>(
        'source_quality_status',
      );
      if (!Array.isArray(result.sources))
        throw new Error('source_quality_unavailable');
      if (token === generation.current) {
        setData(result);
        setError('');
      }
    } catch (e) {
      if (token === generation.current) setError(aiError(e));
    }
  }, []);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    const start = setTimeout(() => void load(), 0);
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible' && !dialog.current?.open)
        void load();
    }, 30000);
    return () => {
      invalidate();
      clearTimeout(start);
      clearInterval(poll);
    };
  }, [load, invalidate]);
  async function decide(source: SourceQuality, action: 'keep' | 'close') {
    if (!data || busy) return;
    generation.current++;
    setBusy(true);
    setError('');
    try {
      const result = await aiWorkflowCommand<QualityStatus>(
        'source_quality_control',
        {
          subscriptionId: source.subscriptionId,
          expectedRevision: data.revision,
          action,
          samples: source.samples.map(({snapshotId, version}) => ({
            snapshotId,
            version,
          })),
        },
      );
      setData(result);
      setNotice(
        action === 'close'
          ? source.label + ' 已关闭订阅，可在文档入口重新启用。已有文档保留。'
          : source.label + ' 保持现状；出现至少 5 篇新的问题资料后再提醒。',
      );
    } catch (e) {
      setError(aiError(e));
    } finally {
      setBusy(false);
    }
  }
  const alerts = data?.sources.filter((s) => s.needsReview) ?? [];
  if (!alerts.length && !error && !notice && !open) return null;
  return (
    <section className="source-quality-notice" aria-label="来源质量复核">
      <span>
        <strong>
          {error
            ? '来源复核状态暂不可用'
            : alerts.length
              ? '来源需复核 · ' + String(alerts.length)
              : '来源复核已更新'}
        </strong>
        <small>查看通过、拒绝与暂缓原因，决定是否继续订阅。</small>
      </span>
      <button
        type="button"
        className="secondary-action"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        查看并决定
      </button>
      <dialog
        ref={dialog}
        className="source-quality-dialog"
        aria-labelledby="source-quality-heading"
        onClose={() => {
          setOpen(false);
          setNotice('');
        }}
      >
        <header>
          <h2 id="source-quality-heading">来源质量复核</h2>
          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              dialog.current?.close();
              setNotice('');
            }}
          >
            关闭面板
          </button>
        </header>
        <p>
          最近 20 篇已审核文档中，至少 5
          篇被拒绝或暂缓且占比达到一半时提醒。同一文章的不同版本只计一次；抓取异常单列。
        </p>
        <p>
          已有 {data?.manualExamples ?? 0} 份人工审核结果可供后续 AI
          审核参考。来源是否关闭由你决定。
        </p>
        {error ? (
          <p role="alert">
            {error}
            <button
              type="button"
              className="text-action"
              onClick={() => void load()}
            >
              重新读取
            </button>
          </p>
        ) : null}
        <p role="status">{notice}</p>
        <div className="source-quality-list">
          {alerts.length ? (
            alerts.map((source) => (
              <article key={source.subscriptionId}>
                <h3>{source.label}</h3>
                <p>
                  近期审核 {source.reviewed} 篇 · 接受 {source.accepted} ·
                  人工拒绝 {source.manualRejected} · AI 暂缓 {source.aiHeld}
                </p>
                <p>
                  其中疑似不完整 {source.incomplete} 篇，获取或解析异常{' '}
                  {source.technicalHolds} 篇，需解决读取或处理问题后再审核。
                </p>
                <div className="entry-command-actions">
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={busy}
                    onClick={() => void decide(source, 'keep')}
                  >
                    保持现状
                  </button>
                  <button
                    type="button"
                    className="primary-action"
                    disabled={busy}
                    onClick={() => {
                      dialog.current?.close();
                      if (onReviewSource) onReviewSource(source.subscriptionId);
                      else onReviewInbox(source.samples[0]?.snapshotId);
                    }}
                  >
                    重审这些资料
                  </button>
                  <button
                    type="button"
                    className="danger-action"
                    disabled={busy}
                    onClick={() => void decide(source, 'close')}
                  >
                    关闭此订阅
                  </button>
                </div>
                <details>
                  <summary>
                    查看 {source.samples.length} 份审核样本与原因
                  </summary>
                  <ul>
                    {source.samples.map((sample) => (
                      <li key={sample.snapshotId}>
                        <button
                          type="button"
                          className="text-action"
                          onClick={() => {
                            dialog.current?.close();
                            onReviewInbox(sample.snapshotId);
                          }}
                        >
                          {sample.title}
                        </button>
                        <span>
                          {LABELS[sample.outcome]}
                          {sample.reasonOrigin === 'model'
                            ? ' · 原 AI 判断'
                            : ''}
                        </span>
                        <p>
                          {sample.reason ||
                            '未填写原因，保留这篇文章的审核决定。'}
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              </article>
            ))
          ) : (
            <p>当前没有需要复核的来源。</p>
          )}
        </div>
      </dialog>
    </section>
  );
}
