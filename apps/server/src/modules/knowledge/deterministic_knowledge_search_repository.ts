import {createHash} from 'node:crypto';

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
    options?: Readonly<DeterministicKnowledgeSearchExecutionOptions>,
  ): Promise<unknown>;
}

export interface DeterministicKnowledgeSearchExecutionOptions {
  readonly includePrivate?: boolean;
}

export async function executeDeterministicKnowledgeSearch(
  repository: DeterministicKnowledgeSearchRepositoryPort,
  contextInput: unknown,
  requestInput: unknown,
  options: Readonly<DeterministicKnowledgeSearchExecutionOptions> = {},
): Promise<DeterministicKnowledgeSearchResult> {
  let context;
  let request;
  let querySha256: string;
  try {
    context = decodeDeterministicKnowledgeSearchContext(contextInput);
    request = decodeDeterministicKnowledgeSearchRequest(requestInput);
    querySha256 = privacyScopedQueryDigest(
      digestDeterministicKnowledgeSearchQuery(request),
      options.includePrivate === true,
    );
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
      Object.freeze({includePrivate: options.includePrivate === true}),
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
      options.includePrivate === true,
    );
  } catch (error) {
    if (error instanceof KnowledgeSearchRepositorySnapshotFault) {
      return failedKnowledgeSearchResult('invalid_repository_snapshot');
    }
    throw error;
  }
}

function privacyScopedQueryDigest(
  publicQuerySha256: string,
  includePrivate: boolean,
): string {
  if (!includePrivate) return publicQuerySha256;
  return createHash('sha256')
    .update('struinfo.private-search.v1\u0000', 'utf8')
    .update(publicQuerySha256, 'utf8')
    .digest('hex');
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
