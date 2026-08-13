import {types as utilityTypes} from 'node:util';

import {
  ASSESSMENT_DIMENSIONS,
  type ApplyManualCurationRequest,
  type AssessmentDimension,
  type AssessmentRevisionValue,
  type AssessmentState,
  type ClassificationAssignmentState,
  CURATION_LIMITS,
  type CurationBudgetName,
  type CurationIssueCode,
  type CurationIssuePath,
  type CurationTargetRef,
  type CurationTargetState,
  type EvidenceTargetState,
  INTAKE_ACTIONS,
  INTAKE_FEEDBACK_REASONS,
  type IntakeAction,
  type IntakeDecisionState,
  type IntakeDecisionValue,
  type IntakeFeedbackReason,
  type ManualCurationContext,
  type ManualCurationOperation,
  type ManualCurationRepositorySnapshot,
  type PutContentClassificationTermRequest,
  type StoredCurationCommandState,
  type StoredCurationReceipt,
  type VocabularyTermLifecycle,
  type VocabularyTermState,
  type VocabularyTermValue,
} from './manual_curation_contract.js';
import {SHA256_PATTERN, UUID_PATTERN} from './manual_curation_identity.js';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/u;
const LIFECYCLES = new Set<VocabularyTermLifecycle>(['active', 'retired']);
const ACTIONS = new Set<string>(INTAKE_ACTIONS);
const REASONS = new Set<string>(INTAKE_FEEDBACK_REASONS);
const DIMENSIONS = new Set<string>(ASSESSMENT_DIMENSIONS);

export class CurationInputFault extends Error {
  public readonly code: Exclude<CurationIssueCode, 'persistence_failed'>;
  public readonly path: CurationIssuePath;
  public readonly budget: CurationBudgetName | undefined;

  public constructor(
    code: Exclude<CurationIssueCode, 'persistence_failed'>,
    path: CurationIssuePath,
    budget?: CurationBudgetName,
  ) {
    super('Manual curation input is invalid.');
    this.name = 'CurationInputFault';
    this.code = code;
    this.path = path;
    this.budget = budget;
  }
}

type DescriptorRecord = Readonly<Record<string, PropertyDescriptor>>;

class ClosedDecoder {
  private readonly ancestors = new WeakSet<object>();

  public context(input: unknown): ManualCurationContext {
    return this.record(
      input,
      ['effectiveWorkspaceId', 'commandIdempotencyKey', 'authority'],
      [],
      'context',
      (record) => ({
        effectiveWorkspaceId: this.uuid(
          this.required(record, 'effectiveWorkspaceId'),
          'context.effectiveWorkspaceId',
        ),
        commandIdempotencyKey: this.commandKey(
          this.required(record, 'commandIdempotencyKey'),
        ),
        authority: this.authority(this.required(record, 'authority')),
      }),
    );
  }

  public termRequest(input: unknown): PutContentClassificationTermRequest {
    return this.record(
      input,
      ['termId', 'expectedRevision', 'value'],
      [],
      'request',
      (record) => ({
        termId: this.uuid(this.required(record, 'termId'), 'request.termId'),
        expectedRevision: this.version(
          this.required(record, 'expectedRevision'),
          'request.expectedRevision',
          'revision_number',
        ),
        value: this.termValue(this.required(record, 'value')),
      }),
    );
  }

  public targetRequest(input: unknown): ApplyManualCurationRequest {
    return this.record(
      input,
      ['target', 'expectedTargetVersion', 'operations'],
      [],
      'request',
      (record) => ({
        target: this.targetRef(this.required(record, 'target')),
        expectedTargetVersion: this.version(
          this.required(record, 'expectedTargetVersion'),
          'request.expectedTargetVersion',
          'target_version',
        ),
        operations: this.operations(this.required(record, 'operations')),
      }),
    );
  }

  public repositoryState(input: unknown): ManualCurationRepositorySnapshot {
    return this.record(
      input,
      [
        'evidenceTargets',
        'targets',
        'terms',
        'assignments',
        'decisions',
        'assessments',
        'commands',
      ],
      [],
      'state',
      (record) => ({
        evidenceTargets: this.array(
          this.required(record, 'evidenceTargets'),
          'state',
          undefined,
          (value) => this.evidenceTarget(value),
        ),
        targets: this.array(
          this.required(record, 'targets'),
          'state',
          undefined,
          (value) => this.targetState(value),
        ),
        terms: this.array(
          this.required(record, 'terms'),
          'state',
          undefined,
          (value) => this.termState(value),
        ),
        assignments: this.array(
          this.required(record, 'assignments'),
          'state',
          undefined,
          (value) => this.assignmentState(value),
        ),
        decisions: this.array(
          this.required(record, 'decisions'),
          'state',
          undefined,
          (value) => this.decisionState(value),
        ),
        assessments: this.array(
          this.required(record, 'assessments'),
          'state',
          undefined,
          (value) => this.assessmentState(value),
        ),
        commands: this.array(
          this.required(record, 'commands'),
          'state',
          undefined,
          (value) => this.commandState(value),
        ),
      }),
    );
  }

