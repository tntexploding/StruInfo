import type {KnowledgeRevisionState} from './manual_knowledge_contract.js';

/** Read-only current revision projection used by the owner editing UI. */
export interface ManualKnowledgeReadRepositoryPort {
  loadCurrentKnowledgeItem(
    workspaceId: string,
    itemId: string,
  ): Promise<Readonly<KnowledgeRevisionState> | undefined>;
}
