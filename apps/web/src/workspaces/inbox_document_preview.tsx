import type {EvidenceSnapshotSummary} from '../api/m1c_api_contract.js';
import {sourceDisplayName} from '../components/reading_text.js';
import type {InboxPreview} from './use_inbox_previews.js';
const sourceKinds: Record<string, string> = {
  rss_atom: 'RSS / Atom',
  json_api: '订阅接口',
  web: '网页订阅',
  github_markdown: 'Git 订阅',
  plugin: '插件订阅',
  subscription: '订阅',
  git_file: 'Git 文档',
  uploaded_file: '上传文件',
  manual_text: '手动导入',
  remote_document: '网页资料',
};
export function InboxDocumentPreview({
  snapshot,
  preview,
  showSummary,
  loading,
  error,
  summaryError,
}: {
  readonly snapshot: Readonly<EvidenceSnapshotSummary>;
  readonly preview: InboxPreview | undefined;
  readonly showSummary: boolean;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly summaryError: string | undefined;
}) {
  let host = '';
  try {
    host = new URL(snapshot.canonicalUri ?? '').hostname;
  } catch {
    /*Local source.*/
  }
  const source = preview?.source;
  return (
    <>
      <p className="record-list__title">
        {preview?.title ?? sourceDisplayName(snapshot)}
      </p>
      <p className="record-list__meta inbox-source">
        <strong>
          来源：{source?.name ?? (host || sourceDisplayName(snapshot))}
        </strong>
        <span>
          {sourceKinds[source?.kind ?? snapshot.resourceKind] ?? '订阅资料'}
        </span>
        {source?.host && source.host !== source.name ? (
          <span>{source.host}</span>
        ) : null}
        <span>
          接收：
          {new Date(snapshot.capturedAt).toLocaleString('zh-CN', {
            hour12: false,
          })}
        </span>
      </p>
      {showSummary && preview?.summary ? (
        <p className="inbox-content-preview inbox-ai-summary">
          <strong>AI 简短摘要</strong>
          <span>{preview.summary.text}</span>
          <small>基于接收原文 · 请以原文为准</small>
        </p>
      ) : preview?.excerpt ? (
        <p className="inbox-content-preview">
          <strong>原文预览</strong>
          <span>{preview.excerpt}</span>
        </p>
      ) : (
        <p className="inbox-receipt-help">
          {error ??
            (loading
              ? '正在读取标题和原文预览…'
              : '暂无可用正文预览，可查看原文。')}
        </p>
      )}
      {summaryError && showSummary ? (
        <p role="status" className="inbox-summary-error">
          {summaryError}
        </p>
      ) : null}
    </>
  );
}
