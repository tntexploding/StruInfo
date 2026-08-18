import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

import {describe, expect, it} from 'vitest';

import {
  deriveCurationTargetId,
  deriveIntakeDecisionId,
  deriveIntakeDecisionRevisionId,
} from '../curation/manual_curation_identity.js';
import {
  type ApplyManualKnowledgeChangeSetRequest,
  type KnowledgeIssue,
  type KnowledgeItemRevisionValue,
  KNOWLEDGE_KINDS,
  type KnowledgeProvenanceInput,
  type KnowledgeRelationRevisionValue,
  type ManualKnowledgeContext,
  type ManualKnowledgeOperation,
  type ManualKnowledgePreparation,
  type ManualKnowledgeRepositoryPort,
  type ManualKnowledgeRepositorySnapshot,
  type ManualKnowledgeTransactionPort,
  type PreparedManualKnowledgePlan,
  deriveKnowledgeChangeSetId,
  deriveKnowledgeCommittedEventId,
  deriveKnowledgeItemRevisionId,
  deriveKnowledgeRelationRevisionId,
  digestManualKnowledgeCommandProjection,
  encodeManualKnowledgeCommandProjection,
  executeApplyManualKnowledgeChangeSet,
  mapKnowledgePersistenceFailure,
  prepareApplyManualKnowledgeChangeSet,
  resultForCommittedManualKnowledgePlan,
} from './index.js';

const WORKSPACE = uuid(1);
const OTHER_WORKSPACE = uuid(2);
const RESOURCE = uuid(3);
const SNAPSHOT = uuid(4);
const OTHER_SNAPSHOT = uuid(5);
const FRAGMENT = uuid(6);
const OTHER_FRAGMENT = uuid(7);
const ITEM_A = uuid(10);
const ITEM_B = uuid(11);
const RELATION_A = uuid(20);
const RELATION_B = uuid(21);
const SOURCE_TEXT = 'synthetic-source-text';

describe('manual knowledge deterministic identity', () => {
  it('matches the frozen UUIDv5 and canonical request known answers', () => {
    const context = manualContext();
    const request = manualRequest([itemOperation()]);
    const changeSetId = deriveKnowledgeChangeSetId(
      WORKSPACE,
      context.commandIdempotencyKey,
    );

    expect(changeSetId).toBe('1192a1e1-737d-50b9-9c7f-9d027ca5ac26');
    expect(deriveKnowledgeItemRevisionId(ITEM_A, 1)).toBe(
      '9005505e-7d8b-556a-888e-0fef837145dd',
    );
    expect(deriveKnowledgeItemRevisionId(ITEM_A, 2)).toBe(
      '74bbe88c-c497-51d2-a861-17105e7ffa8f',
    );
    expect(deriveKnowledgeRelationRevisionId(RELATION_A, 1)).toBe(
      'a60cc0a4-e978-5863-8f23-9b2a6d34d97f',
    );
    expect(deriveKnowledgeCommittedEventId(changeSetId)).toBe(
      'ca9d0e64-3a7f-5916-a7e1-cbcf67ec9642',
    );
    expect(
      encodeManualKnowledgeCommandProjection(context, request),
    ).toHaveLength(614);
    expect(digestManualKnowledgeCommandProjection(context, request)).toBe(
      '90e1266c1a3ad949bd2606de98fceb83cfb2968a9f6ba1ae296830721183ef73',
    );
  });

  it('makes optional-field presence and operation order part of the digest', () => {
    const context = manualContext();
    const withoutBody = manualRequest([itemOperation()]);
    const withBody = manualRequest([
      itemOperation({value: {...itemValue(), body: 'synthetic-body'}}),
    ]);
    const reversed = manualRequest([
      itemOperation({itemId: ITEM_B, title: 'synthetic-b'}),
      itemOperation(),
    ]);
    const forward = manualRequest([...reversed.operations].reverse());

    expect(
      digestManualKnowledgeCommandProjection(context, withoutBody),
    ).not.toBe(digestManualKnowledgeCommandProjection(context, withBody));
    expect(digestManualKnowledgeCommandProjection(context, forward)).not.toBe(
      digestManualKnowledgeCommandProjection(context, reversed),
    );
  });
});

