import {describe, expect, it, vi} from 'vitest';

import {
  ASSESSMENT_DIMENSIONS,
  INTAKE_ACTIONS,
  INTAKE_FEEDBACK_REASONS,
  type ManualCurationContext,
  type ManualCurationRepositoryPort,
  type ManualCurationRepositorySnapshot,
  type ManualCurationTransactionPort,
  executePutContentClassificationTerm,
  executeApplyManualCuration,
  mapCurationPersistenceFailure,
  prepareApplyManualCuration,
  preparePutContentClassificationTerm,
  resultForCommittedTargetPlan,
  resultForCommittedTermPlan,
} from './index.js';
import {
  createTargetCommandProjection,
  createTermCommandProjection,
  deriveAssessmentId,
  deriveAssessmentRevisionId,
  deriveClassificationAssignmentId,
  deriveClassificationAssignmentRevisionId,
  deriveCurationTargetId,
  deriveIntakeDecisionId,
  deriveIntakeDecisionRevisionId,
  deriveVocabularyTermRevisionId,
  digestCommandProjection,
  encodeCommandProjection,
} from './manual_curation_identity.js';

const WORKSPACE_A = uuid(101);
const WORKSPACE_B = uuid(102);
const RESOURCE = uuid(201);
const SNAPSHOT_1 = uuid(301);
const SNAPSHOT_2 = uuid(302);
const FRAGMENT = uuid(401);
const TERM_A = uuid(501);
const TERM_B = uuid(502);
const TERM_C = uuid(503);
const TERM_D = uuid(504);
const TARGET_FRAGMENT = 'd37a19e2-08c1-5021-83d0-70e477f6bc6d';

describe('manual curation deterministic identity', () => {
  it('matches the frozen target and revision UUIDv5 known answers', () => {
    expect(
      deriveCurationTargetId(WORKSPACE_A, {
        kind: 'snapshot',
        snapshotId: SNAPSHOT_1,
      }),
    ).toBe('20e08ba5-5029-5605-aa08-88ca5fdc4353');
    expect(
      deriveCurationTargetId(WORKSPACE_A, {
        kind: 'snapshot',
        snapshotId: SNAPSHOT_2,
      }),
    ).toBe('36953196-2d3c-55a5-9e84-5cb175468a24');
    expect(
      deriveCurationTargetId(WORKSPACE_A, {
        kind: 'fragment',
        fragmentId: FRAGMENT,
      }),
    ).toBe(TARGET_FRAGMENT);
    expect(
      deriveCurationTargetId(WORKSPACE_B, {
        kind: 'fragment',
        fragmentId: FRAGMENT,
      }),
    ).toBe('953f4dfe-59ed-5724-99e2-8aa32f497824');
    expect(deriveVocabularyTermRevisionId(TERM_A, 1)).toBe(
      '332d1955-5065-5363-9a1e-c5588ddaff22',
    );
    expect(deriveVocabularyTermRevisionId(TERM_A, 2)).toBe(
      'cf3e674f-ea19-5983-8f52-fc74512bcdc1',
    );
    const assignment = deriveClassificationAssignmentId(
      TARGET_FRAGMENT,
      TERM_A,
    );
    expect(assignment).toBe('f1881349-7f27-5932-b134-b8900b515c48');
    expect(deriveClassificationAssignmentRevisionId(assignment, 1)).toBe(
      '371d8f8c-705c-588a-aa97-615af42baab8',
    );
    const decision = deriveIntakeDecisionId(TARGET_FRAGMENT);
    expect(decision).toBe('bc07074b-b085-5796-885e-fc78be0aee87');
    expect(deriveIntakeDecisionRevisionId(decision, 1)).toBe(
      'd5be876f-d06f-5c9d-93ac-e47d48c643fd',
    );
    const assessment = deriveAssessmentId(
      TARGET_FRAGMENT,
      'information_density',
    );
    expect(assessment).toBe('69c57b2e-8272-518b-b968-cad1eb15f62f');
    expect(deriveAssessmentRevisionId(assessment, 1)).toBe(
      '421ec15b-ae54-5139-af18-a47160ea9ca8',
    );
  });

  it('matches the frozen canonical JSON plus LF digest known answer', () => {
    const projection = createTermCommandProjection(termContext(), {
      termId: TERM_A,
      expectedRevision: 0,
      value: {
        displayName: 'synthetic-label',
        description: 'synthetic-description',
        lifecycle: 'active',
      },
    });
    expect(encodeCommandProjection(projection)).toHaveLength(365);
    expect(digestCommandProjection(projection)).toBe(
      '17e68baeb9e82f2eeb9ef94c17d7c805f51c42dcedbe6ec576dd06d7083d862c',
    );
    const absentDescription = createTermCommandProjection(
      termContext(),
      termRequest(TERM_A, 0, 'synthetic-label'),
    );
    expect(encodeCommandProjection(absentDescription)).toHaveLength(327);
    expect(digestCommandProjection(absentDescription)).toBe(
      '56ad280f989d7cb069c9861e4b423482b874c29045f15669fb100b837f575aaa',
    );
  });

  it('matches the frozen mixed-command digest and preserves reason and operation order', () => {
    const operations = [
      {kind: 'assign_classification', termId: TERM_A},
      {
        kind: 'set_intake_decision',
        action: 'needs_review',
        reasonCodes: ['worth_exploring', 'other'],
        note: 'synthetic-note',
      },
      {
        kind: 'set_assessment',
        dimension: 'information_density',
        score: 0,
      },
    ] as const;
    const projection = createTargetCommandProjection(
      targetContext('synthetic.curation.target.0001'),
      {
        target: {kind: 'fragment', fragmentId: FRAGMENT},
        expectedTargetVersion: 0,
        operations,
      },
    );
    expect(encodeCommandProjection(projection)).toHaveLength(579);
    expect(digestCommandProjection(projection)).toBe(
      '87dd8344b879bc4bb7c3177b2e3970cfd95859b074265b2a144a98be9f7f158a',
    );

    const reversedReasons = createTargetCommandProjection(
      targetContext('synthetic.curation.target.0001'),
      {
        target: {kind: 'fragment', fragmentId: FRAGMENT},
        expectedTargetVersion: 0,
        operations: [
          operations[0],
          {...operations[1], reasonCodes: ['other', 'worth_exploring']},
          operations[2],
        ],
      },
    );
    expect(encodeCommandProjection(reversedReasons)).toHaveLength(579);
    expect(digestCommandProjection(reversedReasons)).toBe(
      '5a06ab8ce77da28457b1f22e48b6300d65e3f9bdabc1738dbb43794246e828f6',
    );

    const reversedOperations = createTargetCommandProjection(
      targetContext('synthetic.curation.target.0001'),
      {
        target: {kind: 'fragment', fragmentId: FRAGMENT},
        expectedTargetVersion: 0,
        operations: [...operations].reverse(),
      },
    );
    expect(encodeCommandProjection(reversedOperations)).toHaveLength(579);
    expect(digestCommandProjection(reversedOperations)).toBe(
      '0dafbb53f6f19f93dd59e8694b772ba899fbdda53006e9d18707f3cc090419fd',
    );
  });
});

