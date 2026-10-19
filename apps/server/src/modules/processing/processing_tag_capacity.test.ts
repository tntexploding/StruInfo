import {describe, expect, it} from 'vitest';

import {agentTaskRequestSchema} from '../../application/agent_task_contract.js';
import {
  ENTRY_DOMAIN_KEYWORDS,
  prepareAiEntryTagRevision,
  type CurrentInformationEntry,
} from '../entries/index.js';
import type {ProcessingTagProposalPayload} from './processing_contract.js';
import {assertProcessingTagProposalPayload} from './processing.js';

const current: CurrentInformationEntry = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  entryId: '22222222-2222-4222-8222-222222222222',
  resourceId: '33333333-3333-4333-8333-333333333333',
  snapshotId: '44444444-4444-4444-8444-444444444444',
  revision: 1,
  revisionId: '55555555-5555-4555-8555-555555555555',
  sourceKey: 'synthetic:tag-capacity',
  capturedAt: '2040-01-02T03:04:05.000Z',
  value: {
    documentOrder: 0,
    titlePath: 'Synthetic Entry',
    body: 'Synthetic source body',
    bodySha256: 'a'.repeat(64),
    chunkMode: 'whole',
    splitRuleVersion: 'synthetic:v1',
    isPrivate: false,
    contentKeywords: [],
    domains: [],
    fragmentIds: ['66666666-6666-4666-8666-666666666666'],
  },
};

function payload(
  keywords: number,
  domains: number,
): ProcessingTagProposalPayload {
  return {
    expectedEntryRevision: 1,
    providerModel: 'external-agent',
    promptVersion: 'struinfo.agent-tool.v1',
    typeKeyword: 'investigation_analysis',
    contentKeywords: Array.from({length: keywords}, (_, i) => ({
      displayValue: `Synthetic keyword ${String(i)}`,
      normalizedValue: `synthetic keyword ${String(i)}`,
    })),
    domains: Array.from({length: domains}, (_, i) => {
      const keyword = ENTRY_DOMAIN_KEYWORDS[i] ?? 'other';
      return {
        keyword,
        ...(keyword === 'other'
          ? {customName: `Synthetic domain ${String(i)}`}
          : {}),
      };
    }),
  };
}

function request(value: ProcessingTagProposalPayload) {
  return {
    kind: 'tags',
    entryId: '11111111-1111-4111-8111-111111111111',
    expectedRevision: value.expectedEntryRevision,
    result: {
      summary: 'Synthetic external tag proposal',
      typeKeyword: value.typeKeyword,
      contentKeywords: value.contentKeywords.map(
        (keyword) => keyword.displayValue,
      ),
      domains: value.domains,
    },
  };
}

describe('external tag proposal capacity through persistence', () => {
  it.each([
    [13, 1],
    [24, 3],
  ])(
    'persists the admitted %i keywords and %i domains without truncation',
    (keywords, domains) => {
      const value = payload(keywords, domains);
      expect(agentTaskRequestSchema.safeParse(request(value)).success).toBe(
        true,
      );
      expect(() => {
        assertProcessingTagProposalPayload(value);
      }).not.toThrow();
      const revised = prepareAiEntryTagRevision(current, {
        ...request(value).result,
        originVersion: 'external-agent:struinfo.agent-tool.v1',
      });
      expect(revised?.contentKeywords).toHaveLength(keywords);
      expect(revised?.domains).toHaveLength(domains);
      expect(revised?.body).toBe(current.value.body);
      expect(revised?.fragmentIds).toEqual(current.value.fragmentIds);
    },
  );

  it.each([
    [25, 1],
    [1, 4],
    [1, 13],
  ])(
    'rejects %i keywords and %i domains at both boundaries',
    (keywords, domains) => {
      const value = payload(keywords, domains);
      expect(agentTaskRequestSchema.safeParse(request(value)).success).toBe(
        false,
      );
      expect(() => {
        assertProcessingTagProposalPayload(value);
      }).toThrow();
    },
  );
});
