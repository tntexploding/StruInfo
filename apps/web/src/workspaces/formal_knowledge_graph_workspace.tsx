import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import type {CSSProperties, KeyboardEvent} from 'react';

import type {
  AiAssociationProposalDecisionResponse,
  AiAssociationProposalListResponse,
  AiAssociationProposalStartResponse,
  InformationEntry,
  InformationEntryGraphDirection,
  InformationEntryGraphEdge,
  InformationEntryGraphSemanticKind,
  InformationEntryGraphVerificationStatus,
  InformationEntryKnowledgeGraphEdgeWriteResponse,
  InformationEntryKnowledgeGraphResponse,
  M1cHttpResponse,
} from '../api/m1c_api_contract.js';
import {ActionNotice} from '../components/action_notice.js';
import type {ActionFeedback} from '../components/product_types.js';
import {describeInformationEntryFailure} from './information_entry_shared.js';
import {InformationEntryAiAssociations} from './information_entry_ai_associations.js';
import {formatBasisPointPercentage} from './information_entry_score.js';
import {createLatestRequestTracker} from './latest_request.js';

type ReadyGraphResponse = Extract<
  InformationEntryKnowledgeGraphResponse,
  {status: 'ok'}
>;

type GraphState =
  | Readonly<{status: 'loading'}>
  | Readonly<{status: 'ready'; response: ReadyGraphResponse; requestId: number}>
  | Readonly<{status: 'error'; message: string}>;

type PrivacyScope = 'public' | 'include_private' | 'only_private';
type ViewMode = 'graph' | 'list';
type NewRelationDirection =
  'symmetric' | 'center_to_related' | 'related_to_center';

interface GraphRelationDraft {
  readonly label: string;
  readonly direction: InformationEntryGraphDirection;
  readonly semanticKind: InformationEntryGraphSemanticKind;
  readonly verificationStatus: InformationEntryGraphVerificationStatus;
  readonly note: string;
}

const SEMANTIC_KIND_OPTIONS: readonly Readonly<{
  value: InformationEntryGraphSemanticKind;
  label: string;
}>[] = Object.freeze([
  {value: 'similarity', label: '相似'},
  {value: 'related', label: '相关'},
  {value: 'supports', label: '支持 / 补强'},
  {value: 'contradicts', label: '冲突 / 反驳'},
  {value: 'part_of', label: '组成 / 隶属'},
  {value: 'causes', label: '因果'},
  {value: 'example_of', label: '例子'},
  {value: 'custom', label: '自定义'},
]);

export interface FormalKnowledgeGraphWorkspaceProps {
  readonly initialCenter?: Readonly<{entryId: string; includePrivate: boolean}>;
  readonly onReturnToQuery?: () => void;
  readonly onOpenSourceReview?: () => void;
  readonly aiAssociationEnabled: boolean;
  readonly onAcceptAiAssociationProposal: (
    entryId: string,
    relatedEntryId: string,
    proposalId: string,
  ) => Promise<M1cHttpResponse<AiAssociationProposalDecisionResponse>>;
  readonly onListAiAssociationProposals: (
    entryId: string,
    relatedEntryId: string,
  ) => Promise<M1cHttpResponse<AiAssociationProposalListResponse>>;
  readonly onReadGraph: (
    body: unknown,
  ) => Promise<M1cHttpResponse<InformationEntryKnowledgeGraphResponse>>;
  readonly onRejectAiAssociationProposal: (
    entryId: string,
    relatedEntryId: string,
    proposalId: string,
  ) => Promise<M1cHttpResponse<AiAssociationProposalDecisionResponse>>;
  readonly onReviseEdge: (
    entryId: string,
    relatedEntryId: string,
    body: unknown,
  ) => Promise<
    M1cHttpResponse<InformationEntryKnowledgeGraphEdgeWriteResponse>
  >;
  readonly onStartAiAssociationProposal: (
    entryId: string,
    relatedEntryId: string,
    requestKey: string,
  ) => Promise<M1cHttpResponse<AiAssociationProposalStartResponse>>;
  readonly onOpenEvidence: (
    snapshotId: string,
    fragmentId: string | undefined,
    includePrivate: boolean,
  ) => void;
}