describe('content-classification terms', () => {
  it('creates, renames, retires, reactivates, and returns an exact closed receipt', () => {
    const create = requireTermPlan(
      preparePutContentClassificationTerm(
        termContext(),
        termRequest(TERM_A, 0, 'synthetic-label'),
        emptyState(),
      ),
    );
    expect(create.termRevisionInsert?.revisionNumber).toBe(1);
    expect(resultForCommittedTermPlan(create)).toEqual({
      status: 'applied',
      receipt: {
        workspaceId: WORKSPACE_A,
        commandIdempotencyKey: 'synthetic.curation.term.0001',
        commandKind: 'put_content_classification_term',
        termId: TERM_A,
        resultingRevision: 1,
        originalOutcome: 'applied',
      },
    });

    const current = stateWithTerms([termState(TERM_A, 1, 'active')]);
    for (const [revision, lifecycle] of [
      [1, 'retired'],
      [1, 'active'],
    ] as const) {
      const result = preparePutContentClassificationTerm(
        {
          ...termContext(),
          commandIdempotencyKey: `synthetic.term.${lifecycle}`,
        },
        {
          ...termRequest(TERM_A, revision, 'synthetic-renamed'),
          value: {displayName: 'synthetic-renamed', lifecycle},
        },
        current,
      );
      expect(result.kind).toBe('prepared');
    }
  });

  it('implements unseen-retired, missing/stale, parent lifecycle, and hierarchy-cycle precedence', () => {
    expect(
      preparePutContentClassificationTerm(
        termContext(),
        {
          ...termRequest(TERM_A, 0, 'synthetic-label'),
          value: {displayName: 'synthetic-label', lifecycle: 'retired'},
        },
        emptyState(),
      ),
    ).toEqual(resolvedIssue('invalid_state', 'request.value.lifecycle'));

    expect(
      preparePutContentClassificationTerm(
        termContext(),
        termRequest(TERM_A, 1, 'synthetic-label'),
        emptyState(),
      ),
    ).toEqual(resolvedIssue('term_not_found', 'request.termId'));

    const graph = stateWithTerms([
      termState(TERM_A, 1, 'active', TERM_B),
      termState(TERM_B, 1, 'active', TERM_C),
      termState(TERM_C, 1, 'active'),
      termState(TERM_D, 1, 'retired'),
    ]);
    expect(
      preparePutContentClassificationTerm(
        termContext(),
        {
          ...termRequest(TERM_C, 1, 'synthetic-c'),
          value: {
            displayName: 'synthetic-c-updated',
            parentTermId: TERM_A,
            lifecycle: 'active',
          },
        },
        graph,
      ),
    ).toEqual(resolvedIssue('hierarchy_cycle', 'request.value.parentTermId'));
    expect(
      preparePutContentClassificationTerm(
        termContext(),
        {
          ...termRequest(TERM_A, 1, 'synthetic-a'),
          value: {
            displayName: 'synthetic-a-updated',
            parentTermId: TERM_D,
            lifecycle: 'active',
          },
        },
        graph,
      ),
    ).toEqual(resolvedIssue('invalid_parent', 'request.value.parentTermId'));
  });

  it('preserves an unchanged retired parent for rename, lifecycle change, root move, and exact unchanged', () => {
    const parent = termState(TERM_B, 2, 'retired');
    for (const currentLifecycle of ['active', 'retired'] as const) {
      const child = termState(TERM_A, 3, currentLifecycle, TERM_B);
      const state = stateWithTerms([parent, child]);
      const lifecycleVariants = [
        {
          value: {...child.value},
          outcome: 'unchanged',
        },
        {
          value: {...child.value, displayName: 'synthetic-renamed'},
          outcome: 'applied',
        },
        {
          value: {
            ...child.value,
            lifecycle: currentLifecycle === 'active' ? 'retired' : 'active',
          },
          outcome: 'applied',
        },
        {
          value: {
            displayName: 'synthetic-root',
            lifecycle: currentLifecycle,
          },
          outcome: 'applied',
        },
      ];
      for (const [index, variant] of lifecycleVariants.entries()) {
        const preparation = preparePutContentClassificationTerm(
          {
            ...termContext(),
            commandIdempotencyKey: `synthetic.retired-parent.${currentLifecycle}.${String(index)}`,
          },
          {termId: TERM_A, expectedRevision: 3, value: variant.value},
          state,
        );
        expect(preparation.kind).toBe('prepared');
        if (preparation.kind === 'prepared') {
          expect(preparation.plan.outcome).toBe(variant.outcome);
        }
      }
    }
  });
});

