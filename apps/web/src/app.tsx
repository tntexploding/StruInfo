import {useCallback, useEffect, useRef, useState} from 'react';

import type {
  AiAssociationProposalDecisionResponse,
  AiAssociationProposalListResponse,
  AiAssociationProposalStartResponse,
  AiSplitProposalDecisionResponse,
  AiSplitProposalListResponse,
  AiSplitProposalStartResponse,
  AiTagProposalDecisionResponse,
  AiTagProposalListResponse,
  AiTagProposalStartResponse,
  EvidenceSnapshotSummary,
  InformationEntryAssociationListResponse,
  InformationEntryAssociationOverrideResponse,
  InformationEntryAssociationPolicyWriteResponse,
  InformationEntryAssociationRebuildResponse,
  InformationEntryExplorationPolicyWriteResponse,
  InformationEntryExplorationResponse,
  InformationEntryKnowledgeGraphEdgeWriteResponse,
  InformationEntryKnowledgeGraphResponse,
  InformationEntryMaterializeResponse,
  InformationEntryDocumentListResponse,
  InformationEntryPreferenceProfileResponse,
  InformationEntryPreferenceSuggestionResponse,
  InformationEntryPreferenceTrialResponse,
  InformationEntryRevisionResponse,
  InformationEntryRestructureApplyResponse,
  InformationEntryRestructurePreviewResponse,
  InformationEntrySearchResponse,
  InformationEntryQuerySynthesisResponse,
  InformationDocumentTagWriteResponse,
  InformationDocumentWorkingCopyCommitResponse,
  InformationDocumentWorkingCopyResponse,
  M1cHttpResponse,
  ProcessingRunCancelResponse,
  ProcessingRunListResponse,
  DocumentImportResponse,
  EntryPreferenceProfile,
  EntryPreferenceRule,
  EntrySplitRuleApplyResponse,
  EntrySplitRuleProfileResponse,
  EntrySplitRuleProfileWriteResponse,
  EntrySplitRuleTrialResponse,
  ReviewPreferencesResponse,
  ReviewPreferencesWrite,
  SourceSubscriptionListResponse,
  SourceSubscriptionReplaceResponse,
  SourceSubscriptionRunResponse,
  SourceSubscriptionWrite,
  WorkspaceResponse,
  WorkspaceBundleTransferResponse,
} from './api/m1c_api_contract.js';
import type {M1cApiClient} from './api/m1c_api_client.js';
import {EvidenceRail} from './components/evidence_rail.js';
import {ProductAppShell} from './components/product_app_shell.js';
import type {
  ActionFeedback,
  EvidencePanelState,
  Loadable,
  ProductSection,
  WorkspaceTransferFeedback,
} from './components/product_types.js';
import type {HealthClient} from './health/health_client.js';
import type {HealthTransportMode} from './health/health_runtime.js';
import {useOperationalHealth} from './health/use_operational_health.js';
import {MaterialsWorkspace} from './workspaces/materials_workspace.js';
import {InformationEntryAssociationsWorkspace} from './workspaces/information_entry_associations_workspace.js';
import {InformationEntryQueryWorkspace} from './workspaces/information_entry_query_workspace.js';
import {InformationEntrySplitWorkspace} from './workspaces/information_entry_split_workspace.js';
import {InformationEntryTagsWorkspace} from './workspaces/information_entry_tags_workspace.js';
import {WorkflowOverview} from './workspaces/workflow_overview.js';
import {FormalKnowledgeWorkspace} from './workspaces/formal_knowledge_workspace.js';

export interface AppProps {
  readonly apiClient: M1cApiClient;
  readonly healthClient: HealthClient;
  readonly transportMode: HealthTransportMode;
}

