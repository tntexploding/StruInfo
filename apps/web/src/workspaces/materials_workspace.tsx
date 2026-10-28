import type {InboxReviewTarget} from './inbox_review_state.js';
import {WorkspaceToolPanel} from '../components/workspace_tool_panel.js';
import type {ReactNode} from 'react';
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
  readonly onOpenDocument?:
    ((snapshotId: string, includePrivate: boolean) => void) | undefined;
  readonly presentation?: 'maintenance' | 'capture';
  readonly reviewTarget?: InboxReviewTarget | undefined;
  readonly activity?: ReactNode;
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
  presentation = 'capture',
  onImport,
  onImportBatchItem,
  onImportBatchCompleted,
  onExport,
  onRestore,
  onRefresh,
}: MaterialsWorkspaceProps) {
  const maintenance = presentation === 'maintenance';
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
        detail: '无法读取或处理这个文件；没有保存任何内容。',
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
    <div
      className={`workspace-view materials-workspace${maintenance ? ' materials-maintenance' : ' capture-only'}`}
    >
      {!maintenance ? (
        <div className="inbox-import-tool">
          <WorkspaceToolPanel title="手动导入" open onClose={() => undefined}>
            <section className="intake-console" aria-labelledby="import-title">
              <header className="console-heading">
                <div>
                  <h2 id="import-title">导入来源</h2>
                </div>
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
                          .md / .markdown / .txt / .html / .htm / .pdf · 最大 1
                          MiB
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
                        <div
                          className="local-file-import__status"
                          aria-live="polite"
                        >
                          {localFile.status === 'idle' ? (
                            <p>请选择要导入的文件。</p>
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
                      原始文件和可处理正文都会完整保存在个人数据目录；拆出的条目和联系会自动保持隐私。
                    </small>
                  </span>
                </label>
                {sourceMode === 'git_file' ? (
                  <fieldset className="git-source-fields field--full">
                    <legend>Git 文件信息</legend>
                    <label className="field field--wide">
                      <span>仓库地址</span>
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
                      <span>分支或标签</span>
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
                      <span>提交版本号</span>
                      <input
                        required
                        minLength={40}
                        maxLength={64}
                        pattern="(?:[0-9a-f]{40}|[0-9a-f]{64})"
                        value={commitDigest}
                        onChange={(event) => {
                          setCommitDigest(event.currentTarget.value);
                        }}
                        placeholder="40 或 64 位小写字母和数字"
                      />
                    </label>
                  </fieldset>
                ) : null}
                <details className="workflow-tool-drawer field--full import-optional-settings">
                  <summary>来源信息与导入选项</summary>
                  <div className="import-optional-settings__body">
                    {sourceMode !== 'uploaded_file' ||
                    localCaptureMode === 'single' ? (
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
                              ? '留空时按文件名和内容自动生成'
                              : '留空时自动生成'
                          }
                        />
                      </label>
                    ) : (
                      <div className="field field--wide batch-identity-note">
                        <span>每个文件单独命名</span>
                        <p>系统会按文件名和内容分别识别每份文件。</p>
                      </div>
                    )}
                    {sourceMode !== 'uploaded_file' ||
                    localCaptureMode === 'single' ? (
                      <label className="field field--wide">
                        <span>来源链接（可选）</span>
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
                        <option value="commonmark-v1">通用 Markdown</option>
                        <option value="ruanyf-weekly-v1">科技爱好者周刊</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>发布日期（可选）</span>
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
                        placeholder="需要时补充标题、导语或上下文；导入后会放在正文开头。"
                      />
                      {sourceMode === 'uploaded_file' ? (
                        <small>
                          HTML/PDF 会保留原始文件；前置文字只加入可拆分的正文。
                          Markdown/TXT 会把前置文字与文件内容合并为一份新文档。
                        </small>
                      ) : null}
                    </label>
                  </div>
                </details>
                {sourceMode !== 'uploaded_file' ||
                localCaptureMode === 'single' ? (
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
                        sourceMode === 'uploaded_file' &&
                        localFile.status === 'ready'
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
                            ? 'PDF 文字层将在本地服务导入时按页提取；导入后可在文档阅读中调整分段。扫描件暂不支持 OCR。'
                            : '选择文件后在这里检查正文；编辑请使用前置文字或后续拆分流程。'
                          : '粘贴或输入 Markdown 正文。'
                      }
                    />
                  </label>
                ) : null}
                {sourceMode !== 'uploaded_file' ||
                localCaptureMode === 'single' ? (
                  <div className="form-commit field--full">
                    <p>
                      导入会保存原始文件并生成可供拆分的正文；失败后可以重试。
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
                            !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(
                              commitDigest,
                            )))
                      }
                    >
                      {submitting ? '正在导入…' : '导入文档'}
                    </button>
                  </div>
                ) : (
                  <p className="batch-import-boundary field--full">
                    选择多个文件后，在文件列表中统一开始导入。每个文件会单独保存；拆分、标签和联系需要另行处理。
                  </p>
                )}
              </form>
              <ActionNotice feedback={feedback} />
            </section>
          </WorkspaceToolPanel>
        </div>
      ) : (
        <section
          className="workspace-transfer-section settings-group"
          aria-labelledby="workspace-transfer-title"
        >
          <h2 id="workspace-transfer-title">完整备份</h2>
          <div className="workspace-transfer-grid">
            <article className="workspace-transfer-card">
              <h3>导出全部个人数据</h3>
              <p>
                备份原始文件、分段、条目、标签、联系和个人设置。浏览器中的光效和字号需单独设置。
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
              <h3>恢复全部个人数据</h3>
              <p>
                仅支持恢复到同一工作区的空数据库。点击后先检查备份文件，再恢复数据。
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
                  transferOperation !== undefined ||
                  bundleFileName.trim() === ''
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
      )}
    </div>
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
