import type {
  CurationState,
  EpistemicRole,
  EvidenceFragment,
  EvidenceSnapshot,
  IntakeAction,
  KnowledgeKind,
  KnowledgeReviewState,
  KnowledgeSearchCursor,
  KnowledgeSearchItem,
  KnowledgeSearchResponse,
  M1cHttpResponse,
  ReviewVocabularyPreferences,
} from '../api/m1c_api_contract.js';
import type {ReviewProcessingPlan} from './review_processing_plan.js';
import {deriveReviewProcessingPlan} from './review_processing_plan.js';
import {
  createReviewQueueCandidates,
  createReviewTargetOptions,
} from './review_queue_model.js';
import {preferredKnowledgeKind} from './review_vocabulary.js';

const ELIGIBLE_ACTIONS: ReadonlySet<IntakeAction> = new Set([
  'full',
  'split',
  'condense',
]);
const SEARCH_PAGE_LIMIT = 100;
const MAXIMUM_SEARCH_PAGES = 1_000;

export interface ReviewedKnowledgeQueueEntry {
  readonly key: string;
  readonly targetId: string;
  readonly label: string;
  readonly snapshotId: string;
  readonly fragment: Readonly<EvidenceFragment>;
  readonly action: Extract<IntakeAction, 'full' | 'split' | 'condense'>;
  readonly expectedDecisionRevision: number;
  readonly keywords: readonly string[];
  readonly suggestedKnowledgeKind?: KnowledgeKind;
  readonly processingPlan: Readonly<ReviewProcessingPlan>;
  readonly formalItems: readonly Readonly<KnowledgeSearchItem>[];
}

export interface QuickKnowledgeDraft {
  readonly title: string;
  readonly body: string;
  readonly knowledgeKind: KnowledgeKind;
  readonly epistemicRole: EpistemicRole;
  readonly reviewState: KnowledgeReviewState;
}

export type KnowledgeSearchTransport = (
  body: unknown,
) => Promise<M1cHttpResponse<KnowledgeSearchResponse>>;

export function createReviewedKnowledgeQueue(
  curation: Readonly<CurationState>,
  evidence: Readonly<EvidenceSnapshot>,
  vocabularyPreferences: Readonly<ReviewVocabularyPreferences>,
  formalItems: readonly Readonly<KnowledgeSearchItem>[],
): readonly Readonly<ReviewedKnowledgeQueueEntry>[] {
  const candidates = createReviewQueueCandidates(
    createReviewTargetOptions([evidence], evidence),
    curation,
  );
  return Object.freeze(
    candidates.flatMap((candidate): ReviewedKnowledgeQueueEntry[] => {
      if (
        candidate.action === undefined ||
        !ELIGIBLE_ACTIONS.has(candidate.action)
      ) {
        return [];
      }
      const target = curation.targets.find(
        (value) =>
          value.kind === 'fragment' &&
          value.fragmentId === candidate.fragment.fragmentId,
      );
      if (target === undefined) return [];
      const decision = curation.decisions.find(
        (value) => value.targetId === target.targetId,
      );
      if (decision?.value.action !== candidate.action) {
        return [];
      }
      const keywords = activeKeywordsForTarget(curation, target.targetId);
      const suggestedKind = preferredKnowledgeKind(
        keywords,
        vocabularyPreferences,
      );
      return [
        {
          key: target.targetId,
          targetId: target.targetId,
          label: candidate.label,
          snapshotId: candidate.snapshotId,
          fragment: candidate.fragment,
          action: candidate.action as ReviewedKnowledgeQueueEntry['action'],
          expectedDecisionRevision: decision.currentRevision,
          keywords,
          ...(suggestedKind === undefined
            ? {}
            : {suggestedKnowledgeKind: suggestedKind}),
          processingPlan: deriveReviewProcessingPlan(
            candidate.action,
            candidate.fragment.selectedText,
            suggestedKind,
          ),
          formalItems: Object.freeze(
            formalItems.filter((item) =>
              item.sourceMatches.some(
                (match) =>
                  match.snapshotId === candidate.snapshotId &&
                  match.fragmentId === candidate.fragment.fragmentId,
              ),
            ),
          ),
        },
      ];
    }),
  );
}

export function firstPendingKnowledgeKey(
  entries: readonly Readonly<ReviewedKnowledgeQueueEntry>[],
  skippedKeys: ReadonlySet<string> = new Set(),
): string | undefined {
  return (
    entries.find(
      (entry) => entry.formalItems.length === 0 && !skippedKeys.has(entry.key),
    )?.key ?? entries[0]?.key
  );
}

export function nextPendingKnowledgeKey(
  entries: readonly Readonly<ReviewedKnowledgeQueueEntry>[],
  currentKey: string,
  skippedKeys: ReadonlySet<string> = new Set(),
): string | undefined {
  const currentIndex = entries.findIndex((entry) => entry.key === currentKey);
  const pending = (entry: Readonly<ReviewedKnowledgeQueueEntry>) =>
    entry.formalItems.length === 0 && !skippedKeys.has(entry.key);
  return (
    entries.slice(Math.max(0, currentIndex + 1)).find(pending)?.key ??
    entries.slice(0, Math.max(0, currentIndex)).find(pending)?.key ??
    entries[currentIndex + 1]?.key ??
    entries[0]?.key
  );
}