export function App({apiClient, healthClient, transportMode}: AppProps) {
  const health = useOperationalHealth(healthClient);
  const [activeSection, setActiveSection] =
    useState<ProductSection>('overview');
  const [workspace, setWorkspace] = useState<
    Loadable<Readonly<WorkspaceResponse>>
  >({status: 'loading'});
  const [snapshots, setSnapshots] = useState<
    Loadable<readonly Readonly<EvidenceSnapshotSummary>[]>
  >({status: 'loading'});
  const [reviewPreferences, setReviewPreferences] = useState<
    Loadable<Readonly<ReviewPreferencesResponse>>
  >({status: 'loading'});
  const [reviewPreferencesOverride, setReviewPreferencesOverride] = useState<
    Readonly<ReviewPreferencesWrite> | undefined
  >();
  const [entryPreferenceProfile, setEntryPreferenceProfile] = useState<
    Loadable<Readonly<InformationEntryPreferenceProfileResponse>>
  >({status: 'loading'});
  const reviewPreferencesRequestId = useRef(0);
  const entryPreferenceProfileRequestId = useRef(0);
  const [evidencePanel, setEvidencePanel] = useState<EvidencePanelState>({
    status: 'closed',
  });
  const [selectedEvidence, setSelectedEvidence] =
    useState<
      Readonly<Extract<EvidencePanelState, {status: 'ready'}>['snapshot']>
    >();
  const evidenceReturnTarget = useRef<HTMLElement | undefined>(undefined);

  const refreshWorkspace = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await apiClient.workspace(
          signal === undefined ? undefined : {signal},
        );
        if (!signal?.aborted) {
          setWorkspace({status: 'ready', value: response.body});
        }
      } catch {
        if (!signal?.aborted) {
          setWorkspace({
            status: 'error',
            message: '无法读取当前工作区。请确认本机 API 配置与运行状态。',
          });
        }
      }
    },
    [apiClient],
  );

  const refreshEvidence = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await apiClient.listEvidence(
          signal === undefined ? undefined : {signal},
        );
        if (signal?.aborted) return;
        setSnapshots(
          response.body.snapshots.length === 0
            ? {status: 'empty'}
            : {status: 'ready', value: response.body.snapshots},
        );
      } catch {
        if (!signal?.aborted) {
          setSnapshots({
            status: 'error',
            message: '数据库或材料读模型当前不可用；已保存数据没有被修改。',
          });
        }
      }
    },
    [apiClient],
  );

  const refreshReviewPreferences = useCallback(
    async (signal?: AbortSignal) => {
      const requestId = ++reviewPreferencesRequestId.current;
      try {
        const response = await apiClient.loadReviewPreferences(
          signal === undefined ? undefined : {signal},
        );
        if (
          !signal?.aborted &&
          requestId === reviewPreferencesRequestId.current
        ) {
          setReviewPreferences({status: 'ready', value: response.body});
        }
      } catch {
        if (
          !signal?.aborted &&
          requestId === reviewPreferencesRequestId.current
        ) {
          setReviewPreferences({
            status: 'error',
            message: '无法读取外部个人标签设置；Entry 数据仍可继续查看。',
          });
        }
      }
    },
    [apiClient],
  );

  const saveReviewPreferences = useCallback(
    async (value: Readonly<ReviewPreferencesWrite>) => {
      const requestId = ++reviewPreferencesRequestId.current;
      const response = await apiClient.saveReviewPreferences(value);
      if (requestId === reviewPreferencesRequestId.current) {
        setReviewPreferences({status: 'ready', value: response.body});
      }
      return response;
    },
    [apiClient],
  );

  const refreshEntryPreferenceProfile = useCallback(
    async (signal?: AbortSignal) => {
      const requestId = ++entryPreferenceProfileRequestId.current;
      try {
        const response = await apiClient.loadInformationEntryPreferenceProfile(
          signal === undefined ? undefined : {signal},
        );
        if (
          !signal?.aborted &&
          requestId === entryPreferenceProfileRequestId.current
        ) {
          setEntryPreferenceProfile({status: 'ready', value: response.body});
        }
      } catch {
        if (
          !signal?.aborted &&
          requestId === entryPreferenceProfileRequestId.current
        ) {
          setEntryPreferenceProfile({
            status: 'error',
            message: '无法读取外部偏好规则；逐条评分和标签编辑仍可继续使用。',
          });
        }
      }
    },
    [apiClient],
  );

  const saveEntryPreferenceProfile = useCallback(
    async (
      body: Readonly<{
        expectedRevision: number;
        enabled: boolean;
        rules: readonly Readonly<EntryPreferenceRule>[];
      }>,
    ) => {
      const requestId = ++entryPreferenceProfileRequestId.current;
      const response =
        await apiClient.saveInformationEntryPreferenceProfile(body);
      if (
        requestId === entryPreferenceProfileRequestId.current &&
        (response.body.status === 'applied' ||
          response.body.status === 'unchanged')
      ) {
        setEntryPreferenceProfile({
          status: 'ready',
          value: {status: 'ok', profile: response.body.profile},
        });
      }
      return response;
    },
    [apiClient],
  );

  const suggestEntryPreferenceProfile = useCallback(
    (
      includePrivate: boolean,
    ): Promise<M1cHttpResponse<InformationEntryPreferenceSuggestionResponse>> =>
      apiClient.suggestInformationEntryPreferenceProfile(includePrivate),
    [apiClient],
  );

  const trialEntryPreferenceProfile = useCallback(
    (
      body: Readonly<{
        includePrivate: boolean;
        expectedProfileRevision: number;
        profile: Readonly<EntryPreferenceProfile>;
      }>,
    ): Promise<M1cHttpResponse<InformationEntryPreferenceTrialResponse>> =>
      apiClient.trialInformationEntryPreferenceProfile(body),
    [apiClient],
  );

  const loadEntryAutomationPolicy = useCallback(
    () => apiClient.loadInformationEntryAutomationPolicy(),
    [apiClient],
  );

  const saveEntryAutomationPolicy = useCallback(
    (
      body: Parameters<M1cApiClient['saveInformationEntryAutomationPolicy']>[0],
    ) => apiClient.saveInformationEntryAutomationPolicy(body),
    [apiClient],
  );

  const trialEntryAutomationPolicy = useCallback(
    (
      body: Parameters<
        M1cApiClient['trialInformationEntryAutomationPolicy']
      >[0],
    ) => apiClient.trialInformationEntryAutomationPolicy(body),
    [apiClient],
  );

  const executeEntryAutomation = useCallback(
    (body: Parameters<M1cApiClient['executeInformationEntryAutomation']>[0]) =>
      apiClient.executeInformationEntryAutomation(body),
    [apiClient],
  );

  const listEntryAutomationExecutions = useCallback(
    (limit?: number) =>
      apiClient.listInformationEntryAutomationExecutions(limit),
    [apiClient],
  );

  const loadEntryAutomationExecution = useCallback(
    (runId: string) => apiClient.loadInformationEntryAutomationExecution(runId),
    [apiClient],
  );

  const listEntryAutomationWorkQueue = useCallback(
    (includePrivate: boolean) =>
      apiClient.listInformationEntryAutomationWorkQueue(includePrivate),
    [apiClient],
  );

  const updateEntryAutomationWorkItem = useCallback(
    (
      runId: string,
      claimOrdinal: number,
      body: Parameters<
        M1cApiClient['updateInformationEntryAutomationWorkItem']
      >[2],
    ) =>
      apiClient.updateInformationEntryAutomationWorkItem(
        runId,
        claimOrdinal,
        body,
      ),
    [apiClient],
  );

  const executeEntryAutomationWorkItemAction = useCallback(
    (
      runId: string,
      claimOrdinal: number,
      body: Parameters<
        M1cApiClient['executeInformationEntryAutomationWorkItemAction']
      >[2],
    ) =>
      apiClient.executeInformationEntryAutomationWorkItemAction(
        runId,
        claimOrdinal,
        body,
      ),
    [apiClient],
  );

  useEffect(() => {
    const controller = new AbortController();
    globalThis.queueMicrotask(() => {
      void refreshWorkspace(controller.signal);
      void refreshEvidence(controller.signal);
      void refreshReviewPreferences(controller.signal);
      void refreshEntryPreferenceProfile(controller.signal);
    });
    return () => {
      controller.abort();
    };
  }, [
    refreshEntryPreferenceProfile,
    refreshEvidence,
    refreshReviewPreferences,
    refreshWorkspace,
  ]);

  const openEvidence = useCallback(
    async (
      snapshotId: string,
      returnFocus?: HTMLElement,
      selectedFragmentId?: string,
      includePrivate = false,
    ) => {
      if (returnFocus !== undefined) evidenceReturnTarget.current = returnFocus;
      setEvidencePanel({
        status: 'loading',
        snapshotId,
        selectedFragmentId,
        includePrivate,
      });
      try {
        const response = await apiClient.loadEvidenceSnapshot(snapshotId, {
          includePrivate,
        });
        if (response.body.status === 'ok') {
          setSelectedEvidence(response.body.snapshot);
          setEvidencePanel({
            status: 'ready',
            snapshot: response.body.snapshot,
            selectedFragmentId,
          });
          return;
        }
        setEvidencePanel({
          status: 'error',
          snapshotId,
          selectedFragmentId,
          includePrivate,
          message: '该 Snapshot 不存在于当前工作区，或已切换到其他外部资料集。',
        });
      } catch {
        setEvidencePanel({
          status: 'error',
          snapshotId,
          selectedFragmentId,
          includePrivate,
          message: 'Blob 或数据库当前不可用；没有修改任何材料。',
        });
      }
    },
    [apiClient],
  );

  const materializeInformationEntries = useCallback(
    (
      body: unknown,
    ): Promise<M1cHttpResponse<InformationEntryMaterializeResponse>> =>
      apiClient.materializeInformationEntries(body),
    [apiClient],
  );

  const loadInformationDocumentWorkingCopy = useCallback(
    (
      snapshotId: string,
      includePrivate: boolean,
    ): Promise<M1cHttpResponse<InformationDocumentWorkingCopyResponse>> =>
      apiClient.loadInformationDocumentWorkingCopy(snapshotId, {
        includePrivate,
      }),
    [apiClient],
  );

  const saveInformationDocumentWorkingCopy = useCallback(
    (
      snapshotId: string,
      body: Readonly<{
        expectedRevision: number;
        includePrivate: boolean;
        text: string;
      }>,
    ): Promise<M1cHttpResponse<InformationDocumentWorkingCopyResponse>> =>
      apiClient.saveInformationDocumentWorkingCopy(snapshotId, body),
    [apiClient],
  );

  const restoreInformationDocumentWorkingCopy = useCallback(
    (
      snapshotId: string,
      body: Readonly<{expectedRevision: number; includePrivate: boolean}>,
    ): Promise<M1cHttpResponse<InformationDocumentWorkingCopyResponse>> =>
      apiClient.restoreInformationDocumentWorkingCopy(snapshotId, body),
    [apiClient],
  );

  const commitInformationDocumentWorkingCopy = useCallback(
    (
      snapshotId: string,
      body: Readonly<{expectedRevision: number; includePrivate: boolean}>,
    ): Promise<M1cHttpResponse<InformationDocumentWorkingCopyCommitResponse>> =>
      apiClient.commitInformationDocumentWorkingCopy(snapshotId, body),
    [apiClient],
  );

  const materializeManualInformationEntries = useCallback(
    (
      body: unknown,
    ): Promise<M1cHttpResponse<InformationEntryMaterializeResponse>> =>
      apiClient.materializeManualInformationEntries(body),
    [apiClient],
  );
  const loadInformationEntrySplitRuleProfile = useCallback(
    (): Promise<M1cHttpResponse<EntrySplitRuleProfileResponse>> =>
      apiClient.loadInformationEntrySplitRuleProfile(),
    [apiClient],
  );
  const saveInformationEntrySplitRuleProfile = useCallback(
    (
      body: unknown,
    ): Promise<M1cHttpResponse<EntrySplitRuleProfileWriteResponse>> =>
      apiClient.saveInformationEntrySplitRuleProfile(body),
    [apiClient],
  );
  const trialInformationEntrySplitRule = useCallback(
    (body: unknown): Promise<M1cHttpResponse<EntrySplitRuleTrialResponse>> =>
      apiClient.trialInformationEntrySplitRule(body),
    [apiClient],
  );
  const applyInformationEntrySplitRule = useCallback(
    (body: unknown): Promise<M1cHttpResponse<EntrySplitRuleApplyResponse>> =>
      apiClient.applyInformationEntrySplitRule(body),
    [apiClient],
  );
  const previewInformationEntryRestructure = useCallback(
    (
      body: unknown,
    ): Promise<M1cHttpResponse<InformationEntryRestructurePreviewResponse>> =>
      apiClient.previewInformationEntryRestructure(body),
    [apiClient],
  );
  const applyInformationEntryRestructure = useCallback(
    (
      body: unknown,
    ): Promise<M1cHttpResponse<InformationEntryRestructureApplyResponse>> =>
      apiClient.applyInformationEntryRestructure(body),
    [apiClient],
  );
  const reviseInformationEntry = useCallback(
    (
      entryId: string,
      body: unknown,
    ): Promise<M1cHttpResponse<InformationEntryRevisionResponse>> =>
      apiClient.reviseInformationEntry(entryId, body),
    [apiClient],
  );

  const searchInformationEntries = useCallback(
    (body: unknown): Promise<M1cHttpResponse<InformationEntrySearchResponse>> =>
      apiClient.searchInformationEntries(body),
    [apiClient],
  );

  const loadInformationEntrySearchIndex = useCallback(
    () => apiClient.loadInformationEntrySearchIndex(),
    [apiClient],
  );

  const rebuildInformationEntrySearchIndex = useCallback(
    () => apiClient.rebuildInformationEntrySearchIndex(),
    [apiClient],
  );

  const exploreInformationEntries = useCallback(
    (
      body: unknown,
    ): Promise<M1cHttpResponse<InformationEntryExplorationResponse>> =>
      apiClient.exploreInformationEntries(body),
    [apiClient],
  );

  const synthesizeInformationEntryQuery = useCallback(
    (
      body: unknown,
      signal: AbortSignal,
    ): Promise<M1cHttpResponse<InformationEntryQuerySynthesisResponse>> =>
      apiClient.synthesizeInformationEntryQuery(body, {signal}),
    [apiClient],
  );

  const readInformationEntryKnowledgeGraph = useCallback(
    (
      body: unknown,
    ): Promise<M1cHttpResponse<InformationEntryKnowledgeGraphResponse>> =>
      apiClient.readInformationEntryKnowledgeGraph(body),
    [apiClient],
  );

  const reviseInformationEntryKnowledgeGraphEdge = useCallback(
    (
      entryId: string,
      relatedEntryId: string,
      body: unknown,
    ): Promise<
      M1cHttpResponse<InformationEntryKnowledgeGraphEdgeWriteResponse>
    > =>
      apiClient.reviseInformationEntryKnowledgeGraphEdge(
        entryId,
        relatedEntryId,
        body,
      ),
    [apiClient],
  );

  const rebuildInformationEntryAssociations = useCallback(
    (
      body: unknown,
    ): Promise<M1cHttpResponse<InformationEntryAssociationRebuildResponse>> =>
      apiClient.rebuildInformationEntryAssociations(body),
    [apiClient],
  );

  const reviseInformationEntryAssociationPolicy = useCallback(
    (
      body: unknown,
    ): Promise<
      M1cHttpResponse<InformationEntryAssociationPolicyWriteResponse>
    > => apiClient.reviseInformationEntryAssociationPolicy(body),
    [apiClient],
  );

  const reviseInformationEntryExplorationPolicy = useCallback(
    async (
      body: unknown,
    ): Promise<
      M1cHttpResponse<InformationEntryExplorationPolicyWriteResponse>
    > => {
      const response =
        await apiClient.reviseInformationEntryExplorationPolicy(body);
      if (
        response.body.status === 'applied' ||
        response.body.status === 'unchanged'
      ) {
        await refreshReviewPreferences();
      }
      return response;
    },
    [apiClient, refreshReviewPreferences],
  );

  const listInformationEntryAssociations = useCallback(
    (
      entryId: string,
      includePrivate: boolean,
    ): Promise<M1cHttpResponse<InformationEntryAssociationListResponse>> =>
      apiClient.listInformationEntryAssociations(entryId, {includePrivate}),
    [apiClient],
  );

  const reviseInformationEntryAssociation = useCallback(
    (
      entryId: string,
      relatedEntryId: string,
      body: unknown,
    ): Promise<M1cHttpResponse<InformationEntryAssociationOverrideResponse>> =>
      apiClient.reviseInformationEntryAssociation(
        entryId,
        relatedEntryId,
        body,
      ),
    [apiClient],
  );

  const listInformationEntryDocuments = useCallback(
    (
      includePrivate: boolean,
    ): Promise<M1cHttpResponse<InformationEntryDocumentListResponse>> =>
      apiClient.listInformationEntryDocuments({includePrivate}),
    [apiClient],
  );

  const aggregateInformationDocumentTags = useCallback(
    (
      snapshotId: string,
      body: unknown,
    ): Promise<M1cHttpResponse<InformationDocumentTagWriteResponse>> =>
      apiClient.aggregateInformationDocumentTags(snapshotId, body),
    [apiClient],
  );

  const reviseInformationDocumentTags = useCallback(
    (
      snapshotId: string,
      body: unknown,
    ): Promise<M1cHttpResponse<InformationDocumentTagWriteResponse>> =>
      apiClient.reviseInformationDocumentTags(snapshotId, body),
    [apiClient],
  );

  const listAiSplitProposals = useCallback(
    (
      snapshotId: string,
    ): Promise<M1cHttpResponse<AiSplitProposalListResponse>> =>
      apiClient.listAiSplitProposals(snapshotId),
    [apiClient],
  );

  const startAiSplitProposal = useCallback(
    (
      snapshotId: string,
      requestKey: string,
    ): Promise<M1cHttpResponse<AiSplitProposalStartResponse>> =>
      apiClient.startAiSplitProposal(snapshotId, requestKey),
    [apiClient],
  );

  const acceptAiSplitProposal = useCallback(
    (
      snapshotId: string,
      proposalId: string,
    ): Promise<M1cHttpResponse<AiSplitProposalDecisionResponse>> =>
      apiClient.acceptAiSplitProposal(snapshotId, proposalId),
    [apiClient],
  );

  const rejectAiSplitProposal = useCallback(
    (
      snapshotId: string,
      proposalId: string,
    ): Promise<M1cHttpResponse<AiSplitProposalDecisionResponse>> =>
      apiClient.rejectAiSplitProposal(snapshotId, proposalId),
    [apiClient],
  );

  const loadEvidenceSnapshotForSplit = useCallback(
    (snapshotId: string, includePrivate = false) =>
      apiClient.loadEvidenceSnapshot(snapshotId, {includePrivate}),
    [apiClient],
  );

  const listAiTagProposals = useCallback(
    (entryId: string): Promise<M1cHttpResponse<AiTagProposalListResponse>> =>
      apiClient.listAiTagProposals(entryId),
    [apiClient],
  );

  const startAiTagProposal = useCallback(
    (
      entryId: string,
      requestKey: string,
    ): Promise<M1cHttpResponse<AiTagProposalStartResponse>> =>
      apiClient.startAiTagProposal(entryId, requestKey),
    [apiClient],
  );

  const acceptAiTagProposal = useCallback(
    (
      entryId: string,
      proposalId: string,
    ): Promise<M1cHttpResponse<AiTagProposalDecisionResponse>> =>
      apiClient.acceptAiTagProposal(entryId, proposalId),
    [apiClient],
  );

  const rejectAiTagProposal = useCallback(
    (
      entryId: string,
      proposalId: string,
    ): Promise<M1cHttpResponse<AiTagProposalDecisionResponse>> =>
      apiClient.rejectAiTagProposal(entryId, proposalId),
    [apiClient],
  );

  const listAiAssociationProposals = useCallback(
    (
      entryId: string,
      relatedEntryId: string,
    ): Promise<M1cHttpResponse<AiAssociationProposalListResponse>> =>
      apiClient.listAiAssociationProposals(entryId, relatedEntryId),
    [apiClient],
  );

  const startAiAssociationProposal = useCallback(
    (
      entryId: string,
      relatedEntryId: string,
      requestKey: string,
    ): Promise<M1cHttpResponse<AiAssociationProposalStartResponse>> =>
      apiClient.startAiAssociationProposal(entryId, relatedEntryId, requestKey),
    [apiClient],
  );

  const acceptAiAssociationProposal = useCallback(
    (
      entryId: string,
      relatedEntryId: string,
      proposalId: string,
    ): Promise<M1cHttpResponse<AiAssociationProposalDecisionResponse>> =>
      apiClient.acceptAiAssociationProposal(
        entryId,
        relatedEntryId,
        proposalId,
      ),
    [apiClient],
  );

  const rejectAiAssociationProposal = useCallback(
    (
      entryId: string,
      relatedEntryId: string,
      proposalId: string,
    ): Promise<M1cHttpResponse<AiAssociationProposalDecisionResponse>> =>
      apiClient.rejectAiAssociationProposal(
        entryId,
        relatedEntryId,
        proposalId,
      ),
    [apiClient],
  );
  const listProcessingRuns = useCallback(
    (limit: number): Promise<M1cHttpResponse<ProcessingRunListResponse>> =>
      apiClient.listProcessingRuns(limit),
    [apiClient],
  );

  const cancelProcessingRun = useCallback(
    (
      runId: string,
      expectedVersion: number,
    ): Promise<M1cHttpResponse<ProcessingRunCancelResponse>> =>
      apiClient.cancelProcessingRun(runId, expectedVersion),
    [apiClient],
  );

  const listSourceSubscriptions = useCallback(
    (): Promise<M1cHttpResponse<SourceSubscriptionListResponse>> =>
      apiClient.listSourceSubscriptions(),
    [apiClient],
  );

  const replaceSourceSubscriptions = useCallback(
    (
      expectedRevision: number,
      subscriptions: readonly Readonly<SourceSubscriptionWrite>[],
    ): Promise<M1cHttpResponse<SourceSubscriptionReplaceResponse>> =>
      apiClient.replaceSourceSubscriptions(expectedRevision, subscriptions),
    [apiClient],
  );

  const runSourceSubscription = useCallback(
    async (
      subscriptionId: string,
      requestKey: string,
    ): Promise<M1cHttpResponse<SourceSubscriptionRunResponse>> => {
      const response = await apiClient.runSourceSubscription(
        subscriptionId,
        requestKey,
      );
      if (response.body.status === 'imported') await refreshEvidence();
      return response;
    },
    [apiClient, refreshEvidence],
  );

  function closeEvidence() {
    setEvidencePanel({status: 'closed'});
    const target = evidenceReturnTarget.current;
    evidenceReturnTarget.current = undefined;
    globalThis.setTimeout(() => target?.focus(), 0);
  }

  function selectEvidenceFragment(fragmentId: string) {
    setEvidencePanel((current) =>
      current.status === 'ready'
        ? {...current, selectedFragmentId: fragmentId}
        : current,
    );
  }

  async function importDocument(
    body: unknown,
    options: Readonly<{
      openEvidence?: boolean;
      refreshEvidence?: boolean;
    }> = {},
  ): Promise<ActionFeedback> {
    try {
      const response = await apiClient.importDocument(body);
      const opensEvidence = options.openEvidence !== false;
      const feedback = importFeedback(response.body, opensEvidence);
      if (
        response.body.status === 'created' ||
        response.body.status === 'existing'
      ) {
        if (options.refreshEvidence !== false) await refreshEvidence();
        if (opensEvidence) {
          await openEvidence(
            response.body.snapshotId,
            undefined,
            undefined,
            response.body.isPrivate === true,
          );
        }
      }
      return feedback;
    } catch {
      return connectionFeedback(
        '材料没有写入；可以在服务恢复后使用同一表单重试。',
      );
    }
  }

  async function exportWorkspaceBundle(): Promise<WorkspaceTransferFeedback> {
    try {
      const response = await apiClient.exportWorkspaceBundle();
      return workspaceTransferFeedback(response.body, 'exported');
    } catch {
      return connectionFeedback(
        '个人数据包没有生成；数据库、原始文件和个人配置均未被修改。',
      );
    }
  }

  async function restoreWorkspaceBundle(
    fileName: string,
  ): Promise<WorkspaceTransferFeedback> {
    try {
      const response = await apiClient.restoreWorkspaceBundle(fileName);
      const feedback = workspaceTransferFeedback(response.body, 'restored');
      if (feedback.kind === 'success') {
        setEvidencePanel({status: 'closed'});
        setSelectedEvidence(undefined);
        await refreshEvidence();
        await refreshReviewPreferences();
      }
      return feedback;
    } catch {
      return connectionFeedback(
        '个人数据恢复没有执行；当前工作区内容保持不变。',
      );
    }
  }

  const snapshotValues = snapshots.status === 'ready' ? snapshots.value : [];
  return (
    <ProductAppShell
      activeSection={activeSection}
      health={health.state}
      transportMode={transportMode}
      workspace={workspace.status === 'ready' ? workspace.value : undefined}
      onNavigate={setActiveSection}
      evidencePanel={
        <EvidenceRail
          state={evidencePanel}
          onClose={closeEvidence}
          onRetry={(snapshotId) => {
            const selectedFragmentId =
              evidencePanel.status === 'error'
                ? evidencePanel.selectedFragmentId
                : undefined;
            const includePrivate =
              evidencePanel.status === 'error'
                ? evidencePanel.includePrivate
                : false;
            void openEvidence(
              snapshotId,
              undefined,
              selectedFragmentId,
              includePrivate,
            );
          }}
          onSelectFragment={selectEvidenceFragment}
        />
      }
    >
      <RuntimeNotice
        health={health.state}
        workspace={workspace}
        onRetry={() => {
          health.retry();
          void refreshWorkspace();
          void refreshEvidence();
          void refreshReviewPreferences();
        }}
      />
      {activeSection === 'overview' ? (
        <WorkflowOverview
          snapshots={snapshots}
          workspace={workspace.status === 'ready' ? workspace.value : undefined}
          onListDocuments={listInformationEntryDocuments}
          onListProcessingRuns={listProcessingRuns}
          onCancelProcessingRun={cancelProcessingRun}
          onNavigate={setActiveSection}
        />
      ) : null}
      {activeSection === 'import' ? (
        <MaterialsWorkspace
          snapshots={snapshots}
          selectedSnapshotId={selectedEvidence?.snapshotId}
          onImport={importDocument}
          onImportBatchItem={(body) =>
            importDocument(body, {
              openEvidence: false,
              refreshEvidence: false,
            })
          }
          onImportBatchCompleted={refreshEvidence}
          onOpenEvidence={(snapshotId, target, includePrivate) =>
            void openEvidence(snapshotId, target, undefined, includePrivate)
          }
          onRefresh={() => void refreshEvidence()}
          onExport={exportWorkspaceBundle}
          onRestore={restoreWorkspaceBundle}
          sourceSubscriptionsEnabled={
            workspace.status === 'ready' &&
            workspace.value.capabilities.includes('source_subscriptions')
          }
          onListSourceSubscriptions={listSourceSubscriptions}
          onReplaceSourceSubscriptions={replaceSourceSubscriptions}
          onRunSourceSubscription={runSourceSubscription}
        />
      ) : null}
      {activeSection === 'split' ? (
        <InformationEntrySplitWorkspace
          aiEnabled={
            workspace.status === 'ready' &&
            workspace.value.capabilities.includes('ai_split')
          }
          onAcceptAiSplitProposal={acceptAiSplitProposal}
          onListAiSplitProposals={listAiSplitProposals}
          onListDocuments={listInformationEntryDocuments}
          onLoadEvidenceSnapshot={loadEvidenceSnapshotForSplit}
          onLoadDocumentWorkingCopy={loadInformationDocumentWorkingCopy}
          onSaveDocumentWorkingCopy={saveInformationDocumentWorkingCopy}
          onRestoreDocumentWorkingCopy={restoreInformationDocumentWorkingCopy}
          onCommitDocumentWorkingCopy={commitInformationDocumentWorkingCopy}
          onMaterialize={materializeInformationEntries}
          onMaterializeManual={materializeManualInformationEntries}
          onLoadSplitRuleProfile={loadInformationEntrySplitRuleProfile}
          onSaveSplitRuleProfile={saveInformationEntrySplitRuleProfile}
          onTrialSplitRule={trialInformationEntrySplitRule}
          onApplySplitRule={applyInformationEntrySplitRule}
          onPreviewRestructure={previewInformationEntryRestructure}
          onApplyRestructure={applyInformationEntryRestructure}
          onRejectAiSplitProposal={rejectAiSplitProposal}
          onSearch={searchInformationEntries}
          onStartAiSplitProposal={startAiSplitProposal}
          onOpenEvidence={(snapshotId, fragmentId, includePrivate) =>
            void openEvidence(snapshotId, undefined, fragmentId, includePrivate)
          }
        />
      ) : null}
      {activeSection === 'tags' ? (
        <InformationEntryTagsWorkspace
          aiEnabled={
            workspace.status === 'ready' &&
            workspace.value.capabilities.includes('ai_tags')
          }
          automationEnabled={
            workspace.status === 'ready' &&
            workspace.value.capabilities.includes('entry_automation')
          }
          reviewPreferences={reviewPreferences}
          reviewPreferencesOverride={reviewPreferencesOverride}
          onReviewPreferencesChange={setReviewPreferencesOverride}
          onAcceptAiTagProposal={acceptAiTagProposal}
          onAggregateDocumentTags={aggregateInformationDocumentTags}
          onListAiTagProposals={listAiTagProposals}
          onListDocuments={listInformationEntryDocuments}
          onListEntryAutomationExecutions={listEntryAutomationExecutions}
          onLoadEntryAutomationExecution={loadEntryAutomationExecution}
          onLoadEntryAutomationPolicy={loadEntryAutomationPolicy}
          onListEntryAutomationWorkQueue={listEntryAutomationWorkQueue}
          onUpdateEntryAutomationWorkItem={updateEntryAutomationWorkItem}
          onExecuteEntryAutomationWorkItemAction={
            executeEntryAutomationWorkItemAction
          }
          onRejectAiTagProposal={rejectAiTagProposal}
          onRevise={reviseInformationEntry}
          onReviseDocumentTags={reviseInformationDocumentTags}
          onSaveEntryAutomationPolicy={saveEntryAutomationPolicy}
          onSaveReviewPreferences={saveReviewPreferences}
          entryPreferenceProfile={entryPreferenceProfile}
          onReloadEntryPreferenceProfile={() => {
            void refreshEntryPreferenceProfile();
          }}
          onSaveEntryPreferenceProfile={saveEntryPreferenceProfile}
          onSuggestEntryPreferenceProfile={suggestEntryPreferenceProfile}
          onTrialEntryPreferenceProfile={trialEntryPreferenceProfile}
          onTrialEntryAutomationPolicy={trialEntryAutomationPolicy}
          onExecuteEntryAutomation={executeEntryAutomation}
          onSearch={searchInformationEntries}
          onStartAiTagProposal={startAiTagProposal}
          onOpenEvidence={(snapshotId, fragmentId, includePrivate) =>
            void openEvidence(snapshotId, undefined, fragmentId, includePrivate)
          }
        />
      ) : null}
      {activeSection === 'associations' ? (
        <InformationEntryAssociationsWorkspace
          aiEnabled={
            workspace.status === 'ready' &&
            workspace.value.capabilities.includes('ai')
          }
          onListAssociations={listInformationEntryAssociations}
          onRebuildAssociations={rebuildInformationEntryAssociations}
          onReviseAssociationPolicy={reviseInformationEntryAssociationPolicy}
          onReviseAssociation={reviseInformationEntryAssociation}
          onSearch={searchInformationEntries}
          onOpenEvidence={(snapshotId, fragmentId, includePrivate) =>
            void openEvidence(snapshotId, undefined, fragmentId, includePrivate)
          }
        />
      ) : null}
      {activeSection === 'query' ? (
        <InformationEntryQueryWorkspace
          aiQuerySynthesisEnabled={
            workspace.status === 'ready' &&
            workspace.value.capabilities.includes('ai_query_synthesis')
          }
          semanticSearchEnabled={
            workspace.status === 'ready' &&
            workspace.value.capabilities.includes('semantic_entry_search')
          }
          snapshots={snapshotValues}
          reviewPreferences={reviewPreferences}
          onExplore={exploreInformationEntries}
          onLoadSearchIndex={loadInformationEntrySearchIndex}
          onReviseExplorationPolicy={reviseInformationEntryExplorationPolicy}
          onSearch={searchInformationEntries}
          onRebuildSearchIndex={rebuildInformationEntrySearchIndex}
          onSynthesize={synthesizeInformationEntryQuery}
          onOpenEvidence={(snapshotId, fragmentId, includePrivate) =>
            void openEvidence(snapshotId, undefined, fragmentId, includePrivate)
          }
        />
      ) : null}
      {activeSection === 'knowledge' ? (
        <FormalKnowledgeWorkspace
          aiAssociationEnabled={
            workspace.status === 'ready' &&
            workspace.value.capabilities.includes('ai_associations')
          }
          onAcceptAiAssociationProposal={acceptAiAssociationProposal}
          onListAiAssociationProposals={listAiAssociationProposals}
          onReadGraph={readInformationEntryKnowledgeGraph}
          onRejectAiAssociationProposal={rejectAiAssociationProposal}
          onReviseEdge={reviseInformationEntryKnowledgeGraphEdge}
          onStartAiAssociationProposal={startAiAssociationProposal}
          onOpenEvidence={(snapshotId, fragmentId, includePrivate) =>
            void openEvidence(snapshotId, undefined, fragmentId, includePrivate)
          }
        />
      ) : null}
    </ProductAppShell>
  );
}

