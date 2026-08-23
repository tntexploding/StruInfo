import type {
  InformationDocumentTagRepositoryPort,
  InformationEntryAssociationRepositoryPort,
  InformationEntryRepositoryPort,
} from '../../../modules/entries/index.js';
import type {
  EvidenceReadRepositoryPort,
  EvidenceRepositoryPort,
} from '../../../modules/evidence/index.js';
import type {M1cDomainTransferRepositoryPort} from '../../../workspace_transfer/m1c_workspace_transfer.js';

import {PostgresEvidenceReadRepository} from './postgres_evidence_read_repository.js';
import {PostgresEvidenceRepository} from './postgres_evidence_repository.js';
import {PostgresInformationDocumentTagRepository} from './postgres_information_document_tag_repository.js';
import {PostgresInformationEntryAssociationRepository} from './postgres_information_entry_association_repository.js';
import {PostgresInformationEntryRepository} from './postgres_information_entry_repository.js';
import type {PostgresPoolBoundary} from './postgres_pool.js';
import {PostgresM1cDomainTransferRepository} from './postgres_workspace_transfer_repository.js';

export interface PostgresRepositorySet {
  readonly evidence: EvidenceRepositoryPort;
  readonly evidenceRead: EvidenceReadRepositoryPort;
  readonly informationEntries: InformationEntryRepositoryPort;
  readonly informationDocumentTags: InformationDocumentTagRepositoryPort;
  readonly informationEntryAssociations: InformationEntryAssociationRepositoryPort;
  readonly workspaceTransfer: M1cDomainTransferRepositoryPort;
}

export function createPostgresRepositories(
  pool: PostgresPoolBoundary,
): Readonly<PostgresRepositorySet> {
  return Object.freeze({
    evidence: new PostgresEvidenceRepository(pool),
    evidenceRead: new PostgresEvidenceReadRepository(pool),
    informationEntries: new PostgresInformationEntryRepository(pool),
    informationDocumentTags: new PostgresInformationDocumentTagRepository(pool),
    informationEntryAssociations:
      new PostgresInformationEntryAssociationRepository(pool),
    workspaceTransfer: new PostgresM1cDomainTransferRepository(pool),
  });
}
