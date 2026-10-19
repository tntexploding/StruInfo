import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {ReadingContent} from '../components/reading_content.js';
import {reportCommand} from '../api/report_client.js';
/** Revalidate publication authority before rendering a local print document. */
export async function printReport(reportId: string) {
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('report_popup_blocked');
  popup.opener = null;
  popup.document.title = '正在准备 PDF';
  popup.document.body.textContent = '正在核对报告来源并准备打印版…';
  try {
    const result = await reportCommand<{fileName: string; markdown: string}>(
      'report_export',
      {reportId},
    );
    popup.document.title = result.fileName.replace(/\.md$/u, '');
    const style = popup.document.createElement('style');
    style.textContent =
      '@page { size:A4; margin:18mm; } body { font:11pt/1.85 "Noto Serif SC","Source Han Serif SC","SimSun",serif; color:#18242c; background:white; max-width:180mm; margin:24px auto; } h1 {font-size:22pt;line-height:1.4} h2 {font-size:16pt;break-after:avoid} h3 {break-after:avoid} p {orphans:3;widows:3} a {color:#405fa4;overflow-wrap:anywhere} .reading-content,.reading-content__body,.reading-content__text {overflow:visible!important;max-height:none!important;height:auto!important;max-width:none!important} img {max-width:100%} pre {white-space:pre-wrap;overflow-wrap:anywhere} .print-controls {font-family:"Noto Sans SC","Microsoft YaHei UI",sans-serif} button {font-family:inherit;padding:12px 18px;margin:8px;cursor:pointer} @media print {.print-controls {display:none}}';
    popup.document.head.append(style);
    popup.document.body.textContent = '';
    const root = createRoot(popup.document.body);
    flushSync(() => {
      root.render(
        <>
          <div className="print-controls">
            <p>在打印窗口选择“另存为 PDF”。</p>
            <button
              onClick={() => {
                popup.print();
              }}
            >
              打印 / 保存 PDF
            </button>
          </div>
          <ReadingContent text={result.markdown} />
        </>,
      );
    });
    await popup.document.fonts.ready;
    if (!popup.closed) popup.print();
  } catch (error) {
    popup.close();
    throw error;
  }
}