describe('manual knowledge item behavior', () => {
  it.each(KNOWLEDGE_KINDS)(
    'creates deterministic revision 1 for knowledge kind %s',
    (knowledgeKind) => {
      const operation = itemOperation({
        value: {...itemValue(), knowledgeKind},
      });
      const plan = preparedPlan(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          manualRequest([operation]),
          repositoryState({fragments: [fragmentRow()]}),
        ),
      );

      expect(plan.outcome).toBe('applied');
      expect(plan.itemIdentityInserts).toHaveLength(1);
      expect(plan.itemRevisionInserts[0]).toMatchObject({
        itemId: ITEM_A,
        revision: 1,
        revisionId: deriveKnowledgeItemRevisionId(ITEM_A, 1),
        value: {knowledgeKind},
      });
      expect(plan.itemCurrentPointerCases).toHaveLength(0);
      expect(resultForCommittedManualKnowledgePlan(plan).status).toBe(
        'applied',
      );
      expectDeepFrozen(plan);
    },
  );

  it.each([
    {
      role: 'source_excerpt' as const,
      value: {
        ...itemValue(),
        epistemicRole: 'source_excerpt' as const,
        body: SOURCE_TEXT,
      },
      provenance: provenance({citations: [FRAGMENT]}),
    },
    {
      role: 'source_claim' as const,
      value: {...itemValue(), epistemicRole: 'source_claim' as const},
      provenance: provenance({citations: [FRAGMENT]}),
    },
    {
      role: 'summary' as const,
      value: {...itemValue(), epistemicRole: 'summary' as const},
      provenance: provenance({fragmentDerivations: [FRAGMENT]}),
    },
    {
      role: 'inference' as const,
      value: {...itemValue(), epistemicRole: 'inference' as const},
      provenance: provenance({fragmentDerivations: [FRAGMENT]}),
    },
    {
      role: 'user_assertion' as const,
      value: {...itemValue(), epistemicRole: 'user_assertion' as const},
      provenance: provenance({citations: [FRAGMENT]}),
    },
  ])(
    'admits the closed $role provenance branch',
    ({value, provenance: input}) => {
      const plan = preparedPlan(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          manualRequest([itemOperation({value, provenance: input})]),
          repositoryState({fragments: [fragmentRow()]}),
        ),
      );

      expect(plan.outcome).toBe('applied');
      expect(plan.itemRevisionInserts).toHaveLength(1);
    },
  );

  it('propagates private evidence into items and relations without AI', () => {
    const privateItemPlan = preparedPlan(
      prepareApplyManualKnowledgeChangeSet(
        manualContext('synthetic.knowledge.private-item'),
        manualRequest([itemOperation()]),
        repositoryState({
          fragments: [fragmentRow(FRAGMENT, SOURCE_TEXT, SNAPSHOT, true)],
        }),
      ),
    );
    expect(privateItemPlan.itemRevisionInserts[0]).toMatchObject({
      itemId: ITEM_A,
      isPrivate: true,
    });

    const itemA = existingItemRows(
      ITEM_A,
      1,
      itemValue({title: 'private-endpoint'}),
      provenance({citations: [FRAGMENT]}),
    );
    const itemB = existingItemRows(
      ITEM_B,
      1,
      itemValue({title: 'public-endpoint'}),
      provenance({citations: [FRAGMENT]}),
    );
    const relationPlan = preparedPlan(
      prepareApplyManualKnowledgeChangeSet(
        manualContext('synthetic.knowledge.private-relation'),
        manualRequest([relationOperation()]),
        repositoryState({
          fragments: [fragmentRow()],
          items: [itemA.item, itemB.item],
          revisions: [{...itemA.revision, isPrivate: true}, itemB.revision],
        }),
      ),
    );
    expect(relationPlan.relationRevisionInserts[0]).toMatchObject({
      relationId: RELATION_A,
      isPrivate: true,
    });
  });

  it('revises, withdraws, and reactivates through append-only revisions', () => {
    const baseProvenance = provenance({citations: [FRAGMENT]});
    const existingValue = itemValue({title: 'synthetic-before'});
    const revision = existingItemRows(ITEM_A, 1, existingValue, baseProvenance);
    const revise = preparedPlan(
      prepareApplyManualKnowledgeChangeSet(
        manualContext('synthetic.knowledge.revise'),
        manualRequest([
          itemOperation({
            expectedRevision: 1,
            value: itemValue({title: 'synthetic-after'}),
          }),
        ]),
        repositoryState({
          fragments: [fragmentRow()],
          items: [revision.item],
          revisions: [revision.revision],
        }),
      ),
    );
    expect(revise.itemRevisionInserts[0]).toMatchObject({
      revision: 2,
      previousRevisionId: deriveKnowledgeItemRevisionId(ITEM_A, 1),
    });
    expect(revise.itemCurrentPointerCases).toEqual([
      {
        workspaceId: WORKSPACE,
        stableId: ITEM_A,
        expectedRevision: 1,
        nextRevision: 2,
        nextRevisionId: deriveKnowledgeItemRevisionId(ITEM_A, 2),
      },
    ]);

    const withdrawn = existingItemRows(
      ITEM_A,
      2,
      itemValue({title: 'synthetic-after', reviewState: 'withdrawn'}),
      baseProvenance,
    );
    const reactivate = preparedPlan(
      prepareApplyManualKnowledgeChangeSet(
        manualContext('synthetic.knowledge.reactivate'),
        manualRequest([
          itemOperation({
            expectedRevision: 2,
            value: itemValue({
              title: 'synthetic-after',
              reviewState: 'confirmed',
            }),
          }),
        ]),
        repositoryState({
          fragments: [fragmentRow()],
          items: [withdrawn.item],
          revisions: [withdrawn.revision],
        }),
      ),
    );
    expect(reactivate.itemRevisionInserts[0]?.revision).toBe(3);
  });

  it('stores an unchanged command and event without a domain revision', () => {
    const input = provenance({citations: [FRAGMENT]});
    const value = itemValue();
    const existing = existingItemRows(ITEM_A, 1, value, input);
    const plan = preparedPlan(
      prepareApplyManualKnowledgeChangeSet(
        manualContext('synthetic.knowledge.unchanged'),
        manualRequest([
          itemOperation({expectedRevision: 1, value, provenance: input}),
        ]),
        repositoryState({
          fragments: [fragmentRow()],
          items: [existing.item],
          revisions: [existing.revision],
        }),
      ),
    );

    expect(plan.outcome).toBe('unchanged');
    expect(plan.itemRevisionInserts).toHaveLength(0);
    expect(plan.itemCurrentPointerCases).toHaveLength(0);
    expect(plan.changeSetInsert.originalOutcome).toBe('unchanged');
    expect(plan.eventInsert.eventKind).toBe('knowledge_change_set_committed');
    expect(resultForCommittedManualKnowledgePlan(plan).status).toBe(
      'unchanged',
    );
  });

  it.each([
    [1, 'item_not_found', 'request.operations[0].itemId'],
    [-0, 'invalid_state', 'request.operations[0].expectedRevision'],
    [-1, 'invalid_state', 'request.operations[0].expectedRevision'],
    [1.5, 'invalid_state', 'request.operations[0].expectedRevision'],
    [Number.NaN, 'invalid_state', 'request.operations[0].expectedRevision'],
  ] as const)(
    'rejects invalid or missing requested item revision %s',
    (expectedRevision, code, path) => {
      const issue = rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          manualRequest([itemOperation({expectedRevision})]),
          repositoryState({fragments: [fragmentRow()]}),
        ),
      );
      expect(issue).toEqual({code, path});
    },
  );

  it('rejects stale existing state and withdrawn first revisions', () => {
    const input = provenance({citations: [FRAGMENT]});
    const existing = existingItemRows(ITEM_A, 1, itemValue(), input);
    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          manualRequest([itemOperation({expectedRevision: 0})]),
          repositoryState({
            fragments: [fragmentRow()],
            items: [existing.item],
            revisions: [existing.revision],
          }),
        ),
      ),
    ).toEqual({
      code: 'stale_revision',
      path: 'request.operations[0].expectedRevision',
    });
    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext('synthetic.knowledge.first-withdrawn'),
          manualRequest([
            itemOperation({value: itemValue({reviewState: 'withdrawn'})}),
          ]),
          repositoryState({fragments: [fragmentRow()]}),
        ),
      ),
    ).toEqual({
      code: 'invalid_state',
      path: 'request.operations[0].value.reviewState',
    });
  });
});

