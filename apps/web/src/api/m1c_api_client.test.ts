import {describe, expect, it} from 'vitest';

import {
  DEFAULT_REVIEW_ASSOCIATION_POLICY,
  DEFAULT_REVIEW_EXPLORATION_POLICY,
} from './m1c_api_contract.js';
import {
  createM1cApiClient,
  type M1cApiFetch,
  M1cApiClientError,
} from './m1c_api_client.js';

describe('M1cApiClient', () => {
  it('uses only same-base product paths and preserves domain responses', async () => {
    const requests: Readonly<{url: string; init?: RequestInit}>[] = [];
    const fetchImplementation: M1cApiFetch = (input, init) => {
      requests.push({
        url: requestUrl(input),
        ...(init === undefined ? {} : {init}),
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({status: 'rejected', issue: {code: 'synthetic'}}),
          {
            status: 422,
            headers: {'content-type': 'application/json; charset=utf-8'},
          },
        ),
      );
    };
    const client = createM1cApiClient(
      'http://127.0.0.1:3000/',
      fetchImplementation,
    );

    const result = await client.searchInformationEntries({text: 'synthetic'});

    expect(result).toEqual({
      statusCode: 422,
      body: {status: 'rejected', issue: {code: 'synthetic'}},
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      'http://127.0.0.1:3000/api/v1/entries/search',
    );
    expect(requests[0]?.init).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      method: 'POST',
      redirect: 'error',
    });
  });

  it('posts AI query synthesis through the narrow route and forwards cancellation', async () => {
    let request: Readonly<{url: string; init?: RequestInit}> | undefined;
    const fetchImplementation: M1cApiFetch = (input, init) => {
      request = {url: requestUrl(input), ...(init === undefined ? {} : {init})};
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: 'failed',
            issue: {code: 'ai_provider_not_configured'},
          }),
          {status: 503, headers: {'content-type': 'application/json'}},
        ),
      );
    };
    const client = createM1cApiClient(
      'http://127.0.0.1:3000/',
      fetchImplementation,
    );
    const controller = new AbortController();
    const body = {
      requestId: 'query-synthesis:1',
      question: '这些证据说明了什么？',
      query: {text: 'synthetic', includePrivate: false, onlyPrivate: false},
    };

    const result = await client.synthesizeInformationEntryQuery(body, {
      signal: controller.signal,
    });

    expect(result.body).toEqual({
      status: 'failed',
      issue: {code: 'ai_provider_not_configured'},
    });
    expect(request?.url).toBe(
      'http://127.0.0.1:3000/api/v1/entries/search/synthesize',
    );
    expect(request?.init).toMatchObject({
      method: 'POST',
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  });

  it('uses separate candidate-read and policy-write routes for exploration', async () => {
    const requests: Readonly<{url: string; method?: string; body?: string}>[] =
      [];
    const client = createM1cApiClient(
      'http://127.0.0.1:3000/',
      (input, init) => {
        requests.push({
          url: requestUrl(input),
          ...(init?.method === undefined ? {} : {method: init.method}),
          ...(typeof init?.body === 'string' ? {body: init.body} : {}),
        });
        return Promise.resolve(
          new Response(
            JSON.stringify({status: 'failed', issue: {code: 'synthetic'}}),
            {status: 503, headers: {'content-type': 'application/json'}},
          ),
        );
      },
    );
    const candidateRequest = {
      anchorEntryId: '00000000-0000-4000-8000-000000000001',
      excludeEntryIds: [],
      pageResultCount: 20,
      includePrivate: false,
      onlyPrivate: false,
    };
    const policyRequest = {
      expectedRevision: 0,
      enabled: true,
      resultShare: 20,
      neighborExpansion: true,
      crossDomain: true,
      serendipity: true,
    };

    await client.exploreInformationEntries(candidateRequest);
    await client.reviseInformationEntryExplorationPolicy(policyRequest);

    expect(requests).toEqual([
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/exploration/candidates',
        method: 'POST',
        body: JSON.stringify(candidateRequest),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/exploration/policy',
        method: 'PUT',
        body: JSON.stringify(policyRequest),
      },
    ]);
  });

  it('uses dedicated owner-control routes for Entry automation policy, trial, execution and audit', async () => {
    const requests: Readonly<{url: string; method?: string; body?: string}>[] =
      [];
    const client = createM1cApiClient(
      'http://127.0.0.1:3000/',
      (input, init) => {
        requests.push({
          url: requestUrl(input),
          ...(init?.method === undefined ? {} : {method: init.method}),
          ...(typeof init?.body === 'string' ? {body: init.body} : {}),
        });
        return Promise.resolve(
          new Response(JSON.stringify({status: 'ok'}), {
            headers: {'content-type': 'application/json'},
          }),
        );
      },
    );
    const policy = {
      revision: 3,
      enabled: true,
      paused: false,
      profileRevision: 2,
      minimumMatchedRuleCount: 1,
      advanceThresholds: {usefulness: 3, interest: 3, requiredDimensions: 1},
      deferThresholds: {usefulness: 3, interest: 3, requiredDimensions: 1},
      budgets: {
        maximumEntriesPerRun: 25,
        maximumAdvanceCandidatesPerRun: 10,
        maximumDeferCandidatesPerRun: 10,
      },
      advanceActions: {
        deterministicTags: true,
        rebuildAssociations: true,
      },
      failureMode: 'pause' as const,
    } as const;
    const policyWrite = {
      expectedRevision: policy.revision,
      enabled: policy.enabled,
      paused: policy.paused,
      profileRevision: policy.profileRevision,
      minimumMatchedRuleCount: policy.minimumMatchedRuleCount,
      advanceThresholds: policy.advanceThresholds,
      deferThresholds: policy.deferThresholds,
      budgets: policy.budgets,
      advanceActions: policy.advanceActions,
      failureMode: policy.failureMode,
    };
    const trial = {
      includePrivate: false,
      expectedPolicyRevision: 3,
      expectedProfileRevision: 2,
      policy,
      manualTakeoverEntryIds: ['11111111-1111-4111-8111-111111111111'],
    } as const;
    const execution = {
      idempotencyKey: 'synthetic-m1g-4c-run',
      includePrivate: false,
      expectedPolicyRevision: 3,
      expectedProfileRevision: 2,
      expectedEntries: [
        {
          entryId: '11111111-1111-4111-8111-111111111111',
          revision: 4,
        },
      ],
      manualTakeoverEntryIds: trial.manualTakeoverEntryIds,
    } as const;

    await client.loadInformationEntryAutomationPolicy();
    await client.saveInformationEntryAutomationPolicy(policyWrite);
    await client.trialInformationEntryAutomationPolicy(trial);
    await client.executeInformationEntryAutomation(execution);
    await client.listInformationEntryAutomationExecutions(7);
    await client.loadInformationEntryAutomationExecution('synthetic/run');
    await client.listInformationEntryAutomationWorkQueue(false);
    await client.updateInformationEntryAutomationWorkItem('synthetic/run', 3, {
      expectedVersion: 2,
      state: 'completed',
      includePrivate: false,
    });
    await client.executeInformationEntryAutomationWorkItemAction(
      'synthetic/run',
      3,
      {
        expectedVersion: 4,
        operation: 'undo',
        includePrivate: false,
      },
    );

    expect(requests).toEqual([
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/automation/policy',
        method: 'GET',
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/automation/policy',
        method: 'PUT',
        body: JSON.stringify(policyWrite),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/automation/trial',
        method: 'POST',
        body: JSON.stringify(trial),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/automation/runs',
        method: 'POST',
        body: JSON.stringify(execution),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/automation/runs?limit=7',
        method: 'GET',
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/automation/runs/synthetic%2Frun',
        method: 'GET',
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/automation/work-queue?includePrivate=false',
        method: 'GET',
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/automation/work-queue/synthetic%2Frun/3',
        method: 'PUT',
        body: JSON.stringify({
          expectedVersion: 2,
          state: 'completed',
          includePrivate: false,
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/automation/work-queue/synthetic%2Frun/3/action',
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: 4,
          operation: 'undo',
          includePrivate: false,
        }),
      },
    ]);
  });

  it('encodes snapshot identity as one path segment', async () => {
    let requestedUrl = '';
    const client = createM1cApiClient('https://localhost:3000', (input) => {
      requestedUrl = requestUrl(input);
      return Promise.resolve(
        new Response(JSON.stringify({status: 'not_found'}), {
          status: 404,
          headers: {'content-type': 'application/json'},
        }),
      );
    });

    await client.loadEvidenceSnapshot('synthetic/id', {includePrivate: true});

    expect(requestedUrl).toBe(
      'https://localhost:3000/api/v1/evidence/snapshots/synthetic%2Fid?includePrivate=true',
    );
  });

  it('uses narrow Entry, Document navigation, and document-tag routes', async () => {
    const requests: Readonly<{
      url: string;
      method: string | undefined;
      body?: string;
    }>[] = [];
    const client = createM1cApiClient(
      'http://127.0.0.1:3000/',
      (input, init) => {
        requests.push({
          url: requestUrl(input),
          method: init?.method,
          ...(typeof init?.body === 'string' ? {body: init.body} : {}),
        });
        return Promise.resolve(
          new Response(JSON.stringify({status: 'ok', items: []}), {
            headers: {'content-type': 'application/json'},
          }),
        );
      },
    );

    await client.materializeInformationEntries({
      snapshotId: 'synthetic-snapshot',
      chunkMode: 'split',
    });
    await client.materializeManualInformationEntries({
      snapshotId: 'synthetic-snapshot',
      includePrivate: false,
      groups: [
        {
          titlePath: 'Synthetic group',
          fragmentIds: ['synthetic-fragment'],
        },
      ],
    });
    await client.loadInformationEntrySplitRuleProfile();
    await client.saveInformationEntrySplitRuleProfile({
      expectedRevision: 0,
      mode: 'merge_short_adjacent',
      minimumGroupCodePoints: 250,
      maximumGroupCodePoints: 2500,
      maximumFragmentsPerGroup: 6,
    });
    await client.trialInformationEntrySplitRule({
      snapshotId: 'synthetic-snapshot',
      includePrivate: false,
      profile: {
        revision: 1,
        mode: 'merge_short_adjacent',
        minimumGroupCodePoints: 250,
        maximumGroupCodePoints: 2500,
        maximumFragmentsPerGroup: 6,
      },
    });
    await client.applyInformationEntrySplitRule({
      snapshotId: 'synthetic-snapshot',
      includePrivate: false,
      expectedProfileRevision: 1,
    });
    await client.previewInformationEntryRestructure({
      snapshotId: 'synthetic-snapshot',
      includePrivate: false,
    });
    await client.applyInformationEntryRestructure({
      snapshotId: 'synthetic-snapshot',
      includePrivate: false,
      groups: [],
      planSha256: 'a'.repeat(64),
      acknowledgeAnnotationChanges: true,
      acknowledgeRelationshipChanges: true,
    });
    await client.reviseInformationEntry('synthetic/id', {
      expectedRevision: 1,
    });
    await client.searchInformationEntries({text: 'synthetic'});
    await client.readInformationEntryKnowledgeGraph({
      query: 'synthetic',
      includePrivate: true,
    });
    await client.reviseInformationEntryKnowledgeGraphEdge(
      'synthetic/entry',
      'related/id',
      {
        expectedRevision: 0,
        operation: 'edit',
        label: '相关',
        direction: 'symmetric',
        includePrivate: true,
      },
    );
    await client.rebuildInformationEntryAssociations({includePrivate: true});
    await client.reviseInformationEntryAssociationPolicy({
      expectedRevision: 0,
      contentWeight: 50,
      typeWeight: 25,
      domainWeight: 25,
      threshold: 2_000,
    });
    await client.listInformationEntryAssociations('synthetic/entry', {
      includePrivate: true,
    });
    await client.reviseInformationEntryAssociation(
      'synthetic/entry',
      'related/id',
      {expectedRevision: 0, action: 'block', includePrivate: true},
    );
    await client.listInformationEntryDocuments({includePrivate: true});
    await client.aggregateInformationDocumentTags('synthetic/id', {
      expectedRevision: 0,
    });
    await client.reviseInformationDocumentTags('synthetic/id', {
      expectedRevision: 1,
      tags: ['synthetic'],
    });
    await client.listAiSplitProposals('synthetic/snapshot');
    await client.startAiSplitProposal(
      'synthetic/snapshot',
      'synthetic-split-request',
    );
    await client.acceptAiSplitProposal(
      'synthetic/snapshot',
      'synthetic/proposal',
    );
    await client.rejectAiSplitProposal(
      'synthetic/snapshot',
      'synthetic/proposal',
    );
    await client.listAiTagProposals('synthetic/entry');
    await client.startAiTagProposal('synthetic/entry', 'synthetic-request');
    await client.acceptAiTagProposal('synthetic/entry', 'synthetic/proposal');
    await client.rejectAiTagProposal('synthetic/entry', 'synthetic/proposal');
    await client.listAiAssociationProposals('synthetic/entry', 'related/id');
    await client.startAiAssociationProposal(
      'synthetic/entry',
      'related/id',
      'synthetic-association-request',
    );
    await client.acceptAiAssociationProposal(
      'synthetic/entry',
      'related/id',
      'synthetic/proposal',
    );
    await client.rejectAiAssociationProposal(
      'synthetic/entry',
      'related/id',
      'synthetic/proposal',
    );
    await client.listProcessingRuns(12);
    await client.cancelProcessingRun('synthetic/run', 3);
    await client.listSourceSubscriptions();
    await client.replaceSourceSubscriptions(2, [
      {
        kind: 'github_markdown',
        subscriptionId: '22222222-2222-4222-8222-222222222222',
        label: 'Synthetic',
        enabled: false,
        repositoryUri: 'https://github.com/example/project',
        repositoryRef: 'main',
        repositoryPath: 'docs/source.md',
        profile: 'commonmark-v1',
        sourceAlias: 'synthetic-source',
        isPrivate: false,
        routeAfterImport: false,
        intervalMinutes: 1_440,
      },
    ]);
    await client.runSourceSubscription(
      'synthetic/subscription',
      'synthetic-check',
    );

    expect(requests).toEqual([
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/materialize',
        method: 'POST',
        body: JSON.stringify({
          snapshotId: 'synthetic-snapshot',
          chunkMode: 'split',
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/materialize/manual',
        method: 'POST',
        body: JSON.stringify({
          snapshotId: 'synthetic-snapshot',
          includePrivate: false,
          groups: [
            {
              titlePath: 'Synthetic group',
              fragmentIds: ['synthetic-fragment'],
            },
          ],
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/split-rules/profile',
        method: 'GET',
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/split-rules/profile',
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: 0,
          mode: 'merge_short_adjacent',
          minimumGroupCodePoints: 250,
          maximumGroupCodePoints: 2500,
          maximumFragmentsPerGroup: 6,
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/split-rules/trial',
        method: 'POST',
        body: JSON.stringify({
          snapshotId: 'synthetic-snapshot',
          includePrivate: false,
          profile: {
            revision: 1,
            mode: 'merge_short_adjacent',
            minimumGroupCodePoints: 250,
            maximumGroupCodePoints: 2500,
            maximumFragmentsPerGroup: 6,
          },
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/split-rules/apply',
        method: 'POST',
        body: JSON.stringify({
          snapshotId: 'synthetic-snapshot',
          includePrivate: false,
          expectedProfileRevision: 1,
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/restructure/preview',
        method: 'POST',
        body: JSON.stringify({
          snapshotId: 'synthetic-snapshot',
          includePrivate: false,
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/restructure/apply',
        method: 'POST',
        body: JSON.stringify({
          snapshotId: 'synthetic-snapshot',
          includePrivate: false,
          groups: [],
          planSha256: 'a'.repeat(64),
          acknowledgeAnnotationChanges: true,
          acknowledgeRelationshipChanges: true,
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/synthetic%2Fid',
        method: 'PUT',
        body: JSON.stringify({expectedRevision: 1}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/search',
        method: 'POST',
        body: JSON.stringify({text: 'synthetic'}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/knowledge-graph/view',
        method: 'POST',
        body: JSON.stringify({
          query: 'synthetic',
          includePrivate: true,
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/knowledge-graph/edges/synthetic%2Fentry/related%2Fid',
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: 0,
          operation: 'edit',
          label: '相关',
          direction: 'symmetric',
          includePrivate: true,
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/associations/rebuild',
        method: 'POST',
        body: JSON.stringify({includePrivate: true}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/associations/policy',
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: 0,
          contentWeight: 50,
          typeWeight: 25,
          domainWeight: 25,
          threshold: 2_000,
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/synthetic%2Fentry/associations?includePrivate=true',
        method: 'GET',
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/synthetic%2Fentry/associations/related%2Fid',
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: 0,
          action: 'block',
          includePrivate: true,
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entry-documents?includePrivate=true',
        method: 'GET',
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entry-documents/synthetic%2Fid/tags/aggregate',
        method: 'POST',
        body: JSON.stringify({expectedRevision: 0}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entry-documents/synthetic%2Fid/tags',
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: 1,
          tags: ['synthetic'],
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/evidence/snapshots/synthetic%2Fsnapshot/split-proposals',
        method: 'GET',
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/evidence/snapshots/synthetic%2Fsnapshot/split-proposals/start',
        method: 'POST',
        body: JSON.stringify({requestKey: 'synthetic-split-request'}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/evidence/snapshots/synthetic%2Fsnapshot/split-proposals/synthetic%2Fproposal/accept',
        method: 'POST',
        body: JSON.stringify({}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/evidence/snapshots/synthetic%2Fsnapshot/split-proposals/synthetic%2Fproposal/reject',
        method: 'POST',
        body: JSON.stringify({}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/synthetic%2Fentry/tag-proposals',
        method: 'GET',
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/synthetic%2Fentry/tag-proposals/start',
        method: 'POST',
        body: JSON.stringify({requestKey: 'synthetic-request'}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/synthetic%2Fentry/tag-proposals/synthetic%2Fproposal/accept',
        method: 'POST',
        body: JSON.stringify({}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/synthetic%2Fentry/tag-proposals/synthetic%2Fproposal/reject',
        method: 'POST',
        body: JSON.stringify({}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/knowledge-graph/edges/synthetic%2Fentry/related%2Fid/proposals',
        method: 'GET',
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/knowledge-graph/edges/synthetic%2Fentry/related%2Fid/proposals/start',
        method: 'POST',
        body: JSON.stringify({requestKey: 'synthetic-association-request'}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/knowledge-graph/edges/synthetic%2Fentry/related%2Fid/proposals/synthetic%2Fproposal/accept',
        method: 'POST',
        body: JSON.stringify({}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/knowledge-graph/edges/synthetic%2Fentry/related%2Fid/proposals/synthetic%2Fproposal/reject',
        method: 'POST',
        body: JSON.stringify({}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/processing-runs?limit=12',
        method: 'GET',
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/processing-runs/synthetic%2Frun/cancel',
        method: 'POST',
        body: JSON.stringify({expectedVersion: 3}),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/source-subscriptions',
        method: 'GET',
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/source-subscriptions',
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: 2,
          subscriptions: [
            {
              kind: 'github_markdown',
              subscriptionId: '22222222-2222-4222-8222-222222222222',
              label: 'Synthetic',
              enabled: false,
              repositoryUri: 'https://github.com/example/project',
              repositoryRef: 'main',
              repositoryPath: 'docs/source.md',
              profile: 'commonmark-v1',
              sourceAlias: 'synthetic-source',
              isPrivate: false,
              routeAfterImport: false,
              intervalMinutes: 1_440,
            },
          ],
        }),
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/source-subscriptions/synthetic%2Fsubscription/run',
        method: 'POST',
        body: JSON.stringify({requestKey: 'synthetic-check'}),
      },
    ]);
  });

  it('uses dedicated export and restore routes without exposing filesystem paths', async () => {
    const requests: Readonly<{url: string; body: unknown}>[] = [];
    const client = createM1cApiClient(
      'http://127.0.0.1:3000/',
      (input, init) => {
        if (typeof init?.body !== 'string') {
          throw new Error('Expected a JSON request body.');
        }
        requests.push({
          url: requestUrl(input),
          body: JSON.parse(init.body),
        });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'exported',
              fileName: 'synthetic.workspace-bundle.json',
              byteLength: 12,
              blobCount: 0,
              tableCounts: {workspace: 1},
            }),
            {headers: {'content-type': 'application/json'}},
          ),
        );
      },
    );

    await client.exportWorkspaceBundle();
    await client.restoreWorkspaceBundle('synthetic.workspace-bundle.json');

    expect(requests).toEqual([
      {
        url: 'http://127.0.0.1:3000/api/v1/workspace-bundles/export',
        body: {},
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/workspace-bundles/restore',
        body: {fileName: 'synthetic.workspace-bundle.json'},
      },
    ]);
  });

  it('loads and saves external review preferences through the local API', async () => {
    const requests: Readonly<{
      url: string;
      method: string | undefined;
      body: BodyInit | null | undefined;
    }>[] = [];
    const client = createM1cApiClient(
      'http://127.0.0.1:3000/',
      (input, init) => {
        requests.push({
          url: requestUrl(input),
          method: init?.method,
          body: init?.body,
        });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'ok',
              workspaceId: 'synthetic-workspace',
              quickTags: [],
              automaticKeywords: {
                enabled: true,
                includeLinkDomains: false,
                excludedKeywords: [],
              },
              vocabulary: {aliases: []},
              associationPolicy: DEFAULT_REVIEW_ASSOCIATION_POLICY,
              explorationPolicy: DEFAULT_REVIEW_EXPLORATION_POLICY,
            }),
            {headers: {'content-type': 'application/json'}},
          ),
        );
      },
    );

    await client.loadReviewPreferences();
    await client.saveReviewPreferences({
      quickTags: ['实用工具'],
      automaticKeywords: {
        enabled: true,
        includeLinkDomains: false,
        excludedKeywords: ['广告'],
      },
      vocabulary: {
        aliases: [{source: 'Synthetic CLI', canonical: '工具'}],
      },
    });

    expect(requests).toEqual([
      {
        url: 'http://127.0.0.1:3000/api/v1/preferences/review',
        method: 'GET',
        body: undefined,
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/preferences/review',
        method: 'PUT',
        body: JSON.stringify({
          quickTags: ['实用工具'],
          automaticKeywords: {
            enabled: true,
            includeLinkDomains: false,
            excludedKeywords: ['广告'],
          },
          vocabulary: {
            aliases: [{source: 'Synthetic CLI', canonical: '工具'}],
          },
        }),
      },
    ]);
  });

  it('uses the narrow Entry preference profile read, write, suggestion and trial routes', async () => {
    const requests: {
      url: string;
      method: string | undefined;
      body: unknown;
    }[] = [];
    const profile = {
      revision: 2,
      enabled: true,
      rules: [
        {
          ruleId: '77777777-7777-4777-8777-777777777777',
          dimension: 'usefulness' as const,
          featureKind: 'content_keyword' as const,
          featureIdentity: 'postgresql',
          displayValue: 'PostgreSQL',
          effect: 'prefer' as const,
          weight: 4 as const,
        },
      ],
    };
    const client = createM1cApiClient(
      'http://127.0.0.1:3000/',
      (input, init) => {
        const requestBody = init?.body;
        if (
          requestBody !== undefined &&
          requestBody !== null &&
          typeof requestBody !== 'string'
        ) {
          throw new Error('Expected synthetic JSON request body.');
        }
        requests.push({
          url: requestUrl(input),
          method: init?.method,
          body:
            requestBody === undefined || requestBody === null
              ? undefined
              : JSON.parse(requestBody),
        });
        return Promise.resolve(
          new Response(JSON.stringify({status: 'ok', profile}), {
            headers: {'content-type': 'application/json'},
          }),
        );
      },
    );

    await client.loadInformationEntryPreferenceProfile();
    await client.saveInformationEntryPreferenceProfile({
      expectedRevision: 2,
      enabled: profile.enabled,
      rules: profile.rules,
    });
    await client.suggestInformationEntryPreferenceProfile(true);
    await client.trialInformationEntryPreferenceProfile({
      includePrivate: false,
      expectedProfileRevision: 2,
      profile,
      expectedEntries: [
        {
          entryId: '88888888-8888-4888-8888-888888888888',
          revision: 1,
        },
      ],
    });

    expect(requests).toEqual([
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/preferences/profile',
        method: 'GET',
        body: undefined,
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/preferences/profile',
        method: 'PUT',
        body: {
          expectedRevision: 2,
          enabled: true,
          rules: profile.rules,
        },
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/preferences/profile/suggestions',
        method: 'POST',
        body: {includePrivate: true},
      },
      {
        url: 'http://127.0.0.1:3000/api/v1/entries/preferences/profile/trial',
        method: 'POST',
        body: {
          includePrivate: false,
          expectedProfileRevision: 2,
          profile,
          expectedEntries: [
            {
              entryId: '88888888-8888-4888-8888-888888888888',
              revision: 1,
            },
          ],
        },
      },
    ]);
  });

  it('rejects a stale server without the review-preferences route', async () => {
    const client = createM1cApiClient('http://127.0.0.1:3000/', () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            message: 'Cannot GET /api/v1/preferences/review',
            error: 'Not Found',
            statusCode: 404,
          }),
          {
            status: 404,
            headers: {'content-type': 'application/json'},
          },
        ),
      ),
    );

    await expect(client.loadReviewPreferences()).rejects.toBeInstanceOf(
      M1cApiClientError,
    );
  });

  it('fails visibly for unsafe configuration, network, or response shapes', async () => {
    expect(() => createM1cApiClient('ftp://localhost/')).toThrow(
      M1cApiClientError,
    );
    const unreachable = createM1cApiClient('http://localhost/', () =>
      Promise.reject(new Error('synthetic network error')),
    );
    await expect(unreachable.workspace()).rejects.toBeInstanceOf(
      M1cApiClientError,
    );

    const invalid = createM1cApiClient('http://localhost/', () =>
      Promise.resolve(
        new Response('not json', {
          status: 200,
          headers: {'content-type': 'text/plain'},
        }),
      ),
    );
    await expect(invalid.workspace()).rejects.toBeInstanceOf(M1cApiClientError);
  });
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}
