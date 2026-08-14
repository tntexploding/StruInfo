import {
  decodeDeterministicKnowledgeSearchContext,
  decodeDeterministicKnowledgeSearchRequest,
  decodeDeterministicKnowledgeSearchSnapshot,
  KnowledgeSearchInputFault,
  KnowledgeSearchRepositorySnapshotFault,
} from './closed_deterministic_knowledge_search_input.js';
import {
  type DeterministicKnowledgeSearchResult,
  type KnowledgeSearchIssue,
} from './deterministic_knowledge_search_contract.js';
import {
  evaluateDeterministicKnowledgeSearch,
  failedKnowledgeSearchResult,
  rejectedKnowledgeSearchResult,
} from './deterministic_knowledge_search.js';
import {digestDeterministicKnowledgeSearchQuery} from './deterministic_knowledge_search_identity.js';

export interface DeterministicKnowledgeSearchRepositoryPort {
  loadCurrentKnowledgeSearchSnapshot(
    effectiveWorkspaceId: string,
  ): Promise<unknown>;
}

export async function executeDeterministicKnowledgeSearch(
  repository: DeterministicKnowledgeSearchRepositoryPort,
  contextInput: unknown,
  requestInput: unknown,
): Promise<DeterministicKnowledgeSearchResult> {
  let context;
  let request;
  let querySha256: string;
  try {
    context = decodeDeterministicKnowledgeSearchContext(contextInput);
    request = decodeDeterministicKnowledgeSearchRequest(requestInput);
    querySha256 = digestDeterministicKnowledgeSearchQuery(request);
    if (
      request.page.after !== undefined &&
      request.page.after.querySha256 !== querySha256
    ) {
      return rejectedKnowledgeSearchResult({
        code: 'invalid_cursor',
        path: 'request.page.after.querySha256',
      });
    }
  } catch (error) {
    if (!(error instanceof KnowledgeSearchInputFault)) {
      throw error;
    }
    return rejectedKnowledgeSearchResult(issueFromInputFault(error));
  }

  let snapshotInput: unknown;
  try {
    snapshotInput = await repository.loadCurrentKnowledgeSearchSnapshot(
      context.effectiveWorkspaceId,
    );
  } catch {
    return failedKnowledgeSearchResult('repository_failed');
  }

  try {
    const snapshot = decodeDeterministicKnowledgeSearchSnapshot(snapshotInput);
    return evaluateDeterministicKnowledgeSearch(
      context,
      request,
      snapshot,
      querySha256,
    );
  } catch (error) {
    if (error instanceof KnowledgeSearchRepositorySnapshotFault) {
      return failedKnowledgeSearchResult('invalid_repository_snapshot');
    }
    throw error;
  }
}

function issueFromInputFault(
  error: KnowledgeSearchInputFault,
): KnowledgeSearchIssue {
  if (error.code === 'limit_exceeded') {
    if (error.budget === undefined) {
      throw new Error(
        'A deterministic knowledge search budget fault omitted its budget.',
      );
    }
    return {
      code: error.code,
      path: error.path,
      budget: error.budget,
    };
  }
  return {code: error.code, path: error.path};
}