  private termValue(input: unknown): VocabularyTermValue {
    return this.record(
      input,
      ['displayName', 'lifecycle'],
      ['description', 'parentTermId'],
      'request.value',
      (record) => {
        const hasDescription = this.has(record, 'description');
        const hasParentTermId = this.has(record, 'parentTermId');
        return defineRecord<VocabularyTermValue>({
          displayName: this.text(
            this.required(record, 'displayName'),
            'request.value.displayName',
            CURATION_LIMITS.displayNameCodePoints,
            'display_name_code_points',
          ),
          ...(!hasDescription
            ? {}
            : {
                description: this.text(
                  this.required(record, 'description'),
                  'request.value.description',
                  CURATION_LIMITS.descriptionCodePoints,
                  'description_code_points',
                ),
              }),
          ...(!hasParentTermId
            ? {}
            : {
                parentTermId: this.uuid(
                  this.required(record, 'parentTermId'),
                  'request.value.parentTermId',
                ),
              }),
          lifecycle: this.lifecycle(
            this.required(record, 'lifecycle'),
            'request.value.lifecycle',
          ),
        });
      },
    );
  }

  private targetRef(input: unknown): CurationTargetRef {
    return this.record(
      input,
      ['kind'],
      ['snapshotId', 'fragmentId'],
      'request.target',
      (record) => {
        const kind = this.string(
          this.required(record, 'kind'),
          'request.target.kind',
        );
        if (kind === 'snapshot') {
          if (this.has(record, 'fragmentId')) {
            throw fault('invalid_shape', 'request.target');
          }
          if (!this.has(record, 'snapshotId')) {
            throw fault('invalid_shape', 'request.target.snapshotId');
          }
          return {
            kind,
            snapshotId: this.uuid(
              this.required(record, 'snapshotId'),
              'request.target.snapshotId',
            ),
          };
        }
        if (kind === 'fragment') {
          if (this.has(record, 'snapshotId')) {
            throw fault('invalid_shape', 'request.target');
          }
          if (!this.has(record, 'fragmentId')) {
            throw fault('invalid_shape', 'request.target.fragmentId');
          }
          return {
            kind,
            fragmentId: this.uuid(
              this.required(record, 'fragmentId'),
              'request.target.fragmentId',
            ),
          };
        }
        throw fault('invalid_state', 'request.target.kind');
      },
    );
  }

  private operations(input: unknown): readonly ManualCurationOperation[] {
    const seenTerms = new Set<string>();
    const seenDimensions = new Set<string>();
    let sawDecision = false;
    return this.array(
      input,
      'request.operations',
      CURATION_LIMITS.commandOperations,
      (operation, index) =>
        this.operation(operation, index, {
          seenTerms,
          seenDimensions,
          sawDecision: () => sawDecision,
          markDecision: () => {
            sawDecision = true;
          },
        }),
      'command_operations',
      true,
    );
  }