describe('manual knowledge authorization and provenance', () => {
  it('authorizes one current eligible Snapshot target and records its exact receipt', () => {
    const {authorization, state, targetId, decisionId, decisionRevisionId} =
      eligibleSnapshotFixture();
    const plan = preparedPlan(
      prepareApplyManualKnowledgeChangeSet(
        manualContext('synthetic.knowledge.eligible'),
        {authorization, operations: [itemOperation()]},
        state,
      ),
    );

    expect(plan.receipt.authorization).toEqual({
      kind: 'eligible_target',
      targetId,
      decisionId,
      decisionRevision: 1,
      decisionRevisionId,
    });
  });

  it.each(['full', 'split', 'condense'] as const)(
    'admits current %s decisions for an exact Fragment target',
    (action) => {
      const target = {kind: 'fragment' as const, fragmentId: FRAGMENT};
      const targetId = deriveCurationTargetId(WORKSPACE, target);
      const decisionId = deriveIntakeDecisionId(targetId);
      const decisionRevisionId = deriveIntakeDecisionRevisionId(decisionId, 1);
      const plan = preparedPlan(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(`synthetic.knowledge.fragment-${action}`),
          {
            authorization: {
              kind: 'eligible_target',
              target,
              expectedDecisionRevision: 1,
            },
            operations: [itemOperation()],
          },
          repositoryState({
            curationTargets: [
              {
                workspaceId: WORKSPACE,
                targetId,
                kind: 'fragment',
                fragmentId: FRAGMENT,
              },
            ],
            intakeDecisions: [
              {
                workspaceId: WORKSPACE,
                targetId,
                decisionId,
                currentRevision: 1,
                currentRevisionId: decisionRevisionId,
                action,
              },
            ],
            fragments: [fragmentRow()],
          }),
        ),
      );
      expect(plan.receipt.authorization).toMatchObject({
        kind: 'eligible_target',
        targetId,
      });
    },
  );

  it.each([
    ['missing', 'curation_target_not_found', 'request.authorization.target'],
    ['ineligible', 'curation_not_eligible', 'request.authorization'],
    [
      'stale',
      'stale_curation_revision',
      'request.authorization.expectedDecisionRevision',
    ],
  ] as const)('rejects %s eligible authorization', (scenario, code, path) => {
    const fixture = eligibleSnapshotFixture(
      scenario === 'ineligible' ? 'ignore' : 'full',
    );
    const state =
      scenario === 'missing'
        ? repositoryState({fragments: [fragmentRow()]})
        : fixture.state;
    const authorization =
      scenario === 'stale'
        ? {...fixture.authorization, expectedDecisionRevision: 2}
        : fixture.authorization;
    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          {authorization, operations: [itemOperation()]},
          state,
        ),
      ),
    ).toEqual({code, path});
  });

  it('rejects missing, out-of-scope, and mismatched excerpt evidence safely', () => {
    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          manualRequest([itemOperation()]),
          repositoryState(),
        ),
      ),
    ).toEqual({
      code: 'fragment_not_found',
      path: 'request.operations[0].provenance.citations[0]',
    });

    const fixture = eligibleSnapshotFixture();
    const outOfScope = fragmentRow(OTHER_FRAGMENT, SOURCE_TEXT, OTHER_SNAPSHOT);
    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          {
            authorization: fixture.authorization,
            operations: [
              itemOperation({
                provenance: provenance({citations: [OTHER_FRAGMENT]}),
              }),
            ],
          },
          repositoryState({
            curationTargets: fixture.state.curationTargets,
            intakeDecisions: fixture.state.intakeDecisions,
            fragments: [outOfScope],
          }),
        ),
      ),
    ).toEqual({
      code: 'fragment_out_of_scope',
      path: 'request.operations[0].provenance.citations[0]',
    });

    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          manualRequest([
            itemOperation({
              value: {
                ...itemValue(),
                epistemicRole: 'source_excerpt',
                body: 'synthetic-mismatch',
              },
            }),
          ]),
          repositoryState({fragments: [fragmentRow()]}),
        ),
      ),
    ).toEqual({
      code: 'invalid_provenance',
      path: 'request.operations[0].value.body',
    });
  });

  it('resolves an exact historical item revision and persists its typed input', () => {
    const source = existingItemRows(
      ITEM_B,
      1,
      itemValue({title: 'synthetic-input'}),
      provenance({citations: [FRAGMENT]}),
    );
    const derivation = provenance({
      knowledgeDerivations: [{kind: 'item', itemId: ITEM_B, revision: 1}],
    });
    const plan = preparedPlan(
      prepareApplyManualKnowledgeChangeSet(
        manualContext(),
        manualRequest([
          itemOperation({
            value: {...itemValue(), epistemicRole: 'summary'},
            provenance: derivation,
          }),
        ]),
        repositoryState({
          items: [source.item],
          revisions: [source.revision],
        }),
      ),
    );

    expect(plan.knowledgeRevisionItemInputs).toEqual([
      {
        workspaceId: WORKSPACE,
        itemId: ITEM_A,
        revision: 1,
        revisionId: deriveKnowledgeItemRevisionId(ITEM_A, 1),
        inputOrdinal: 0,
        inputItemId: ITEM_B,
        inputRevision: 1,
        inputRevisionId: deriveKnowledgeItemRevisionId(ITEM_B, 1),
      },
    ]);
  });

  it('resolves an exact historical relation revision and persists its typed input', () => {
    const relationRevisionId = deriveKnowledgeRelationRevisionId(RELATION_A, 1);
    const relation = relationValue();
    const derivation = provenance({
      knowledgeDerivations: [
        {kind: 'relation', relationId: RELATION_A, revision: 1},
      ],
    });
    const plan = preparedPlan(
      prepareApplyManualKnowledgeChangeSet(
        manualContext('synthetic.knowledge.relation-derivation'),
        manualRequest([
          itemOperation({
            value: {...itemValue(), epistemicRole: 'summary'},
            provenance: derivation,
          }),
        ]),
        repositoryState({
          relations: [
            {
              workspaceId: WORKSPACE,
              relationId: RELATION_A,
              subjectItemId: relation.subjectItemId,
              relationTypeKey: relation.relationTypeKey,
              objectItemId: relation.objectItemId,
              currentRevision: 1,
              currentRevisionId: relationRevisionId,
            },
          ],
          relationRevisions: [
            {
              workspaceId: WORKSPACE,
              relationId: RELATION_A,
              revision: 1,
              revisionId: relationRevisionId,
              value: relation,
              provenance: provenance({citations: [FRAGMENT]}),
            },
          ],
        }),
      ),
    );

    expect(plan.knowledgeRevisionRelationInputs).toEqual([
      {
        workspaceId: WORKSPACE,
        itemId: ITEM_A,
        revision: 1,
        revisionId: deriveKnowledgeItemRevisionId(ITEM_A, 1),
        inputOrdinal: 0,
        inputRelationId: RELATION_A,
        inputRevision: 1,
        inputRevisionId: relationRevisionId,
      },
    ]);
  });

  it('enforces all-empty, duplicate, same-command, and inference precedence', () => {
    const empty = provenance();
    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          manualRequest([itemOperation({provenance: empty})]),
          repositoryState(),
        ),
      ),
    ).toEqual({
      code: 'invalid_provenance',
      path: 'request.operations[0].provenance',
    });

    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          manualRequest([
            itemOperation({
              provenance: provenance({citations: [FRAGMENT, FRAGMENT]}),
            }),
          ]),
          repositoryState(),
        ),
      ),
    ).toEqual({
      code: 'invalid_provenance',
      path: 'request.operations[0].provenance.citations[1]',
    });

    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          manualRequest([
            itemOperation({
              value: {...itemValue(), epistemicRole: 'summary'},
              provenance: provenance({
                knowledgeDerivations: [
                  {kind: 'item', itemId: ITEM_A, revision: 1},
                ],
              }),
            }),
          ]),
          repositoryState(),
        ),
      ),
    ).toEqual({
      code: 'invalid_provenance',
      path: 'request.operations[0].provenance.knowledgeDerivations[0]',
    });

    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          manualRequest([
            itemOperation({
              value: {...itemValue(), epistemicRole: 'inference'},
              provenance: provenance({citations: [FRAGMENT]}),
            }),
          ]),
          repositoryState({fragments: [fragmentRow()]}),
        ),
      ),
    ).toEqual({
      code: 'invalid_provenance',
      path: 'request.operations[0].provenance',
    });
  });

  it('preflights every provenance array shape before reading any element', () => {
    const input = structuredClone(itemOperation());
    const mutableCitations = input.provenance.citations as unknown as string[];
    mutableCitations[0] = 'not-a-uuid';
    const sparse = new Array<string>(1);
    Object.defineProperty(input.provenance, 'fragmentDerivations', {
      value: sparse,
      enumerable: true,
      configurable: true,
      writable: true,
    });

    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          manualRequest([input]),
          repositoryState(),
        ),
      ),
    ).toEqual({
      code: 'invalid_shape',
      path: 'request.operations[0].provenance.fragmentDerivations',
    });
  });
});