describe('closed repository hierarchy validation', () => {
  it('accepts a long legal single-parent chain without recursion', () => {
    const terms = hierarchyChain(4_096, WORKSPACE_A, 100_000);
    const firstTerm = requireSyntheticTerm(terms, 0);
    const preparation = preparePutContentClassificationTerm(
      termContext(),
      requestForCurrentTerm(firstTerm),
      stateWithTerms(terms),
    );

    expect(preparation.kind).toBe('prepared');
    if (preparation.kind === 'prepared') {
      expect(preparation.plan.outcome).toBe('unchanged');
    }
  });

  it('rejects a cycle in a long chain as malformed repository state', () => {
    const terms = hierarchyChain(2_048, WORKSPACE_A, 200_000);
    const firstTerm = requireSyntheticTerm(terms, 0);
    const root = terms.at(-1);
    if (root === undefined) {
      throw new Error('Expected a synthetic hierarchy root.');
    }
    const cyclicTerms = [
      ...terms.slice(0, -1),
      {...root, value: {...root.value, parentTermId: firstTerm.termId}},
    ];

    expect(
      preparePutContentClassificationTerm(
        termContext(),
        requestForCurrentTerm(firstTerm),
        stateWithTerms(cyclicTerms),
      ),
    ).toEqual(resolvedIssue('invalid_shape', 'state'));
  });

  it('continues to reject missing and cross-workspace parents', () => {
    const childId = uuid(300_000);
    const foreignParentId = uuid(300_001);
    const missingParent = termState(childId, 1, 'active', uuid(399_999));
    expect(
      preparePutContentClassificationTerm(
        termContext(),
        requestForCurrentTerm(missingParent),
        stateWithTerms([missingParent]),
      ),
    ).toEqual(resolvedIssue('invalid_shape', 'state'));

    const crossWorkspaceChild = termState(
      childId,
      1,
      'active',
      foreignParentId,
    );
    const foreignParent = termState(
      foreignParentId,
      1,
      'active',
      undefined,
      WORKSPACE_B,
    );
    expect(
      preparePutContentClassificationTerm(
        termContext(),
        requestForCurrentTerm(crossWorkspaceChild),
        stateWithTerms([crossWorkspaceChild, foreignParent]),
      ),
    ).toEqual(resolvedIssue('invalid_shape', 'state'));
  });

  it('validates every workspace independently', () => {
    const workspaceATerms = hierarchyChain(128, WORKSPACE_A, 400_000);
    const workspaceBTerms = hierarchyChain(128, WORKSPACE_B, 500_000);
    const workspaceAFirst = requireSyntheticTerm(workspaceATerms, 0);
    const workspaceBFirst = requireSyntheticTerm(workspaceBTerms, 0);
    const validPreparation = preparePutContentClassificationTerm(
      termContext(),
      requestForCurrentTerm(workspaceAFirst),
      stateWithTerms([...workspaceATerms, ...workspaceBTerms]),
    );
    expect(validPreparation.kind).toBe('prepared');

    const workspaceBRoot = workspaceBTerms.at(-1);
    if (workspaceBRoot === undefined) {
      throw new Error('Expected a synthetic workspace B hierarchy root.');
    }
    const cyclicWorkspaceB = [
      ...workspaceBTerms.slice(0, -1),
      {
        ...workspaceBRoot,
        value: {
          ...workspaceBRoot.value,
          parentTermId: workspaceBFirst.termId,
        },
      },
    ];
    expect(
      preparePutContentClassificationTerm(
        termContext(),
        requestForCurrentTerm(workspaceAFirst),
        stateWithTerms([...workspaceATerms, ...cyclicWorkspaceB]),
      ),
    ).toEqual(resolvedIssue('invalid_shape', 'state'));
  });

  it('has deterministic linear Map lookups as hierarchy size doubles', () => {
    const smallSize = 512;
    const largeSize = 1_024;
    const smallTerms = hierarchyChain(smallSize, WORKSPACE_A, 600_000);
    const largeTerms = hierarchyChain(largeSize, WORKSPACE_A, 700_000);
    const smallFirst = requireSyntheticTerm(smallTerms, 0);
    const largeFirst = requireSyntheticTerm(largeTerms, 0);

    const small = measureMapGets(() =>
      preparePutContentClassificationTerm(
        termContext(),
        requestForCurrentTerm(smallFirst),
        stateWithTerms(smallTerms),
      ),
    );
    const large = measureMapGets(() =>
      preparePutContentClassificationTerm(
        termContext(),
        requestForCurrentTerm(largeFirst),
        stateWithTerms(largeTerms),
      ),
    );

    expect(small.value.kind).toBe('prepared');
    expect(large.value.kind).toBe('prepared');
    expect(small.getCount).toBe(5 * smallSize - 1);
    expect(large.getCount).toBe(5 * largeSize - 1);
    expect(large.getCount - small.getCount).toBe(5 * (largeSize - smallSize));
    expect(large.getCount).toBeLessThanOrEqual(6 * largeSize);
  });
});