  private operation(
    input: unknown,
    index: number,
    seen: Readonly<{
      seenTerms: Set<string>;
      seenDimensions: Set<string>;
      sawDecision: () => boolean;
      markDecision: () => void;
    }>,
  ): ManualCurationOperation {
    const path = operationPath(index);
    return this.record(
      input,
      ['kind'],
      ['termId', 'action', 'reasonCodes', 'note', 'dimension', 'score'],
      path,
      (record) => {
        const kindPath = `${path}.kind` as CurationIssuePath;
        const kind = this.string(this.required(record, 'kind'), kindPath);
        if (
          kind === 'assign_classification' ||
          kind === 'remove_classification'
        ) {
          const termPath = `${path}.termId` as CurationIssuePath;
          if (!this.has(record, 'termId')) {
            throw fault('invalid_shape', termPath);
          }
          const termId = this.uuid(this.required(record, 'termId'), termPath);
          if (seen.seenTerms.has(termId)) {
            throw fault('duplicate_operation', path);
          }
          seen.seenTerms.add(termId);
          this.requireExactBranch(record, ['kind', 'termId'], path);
          return {kind, termId};
        }
        if (kind === 'set_intake_decision') {
          if (seen.sawDecision()) {
            throw fault('duplicate_operation', path);
          }
          seen.markDecision();
          this.requireExactBranch(
            record,
            ['kind', 'action', 'reasonCodes'],
            path,
            ['note'],
          );
          const action = this.action(
            this.required(record, 'action'),
            `${path}.action` as CurationIssuePath,
          );
          const reasonCodes = this.reasons(
            this.required(record, 'reasonCodes'),
            index,
          );
          const hasNote = this.has(record, 'note');
          const note = !hasNote
            ? undefined
            : this.text(
                this.required(record, 'note'),
                `${path}.note` as CurationIssuePath,
                CURATION_LIMITS.noteCodePoints,
                'note_code_points',
              );
          if (reasonCodes.includes('other') && note === undefined) {
            throw fault('invalid_state', `${path}.note` as CurationIssuePath);
          }
          return defineRecord<ManualCurationOperation>({
            kind,
            action,
            reasonCodes,
            ...(note === undefined ? {} : {note}),
          });
        }
        if (kind === 'set_assessment' || kind === 'clear_assessment') {
          const dimensionPath = `${path}.dimension` as CurationIssuePath;
          if (!this.has(record, 'dimension')) {
            throw fault('invalid_shape', dimensionPath);
          }
          const dimension = this.dimension(
            this.required(record, 'dimension'),
            dimensionPath,
          );
          if (seen.seenDimensions.has(dimension)) {
            throw fault('duplicate_operation', path);
          }
          seen.seenDimensions.add(dimension);
          this.requireExactBranch(
            record,
            kind === 'set_assessment'
              ? ['kind', 'dimension', 'score']
              : ['kind', 'dimension'],
            path,
            kind === 'set_assessment' ? ['note'] : [],
          );
          if (kind === 'clear_assessment') {
            return {kind, dimension};
          }
          const score = this.score(
            this.required(record, 'score'),
            `${path}.score` as CurationIssuePath,
          );
          const hasNote = this.has(record, 'note');
          return defineRecord<ManualCurationOperation>({
            kind,
            dimension,
            score,
            ...(!hasNote
              ? {}
              : {
                  note: this.text(
                    this.required(record, 'note'),
                    `${path}.note` as CurationIssuePath,
                    CURATION_LIMITS.noteCodePoints,
                    'note_code_points',
                  ),
                }),
          });
        }
        throw fault('invalid_state', kindPath);
      },
    );
  }

  private reasons(
    input: unknown,
    operationIndex: number,
  ): readonly IntakeFeedbackReason[] {
    const seen = new Set<string>();
    const path =
      `request.operations[${String(operationIndex)}].reasonCodes` as CurationIssuePath;
    return this.array(
      input,
      path,
      CURATION_LIMITS.feedbackReasons,
      (value, reasonIndex) => {
        const itemPath = `${path}[${String(reasonIndex)}]` as CurationIssuePath;
        const reason = this.string(value, itemPath);
        if (!REASONS.has(reason)) {
          throw fault('invalid_state', itemPath);
        }
        if (seen.has(reason)) {
          throw fault('invalid_state', itemPath);
        }
        seen.add(reason);
        return reason as IntakeFeedbackReason;
      },
      'feedback_reasons',
    );
  }

  private evidenceTarget(input: unknown): EvidenceTargetState {
    return this.stateRecord(
      input,
      ['workspaceId', 'kind'],
      ['resourceId', 'snapshotId', 'fragmentId'],
      (record) => {
        const workspaceId = this.stateUuid(
          this.required(record, 'workspaceId'),
        );
        const kind = this.stateString(this.required(record, 'kind'));
        if (kind === 'snapshot') {
          this.requireStateBranch(record, [
            'workspaceId',
            'kind',
            'resourceId',
            'snapshotId',
          ]);
          return {
            workspaceId,
            kind,
            resourceId: this.stateUuid(this.required(record, 'resourceId')),
            snapshotId: this.stateUuid(this.required(record, 'snapshotId')),
          };
        }
        if (kind === 'fragment') {
          this.requireStateBranch(record, [
            'workspaceId',
            'kind',
            'fragmentId',
          ]);
          return {
            workspaceId,
            kind,
            fragmentId: this.stateUuid(this.required(record, 'fragmentId')),
          };
        }
        throw fault('invalid_shape', 'state');
      },
    );
  }

