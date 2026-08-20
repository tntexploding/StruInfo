import type {KnowledgeKind} from '../api/m1c_api_contract.js';

export const KNOWLEDGE_WRITE_KINDS = [
  'concept',
  'assertion',
  'event',
  'method',
  'resource',
  'other',
] as const satisfies readonly KnowledgeKind[];

export type KnowledgeWriteKind = (typeof KNOWLEDGE_WRITE_KINDS)[number];

const LEGACY_RESOURCE_KINDS: ReadonlySet<KnowledgeKind> = new Set([
  'entity',
  'framework',
  'work',
]);

export function knowledgeKindForNewWrite(
  kind: KnowledgeKind | undefined,
): KnowledgeWriteKind {
  switch (kind) {
    case undefined:
      return 'concept';
    case 'entity':
    case 'framework':
    case 'work':
      return 'resource';
    default:
      return kind;
  }
}

export function isLegacyResourceKnowledgeKind(kind: KnowledgeKind): boolean {
  return LEGACY_RESOURCE_KINDS.has(kind);
}

export function knowledgeKindsForSearch(
  kind: KnowledgeWriteKind | '',
): readonly KnowledgeKind[] {
  if (kind === '') return Object.freeze([]);
  if (kind !== 'resource') return Object.freeze([kind]);
  return Object.freeze(['entity', 'framework', 'resource', 'work']);
}