function RuntimeNotice({
  health,
  onRetry,
  workspace,
}: {
  readonly health: ReturnType<typeof useOperationalHealth>['state'];
  readonly onRetry: () => void;
  readonly workspace: Loadable<Readonly<WorkspaceResponse>>;
}) {
  if (health.kind === 'ready' && workspace.status === 'ready') return null;
  if (health.kind === 'loading' || workspace.status === 'loading') {
    return (
      <div className="runtime-notice" role="status" aria-live="polite">
        正在确认本机服务与当前外部工作区…
      </div>
    );
  }
  const workspaceError =
    workspace.status === 'error' ? workspace.message : undefined;
  return (
    <div className="runtime-notice runtime-notice--warning" role="alert">
      <div>
        <strong>部分运行状态不可用</strong>
        <span>
          {workspaceError ??
            (health.kind === 'not_ready'
              ? '服务尚未就绪；表单不会把失败解释为已写入。'
              : '健康响应无法验证；请检查本机配置。')}
        </span>
      </div>
      <button className="secondary-action" type="button" onClick={onRetry}>
        重新检查
      </button>
    </div>
  );
}

function importFeedback(
  body: DocumentImportResponse,
  opensEvidence = true,
): ActionFeedback {
  if (body.status === 'created') {
    return {
      kind: 'success',
      title: '材料已保存并拆解',
      detail: `生成 ${body.fragmentIds.length.toString()} 个 Fragment${opensEvidence ? '；来源档案已打开' : ''}。`,
    };
  }
  if (body.status === 'existing') {
    return {
      kind: 'success',
      title: '相同导入已存在',
      detail: `幂等重放没有创建重复材料${opensEvidence ? '；来源档案已打开' : ''}。`,
    };
  }
  return {
    kind: 'error',
    title: body.status === 'conflict' ? '导入命令发生冲突' : '材料未写入',
    detail: describeWireIssue(body),
  };
}