describe('target classification, intake, and assessment', () => {
  it('plans one atomic mixed command in fixed term/decision/dimension phases', () => {
    const state = stateWithEvidenceAndTerms([
      termState(TERM_A, 1, 'active'),
      termState(TERM_B, 1, 'active'),
    ]);
    const preparation = prepareApplyManualCuration(
      targetContext('synthetic.curation.target.0001'),
      {
        target: {kind: 'fragment', fragmentId: FRAGMENT},
        expectedTargetVersion: 0,
        operations: [
          {kind: 'set_assessment', dimension: 'depth', score: 4},
          {kind: 'assign_classification', termId: TERM_B},
          {
            kind: 'set_intake_decision',
            action: 'split',
            reasonCodes: ['worth_exploring', 'other'],
            note: 'synthetic-note',
          },
          {kind: 'assign_classification', termId: TERM_A},
          {
            kind: 'set_assessment',
            dimension: 'information_density',
            score: 0,
          },
        ],
      },
      state,
    );
    const plan = requireTargetPlan(preparation);
    expect(plan.receipt.resultingVersion).toBe(1);
    expect(
      plan.classificationChanges.map((change) => change.revisionInsert.termId),
    ).toEqual([TERM_A, TERM_B]);
    expect(plan.decisionChange?.revisionInsert.value.reasonCodes).toEqual([
      'worth_exploring',
      'other',
    ]);
    expect(
      plan.assessmentChanges.map((change) => change.identityInsert?.dimension),
    ).toEqual(['information_density', 'depth']);
    expect(plan.commandInsert).toEqual({
      workspaceId: WORKSPACE_A,
      commandIdempotencyKey: 'synthetic.curation.target.0001',
      requestSha256: plan.requestSha256,
      commandKind: 'apply_manual_curation',
      authority: 'manual_user',
      targetId: TARGET_FRAGMENT,
      outcome: 'applied',
      resultingVersion: 1,
    });
  });

  it.each(INTAKE_ACTIONS)(
    'accepts intake action %s without knowledge side effects',
    (action) => {
      const plan = requireTargetPlan(
        prepareApplyManualCuration(
          targetContext(`synthetic.action.${action}`),
          targetRequest({
            kind: 'set_intake_decision',
            action,
            reasonCodes: [],
          }),
          stateWithEvidenceAndTerms([]),
        ),
      );
      expect(plan.decisionChange?.revisionInsert.value.action).toBe(action);
      expect(Object.keys(plan).some((key) => /knowledge/iu.test(key))).toBe(
        false,
      );
    },
  );

  it('preserves all reason values and caller order, rejects duplicate reasons, and checks raw length first', () => {
    const valid = requireTargetPlan(
      prepareApplyManualCuration(
        targetContext('synthetic.reasons'),
        targetRequest({
          kind: 'set_intake_decision',
          action: 'needs_review',
          reasonCodes: INTAKE_FEEDBACK_REASONS,
          note: 'synthetic-note',
        }),
        stateWithEvidenceAndTerms([]),
      ),
    );
    expect(valid.decisionChange?.revisionInsert.value.reasonCodes).toEqual(
      INTAKE_FEEDBACK_REASONS,
    );

    expect(
      prepareApplyManualCuration(
        targetContext('synthetic.duplicate-reason'),
        targetRequest({
          kind: 'set_intake_decision',
          action: 'ignore',
          reasonCodes: ['already_known', 'already_known'],
        }),
        stateWithEvidenceAndTerms([]),
      ),
    ).toEqual(
      resolvedIssue('invalid_state', 'request.operations[0].reasonCodes[1]'),
    );

    const reasons = [...INTAKE_FEEDBACK_REASONS, 'already_known'];
    const accessor = vi.fn();
    Object.defineProperty(reasons, '0', {get: accessor, enumerable: true});
    expect(
      prepareApplyManualCuration(
        targetContext('synthetic.reason-limit'),
        targetRequest({
          kind: 'set_intake_decision',
          action: 'ignore',
          reasonCodes: reasons as never,
          note: 'synthetic-note',
        }),
        stateWithEvidenceAndTerms([]),
      ),
    ).toEqual(
      resolvedBudget('request.operations[0].reasonCodes', 'feedback_reasons'),
    );
    expect(accessor).not.toHaveBeenCalled();
  });

  it('supports every independent assessment dimension, score endpoints, and clear without an aggregate', () => {
    for (const dimension of ASSESSMENT_DIMENSIONS) {
      for (const score of [0, 4] as const) {
        const plan = requireTargetPlan(
          prepareApplyManualCuration(
            targetContext(`synthetic.assessment.${dimension}.${String(score)}`),
            targetRequest({
              kind: 'set_assessment',
              dimension,
              score,
            }),
            stateWithEvidenceAndTerms([]),
          ),
        );
        expect(plan.assessmentChanges[0]?.revisionInsert.value).toEqual({
          state: 'rated',
          score,
        });
      }
    }
    const clear = requireTargetPlan(
      prepareApplyManualCuration(
        targetContext('synthetic.clear-absent'),
        targetRequest({
          kind: 'clear_assessment',
          dimension: 'freshness',
        }),
        stateWithEvidenceAndTerms([]),
      ),
    );
    expect(clear.outcome).toBe('unchanged');
    expect(clear.assessmentChanges).toEqual([]);
  });

  it('rejects missing/cross-workspace targets and terms without revealing existence', () => {
    expect(
      prepareApplyManualCuration(
        targetContext('synthetic.missing-target'),
        targetRequest({kind: 'clear_assessment', dimension: 'freshness'}),
        emptyState(),
      ),
    ).toEqual(resolvedIssue('target_not_found', 'request.target'));

    const crossWorkspaceState = {
      ...emptyState(),
      evidenceTargets: [
        {workspaceId: WORKSPACE_B, kind: 'fragment', fragmentId: FRAGMENT},
      ],
      terms: [termState(TERM_A, 1, 'active', undefined, WORKSPACE_B)],
    } as ManualCurationRepositorySnapshot;
    expect(
      prepareApplyManualCuration(
        targetContext('synthetic.cross-target'),
        targetRequest({kind: 'assign_classification', termId: TERM_A}),
        crossWorkspaceState,
      ),
    ).toEqual(resolvedIssue('target_not_found', 'request.target'));
  });

  it('rejects a new retired assignment before semantic unchanged but permits removal', () => {
    const retired = termState(TERM_A, 2, 'retired');
    const state = stateWithEvidenceAndTerms([retired]);
    expect(
      prepareApplyManualCuration(
        targetContext('synthetic.retired-assign'),
        targetRequest({kind: 'assign_classification', termId: TERM_A}),
        state,
      ),
    ).toEqual(resolvedIssue('term_retired', 'request.operations[0].termId'));
    expect(
      requireTargetPlan(
        prepareApplyManualCuration(
          targetContext('synthetic.retired-remove'),
          targetRequest({kind: 'remove_classification', termId: TERM_A}),
          state,
        ),
      ).outcome,
    ).toBe('unchanged');
  });

  it('enforces the resulting 64-current-classification budget without rejecting a balanced replace', () => {
    const termIds = Array.from({length: 65}, (_, index) => uuid(1_000 + index));
    const terms = termIds.map((termId) => termState(termId, 1, 'active'));

    const atSixtyThree = stateWithCurrentAssignments(terms, 63);
    const sixtyFourth = requireTargetPlan(
      prepareApplyManualCuration(
        targetContext('synthetic.classifications.64'),
        {
          target: {kind: 'fragment', fragmentId: FRAGMENT},
          expectedTargetVersion: 1,
          operations: [{kind: 'assign_classification', termId: termIds[63]}],
        },
        atSixtyThree,
      ),
    );
    expect(sixtyFourth.classificationChanges).toHaveLength(1);
    expect(sixtyFourth.outcome).toBe('applied');

    const atSixtyFour = stateWithCurrentAssignments(terms, 64);
    expect(
      prepareApplyManualCuration(
        targetContext('synthetic.classifications.65'),
        {
          target: {kind: 'fragment', fragmentId: FRAGMENT},
          expectedTargetVersion: 1,
          operations: [{kind: 'assign_classification', termId: termIds[64]}],
        },
        atSixtyFour,
      ),
    ).toEqual(resolvedBudget('request.operations', 'current_classifications'));

    const balanced = requireTargetPlan(
      prepareApplyManualCuration(
        targetContext('synthetic.classifications.replace'),
        {
          target: {kind: 'fragment', fragmentId: FRAGMENT},
          expectedTargetVersion: 1,
          operations: [
            {kind: 'assign_classification', termId: termIds[64]},
            {kind: 'remove_classification', termId: termIds[0]},
          ],
        },
        atSixtyFour,
      ),
    );
    expect(balanced.classificationChanges).toHaveLength(2);
    expect(balanced.outcome).toBe('applied');
  });
});

