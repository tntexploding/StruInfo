import type {
  EpistemicRole,
  KnowledgeItemRevisionValue,
  KnowledgeKind,
  KnowledgeRelationRevisionValue,
  KnowledgeReviewState,
} from './manual_knowledge_contract.js';

export const DETERMINISTIC_KNOWLEDGE_SEARCH_SCHEMA_VERSION =
  'struinfo.deterministic-knowledge-search.v1' as const;

export const KNOWLEDGE_SEARCH_TEXT_FIELDS = ['title', 'body'] as const;
export const KNOWLEDGE_SEARCH_TEXT_MODES = ['exact', 'substring'] as const;
export const KNOWLEDGE_SEARCH_SOURCE_INPUT_KINDS = [
  'citation',
  'derivation',
] as const;
export const KNOWLEDGE_SEARCH_RELATION_DIRECTIONS = [
  'outgoing',
  'incoming',
  'either',
] as const;

export const KNOWLEDGE_SEARCH_LIMITS = Object.freeze({
  queryTextCodePoints: 300,
  cursorTitleCodePoints: 900,
  textFields: 2,
  knowledgeKinds: 8,
  epistemicRoles: 5,
  itemReviewStates: 6,
  sourceInputKinds: 2,
  relationTypeFilters: 32,
  relationTypeCodePoints: 120,
  relationReviewStates: 6,
  resultLimit: 100,
  relationMatches: 32,
  revisionNumber: 2_147_483_647,
});

export interface DeterministicKnowledgeSearchContext {
  readonly effectiveWorkspaceId: string;
  readonly authority: 'manual_user';
}

export type KnowledgeSearchTextField =
  (typeof KNOWLEDGE_SEARCH_TEXT_FIELDS)[number];
export type KnowledgeSearchTextMode =
  (typeof KNOWLEDGE_SEARCH_TEXT_MODES)[number];
export type KnowledgeSearchSourceInputKind =
  (typeof KNOWLEDGE_SEARCH_SOURCE_INPUT_KINDS)[number];
export type KnowledgeSearchRelationDirection =
  (typeof KNOWLEDGE_SEARCH_RELATION_DIRECTIONS)[number];

export interface KnowledgeSearchTextClause {
  readonly value: string;
  readonly mode: KnowledgeSearchTextMode;
  readonly fields: readonly KnowledgeSearchTextField[];
}

export type KnowledgeSearchSourceFilter =
  | Readonly<{kind: 'any'}>
  | Readonly<{
      kind: 'resource';
      resourceId: string;
      inputKinds: readonly KnowledgeSearchSourceInputKind[];
    }>
  | Readonly<{
      kind: 'snapshot';
      snapshotId: string;
      inputKinds: readonly KnowledgeSearchSourceInputKind[];
    }>
  | Readonly<{
      kind: 'fragment';
      fragmentId: string;
      inputKinds: readonly KnowledgeSearchSourceInputKind[];
    }>;

export type KnowledgeSearchRelationFilter =
  | Readonly<{kind: 'any'}>
  | Readonly<{
      kind: 'connected_to';
      anchorItemId: string;
      direction: KnowledgeSearchRelationDirection;
      relationTypeKeys: readonly string[];
      reviewStates: readonly KnowledgeReviewState[];
    }>;

export interface KnowledgeSearchFilters {
  readonly knowledgeKinds: readonly KnowledgeKind[];
  readonly epistemicRoles: readonly EpistemicRole[];
  readonly reviewStates: readonly KnowledgeReviewState[];
  readonly source: KnowledgeSearchSourceFilter;
  readonly relation: KnowledgeSearchRelationFilter;
}

export type KnowledgeSearchMatchRank = 0 | 1 | 2 | 3 | 4;

export interface KnowledgeSearchCursor {
  readonly schemaVersion: 1;
  readonly querySha256: string;
  readonly matchRank: KnowledgeSearchMatchRank;
  readonly normalizedTitle: string;
  readonly itemId: string;
}

export interface DeterministicKnowledgeSearchRequest {
  readonly text?: Readonly<KnowledgeSearchTextClause>;
  readonly filters: Readonly<KnowledgeSearchFilters>;
  readonly page: Readonly<{
    readonly limit: number;
    readonly after?: Readonly<KnowledgeSearchCursor>;
  }>;
}

export type KnowledgeSearchTextMatch = Readonly<{
  field: KnowledgeSearchTextField;
  kind: 'exact' | 'substring';
  rank: Exclude<KnowledgeSearchMatchRank, 4>;
}>;

export interface KnowledgeSearchSourceMatch {
  readonly inputKind: KnowledgeSearchSourceInputKind;
  readonly inputOrdinal: number;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly fragmentId: string;
}

export interface KnowledgeSearchRelationMatch {
  readonly relationId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly direction: 'outgoing' | 'incoming';
  readonly relationTypeKey: string;
  readonly epistemicRole: Exclude<EpistemicRole, 'source_excerpt'>;
  readonly reviewState: KnowledgeReviewState;
  readonly qualifier?: string;
  readonly isPrivate?: true;
}

export interface DeterministicKnowledgeSearchItem {
  readonly itemId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly value: Readonly<KnowledgeItemRevisionValue>;
  readonly matchRank: KnowledgeSearchMatchRank;
  readonly textMatches: readonly KnowledgeSearchTextMatch[];
  readonly sourceMatches: readonly KnowledgeSearchSourceMatch[];
  readonly relationMatchCount: number;
  readonly relationMatches: readonly KnowledgeSearchRelationMatch[];
  readonly relationMatchesTruncated: boolean;
  readonly isPrivate?: true;
}

