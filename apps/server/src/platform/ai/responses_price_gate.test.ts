import {describe, expect, it, vi} from 'vitest';
import {priceAwareFetch} from './price_aware_fetch.js';
import {
  AiPriceWindowClosedError,
  AiOperationsPausedError,
} from '../../modules/processing/ai_price_policy.js';
import type {CurrentInformationEntry} from '../../modules/entries/index.js';
import {intakePolicySchema} from '../../application/document_intake_contract.js';
import {ResponsesEntryTagProvider} from './responses_entry_tag_provider.js';
import {ResponsesEntrySplitProvider} from './responses_entry_split_provider.js';
import {ResponsesEntryAssociationProvider} from './responses_entry_association_provider.js';
import {ResponsesEntryTranslationProvider} from './responses_entry_translation_provider.js';
import {ResponsesInformationEntryQuerySynthesisProvider} from './responses_information_entry_query_synthesis_provider.js';
import {ResponsesDocumentIntelligenceProvider} from './responses_document_intelligence_provider.js';
import {ResponsesReportProvider} from './responses_report_provider.js';

const config = {
  providerKey: 'deepseek-responses-v1' as const,
  model: 'synthetic-model',
  apiKey: 'synthetic-key',
  timeoutMs: 60000 as const,
  maxOutputTokens: 800 as const,
};
const entry: CurrentInformationEntry = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  entryId: '22222222-2222-4222-8222-222222222222',
  resourceId: '33333333-3333-4333-8333-333333333333',
  snapshotId: '44444444-4444-4444-8444-444444444444',
  revisionId: '55555555-5555-4555-8555-555555555555',
  revision: 1,
  sourceKey: 'Synthetic',
  capturedAt: '2040-01-02T00:00:00Z',
  value: {
    titlePath: 'Synthetic article',
    body: 'Synthetic complete body',
    bodySha256: 'a'.repeat(64),
    documentOrder: 1,
    chunkMode: 'whole',
    splitRuleVersion: 'synthetic',
    isPrivate: false,
    fragmentIds: [],
    contentKeywords: [],
    domains: [],
  },
};
const operations: Record<string, (fetcher: typeof fetch) => Promise<unknown>> =
  {
    tags: (fetcher) =>
      new ResponsesEntryTagProvider(config, fetcher).proposeTags(entry),
    split: (fetcher) =>
      new ResponsesEntrySplitProvider(config, fetcher).proposeSplit([
        {ordinal: 0, text: 'Synthetic'},
      ]),
    relation: (fetcher) =>
      new ResponsesEntryAssociationProvider(config, fetcher).proposeAssociation(
        entry,
        {...entry, entryId: entry.resourceId},
      ),
    translation: (fetcher) =>
      new ResponsesEntryTranslationProvider(config, fetcher).translate({
        title: 'Synthetic',
        body: 'Synthetic body',
      }),
    synthesis: (fetcher) =>
      new ResponsesInformationEntryQuerySynthesisProvider(
        config,
        fetcher,
      ).synthesize('Synthetic question', [
        {
          handle: 'e1',
          titlePath: 'Synthetic',
          excerpt: 'Synthetic body',
          truncated: false,
          contentKeywords: [],
          domains: [],
        },
      ]),
    intake: (fetcher) =>
      new ResponsesDocumentIntelligenceProvider(config, fetcher).reviewIntake({
        text: 'Synthetic',
        preparation: 'received',
        policy: intakePolicySchema.parse({}),
      }),
    recall: (fetcher) =>
      new ResponsesDocumentIntelligenceProvider(config, fetcher).planRecall({
        title: 'Synthetic',
        body: 'Synthetic',
        keywords: [],
      }),
    daily: (fetcher) =>
      new ResponsesReportProvider(config, fetcher).plan({
        kind: 'daily',
        sources: [
          {
            handle: 1,
            title: 'Synthetic',
            excerpt: 'Synthetic',
            keywords: [],
            reason: 'Synthetic',
          },
        ],
      }),
    weekly: (fetcher) =>
      new ResponsesReportProvider(config, fetcher).summarize({
        kind: 'weekly',
        title: 'Synthetic',
        period: {from: '2040-01-02', to: '2040-01-08'},
        timeField: 'received',
        sources: [{handle: 1, title: 'Synthetic', text: 'Synthetic body'}],
      }),
  };
describe.each([AiPriceWindowClosedError, AiOperationsPausedError])(
  'every Responses operation obeys %s',
  (WaitError) => {
    it.each(Object.keys(operations))(
      '%s does not dispatch and preserves the wait signal',
      async (name) => {
        const network = vi.fn<typeof fetch>();
        const fetcher = priceAwareFetch(
          {
            assertAllowed: async () => {
              await Promise.resolve();
              throw new WaitError();
            },
          },
          network,
        );
        await expect(operations[name]?.(fetcher)).rejects.toMatchObject({
          code: new WaitError().code,
        });
        expect(network).not.toHaveBeenCalled();
      },
    );
  },
);