describe('manual knowledge relation and atomic graph behavior', () => {
  it('creates same-command endpoints and a relation regardless of operation order', () => {
    const operations: ManualKnowledgeOperation[] = [
      relationOperation(),
      itemOperation({itemId: ITEM_A, title: 'synthetic-a'}),
      itemOperation({itemId: ITEM_B, title: 'synthetic-b'}),
    ];
    const plan = preparedPlan(
      prepareApplyManualKnowledgeChangeSet(
        manualContext('synthetic.knowledge.graph'),
        manualRequest(operations),
        repositoryState({fragments: [fragmentRow()]}),
      ),
    );

    expect(plan.itemIdentityInserts.map((row) => row.itemId)).toEqual([
      ITEM_A,
      ITEM_B,
    ]);
    expect(plan.relationIdentityInserts).toHaveLength(1);
    expect(plan.receipt.operations.map((row) => row.operationKind)).toEqual([
      'put_relation',
      'put_item',
      'put_item',
    ]);
    expect(plan.outcome).toBe('applied');
  });

  it('supports unchanged and parallel relation identities while rejecting self edges', () => {
    const closure = relationClosure();
    const unchanged = preparedPlan(
      prepareApplyManualKnowledgeChangeSet(
        manualContext('synthetic.knowledge.relation-unchanged'),
        manualRequest([relationOperation({expectedRevision: 1})]),
        closure,
      ),
    );
    expect(unchanged.outcome).toBe('unchanged');
    expect(unchanged.relationRevisionInserts).toHaveLength(0);

    const parallelState = endpointState();
    const parallel = preparedPlan(
      prepareApplyManualKnowledgeChangeSet(
        manualContext('synthetic.knowledge.parallel'),
        manualRequest([relationOperation({relationId: RELATION_B})]),
        parallelState,
      ),
    );
    expect(parallel.relationIdentityInserts[0]?.relationId).toBe(RELATION_B);

    const self = rejectedIssue(
      prepareApplyManualKnowledgeChangeSet(
        manualContext('synthetic.knowledge.self'),
        manualRequest([
          relationOperation({
            value: relationValue({objectItemId: ITEM_A}),
          }),
        ]),
        endpointState([ITEM_A]),
      ),
    );
    expect(self).toEqual({
      code: 'invalid_relation',
      path: 'request.operations[0].value.objectItemId',
    });
  });

  it('rejects immutable natural-identity changes in field order', () => {
    const closure = relationClosure();
    const issue = rejectedIssue(
      prepareApplyManualKnowledgeChangeSet(
        manualContext(),
        manualRequest([
          relationOperation({
            expectedRevision: 1,
            value: relationValue({relationTypeKey: 'synthetic-other-type'}),
          }),
        ]),
        closure,
      ),
    );

    expect(issue).toEqual({
      code: 'invalid_relation',
      path: 'request.operations[0].value.relationTypeKey',
    });
  });

  it('revises and withdraws a relation without changing either endpoint', () => {
    const closure = relationClosure();
    const revised = preparedPlan(
      prepareApplyManualKnowledgeChangeSet(
        manualContext('synthetic.knowledge.relation-revise'),
        manualRequest([
          relationOperation({
            expectedRevision: 1,
            value: relationValue({qualifier: 'synthetic-qualifier'}),
          }),
        ]),
        closure,
      ),
    );
    expect(revised.relationRevisionInserts[0]).toMatchObject({
      revision: 2,
      previousRevisionId: deriveKnowledgeRelationRevisionId(RELATION_A, 1),
      value: {qualifier: 'synthetic-qualifier'},
    });
    expect(revised.relationCurrentPointerCases).toHaveLength(1);

    const withdrawn = preparedPlan(
      prepareApplyManualKnowledgeChangeSet(
        manualContext('synthetic.knowledge.relation-withdraw'),
        manualRequest([
          relationOperation({
            expectedRevision: 1,
            value: relationValue({reviewState: 'withdrawn'}),
          }),
        ]),
        closure,
      ),
    );
    expect(withdrawn.relationRevisionInserts[0]?.value.reviewState).toBe(
      'withdrawn',
    );
  });

  it('keeps mixed applied and unchanged operation receipts atomic and ordered', () => {
    const input = provenance({citations: [FRAGMENT]});
    const itemA = existingItemRows(ITEM_A, 1, itemValue(), input);
    const itemB = existingItemRows(
      ITEM_B,
      1,
      itemValue({title: 'synthetic-before'}),
      input,
    );
    const plan = preparedPlan(
      prepareApplyManualKnowledgeChangeSet(
        manualContext('synthetic.knowledge.mixed'),
        manualRequest([
          itemOperation({expectedRevision: 1}),
          itemOperation({
            itemId: ITEM_B,
            expectedRevision: 1,
            title: 'synthetic-after',
          }),
        ]),
        repositoryState({
          fragments: [fragmentRow()],
          items: [itemA.item, itemB.item],
          revisions: [itemA.revision, itemB.revision],
        }),
      ),
    );

    expect(plan.outcome).toBe('applied');
    expect(
      plan.receipt.operations.map((operation) => operation.outcome),
    ).toEqual(['unchanged', 'applied']);
    expect(plan.itemRevisionInserts).toHaveLength(1);
    expect(plan.itemRevisionInserts[0]?.itemId).toBe(ITEM_B);
  });
});

