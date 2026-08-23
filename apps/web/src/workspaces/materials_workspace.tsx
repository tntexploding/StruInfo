import {useRef, useState} from 'react';
import type {SyntheticEvent} from 'react';

import type {EvidenceSnapshotSummary} from '../api/m1c_api_contract.js';
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

interface ImportIdentity {
  readonly commandIdempotencyKey: string;
  readonly observationId: string;
  readonly resourceId: string;
  readonly snapshotId: string;
}

type SourceMode = 'manual_text' | 'git_file';

export interface MaterialsWorkspaceProps {
  readonly onImport: (body: unknown) => Promise<ActionFeedback>;
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
}

export function MaterialsWorkspace({
  onImport,
  onOpenEvidence,
  onRefresh,
  onExport,
  onRestore,
  selectedSnapshotId,
  snapshots,
}: MaterialsWorkspaceProps) {
  const importHeading = useRef<HTMLHeadingElement>(null);
  const [identity, setIdentity] =
    useState<ImportIdentity>(createImportIdentity);
  const [sourceMode, setSourceMode] = useState<SourceMode>('manual_text');
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

  async function submitImport(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFeedback(undefined);
    const capturedAt = new Date().toISOString();
    const gitSource = sourceMode === 'git_file';
    const resolvedSourceKey =
      sourceKey.trim() || `import-${identity.snapshotId.slice(0, 8)}`;
    const importedText =
      sourcePreface.trim() === ''
        ? sourceText
        : `${sourcePreface.trim()}\n\n${sourceText}`;
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
        mediaType: 'text/markdown',
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
      profile,
      sourceText: importedText,
      ...(canonicalUri.trim() === ''
        ? {}
        : {documentBaseUri: canonicalUri.trim()}),
    };
    try {
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
      }
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
                onChange={() => {
                  setSourceMode('git_file');
                }}
              />
              固定 Git 文件
            </label>
          </fieldset>
          <label className="privacy-choice field--full">
            <input
              type="checkbox"
              checked={isPrivate}
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
          <label className="field field--wide">
            <span>来源别名（可选）</span>
            <input
              maxLength={500}
              value={sourceKey}
              onChange={(event) => {
                setSourceKey(event.currentTarget.value);
              }}
              placeholder="留空时按本次导入身份自动生成"
            />
          </label>
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
          <label className="field">
            <span>文档格式与解析规则</span>
            <select
              value={profile}
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
              onChange={(event) => {
                setSourcePreface(event.currentTarget.value);
              }}
              placeholder="需要时补充标题、导语或上下文；保存后将成为本次 Snapshot 正文的一部分。"
            />
          </label>
          <label className="field field--full">
            <span>Markdown 正文</span>
            <textarea
              required
              rows={12}
              value={sourceText}
              onChange={(event) => {
                setSourceText(event.currentTarget.value);
              }}
              placeholder="粘贴或输入待保存的 Markdown；内容不会写入 Git 或前端包体。"
            />
          </label>
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
                sourceText === '' ||
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
              与文档标签、联系、正式知识、审核偏好和个人标签规则写入外部 exports
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