export function FormalKnowledgeGraphWorkspace({
  initialCenter,
  onReturnToQuery,
  onOpenSourceReview,
  aiAssociationEnabled,
  onAcceptAiAssociationProposal,
  onListAiAssociationProposals,
  onOpenEvidence,
  onReadGraph,
  onRejectAiAssociationProposal,
  onReviseEdge,
  onStartAiAssociationProposal,
}: FormalKnowledgeGraphWorkspaceProps) {
  const [queryDraft, setQueryDraft] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [privacyScope, setPrivacyScope] = useState<PrivacyScope>(
    initialCenter?.includePrivate === true ? 'include_private' : 'public',
  );
  const [viewMode, setViewMode] = useState<ViewMode>('graph');
  const [state, setState] = useState<GraphState>({status: 'loading'});
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string>();
  const [feedback, setFeedback] = useState<ActionFeedback>();
  const [writing, setWriting] = useState(false);
  const [targetQuery, setTargetQuery] = useState('');
  const [targetCandidates, setTargetCandidates] = useState<
    readonly Readonly<InformationEntry>[]
  >([]);
  const [targetEntryId, setTargetEntryId] = useState('');
  const [newLabel, setNewLabel] = useState('相关');
  const [newSemanticKind, setNewSemanticKind] =
    useState<InformationEntryGraphSemanticKind>('related');
  const [newNote, setNewNote] = useState('');
  const [newDirection, setNewDirection] =
    useState<NewRelationDirection>('symmetric');
  const initialCenterId = useRef(initialCenter?.entryId);
  const graphRequests = useRef(createLatestRequestTracker());
  const targetRequests = useRef(createLatestRequestTracker());

  const includePrivate = privacyScope !== 'public';
  const onlyPrivate = privacyScope === 'only_private';

  const readGraph = useCallback(
    async (
      centerEntryId?: string,
      options?: Readonly<{preserveFeedback?: boolean}>,
    ) => {
      const requestId = graphRequests.current.begin();
      targetRequests.current.invalidate();
      setTargetCandidates([]);
      setTargetEntryId('');
      setState({status: 'loading'});
      if (options?.preserveFeedback !== true) setFeedback(undefined);
      try {
        const response = await onReadGraph({
          ...(activeQuery === '' ? {} : {query: activeQuery}),
          ...(centerEntryId === undefined ? {} : {centerEntryId}),
          includePrivate,
          onlyPrivate,
          candidateLimit: 8,
          neighborLimit: 12,
        });
        if (!graphRequests.current.isCurrent(requestId)) return;
        if (response.body.status !== 'ok') {
          setState({
            status: 'error',
            message: describeInformationEntryFailure(response.body),
          });
          return;
        }
        setState({status: 'ready', response: response.body, requestId});
        const nextCenter = response.body.graph?.center.entryId;
        setSelectedNodeId(nextCenter);
        setSelectedEdgeKey(undefined);
      } catch {
        if (!graphRequests.current.isCurrent(requestId)) return;
        setState({
          status: 'error',
          message: '无法读取知识图谱；现有条目和关系没有被修改。',
        });
      }
    },
    [activeQuery, includePrivate, onReadGraph, onlyPrivate],
  );

  useEffect(() => {
    const tracker = graphRequests.current;
    const targetTracker = targetRequests.current;
    let cancelled = false;
    globalThis.queueMicrotask(() => {
      if (!cancelled) {
        const center = initialCenterId.current;
        initialCenterId.current = undefined;
        void readGraph(center);
      }
    });
    return () => {
      cancelled = true;
      tracker.invalidate();
      targetTracker.invalidate();
    };
  }, [readGraph]);

  const graph = state.status === 'ready' ? state.response.graph : null;
  const edges = graph?.edges ?? [];
  const hiddenEdges = graph?.hiddenEdges ?? [];
  const nodesById = useMemo(
    () => new Map((graph?.nodes ?? []).map((node) => [node.entryId, node])),
    [graph?.nodes],
  );
  const selectedNode =
    selectedNodeId === undefined ? undefined : nodesById.get(selectedNodeId);
  const selectedEdge = [...edges, ...hiddenEdges].find(
    (edge) => edgeKey(edge) === selectedEdgeKey,
  );

  function submitSearch(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = queryDraft.trim();
    if (nextQuery === activeQuery) {
      void readGraph();
      return;
    }
    setActiveQuery(nextQuery);
  }

  async function writeEdge(
    edge: Readonly<InformationEntryGraphEdge>,
    operation: 'edit' | 'block' | 'restore',
    draft?: Readonly<GraphRelationDraft>,
  ) {
    if (state.status !== 'ready' || graph === null || writing) return;
    const relatedEntryId = otherEndpoint(edge, graph.center.entryId);
    const writeRequestId = state.requestId;
    setWriting(true);
    setFeedback(undefined);
    try {
      const response = await onReviseEdge(
        graph.center.entryId,
        relatedEntryId,
        {
          expectedRevision: edge.overrideRevision,
          includePrivate,
          operation,
          ...(operation === 'edit'
            ? {
                expectedEntryRevisions: {
                  entryLowRevision: nodesById.get(edge.entryLowId)?.revision,
                  entryHighRevision: nodesById.get(edge.entryHighId)?.revision,
                },
                label: draft?.label ?? edge.label,
                direction: draft?.direction ?? edge.direction,
                semanticKind: draft?.semanticKind ?? edge.semanticKind,
                verificationStatus:
                  draft?.verificationStatus ??
                  (edge.verificationStatus === 'calculated'
                    ? 'unreviewed'
                    : edge.verificationStatus),
                note: draft?.note ?? edge.note,
              }
            : {}),
        },
      );
      if (!graphRequests.current.isCurrent(writeRequestId)) return;
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        setFeedback({
          kind: 'error',
          title: '关系没有保存',
          detail: describeInformationEntryFailure(response.body),
        });
        return;
      }
      await readGraph(graph.center.entryId, {preserveFeedback: true});
      setFeedback({
        kind: 'success',
        title: operation === 'block' ? '关系已隐藏' : '关系已保存',
        detail:
          operation === 'block'
            ? '该边不会出现在图谱或遍历中，可随时从隐藏关系列表恢复。'
            : '人工修改已追加保存，后续相似度重算不会覆盖。',
      });
    } catch {
      if (!graphRequests.current.isCurrent(writeRequestId)) return;
      setFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '关系没有修改。',
      });
    } finally {
      setWriting(false);
    }
  }

  async function searchTargets(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (graph === null || targetQuery.trim() === '') return;
    const requestId = targetRequests.current.begin();
    try {
      const response = await onReadGraph({
        query: targetQuery.trim(),
        centerEntryId: graph.center.entryId,
        includePrivate,
        onlyPrivate,
        candidateLimit: 12,
        neighborLimit: 12,
      });
      if (!targetRequests.current.isCurrent(requestId)) return;
      if (response.body.status !== 'ok') {
        setFeedback({
          kind: 'error',
          title: '没有读取到目标条目',
          detail: describeInformationEntryFailure(response.body),
        });
        return;
      }
      const existingIds = new Set(
        [...edges, ...hiddenEdges].map((edge) =>
          otherEndpoint(edge, graph.center.entryId),
        ),
      );
      setTargetCandidates(
        response.body.candidates
          .map((candidate) => candidate.entry)
          .filter(
            (candidate) =>
              candidate.entryId !== graph.center.entryId &&
              !existingIds.has(candidate.entryId),
          ),
      );
      setTargetEntryId('');
    } catch {
      if (!targetRequests.current.isCurrent(requestId)) return;
      setFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '没有创建关系。',
      });
    }
  }

  async function createRelation() {
    if (
      state.status !== 'ready' ||
      graph === null ||
      targetEntryId === '' ||
      writing
    )
      return;
    const writeRequestId = state.requestId;
    setWriting(true);
    setFeedback(undefined);
    try {
      const response = await onReviseEdge(graph.center.entryId, targetEntryId, {
        expectedRevision: 0,
        includePrivate,
        operation: 'edit',
        label: newLabel,
        direction: canonicalDirection(
          graph.center.entryId,
          targetEntryId,
          newDirection,
        ),
        semanticKind: newSemanticKind,
        verificationStatus: 'unreviewed',
        note: newNote,
      });
      if (!graphRequests.current.isCurrent(writeRequestId)) return;
      if (
        response.body.status !== 'applied' &&
        response.body.status !== 'unchanged'
      ) {
        setFeedback({
          kind: 'error',
          title: '关系没有创建',
          detail: describeInformationEntryFailure(response.body),
        });
        return;
      }
      setTargetEntryId('');
      setTargetCandidates([]);
      setTargetQuery('');
      setNewNote('');
      await readGraph(graph.center.entryId, {preserveFeedback: true});
      setFeedback({
        kind: 'success',
        title: '用户关系已创建',
        detail: '关系已追加保存，并明确标记为“用户创建”。',
      });
    } catch {
      if (!graphRequests.current.isCurrent(writeRequestId)) return;
      setFeedback({
        kind: 'error',
        title: '本地接口不可达',
        detail: '关系没有创建。',
      });
    } finally {
      setWriting(false);
    }
  }

  return (
    <div className="workspace-view formal-knowledge-workspace">
      <header className="workflow-page-heading">
        <div>
          <h1>知识</h1>
          {onOpenSourceReview === undefined ? null : (
            <button
              type="button"
              className="secondary-action"
              onClick={onOpenSourceReview}
            >
              来源复核
            </button>
          )}
          {onReturnToQuery === undefined ? null : (
            <button
              type="button"
              className="secondary-action"
              onClick={onReturnToQuery}
            >
              返回查询
            </button>
          )}
        </div>
      </header>

      <aside className="workflow-mode-summary" aria-label="知识页操作指南">
        <strong>查看知识</strong>
        <span>1. 从右侧选择中心条目</span>
        <span>2. 在中间查看关系图谱</span>
        <span>3. 在底部检查并编辑关系</span>
      </aside>

      <section className="knowledge-command-panel" aria-label="选择知识中心">
        <form className="knowledge-search-form" onSubmit={submitSearch}>
          <label className="field field--wide">
            <span>搜索中心条目</span>
            <input
              type="search"
              value={queryDraft}
              placeholder="按正文、标题或关键词搜索条目"
              onChange={(event) => {
                setQueryDraft(event.currentTarget.value);
              }}
            />
          </label>
          <label className="field">
            <span>隐私范围</span>
            <select
              value={privacyScope}
              onChange={(event) => {
                setPrivacyScope(event.currentTarget.value as PrivacyScope);
              }}
            >
              <option value="public">不查看隐私</option>
              <option value="include_private">包含隐私</option>
              <option value="only_private">只看隐私</option>
            </select>
          </label>
          <button className="primary-action" type="submit">
            设为知识中心
          </button>
        </form>
        <div className="knowledge-view-switch" aria-label="知识展示方式">
          <button
            type="button"
            aria-pressed={viewMode === 'graph'}
            onClick={() => {
              setViewMode('graph');
            }}
          >
            图谱
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'list'}
            onClick={() => {
              setViewMode('list');
            }}
          >
            关系列表
          </button>
        </div>
      </section>

      <ActionNotice feedback={feedback} />

      {state.status === 'loading' ? (
        <section className="knowledge-state" aria-live="polite">
          正在读取当前知识图谱…
        </section>
      ) : state.status === 'error' ? (
        <section className="knowledge-state" role="alert">
          <p>{state.message}</p>
          <button
            className="text-action"
            type="button"
            onClick={() => void readGraph()}
          >
            重试
          </button>
        </section>
      ) : (
        <>
          <CandidateStrip
            response={state.response}
            activeEntryId={graph?.center.entryId}
            onSelect={(entryId) => void readGraph(entryId)}
          />
          {graph === null ? (
            <section className="knowledge-state">
              <strong>当前范围没有可作为中心的条目。</strong>
              <span>可更换关键词，或明确调整隐私范围后再试。</span>
            </section>
          ) : (
            <div className="knowledge-workbench">
              <section
                className="knowledge-network-panel"
                aria-label="知识图谱"
              >
                {viewMode === 'graph' ? (
                  <InformationEntryRadialGraph
                    center={graph.center}
                    edges={edges}
                    nodesById={nodesById}
                    selectedEdgeKey={selectedEdgeKey}
                    selectedNodeId={selectedNodeId}
                    onSelectEdge={setSelectedEdgeKey}
                    onSelectNode={setSelectedNodeId}
                    onRecenter={(entryId) => void readGraph(entryId)}
                  />
                ) : (
                  <RelationListView
                    center={graph.center}
                    edges={edges}
                    nodesById={nodesById}
                    onSelectEdge={setSelectedEdgeKey}
                    onSelectNode={setSelectedNodeId}
                  />
                )}
              </section>

              <aside
                className="knowledge-inspector"
                aria-label="知识详情与关系编辑"
              >
                <NodeInspector
                  entry={selectedNode ?? graph.center}
                  onOpenEvidence={onOpenEvidence}
                  onRecenter={(entryId) => void readGraph(entryId)}
                  isCenter={
                    (selectedNode ?? graph.center).entryId ===
                    graph.center.entryId
                  }
                />
                {selectedEdge === undefined ? null : (
                  <EdgeInspector
                    key={`${edgeKey(selectedEdge)}:${selectedEdge.overrideRevision.toString()}`}
                    aiAssociationEnabled={aiAssociationEnabled}
                    centerEntry={graph.center}
                    edge={selectedEdge}
                    relatedEntry={nodesById.get(
                      otherEndpoint(selectedEdge, graph.center.entryId),
                    )}
                    writing={writing}
                    onAcceptAiAssociationProposal={
                      onAcceptAiAssociationProposal
                    }
                    onListAiAssociationProposals={onListAiAssociationProposals}
                    onOpenEvidence={onOpenEvidence}
                    onProposalAccepted={() =>
                      graphRequests.current.isCurrent(state.requestId)
                        ? readGraph(graph.center.entryId, {
                            preserveFeedback: true,
                          })
                        : Promise.resolve()
                    }
                    onRejectAiAssociationProposal={
                      onRejectAiAssociationProposal
                    }
                    onStartAiAssociationProposal={onStartAiAssociationProposal}
                    onWrite={writeEdge}
                  />
                )}
                <CreateRelationPanel
                  direction={newDirection}
                  hint={
                    selectedEdge === undefined
                      ? '选择一条边，可查看来源、相似度分量并修改关系。'
                      : undefined
                  }
                  label={newLabel}
                  note={newNote}
                  semanticKind={newSemanticKind}
                  targetCandidates={targetCandidates}
                  targetEntryId={targetEntryId}
                  targetQuery={targetQuery}
                  writing={writing}
                  onCreate={() => void createRelation()}
                  onDirectionChange={setNewDirection}
                  onLabelChange={setNewLabel}
                  onNoteChange={setNewNote}
                  onSearch={(event) => {
                    void searchTargets(event);
                  }}
                  onTargetChange={setTargetEntryId}
                  onTargetQueryChange={setTargetQuery}
                  onSemanticKindChange={setNewSemanticKind}
                />
                {hiddenEdges.length > 0 ? (
                  <HiddenRelations
                    centerEntryId={graph.center.entryId}
                    edges={hiddenEdges}
                    nodesById={nodesById}
                    writing={writing}
                    onRestore={(edge) => void writeEdge(edge, 'restore')}
                  />
                ) : null}
              </aside>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CandidateStrip({
  activeEntryId,
  onSelect,
  response,
}: {
  readonly activeEntryId: string | undefined;
  readonly onSelect: (entryId: string) => void;
  readonly response: ReadyGraphResponse;
}) {
  if (response.candidates.length === 0) return null;
  return (
    <section className="knowledge-candidate-strip" aria-label="其他匹配中心">
      <header>
        <strong>匹配中心</strong>
        <span>{response.candidateTotalCount.toString()} 项</span>
      </header>
      <div>
        {response.candidates.map(({entry}, index) => (
          <button
            key={entry.entryId}
            type="button"
            aria-pressed={entry.entryId === activeEntryId}
            onClick={() => {
              onSelect(entry.entryId);
            }}
          >
            <span>{(index + 1).toString().padStart(2, '0')}</span>
            {entryTitle(entry)}
          </button>
        ))}
      </div>
    </section>
  );
}

const KNOWLEDGE_GRAPH_WIDTH = 1_000;
const KNOWLEDGE_GRAPH_HEIGHT = 640;
const KNOWLEDGE_GRAPH_CENTER = Object.freeze({x: 500, y: 320});

interface KnowledgeGraphPoint {
  readonly x: number;
  readonly y: number;
}

interface KnowledgeGraphLine {
  readonly start: KnowledgeGraphPoint;
  readonly end: KnowledgeGraphPoint;
}

type KnowledgeGraphNodeStyle = CSSProperties &
  Readonly<{
    '--knowledge-node-x': string;
    '--knowledge-node-y': string;
  }>;

type KnowledgeGraphTooltipStyle = CSSProperties &
  Readonly<{
    '--knowledge-tooltip-x': string;
    '--knowledge-tooltip-y': string;
  }>;

export function InformationEntryRadialGraph({
  center,
  edges,
  nodesById,
  onRecenter,
  onSelectEdge,
  onSelectNode,
  selectedEdgeKey,
  selectedNodeId,
}: {
  readonly center: Readonly<InformationEntry>;
  readonly edges: readonly Readonly<InformationEntryGraphEdge>[];
  readonly nodesById: ReadonlyMap<string, Readonly<InformationEntry>>;
  readonly onRecenter: (entryId: string) => void;
  readonly onSelectEdge: (key: string) => void;
  readonly onSelectNode: (entryId: string) => void;
  readonly selectedEdgeKey: string | undefined;
  readonly selectedNodeId: string | undefined;
}) {
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string>();
  const [focusedEdgeKey, setFocusedEdgeKey] = useState<string>();
  const graphRef = useRef<HTMLDivElement>(null);
  const connections = edges.flatMap((edge, index) => {
    const relatedId = otherEndpoint(edge, center.entryId);
    const related = nodesById.get(relatedId);
    if (related === undefined) return [];
    const point = radialGraphPoint(index, edges.length);
    return [
      {
        edge,
        key: edgeKey(edge),
        line: radialGraphLine(point),
        point,
        related,
      },
    ];
  });
  const visibleTooltipKey = focusedEdgeKey ?? hoveredEdgeKey;

  useEffect(() => {
    const graph = graphRef.current;
    const scrollport = graph?.parentElement;
    if (graph === null || scrollport === null || scrollport === undefined)
      return;

    const centerGraph = () => {
      if (scrollport.scrollWidth <= scrollport.clientWidth) {
        scrollport.scrollLeft = 0;
        return;
      }
      scrollport.scrollLeft =
        (scrollport.scrollWidth - scrollport.clientWidth) / 2;
    };

    centerGraph();
    const observer = new ResizeObserver(centerGraph);
    observer.observe(graph);
    observer.observe(scrollport);
    return () => {
      observer.disconnect();
    };
  }, [center.entryId, connections.length]);

  return (
    <div
      className="knowledge-graph"
      role="group"
      aria-label="条目关系图"
      ref={graphRef}
    >
      {connections.length === 0 ? null : (
        <svg
          className="knowledge-radial-edges"
          viewBox={`0 0 ${KNOWLEDGE_GRAPH_WIDTH.toString()} ${KNOWLEDGE_GRAPH_HEIGHT.toString()}`}
          preserveAspectRatio="none"
          role="group"
          aria-label="关系连线"
        >
          <defs>
            <marker
              id="knowledge-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          {connections.map(({edge, key, line}) => {
            const explanation = describeGraphEdge(edge);
            const marker = graphEdgeMarkers(edge, center.entryId);
            return (
              <g
                className="knowledge-radial-edge"
                data-origin={edge.origin}
                data-selected={selectedEdgeKey === key}
                role="button"
                tabIndex={0}
                aria-label={`${displayEdgeLabel(edge)}，${directionLabel(edge, center.entryId)}。${explanation}。联系强度 ${formatBasisPointPercentage(edge.effectiveScore)}，${originLabel(edge.origin)}。`}
                aria-pressed={selectedEdgeKey === key}
                key={key}
                onClick={() => {
                  onSelectEdge(key);
                }}
                onFocus={() => {
                  setFocusedEdgeKey(key);
                }}
                onBlur={() => {
                  setFocusedEdgeKey((current) =>
                    current === key ? undefined : current,
                  );
                }}
                onPointerEnter={() => {
                  setHoveredEdgeKey(key);
                }}
                onPointerLeave={() => {
                  setHoveredEdgeKey((current) =>
                    current === key ? undefined : current,
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setFocusedEdgeKey(undefined);
                    setHoveredEdgeKey(undefined);
                    return;
                  }
                  selectGraphEdgeFromKeyboard(event, () => {
                    onSelectEdge(key);
                  });
                }}
              >
                <title>{explanation}</title>
                <line
                  className="knowledge-radial-edge__line"
                  x1={line.start.x}
                  y1={line.start.y}
                  x2={line.end.x}
                  y2={line.end.y}
                  markerStart={marker.start}
                  markerEnd={marker.end}
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  className="knowledge-radial-edge__target"
                  x1={line.start.x}
                  y1={line.start.y}
                  x2={line.end.x}
                  y2={line.end.y}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>
      )}
      <button
        className="knowledge-node knowledge-node--center"
        type="button"
        data-knowledge-graph-center="true"
        aria-pressed={selectedNodeId === center.entryId}
        onClick={() => {
          onSelectNode(center.entryId);
        }}
      >
        <small>中心条目</small>
        <strong>{entryTitle(center)}</strong>
        <span>{entrySummary(center)}</span>
      </button>
      {edges.length === 0 ? (
        <p className="knowledge-empty-neighborhood">
          当前中心还没有可见关系。可在右侧搜索另一个条目并创建关系。
        </p>
      ) : (
        <>
          {connections.map(({edge, key, point, related}) => (
            <button
              className="knowledge-node knowledge-node--related"
              type="button"
              data-knowledge-graph-related="true"
              style={graphNodeStyle(point)}
              aria-pressed={selectedNodeId === related.entryId}
              key={key}
              onClick={() => {
                onSelectNode(related.entryId);
              }}
              onDoubleClick={() => {
                onRecenter(related.entryId);
              }}
            >
              <small>
                {displayEdgeLabel(edge)} ·{' '}
                {formatBasisPointPercentage(edge.effectiveScore)}
              </small>
              <strong>{entryTitle(related)}</strong>
              <span>{entrySummary(related)}</span>
            </button>
          ))}
          {connections.map(({edge, key, point}) =>
            visibleTooltipKey === key ? (
              <div
                className="knowledge-edge-tooltip"
                style={graphTooltipStyle(point)}
                role="tooltip"
                key={`tooltip:${key}`}
              >
                <strong>
                  {directionGlyph(edge, center.entryId)}{' '}
                  {displayEdgeLabel(edge)}
                </strong>
                <span>{describeGraphEdge(edge)}</span>
                <small>
                  {formatBasisPointPercentage(edge.effectiveScore)} ·{' '}
                  {originLabel(edge.origin)}
                </small>
              </div>
            ) : null,
          )}
        </>
      )}
    </div>
  );
}

function RelationListView({
  center,
  edges,
  nodesById,
  onSelectEdge,
  onSelectNode,
}: {
  readonly center: Readonly<InformationEntry>;
  readonly edges: readonly Readonly<InformationEntryGraphEdge>[];
  readonly nodesById: ReadonlyMap<string, Readonly<InformationEntry>>;
  readonly onSelectEdge: (key: string) => void;
  readonly onSelectNode: (entryId: string) => void;
}) {
  return (
    <div className="knowledge-relation-list">
      <header>
        <span>中心</span>
        <strong>{entryTitle(center)}</strong>
      </header>
      {edges.length === 0 ? (
        <p>当前没有可见关系。</p>
      ) : (
        <ol>
          {edges.map((edge) => {
            const relatedId = otherEndpoint(edge, center.entryId);
            const related = nodesById.get(relatedId);
            if (related === undefined) return null;
            return (
              <li key={edgeKey(edge)}>
                <button
                  type="button"
                  onClick={() => {
                    onSelectEdge(edgeKey(edge));
                  }}
                >
                  <span>{displayEdgeLabel(edge)}</span>
                  <small>
                    {directionLabel(edge, center.entryId)} ·{' '}
                    {originLabel(edge.origin)}
                  </small>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSelectNode(relatedId);
                  }}
                >
                  <strong>{entryTitle(related)}</strong>
                  <small>
                    {formatBasisPointPercentage(edge.effectiveScore)} 联系
                  </small>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function NodeInspector({
  entry,
  isCenter,
  onOpenEvidence,
  onRecenter,
}: {
  readonly entry: Readonly<InformationEntry>;
  readonly isCenter: boolean;
  readonly onOpenEvidence: FormalKnowledgeGraphWorkspaceProps['onOpenEvidence'];
  readonly onRecenter: (entryId: string) => void;
}) {
  return (
    <section className="knowledge-node-inspector">
      <h2>{entryTitle(entry)}</h2>
      <p>{entry.value.body}</p>
      <div className="knowledge-entry-tags">
        {entry.value.contentKeywords.slice(0, 6).map((keyword) => (
          <span key={keyword.normalizedValue}>{keyword.displayValue}</span>
        ))}
      </div>
      <dl>
        <div>
          <dt>来源</dt>
          <dd>{entry.sourceKey}</dd>
        </div>
        <div>
          <dt>范围</dt>
          <dd>{entry.value.isPrivate ? '隐私' : '普通'}</dd>
        </div>
      </dl>
      <div className="knowledge-inspector-actions">
        <button
          className="secondary-action"
          type="button"
          onClick={() => {
            onOpenEvidence(
              entry.snapshotId,
              entry.value.fragmentIds[0],
              entry.value.isPrivate,
            );
          }}
        >
          查看原文
        </button>
        {!isCenter ? (
          <button
            className="text-action"
            type="button"
            onClick={() => {
              onRecenter(entry.entryId);
            }}
          >
            设为新中心
          </button>
        ) : null}
      </div>
    </section>
  );
}

function EdgeInspector({
  aiAssociationEnabled,
  centerEntry,
  edge,
  onAcceptAiAssociationProposal,
  onListAiAssociationProposals,
  onOpenEvidence,
  onProposalAccepted,
  onRejectAiAssociationProposal,
  onStartAiAssociationProposal,
  onWrite,
  relatedEntry,
  writing,
}: {
  readonly aiAssociationEnabled: boolean;
  readonly centerEntry: Readonly<InformationEntry>;
  readonly edge: Readonly<InformationEntryGraphEdge>;
  readonly onAcceptAiAssociationProposal: FormalKnowledgeGraphWorkspaceProps['onAcceptAiAssociationProposal'];
  readonly onListAiAssociationProposals: FormalKnowledgeGraphWorkspaceProps['onListAiAssociationProposals'];
  readonly onOpenEvidence: FormalKnowledgeGraphWorkspaceProps['onOpenEvidence'];
  readonly onProposalAccepted: () => Promise<void>;
  readonly onRejectAiAssociationProposal: FormalKnowledgeGraphWorkspaceProps['onRejectAiAssociationProposal'];
  readonly onStartAiAssociationProposal: FormalKnowledgeGraphWorkspaceProps['onStartAiAssociationProposal'];
  readonly onWrite: (
    edge: Readonly<InformationEntryGraphEdge>,
    operation: 'edit' | 'block' | 'restore',
    draft?: Readonly<GraphRelationDraft>,
  ) => Promise<void>;
  readonly relatedEntry: Readonly<InformationEntry> | undefined;
  readonly writing: boolean;
}) {
  const [label, setLabel] = useState(displayEdgeLabel(edge));
  const [direction, setDirection] = useState(edge.direction);
  const [semanticKind, setSemanticKind] = useState(edge.semanticKind);
  const [verificationStatus, setVerificationStatus] =
    useState<InformationEntryGraphVerificationStatus>(
      edge.verificationStatus === 'calculated'
        ? 'unreviewed'
        : edge.verificationStatus,
    );
  const [note, setNote] = useState(edge.note);
  return (
    <section className="knowledge-edge-inspector">
      <header>
        <h2>{displayEdgeLabel(edge)}</h2>
        <span data-origin={edge.origin}>{originLabel(edge.origin)}</span>
      </header>
      <p>
        {relatedEntry === undefined ? '相关条目' : entryTitle(relatedEntry)} ·{' '}
        {directionLabel(edge, centerEntry.entryId)}
      </p>
      <p className="knowledge-edge-reason">
        <strong>建立原因</strong>
        <span>{describeGraphEdge(edge)}</span>
      </p>
      <div className="knowledge-relation-status" aria-label="关系状态">
        <span>{semanticKindLabel(edge.semanticKind)}</span>
        <span data-verification={edge.verificationStatus}>
          {verificationLabel(edge.verificationStatus)}
        </span>
      </div>
      {edge.sourceReview?.reason === 'entry_changed' ? (
        <p role="status">条目版本已变化，请重新核对两端来源。</p>
      ) : edge.sourceReview?.reason === 'unbound' ? (
        <p role="status">这次来源核验未绑定条目版本，需要重新复核。</p>
      ) : null}
      {edge.projection === undefined ? null : (
        <dl className="knowledge-edge-metrics">
          <div>
            <dt>综合</dt>
            <dd>{score(edge.effectiveScore)}</dd>
          </div>
          <div>
            <dt>内容</dt>
            <dd>{score(edge.projection.contentSimilarity)}</dd>
          </div>
          <div>
            <dt>类型</dt>
            <dd>{score(edge.projection.typeSimilarity)}</dd>
          </div>
          <div>
            <dt>领域</dt>
            <dd>{score(edge.projection.domainSimilarity)}</dd>
          </div>
        </dl>
      )}
      {relatedEntry === undefined ? null : (
        <div className="knowledge-source-check">
          <p>检查关系时可分别打开两端条目的来源。</p>
          <div className="knowledge-inspector-actions">
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                onOpenEvidence(
                  centerEntry.snapshotId,
                  centerEntry.value.fragmentIds[0],
                  centerEntry.value.isPrivate,
                );
              }}
            >
              查看中心来源
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                onOpenEvidence(
                  relatedEntry.snapshotId,
                  relatedEntry.value.fragmentIds[0],
                  relatedEntry.value.isPrivate,
                );
              }}
            >
              查看相关项来源
            </button>
          </div>
        </div>
      )}
      {relatedEntry === undefined ? null : (
        <InformationEntryAiAssociations
          enabled={aiAssociationEnabled}
          entry={centerEntry}
          relatedEntry={relatedEntry}
          onAccepted={onProposalAccepted}
          onAcceptAiAssociationProposal={onAcceptAiAssociationProposal}
          onListAiAssociationProposals={onListAiAssociationProposals}
          onRejectAiAssociationProposal={onRejectAiAssociationProposal}
          onStartAiAssociationProposal={onStartAiAssociationProposal}
        />
      )}
      <label className="field">
        <span>关系类型</span>
        <select
          value={semanticKind}
          onChange={(event) => {
            setSemanticKind(
              event.currentTarget.value as InformationEntryGraphSemanticKind,
            );
          }}
        >
          {SEMANTIC_KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>关系名称</span>
        <input
          value={label}
          maxLength={80}
          onChange={(event) => {
            setLabel(event.currentTarget.value);
          }}
        />
      </label>
      <label className="field">
        <span>方向</span>
        <select
          value={direction}
          onChange={(event) => {
            setDirection(
              event.currentTarget.value as InformationEntryGraphDirection,
            );
          }}
        >
          {directionOptions(centerEntry.entryId, edge).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>原文核对</span>
        <select
          value={verificationStatus}
          onChange={(event) => {
            setVerificationStatus(
              event.currentTarget
                .value as InformationEntryGraphVerificationStatus,
            );
          }}
        >
          <option value="unreviewed">尚未核对来源</option>
          <option value="source_checked">已核对两端来源</option>
          <option value="needs_review">需要再次复核</option>
        </select>
      </label>
      <label className="field">
        <span>关系说明（可选）</span>
        <textarea
          value={note}
          maxLength={500}
          rows={4}
          placeholder="记录这条关系为何成立，或仍需核对的问题"
          onChange={(event) => {
            setNote(event.currentTarget.value);
          }}
        />
      </label>
      <div className="knowledge-inspector-actions">
        <button
          className="primary-action"
          type="button"
          disabled={writing || label.trim() === ''}
          onClick={() =>
            void onWrite(edge, 'edit', {
              label,
              direction,
              semanticKind,
              verificationStatus,
              note,
            })
          }
        >
          保存关系
        </button>
        <button
          className="danger-action"
          type="button"
          disabled={writing}
          onClick={() => void onWrite(edge, 'block')}
        >
          {edge.origin === 'user_created' ? '删除关系' : '隐藏这条边'}
        </button>
      </div>
    </section>
  );
}

function CreateRelationPanel({
  direction,
  hint,
  label,
  note,
  onCreate,
  onDirectionChange,
  onLabelChange,
  onNoteChange,
  onSearch,
  onTargetChange,
  onTargetQueryChange,
  onSemanticKindChange,
  semanticKind,
  targetCandidates,
  targetEntryId,
  targetQuery,
  writing,
}: {
  readonly direction: NewRelationDirection;
  readonly hint: string | undefined;
  readonly label: string;
  readonly note: string;
  readonly onCreate: () => void;
  readonly onDirectionChange: (value: NewRelationDirection) => void;
  readonly onLabelChange: (value: string) => void;
  readonly onNoteChange: (value: string) => void;
  readonly onSearch: (event: React.SyntheticEvent<HTMLFormElement>) => void;
  readonly onTargetChange: (value: string) => void;
  readonly onTargetQueryChange: (value: string) => void;
  readonly onSemanticKindChange: (
    value: InformationEntryGraphSemanticKind,
  ) => void;
  readonly semanticKind: InformationEntryGraphSemanticKind;
  readonly targetCandidates: readonly Readonly<InformationEntry>[];
  readonly targetEntryId: string;
  readonly targetQuery: string;
  readonly writing: boolean;
}) {
  return (
    <section
      className={`knowledge-create-relation${hint === undefined ? '' : ' knowledge-create-relation--wide'}`}
    >
      <header className="knowledge-create-relation__header">
        <h2>创建用户关系</h2>
        {hint === undefined ? null : (
          <p className="knowledge-inspector__hint">{hint}</p>
        )}
      </header>
      <form onSubmit={onSearch}>
        <label className="field">
          <span>查找另一个条目</span>
          <input
            type="search"
            value={targetQuery}
            onChange={(event) => {
              onTargetQueryChange(event.currentTarget.value);
            }}
          />
        </label>
        <button className="secondary-action" type="submit">
          查找
        </button>
      </form>
      {targetCandidates.length > 0 ? (
        <label className="field">
          <span>目标条目</span>
          <select
            value={targetEntryId}
            onChange={(event) => {
              onTargetChange(event.currentTarget.value);
            }}
          >
            <option value="">请选择</option>
            {targetCandidates.map((entry) => (
              <option key={entry.entryId} value={entry.entryId}>
                {entryTitle(entry)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="field">
        <span>关系类型</span>
        <select
          value={semanticKind}
          onChange={(event) => {
            onSemanticKindChange(
              event.currentTarget.value as InformationEntryGraphSemanticKind,
            );
          }}
        >
          {SEMANTIC_KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>关系名称</span>
        <input
          value={label}
          maxLength={80}
          onChange={(event) => {
            onLabelChange(event.currentTarget.value);
          }}
        />
      </label>
      <label className="field">
        <span>关系说明（可选）</span>
        <textarea
          value={note}
          maxLength={500}
          rows={3}
          onChange={(event) => {
            onNoteChange(event.currentTarget.value);
          }}
        />
      </label>
      <label className="field">
        <span>方向</span>
        <select
          value={direction}
          onChange={(event) => {
            onDirectionChange(
              event.currentTarget.value as NewRelationDirection,
            );
          }}
        >
          <option value="symmetric">双向</option>
          <option value="center_to_related">中心指向目标</option>
          <option value="related_to_center">目标指向中心</option>
        </select>
      </label>
      <button
        className="primary-action"
        type="button"
        disabled={writing || targetEntryId === '' || label.trim() === ''}
        onClick={onCreate}
      >
        创建关系
      </button>
    </section>
  );
}

function canonicalDirection(
  centerEntryId: string,
  relatedEntryId: string,
  direction: NewRelationDirection,
): InformationEntryGraphDirection {
  if (direction === 'symmetric') return direction;
  const centerIsLow = centerEntryId < relatedEntryId;
  if (direction === 'center_to_related') {
    return centerIsLow ? 'low_to_high' : 'high_to_low';
  }
  return centerIsLow ? 'high_to_low' : 'low_to_high';
}

function HiddenRelations({
  centerEntryId,
  edges,
  nodesById,
  onRestore,
  writing,
}: {
  readonly centerEntryId: string;
  readonly edges: readonly Readonly<InformationEntryGraphEdge>[];
  readonly nodesById: ReadonlyMap<string, Readonly<InformationEntry>>;
  readonly onRestore: (edge: Readonly<InformationEntryGraphEdge>) => void;
  readonly writing: boolean;
}) {
  return (
    <details className="knowledge-hidden-relations">
      <summary>隐藏关系（{edges.length.toString()}）</summary>
      <ul>
        {edges.map((edge) => {
          const related = nodesById.get(otherEndpoint(edge, centerEntryId));
          return (
            <li key={edgeKey(edge)}>
              <span>
                {related === undefined ? edge.label : entryTitle(related)}
              </span>
              <button
                className="text-action"
                type="button"
                disabled={writing}
                onClick={() => {
                  onRestore(edge);
                }}
              >
                恢复
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function directionOptions(
  centerEntryId: string,
  edge: Readonly<InformationEntryGraphEdge>,
): readonly Readonly<{value: InformationEntryGraphDirection; label: string}>[] {
  const centerIsLow = centerEntryId === edge.entryLowId;
  return [
    {value: 'symmetric', label: '双向'},
    {
      value: centerIsLow ? 'low_to_high' : 'high_to_low',
      label: '中心指向相关条目',
    },
    {
      value: centerIsLow ? 'high_to_low' : 'low_to_high',
      label: '相关条目指向中心',
    },
  ];
}

function directionLabel(
  edge: Readonly<InformationEntryGraphEdge>,
  centerEntryId: string,
): string {
  if (edge.direction === 'symmetric') return '双向';
  const centerIsLow = centerEntryId === edge.entryLowId;
  return (edge.direction === 'low_to_high') === centerIsLow
    ? '中心指向相关条目'
    : '相关条目指向中心';
}

function directionGlyph(
  edge: Readonly<InformationEntryGraphEdge>,
  centerEntryId: string,
): string {
  const label = directionLabel(edge, centerEntryId);
  return label === '双向' ? '↔' : label.startsWith('中心') ? '→' : '←';
}

function radialGraphPoint(index: number, total: number): KnowledgeGraphPoint {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(total, 1);
  return {
    x: KNOWLEDGE_GRAPH_CENTER.x + Math.cos(angle) * 400,
    y: KNOWLEDGE_GRAPH_CENTER.y + Math.sin(angle) * 250,
  };
}

function radialGraphLine(endPoint: KnowledgeGraphPoint): KnowledgeGraphLine {
  const deltaX = endPoint.x - KNOWLEDGE_GRAPH_CENTER.x;
  const deltaY = endPoint.y - KNOWLEDGE_GRAPH_CENTER.y;
  const distance = Math.hypot(deltaX, deltaY);
  const unitX = deltaX / distance;
  const unitY = deltaY / distance;
  const centerClearance = rectangleRayDistance(unitX, unitY, 150, 76) + 8;
  const relatedClearance = rectangleRayDistance(unitX, unitY, 105, 54) + 8;
  return {
    start: {
      x: KNOWLEDGE_GRAPH_CENTER.x + unitX * centerClearance,
      y: KNOWLEDGE_GRAPH_CENTER.y + unitY * centerClearance,
    },
    end: {
      x: endPoint.x - unitX * relatedClearance,
      y: endPoint.y - unitY * relatedClearance,
    },
  };
}

function rectangleRayDistance(
  unitX: number,
  unitY: number,
  halfWidth: number,
  halfHeight: number,
): number {
  const horizontal =
    Math.abs(unitX) < 0.001 ? Infinity : halfWidth / Math.abs(unitX);
  const vertical =
    Math.abs(unitY) < 0.001 ? Infinity : halfHeight / Math.abs(unitY);
  return Math.min(horizontal, vertical);
}

function graphNodeStyle(point: KnowledgeGraphPoint): KnowledgeGraphNodeStyle {
  return {
    '--knowledge-node-x': `${((point.x / KNOWLEDGE_GRAPH_WIDTH) * 100).toFixed(3)}%`,
    '--knowledge-node-y': `${((point.y / KNOWLEDGE_GRAPH_HEIGHT) * 100).toFixed(3)}%`,
  };
}

function graphTooltipStyle(
  point: KnowledgeGraphPoint,
): KnowledgeGraphTooltipStyle {
  const midpoint = {
    x: (point.x + KNOWLEDGE_GRAPH_CENTER.x) / 2,
    y: (point.y + KNOWLEDGE_GRAPH_CENTER.y) / 2,
  };
  return {
    '--knowledge-tooltip-x': `${((midpoint.x / KNOWLEDGE_GRAPH_WIDTH) * 100).toFixed(3)}%`,
    '--knowledge-tooltip-y': `${((midpoint.y / KNOWLEDGE_GRAPH_HEIGHT) * 100).toFixed(3)}%`,
  };
}

function graphEdgeMarkers(
  edge: Readonly<InformationEntryGraphEdge>,
  centerEntryId: string,
): Readonly<{start?: string; end?: string}> {
  const marker = 'url(#knowledge-arrow)';
  if (edge.direction === 'symmetric') return {start: marker, end: marker};
  return directionLabel(edge, centerEntryId).startsWith('中心')
    ? {end: marker}
    : {start: marker};
}

function selectGraphEdgeFromKeyboard(
  event: KeyboardEvent<SVGGElement>,
  select: () => void,
) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  select();
}

function describeGraphEdge(edge: Readonly<InformationEntryGraphEdge>): string {
  const note = edge.note.trim();
  const projection = edge.projection;
  const basis = projection?.candidateBasis.map(associationBasisLabel) ?? [];
  const calculatedReason =
    projection === undefined
      ? ''
      : `系统根据${basis.length === 0 ? '条目相似度' : basis.join('、')}计算；内容 ${score(projection.contentSimilarity)}、类型 ${score(projection.typeSimilarity)}、领域 ${score(projection.domainSimilarity)}`;

  if (note !== '' && calculatedReason !== '') {
    return `${note}；${calculatedReason}`;
  }
  if (note !== '') return note;
  if (calculatedReason !== '') return calculatedReason;
  if (edge.origin === 'ai_assisted') return 'AI 提议后由用户保存';
  if (edge.origin === 'user_created') return '由用户创建，未填写补充说明';
  if (edge.origin === 'user_edited') return '由用户调整，未填写补充说明';
  return '根据条目相似度自动建立';
}

function associationBasisLabel(
  basis: NonNullable<
    InformationEntryGraphEdge['projection']
  >['candidateBasis'][number],
): string {
  if (basis === 'content_keyword') return '共同内容关键词';
  if (basis === 'text_term') return '相近正文或标题';
  if (basis === 'type_keyword') return '相同类型';
  return '相近领域';
}

function originLabel(origin: InformationEntryGraphEdge['origin']): string {
  if (origin === 'user_created') return '用户创建';
  if (origin === 'user_edited') return '用户编辑';
  if (origin === 'ai_assisted') return 'AI 辅助';
  return '自动计算';
}

function displayEdgeLabel(edge: Readonly<InformationEntryGraphEdge>): string {
  const builtInLabel = SEMANTIC_KIND_OPTIONS.find(
    (option) => option.value === edge.label,
  )?.label;
  return builtInLabel ?? edge.label;
}

function semanticKindLabel(kind: InformationEntryGraphSemanticKind): string {
  return (
    SEMANTIC_KIND_OPTIONS.find((option) => option.value === kind)?.label ??
    '自定义'
  );
}

function verificationLabel(
  status: InformationEntryGraphEdge['verificationStatus'],
): string {
  if (status === 'calculated') return '计算所得';
  if (status === 'source_checked') return '已核对来源';
  if (status === 'needs_review') return '需要复核';
  return '尚未核对';
}

function otherEndpoint(
  edge: Readonly<InformationEntryGraphEdge>,
  centerEntryId: string,
): string {
  return edge.entryLowId === centerEntryId ? edge.entryHighId : edge.entryLowId;
}

function edgeKey(edge: Readonly<InformationEntryGraphEdge>): string {
  return `${edge.entryLowId}:${edge.entryHighId}`;
}

function entryTitle(entry: Readonly<InformationEntry>): string {
  return entry.value.titlePath.trim() || '未命名条目';
}

function entrySummary(entry: Readonly<InformationEntry>): string {
  const body = entry.value.body.replace(/\s+/gu, ' ').trim();
  return body.length > 96 ? `${body.slice(0, 96)}…` : body;
}

function score(value: number): string {
  return formatBasisPointPercentage(value);
}