describe('idempotency, closed input, budgets, and persistence', () => {
  it('replays the original receipt before stale/lifecycle checks and detects cross-kind conflicts', () => {
    const original = requireTermPlan(
      preparePutContentClassificationTerm(
        termContext(),
        termRequest(TERM_A, 0, 'synthetic-label'),
        emptyState(),
      ),
    );
    const storedState = stateWithTerms([termState(TERM_A, 2, 'retired')]);
    const stateWithCommand: ManualCurationRepositorySnapshot = {
      ...storedState,
      commands: [
        {
          workspaceId: WORKSPACE_A,
          commandIdempotencyKey: termContext().commandIdempotencyKey,
          requestSha256: original.requestSha256,
          receipt: original.receipt,
        },
      ],
    };
    expect(
      preparePutContentClassificationTerm(
        termContext(),
        termRequest(TERM_A, 0, 'synthetic-label'),
        stateWithCommand,
      ),
    ).toEqual({
      kind: 'resolved',
      result: {status: 'replayed', receipt: original.receipt},
    });
    expect(
      prepareApplyManualCuration(
        termContext(),
        targetRequest({kind: 'clear_assessment', dimension: 'freshness'}),
        stateWithCommand,
      ),
    ).toEqual(
      resolvedIssue('idempotency_conflict', 'context.commandIdempotencyKey'),
    );
  });

  it('returns an unchanged version-zero target plan and claims a replayable command key', () => {
    const plan = requireTargetPlan(
      prepareApplyManualCuration(
        targetContext('synthetic.unchanged-zero'),
        targetRequest({kind: 'clear_assessment', dimension: 'freshness'}),
        stateWithEvidenceAndTerms([]),
      ),
    );
    expect(plan.outcome).toBe('unchanged');
    expect(plan.targetInsert?.currentVersion).toBe(0);
    expect(plan.targetVersionCas).toBeUndefined();
    const result = resultForCommittedTargetPlan(plan);
    expect(result.status).toBe('unchanged');
    if (result.status === 'unchanged') {
      expect(result.receipt.resultingVersion).toBe(0);
    }
  });

  it('rejects duplicate operations in caller order without a partial plan', () => {
    const result = prepareApplyManualCuration(
      targetContext('synthetic.duplicate-operation'),
      {
        target: {kind: 'fragment', fragmentId: FRAGMENT},
        expectedTargetVersion: 0,
        operations: [
          {kind: 'assign_classification', termId: TERM_A},
          {kind: 'remove_classification', termId: TERM_A},
        ],
      },
      stateWithEvidenceAndTerms([termState(TERM_A, 1, 'active')]),
    );
    expect(result).toEqual(
      resolvedIssue('duplicate_operation', 'request.operations[1]'),
    );
    expect(JSON.stringify(result)).not.toContain('plan');
  });

  it('rejects stale target versions and operation-count boundaries without a partial plan', () => {
    expect(
      prepareApplyManualCuration(
        targetContext('synthetic.stale-target'),
        {
          target: {kind: 'fragment', fragmentId: FRAGMENT},
          expectedTargetVersion: 1,
          operations: [{kind: 'clear_assessment', dimension: 'freshness'}],
        },
        stateWithEvidenceAndTerms([]),
      ),
    ).toEqual(resolvedIssue('stale_revision', 'request.expectedTargetVersion'));
    expect(
      prepareApplyManualCuration(
        targetContext('synthetic.empty-operations'),
        {
          target: {kind: 'fragment', fragmentId: FRAGMENT},
          expectedTargetVersion: 0,
          operations: [],
        },
        stateWithEvidenceAndTerms([]),
      ),
    ).toEqual(resolvedIssue('invalid_state', 'request.operations'));

    const accessor = vi.fn();
    const over = Array.from({length: 65}, () => ({
      kind: 'clear_assessment',
      dimension: 'freshness',
    })) as unknown[];
    Object.defineProperty(over, '0', {get: accessor, enumerable: true});
    expect(
      prepareApplyManualCuration(
        targetContext('synthetic.operations-over'),
        {
          target: {kind: 'fragment', fragmentId: FRAGMENT},
          expectedTargetVersion: 0,
          operations: over,
        },
        stateWithEvidenceAndTerms([]),
      ),
    ).toEqual(resolvedBudget('request.operations', 'command_operations'));
    expect(accessor).not.toHaveBeenCalled();
  });

  it('applies text/key/version code-point budgets and never returns a byte-budget token', () => {
    expect(
      preparePutContentClassificationTerm(
        termContext(),
        termRequest(TERM_A, 0, 'x'.repeat(121)),
        emptyState(),
      ),
    ).toEqual(
      resolvedBudget('request.value.displayName', 'display_name_code_points'),
    );
    expect(
      preparePutContentClassificationTerm(
        {...termContext(), commandIdempotencyKey: 'a'.repeat(201)},
        termRequest(TERM_A, 0, 'synthetic-label'),
        emptyState(),
      ),
    ).toEqual(
      resolvedBudget(
        'context.commandIdempotencyKey',
        'idempotency_key_characters',
      ),
    );
    const fourByteName = '😀'.repeat(120);
    expect(
      preparePutContentClassificationTerm(
        termContext(),
        termRequest(TERM_A, 0, fourByteName),
        emptyState(),
      ).kind,
    ).toBe('prepared');
  });

  it('preserves Unicode exactly and applies description and note code-point budgets', () => {
    const unicodeName = '合成😀e\u0301值';
    const unicodeDescription = '路径样文本 /a/../b 仍是普通描述';
    const term = requireTermPlan(
      preparePutContentClassificationTerm(
        termContext(),
        {
          termId: TERM_A,
          expectedRevision: 0,
          value: {
            displayName: unicodeName,
            description: unicodeDescription,
            lifecycle: 'active',
          },
        },
        emptyState(),
      ),
    );
    expect(term.termRevisionInsert?.value).toEqual({
      displayName: unicodeName,
      description: unicodeDescription,
      lifecycle: 'active',
    });

    expect(
      preparePutContentClassificationTerm(
        termContext(),
        {
          termId: TERM_A,
          expectedRevision: 0,
          value: {
            displayName: 'synthetic-label',
            description: 'd'.repeat(2_001),
            lifecycle: 'active',
          },
        },
        emptyState(),
      ),
    ).toEqual(
      resolvedBudget('request.value.description', 'description_code_points'),
    );
    expect(
      prepareApplyManualCuration(
        targetContext('synthetic.note.budget'),
        targetRequest({
          kind: 'set_assessment',
          dimension: 'freshness',
          score: 1,
          note: 'n'.repeat(2_001),
        }),
        stateWithEvidenceAndTerms([]),
      ),
    ).toEqual(resolvedBudget('request.operations[0].note', 'note_code_points'));

    for (const displayName of [
      '',
      ' ',
      ' synthetic',
      'synthetic ',
      'synthetic\u0000value',
      '\ud800',
    ]) {
      expect(
        preparePutContentClassificationTerm(
          termContext(),
          termRequest(TERM_A, 0, displayName),
          emptyState(),
        ),
      ).toEqual(resolvedIssue('invalid_text', 'request.value.displayName'));
    }
  });

  it('rejects non-canonical request UUID spellings at exact paths', () => {
    const letterUuid = 'a0000000-0000-0000-0000-000000000101';
    const invalidIds = [
      letterUuid.toUpperCase(),
      `{${WORKSPACE_A}}`,
      `urn:uuid:${WORKSPACE_A}`,
      WORKSPACE_A.replaceAll('-', ''),
      ` ${WORKSPACE_A}`,
      `${WORKSPACE_A} `,
      WORKSPACE_A.slice(0, -1),
      `${WORKSPACE_A}0`,
    ];
    for (const invalidId of invalidIds) {
      expect(
        preparePutContentClassificationTerm(
          {...termContext(), effectiveWorkspaceId: invalidId},
          termRequest(TERM_A, 0, 'synthetic-label'),
          emptyState(),
        ),
      ).toEqual(
        resolvedIssue('invalid_identifier', 'context.effectiveWorkspaceId'),
      );
      expect(
        preparePutContentClassificationTerm(
          termContext(),
          termRequest(invalidId, 0, 'synthetic-label'),
          emptyState(),
        ),
      ).toEqual(resolvedIssue('invalid_identifier', 'request.termId'));
      expect(
        prepareApplyManualCuration(
          targetContext('synthetic.invalid.target-id'),
          {
            target: {kind: 'fragment', fragmentId: invalidId},
            expectedTargetVersion: 0,
            operations: [{kind: 'clear_assessment', dimension: 'freshness'}],
          },
          stateWithEvidenceAndTerms([]),
        ),
      ).toEqual(
        resolvedIssue('invalid_identifier', 'request.target.fragmentId'),
      );
    }
  });

  it('rejects hostile records, proxies, accessors, symbols, dangerous keys, sparse arrays, and inherited accessors without executing them', () => {
    const getter = vi.fn(() => WORKSPACE_A);
    const hostileContext = {
      commandIdempotencyKey: 'synthetic.hostile',
      authority: 'manual_user',
    };
    Object.defineProperty(hostileContext, 'effectiveWorkspaceId', {
      get: getter,
      enumerable: true,
    });
    expect(
      preparePutContentClassificationTerm(
        hostileContext,
        termRequest(TERM_A, 0, 'synthetic-label'),
        emptyState(),
      ),
    ).toEqual(resolvedIssue('invalid_shape', 'context.effectiveWorkspaceId'));
    expect(getter).not.toHaveBeenCalled();

    const trap = vi.fn();
    const proxy = new Proxy(termRequest(TERM_A, 0, 'synthetic-label'), {
      ownKeys() {
        trap();
        return [];
      },
    });
    expect(
      preparePutContentClassificationTerm(termContext(), proxy, emptyState()),
    ).toEqual(resolvedIssue('invalid_shape', 'request'));
    expect(trap).not.toHaveBeenCalled();

    const symbolRequest = termRequest(TERM_A, 0, 'synthetic-label') as Record<
      PropertyKey,
      unknown
    >;
    symbolRequest[Symbol('synthetic')] = true;
    expect(
      preparePutContentClassificationTerm(
        termContext(),
        symbolRequest,
        emptyState(),
      ),
    ).toEqual(resolvedIssue('invalid_shape', 'request'));

    const dangerous = termRequest(TERM_A, 0, 'synthetic-label') as Record<
      string,
      unknown
    >;
    Object.defineProperty(dangerous, '__proto__', {
      value: 'synthetic',
      enumerable: true,
    });
    expect(
      preparePutContentClassificationTerm(
        termContext(),
        dangerous,
        emptyState(),
      ),
    ).toEqual(resolvedIssue('invalid_shape', 'request'));

    const sparse = Array(1) as unknown[];
    expect(
      prepareApplyManualCuration(
        targetContext('synthetic.sparse'),
        {
          target: {kind: 'fragment', fragmentId: FRAGMENT},
          expectedTargetVersion: 0,
          operations: sparse,
        },
        stateWithEvidenceAndTerms([]),
      ),
    ).toEqual(resolvedIssue('invalid_shape', 'request.operations'));
  });

  it('rejects inherited declared accessors and does not invoke inherited setters while projecting owned values', () => {
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'effectiveWorkspaceId',
    );
    const getter = vi.fn();
    try {
      Object.defineProperty(Object.prototype, 'effectiveWorkspaceId', {
        get: getter,
        configurable: true,
      });
      expect(
        preparePutContentClassificationTerm(
          termContext(),
          termRequest(TERM_A, 0, 'synthetic-label'),
          emptyState(),
        ),
      ).toEqual(resolvedIssue('invalid_shape', 'context.effectiveWorkspaceId'));
      expect(getter).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) {
        delete (Object.prototype as Record<string, unknown>)
          .effectiveWorkspaceId;
      } else {
        Object.defineProperty(
          Object.prototype,
          'effectiveWorkspaceId',
          original,
        );
      }
    }
  });

  it('checks a raw over-limit array before inherited index accessors or elements', () => {
    const original = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    const getter = vi.fn();
    const over = Array.from({length: 65}, () => ({
      kind: 'clear_assessment',
      dimension: 'freshness',
    }));
    let result: unknown;
    try {
      Object.defineProperty(Array.prototype, '0', {
        get: getter,
        configurable: true,
      });
      result = prepareApplyManualCuration(
        targetContext('synthetic.operations.inherited-index'),
        {
          target: {kind: 'fragment', fragmentId: FRAGMENT},
          expectedTargetVersion: 0,
          operations: over,
        },
        stateWithEvidenceAndTerms([]),
      );
    } finally {
      if (original === undefined) {
        delete (Array.prototype as unknown as Record<string, unknown>)['0'];
      } else {
        Object.defineProperty(Array.prototype, '0', original);
      }
    }
    expect(result).toEqual(
      resolvedBudget('request.operations', 'command_operations'),
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it('does not invoke an inherited setter while projecting a different legal closed shape', () => {
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'workspaceId',
    );
    const setter = vi.fn();
    try {
      Object.defineProperty(Object.prototype, 'workspaceId', {
        set: setter,
        configurable: true,
      });
      const result = preparePutContentClassificationTerm(
        termContext(),
        termRequest(TERM_A, 0, 'synthetic-label'),
        emptyState(),
      );
      expect(result.kind).toBe('prepared');
      expect(setter).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) {
        delete (Object.prototype as Record<string, unknown>).workspaceId;
      } else {
        Object.defineProperty(Object.prototype, 'workspaceId', original);
      }
    }
  });

  it('owns and deeply freezes decoded plans so later caller mutation cannot change them', () => {
    const request = termRequest(TERM_A, 0, 'synthetic-label');
    const state = emptyState();
    const plan = requireTermPlan(
      preparePutContentClassificationTerm(termContext(), request, state),
    );
    request.value.displayName = 'synthetic-mutated';
    state.terms.push(termState(TERM_B, 1, 'active'));
    expect(plan.termRevisionInsert?.value.displayName).toBe('synthetic-label');
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.termRevisionInsert?.value)).toBe(true);
  });

  it('maps persistence failure to one closed safe issue and repository ports expose insert/CAS order only', async () => {
    expect(mapCurationPersistenceFailure()).toEqual({
      status: 'rejected',
      issue: {code: 'persistence_failed', path: 'persistence'},
    });
    const calls: string[] = [];
    const transaction = createTransactionDouble(calls);
    const repository: ManualCurationRepositoryPort = {
      async runCommandTransaction<Value>(
        work: (transaction: ManualCurationTransactionPort) => Promise<Value>,
      ): Promise<Value> {
        calls.push('transaction:start');
        const value = await work(transaction);
        calls.push('transaction:commit');
        return value;
      },
    };
    const result = await executePutContentClassificationTerm(
      repository,
      termContext(),
      termRequest(TERM_A, 0, 'synthetic-label'),
    );
    expect(result.status).toBe('applied');
    expect(calls).toEqual([
      'transaction:start',
      'term-state:load',
      'term:insert',
      'term-revision:insert',
      'command:insert',
      'transaction:commit',
    ]);
    expect(
      Object.keys(transaction).some((key) =>
        /delete|history.*update/iu.test(key),
      ),
    ).toBe(false);
  });

  it('locks target and sorted terms before planning all decision-reason rows in one transaction', async () => {
    const calls: string[] = [];
    const transaction = createTransactionDouble(calls);
    const loaded = stateWithEvidenceAndTerms([
      termState(TERM_A, 1, 'active'),
      termState(TERM_B, 1, 'active'),
    ]);
    transaction.lockAndLoadTargetCommandSnapshot = (query) => {
      calls.push(`target-state:load:${query.referencedTermIds.join(',')}`);
      return Promise.resolve(loaded);
    };
    const repository = transactionRepository(transaction, calls);
    const result = await executeApplyManualCuration(
      repository,
      targetContext('synthetic.transaction.target'),
      {
        target: {kind: 'fragment', fragmentId: FRAGMENT},
        expectedTargetVersion: 0,
        operations: [
          {kind: 'assign_classification', termId: TERM_B},
          {
            kind: 'set_intake_decision',
            action: 'needs_review',
            reasonCodes: ['worth_exploring', 'other'],
            note: 'synthetic-note',
          },
          {kind: 'assign_classification', termId: TERM_A},
        ],
      },
    );
    expect(result.status).toBe('applied');
    expect(calls[1]).toBe(`target-state:load:${TERM_A},${TERM_B}`);
    expect(
      calls.filter((call) => call === 'decision-reason:insert'),
    ).toHaveLength(2);
    expect(calls.at(-1)).toBe('transaction:commit');
  });

  it('maps transaction failures safely and commits no later write through the port', async () => {
    const calls: string[] = [];
    const transaction = createTransactionDouble(calls);
    transaction.insertVocabularyTermRevision = () => {
      calls.push('term-revision:failed');
      return Promise.reject(new Error('synthetic private driver text'));
    };
    const result = await executePutContentClassificationTerm(
      transactionRepository(transaction, calls),
      termContext(),
      termRequest(TERM_A, 0, 'synthetic-label'),
    );
    expect(result).toEqual({
      status: 'rejected',
      issue: {code: 'persistence_failed', path: 'persistence'},
    });
    expect(JSON.stringify(result)).not.toContain('driver');
    expect(calls).not.toContain('command:insert');
    expect(calls).not.toContain('transaction:commit');
  });
});

