import {useCallback, useEffect, useRef, useState} from 'react';
import type {ComponentProps, ReactNode} from 'react';

import {WorkspaceActionRail} from '../components/workspace_action_rail.js';
import {WorkspaceToolPanel} from '../components/workspace_tool_panel.js';
import {EvidenceRail} from '../components/evidence_rail.js';
import {DocumentStructureTools} from './document_structure_tools.js';
import type {InformationEntrySplitWorkspaceProps} from './information_entry_split_workspace.js';
import type {InformationEntry} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import {ReadingContent} from '../components/reading_content.js';
import {
  readingTitle,
  safeReadingLink,
  sourceDisplayName,
} from '../components/reading_text.js';
import type {ActionFeedback} from '../components/product_types.js';
import {DocumentWorkspaceList} from './document_workspace_list.js';
import {
  InformationDocumentPanel,
  InformationEntryEditor,
  type EntryEditorDraft,
} from './information_entry_tag_editor.js';
import {InformationEntryTranslation} from './information_entry_translation.js';
import type {EntryTranslationServices} from './use_entry_translation.js';
import {describeInformationEntryFailure} from './information_entry_shared.js';
import {
  useDocumentWorkspace,
  type DocumentWorkspaceApi,
  type DocumentWorkspaceSelection,
} from './use_document_workspace.js';

type EditorProps = ComponentProps<typeof InformationEntryEditor>;
type DocumentTagProps = ComponentProps<typeof InformationDocumentPanel>;
export interface DocumentWorkspaceProps {
  readonly documentTags: Pick<DocumentTagProps, 'onAggregate' | 'onRevise'>;
  readonly active: boolean;
  readonly api: DocumentWorkspaceApi;
  readonly selection: Readonly<DocumentWorkspaceSelection>;
  readonly onSelectionChange: (
    selection: Readonly<DocumentWorkspaceSelection>,
  ) => void;
  readonly onOpenEvidence: EditorProps['onOpenEvidence'];
  readonly structureServices: InformationEntrySplitWorkspaceProps;
  readonly renderLinks: (
    entry: Readonly<InformationEntry>,
    includePrivate: boolean,
  ) => ReactNode;
  readonly renderTagTools?: (
    entry: Readonly<InformationEntry>,
    onChanged: () => Promise<void>,
  ) => ReactNode;
  readonly translationServices: Readonly<EntryTranslationServices>;
  readonly review: Pick<
    EditorProps,
    | 'reviewPreferences'
    | 'overridePreferences'
    | 'onPreferencesChange'
    | 'onSavePreferences'
  >;
}