describe('manual knowledge replay, ownership, and malformed input', () => {
  it('replays the exact stored receipt and rejects same-key digest drift', () => {
    const context = manualContext('synthetic.knowledge.replay');
    const request = manualRequest([itemOperation()]);
    const initial = preparedPlan(
      prepareApplyManualKnowledgeChangeSet(
        context,
        request,
        repositoryState({fragments: [fragmentRow()]}),
      ),
    );
    const replayState = storedCommandState(initial);

    const replay = prepareApplyManualKnowledgeChangeSet(
      context,
      request,
      replayState,
    );
    expect(resolvedResult(replay).status).toBe('replayed');
    expectDeepFrozen(resolvedResult(replay));

    const conflict = prepareApplyManualKnowledgeChangeSet(
      context,
      manualRequest([itemOperation({title: 'synthetic-drift'})]),
      replayState,
    );
    expect(rejectedIssue(conflict)).toEqual({
      code: 'idempotency_conflict',
      path: 'context.commandIdempotencyKey',
    });
  });

  it('rejects a stored eligible receipt whose decision identity is not derived from its target', () => {
    const context = manualContext('synthetic.knowledge.eligible-replay');
    const fixture = eligibleSnapshotFixture();
    const request = {
      authorization: fixture.authorization,
      operations: [itemOperation()],
    };
    const plan = preparedPlan(
      prepareApplyManualKnowledgeChangeSet(context, request, fixture.state),
    );
    const stored = structuredClone(storedCommandState(plan));
    const unrelatedDecisionId = uuid(99);
    const changeSet = stored.changeSets[0];
    if (changeSet?.authorization.kind !== 'eligible_target') {
      throw new Error('Expected an eligible stored authorization fixture.');
    }
    const mutableChangeSet = changeSet as unknown as {
      authorization: {
        kind: 'eligible_target';
        targetId: string;
        decisionId: string;
        decisionRevision: number;
        decisionRevisionId: string;
      };
    };
    mutableChangeSet.authorization.decisionId = unrelatedDecisionId;
    mutableChangeSet.authorization.decisionRevisionId =
      deriveIntakeDecisionRevisionId(unrelatedDecisionId, 1);

    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(context, request, stored),
      ),
    ).toEqual({code: 'invalid_shape', path: 'state'});
  });

  it('owns and deeply freezes decoded values despite later caller mutation', () => {
    const context = manualContext('synthetic.knowledge.owned');
    const request = manualRequest([itemOperation()]);
    const plan = preparedPlan(
      prepareApplyManualKnowledgeChangeSet(
        context,
        request,
        repositoryState({fragments: [fragmentRow()]}),
      ),
    );
    const digest = plan.requestSha256;

    const mutableContext = context as {commandIdempotencyKey: string};
    const mutableOperation = request.operations[0] as unknown as {
      value: {title: string};
      provenance: {citations: string[]};
    };
    mutableContext.commandIdempotencyKey = 'synthetic.mutated';
    mutableOperation.value.title = 'synthetic-mutated-title';
    mutableOperation.provenance.citations[0] = OTHER_FRAGMENT;

    expect(plan.requestSha256).toBe(digest);
    expect(plan.receipt.commandIdempotencyKey).toBe(
      'synthetic.knowledge.owned',
    );
    expect(plan.itemRevisionInserts[0]?.value.title).toBe('synthetic-title');
    expect(plan.knowledgeRevisionFragmentInputs[0]?.fragmentId).toBe(FRAGMENT);
    expectDeepFrozen(plan);
  });

  it('rejects Proxy, accessor, symbol, sparse, cyclic, and custom-prototype inputs', () => {
    let traps = 0;
    const proxied = new Proxy(manualRequest([itemOperation()]), {
      get() {
        traps += 1;
        return undefined;
      },
      getOwnPropertyDescriptor() {
        traps += 1;
        return undefined;
      },
      getPrototypeOf() {
        traps += 1;
        return Object.prototype;
      },
      ownKeys() {
        traps += 1;
        return [];
      },
    });
    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          proxied,
          repositoryState(),
        ),
      ),
    ).toEqual({code: 'invalid_shape', path: 'request'});
    expect(traps).toBe(0);

    let getterCalls = 0;
    const accessorValue = {...itemValue()} as Record<string, unknown>;
    Object.defineProperty(accessorValue, 'title', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'synthetic-accessor';
      },
    });
    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          manualRequest([itemOperation({value: accessorValue as never})]),
          repositoryState(),
        ),
      ),
    ).toEqual({
      code: 'invalid_shape',
      path: 'request.operations[0].value.title',
    });
    expect(getterCalls).toBe(0);

    const symbolRequest = manualRequest([itemOperation()]) as unknown as Record<
      PropertyKey,
      unknown
    >;
    symbolRequest[Symbol('synthetic')] = true;
    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          symbolRequest,
          repositoryState(),
        ),
      ).code,
    ).toBe('invalid_shape');

    const sparse = manualRequest([itemOperation()]) as unknown as {
      operations: unknown[];
    };
    sparse.operations = new Array(1);
    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          sparse,
          repositoryState(),
        ),
      ),
    ).toEqual({code: 'invalid_shape', path: 'request.operations'});

    const cyclic = manualRequest([itemOperation()]) as unknown as Record<
      string,
      unknown
    >;
    cyclic.authorization = cyclic;
    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          cyclic,
          repositoryState(),
        ),
      ).code,
    ).toBe('invalid_shape');

    const custom = Object.create({}) as Record<string, unknown>;
    Object.assign(custom, manualContext());
    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          custom,
          manualRequest([itemOperation()]),
          repositoryState(),
        ),
      ),
    ).toEqual({code: 'invalid_shape', path: 'context'});
  });

  it('rejects inherited accessors without invoking them', () => {
    const previous = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'effectiveWorkspaceId',
    );
    let setterCalls = 0;
    try {
      Object.defineProperty(Object.prototype, 'effectiveWorkspaceId', {
        configurable: true,
        set() {
          setterCalls += 1;
        },
      });
      expect(
        rejectedIssue(
          prepareApplyManualKnowledgeChangeSet(
            manualContext(),
            manualRequest([itemOperation()]),
            repositoryState(),
          ),
        ),
      ).toEqual({
        code: 'invalid_shape',
        path: 'context.effectiveWorkspaceId',
      });
      expect(setterCalls).toBe(0);
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(Object.prototype, 'effectiveWorkspaceId');
      } else {
        Object.defineProperty(
          Object.prototype,
          'effectiveWorkspaceId',
          previous,
        );
      }
    }
  });

  it('enforces operation, provenance, and Unicode code-point budgets first', () => {
    const tooManyOperations = Array.from({length: 65}, () => itemOperation());
    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          manualRequest(tooManyOperations),
          repositoryState(),
        ),
      ),
    ).toEqual({
      code: 'limit_exceeded',
      path: 'request.operations',
      budget: 'change_set_operations',
    });

    const tooMuchProvenance = Array.from({length: 65}, () => 'not-a-uuid');
    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          manualRequest([
            itemOperation({
              provenance: provenance({citations: tooMuchProvenance}),
            }),
          ]),
          repositoryState(),
        ),
      ),
    ).toEqual({
      code: 'limit_exceeded',
      path: 'request.operations[0].provenance',
      budget: 'operation_provenance_inputs',
    });

    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          manualRequest([itemOperation({title: '😀'.repeat(301)})]),
          repositoryState(),
        ),
      ),
    ).toEqual({
      code: 'limit_exceeded',
      path: 'request.operations[0].value.title',
      budget: 'title_code_points',
    });
  });

  it('rejects malformed repository ordering, supersets, and cross-workspace rows', () => {
    const request = manualRequest([
      itemOperation({
        provenance: provenance({citations: [FRAGMENT, OTHER_FRAGMENT]}),
      }),
    ]);
    const reversedFragments = [
      fragmentRow(OTHER_FRAGMENT),
      fragmentRow(FRAGMENT),
    ].sort((left, right) => (left.fragmentId < right.fragmentId ? 1 : -1));
    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          request,
          repositoryState({fragments: reversedFragments}),
        ),
      ),
    ).toEqual({code: 'invalid_shape', path: 'state'});

    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          manualRequest([itemOperation()]),
          repositoryState({
            fragments: [fragmentRow(), fragmentRow(OTHER_FRAGMENT)],
          }),
        ),
      ),
    ).toEqual({code: 'invalid_shape', path: 'state'});

    expect(
      rejectedIssue(
        prepareApplyManualKnowledgeChangeSet(
          manualContext(),
          manualRequest([itemOperation()]),
          repositoryState({
            fragments: [{...fragmentRow(), workspaceId: OTHER_WORKSPACE}],
          }),
        ),
      ),
    ).toEqual({code: 'invalid_shape', path: 'state'});
  });
});