  private targetState(input: unknown): CurationTargetState {
    return this.stateRecord(
      input,
      ['workspaceId', 'kind', 'targetId', 'currentVersion'],
      ['resourceId', 'snapshotId', 'fragmentId'],
      (record) => {
        const workspaceId = this.stateUuid(
          this.required(record, 'workspaceId'),
        );
        const targetId = this.stateUuid(this.required(record, 'targetId'));
        const currentVersion = this.stateVersion(
          this.required(record, 'currentVersion'),
        );
        const kind = this.stateString(this.required(record, 'kind'));
        if (kind === 'snapshot') {
          this.requireStateBranch(record, [
            'workspaceId',
            'kind',
            'targetId',
            'currentVersion',
            'resourceId',
            'snapshotId',
          ]);
          return {
            workspaceId,
            kind,
            targetId,
            currentVersion,
            resourceId: this.stateUuid(this.required(record, 'resourceId')),
            snapshotId: this.stateUuid(this.required(record, 'snapshotId')),
          };
        }
        if (kind === 'fragment') {
          this.requireStateBranch(record, [
            'workspaceId',
            'kind',
            'targetId',
            'currentVersion',
            'fragmentId',
          ]);
          return {
            workspaceId,
            kind,
            targetId,
            currentVersion,
            fragmentId: this.stateUuid(this.required(record, 'fragmentId')),
          };
        }
        throw fault('invalid_shape', 'state');
      },
    );
  }

  private termState(input: unknown): VocabularyTermState {
    return this.stateRecord(
      input,
      [
        'workspaceId',
        'termId',
        'currentRevision',
        'currentRevisionId',
        'value',
      ],
      [],
      (record) => ({
        workspaceId: this.stateUuid(this.required(record, 'workspaceId')),
        termId: this.stateUuid(this.required(record, 'termId')),
        currentRevision: this.statePositiveRevision(
          this.required(record, 'currentRevision'),
        ),
        currentRevisionId: this.stateUuid(
          this.required(record, 'currentRevisionId'),
        ),
        value: this.stateTermValue(this.required(record, 'value')),
      }),
    );
  }

  private stateTermValue(input: unknown): VocabularyTermValue {
    return this.stateRecord(
      input,
      ['displayName', 'lifecycle'],
      ['description', 'parentTermId'],
      (record) => {
        const hasDescription = this.has(record, 'description');
        const hasParent = this.has(record, 'parentTermId');
        const displayName = this.stateText(
          this.required(record, 'displayName'),
          CURATION_LIMITS.displayNameCodePoints,
        );
        const lifecycle = this.stateString(this.required(record, 'lifecycle'));
        if (!LIFECYCLES.has(lifecycle as VocabularyTermLifecycle)) {
          throw fault('invalid_shape', 'state');
        }
        return defineRecord<VocabularyTermValue>({
          displayName,
          ...(!hasDescription
            ? {}
            : {
                description: this.stateText(
                  this.required(record, 'description'),
                  CURATION_LIMITS.descriptionCodePoints,
                ),
              }),
          ...(!hasParent
            ? {}
            : {
                parentTermId: this.stateUuid(
                  this.required(record, 'parentTermId'),
                ),
              }),
          lifecycle: lifecycle as VocabularyTermLifecycle,
        });
      },
    );
  }

  private assignmentState(input: unknown): ClassificationAssignmentState {
    return this.stateRecord(
      input,
      [
        'workspaceId',
        'assignmentId',
        'targetId',
        'termId',
        'currentRevision',
        'currentRevisionId',
        'state',
        'termRevisionNumber',
        'termRevisionId',
      ],
      [],
      (record) => {
        const state = this.stateString(this.required(record, 'state'));
        if (state !== 'assigned' && state !== 'removed') {
          throw fault('invalid_shape', 'state');
        }
        return {
          workspaceId: this.stateUuid(this.required(record, 'workspaceId')),
          assignmentId: this.stateUuid(this.required(record, 'assignmentId')),
          targetId: this.stateUuid(this.required(record, 'targetId')),
          termId: this.stateUuid(this.required(record, 'termId')),
          currentRevision: this.statePositiveRevision(
            this.required(record, 'currentRevision'),
          ),
          currentRevisionId: this.stateUuid(
            this.required(record, 'currentRevisionId'),
          ),
          state,
          termRevisionNumber: this.statePositiveRevision(
            this.required(record, 'termRevisionNumber'),
          ),
          termRevisionId: this.stateUuid(
            this.required(record, 'termRevisionId'),
          ),
        };
      },
    );
  }

  private decisionState(input: unknown): IntakeDecisionState {
    return this.stateRecord(
      input,
      [
        'workspaceId',
        'decisionId',
        'targetId',
        'currentRevision',
        'currentRevisionId',
        'value',
      ],
      [],
      (record) => ({
        workspaceId: this.stateUuid(this.required(record, 'workspaceId')),
        decisionId: this.stateUuid(this.required(record, 'decisionId')),
        targetId: this.stateUuid(this.required(record, 'targetId')),
        currentRevision: this.statePositiveRevision(
          this.required(record, 'currentRevision'),
        ),
        currentRevisionId: this.stateUuid(
          this.required(record, 'currentRevisionId'),
        ),
        value: this.stateDecisionValue(this.required(record, 'value')),
      }),
    );
  }