function connectionFeedback(detail: string): ActionFeedback {
  return {kind: 'error', title: '本地接口不可达', detail};
}

function workspaceTransferFeedback(
  body: WorkspaceBundleTransferResponse,
  expectedStatus: 'exported' | 'restored',
): WorkspaceTransferFeedback {
  if ('fileName' in body && body.status === expectedStatus) {
    const snapshotCount = body.tableCounts.snapshot ?? 0;
    return {
      kind: 'success',
      title:
        expectedStatus === 'exported'
          ? '全部个人数据已导出'
          : '全部个人数据已恢复',
      detail: `${snapshotCount.toString()} 个文档版本 · ${body.blobCount.toString()} 份原始 Blob · 标签、联系与个人偏好${body.personalDataIncluded ? '已包含' : '未包含'} · ${formatByteCount(body.byteLength)}`,
      fileName: body.fileName,
    };
  }
  const issue = 'issue' in body ? body.issue : {code: 'unexpected_status'};
  return {
    kind: 'error',
    title: expectedStatus === 'exported' ? '导出未完成' : '恢复未执行',
    detail: describeWireIssue(issue),
  };
}

function formatByteCount(value: number): string {
  return value < 1024
    ? `${value.toString()} B`
    : `${(value / 1024).toFixed(1)} KiB`;
}

function describeWireIssue(value: Readonly<Record<string, unknown>>): string {
  const code = typeof value.code === 'string' ? value.code : 'unknown_failure';
  const path = typeof value.path === 'string' ? ` · ${value.path}` : '';
  const budget =
    typeof value.budget === 'string' ? ` · 上限 ${value.budget}` : '';
  return `${code}${path}${budget}`;
}
