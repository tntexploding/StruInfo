import {ContentDialog} from '../components/content_dialog.js';
import {aiWorkflowCommand} from '../api/ai_workflow_client.js';
import {EntryAnnotationPanel} from './entry_annotation_panel.js';
import {DocumentPublicationButton} from './document_publication_button.js';
import {SourceSplitRecipePanel} from './source_split_recipe_panel.js';
import {InformationDocumentWorkingCopy} from './information_document_working_copy.js';
import {DocumentAiActions} from './document_ai_actions.js';
import {ReadingWorkspaceFrame} from '../components/reading_workspace_frame.js';
import {AnnotationSummary} from './annotation_summary.js';
import {ContentTopicsPanel} from './content_topics_panel.js';
import {FloatingToolPanel} from '../components/floating_tool_panel.js';
import {InlineStructureEditor} from './inline_structure_editor.js';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {ComponentProps, ReactNode} from 'react';

import {WorkspaceToolPanel} from '../components/workspace_tool_panel.js';
import {EvidenceRail} from '../components/evidence_rail.js';
import type {ManualSplitDraftGroup} from './information_entry_manual_split_model.js';
import type {DocumentStructureServices} from './document_structure_services.js';
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
  DocumentProcessingStrip,
  DocumentProcessingDetails,
} from './document_processing.js';
import {
  processingForDocument,
  type ProcessingStageId,
} from './document_processing_state.js';
import {useDocumentProcessing} from './use_document_processing.js';
import {DocumentAnnotations} from './document_annotations.js';
import {DocumentEntryTags} from './document_tag_overview.js';
import {DocumentTitle} from './document_title.js';
import {documentSourceBoundaries} from './document_source_boundaries.js';
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
  readonly structureServices: DocumentStructureServices;
  readonly renderLinks: (
    entry: Readonly<InformationEntry>,
    includePrivate: boolean,
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
  translationServices,
  review,
}: DocumentWorkspaceProps) {
  const scrollPositions = useRef(new Map<string, number>());
  const returnTarget = useRef<HTMLElement | null>(null);
  const [tool, setTool] = useState<string>();
  const [annotationTarget, setAnnotationTarget] = useState<{
    scope: string;
    entryId: string;
  }>();
  const [editingStructure, setEditingStructure] = useState(false);
  const [editing, setEditing] = useState(false);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [structureDrafts, setStructureDrafts] = useState<
    ReadonlyMap<string, readonly ManualSplitDraftGroup[]>
  >(new Map());
  const [processingStage, setProcessingStage] = useState<ProcessingStageId>();
  const [openedTools, setOpenedTools] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [fragmentId, setFragmentId] = useState<string>();
  const toolScope =
    (selection.snapshotId ?? '') + ':' + String(selection.includePrivate);
  const toolKey = toolScope + ':' + (tool ?? '');
  const toolOpen = tool !== undefined && openedTools.has(toolKey);
  const openTool = useCallback(
    (value: string) => {
      returnTarget.current =
        globalThis.document.activeElement instanceof HTMLElement
          ? globalThis.document.activeElement
          : null;
      setTool(value);
      setOpenedTools(
        (current) => new Set([...current, toolScope + ':' + value]),
      );
    },
    [toolScope],
  );
  const closeTool = useCallback(() => {
    setTool(undefined);
    globalThis.requestAnimationFrame(() => {
      const target = returnTarget.current;
      if (target !== null && target.getClientRects().length > 0) target.focus();
      else
        globalThis.document
          .querySelector<HTMLButtonElement>(
            '.document-tool-area .journey-floating-bar button:not(:disabled)',
          )
          ?.focus();
    });
  }, []);
  const controller = useDocumentWorkspace({active, api, selection});
  const document = controller.selectedDocument;
  const documentId = document?.snapshotId ?? '';
  const processing = useDocumentProcessing(
    active && document !== undefined && !document.isPrivate,
    document?.isPrivate ? '' : documentId,
    controller.refresh,
  );
  const processingValue =
    processing.view && document && !document.isPrivate
      ? processingForDocument(
          documentId,
          processing.view.tasks,
          processing.view.records,
        )
      : undefined;
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
  const allEntries = useMemo(
    () =>
      controller.allEntries.status === 'ready'
        ? controller.allEntries.value.items.map((item) => item.entry)
        : [],
    [controller.allEntries],
  );
  const selectedEntry =
    entries.find(({entry}) => entry.entryId === selectedEntries[documentId])
      ?.entry ?? entries[0]?.entry;
  const {locateEntry} = controller;
  useEffect(() => {
    const id = selectedEntries[documentId];
    if (id) locateEntry(id);
  }, [documentId, selectedEntries, locateEntry]);
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
  const mode = modes[documentId] ?? 'source';
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
  const setMode = useCallback(
    (value: 'source' | 'entries') => {
      setModes((current) => ({...current, [documentId]: value}));
    },
    [documentId],
  );

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
        detail: '请刷新查看结果。若未完成，可重试。',
      });
    } finally {
      setMaterializing(false);
    }
  }

  const documentAnnotations = document ? (
    <>
      <DocumentAnnotations
        document={document}
        entries={allEntries}
        focusedEntry={mode === 'entries' ? selectedEntry : undefined}
        onSelectEntry={(entryId) => {
          controller.locateEntry(entryId);
          setSelectedEntries((current) => ({
            ...current,
            [documentId]: entryId,
          }));
          setMode('entries');
          setTool(undefined);
        }}
        loading={controller.allEntries.status === 'loading'}
        error={
          controller.allEntries.status === 'error'
            ? controller.allEntries.message
            : undefined
        }
        active={active}
        includePrivate={selection.includePrivate}
        api={api}
        onOpenDocument={(snapshotId, entryId) => {
          setTool(undefined);
          setSelectedEntries((current) => ({
            ...current,
            [snapshotId]: entryId,
          }));
          setModes((current) => ({...current, [snapshotId]: 'entries'}));
          onSelectionChange({...selection, snapshotId});
        }}
        onEditTags={() => {
          openTool('tags');
        }}
      />
      <ActionNotice feedback={feedback} />
    </>
  ) : null;
  const documentIdentity = (
    <header className="document-paper__identity">
      <div>
        <p className="document-paper__eyebrow">
          {document?.isPrivate === true ? '私密文档' : '来源文档'}
          {document === undefined
            ? ''
            : ` · ${document.entryCount.toString()} 个条目`}
        </p>
        <DocumentTitle
          key={documentId + String(selection.includePrivate) + title}
          title={title}
        />
      </div>
      {document && !document.isPrivate ? (
        <DocumentProcessingStrip
          value={processingValue}
          error={processing.error}
          onRefresh={() => {
            void processing.refresh();
          }}
          onOpen={(stage) => {
            setProcessingStage(stage);
            openTool('processing');
          }}
        />
      ) : null}
    </header>
  );
  return (
    <div
      className="workspace-view document-workspace reading-sample reader-study mode-margin"
      data-workflow-page="documents"
      hidden={!active}
    >
      <header className="workflow-page-heading">
        <div>
          <h1>文档阅读</h1>
          <p>阅读原文，查看分段、标签和联系。修改后确认保存。</p>
        </div>
      </header>
      <ReadingWorkspaceFrame
        readingKey={documentId + ':' + mode}
        selectedId={documentId}
        title={document ? sourceDisplayName(document) : ''}
        onRefresh={() => {
          controller.refresh(documentId);
          void processing.refresh();
        }}
        stateControl={
          selectedEntry ? (
            <button
              type="button"
              className="read-state-label text-action"
              onClick={() => {
                setAnnotationTarget({
                  scope: toolScope,
                  entryId: selectedEntry.entryId,
                });
                openTool('annotations');
              }}
            >
              {
                (
                  {
                    unread: '未读',
                    reading: '在读',
                    read: '已读',
                    archived: '已归档',
                  } as const
                )[selectedEntry.value.annotations?.readingState ?? 'unread']
              }
            </button>
          ) : null
        }
        editing={editing}
        onEdit={() => {
          setEditing((value) => !value);
          setTool(undefined);
          setEditingStructure(false);
        }}
        notes={
          <>
            <div className="annotation-title">
              <h2>旁注</h2>
              <small>{allEntries.length} 段原文</small>
            </div>
            <section className="info-block reading-outline">
              <h3>分段 · {allEntries.length}</h3>
              {allEntries.length ? (
                <ol>
                  {allEntries.map((entry) => (
                    <li key={entry.entryId}>
                      <button
                        type="button"
                        aria-pressed={
                          mode === 'entries' &&
                          selectedEntry?.entryId === entry.entryId
                        }
                        onClick={() => {
                          controller.locateEntry(entry.entryId);
                          setSelectedEntries((current) => ({
                            ...current,
                            [documentId]: entry.entryId,
                          }));
                          setMode('entries');
                        }}
                      >
                        {readingTitle(entry.value.titlePath)}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>尚未拆分</p>
              )}
            </section>
            {documentAnnotations}
            {selectedEntry ? <AnnotationSummary entry={selectedEntry} /> : null}
            <FloatingToolPanel
              title="主题与联系"
              preferredWidth={720}
              onOpenChange={setTopicsOpen}
            >
              <ContentTopicsPanel
                active={active && topicsOpen}
                {...(selectedEntry ? {entry: selectedEntry} : {})}
                onRead={(id) => {
                  void aiWorkflowCommand<{entry: InformationEntry}>(
                    'entry_annotations_read',
                    {entryId: id, includePrivate: selection.includePrivate},
                  )
                    .then(({entry}) => {
                      onSelectionChange({
                        ...selection,
                        snapshotId: entry.snapshotId,
                      });
                      setSelectedEntries((current) => ({
                        ...current,
                        [entry.snapshotId]: id,
                      }));
                      setModes((current) => ({
                        ...current,
                        [entry.snapshotId]: 'entries',
                      }));
                    })
                    .catch(() => {
                      setFeedback({
                        kind: 'error',
                        title: '无法打开条目',
                        detail: '请重试。',
                      });
                    });
                }}
              />
            </FloatingToolPanel>
          </>
        }
        left={
          <>
            <label className="privacy-query-toggle">
              <input
                type="checkbox"
                checked={selection.includePrivate}
                onChange={(event) => {
                  setFeedback(undefined);
                  setTool(undefined);
                  onSelectionChange({
                    includePrivate: event.currentTarget.checked,
                  });
                }}
              />
              本次查看包含隐私文档
            </label>
            <DocumentWorkspaceList
              state={controller.documents}
              processing={processing.listView}
              renderProcessing={(item) => {
                if (!processing.listView || item.isPrivate) return null;
                const value = processingForDocument(
                  item.snapshotId,
                  processing.listView.tasks,
                  processing.listView.records,
                );
                return value.task || value.intake ? (
                  <span
                    className="document-library-item__processing"
                    data-tone={value.tone}
                  >
                    {value.historical ? '历史正文' : value.label}
                  </span>
                ) : null;
              }}
              selectedId={document?.snapshotId}
              onRetry={() => {
                controller.refresh(documentId);
              }}
              onSelect={(snapshotId) => {
                setFeedback(undefined);
                setTool(undefined);
                setEditingStructure(false);
                onSelectionChange({...selection, snapshotId});
              }}
            />
          </>
        }
      >
        {editingStructure &&
        document &&
        controller.source.status === 'ready' ? (
          <InlineStructureEditor
            key={documentId}
            document={document}
            snapshot={controller.source.value}
            includePrivate={selection.includePrivate}
            services={structureServices}
            initialDraft={structureDrafts.get(documentId)}
            onDraftChange={(groups) => {
              setStructureDrafts((previous) =>
                new Map(previous).set(documentId, groups),
              );
            }}
            onClose={() => {
              setStructureDrafts((previous) => {
                const next = new Map(previous);
                next.delete(documentId);
                return next;
              });
              setEditingStructure(false);
            }}
            onConfirmed={() => {
              setStructureDrafts((previous) => {
                const next = new Map(previous);
                next.delete(documentId);
                return next;
              });
              setEditingStructure(false);
              controller.refresh(documentId);
            }}
          />
        ) : (
          <section
            className="document-paper"
            aria-label="文档工作台"
            aria-busy={controller.documents.status === 'loading'}
          >
            {document === undefined ? (
              <div className="document-paper__empty" role="status">
                <p>
                  {controller.documents.status === 'loading'
                    ? '正在读取可见文档…'
                    : selection.snapshotId === undefined
                      ? '点击“选择文档”开始阅读。'
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
                      按条目 · {document.entryCount}
                    </button>
                  </div>
                  <span className="document-view-hint">
                    {mode === 'source'
                      ? '连续阅读 · 保留原文结构'
                      : document.entryCount === 1
                        ? '整篇保留 · 可标注与翻译'
                        : '独立条目 · 可逐条标注与翻译'}
                  </span>
                </div>
                {(
                  mode === 'source'
                    ? controller.source.status !== 'ready' ||
                      controller.source.value.structures.length === 0
                    : selectedEntry === undefined
                ) ? (
                  <>{documentIdentity}</>
                ) : null}
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
                    ? controller.source.value.structures.map(
                        (structure, index) => (
                          <ReadingContent
                            key={structure.structureId}
                            leadingContent={
                              mode === 'source' && index === 0 ? (
                                <>{documentIdentity}</>
                              ) : undefined
                            }
                            active={active && mode === 'source'}
                            scrollMemory={{
                              key: documentId + ':' + structure.structureId,
                              positions: scrollPositions,
                            }}
                            text={structure.normalizedText}
                            boundaries={documentSourceBoundaries(
                              structure,
                              allEntries,
                              (entry) =>
                                entry.value.contentKeywords.length ? (
                                  <DocumentEntryTags entry={entry} />
                                ) : null,
                            )}
                            baseUri={document.canonicalUri}
                            omitLeadingTitle={title}
                            scrollLabel="文档全文"
                          />
                        ),
                      )
                    : null}
                  {safeReadingLink(document.canonicalUri) ===
                  undefined ? null : (
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
                            disabled={!controller.hasNextPage}
                            onClick={() => {
                              setTool(undefined);
                              controller.nextPage();
                            }}
                          >
                            后一组
                          </button>
                        </div>
                      </div>
                      <div className="document-entry-body editorial-entry-sheet">
                        <div className="editorial-entry-kicker">
                          <span className="editorial-entry-index">
                            {String(
                              selectedEntry.value.documentOrder + 1,
                            ).padStart(2, '0')}
                          </span>
                          <span>共 {document.entryCount} 个条目</span>
                          <button
                            type="button"
                            className="text-action"
                            onClick={() => {
                              setMode('source');
                            }}
                          >
                            返回全文 ↗
                          </button>
                        </div>
                        <div className="document-entry-reading">
                          <h3>{readingTitle(selectedEntry.value.titlePath)}</h3>
                          <InformationEntryTranslation
                            key={`${selectedEntry.entryId}:${selectedEntry.revision.toString()}:${String(selection.includePrivate)}`}
                            leadingContent={
                              mode === 'entries' ? (
                                <>{documentIdentity}</>
                              ) : undefined
                            }
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
        )}
        <div className="document-tool-area">
          <ContentDialog
            open={editing && !editingStructure && !toolOpen}
            title="编辑文档"
            onClose={() => {
              setEditing(false);
            }}
            className="reading-editor-dialog"
          >
            <div className="reader-editor-actions">
              <div className="journey-action-group">
                <button
                  className="secondary-action"
                  disabled={!document}
                  onClick={() => {
                    setTool(undefined);
                    if (document?.workingCopy) openTool('working-copy');
                    else setEditingStructure(true);
                  }}
                >
                  {structureDrafts.has(documentId)
                    ? '继续分段草稿'
                    : '修改分段'}
                </button>
                <button
                  className="secondary-action"
                  disabled={!document}
                  onClick={() => {
                    openTool('split-recipes');
                  }}
                >
                  拆分方案
                </button>
                <button
                  className="secondary-action"
                  disabled={!document}
                  onClick={() => {
                    openTool('tags');
                  }}
                >
                  编辑标签
                </button>
                <button
                  className="secondary-action"
                  disabled={!selectedEntry}
                  onClick={() => {
                    if (selectedEntry) {
                      setAnnotationTarget({
                        scope: toolScope,
                        entryId: selectedEntry.entryId,
                      });
                      openTool('annotations');
                    }
                  }}
                >
                  条目标注
                </button>
                <button
                  className="secondary-action"
                  disabled={!selectedEntry}
                  onClick={() => {
                    openTool('links');
                  }}
                >
                  建立联系
                </button>
                <button
                  className="text-action"
                  disabled={!document}
                  onClick={() => {
                    openTool('source');
                  }}
                >
                  来源与证据
                </button>
              </div>
              <div className="journey-action-group journey-ai-actions">
                {document && !document.isPrivate ? (
                  <DocumentPublicationButton
                    key={
                      documentId +
                      allEntries.map((entry) => entry.revision).join('-')
                    }
                    snapshotId={documentId}
                    entries={
                      controller.allEntries.status === 'ready'
                        ? controller.allEntries.value.items.map(
                            (item) => item.entry,
                          )
                        : []
                    }
                    onPublished={() => {
                      void processing.refresh();
                    }}
                  />
                ) : null}
                <button
                  className="secondary-action"
                  disabled={!document || document.isPrivate}
                  onClick={() => {
                    setProcessingStage(undefined);
                    openTool('processing');
                  }}
                >
                  AI 处理
                </button>
                <button
                  className="secondary-action"
                  disabled={!selectedEntry || selectedEntry.value.isPrivate}
                  onClick={() => {
                    setMode('entries');
                    openTool('ai');
                  }}
                >
                  AI 标签与翻译
                </button>
              </div>
            </div>
          </ContentDialog>
          {selectedEntry && openedTools.has(toolScope + ':ai') ? (
            <WorkspaceToolPanel
              title="AI 标签与翻译"
              open={toolOpen && tool === 'ai'}
              onClose={closeTool}
            >
              <DocumentAiActions
                snapshotId={documentId}
                entryCount={document?.entryCount ?? 0}
                onStarted={() => {
                  void processing.refresh();
                }}
              />
              <InformationEntryTranslation
                allowRedo
                entry={selectedEntry}
                services={translationServices}
              />
            </WorkspaceToolPanel>
          ) : null}
          {document?.workingCopy &&
          openedTools.has(toolScope + ':working-copy') ? (
            <WorkspaceToolPanel
              title="处理已有全文草稿"
              open={toolOpen && tool === 'working-copy'}
              onClose={closeTool}
            >
              <InformationDocumentWorkingCopy
                snapshotId={document.snapshotId}
                isPrivate={Boolean(document.isPrivate)}
                includePrivate={selection.includePrivate}
                alreadyMaterialized={document.entryCount > 0}
                onLoad={structureServices.onLoadDocumentWorkingCopy}
                onSave={structureServices.onSaveDocumentWorkingCopy}
                onRestore={structureServices.onRestoreDocumentWorkingCopy}
                onCommit={structureServices.onCommitDocumentWorkingCopy}
                onCommitted={(snapshotId) => {
                  controller.refresh(snapshotId);
                  closeTool();
                  return Promise.resolve();
                }}
              />
            </WorkspaceToolPanel>
          ) : null}
          {document && openedTools.has(toolScope + ':processing') ? (
            <WorkspaceToolPanel
              title="AI 处理详情"
              open={toolOpen && tool === 'processing'}
              onClose={closeTool}
            >
              {!document.isPrivate ? (
                <DocumentAiActions
                  snapshotId={documentId}
                  entryCount={document.entryCount}
                  onStarted={() => {
                    void processing.refresh();
                  }}
                />
              ) : null}
              {processing.error ? (
                <p role="status">{processing.error}</p>
              ) : processingValue ? (
                <DocumentProcessingDetails
                  value={processingValue}
                  snapshotId={documentId}
                  stage={processingStage}
                  onOpenDocument={(snapshotId) => {
                    setTool(undefined);
                    onSelectionChange({...selection, snapshotId});
                  }}
                  onReadEntries={() => {
                    setMode('entries');
                    closeTool();
                  }}
                  onOpenTool={(id) => {
                    setMode('entries');
                    openTool(id);
                  }}
                />
              ) : (
                <p role="status">正在读取处理记录…</p>
              )}
            </WorkspaceToolPanel>
          ) : null}
          {annotationTarget?.scope === toolScope &&
          openedTools.has(toolScope + ':annotations') ? (
            <WorkspaceToolPanel
              title="条目标注"
              open={toolOpen && tool === 'annotations'}
              onClose={closeTool}
            >
              <EntryAnnotationPanel
                key={
                  annotationTarget.entryId +
                  ':' +
                  String(selection.includePrivate)
                }
                entryId={annotationTarget.entryId}
                includePrivate={selection.includePrivate}
                onSaved={() => {
                  controller.refresh(documentId);
                }}
              />
            </WorkspaceToolPanel>
          ) : null}
          {document && openedTools.has(toolScope + ':split-recipes') ? (
            <WorkspaceToolPanel
              key={toolScope + ':split-recipes'}
              title="拆分方案"
              open={toolOpen && tool === 'split-recipes'}
              onClose={closeTool}
            >
              <SourceSplitRecipePanel
                snapshotId={documentId}
                includePrivate={selection.includePrivate}
                isPrivate={Boolean(document.isPrivate)}
                hasEntries={document.entryCount > 0}
                onApplied={() => {
                  controller.refresh(documentId);
                }}
              />
            </WorkspaceToolPanel>
          ) : null}
          {document === undefined
            ? null
            : (['source', 'tags', 'links'] as const).map((id) =>
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
                      </>
                    ) : null}
                    {id === 'links' && selectedEntry !== undefined
                      ? renderLinks(selectedEntry, selection.includePrivate)
                      : null}
                    {(id === 'tags' || id === 'links') &&
                    selectedEntry === undefined ? (
                      <div className="document-paper__empty">
                        <p>
                          这份文档还没有确认分段。可以整篇保留，确认后再添加标签和联系。
                        </p>
                        <button
                          className="secondary-action"
                          type="button"
                          onClick={() => {
                            setTool(undefined);
                            if (document.workingCopy) openTool('working-copy');
                            else setEditingStructure(true);
                          }}
                        >
                          编辑分段
                        </button>
                      </div>
                    ) : null}
                  </WorkspaceToolPanel>
                ),
              )}
        </div>
      </ReadingWorkspaceFrame>
    </div>
  );
}
