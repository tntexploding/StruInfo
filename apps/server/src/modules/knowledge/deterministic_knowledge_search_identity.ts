import {createHash} from 'node:crypto';

import {encodeCanonicalJson} from '../../serialization/canonical_json.js';
import {defineOwnedRecord} from './closed_manual_knowledge_input.js';
import {
  DETERMINISTIC_KNOWLEDGE_SEARCH_SCHEMA_VERSION,
  type DeterministicKnowledgeSearchRequest,
  type KnowledgeSearchFilters,
  type KnowledgeSearchTextClause,
  type KnowledgeSearchTextField,
  type KnowledgeSearchTextMode,
} from './deterministic_knowledge_search_contract.js';

const MAXIMUM_QUERY_PROJECTION_BYTES = 32 * 1_024;
const textEncoder = new TextEncoder();

interface KnowledgeSearchDigestTextClause {
  readonly searchKey: string;
  readonly mode: KnowledgeSearchTextMode;
  readonly fields: readonly KnowledgeSearchTextField[];
}

interface KnowledgeSearchDigestProjection {
  readonly schemaVersion: typeof DETERMINISTIC_KNOWLEDGE_SEARCH_SCHEMA_VERSION;
  readonly text?: Readonly<KnowledgeSearchDigestTextClause>;
  readonly filters: Readonly<KnowledgeSearchFilters>;
}

export function searchKeyV1(text: string): string {
  const normalized = text.normalize('NFC');
  let lowered = '';
  for (const character of normalized) {
    const codePoint = character.codePointAt(0);
    lowered +=
      codePoint !== undefined && codePoint >= 0x41 && codePoint <= 0x5a
        ? String.fromCodePoint(codePoint + 0x20)
        : character;
  }
  return lowered.normalize('NFC');
}

export function compareUnsignedUtf8(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) {
      return difference < 0 ? -1 : 1;
    }
  }
  return leftBytes.byteLength - rightBytes.byteLength;
}

export function createDeterministicKnowledgeSearchDigestProjection(
  request: DeterministicKnowledgeSearchRequest,
): KnowledgeSearchDigestProjection {
  const text = request.text;
  return defineOwnedRecord({
    schemaVersion: DETERMINISTIC_KNOWLEDGE_SEARCH_SCHEMA_VERSION,
    ...(text === undefined
      ? {}
      : {
          text: defineOwnedRecord({
            searchKey: searchKeyV1(text.value),
            mode: text.mode,
            fields: text.fields,
          }),
        }),
    filters: request.filters,
  });
}

export function encodeDeterministicKnowledgeSearchDigestProjection(
  request: DeterministicKnowledgeSearchRequest,
): Uint8Array {
  return encodeCanonicalJson(
    createDeterministicKnowledgeSearchDigestProjection(request),
    MAXIMUM_QUERY_PROJECTION_BYTES,
  );
}

export function digestDeterministicKnowledgeSearchQuery(
  request: DeterministicKnowledgeSearchRequest,
): string {
  return createHash('sha256')
    .update(encodeDeterministicKnowledgeSearchDigestProjection(request))
    .digest('hex');
}

export function normalizeKnowledgeSearchTextClause(
  clause: KnowledgeSearchTextClause,
): Readonly<{searchKey: string; mode: KnowledgeSearchTextMode}> {
  return defineOwnedRecord({
    searchKey: searchKeyV1(clause.value),
    mode: clause.mode,
  });
}