export function createQuickKnowledgeDraft(
  entry: Readonly<ReviewedKnowledgeQueueEntry>,
): Readonly<QuickKnowledgeDraft> {
  return Object.freeze({
    title: fragmentKnowledgeTitle(entry.fragment.selectedText),
    body: entry.fragment.selectedText,
    knowledgeKind: entry.suggestedKnowledgeKind ?? 'concept',
    epistemicRole: 'summary',
    reviewState: 'confirmed',
  });
}

export function createQuickKnowledgeCommand(
  entry: Readonly<ReviewedKnowledgeQueueEntry>,
  draft: Readonly<QuickKnowledgeDraft>,
  identities: Readonly<{commandIdempotencyKey: string; itemId: string}>,
): Readonly<Record<string, unknown>> {
  const fragmentId = entry.fragment.fragmentId;
  return Object.freeze({
    commandIdempotencyKey: identities.commandIdempotencyKey,
    request: {
      authorization: {
        kind: 'eligible_target',
        target: {kind: 'fragment', fragmentId},
        expectedDecisionRevision: entry.expectedDecisionRevision,
      },
      operations: [
        {
          kind: 'put_item',
          itemId: identities.itemId,
          expectedRevision: 0,
          value: {
            knowledgeKind: draft.knowledgeKind,
            epistemicRole: draft.epistemicRole,
            reviewState: draft.reviewState,
            title: draft.title,
            ...(draft.body === '' ? {} : {body: draft.body}),
          },
          provenance: {
            citations:
              draft.epistemicRole === 'source_claim' ? [fragmentId] : [],
            fragmentDerivations:
              draft.epistemicRole === 'source_claim' ? [] : [fragmentId],
            knowledgeDerivations: [],
          },
        },
      ],
    },
  });
}

export async function loadSnapshotKnowledgeItems(
  evidence: Readonly<EvidenceSnapshot>,
  onSearch: KnowledgeSearchTransport,
): Promise<readonly Readonly<KnowledgeSearchItem>[]> {
  const items: KnowledgeSearchItem[] = [];
  const cursorIdentities = new Set<string>();
  let after: Readonly<KnowledgeSearchCursor> | undefined;
  for (let page = 0; page < MAXIMUM_SEARCH_PAGES; page += 1) {
    const response = await onSearch({
      includePrivate: evidence.isPrivate === true,
      request: {
        filters: {
          knowledgeKinds: [],
          epistemicRoles: [],
          reviewStates: [],
          source: {
            kind: 'snapshot',
            snapshotId: evidence.snapshotId,
            inputKinds: ['citation', 'derivation'],
          },
          relation: {kind: 'any'},
        },
        page: {
          limit: SEARCH_PAGE_LIMIT,
          ...(after === undefined ? {} : {after}),
        },
      },
    });
    if (response.body.status !== 'ok') {
      throw new Error('snapshot_knowledge_search_failed');
    }
    items.push(...response.body.items);
    if (response.body.nextCursor === undefined) return Object.freeze(items);
    const cursorIdentity = JSON.stringify(response.body.nextCursor);
    if (cursorIdentities.has(cursorIdentity)) {
      throw new Error('snapshot_knowledge_cursor_repeated');
    }
    cursorIdentities.add(cursorIdentity);
    after = response.body.nextCursor;
  }
  throw new Error('snapshot_knowledge_page_budget_exceeded');
}

export function fragmentKnowledgeTitle(value: string): string {
  const firstLine =
    value
      .split(/\r?\n/gu)
      .map((line) =>
        line
          .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)、]\s*)/u, '')
          .trim(),
      )
      .find((line) => line !== '') ?? '未命名知识项';
  const semanticText = stripMarkdownLinks(firstLine)
    .replace(/[`*_~]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return Array.from(semanticText || '未命名知识项')
    .slice(0, 300)
    .join('');
}

function activeKeywordsForTarget(
  curation: Readonly<CurationState>,
  targetId: string,
): readonly string[] {
  const values = curation.assignments
    .filter(
      (assignment) =>
        assignment.targetId === targetId && assignment.state === 'assigned',
    )
    .flatMap((assignment) => {
      const term = curation.terms.find(
        (candidate) => candidate.termId === assignment.termId,
      );
      return term?.value.lifecycle === 'active' ? [term.value.displayName] : [];
    });
  return Object.freeze([...new Set(values)]);
}

function stripMarkdownLinks(line: string): string {
  let output = '';
  let cursor = 0;
  while (cursor < line.length) {
    const labelStart = line.indexOf('[', cursor);
    if (labelStart < 0) return output + line.slice(cursor);
    const imageStart = labelStart > 0 && line[labelStart - 1] === '!';
    const labelEnd = line.indexOf('](', labelStart + 1);
    if (labelEnd < 0) return output + line.slice(cursor);
    let depth = 1;
    let destinationEnd = labelEnd + 2;
    for (; destinationEnd < line.length; destinationEnd += 1) {
      const character = line[destinationEnd];
      if (character === '\\') {
        destinationEnd += 1;
        continue;
      }
      if (character === '(') depth += 1;
      if (character === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) return output + line.slice(cursor);
    output += line.slice(cursor, imageStart ? labelStart - 1 : labelStart);
    output += line.slice(labelStart + 1, labelEnd);
    cursor = destinationEnd + 1;
  }
  return output;
}