function uuid(suffix: number): string {
  return `00000000-0000-0000-0000-${String(suffix).padStart(12, '0')}`;
}

function termContext(): ManualCurationContext {
  return {
    effectiveWorkspaceId: WORKSPACE_A,
    commandIdempotencyKey: 'synthetic.curation.term.0001',
    authority: 'manual_user',
  };
}

function targetContext(commandIdempotencyKey: string): ManualCurationContext {
  return {
    effectiveWorkspaceId: WORKSPACE_A,
    commandIdempotencyKey,
    authority: 'manual_user',
  };
}

function termRequest(
  termId: string,
  expectedRevision: number,
  displayName: string,
): {
  termId: string;
  expectedRevision: number;
  value: {displayName: string; lifecycle: 'active'};
} {
  return {termId, expectedRevision, value: {displayName, lifecycle: 'active'}};
}

function targetRequest(operation: unknown): unknown {
  return {
    target: {kind: 'fragment', fragmentId: FRAGMENT},
    expectedTargetVersion: 0,
    operations: [operation],
  };
}

function emptyState(): {
  evidenceTargets: unknown[];
  targets: unknown[];
  terms: unknown[];
  assignments: unknown[];
  decisions: unknown[];
  assessments: unknown[];
  commands: unknown[];
} {
  return {
    evidenceTargets: [],
    targets: [],
    terms: [],
    assignments: [],
    decisions: [],
    assessments: [],
    commands: [],
  };
}

