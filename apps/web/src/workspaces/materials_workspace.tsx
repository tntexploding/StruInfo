import {useRef, useState} from 'react';
import type {DragEvent, SyntheticEvent} from 'react';

import type {
  EvidenceSnapshotSummary,
  M1cHttpResponse,
  SourceSubscriptionListResponse,
  SourceSubscriptionReplaceResponse,
  SourceSubscriptionRunResponse,
  SourceSubscriptionWrite,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import {
  createClientUuid,
  createCommandKey,
} from '../components/client_identity.js';
import type {
  ActionFeedback,
  Loadable,
  WorkspaceTransferFeedback,
} from '../components/product_types.js';
import {
  composeLocalDocumentImportRequest,
  describeLocalDocumentFileIssue,
  formatLocalDocumentFileBytes,
  prepareLocalDocumentFile,
  type LocalDocumentImportIdentity,
  type PreparedLocalDocumentFile,
} from './local_file_import.js';
import {LocalFileBatchImport} from './local_file_batch_import.js';
import {SourceSubscriptionPanel} from './source_subscription_panel.js';

interface ImportIdentity extends LocalDocumentImportIdentity {
  readonly commandIdempotencyKey: string;
  readonly capturedAt: string;
  readonly observationId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
}

type SourceMode = 'manual_text' | 'git_file' | 'uploaded_file';
type LocalCaptureMode = 'single' | 'batch';

type LocalFileState =
  | Readonly<{status: 'idle'}>
  | Readonly<{status: 'loading'; fileName: string}>
  | Readonly<{status: 'ready'; value: Readonly<PreparedLocalDocumentFile>}>
  | Readonly<{status: 'error'; fileName: string; message: string}>;

export interface MaterialsWorkspaceProps {
  readonly onImport: (body: unknown) => Promise<ActionFeedback>;
  readonly onImportBatchItem?: (body: unknown) => Promise<ActionFeedback>;
  readonly onImportBatchCompleted?: () => Promise<void> | void;
  readonly onOpenEvidence: (
    snapshotId: string,
    returnFocus?: HTMLElement,
    includePrivate?: boolean,
  ) => void;
  readonly onRefresh: () => void;
  readonly onExport: () => Promise<WorkspaceTransferFeedback>;
  readonly onRestore: (fileName: string) => Promise<WorkspaceTransferFeedback>;
  readonly selectedSnapshotId?: string | undefined;
  readonly snapshots: Loadable<readonly Readonly<EvidenceSnapshotSummary>[]>;
  readonly sourceSubscriptionsEnabled: boolean;
  readonly onListSourceSubscriptions: () => Promise<
    M1cHttpResponse<SourceSubscriptionListResponse>
  >;
  readonly onReplaceSourceSubscriptions: (
    expectedRevision: number,
    subscriptions: readonly Readonly<SourceSubscriptionWrite>[],
  ) => Promise<M1cHttpResponse<SourceSubscriptionReplaceResponse>>;
  readonly onRunSourceSubscription: (
    subscriptionId: string,
    requestKey: string,
  ) => Promise<M1cHttpResponse<SourceSubscriptionRunResponse>>;
}

export function MaterialsWorkspace({
  onImport,
  onImportBatchItem,
  onImportBatchCompleted,
  onOpenEvidence,
  onRefresh,
  onExport,
  onRestore,
  selectedSnapshotId,
  snapshots,
  sourceSubscriptionsEnabled,
  onListSourceSubscriptions,
  onReplaceSourceSubscriptions,
  onRunSourceSubscription,
}: MaterialsWorkspaceProps) {
  const importHeading = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const localFileReadGeneration = useRef(0);
  const [identity, setIdentity] =
    useState<ImportIdentity>(createImportIdentity);
  const [sourceMode, setSourceMode] = useState<SourceMode>('manual_text');
  const [localCaptureMode, setLocalCaptureMode] =
    useState<LocalCaptureMode>('single');
  const [localBatchState, setLocalBatchState] = useState<
    Readonly<{hasItems: boolean; busy: boolean}>
  >({hasItems: false, busy: false});
  const [localFile, setLocalFile] = useState<LocalFileState>({status: 'idle'});
  const [isPrivate, setIsPrivate] = useState(false);
  const [showPrivateDocuments, setShowPrivateDocuments] = useState(false);
  const [sourceKey, setSourceKey] = useState('');
  const [canonicalUri, setCanonicalUri] = useState('');
  const [repositoryUri, setRepositoryUri] = useState('');
  const [repositoryPath, setRepositoryPath] = useState('');
  const [repositoryRef, setRepositoryRef] = useState('');
  const [commitDigest, setCommitDigest] = useState('');
  const [publicationDate, setPublicationDate] = useState('');
  const [profile, setProfile] = useState<'commonmark-v1' | 'ruanyf-weekly-v1'>(
    'commonmark-v1',
  );
  const [sourceText, setSourceText] = useState('');
  const [sourcePreface, setSourcePreface] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const [bundleFileName, setBundleFileName] = useState('');
  const [transferFeedback, setTransferFeedback] =
    useState<WorkspaceTransferFeedback>();
  const [transferOperation, setTransferOperation] = useState<
    'export' | 'restore'
  >();

  async function readLocalFile(file: File | undefined) {
    if (file === undefined) return;
    const generation = localFileReadGeneration.current + 1;
    localFileReadGeneration.current = generation;
    setLocalFile({status: 'loading', fileName: file.name});
    try {
      const prepared = prepareLocalDocumentFile(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      );
      if (localFileReadGeneration.current !== generation) return;
      if (prepared.status === 'rejected') {
        setLocalFile({
          status: 'error',
          fileName: file.name,
          message: describeLocalDocumentFileIssue(prepared.code),
        });
        return;
      }
      setLocalFile({status: 'ready', value: prepared.value});
      if (
        prepared.value.documentFormat !== 'markdown' ||
        prepared.value.mediaType === 'text/plain'
      ) {
        setProfile('commonmark-v1');
      }
    } catch {
      if (localFileReadGeneration.current === generation) {
        setLocalFile({
          status: 'error',
          fileName: file.name,
          message: '文件读取失败；没有向本地服务发送任何内容。',
        });
      }
    }
  }

  function clearLocalFile() {
    localFileReadGeneration.current += 1;
    setLocalFile({status: 'idle'});
    if (fileInput.current !== null) fileInput.current.value = '';
  }

  async function submitImport(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (sourceMode === 'uploaded_file' && localCaptureMode === 'batch') return;
    setSubmitting(true);
    setFeedback(undefined);
    try {
      const {capturedAt} = identity;
      const gitSource = sourceMode === 'git_file';
      const uploadedSource = sourceMode === 'uploaded_file';
      let resolvedSourceKey: string;
      const mediaType = 'text/markdown';
      const documentFormat = 'markdown';
      let sourcePayload: Readonly<
        {sourceText: string} | {sourceBase64: string}
      >;
      if (uploadedSource) {
        if (localFile.status !== 'ready') {
          setFeedback({
            kind: 'error',
            title: '尚未选择可导入文件',
            detail: '请选择有效的 Markdown、TXT、HTML 或含文字层的 PDF。',
          });
          return;
        }
        const request = await composeLocalDocumentImportRequest({
          identity,
          file: localFile.value,
          isPrivate,
          publicationDate,
          profile,
          sourcePreface,
          sourceKey,
          canonicalUri,
        });
        if (request.status === 'rejected') {
          setFeedback({
            kind: 'error',
            title: '组合后的文档超过上限',
            detail: '文件与前置文字合计不得超过 1 MiB；没有写入任何数据。',
          });
          return;
        }
        const nextFeedback = await onImport(request.body);
        setFeedback(nextFeedback);
        if (nextFeedback.kind === 'success') {
          setIdentity(createImportIdentity());
          setSourceKey('');
          setCanonicalUri('');
          setPublicationDate('');
          setSourcePreface('');
          setIsPrivate(false);
          clearLocalFile();
        }
        return;
      } else {
        resolvedSourceKey =
          sourceKey.trim() || `import-${identity.snapshotId.slice(0, 8)}`;
        const importedText =
          sourcePreface.trim() === ''
            ? sourceText
            : `${sourcePreface.trim()}\n\n${sourceText}`;
        sourcePayload = {sourceText: importedText};
      }
      const body = {
        commandIdempotencyKey: identity.commandIdempotencyKey,
        resource: {
          resourceId: identity.resourceId,
          resourceKind: sourceMode,
          sourceKey: resolvedSourceKey,
          ...(isPrivate ? {isPrivate: true} : {}),
          ...(canonicalUri.trim() === ''
            ? {}
            : {canonicalUri: canonicalUri.trim()}),
        },
        snapshot: {
          snapshotId: identity.snapshotId,
          resourceId: identity.resourceId,
          capturedAt,
          mediaType,
          ...(publicationDate === ''
            ? {}
            : {
                publication: {
                  instant: `${publicationDate}T00:00:00.000Z`,
                  sourceTimezone: 'UTC',
                  precision: 'day',
                  sourceText: publicationDate,
                  inferred: false,
                },
              }),
        },
        ...(gitSource
          ? {
              gitResource: {
                resourceId: identity.resourceId,
                canonicalRepositoryUri: repositoryUri.trim(),
                repositoryRelativePath: repositoryPath.trim(),
              },
            }
          : {}),
        gitObservations: gitSource
          ? [
              {
                observationId: identity.observationId,
                resourceId: identity.resourceId,
                snapshotId: identity.snapshotId,
                repositoryRef: repositoryRef.trim(),
                commit: {
                  algorithm: commitDigest.length === 40 ? 'sha1' : 'sha256',
                  digest: commitDigest,
                },
                observedAt: capturedAt,
              },
            ]
          : [],
        documentFormat,
        profile,
        ...sourcePayload,
        ...(canonicalUri.trim() === ''
          ? {}
          : {documentBaseUri: canonicalUri.trim()}),
      };
      const nextFeedback = await onImport(body);
      setFeedback(nextFeedback);
      if (nextFeedback.kind === 'success') {
        setIdentity(createImportIdentity());
        setSourceKey('');
        setCanonicalUri('');
        setRepositoryUri('');
        setRepositoryPath('');
        setRepositoryRef('');
        setCommitDigest('');
        setPublicationDate('');
        setSourceText('');
        setSourcePreface('');
        setIsPrivate(false);
        clearLocalFile();
      }
    } catch {
      setFeedback({
        kind: 'error',
        title: '文件未能准备完成',
        detail: '本机文件摘要或编码失败；没有向数据库写入任何内容。',
      });
    } finally {
      setSubmitting(false);
    }
  }
  async function exportWorkspace() {
    if (transferOperation !== undefined) return;
    setTransferOperation('export');
    setTransferFeedback(undefined);
    try {
      const nextFeedback = await onExport();
      setTransferFeedback(nextFeedback);
      if (
        nextFeedback.kind === 'success' &&
        nextFeedback.fileName !== undefined
      ) {
        setBundleFileName(nextFeedback.fileName);
      }
    } finally {
      setTransferOperation(undefined);
    }
  }

  async function restoreWorkspace(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (transferOperation !== undefined || bundleFileName.trim() === '') return;
    setTransferOperation('restore');
    setTransferFeedback(undefined);
    try {
      setTransferFeedback(await onRestore(bundleFileName.trim()));
    } finally {
      setTransferOperation(undefined);
    }
  }

  return (
    <div className="workspace-view materials-workspace">
      <header className="workflow-page-heading">
        <div>
          <p className="section-index">01 / DOCUMENT IMPORT</p>
          <h1>导入</h1>
          <p>
            记录来源、格式、日期与隐私范围，并保存不可变 Snapshot。正文进入外部
            Blob 存储，不进入 Git 或应用包体。
          </p>
        </div>
        <button className="secondary-action" type="button" onClick={onRefresh}>
          刷新材料列表
        </button>
      </header>

      <aside className="workflow-mode-summary" aria-label="导入页操作指南">
        <strong>导入文档</strong>
        <span>1. 选择文件并填写来源信息</span>
        <span>2. 确认隐私范围后开始导入</span>
        <span>3. 在右侧查看已导入文档</span>
      </aside>

      <section className="intake-console" aria-labelledby="import-title">
        <header className="console-heading">
          <div>
            <p className="section-index">SOURCE / CAPTURE</p>
            <h2 id="import-title" ref={importHeading} tabIndex={-1}>
              导入来源
            </h2>
          </div>
          <span className="origin-label origin-label--deterministic">
            确定性解析 · 非 AI
          </span>
        </header>
        <form
          className="import-form"
          onSubmit={(event) => {
            void submitImport(event);
          }}
        >
          <fieldset className="source-mode-fieldset field--full">
            <legend>来源类型</legend>
            <label>
              <input
                type="radio"
                name="source-mode"
                value="manual_text"
                checked={sourceMode === 'manual_text'}
                disabled={localBatchState.hasItems}
                onChange={() => {
                  setSourceMode('manual_text');
                }}
              />
              手动文本
            </label>
            <label>
              <input
                type="radio"
                name="source-mode"
                value="git_file"
                checked={sourceMode === 'git_file'}
                disabled={localBatchState.hasItems}
                onChange={() => {
                  setSourceMode('git_file');
                }}
              />
              固定 Git 文件
            </label>
            <label>
              <input
                type="radio"
                name="source-mode"
                value="uploaded_file"
                checked={sourceMode === 'uploaded_file'}
                disabled={localBatchState.hasItems}
                onChange={() => {
                  setSourceMode('uploaded_file');
                }}
              />
              本地文件
            </label>
          </fieldset>
          {sourceMode === 'uploaded_file' ? (
            <section
              className="local-file-import field--full"
              aria-labelledby="local-file-import-title"
            >
              <div className="local-file-import__heading">
                <div>
                  <h3 id="local-file-import-title">选择本地文档</h3>
                  <p>
                    .md / .markdown / .txt / .html / .htm / .pdf · 最大 1 MiB
                  </p>
                </div>
                {localCaptureMode === 'single' &&
                localFile.status === 'ready' ? (
                  <button
                    className="text-action"
                    type="button"
                    onClick={clearLocalFile}
                  >
                    移除文件
                  </button>
                ) : null}
              </div>
              <fieldset className="local-capture-mode">
                <legend>选择方式</legend>
                <label>
                  <input
                    type="radio"
                    name="local-capture-mode"
                    value="single"
                    checked={localCaptureMode === 'single'}
                    disabled={localBatchState.hasItems}
                    onChange={() => {
                      setLocalCaptureMode('single');
                    }}
                  />
                  单份文件
                </label>
                <label>
                  <input
                    type="radio"
                    name="local-capture-mode"
                    value="batch"
                    checked={localCaptureMode === 'batch'}
                    disabled={localBatchState.hasItems}
                    onChange={() => {
                      clearLocalFile();
                      setLocalCaptureMode('batch');
                    }}
                  />
                  多份批次
                </label>
              </fieldset>
              {localBatchState.hasItems ? (
                <p className="local-file-batch__message" role="status">
                  请先清空当前批次，再切换来源类型或选择方式。
                </p>
              ) : null}
              {localCaptureMode === 'single' ? (
                <>
                  <input
                    ref={fileInput}
                    className="local-file-input"
                    id="local-document-file"
                    type="file"
                    accept=".md,.markdown,.txt,.html,.htm,.pdf,text/markdown,text/plain,text/html,application/pdf"
                    onChange={(event) => {
                      void readLocalFile(
                        event.currentTarget.files?.item(0) ?? undefined,
                      );
                    }}
                  />
                  <div
                    className="local-file-dropzone"
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'copy';
                    }}
                    onDrop={(event: DragEvent<HTMLDivElement>) => {
                      event.preventDefault();
                      void readLocalFile(
                        event.dataTransfer.files.item(0) ?? undefined,
                      );
                    }}
                  >
                    <label
                      className="secondary-action"
                      htmlFor="local-document-file"
                    >
                      选择文件
                    </label>
                    <span>或将一份文件拖到这里</span>
                  </div>
                  <div className="local-file-import__status" aria-live="polite">
                    {localFile.status === 'idle' ? (
                      <p>浏览器只读取你明确选择的文件，不会读取目录路径。</p>
                    ) : null}
                    {localFile.status === 'loading' ? (
                      <p role="status">正在读取 {localFile.fileName}…</p>
                    ) : null}
                    {localFile.status === 'error' ? (
                      <p role="alert">
                        <strong>{localFile.fileName}</strong> ·{' '}
                        {localFile.message}
                      </p>
                    ) : null}
                    {localFile.status === 'ready' ? (
                      <dl className="local-file-facts">
                        <div>
                          <dt>文件</dt>
                          <dd>{localFile.value.fileName}</dd>
                        </div>
                        <div>
                          <dt>类型</dt>
                          <dd>{localFile.value.mediaType}</dd>
                        </div>
                        <div>
                          <dt>大小</dt>
                          <dd>
                            {formatLocalDocumentFileBytes(
                              localFile.value.byteLength,
                            )}
                          </dd>
                        </div>
                      </dl>
                    ) : null}
                  </div>
                </>
              ) : (
                <LocalFileBatchImport
                  isPrivate={isPrivate}
                  publicationDate={publicationDate}
                  profile={profile}
                  sourcePreface={sourcePreface}
                  onImport={onImportBatchItem ?? onImport}
                  onCompleted={onImportBatchCompleted ?? onRefresh}
                  onStateChange={setLocalBatchState}
                />
              )}
            </section>
          ) : null}
          <label className="privacy-choice field--full">
            <input
              type="checkbox"
              checked={isPrivate}
              disabled={localBatchState.busy}
              onChange={(event) => {
                setIsPrivate(event.currentTarget.checked);
              }}
            />
            <span>
              <strong>作为隐私文档录入</strong>
              <small>
                原始文件和规范化全文都会完整保存在外部工作区；拆出的知识与相关关系自动继承私密范围。
              </small>
            </span>
          </label>
          {sourceMode !== 'uploaded_file' || localCaptureMode === 'single' ? (
            <label className="field field--wide">
              <span>来源别名（可选）</span>
              <input
                maxLength={500}
                value={sourceKey}
                onChange={(event) => {
                  setSourceKey(event.currentTarget.value);
                }}
                placeholder={
                  sourceMode === 'uploaded_file'
                    ? '留空时按文件名与 SHA-256 生成'
                    : '留空时按本次导入身份自动生成'
                }
              />
            </label>
          ) : (
            <div className="field field--wide batch-identity-note">
              <span>逐文件来源身份</span>
              <p>每份文件按文件名与 SHA-256 独立生成，不共享来源别名。</p>
            </div>
          )}
          {sourceMode === 'git_file' ? (
            <fieldset className="git-source-fields field--full">
              <legend>Git 来源身份</legend>
              <label className="field field--wide">
                <span>仓库规范 URI</span>
                <input
                  required
                  type="url"
                  value={repositoryUri}
                  onChange={(event) => {
                    setRepositoryUri(event.currentTarget.value);
                  }}
                  placeholder="https://github.com/owner/repository"
                />
              </label>
              <label className="field field--wide">
                <span>仓库内路径</span>
                <input
                  required
                  value={repositoryPath}
                  onChange={(event) => {
                    setRepositoryPath(event.currentTarget.value);
                  }}
                  placeholder="docs/issue.md"
                />
              </label>
              <label className="field">
                <span>观察到的 ref</span>
                <input
                  required
                  value={repositoryRef}
                  onChange={(event) => {
                    setRepositoryRef(event.currentTarget.value);
                  }}
                  placeholder="refs/heads/master"
                />
              </label>
              <label className="field">
                <span>精确 commit（小写 SHA）</span>
                <input
                  required
                  minLength={40}
                  maxLength={64}
                  pattern="(?:[0-9a-f]{40}|[0-9a-f]{64})"
                  value={commitDigest}
                  onChange={(event) => {
                    setCommitDigest(event.currentTarget.value);
                  }}
                  placeholder="40 或 64 位十六进制摘要"
                />
              </label>
            </fieldset>
          ) : null}
          {sourceMode !== 'uploaded_file' || localCaptureMode === 'single' ? (
            <label className="field field--wide">
              <span>规范来源链接（可选）</span>
              <input
                type="url"
                value={canonicalUri}
                onChange={(event) => {
                  setCanonicalUri(event.currentTarget.value);
                }}
                placeholder="https://…"
              />
            </label>
          ) : null}
          <label className="field">
            <span>文档格式与解析规则</span>
            <select
              value={profile}
              disabled={
                localBatchState.busy ||
                (sourceMode === 'uploaded_file' &&
                  localFile.status === 'ready' &&
                  (localFile.value.mediaType === 'text/plain' ||
                    localFile.value.documentFormat !== 'markdown'))
              }
              onChange={(event) => {
                setProfile(
                  event.currentTarget.value as
                    'commonmark-v1' | 'ruanyf-weekly-v1',
                );
              }}
            >
              <option value="commonmark-v1">通用 CommonMark</option>
              <option value="ruanyf-weekly-v1">科技爱好者周刊</option>
            </select>
          </label>
          <label className="field">
            <span>发布日期（UTC，可选）</span>
            <input
              type="date"
              value={publicationDate}
              disabled={localBatchState.busy}
              onChange={(event) => {
                setPublicationDate(event.currentTarget.value);
              }}
            />
          </label>
          <label className="field field--full import-preface-field">
            <span>正文前置文字（可选）</span>
            <textarea
              rows={3}
              value={sourcePreface}
              disabled={localBatchState.busy}
              onChange={(event) => {
                setSourcePreface(event.currentTarget.value);
              }}
              placeholder="需要时补充标题、导语或上下文；保存后将成为本次 Snapshot 正文的一部分。"
            />
            {sourceMode === 'uploaded_file' ? (
              <small>
                HTML/PDF 始终保留精确原始字节；前置文字只加入可拆分文字投影。
                Markdown/TXT 填写后会生成一份组合后的新 Snapshot。
              </small>
            ) : null}
          </label>
          {sourceMode !== 'uploaded_file' || localCaptureMode === 'single' ? (
            <label className="field field--full">
              <span>
                {sourceMode === 'uploaded_file'
                  ? localFile.status === 'ready' &&
                    localFile.value.documentFormat === 'pdf'
                    ? 'PDF 导入说明'
                    : '文件正文预览'
                  : 'Markdown 正文'}
              </span>
              <textarea
                required={sourceMode !== 'uploaded_file'}
                readOnly={sourceMode === 'uploaded_file'}
                rows={12}
                value={
                  sourceMode === 'uploaded_file' && localFile.status === 'ready'
                    ? localFile.value.sourceText
                    : sourceMode === 'uploaded_file'
                      ? ''
                      : sourceText
                }
                onChange={(event) => {
                  if (sourceMode !== 'uploaded_file') {
                    setSourceText(event.currentTarget.value);
                  }
                }}
                placeholder={
                  sourceMode === 'uploaded_file'
                    ? localFile.status === 'ready' &&
                      localFile.value.documentFormat === 'pdf'
                      ? 'PDF 文字层将在本地服务导入时按页提取；导入后请在“拆分”页检查和修改。扫描件暂不支持 OCR。'
                      : '选择文件后在这里检查正文；编辑请使用前置文字或后续拆分流程。'
                    : '粘贴或输入待保存的 Markdown；内容不会写入 Git 或前端包体。'
                }
              />
            </label>
          ) : null}
          {sourceMode !== 'uploaded_file' || localCaptureMode === 'single' ? (
            <div className="form-commit field--full">
              <p>
                导入会创建不可变 Snapshot、结构节点与精确
                Fragment；相同命令键可安全重试。
              </p>
              <button
                className="primary-action"
                type="submit"
                disabled={
                  submitting ||
                  (sourceMode === 'uploaded_file'
                    ? localFile.status !== 'ready'
                    : sourceText === '') ||
                  (sourceMode === 'git_file' &&
                    (repositoryUri.trim() === '' ||
                      repositoryPath.trim() === '' ||
                      repositoryRef.trim() === '' ||
                      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(commitDigest)))
                }
              >
                {submitting ? '正在写入…' : '保存来源 Snapshot'}
              </button>
            </div>
          ) : (
            <p className="batch-import-boundary field--full">
              批次按钮位于文件队列内。每个文件独立保存为一个不可变
              Snapshot；批次不会自动拆分为 Entry、生成标签、建立联系或调用 AI。
            </p>
          )}
        </form>
        <ActionNotice feedback={feedback} />
      </section>

      <section
        className="record-list-section"
        aria-labelledby="evidence-list-title"
      >
        <header className="subsection-heading">
          <div>
            <p className="section-index">IMPORT HISTORY / RECENT 200</p>
            <h2 id="evidence-list-title">已导入文档</h2>
          </div>
          {snapshots.status === 'ready' ? (
            <div className="record-list-controls">
              <label className="privacy-query-toggle">
                <input
                  type="checkbox"
                  checked={showPrivateDocuments}
                  onChange={(event) => {
                    setShowPrivateDocuments(event.currentTarget.checked);
                  }}
                />
                查看隐私文档
              </label>
              <span className="record-count">{snapshots.value.length} 条</span>
            </div>
          ) : null}
        </header>
        <SnapshotList
          snapshots={snapshots}
          selectedSnapshotId={selectedSnapshotId}
          onOpenEvidence={onOpenEvidence}
          onStartImport={() => {
            importHeading.current?.focus();
          }}
          showPrivateDocuments={showPrivateDocuments}
        />
      </section>

      <SourceSubscriptionPanel
        enabled={sourceSubscriptionsEnabled}
        onList={onListSourceSubscriptions}
        onReplace={onReplaceSourceSubscriptions}
        onRun={onRunSourceSubscription}
      />

      <section
        className="workspace-transfer-section"
        aria-labelledby="workspace-transfer-title"
      >
        <header className="subsection-heading">
          <div>
            <p className="section-index">PERSONAL DATA / PORTABILITY</p>
            <h2 id="workspace-transfer-title">全部个人数据导入导出</h2>
          </div>
          <span className="origin-label origin-label--deterministic">
            同一 Workspace ID
          </span>
        </header>
        <div className="workspace-transfer-grid">
          <article className="workspace-transfer-card">
            <p className="section-index">01 / EXPORT</p>
            <h3>导出全部个人数据</h3>
            <p>
              将原始文件、拆分结果、Entry
              与文档标签、联系、知识图谱、审核偏好和个人标签规则写入外部 exports
              区。导出文件始终位于代码仓库和应用包之外。
            </p>
            <button
              className="secondary-action"
              type="button"
              disabled={transferOperation !== undefined}
              onClick={() => {
                void exportWorkspace();
              }}
            >
              {transferOperation === 'export'
                ? '正在导出…'
                : '导出全部个人数据'}
            </button>
          </article>
          <form
            className="workspace-transfer-card"
            onSubmit={(event) => {
              void restoreWorkspace(event);
            }}
          >
            <p className="section-index">02 / RESTORE</p>
            <h3>恢复全部个人数据</h3>
            <p>
              只接受同一 Workspace
              ID，且数据库中尚不存在该工作区。恢复前会验证数据库内容、内嵌原始
              Blob 和个人偏好；旧版 Workspace Bundle 仍可兼容读取。
            </p>
            <label className="field">
              <span>个人数据文件名</span>
              <input
                required
                value={bundleFileName}
                onChange={(event) => {
                  setBundleFileName(event.currentTarget.value);
                }}
                placeholder="…personal-data.json"
              />
            </label>
            <button
              className="primary-action"
              type="submit"
              disabled={
                transferOperation !== undefined || bundleFileName.trim() === ''
              }
            >
              {transferOperation === 'restore' ? '正在恢复…' : '验证并恢复'}
            </button>
          </form>
        </div>
        {transferFeedback?.fileName !== undefined ? (
          <p className="bundle-file-output">
            <span>外部文件</span>
            <code>{transferFeedback.fileName}</code>
          </p>
        ) : null}
        <ActionNotice feedback={transferFeedback} />
      </section>
    </div>
  );
}

