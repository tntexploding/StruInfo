import {escape as e, icon} from '../data.js';
import {reports, attempt} from '../runtime/api.js';
import {download} from '../runtime/documents.js';
import {notice} from './notice.js';
import {openContentDialog} from './content-dialog.js';

const statuses = {
  queued: '排队',
  generating: '生成中',
  ready: '已完成',
  reviewed: '已核对',
  failed: '失败',
  paused: '已暂停',
  cancelled: '已取消',
};

// The accepted prototype's report surface; callers supply their existing business actions.
export function showReportReader(
  {report, staleSources = []},
  {actions = '', onAction, onDocument} = {},
) {
  const s = report.state;
  const sources = s.sources || [];
  const citation = (source) =>
    `<a class="citation-link" href="#/reading?doc=${encodeURIComponent(source.snapshotId)}">${icon('link')}[${e(source.handle)}] ${e(source.title)}</a>`;
  const content = `<article class="report-preview"><p>${e(statuses[s.status] || s.status)}${staleSources.length ? ' · 部分原文已更新' : ''}</p>${(
    s.items || []
  )
    .filter((i) => i.included !== false)
    .map((i) => {
      const story = i.edited || i.draft;
      if (!story) return '';
      const handles = new Set(story.points.flatMap((p) => p.sources));
      return `<section><h3>${e(story.title)}</h3>${story.points.map((p) => `<p>${e(p.text)} <small>${p.sources.map((n) => '[' + e(n) + ']').join(' ')}</small></p>`).join('')}${sources
        .filter((source) => handles.has(source.handle))
        .map(citation)
        .join('')}</section>`;
    })
    .join(
      '',
    )}${actions ? `<div class="operation-actions">${actions}</div>` : ''}</article>`;
  const controls =
    '<button class="secondary-action" data-report-action="export">导出 Markdown</button><button class="secondary-action" data-report-action="pdf">打印 / 保存 PDF</button>';
  return openContentDialog(s.title, content, {
    view: 'report',
    actions: controls,
    setup(root, close) {
      root.querySelectorAll('.citation-link').forEach(
        (link) =>
          (link.onclick = () => {
            close();
            onDocument?.();
          }),
      );
      root.querySelectorAll('[data-report-action]').forEach(
        (button) =>
          (button.onclick = () => {
            const action = button.dataset.reportAction;
            // Open synchronously so the browser accepts the print gesture.
            const win = action === 'pdf' ? window.open('', '_blank') : null;
            button.disabled = true;
            void attempt(
              async () => {
                if (action !== 'export' && action !== 'pdf') {
                  await onAction?.(action, close);
                  return;
                }
                if (action === 'pdf' && !win) throw new Error('请允许打印窗口');
                let out;
                try {
                  out = await reports('report_export', {
                    reportId: report.reportId,
                  });
                } catch (error) {
                  win?.close();
                  throw error;
                }
                if (action === 'export') download(out.fileName, out.markdown);
                else {
                  win.document.write(
                    '<!doctype html><meta charset=utf-8><title>' +
                      e(s.title) +
                      '</title><article style="white-space:pre-wrap;max-width:780px;margin:40px auto;font:18px/1.8 serif">' +
                      e(out.markdown) +
                      '</article>',
                  );
                  win.document.close();
                  win.focus();
                  win.print();
                }
              },
              (message) => notice(message, {kind: 'error'}),
            ).finally(() => {
              button.disabled = false;
            });
          }),
      );
    },
  });
}