function stateWithEvidenceAndTerms(
  terms: unknown[],
): ManualCurationRepositorySnapshot {
  return {
    ...emptyState(),
    evidenceTargets: [
      {
        workspaceId: WORKSPACE_A,
        kind: 'fragment',
        fragmentId: FRAGMENT,
      },
      {
        workspaceId: WORKSPACE_A,
        kind: 'snapshot',
        resourceId: RESOURCE,
        snapshotId: SNAPSHOT_1,
      },
      {
        workspaceId: WORKSPACE_A,
        kind: 'snapshot',
        resourceId: RESOURCE,
        snapshotId: SNAPSHOT_2,
      },
    ],
    terms,
  } as ManualCurationRepositorySnapshot;
}

function stateWithTerms(terms: unknown[]): ManualCurationRepositorySnapshot {
  return {...emptyState(), terms} as ManualCurationRepositorySnapshot;
}

function hierarchyChain(
  length: number,
  workspaceId: string,
  firstUuidSuffix: number,
): ReturnType<typeof termState>[] {
  const termIds = Array.from({length}, (_, index) =>
    uuid(firstUuidSuffix + index),
  );
  return termIds.map((termId, index) =>
    termState(termId, 1, 'active', termIds[index + 1], workspaceId),
  );
}

function requireSyntheticTerm(
  terms: readonly ReturnType<typeof termState>[],
  index: number,
): ReturnType<typeof termState> {
  const term = terms[index];
  if (term === undefined) {
    throw new Error('Expected a synthetic hierarchy term.');
  }
  return term;
}

