import type {
  ProcessingProposal,
  ProcessingProposalAppend,
  ProcessingProposalDecision,
  ProcessingProposalDecisionOutcome,
  ProcessingRun,
  ProcessingRunCreate,
  ProcessingRunProgressWrite,
  ProcessingRunWriteOutcome,
} from './processing_contract.js';

export interface ProcessingRunRepositoryPort {
  listRecentRuns(
    workspaceId: string,
    limit: number,
  ): Promise<readonly Readonly<ProcessingRun>[]>;

  createRun(
    create: Readonly<ProcessingRunCreate>,
  ): Promise<ProcessingRunWriteOutcome>;

  writeProgress(
    write: Readonly<ProcessingRunProgressWrite>,
  ): Promise<ProcessingRunWriteOutcome>;

  cancelRun(
    workspaceId: string,
    runId: string,
    expectedVersion: number,
  ): Promise<ProcessingRunWriteOutcome>;

  appendProposal(
    proposal: Readonly<ProcessingProposalAppend>,
  ): Promise<ProcessingRunWriteOutcome>;
}

export interface AiSplitProposalRepositoryPort extends ProcessingRunRepositoryPort {
  loadRun(
    workspaceId: string,
    runId: string,
  ): Promise<Readonly<ProcessingRun> | undefined>;
  listSplitProposalsForSnapshot(
    workspaceId: string,
    snapshotId: string,
    limit: number,
  ): Promise<readonly Readonly<ProcessingProposal>[]>;
  appendSplitProposal(
    proposal: Readonly<ProcessingProposalAppend>,
  ): Promise<ProcessingRunWriteOutcome>;
  decideProposal(
    workspaceId: string,
    proposalId: string,
    decision: ProcessingProposalDecision,
  ): Promise<ProcessingProposalDecisionOutcome>;
}
export interface AiTagProposalRepositoryPort extends ProcessingRunRepositoryPort {
  loadRun(
    workspaceId: string,
    runId: string,
  ): Promise<Readonly<ProcessingRun> | undefined>;

  listTagProposalsForEntry(
    workspaceId: string,
    entryId: string,
    limit: number,
  ): Promise<readonly Readonly<ProcessingProposal>[]>;

  appendTagProposal(
    proposal: Readonly<ProcessingProposalAppend>,
  ): Promise<ProcessingRunWriteOutcome>;

  decideProposal(
    workspaceId: string,
    proposalId: string,
    decision: ProcessingProposalDecision,
  ): Promise<ProcessingProposalDecisionOutcome>;
}

export interface AiAssociationProposalRepositoryPort extends ProcessingRunRepositoryPort {
  loadRun(
    workspaceId: string,
    runId: string,
  ): Promise<Readonly<ProcessingRun> | undefined>;

  listAssociationProposalsForPair(
    workspaceId: string,
    entryLowId: string,
    entryHighId: string,
    limit: number,
  ): Promise<readonly Readonly<ProcessingProposal>[]>;

  appendAssociationProposal(
    proposal: Readonly<ProcessingProposalAppend>,
  ): Promise<ProcessingRunWriteOutcome>;

  decideProposal(
    workspaceId: string,
    proposalId: string,
    decision: ProcessingProposalDecision,
  ): Promise<ProcessingProposalDecisionOutcome>;
}