describe('manual knowledge repository orchestration', () => {
  it('loads and persists one plan in FK-safe deterministic order', async () => {
    const repository = new RecordingRepository(
      repositoryState({fragments: [fragmentRow()]}),
    );
    const result = await executeApplyManualKnowledgeChangeSet(
      repository,
      manualContext('synthetic.knowledge.execute'),
      manualRequest([itemOperation()]),
    );

    expect(result.status).toBe('applied');
    expect(repository.calls).toEqual([
      'transaction',
      'lock_snapshot',
      'insert_change_set',
      'insert_item',
      'insert_change_operation',
      'insert_item_revision',
      'insert_item_fragment_input',
      'insert_event',
    ]);
    expect(repository.query).toMatchObject({
      workspaceId: WORKSPACE,
      commandIdempotencyKey: 'synthetic.knowledge.execute',
      primaryItemIds: [ITEM_A],
      fragmentIds: [FRAGMENT],
    });
    expectDeepFrozen(repository.query);
  });

  it('maps adapter failures to one safe issue and exposes no partial plan', async () => {
    const repository = new RecordingRepository(
      repositoryState({fragments: [fragmentRow()]}),
      'insert_item_revision',
    );
    const result = await executeApplyManualKnowledgeChangeSet(
      repository,
      manualContext(),
      manualRequest([itemOperation()]),
    );

    expect(result).toEqual({
      status: 'rejected',
      issue: {code: 'persistence_failed', path: 'persistence'},
    });
    expect(Object.keys(result)).toEqual(['status', 'issue']);
    expect(JSON.stringify(result)).not.toContain('synthetic-driver-secret');
    expect(mapKnowledgePersistenceFailure()).toEqual(result);
  });

  it('does not start a transaction for malformed closed input', async () => {
    const repository = new RecordingRepository(repositoryState());
    const result = await executeApplyManualKnowledgeChangeSet(
      repository,
      {...manualContext(), extra: true},
      manualRequest([itemOperation()]),
    );

    expect(result).toEqual({
      status: 'rejected',
      issue: {code: 'invalid_shape', path: 'context'},
    });
    expect(repository.calls).toEqual([]);
  });

  it('keeps production modules independent of runtime, network, database, and AI imports', async () => {
    const moduleUrls = [
      new URL('./manual_knowledge.ts', import.meta.url),
      new URL('./manual_knowledge_contract.ts', import.meta.url),
      new URL('./manual_knowledge_identity.ts', import.meta.url),
      new URL('./manual_knowledge_repository.ts', import.meta.url),
      new URL('./closed_manual_knowledge_input.ts', import.meta.url),
    ];
    const sources = await Promise.all(
      moduleUrls.map((url) => readFile(url, 'utf8')),
    );
    const forbidden =
      /(?:from|import\s*\()\s*['"](?:@nestjs|pg|drizzle|pg-boss|node:fs|node:http|node:https|node:net|node:tls|node:dns|node:process|node:os|playwright|openai)/u;

    for (const source of sources) {
      expect(source).not.toMatch(forbidden);
      expect(source).not.toContain('Date.now(');
      expect(source).not.toContain('Math.random(');
    }
  });
});

function uuid(value: number): string {
  return `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function sha256(value: string): string {
  return createHash('sha256')
    .update(new TextEncoder().encode(value))
    .digest('hex');
}

function manualContext(
  commandIdempotencyKey = 'synthetic.knowledge.0001',
): ManualKnowledgeContext {
  return {
    effectiveWorkspaceId: WORKSPACE,
    commandIdempotencyKey,
    authority: 'manual_user',
  };
}

function provenance(
  values: Partial<KnowledgeProvenanceInput> = {},
): KnowledgeProvenanceInput {
  return {
    citations: values.citations ?? [],
    fragmentDerivations: values.fragmentDerivations ?? [],
    knowledgeDerivations: values.knowledgeDerivations ?? [],
  };
}

function itemValue(
  values: Partial<KnowledgeItemRevisionValue> = {},
): KnowledgeItemRevisionValue {
  return {
    knowledgeKind: values.knowledgeKind ?? 'concept',
    epistemicRole: values.epistemicRole ?? 'source_claim',
    reviewState: values.reviewState ?? 'confirmed',
    title: values.title ?? 'synthetic-title',
    ...(Object.hasOwn(values, 'body') ? {body: values.body} : {}),
  };
}

function relationValue(
  values: Partial<KnowledgeRelationRevisionValue> = {},
): KnowledgeRelationRevisionValue {
  return {
    subjectItemId: values.subjectItemId ?? ITEM_A,
    relationTypeKey: values.relationTypeKey ?? 'synthetic-related-to',
    objectItemId: values.objectItemId ?? ITEM_B,
    epistemicRole: values.epistemicRole ?? 'source_claim',
    reviewState: values.reviewState ?? 'confirmed',
    ...(Object.hasOwn(values, 'qualifier')
      ? {qualifier: values.qualifier}
      : {}),
  };
}

function itemOperation(
  values: Readonly<{
    itemId?: string;
    expectedRevision?: number;
    title?: string;
    value?: KnowledgeItemRevisionValue;
    provenance?: KnowledgeProvenanceInput;
  }> = {},
): Extract<ManualKnowledgeOperation, {kind: 'put_item'}> {
  return {
    kind: 'put_item',
    itemId: values.itemId ?? ITEM_A,
    expectedRevision: values.expectedRevision ?? 0,
    value:
      values.value ??
      itemValue(values.title === undefined ? {} : {title: values.title}),
    provenance: values.provenance ?? provenance({citations: [FRAGMENT]}),
  };
}

function relationOperation(
  values: Readonly<{
    relationId?: string;
    expectedRevision?: number;
    value?: KnowledgeRelationRevisionValue;
    provenance?: KnowledgeProvenanceInput;
  }> = {},
): Extract<ManualKnowledgeOperation, {kind: 'put_relation'}> {
  return {
    kind: 'put_relation',
    relationId: values.relationId ?? RELATION_A,
    expectedRevision: values.expectedRevision ?? 0,
    value: values.value ?? relationValue(),
    provenance: values.provenance ?? provenance({citations: [FRAGMENT]}),
  };
}

function manualRequest(
  operations: readonly ManualKnowledgeOperation[],
): ApplyManualKnowledgeChangeSetRequest {
  return {authorization: {kind: 'manual_edit'}, operations};
}

function fragmentRow(
  fragmentId = FRAGMENT,
  text = SOURCE_TEXT,
  snapshotId = SNAPSHOT,
  isPrivate = false,
): ManualKnowledgeRepositorySnapshot['fragments'][number] {
  return {
    workspaceId: WORKSPACE,
    resourceId: RESOURCE,
    snapshotId,
    fragmentId,
    selectedTextSha256: sha256(text),
    ...(isPrivate ? {isPrivate: true as const} : {}),
  };
}

function repositoryState(
  values: Partial<ManualKnowledgeRepositorySnapshot> = {},
): ManualKnowledgeRepositorySnapshot {
  return {
    curationTargets: values.curationTargets ?? [],
    intakeDecisions: values.intakeDecisions ?? [],
    fragments: values.fragments ?? [],
    items: values.items ?? [],
    revisions: values.revisions ?? [],
    relations: values.relations ?? [],
    relationRevisions: values.relationRevisions ?? [],
    changeSets: values.changeSets ?? [],
    changeOperations: values.changeOperations ?? [],
    changeEvents: values.changeEvents ?? [],
  };
}

function existingItemRows(
  itemId: string,
  revisionNumber: number,
  value: KnowledgeItemRevisionValue,
  input: KnowledgeProvenanceInput,
): Readonly<{
  item: ManualKnowledgeRepositorySnapshot['items'][number];
  revision: ManualKnowledgeRepositorySnapshot['revisions'][number];
}> {
  const revisionId = deriveKnowledgeItemRevisionId(itemId, revisionNumber);
  return {
    item: {
      workspaceId: WORKSPACE,
      itemId,
      currentRevision: revisionNumber,
      currentRevisionId: revisionId,
    },
    revision: {
      workspaceId: WORKSPACE,
      itemId,
      revision: revisionNumber,
      revisionId,
      ...(revisionNumber === 1
        ? {}
        : {
            previousRevisionId: deriveKnowledgeItemRevisionId(
              itemId,
              revisionNumber - 1,
            ),
          }),
      value,
      provenance: input,
    },
  };
}

function endpointState(ids: readonly string[] = [ITEM_A, ITEM_B]) {
  const rows = ids
    .map((id) =>
      existingItemRows(
        id,
        1,
        itemValue({title: `synthetic-${id.slice(-2)}`}),
        provenance({citations: [FRAGMENT]}),
      ),
    )
    .sort((left, right) =>
      left.item.itemId < right.item.itemId
        ? -1
        : left.item.itemId > right.item.itemId
          ? 1
          : 0,
    );
  return repositoryState({
    fragments: [fragmentRow()],
    items: rows.map((row) => row.item),
    revisions: rows.map((row) => row.revision),
  });
}

function relationClosure(): ManualKnowledgeRepositorySnapshot {
  const endpoints = endpointState();
  const value = relationValue();
  const input = provenance({citations: [FRAGMENT]});
  const revisionId = deriveKnowledgeRelationRevisionId(RELATION_A, 1);
  return repositoryState({
    fragments: endpoints.fragments,
    items: endpoints.items,
    revisions: endpoints.revisions,
    relations: [
      {
        workspaceId: WORKSPACE,
        relationId: RELATION_A,
        subjectItemId: value.subjectItemId,
        relationTypeKey: value.relationTypeKey,
        objectItemId: value.objectItemId,
        currentRevision: 1,
        currentRevisionId: revisionId,
      },
    ],
    relationRevisions: [
      {
        workspaceId: WORKSPACE,
        relationId: RELATION_A,
        revision: 1,
        revisionId,
        value,
        provenance: input,
      },
    ],
  });
}

function eligibleSnapshotFixture(action: 'full' | 'ignore' = 'full') {
  const target = {kind: 'snapshot' as const, snapshotId: SNAPSHOT};
  const targetId = deriveCurationTargetId(WORKSPACE, target);
  const decisionId = deriveIntakeDecisionId(targetId);
  const decisionRevisionId = deriveIntakeDecisionRevisionId(decisionId, 1);
  const authorization = {
    kind: 'eligible_target' as const,
    target,
    expectedDecisionRevision: 1,
  };
  return {
    authorization,
    targetId,
    decisionId,
    decisionRevisionId,
    state: repositoryState({
      curationTargets: [
        {
          workspaceId: WORKSPACE,
          targetId,
          kind: 'snapshot',
          resourceId: RESOURCE,
          snapshotId: SNAPSHOT,
        },
      ],
      intakeDecisions: [
        {
          workspaceId: WORKSPACE,
          targetId,
          decisionId,
          currentRevision: 1,
          currentRevisionId: decisionRevisionId,
          action,
        },
      ],
      fragments: [fragmentRow()],
    }),
  };
}

function storedCommandState(
  plan: PreparedManualKnowledgePlan,
): ManualKnowledgeRepositorySnapshot {
  return repositoryState({
    changeSets: [
      {
        workspaceId: plan.changeSetInsert.workspaceId,
        commandIdempotencyKey: plan.changeSetInsert.commandIdempotencyKey,
        changeSetId: plan.changeSetInsert.changeSetId,
        requestSha256: plan.changeSetInsert.requestSha256,
        authorization: plan.changeSetInsert.authorization,
        originalOutcome: plan.changeSetInsert.originalOutcome,
        operationCount: plan.changeSetInsert.operationCount,
      },
    ],
    changeOperations: plan.changeOperationInserts,
    changeEvents: [plan.eventInsert],
  });
}

function preparedPlan(
  preparation: ManualKnowledgePreparation,
): PreparedManualKnowledgePlan {
  expect(preparation.kind).toBe('prepared');
  if (preparation.kind !== 'prepared') {
    throw new Error(
      `Expected prepared plan, received ${preparation.result.status}.`,
    );
  }
  return preparation.plan;
}

function resolvedResult(preparation: ManualKnowledgePreparation) {
  expect(preparation.kind).toBe('resolved');
  if (preparation.kind !== 'resolved') {
    throw new Error('Expected a resolved result.');
  }
  return preparation.result;
}

function rejectedIssue(
  preparation: ManualKnowledgePreparation,
): KnowledgeIssue {
  const result = resolvedResult(preparation);
  expect(result.status).toBe('rejected');
  if (result.status !== 'rejected') {
    throw new Error(`Expected rejection, received ${result.status}.`);
  }
  expect(Object.keys(result)).toEqual(['status', 'issue']);
  expectDeepFrozen(result);
  return result.issue;
}

function expectDeepFrozen(input: unknown): void {
  if (input === null || typeof input !== 'object') {
    return;
  }
  expect(Object.isFrozen(input)).toBe(true);
  for (const value of Object.values(input)) {
    expectDeepFrozen(value);
  }
}

class RecordingRepository implements ManualKnowledgeRepositoryPort {
  public readonly calls: string[] = [];
  public query: unknown;

  public constructor(
    private readonly snapshot: ManualKnowledgeRepositorySnapshot,
    private readonly failAt?: string,
  ) {}

  public async runCommandTransaction<Value>(
    work: (transaction: ManualKnowledgeTransactionPort) => Promise<Value>,
  ): Promise<Value> {
    this.calls.push('transaction');
    return work(this.transaction());
  }

  private transaction(): ManualKnowledgeTransactionPort {
    return {
      lockAndLoadManualKnowledgeSnapshot: (query) => {
        this.query = query;
        return this.valueStep('lock_snapshot', this.snapshot);
      },
      insertKnowledgeChangeSet: () => this.step('insert_change_set'),
      insertKnowledgeChangeOperation: () =>
        this.step('insert_change_operation'),
      insertKnowledgeItem: () => this.step('insert_item'),
      insertKnowledgeRevision: () => this.step('insert_item_revision'),
      compareAndSetKnowledgeItemCurrent: () => this.step('cas_item'),
      insertKnowledgeRelation: () => this.step('insert_relation'),
      insertKnowledgeRelationRevision: () =>
        this.step('insert_relation_revision'),
      compareAndSetKnowledgeRelationCurrent: () => this.step('cas_relation'),
      insertKnowledgeRevisionFragmentInput: () =>
        this.step('insert_item_fragment_input'),
      insertKnowledgeRevisionItemInput: () =>
        this.step('insert_item_item_input'),
      insertKnowledgeRevisionRelationInput: () =>
        this.step('insert_item_relation_input'),
      insertRelationRevisionFragmentInput: () =>
        this.step('insert_relation_fragment_input'),
      insertRelationRevisionItemInput: () =>
        this.step('insert_relation_item_input'),
      insertRelationRevisionRelationInput: () =>
        this.step('insert_relation_relation_input'),
      insertKnowledgeChangeEvent: () => this.step('insert_event'),
    };
  }

  private step(name: string): Promise<void> {
    this.calls.push(name);
    return this.failAt === name
      ? Promise.reject(new Error('synthetic-driver-secret'))
      : Promise.resolve();
  }

  private valueStep<Value>(name: string, value: Value): Promise<Value> {
    this.calls.push(name);
    return this.failAt === name
      ? Promise.reject(new Error('synthetic-driver-secret'))
      : Promise.resolve(value);
  }
}