function requestForCurrentTerm(term: ReturnType<typeof termState>): {
  termId: string;
  expectedRevision: number;
  value: ReturnType<typeof termState>['value'];
} {
  return {
    termId: term.termId,
    expectedRevision: term.currentRevision,
    value: term.value,
  };
}

function measureMapGets<Value>(operation: () => Value): {
  value: Value;
  getCount: number;
} {
  const getSpy = vi.spyOn(Map.prototype, 'get');
  try {
    const value = operation();
    return {value, getCount: getSpy.mock.calls.length};
  } finally {
    getSpy.mockRestore();
  }
}

function stateWithCurrentAssignments(
  terms: readonly ReturnType<typeof termState>[],
  assignedCount: number,
): ManualCurationRepositorySnapshot {
  return {
    ...stateWithEvidenceAndTerms([...terms]),
    targets: [
      {
        workspaceId: WORKSPACE_A,
        kind: 'fragment',
        fragmentId: FRAGMENT,
        targetId: TARGET_FRAGMENT,
        currentVersion: 1,
      },
    ],
    assignments: terms.slice(0, assignedCount).map((term) => {
      const assignmentId = deriveClassificationAssignmentId(
        TARGET_FRAGMENT,
        term.termId,
      );
      return {
        workspaceId: WORKSPACE_A,
        assignmentId,
        targetId: TARGET_FRAGMENT,
        termId: term.termId,
        currentRevision: 1,
        currentRevisionId: deriveClassificationAssignmentRevisionId(
          assignmentId,
          1,
        ),
        state: 'assigned',
        termRevisionNumber: 1,
        termRevisionId: deriveVocabularyTermRevisionId(term.termId, 1),
      };
    }),
  };
}

function termState(
  termId: string,
  revision: number,
  lifecycle: 'active' | 'retired',
  parentTermId?: string,
  workspaceId = WORKSPACE_A,
): {
  workspaceId: string;
  termId: string;
  currentRevision: number;
  currentRevisionId: string;
  value: {
    displayName: string;
    parentTermId?: string;
    lifecycle: 'active' | 'retired';
  };
} {
  return {
    workspaceId,
    termId,
    currentRevision: revision,
    currentRevisionId: deriveVocabularyTermRevisionId(termId, revision),
    value: {
      displayName: `synthetic-${termId.slice(-3)}`,
      ...(parentTermId === undefined ? {} : {parentTermId}),
      lifecycle,
    },
  };
}

function requireTermPlan(
  preparation: ReturnType<typeof preparePutContentClassificationTerm>,
) {
  expect(preparation.kind).toBe('prepared');
  if (preparation.kind !== 'prepared') {
    throw new Error('Expected a prepared term plan.');
  }
  return preparation.plan;
}

function requireTargetPlan(
  preparation: ReturnType<typeof prepareApplyManualCuration>,
) {
  expect(preparation.kind).toBe('prepared');
  if (preparation.kind !== 'prepared') {
    throw new Error('Expected a prepared target plan.');
  }
  return preparation.plan;
}

function resolvedIssue(code: string, path: string): unknown {
  return {kind: 'resolved', result: {status: 'rejected', issue: {code, path}}};
}

function resolvedBudget(path: string, budget: string): unknown {
  return {
    kind: 'resolved',
    result: {
      status: 'rejected',
      issue: {code: 'limit_exceeded', path, budget},
    },
  };
}

function createTransactionDouble(
  calls: string[],
): ManualCurationTransactionPort {
  const completed = (): Promise<void> => Promise.resolve();
  return {
    lockAndLoadTermCommandSnapshot() {
      calls.push('term-state:load');
      return Promise.resolve(emptyState());
    },
    lockAndLoadTargetCommandSnapshot() {
      calls.push('target-state:load');
      return Promise.resolve(emptyState());
    },
    insertCurationTarget() {
      calls.push('target:insert');
      return completed();
    },
    compareAndSetTargetVersion() {
      calls.push('target:cas');
      return completed();
    },
    insertVocabularyTerm() {
      calls.push('term:insert');
      return completed();
    },
    insertVocabularyTermRevision() {
      calls.push('term-revision:insert');
      return completed();
    },
    compareAndSetVocabularyTermCurrent() {
      calls.push('term:cas');
      return completed();
    },
    insertClassificationAssignment() {
      calls.push('assignment:insert');
      return completed();
    },
    insertClassificationAssignmentRevision() {
      calls.push('assignment-revision:insert');
      return completed();
    },
    compareAndSetClassificationAssignmentCurrent() {
      calls.push('assignment:cas');
      return completed();
    },
    insertIntakeDecision() {
      calls.push('decision:insert');
      return completed();
    },
    insertIntakeDecisionRevision() {
      calls.push('decision-revision:insert');
      return completed();
    },
    insertIntakeDecisionReason() {
      calls.push('decision-reason:insert');
      return completed();
    },
    compareAndSetIntakeDecisionCurrent() {
      calls.push('decision:cas');
      return completed();
    },
    insertAssessment() {
      calls.push('assessment:insert');
      return completed();
    },
    insertAssessmentRevision() {
      calls.push('assessment-revision:insert');
      return completed();
    },
    compareAndSetAssessmentCurrent() {
      calls.push('assessment:cas');
      return completed();
    },
    insertCurationCommand() {
      calls.push('command:insert');
      return completed();
    },
  };
}

function transactionRepository(
  transaction: ManualCurationTransactionPort,
  calls: string[],
): ManualCurationRepositoryPort {
  return {
    async runCommandTransaction<Value>(
      work: (port: ManualCurationTransactionPort) => Promise<Value>,
    ): Promise<Value> {
      calls.push('transaction:start');
      const result = await work(transaction);
      calls.push('transaction:commit');
      return result;
    },
  };
}
