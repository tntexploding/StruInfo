import type {
  InformationDocumentWorkingCopyRepositoryPort,
  InformationDocumentTagRepositoryPort,
  InformationEntryAssociationRepositoryPort,
  InformationEntryEmptySnapshotRepositoryPort,
  InformationEntryRepositoryPort,
  InformationEntryRestructureRepositoryPort,
  InformationEntrySearchIndexRepositoryPort,
} from '../../../modules/entries/index.js';
import type {
  EvidenceReadRepositoryPort,
  EvidenceRepositoryPort,
} from '../../../modules/evidence/index.js';
import type {
  AiAssociationProposalRepositoryPort,
  AiSplitProposalRepositoryPort,
  AiTagProposalRepositoryPort,
  EntryAutomationExecutionRepositoryPort,
  EntryAutomationActionRepositoryPort,
  EntryAutomationWorkQueueRepositoryPort,
  ProcessingRunRepositoryPort,
} from '../../../modules/processing/index.js';
import type {M1cDomainTransferRepositoryPort} from '../../../workspace_transfer/m1c_workspace_transfer.js';

import {PostgresEvidenceReadRepository} from './postgres_evidence_read_repository.js';
import {PostgresEvidenceRepository} from './postgres_evidence_repository.js';
import {PostgresInformationDocumentTagRepository} from './postgres_information_document_tag_repository.js';
import {PostgresInformationDocumentWorkingCopyRepository} from './postgres_information_document_working_copy_repository.js';
import {PostgresInformationEntryAssociationRepository} from './postgres_information_entry_association_repository.js';
import {PostgresInformationEntryRepository} from './postgres_information_entry_repository.js';
import {PostgresInformationEntrySearchIndexRepository} from './postgres_information_entry_search_index_repository.js';
import {PostgresInformationEntryRestructureRepository} from './postgres_information_entry_restructure_repository.js';
import {PostgresAiAssociationProposalRepository} from './postgres_ai_association_proposal_repository.js';
import {PostgresAiTagProposalRepository} from './postgres_ai_tag_proposal_repository.js';
import {PostgresEntryAutomationExecutionRepository} from './postgres_entry_automation_execution_repository.js';
import type {PostgresPoolBoundary} from './postgres_pool.js';
import {PostgresM1cDomainTransferRepository} from './postgres_workspace_transfer_repository.js';

export interface PostgresRepositorySet {
  readonly evidence: EvidenceRepositoryPort;
  readonly evidenceRead: EvidenceReadRepositoryPort;
  readonly informationEntries: InformationEntryRepositoryPort &
    InformationEntryEmptySnapshotRepositoryPort;
  readonly informationDocumentWorkingCopies: InformationDocumentWorkingCopyRepositoryPort;
  readonly informationEntryRestructures: InformationEntryRestructureRepositoryPort;
  readonly informationDocumentTags: InformationDocumentTagRepositoryPort;
  readonly informationEntryAssociations: InformationEntryAssociationRepositoryPort;
  readonly informationEntrySearchIndex: InformationEntrySearchIndexRepositoryPort;
  readonly processingRuns: ProcessingRunRepositoryPort &
    AiTagProposalRepositoryPort &
    AiSplitProposalRepositoryPort;
  readonly aiAssociationProposals: AiAssociationProposalRepositoryPort;
  readonly entryAutomationExecutions: EntryAutomationExecutionRepositoryPort;
  readonly entryAutomationWorkQueue: EntryAutomationWorkQueueRepositoryPort;
  readonly entryAutomationActions: EntryAutomationActionRepositoryPort;
  readonly workspaceTransfer: M1cDomainTransferRepositoryPort;
}

export function createPostgresRepositories(
  pool: PostgresPoolBoundary,
): Readonly<PostgresRepositorySet> {
  const entryAutomation = new PostgresEntryAutomationExecutionRepository(pool);
  return Object.freeze({
    evidence: new PostgresEvidenceRepository(pool),
    evidenceRead: new PostgresEvidenceReadRepository(pool),
    informationEntries: new PostgresInformationEntryRepository(pool),
    informationDocumentWorkingCopies:
      new PostgresInformationDocumentWorkingCopyRepository(pool),
    informationEntryRestructures:
      new PostgresInformationEntryRestructureRepository(pool),
    informationDocumentTags: new PostgresInformationDocumentTagRepository(pool),
    informationEntryAssociations:
      new PostgresInformationEntryAssociationRepository(pool),
    informationEntrySearchIndex:
      new PostgresInformationEntrySearchIndexRepository(pool),
    processingRuns: new PostgresAiTagProposalRepository(pool),
    aiAssociationProposals: new PostgresAiAssociationProposalRepository(pool),
    entryAutomationExecutions: entryAutomation,
    entryAutomationWorkQueue: entryAutomation,
    entryAutomationActions: entryAutomation,
    workspaceTransfer: new PostgresM1cDomainTransferRepository(pool),
  });
}