function SnapshotList({
  onOpenEvidence,
  onStartImport,
  selectedSnapshotId,
  snapshots,
  showPrivateDocuments,
}: {
  readonly onOpenEvidence: (
    snapshotId: string,
    returnFocus?: HTMLElement,
    includePrivate?: boolean,
  ) => void;
  readonly onStartImport: () => void;
  readonly selectedSnapshotId?: string | undefined;
  readonly snapshots: Loadable<readonly Readonly<EvidenceSnapshotSummary>[]>;
  readonly showPrivateDocuments: boolean;
}) {
  if (snapshots.status === 'loading') {
    return (
      <div className="loading-state" role="status" aria-busy="true">
        <span aria-hidden="true" />
        正在读取材料索引…
      </div>
    );
  }
  if (snapshots.status === 'error') {
    return (
      <div className="error-state" role="alert">
        <h3>材料列表暂不可用</h3>
        <p>{snapshots.message}</p>
      </div>
    );
  }
  if (snapshots.status === 'empty') {
    return (
      <div className="empty-state" role="status">
        <p className="section-index">NO CAPTURED MATERIAL</p>
        <h3>当前工作区还没有材料</h3>
        <p>先导入一份 Markdown，即可检查拆分、来源定位和后续审核。</p>
        <button
          className="secondary-action"
          type="button"
          onClick={onStartImport}
        >
          转到导入表单
        </button>
      </div>
    );
  }
  return (
    <ol className="record-list">
      {snapshots.value.map((snapshot, index) => (
        <li
          key={snapshot.snapshotId}
          data-active={snapshot.snapshotId === selectedSnapshotId}
        >
          <span className="record-list__index" aria-hidden="true">
            {String(index + 1).padStart(3, '0')}
          </span>
          <div className="record-list__main">
            <p className="record-list__title">{snapshot.sourceKey}</p>
            <p className="record-list__meta">
              {formatDate(snapshot.capturedAt)} · {snapshot.resourceKind}
              {snapshot.isPrivate === true ? ' · 私密' : ''}
            </p>
          </div>
          <dl className="record-list__facts">
            <div>
              <dt>Fragments</dt>
              <dd>{snapshot.fragmentCount}</dd>
            </div>
            <div>
              <dt>发布</dt>
              <dd>{snapshot.publication?.sourceText ?? '未标注'}</dd>
            </div>
          </dl>
          <button
            className="row-action"
            type="button"
            disabled={snapshot.isPrivate === true && !showPrivateDocuments}
            onClick={(event) => {
              onOpenEvidence(
                snapshot.snapshotId,
                event.currentTarget,
                snapshot.isPrivate === true,
              );
            }}
          >
            {snapshot.isPrivate === true
              ? showPrivateDocuments
                ? '查看私密全文'
                : '先勾选查看隐私'
              : '查看证据'}
          </button>
        </li>
      ))}
    </ol>
  );
}

function createImportIdentity(): ImportIdentity {
  return Object.freeze({
    commandIdempotencyKey: createCommandKey('import'),
    capturedAt: new Date().toISOString(),
    observationId: createClientUuid(),
    resourceId: createClientUuid(),
    snapshotId: createClientUuid(),
  });
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.valueOf())
    ? date.toLocaleString('zh-CN', {hour12: false})
    : value;
}