  private stateDecisionValue(input: unknown): IntakeDecisionValue {
    return this.stateRecord(
      input,
      ['action', 'reasonCodes'],
      ['note'],
      (record) => {
        const action = this.stateString(this.required(record, 'action'));
        if (!ACTIONS.has(action)) {
          throw fault('invalid_shape', 'state');
        }
        const reasons = this.array(
          this.required(record, 'reasonCodes'),
          'state',
          CURATION_LIMITS.feedbackReasons,
          (value) => {
            const reason = this.stateString(value);
            if (!REASONS.has(reason)) {
              throw fault('invalid_shape', 'state');
            }
            return reason as IntakeFeedbackReason;
          },
        );
        if (new Set(reasons).size !== reasons.length) {
          throw fault('invalid_shape', 'state');
        }
        const hasNote = this.has(record, 'note');
        if (reasons.includes('other') && !hasNote) {
          throw fault('invalid_shape', 'state');
        }
        return defineRecord<IntakeDecisionValue>({
          action: action as IntakeAction,
          reasonCodes: reasons,
          ...(!hasNote
            ? {}
            : {
                note: this.stateText(
                  this.required(record, 'note'),
                  CURATION_LIMITS.noteCodePoints,
                ),
              }),
        });
      },
    );
  }

  private assessmentState(input: unknown): AssessmentState {
    return this.stateRecord(
      input,
      [
        'workspaceId',
        'assessmentId',
        'targetId',
        'dimension',
        'currentRevision',
        'currentRevisionId',
        'value',
      ],
      [],
      (record) => ({
        workspaceId: this.stateUuid(this.required(record, 'workspaceId')),
        assessmentId: this.stateUuid(this.required(record, 'assessmentId')),
        targetId: this.stateUuid(this.required(record, 'targetId')),
        dimension: this.stateDimension(this.required(record, 'dimension')),
        currentRevision: this.statePositiveRevision(
          this.required(record, 'currentRevision'),
        ),
        currentRevisionId: this.stateUuid(
          this.required(record, 'currentRevisionId'),
        ),
        value: this.stateAssessmentValue(this.required(record, 'value')),
      }),
    );
  }

  private stateAssessmentValue(input: unknown): AssessmentRevisionValue {
    return this.stateRecord(input, ['state'], ['score', 'note'], (record) => {
      const state = this.stateString(this.required(record, 'state'));
      if (state === 'cleared') {
        this.requireStateBranch(record, ['state']);
        return {state};
      }
      if (state === 'rated') {
        this.requireStateBranch(record, ['state', 'score'], ['note']);
        const score = this.stateScore(this.required(record, 'score'));
        const hasNote = this.has(record, 'note');
        return defineRecord<AssessmentRevisionValue>({
          state,
          score,
          ...(!hasNote
            ? {}
            : {
                note: this.stateText(
                  this.required(record, 'note'),
                  CURATION_LIMITS.noteCodePoints,
                ),
              }),
        });
      }
      throw fault('invalid_shape', 'state');
    });
  }

  private commandState(input: unknown): StoredCurationCommandState {
    return this.stateRecord(
      input,
      ['workspaceId', 'commandIdempotencyKey', 'requestSha256', 'receipt'],
      [],
      (record) => ({
        workspaceId: this.stateUuid(this.required(record, 'workspaceId')),
        commandIdempotencyKey: this.stateCommandKey(
          this.required(record, 'commandIdempotencyKey'),
        ),
        requestSha256: this.stateSha256(this.required(record, 'requestSha256')),
        receipt: this.storedReceipt(this.required(record, 'receipt')),
      }),
    );
  }

