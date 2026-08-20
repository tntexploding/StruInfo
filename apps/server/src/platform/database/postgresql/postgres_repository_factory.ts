import type {
  EvidenceReadRepositoryPort,
  EvidenceRepositoryPort,
} from '../../../modules/evidence/index.js';
import type {ManualCurationRepositoryPort} from '../../../modules/curation/index.js';
import type {ManualCurationReadRepositoryPort} from '../../../modules/curation/manual_curation_read_repository.js';
import type {
  DeterministicKnowledgeSearchRepositoryPort,
  ManualKnowledgeReadRepositoryPort,
  ManualKnowledgeRepositoryPort,
} from '../../../modules/knowledge/index.js';
import type {M1cDomainTransferRepositoryPort} from '../../../workspace_transfer/m1c_workspace_transfer.js';
import type {InformationEntryRepositoryPort} from '../../../modules/entries/index.js';

import {PostgresManualCurationRepository} from './postgres_curation_repository.js';
import {PostgresManualCurationReadRepository} from './postgres_curation_read_repository.js';
import {PostgresEvidenceRepository} from './postgres_evidence_repository.js';
import {PostgresEvidenceReadRepository} from './postgres_evidence_read_repository.js';
import {PostgresManualKnowledgeRepository} from './postgres_knowledge_repository.js';
import type {PostgresPoolBoundary} from './postgres_pool.js';
import {PostgresDeterministicKnowledgeSearchRepository} from './postgres_retrieval_repository.js';
import {PostgresM1cDomainTransferRepository} from './postgres_workspace_transfer_repository.js';
import {PostgresInformationEntryRepository} from './postgres_information_entry_repository.js';

export interface PostgresKnowledgeRepositorySet {
  readonly evidence: EvidenceRepositoryPort;
  readonly evidenceRead: EvidenceReadRepositoryPort;
  readonly curation: ManualCurationRepositoryPort;
  readonly curationRead: ManualCurationReadRepositoryPort;
  readonly knowledge: ManualKnowledgeRepositoryPort;
  readonly knowledgeRead: ManualKnowledgeReadRepositoryPort;
  readonly retrieval: DeterministicKnowledgeSearchRepositoryPort;
  readonly informationEntries: InformationEntryRepositoryPort;
  readonly workspaceTransfer: M1cDomainTransferRepositoryPort;
}

export function createPostgresKnowledgeRepositories(
  pool: PostgresPoolBoundary,
): Readonly<PostgresKnowledgeRepositorySet> {
  const knowledge = new PostgresManualKnowledgeRepository(pool);
  return Object.freeze({
    evidence: new PostgresEvidenceRepository(pool),
    evidenceRead: new PostgresEvidenceReadRepository(pool),
    curation: new PostgresManualCurationRepository(pool),
    curationRead: new PostgresManualCurationReadRepository(pool),
    knowledge,
    knowledgeRead: knowledge,
    retrieval: new PostgresDeterministicKnowledgeSearchRepository(pool),
    informationEntries: new PostgresInformationEntryRepository(pool),
    workspaceTransfer: new PostgresM1cDomainTransferRepository(pool),
  });
}