export function DocumentWorkspace({
  active,
  documentTags,
  api,
  selection,
  onSelectionChange,
  onOpenEvidence,
  structureServices,
  renderLinks,
  renderTagTools,
  translationServices,
  review,
}: DocumentWorkspaceProps) {
  const scrollPositions = useRef(new Map<string, number>());
  const returnTarget = useRef<HTMLElement | null>(null);
  const [tool, setTool] = useState<string>();
  const [openedTools, setOpenedTools] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [fragmentId, setFragmentId] = useState<string>();
  const toolScope =
    (selection.snapshotId ?? '') + ':' + String(selection.includePrivate);
  const toolKey = toolScope + ':' + (tool ?? '');
  const toolOpen = tool !== undefined && openedTools.has(toolKey);
  function openTool(value: string) {
    returnTarget.current =
      globalThis.document.activeElement instanceof HTMLElement
        ? globalThis.document.activeElement
        : null;
    setTool(value);
    setOpenedTools((current) => new Set([...current, toolScope + ':' + value]));
  }
  function closeTool() {
    setTool(undefined);
    globalThis.requestAnimationFrame(() => {
      const target = returnTarget.current;
      if (target !== null && target.getClientRects().length > 0) target.focus();
      else
        globalThis.document
          .querySelector<HTMLButtonElement>(
            '.document-tool-area .workspace-action-rail button:not(:disabled)',
          )
          ?.focus();
    });
  }
  const controller = useDocumentWorkspace({active, api, selection});
  const document = controller.selectedDocument;
  const documentId = document?.snapshotId ?? '';
  useEffect(() => {
    if (active && selection.snapshotId === undefined && documentId !== '')
      onSelectionChange({...selection, snapshotId: documentId});
  }, [active, documentId, onSelectionChange, selection]);
  const [modes, setModes] = useState<
    Readonly<Record<string, 'source' | 'entries'>>
  >({});
  const [selectedEntries, setSelectedEntries] = useState<
    Readonly<Record<string, string>>
  >({});
  const [drafts, setDrafts] = useState<
    ReadonlyMap<string, Readonly<EntryEditorDraft>>
  >(() => new Map());
  const [feedbackState, setFeedbackState] =
    useState<Readonly<{scope: string; value: ActionFeedback}>>();
  const [materializing, setMaterializing] = useState(false);
  const entries =
    controller.entries.status === 'ready' ? controller.entries.value.items : [];
  const selectedEntry =
    entries.find(({entry}) => entry.entryId === selectedEntries[documentId])
      ?.entry ?? entries[0]?.entry;
  const feedbackScope =
    documentId +
    ':' +
    String(selection.includePrivate) +
    ':' +
    (selectedEntry?.entryId ?? '');
  const feedback =
    feedbackState?.scope === feedbackScope ? feedbackState.value : undefined;
  const setFeedback = (value: ActionFeedback | undefined) => {
    setFeedbackState(
      value === undefined ? undefined : {scope: feedbackScope, value},
    );
  };
  const mode =
    modes[documentId] ?? (document?.entryCount === 1 ? 'entries' : 'source');
  const retainedDraftKey =
    selectedEntry === undefined
      ? undefined
      : [...drafts.keys()].find((key) =>
          key.startsWith(selectedEntry.entryId + ':'),
        );
  const editorKey =
    retainedDraftKey ??
    (selectedEntry === undefined
      ? ''
      : `${selectedEntry.entryId}:${selectedEntry.revision.toString()}`);
  const draftRevision =
    retainedDraftKey === undefined
      ? selectedEntry?.revision
      : Number(retainedDraftKey.split(':')[1]);
  const staleDraft =
    selectedEntry !== undefined && draftRevision !== selectedEntry.revision;
  const title =
    document === undefined
      ? '选择一份文档开始阅读'
      : controller.snapshotTitle === undefined
        ? sourceDisplayName(document)
        : readingTitle(controller.snapshotTitle);
  const rememberDraft = useCallback(
    (draft: Readonly<EntryEditorDraft> | undefined) => {
      if (editorKey === '') return;
      setDrafts((current) => {
        if (current.get(editorKey) === draft) return current;
        const next = new Map(current);
        if (draft === undefined) next.delete(editorKey);
        else next.set(editorKey, draft);
        return next;
      });
    },
    [editorKey],
  );
  const setMode = (value: 'source' | 'entries') => {
    setModes((current) => ({...current, [documentId]: value}));
  };

  async function materialize() {
    if (
      document === undefined ||
      materializing ||
      document.workingCopy !== undefined
    )
      return;
    const snapshotId = document.snapshotId;
    setMaterializing(true);
    setFeedback(undefined);
    try {
      const response = await api.materializeInformationEntries({
        snapshotId,
        chunkMode: 'split',
        includePrivate: selection.includePrivate,
      });
      if (
        response.body.status !== 'created' &&
        response.body.status !== 'existing'
      ) {
        setFeedback({
          kind: 'error',
          title: '条目没有生成',
          detail: describeInformationEntryFailure(response.body),
        });
        return;
      }
      setModes((current) => ({...current, [snapshotId]: 'entries'}));
      setFeedback({
        kind: 'success',
        title:
          response.body.status === 'created' ? '条目已生成' : '条目已经存在',
        detail: '原文保持完整，可以选择条目继续阅读和标注。',
      });
      controller.refresh(snapshotId);
    } catch {
      setFeedback({
        kind: 'error',
        title: '条目生成请求未完成',
        detail: '请刷新确认当前结果后重试，重复请求不会重复生成。',
      });
    } finally {
      setMaterializing(false);
    }
  }

  return (
    <div
      className="workspace-view document-workspace"
      data-workflow-page="documents"
      hidden={!active}
    >
      <header className="workflow-page-heading">
        <div>
          <h1>资料库</h1>
          <p>从一份文档开始，阅读与整理留在同一处。</p>
        </div>
        <div className="document-workspace__actions">
          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              controller.refresh(documentId);
            }}
            disabled={materializing}
          >
            刷新文档
          </button>
        </div>
      </header>
      <label className="privacy-query-toggle">
        <input
          type="checkbox"
          checked={selection.includePrivate}
          onChange={(event) => {
            setFeedback(undefined);
            setTool(undefined);
            onSelectionChange({includePrivate: event.currentTarget.checked});
          }}
        />
        本次查看包含隐私文档
      </label>
      <div className="document-workbench">
        <DocumentWorkspaceList
          state={controller.documents}
          selectedId={document?.snapshotId}
          onRetry={() => {
            controller.refresh(documentId);
          }}
          onSelect={(snapshotId) => {
            setFeedback(undefined);
            setTool(undefined);
            onSelectionChange({...selection, snapshotId});
          }}
        />
        <section
          className="document-paper"
          aria-label="文档工作台"
          aria-busy={controller.documents.status === 'loading'}
        >
          <header className="document-paper__identity">
            <div>
              <p className="document-paper__eyebrow">
                {document?.isPrivate === true ? '私密文档' : '来源文档'}
                {document === undefined
                  ? ''
                  : ` · ${document.entryCount.toString()} 个条目`}
              </p>
              <h2>{title}</h2>
            </div>
          </header>
          {document === undefined ? (
            <div className="document-paper__empty" role="status">
              <p>
                {controller.documents.status === 'loading'
                  ? '正在读取可见文档…'
                  : selection.snapshotId === undefined
                    ? '导入文档后，在左侧选择材料即可开始。'
                    : '所选文档不在当前可见范围，请重新选择文档或明确开启隐私范围。'}
              </p>
            </div>
          ) : (
            <>
              <div className="document-paper__toolbar">
                <div
                  className="reading-segments"
                  role="group"
                  aria-label="文档阅读范围"
                >
                  <button
                    type="button"
                    aria-pressed={mode === 'source'}
                    onClick={() => {
                      setMode('source');
                    }}
                  >
                    全文原文
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === 'entries'}
                    onClick={() => {
                      setMode('entries');
                    }}
                  >
                    条目 · {document.entryCount}
                  </button>
                </div>
              </div>
              <ActionNotice feedback={feedback} />
              <div
                className="document-paper__source"
                hidden={mode !== 'source'}
              >
                {controller.source.status === 'loading' ? (
                  <p role="status">正在打开全文…</p>
                ) : null}
                {controller.source.status === 'error' ? (
                  <div role="alert">
                    <p>{controller.source.message}</p>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => {
                        controller.refresh(documentId);
                      }}
                    >
                      重试全文
                    </button>
                  </div>
                ) : null}
                {controller.source.status === 'ready'
                  ? controller.source.value.structures.map((structure) => (
                      <ReadingContent
                        key={structure.structureId}
                        active={active && mode === 'source'}
                        scrollMemory={{
                          key: documentId + ':' + structure.structureId,
                          positions: scrollPositions,
                        }}
                        text={structure.normalizedText}
                        baseUri={document.canonicalUri}
                        omitLeadingTitle={title}
                        scrollLabel="文档全文"
                      />
                    ))
                  : null}
                {safeReadingLink(document.canonicalUri) === undefined ? null : (
                  <a
                    href={safeReadingLink(document.canonicalUri)}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    打开原网页
                  </a>
                )}
              </div>
              <div
                className="document-paper__entries"
                hidden={mode !== 'entries'}
              >
                {controller.entries.status === 'loading' ? (
                  <p role="status">正在读取文档条目…</p>
                ) : null}
                {controller.entries.status === 'error' ? (
                  <div role="alert">
                    <p>{controller.entries.message}</p>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => {
                        controller.refresh(documentId);
                      }}
                    >
                      重试条目
                    </button>
                  </div>
                ) : null}
                {controller.entries.status === 'ready' &&
                entries.length === 0 ? (
                  <div className="document-paper__empty">
                    <h3>原文已经保存</h3>
                    <p>创建条目后，可以标注和按需阅读中文译文。</p>
                    <div className="document-workspace__actions">
                      <button
                        type="button"
                        className="primary-action"
                        disabled={
                          materializing || document.workingCopy !== undefined
                        }
                        onClick={() => void materialize()}
                      >
                        {materializing ? '正在生成…' : '按现有规则生成条目'}
                      </button>
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => {
                          setMode('source');
                        }}
                      >
                        继续阅读原文
                      </button>
                    </div>
                    {document.workingCopy === undefined ? null : (
                      <p>这份文档有工作副本，请在“调整结构”中继续处理。</p>
                    )}
                  </div>
                ) : null}
                {selectedEntry === undefined ? null : (
                  <>
                    <div
                      className="document-entry-picker"
                      hidden={document.entryCount === 1}
                    >
                      <label className="field">
                        <span>当前条目</span>
                        <select
                          value={selectedEntry.entryId}
                          onChange={(event) => {
                            setTool(undefined);
                            setFeedback(undefined);
                            const value = event.currentTarget.value;
                            setSelectedEntries((current) => ({
                              ...current,
                              [documentId]: value,
                            }));
                          }}
                        >
                          {entries.map(({entry}) => (
                            <option key={entry.entryId} value={entry.entryId}>
                              {entry.value.documentOrder + 1}.{' '}
                              {readingTitle(entry.value.titlePath)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="document-workspace__actions">
                        <button
                          type="button"
                          className="secondary-action"
                          disabled={controller.pageIndex === 0}
                          onClick={() => {
                            setTool(undefined);
                            controller.previousPage();
                          }}
                        >
                          前一组
                        </button>
                        <span>第 {controller.pageIndex + 1} 组</span>
                        <button
                          type="button"
                          className="secondary-action"
                          disabled={
                            controller.entries.status !== 'ready' ||
                            controller.entries.value.nextCursor === undefined
                          }
                          onClick={() => {
                            setTool(undefined);
                            controller.nextPage();
                          }}
                        >
                          后一组
                        </button>
                      </div>
                    </div>
                    <div className="document-entry-body">
                      <div className="document-entry-reading">
                        <h3>{readingTitle(selectedEntry.value.titlePath)}</h3>
                        <InformationEntryTranslation
                          key={`${selectedEntry.entryId}:${selectedEntry.revision.toString()}:${String(selection.includePrivate)}`}
                          entry={selectedEntry}
                          services={translationServices}
                          active={active && mode === 'entries'}
                          scrollPositions={scrollPositions}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </section>
        <div className="document-tool-area">
          <WorkspaceActionRail
            page="documents"
            active={toolOpen ? tool : undefined}
            connected
            actions={[
              {
                id: 'source',
                label: '来源详情',
                disabled: document === undefined,
                onClick: () => {
                  openTool('source');
                },
              },
              {
                id: 'structure',
                label: '调整结构',
                disabled: document === undefined,
                onClick: () => {
                  openTool('structure');
                },
              },
              {
                id: 'tags',
                label: '添加标签',
                disabled: document === undefined,
                onClick: () => {
                  if (selectedEntry !== undefined) setMode('entries');
                  openTool('tags');
                },
              },
              {
                id: 'links',
                label: '建立联系',
                disabled: document === undefined,
                onClick: () => {
                  if (selectedEntry !== undefined) setMode('entries');
                  openTool('links');
                },
              },
            ]}
          >
            <p>按需整理即可，标签与联系不必逐步完成。</p>
          </WorkspaceActionRail>
          {document === undefined
            ? null
            : (['source', 'structure', 'tags', 'links'] as const).map((id) =>
                !openedTools.has(toolScope + ':' + id) ? null : (
                  <WorkspaceToolPanel
                    key={toolScope + ':' + id}
                    title={
                      {
                        source: '来源详情',
                        structure: '调整结构',
                        tags: '添加标签',
                        links: '建立联系',
                      }[id]
                    }
                    open={toolOpen && tool === id}
                    onClose={closeTool}
                  >
                    {id === 'source' ? (
                      <EvidenceRail
                        embedded
                        state={
                          controller.source.status === 'ready'
                            ? {
                                status: 'ready',
                                snapshot: controller.source.value,
                                selectedFragmentId: fragmentId,
                              }
                            : controller.source.status === 'error'
                              ? {
                                  status: 'error',
                                  snapshotId: documentId,
                                  message: controller.source.message,
                                  includePrivate: selection.includePrivate,
                                }
                              : {status: 'loading', snapshotId: documentId}
                        }
                        onClose={closeTool}
                        onRetry={() => {
                          controller.refresh(documentId);
                        }}
                        onSelectFragment={setFragmentId}
                      />
                    ) : null}
                    {id === 'structure' ? (
                      <DocumentStructureTools
                        document={document}
                        includePrivate={selection.includePrivate}
                        services={structureServices}
                        onChanged={(snapshotId) => {
                          controller.refresh(snapshotId);
                          if (snapshotId !== documentId)
                            onSelectionChange({...selection, snapshotId});
                          return Promise.resolve();
                        }}
                      />
                    ) : null}
                    {id === 'tags' ? (
                      <details className="workflow-tool-drawer">
                        <summary>整篇文档标签</summary>
                        <InformationDocumentPanel
                          key={
                            documentId +
                            ':' +
                            (document.currentTags?.revision.toString() ?? '0')
                          }
                          document={document}
                          includePrivate={selection.includePrivate}
                          {...documentTags}
                          onOpenDocument={() => {
                            setMode('source');
                          }}
                          onChanged={(value) => {
                            setFeedback(value);
                            controller.refresh(documentId);
                            return Promise.resolve();
                          }}
                        />
                      </details>
                    ) : null}
                    {id === 'tags' && selectedEntry !== undefined ? (
                      <>
                        {' '}
                        <div
                          className="document-annotation-drawer"
                          role="region"
                          aria-label="条目标注"
                        >
                          {staleDraft ? (
                            <div className="document-draft-note" role="status">
                              <p>
                                条目已被更新。当前草稿仍基于旧版本，保存会进行版本检查。请先核对正文。
                              </p>
                              <button
                                type="button"
                                className="secondary-action"
                                onClick={() => {
                                  setDrafts((current) => {
                                    const next = new Map(current);
                                    next.delete(editorKey);
                                    return next;
                                  });
                                }}
                              >
                                放弃旧草稿，读取最新条目
                              </button>
                            </div>
                          ) : (
                            <p className="document-draft-note">
                              {drafts.has(editorKey)
                                ? '有未保存标注 · 本次页面内切换会保留，刷新浏览器将丢失。'
                                : '保存后留在当前条目。'}
                            </p>
                          )}
                          <InformationEntryEditor
                            key={editorKey}
                            entry={
                              draftRevision === selectedEntry.revision
                                ? selectedEntry
                                : {
                                    ...selectedEntry,
                                    revision:
                                      draftRevision ?? selectedEntry.revision,
                                  }
                            }
                            includePrivate={selection.includePrivate}
                            onOpenEvidence={onOpenEvidence}
                            onLocateDocument={() => {
                              setMode('source');
                            }}
                            onRevise={controller.updateEntry}
                            onSaved={(value) => {
                              setFeedback(value);
                              closeTool();
                              setDrafts((current) => {
                                const next = new Map(current);
                                next.delete(editorKey);
                                return next;
                              });
                              return Promise.resolve();
                            }}
                            {...review}
                            initialDraft={drafts.get(editorKey)}
                            onDraftChange={rememberDraft}
                            presentation="workbench"
                          />
                        </div>
                        {renderTagTools?.(selectedEntry, () => {
                          controller.refresh(documentId);
                          return Promise.resolve();
                        })}
                      </>
                    ) : null}
                    {id === 'links' && selectedEntry !== undefined
                      ? renderLinks(selectedEntry, selection.includePrivate)
                      : null}
                    {(id === 'tags' || id === 'links') &&
                    selectedEntry === undefined ? (
                      <div className="document-paper__empty">
                        <p>
                          这份文档还没有条目。先在结构工具中生成条目，再添加标签或联系。
                        </p>
                        <button
                          className="secondary-action"
                          type="button"
                          onClick={() => {
                            openTool('structure');
                          }}
                        >
                          打开结构工具
                        </button>
                      </div>
                    ) : null}
                  </WorkspaceToolPanel>
                ),
              )}
        </div>
      </div>
    </div>
  );
}