export type DeterministicKnowledgeSearchResult =
  | Readonly<{
      status: 'ok';
      querySha256: string;
      totalCount: number;
      items: readonly DeterministicKnowledgeSearchItem[];
      nextCursor?: Readonly<KnowledgeSearchCursor>;
    }>
  | Readonly<{status: 'rejected'; issue: KnowledgeSearchIssue}>
  | Readonly<{
      status: 'failed';
      issue: Readonly<{
        code: 'repository_failed' | 'invalid_repository_snapshot';
        path: 'repository';
      }>;
    }>;

export interface DeterministicKnowledgeSearchSnapshot {
  readonly items: readonly KnowledgeSearchItemState[];
  readonly revisions: readonly KnowledgeSearchRevisionState[];
  readonly fragmentInputs: readonly KnowledgeSearchFragmentInputState[];
  readonly relations: readonly KnowledgeSearchRelationState[];
  readonly relationRevisions: readonly KnowledgeSearchRelationRevisionState[];
}

export interface KnowledgeSearchItemState {
  readonly workspaceId: string;
  readonly itemId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
}

export interface KnowledgeSearchRevisionState {
  readonly workspaceId: string;
  readonly itemId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly value: Readonly<KnowledgeItemRevisionValue>;
  readonly isPrivate?: true;
}

export interface KnowledgeSearchFragmentInputState {
  readonly workspaceId: string;
  readonly itemId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly inputKind: KnowledgeSearchSourceInputKind;
  readonly inputOrdinal: number;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly fragmentId: string;
}

export interface KnowledgeSearchRelationState {
  readonly workspaceId: string;
  readonly relationId: string;
  readonly subjectItemId: string;
  readonly relationTypeKey: string;
  readonly objectItemId: string;
  readonly currentRevision: number;
  readonly currentRevisionId: string;
}

export interface KnowledgeSearchRelationRevisionState {
  readonly workspaceId: string;
  readonly relationId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly value: Readonly<KnowledgeRelationRevisionValue>;
  readonly isPrivate?: true;
}

export type KnowledgeSearchIssueCode =
  | 'invalid_shape'
  | 'invalid_identifier'
  | 'invalid_text'
  | 'invalid_enum'
  | 'invalid_state'
  | 'duplicate_value'
  | 'limit_exceeded'
  | 'invalid_cursor';

export type KnowledgeSearchBudgetName =
  | 'query_text_code_points'
  | 'text_fields'
  | 'knowledge_kinds'
  | 'epistemic_roles'
  | 'item_review_states'
  | 'source_input_kinds'
  | 'relation_type_filters'
  | 'relation_type_code_points'
  | 'relation_review_states'
  | 'result_limit';

export type KnowledgeSearchIndex2 = 0 | 1;
export type KnowledgeSearchIndex5 = 0 | 1 | 2 | 3 | 4;
export type KnowledgeSearchIndex6 = KnowledgeSearchIndex5 | 5;
export type KnowledgeSearchIndex8 = KnowledgeSearchIndex6 | 6 | 7;
export type KnowledgeSearchIndex32 =
  | KnowledgeSearchIndex8
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23
  | 24
  | 25
  | 26
  | 27
  | 28
  | 29
  | 30
  | 31;

export type KnowledgeSearchIssuePath =
  | 'context'
  | 'context.effectiveWorkspaceId'
  | 'context.authority'
  | 'request'
  | 'request.text'
  | 'request.text.value'
  | 'request.text.mode'
  | 'request.text.fields'
  | `request.text.fields[${KnowledgeSearchIndex2}]`
  | 'request.filters'
  | 'request.filters.knowledgeKinds'
  | `request.filters.knowledgeKinds[${KnowledgeSearchIndex8}]`
  | 'request.filters.epistemicRoles'
  | `request.filters.epistemicRoles[${KnowledgeSearchIndex5}]`
  | 'request.filters.reviewStates'
  | `request.filters.reviewStates[${KnowledgeSearchIndex6}]`
  | 'request.filters.source'
  | 'request.filters.source.kind'
  | 'request.filters.source.resourceId'
  | 'request.filters.source.snapshotId'
  | 'request.filters.source.fragmentId'
  | 'request.filters.source.inputKinds'
  | `request.filters.source.inputKinds[${KnowledgeSearchIndex2}]`
  | 'request.filters.relation'
  | 'request.filters.relation.kind'
  | 'request.filters.relation.anchorItemId'
  | 'request.filters.relation.direction'
  | 'request.filters.relation.relationTypeKeys'
  | `request.filters.relation.relationTypeKeys[${KnowledgeSearchIndex32}]`
  | 'request.filters.relation.reviewStates'
  | `request.filters.relation.reviewStates[${KnowledgeSearchIndex6}]`
  | 'request.page'
  | 'request.page.limit'
  | 'request.page.after'
  | 'request.page.after.schemaVersion'
  | 'request.page.after.querySha256'
  | 'request.page.after.matchRank'
  | 'request.page.after.normalizedTitle'
  | 'request.page.after.itemId';

export type KnowledgeSearchIssue =
  | Readonly<{
      code: 'limit_exceeded';
      path: KnowledgeSearchIssuePath;
      budget: KnowledgeSearchBudgetName;
    }>
  | Readonly<{
      code: Exclude<KnowledgeSearchIssueCode, 'limit_exceeded'>;
      path: KnowledgeSearchIssuePath;
    }>;
