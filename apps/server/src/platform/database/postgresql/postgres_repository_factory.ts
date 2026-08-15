import type {ManualCurationRepositoryPort} from '../../../modules/curation/index.js';
import type {
  DeterministicKnowledgeSearchRepositoryPort,
  ManualKnowledgeRepositoryPort,
} from '../../../modules/knowledge/index.js';

import {PostgresManualCurationRepository} from './postgres_curation_repository.js';
import {PostgresManualKnowledgeRepository} from './postgres_knowledge_repository.js';
import type {PostgresPoolBoundary} from './postgres_pool.js';
import {PostgresDeterministicKnowledgeSearchRepository} from './postgres_retrieval_repository.js';

export interface PostgresKnowledgeRepositorySet {
  readonly curation: ManualCurationRepositoryPort;
  readonly knowledge: ManualKnowledgeRepositoryPort;
  readonly retrieval: DeterministicKnowledgeSearchRepositoryPort;
}

export function createPostgresKnowledgeRepositories(
  pool: PostgresPoolBoundary,
): Readonly<PostgresKnowledgeRepositorySet> {
  return Object.freeze({
    curation: new PostgresManualCurationRepository(pool),
    knowledge: new PostgresManualKnowledgeRepository(pool),
    retrieval: new PostgresDeterministicKnowledgeSearchRepository(pool),
  });
}
