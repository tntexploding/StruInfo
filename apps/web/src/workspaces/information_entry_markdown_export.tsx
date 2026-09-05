import {useEffect, useRef, useState} from 'react';
import type {M1cApiClient} from '../api/m1c_api_client.js';
import type {
  EntryMarkdownExportResponse,
  EntryMarkdownPreview,
  InformationEntry,
} from '../api/m1c_api_contract.js';

export interface EntryMarkdownExportServices {
  readonly onPreviewMarkdownExport: M1cApiClient['previewEntryMarkdownExport'];
  readonly onGenerateMarkdownExport: M1cApiClient['generateEntryMarkdownExport'];
}
type SelectedEntry = EntryMarkdownPreview['entries'][number];

export function InformationEntryMarkdownExport({
  selectedEntry,
  privacyScope,
  onPreviewMarkdownExport,
  onGenerateMarkdownExport,
}: EntryMarkdownExportServices & {
  readonly selectedEntry: Readonly<InformationEntry> | undefined;
  readonly privacyScope: EntryMarkdownPreview['privacyScope'];
}) {
  const [entries, setEntries] = useState<readonly SelectedEntry[]>([]);
  const [title, setTitle] = useState('资料清单');
  const [preview, setPreview] = useState<Readonly<EntryMarkdownPreview>>();
  const [download, setDownload] =
    useState<Readonly<{url: string; fileName: string}>>();
  const [busy, setBusy] = useState<'preview' | 'export'>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const downloadUrl = useRef<string | undefined>(undefined);
  useEffect(
    () => () => {
      generation.current += 1;
      if (downloadUrl.current !== undefined)
        URL.revokeObjectURL(downloadUrl.current);
    },
    [],
  );
  function invalidate() {
    generation.current += 1;
    setBusy(undefined);
    setPreview(undefined);
    setMessage('');
    setError(false);
    if (downloadUrl.current !== undefined)
      URL.revokeObjectURL(downloadUrl.current);
    downloadUrl.current = undefined;
    setDownload(undefined);
  }
  function addSelected() {
    if (
      selectedEntry === undefined ||
      entries.length >= 20 ||
      entries.some((entry) => entry.entryId === selectedEntry.entryId)
    )
      return;
    invalidate();
    setEntries([
      ...entries,
      {
        entryId: selectedEntry.entryId,
        revision: selectedEntry.revision,
        revisionId: selectedEntry.revisionId,
        title: selectedEntry.value.titlePath || '未命名条目',
        isPrivate: selectedEntry.value.isPrivate,
      },
    ]);
  }
  const titleValid =
    title.trim() !== '' &&
    Array.from(title.trim()).length <= 120 &&
    !Array.from(title).some(
      (char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f,
    );
  const alreadyAdded = entries.some(
    (entry) => entry.entryId === selectedEntry?.entryId,
  );
  async function prepare(generating: boolean) {
    if (
      busy !== undefined ||
      entries.length === 0 ||
      !titleValid ||
      (generating && preview === undefined)
    )
      return;
    const request = ++generation.current;
    setBusy(generating ? 'export' : 'preview');
    setMessage('');
    setError(false);
    if (downloadUrl.current !== undefined)
      URL.revokeObjectURL(downloadUrl.current);
    downloadUrl.current = undefined;
    setDownload(undefined);
    const body = {
      title,
      privacyScope,
      entries: entries.map(({entryId, revision, revisionId}) => ({
        entryId,
        revision,
        revisionId,
      })),
      ...(generating ? {expectedSha256: preview?.sha256} : {}),
    };
    try {
      const response = await (generating
        ? onGenerateMarkdownExport(body)
        : onPreviewMarkdownExport(body));
      if (generation.current !== request) return;
      const result = response.body;
      if (result.status === 'rejected') {
        setPreview(undefined);
        setError(true);
        setMessage(exportError(result));
        return;
      }
      setPreview(result.preview);
      if (result.status === 'exported') {
        const url = URL.createObjectURL(
          new Blob([result.preview.markdown], {
            type: 'text/markdown;charset=utf-8',
          }),
        );
        downloadUrl.current = url;
        setDownload({url, fileName: result.file.fileName});
        setMessage('Markdown 已保存到工作区的外部导出目录，可下载到本机。');
      } else setMessage('预览已按当前资料核对，可生成这份 Markdown。');
    } catch {
      if (generation.current !== request) return;
      setPreview(undefined);
      setError(true);
      setMessage(
        generating
          ? '生成结果尚未确认，请重新预览后重试。'
          : '预览暂时不可用，请重试。',
      );
    } finally {
      if (generation.current === request) setBusy(undefined);
    }
  }
  return (
    <details className="workflow-tool-drawer entry-markdown-export">
      <summary>资料清单与导出 · {entries.length.toString()} 条</summary>
      <section
        className="entry-markdown-export__body"
        aria-label="资料清单导出"
        aria-busy={busy !== undefined}
      >
        <header>
          <h2>带来源的资料清单</h2>
          <span className="record-count">{entries.length.toString()} / 20</span>
        </header>
        <p>
          按选择顺序导出条目摘录、精确出处和清单内已有关系。同一查询翻页时保留；更改条件或离开查询页后清空。
        </p>
        <p>
          当前范围：
          {privacyScope === 'public'
            ? '仅公开'
            : privacyScope === 'private_only'
              ? '仅隐私'
              : '含隐私'}
          。仅导出所选条目及其来源摘录。
        </p>
        <div className="entry-command-actions">
          <button
            type="button"
            className="secondary-action"
            disabled={
              busy !== undefined ||
              selectedEntry === undefined ||
              alreadyAdded ||
              entries.length >= 20
            }
            onClick={addSelected}
          >
            {alreadyAdded ? '当前条目已加入' : '加入资料清单'}
          </button>
          <button
            type="button"
            className="text-action"
            disabled={busy !== undefined || entries.length === 0}
            onClick={() => {
              invalidate();
              setEntries([]);
            }}
          >
            清空资料清单
          </button>
        </div>
        <p>
          {selectedEntry === undefined
            ? '先选择一条查询结果。'
            : '当前选中：' + (selectedEntry.value.titlePath || '未命名条目')}
        </p>
        {entries.length === 0 ? (
          <p>清单为空。逐条选择结果并加入，最多 20 条。</p>
        ) : (
          <ol className="entry-markdown-export__selection">
            {entries.map((entry) => (
              <li key={entry.entryId}>
                <div>
                  <strong>{entry.title}</strong>
                  <span>
                    版本 {entry.revision.toString()} ·{' '}
                    {entry.isPrivate ? '隐私资料' : '公开资料'}
                  </span>
                </div>
                <button
                  type="button"
                  className="text-action"
                  disabled={busy !== undefined}
                  aria-label={'移出资料清单：' + entry.title}
                  onClick={() => {
                    invalidate();
                    setEntries(
                      entries.filter((item) => item.entryId !== entry.entryId),
                    );
                  }}
                >
                  移出
                </button>
              </li>
            ))}
          </ol>
        )}
        <label className="field">
          <span>清单标题</span>
          <input
            value={title}
            maxLength={240}
            disabled={busy !== undefined}
            onChange={(event) => {
              invalidate();
              setTitle(event.currentTarget.value);
            }}
          />
          <span>
            最多 120 个字符 · 当前 {Array.from(title).length.toString()} 个
          </span>
        </label>
        <div className="entry-command-actions">
          <button
            type="button"
            className="secondary-action"
            disabled={busy !== undefined || entries.length === 0 || !titleValid}
            onClick={() => void prepare(false)}
          >
            {busy === 'preview' ? '正在核对并预览…' : '预览资料清单'}
          </button>
          <button
            type="button"
            disabled={
              busy !== undefined ||
              preview === undefined ||
              download !== undefined
            }
            className="primary-action"
            onClick={() => void prepare(true)}
          >
            {busy === 'export'
              ? '正在生成…'
              : privacyScope === 'public'
                ? '生成 Markdown 文件'
                : '含隐私生成 Markdown 文件'}
          </button>
        </div>
        {message === '' ? null : (
          <p role={error ? 'alert' : 'status'}>{message}</p>
        )}
        {download === undefined ? null : (
          <p>
            <a href={download.url} download={download.fileName}>
              下载 Markdown
            </a>
          </p>
        )}
        {preview === undefined ? null : (
          <section
            aria-label="资料清单预览"
            className="entry-markdown-export__preview"
          >
            <h3>待导出内容</h3>
            <p>
              {preview.entries.length.toString()} 条 ·{' '}
              {preview.entries
                .filter((entry) => entry.isPrivate)
                .length.toString()}{' '}
              条隐私资料 · {preview.relationCount.toString()} 条关系 ·{' '}
              {preview.byteLength.toLocaleString()} 字节
            </p>
            <p>条目和关系变化后需重新预览。来源核对只表示核对了出处。</p>
            <pre tabIndex={0} aria-label="Markdown 内容预览">
              {preview.markdown}
            </pre>
          </section>
        )}
      </section>
    </details>
  );
}
function exportError(
  result: Extract<EntryMarkdownExportResponse, {status: 'rejected'}>,
): string {
  switch (result.issue.code) {
    case 'selection_stale':
      return '所选条目已更新。请重新查询，移除并重新加入条目后再预览。';
    case 'selection_unavailable':
      return '部分条目已不可见或已被替换。请重新查询并选择条目。';
    case 'preview_stale':
      return '资料或关系已变化，请重新预览后生成。';
    case 'evidence_unavailable':
      return '原始来源暂时无法完整读取，未生成文件；请检查材料后重试。';
    case 'export_too_large':
      return '清单超过导出大小限制，请减少所选条目。';
    case 'input_invalid':
      return '请检查清单标题和所选条目。';
    case 'export_storage_unavailable':
      return '文件保存失败，请检查外部导出目录后重试。';
    default:
      return '资料暂时无法读取，请重试。';
  }
}