  private storedReceipt(input: unknown): StoredCurationReceipt {
    return this.stateRecord(
      input,
      [
        'workspaceId',
        'commandIdempotencyKey',
        'commandKind',
        'originalOutcome',
      ],
      ['termId', 'targetId', 'resultingRevision', 'resultingVersion'],
      (record) => {
        const workspaceId = this.stateUuid(
          this.required(record, 'workspaceId'),
        );
        const commandIdempotencyKey = this.stateCommandKey(
          this.required(record, 'commandIdempotencyKey'),
        );
        const commandKind = this.stateString(
          this.required(record, 'commandKind'),
        );
        const originalOutcome = this.stateString(
          this.required(record, 'originalOutcome'),
        );
        if (originalOutcome !== 'applied' && originalOutcome !== 'unchanged') {
          throw fault('invalid_shape', 'state');
        }
        if (commandKind === 'put_content_classification_term') {
          this.requireStateBranch(record, [
            'workspaceId',
            'commandIdempotencyKey',
            'commandKind',
            'termId',
            'resultingRevision',
            'originalOutcome',
          ]);
          return {
            workspaceId,
            commandIdempotencyKey,
            commandKind,
            termId: this.stateUuid(this.required(record, 'termId')),
            resultingRevision: this.statePositiveRevision(
              this.required(record, 'resultingRevision'),
            ),
            originalOutcome,
          };
        }
        if (commandKind === 'apply_manual_curation') {
          this.requireStateBranch(record, [
            'workspaceId',
            'commandIdempotencyKey',
            'commandKind',
            'targetId',
            'resultingVersion',
            'originalOutcome',
          ]);
          return {
            workspaceId,
            commandIdempotencyKey,
            commandKind,
            targetId: this.stateUuid(this.required(record, 'targetId')),
            resultingVersion: this.stateVersion(
              this.required(record, 'resultingVersion'),
            ),
            originalOutcome,
          };
        }
        throw fault('invalid_shape', 'state');
      },
    );
  }

  private stateRecord<Value>(
    input: unknown,
    required: readonly string[],
    optional: readonly string[],
    project: (record: DescriptorRecord) => Value,
  ): Value {
    return this.record(input, required, optional, 'state', project);
  }

