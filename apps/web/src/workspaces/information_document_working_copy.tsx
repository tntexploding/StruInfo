import {useEffect, useMemo, useRef, useState} from 'react';

import type {
  InformationDocumentWorkingCopyCommitResponse,
  InformationDocumentWorkingCopyResponse,
  InformationDocumentWorkingCopyView,
  M1cHttpResponse,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import type {ActionFeedback} from '../components/product_types.js';

export interface InformationDocumentWorkingCopyProps {
  readonly snapshotId: string;
  readonly isPrivate: boolean;
  readonly includePrivate: boolean;
  readonly alreadyMaterialized: boolean;
  readonly onLoad: (
    snapshotId: string,
    includePrivate: boolean,
  ) => Promise<M1cHttpResponse<InformationDocumentWorkingCopyResponse>>;
  readonly onSave: (
    snapshotId: string,
    body: Readonly<{
      expectedRevision: number;
      includePrivate: boolean;
      text: string;
    }>,
  ) => Promise<M1cHttpResponse<InformationDocumentWorkingCopyResponse>>;
  readonly onRestore: (
    snapshotId: string,
    body: Readonly<{expectedRevision: number; includePrivate: boolean}>,
  ) => Promise<M1cHttpResponse<InformationDocumentWorkingCopyResponse>>;
  readonly onCommit: (
    snapshotId: string,
    body: Readonly<{expectedRevision: number; includePrivate: boolean}>,
  ) => Promise<M1cHttpResponse<InformationDocumentWorkingCopyCommitResponse>>;
  readonly onCommitted: (derivedSnapshotId: string) => Promise<void>;
}

type ViewState =
  | Readonly<{status: 'idle' | 'loading'}>
  | Readonly<{
      status: 'ready';
      value: Readonly<InformationDocumentWorkingCopyView>;
    }>
  | Readonly<{status: 'error'; message: string}>;

export function InformationDocumentWorkingCopy({
  snapshotId,
  isPrivate,
  includePrivate,
  alreadyMaterialized,
  onLoad,
  onSave,
  onRestore,
  onCommit,
  onCommitted,
}: InformationDocumentWorkingCopyProps) {
  const mounted = useRef(true);
  const requestGeneration = useRef(0);
  const [view, setView] = useState<ViewState>({status: 'idle'});
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback>();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    globalThis.queueMicrotask(() => {
      if (requestGeneration.current !== generation) return;
      setFeedback(undefined);
      setBusy(false);
      if (
        snapshotId === '' ||
        alreadyMaterialized ||
        (isPrivate && !includePrivate)
      ) {
        setView({status: 'idle'});
        setText('');
        return;
      }
      setView({status: 'loading'});
      void onLoad(snapshotId, includePrivate)
        .then((response) => {
          if (requestGeneration.current !== generation) return;
          if (!('workingCopy' in response.body)) {
            setView({
              status: 'error',
              message: describeWorkingCopyFailure(response.body),
            });
            return;
          }
          setView({status: 'ready', value: response.body.workingCopy});
          setText(response.body.workingCopy.currentText);
        })
        .catch(() => {
          if (requestGeneration.current !== generation) return;
          setView({
            status: 'error',
            message: '本地接口不可达；原始文档没有发生变化。',
          });
        });
    });
    return () => {
      if (requestGeneration.current === generation) {
        requestGeneration.current += 1;
      }
    };
  }, [alreadyMaterialized, includePrivate, isPrivate, onLoad, snapshotId]);

  const byteLength = useMemo(
    () => new TextEncoder().encode(text).byteLength,
    [text],
  );
  const dirty = view.status === 'ready' && text !== view.value.currentText;
  const canSave =
    view.status === 'ready' &&
    view.value.state !== 'committed' &&
    dirty &&
    text.length > 0 &&
    byteLength <= 1_048_576 &&
    !busy;
  const canCommit =
    view.status === 'ready' &&
    view.value.state === 'editing' &&
    view.value.changed &&
    !dirty &&
    !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const response = await onSave(snapshotId, {
        expectedRevision: view.value.revision,
        includePrivate,
        text,
      });
      if (!mounted.current) return;
      if (!('workingCopy' in response.body)) {
        setFeedback({
          kind: 'error',
          title: '全文修改没有保存',
          detail: describeWorkingCopyFailure(response.body),
        });
        return;
      }
      setView({status: 'ready', value: response.body.workingCopy});
      setText(response.body.workingCopy.currentText);
      setFeedback({
        kind: 'success',
        title:
          response.body.workingCopy.state === 'original'
            ? '已恢复原始全文'
            : '当前全文修改已保存',
        detail:
          response.body.workingCopy.state === 'original'
            ? '草稿已删除，原始 Snapshot 与 Fragment 从未被改写。'
            : '这里只保留一份当前草稿；尚未生成新的可拆分文档。',
      });
    } catch {
      if (!mounted.current) return;
      setFeedback({
        kind: 'error',
        title: '全文修改没有保存',
        detail: '本地接口不可达；原始文档与当前草稿均未被覆盖。',
      });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function restore() {
    if (view.status !== 'ready' || view.value.state !== 'editing' || busy) {
      return;
    }
    setBusy(true);
    setFeedback(undefined);
    try {
      const response = await onRestore(snapshotId, {
        expectedRevision: view.value.revision,
        includePrivate,
      });
      if (!mounted.current) return;
      if (!('workingCopy' in response.body)) {
        setFeedback({
          kind: 'error',
          title: '没有恢复原文',
          detail: describeWorkingCopyFailure(response.body),
        });
        return;
      }
      setView({status: 'ready', value: response.body.workingCopy});
      setText(response.body.workingCopy.currentText);
      setFeedback({
        kind: 'success',
        title: '已恢复原始全文',
        detail: '工作草稿已删除，原始 Evidence 保持不变。',
      });
    } catch {
      if (!mounted.current) return;
      setFeedback({
        kind: 'error',
        title: '没有恢复原文',
        detail: '本地接口不可达；没有删除或覆盖任何内容。',
      });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function commit() {
    if (!canCommit) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const response = await onCommit(snapshotId, {
        expectedRevision: view.value.revision,
        includePrivate,
      });
      if (!mounted.current) return;
      if (
        response.body.status !== 'committed' &&
        response.body.status !== 'existing'
      ) {
        setFeedback({
          kind: 'error',
          title: '派生文档没有生成',
          detail: describeWorkingCopyFailure(response.body),
        });
        return;
      }
      setFeedback({
        kind: 'success',
        title: '已生成可拆分的派生文档',
        detail: '正在切换到新 Snapshot；原始版本仍可独立查看和导出。',
      });
      await onCommitted(response.body.derivedSnapshotId);
    } catch {
      if (!mounted.current) return;
      setFeedback({
        kind: 'error',
        title: '派生文档没有生成',
        detail: '本地接口不可达；尚未进入拆分阶段。',
      });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  if (snapshotId === '') return null;

  return (
    <section
      className="information-document-working-copy"
      aria-labelledby="document-working-copy-title"
    >
      <header className="console-heading">
        <div>
          <p className="section-index">SOURCE / EDIT BEFORE SPLIT</p>
          <h2 id="document-working-copy-title">拆分前全文修改</h2>
        </div>
        <span className="origin-label origin-label--manual">本地人工操作</span>
      </header>

      <p className="information-document-working-copy__boundary">
        原始 Snapshot 与 Fragment
        永不改写。这里只保存一份当前草稿；确认后生成新的派生文档，再进入拆分。
      </p>

      {alreadyMaterialized ? (
        <p className="information-document-working-copy__state">
          当前文档已经形成 Entry；如需改变既有结构，请使用下方“重整现有条目”。
        </p>
      ) : isPrivate && !includePrivate ? (
        <p className="information-document-working-copy__state">
          勾选“查看并处理隐私文档”后，才能在本地加载和修改全文。
        </p>
      ) : view.status === 'loading' ? (
        <p className="information-document-working-copy__state">
          正在加载全文…
        </p>
      ) : view.status === 'error' ? (
        <p className="information-document-working-copy__state">
          {view.message}
        </p>
      ) : view.status === 'ready' ? (
        <>
          <div className="information-document-working-copy__meta">
            <span>
              {view.value.state === 'original'
                ? '原始版本'
                : view.value.state === 'editing'
                  ? `当前草稿 · 修订 ${view.value.revision.toString()}`
                  : '已确认派生版本'}
            </span>
            <span>{Array.from(text).length.toLocaleString('zh-CN')} 字符</span>
            <span>{byteLength.toLocaleString('zh-CN')} / 1,048,576 bytes</span>
          </div>
          <label className="information-document-working-copy__editor">
            <span>当前全文</span>
            <textarea
              value={text}
              readOnly={view.value.state === 'committed'}
              spellCheck={false}
              onChange={(event) => {
                setText(event.currentTarget.value);
                setFeedback(undefined);
              }}
            />
          </label>
          <details className="information-document-working-copy__original">
            <summary>对照原始全文（只读）</summary>
            <pre>{view.value.originalText}</pre>
          </details>
          <div className="information-document-working-copy__actions">
            <span>
              {dirty
                ? '当前输入尚未保存。'
                : view.value.state === 'editing'
                  ? '草稿已保存；确认后才会生成派生 Snapshot。'
                  : view.value.state === 'committed'
                    ? '该草稿已经确认，后续修改请在派生文档上进行。'
                    : '没有保存中的修改。'}
            </span>
            <div>
              <button
                className="secondary-action"
                type="button"
                disabled={view.value.state !== 'editing' || busy}
                onClick={() => void restore()}
              >
                恢复原始全文
              </button>
              <button
                className="secondary-action"
                type="button"
                disabled={!canSave}
                onClick={() => void save()}
              >
                {busy ? '处理中…' : '保存当前修改'}
              </button>
              <button
                className="primary-action"
                type="button"
                disabled={!canCommit}
                onClick={() => void commit()}
              >
                确认并生成派生文档
              </button>
            </div>
          </div>
        </>
      ) : null}
      <ActionNotice feedback={feedback} />
    </section>
  );
}

function describeWorkingCopyFailure(value: unknown): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    'issue' in value &&
    typeof value.issue === 'object' &&
    value.issue !== null &&
    'code' in value.issue &&
    typeof value.issue.code === 'string'
  ) {
    switch (value.issue.code) {
      case 'stale_information_document_working_copy':
        return '草稿已经在其他操作中更新，请重新选择文档后再试。';
      case 'split_structure_already_materialized':
        return '该文档已经形成 Entry，不能再改写拆分前全文。';
      case 'information_document_working_copy_committed':
        return '这份草稿已经确认，请切换到派生文档继续。';
      case 'private_content_requires_opt_in':
        return '本次请求没有明确允许读取隐私文档。';
      default:
        break;
    }
  }
  return '请求没有完成；原始文档与已有 Entry 均未被覆盖。';
}