  private record<Value>(
    input: unknown,
    requiredKeys: readonly string[],
    optionalKeys: readonly string[],
    path: CurationIssuePath,
    project: (record: DescriptorRecord) => Value,
  ): Value {
    if (input === null || typeof input !== 'object' || isProxy(input)) {
      throw fault('invalid_shape', path);
    }
    if (this.ancestors.has(input)) {
      throw fault('invalid_shape', path);
    }
    let prototype: object | null;
    try {
      prototype = Reflect.getPrototypeOf(input);
    } catch {
      throw fault('invalid_shape', path);
    }
    if (prototype !== Object.prototype) {
      throw fault('invalid_shape', path);
    }
    for (const key of [...requiredKeys, ...optionalKeys]) {
      if (hasInheritedAccessor(Object.prototype, key)) {
        throw fault('invalid_shape', declaredPath(path, key));
      }
    }
    let keys: readonly PropertyKey[];
    try {
      keys = Reflect.ownKeys(input);
    } catch {
      throw fault('invalid_shape', path);
    }
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    const descriptors = {} as Record<string, PropertyDescriptor>;
    for (const key of keys) {
      if (
        typeof key !== 'string' ||
        DANGEROUS_KEYS.has(key) ||
        !allowed.has(key)
      ) {
        throw fault('invalid_shape', path);
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        throw fault('invalid_shape', declaredPath(path, key));
      }
      Object.defineProperty(descriptors, key, {
        value: descriptor,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    for (const key of requiredKeys) {
      if (!Object.hasOwn(descriptors, key)) {
        throw fault('invalid_shape', declaredPath(path, key));
      }
    }
    this.ancestors.add(input);
    try {
      return project(descriptors);
    } finally {
      this.ancestors.delete(input);
    }
  }

  private array<Value>(
    input: unknown,
    path: CurationIssuePath,
    maximumLength: number | undefined,
    decode: (value: unknown, index: number) => Value,
    budget?: CurationBudgetName,
    requireNonempty = false,
  ): readonly Value[] {
    if (input === null || typeof input !== 'object' || isProxy(input)) {
      throw fault('invalid_shape', path);
    }
    if (this.ancestors.has(input)) {
      throw fault('invalid_shape', path);
    }
    let prototype: object | null;
    try {
      prototype = Reflect.getPrototypeOf(input);
    } catch {
      throw fault('invalid_shape', path);
    }
    if (!Array.isArray(input) || prototype !== Array.prototype) {
      throw fault('invalid_shape', path);
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(input, 'length');
    const length = lengthDescriptor?.value as unknown;
    if (
      lengthDescriptor === undefined ||
      !Object.hasOwn(lengthDescriptor, 'value') ||
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 0
    ) {
      throw fault('invalid_shape', path);
    }
    if (maximumLength !== undefined && length > maximumLength) {
      if (budget === undefined) {
        throw fault('invalid_shape', path);
      }
      throw fault('limit_exceeded', path, budget);
    }
    if (requireNonempty && length === 0) {
      throw fault('invalid_state', path);
    }
    let keys: readonly PropertyKey[];
    try {
      keys = Reflect.ownKeys(input);
    } catch {
      throw fault('invalid_shape', path);
    }
    const descriptors = new Map<number, PropertyDescriptor>();
    for (const key of keys) {
      if (key === 'length') {
        continue;
      }
      if (typeof key !== 'string' || !isArrayIndex(key, length)) {
        throw fault('invalid_shape', path);
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        throw fault('invalid_shape', path);
      }
      descriptors.set(Number(key), descriptor);
    }
    if (descriptors.size !== length) {
      throw fault('invalid_shape', path);
    }
    for (let index = 0; index < length; index += 1) {
      if (hasInheritedAccessor(Array.prototype, String(index))) {
        throw fault('invalid_shape', path);
      }
    }
    this.ancestors.add(input);
    try {
      const result: Value[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors.get(index);
        if (descriptor === undefined) {
          throw fault('invalid_shape', path);
        }
        result.push(decode(descriptor.value as unknown, index));
      }
      return result;
    } finally {
      this.ancestors.delete(input);
    }
  }

  private requireExactBranch(
    record: DescriptorRecord,
    required: readonly string[],
    path: CurationIssuePath,
    optional: readonly string[] = [],
  ): void {
    const allowed = new Set([...required, ...optional]);
    for (const key of Object.keys(record)) {
      if (!allowed.has(key)) {
        throw fault('invalid_shape', path);
      }
    }
    for (const key of required) {
      if (!Object.hasOwn(record, key)) {
        throw fault('invalid_shape', declaredPath(path, key));
      }
    }
  }

  private requireStateBranch(
    record: DescriptorRecord,
    required: readonly string[],
    optional: readonly string[] = [],
  ): void {
    const allowed = new Set([...required, ...optional]);
    if (
      Object.keys(record).some((key) => !allowed.has(key)) ||
      required.some((key) => !Object.hasOwn(record, key))
    ) {
      throw fault('invalid_shape', 'state');
    }
  }

  private required(record: DescriptorRecord, key: string): unknown {
    const descriptor = record[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
      throw fault('invalid_shape', 'state');
    }
    return descriptor.value as unknown;
  }

  private has(record: DescriptorRecord, key: string): boolean {
    return Object.hasOwn(record, key);
  }

  private string(input: unknown, path: CurationIssuePath): string {
    if (typeof input !== 'string') {
      throw fault('invalid_shape', path);
    }
    return input;
  }

  private uuid(input: unknown, path: CurationIssuePath): string {
    const value = this.string(input, path);
    if (!UUID_PATTERN.test(value)) {
      throw fault('invalid_identifier', path);
    }
    return value;
  }

  private commandKey(input: unknown): string {
    const path = 'context.commandIdempotencyKey';
    const value = this.string(input, path);
    if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
      throw fault('invalid_identifier', path);
    }
    if (value.length > CURATION_LIMITS.idempotencyKeyCharacters) {
      throw fault('limit_exceeded', path, 'idempotency_key_characters');
    }
    return value;
  }

  private authority(input: unknown): 'manual_user' {
    const value = this.string(input, 'context.authority');
    if (value !== 'manual_user') {
      throw fault('invalid_state', 'context.authority');
    }
    return value;
  }

  private version(
    input: unknown,
    path: CurationIssuePath,
    budget: 'revision_number' | 'target_version',
  ): number {
    if (typeof input !== 'number') {
      throw fault('invalid_shape', path);
    }
    if (!Number.isFinite(input) || !Number.isSafeInteger(input) || input < 0) {
      throw fault('invalid_state', path);
    }
    const limit =
      budget === 'revision_number'
        ? CURATION_LIMITS.revisionNumber
        : CURATION_LIMITS.targetVersion;
    if (input > limit) {
      throw fault('limit_exceeded', path, budget);
    }
    return input;
  }

  private text(
    input: unknown,
    path: CurationIssuePath,
    limit: number,
    budget: CurationBudgetName,
  ): string {
    const value = this.string(input, path);
    if (!isValidText(value)) {
      throw fault('invalid_text', path);
    }
    if (Array.from(value).length > limit) {
      throw fault('limit_exceeded', path, budget);
    }
    return value;
  }

  private lifecycle(
    input: unknown,
    path: CurationIssuePath,
  ): VocabularyTermLifecycle {
    const value = this.string(input, path);
    if (!LIFECYCLES.has(value as VocabularyTermLifecycle)) {
      throw fault('invalid_state', path);
    }
    return value as VocabularyTermLifecycle;
  }

  private action(input: unknown, path: CurationIssuePath): IntakeAction {
    const value = this.string(input, path);
    if (!ACTIONS.has(value)) {
      throw fault('invalid_state', path);
    }
    return value as IntakeAction;
  }

  private dimension(
    input: unknown,
    path: CurationIssuePath,
  ): AssessmentDimension {
    const value = this.string(input, path);
    if (!DIMENSIONS.has(value)) {
      throw fault('invalid_state', path);
    }
    return value as AssessmentDimension;
  }

  private score(input: unknown, path: CurationIssuePath): 0 | 1 | 2 | 3 | 4 {
    if (typeof input !== 'number') {
      throw fault('invalid_shape', path);
    }
    if (!Number.isInteger(input) || input < 0 || input > 4) {
      throw fault('invalid_state', path);
    }
    return input as 0 | 1 | 2 | 3 | 4;
  }

  private stateString(input: unknown): string {
    if (typeof input !== 'string') {
      throw fault('invalid_shape', 'state');
    }
    return input;
  }

  private stateUuid(input: unknown): string {
    const value = this.stateString(input);
    if (!UUID_PATTERN.test(value)) {
      throw fault('invalid_identifier', 'state');
    }
    return value;
  }

  private stateVersion(input: unknown): number {
    if (
      typeof input !== 'number' ||
      !Number.isSafeInteger(input) ||
      input < 0 ||
      input > CURATION_LIMITS.targetVersion
    ) {
      throw fault('invalid_shape', 'state');
    }
    return input;
  }

  private statePositiveRevision(input: unknown): number {
    const revision = this.stateVersion(input);
    if (revision < 1) {
      throw fault('invalid_shape', 'state');
    }
    return revision;
  }

  private stateText(input: unknown, limit: number): string {
    const value = this.stateString(input);
    if (!isValidText(value) || Array.from(value).length > limit) {
      throw fault('invalid_shape', 'state');
    }
    return value;
  }

  private stateDimension(input: unknown): AssessmentDimension {
    const dimension = this.stateString(input);
    if (!DIMENSIONS.has(dimension)) {
      throw fault('invalid_shape', 'state');
    }
    return dimension as AssessmentDimension;
  }

  private stateScore(input: unknown): 0 | 1 | 2 | 3 | 4 {
    if (
      typeof input !== 'number' ||
      !Number.isInteger(input) ||
      input < 0 ||
      input > 4
    ) {
      throw fault('invalid_shape', 'state');
    }
    return input as 0 | 1 | 2 | 3 | 4;
  }

  private stateCommandKey(input: unknown): string {
    const value = this.stateString(input);
    if (
      !IDEMPOTENCY_KEY_PATTERN.test(value) ||
      value.length > CURATION_LIMITS.idempotencyKeyCharacters
    ) {
      throw fault('invalid_shape', 'state');
    }
    return value;
  }

  private stateSha256(input: unknown): string {
    const value = this.stateString(input);
    if (!SHA256_PATTERN.test(value)) {
      throw fault('invalid_shape', 'state');
    }
    return value;
  }
}

export function decodeManualCurationContext(
  input: unknown,
): ManualCurationContext {
  return deepFreeze(new ClosedDecoder().context(input));
}

export function decodePutContentClassificationTermRequest(
  input: unknown,
): PutContentClassificationTermRequest {
  return deepFreeze(new ClosedDecoder().termRequest(input));
}

export function decodeApplyManualCurationRequest(
  input: unknown,
): ApplyManualCurationRequest {
  return deepFreeze(new ClosedDecoder().targetRequest(input));
}

export function decodeManualCurationRepositorySnapshot(
  input: unknown,
): ManualCurationRepositorySnapshot {
  return deepFreeze(new ClosedDecoder().repositoryState(input));
}

export function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function defineRecord<Value extends object>(values: Value): Value {
  const output = {} as Value;
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(output, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output;
}

function fault(
  code: Exclude<CurationIssueCode, 'persistence_failed'>,
  path: CurationIssuePath,
  budget?: CurationBudgetName,
): CurationInputFault {
  return new CurationInputFault(code, path, budget);
}

function isProxy(value: object): boolean {
  try {
    return utilityTypes.isProxy(value);
  } catch {
    return true;
  }
}

function isArrayIndex(key: string, length: number): boolean {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(key)) {
    return false;
  }
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function hasInheritedAccessor(
  prototype: object | null,
  key: PropertyKey,
): boolean {
  let cursor = prototype;
  while (cursor !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (
      descriptor !== undefined &&
      (typeof descriptor.get === 'function' ||
        typeof descriptor.set === 'function')
    ) {
      return true;
    }
    cursor = Object.getPrototypeOf(cursor) as object | null;
  }
  return false;
}

function isValidText(value: string): boolean {
  if (
    value.length === 0 ||
    value.includes('\u0000') ||
    value.trim().length === 0 ||
    value.trim() !== value
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return false;
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function operationPath(index: number): CurationIssuePath {
  return `request.operations[${String(index)}]` as CurationIssuePath;
}

function declaredPath(path: CurationIssuePath, key: string): CurationIssuePath {
  if (path === 'state') {
    return path;
  }
  return `${path}.${key}` as CurationIssuePath;
}
