import {types as utilityTypes} from 'node:util';

import {
  type ApplyManualKnowledgeChangeSetRequest,
  ELIGIBLE_INTAKE_ACTIONS,
  EPISTEMIC_ROLES,
  type EpistemicRole,
  type FormalKnowledgeRevisionRef,
  type IntakeAction,
  type KnowledgeAuthorizationReceipt,
  type KnowledgeBoundedIndex,
  type KnowledgeBudgetName,
  type KnowledgeChangeEventState,
  type KnowledgeCurationTargetState,
  type KnowledgeFragmentState,
  type KnowledgeIntakeDecisionState,
  type KnowledgeIssueCode,
  type KnowledgeIssuePath,
  type KnowledgeItemRevisionValue,
  type KnowledgeItemState,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_LIMITS,
  type KnowledgeProvenanceInput,
  type KnowledgeRelationRevisionState,
  type KnowledgeRelationRevisionValue,
  type KnowledgeRelationState,
  KNOWLEDGE_REVIEW_STATES,
  type KnowledgeSourceTargetRef,
  type KnowledgeRevisionState,
  type ManualKnowledgeAuthorization,
  type ManualKnowledgeContext,
  type ManualKnowledgeOperation,
  type ManualKnowledgeRepositorySnapshot,
  type StoredKnowledgeChangeOperationState,
  type StoredKnowledgeChangeSetState,
} from './manual_knowledge_contract.js';
import {SHA256_PATTERN, UUID_PATTERN} from './manual_knowledge_identity.js';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/u;
const KNOWLEDGE_KIND_SET = new Set<string>(KNOWLEDGE_KINDS);
const EPISTEMIC_ROLE_SET = new Set<string>(EPISTEMIC_ROLES);
const REVIEW_STATE_SET = new Set<string>(KNOWLEDGE_REVIEW_STATES);
const INTAKE_ACTION_SET = new Set<string>([
  ...ELIGIBLE_INTAKE_ACTIONS,
  'source_only',
  'ignore',
  'needs_review',
]);

type DescriptorRecord = Readonly<Record<string, PropertyDescriptor>>;

interface ArrayHeader {
  readonly input: readonly unknown[];
  readonly length: number;
  readonly path: KnowledgeIssuePath;
}

interface PreparedArray extends ArrayHeader {
  readonly descriptors: ReadonlyMap<number, PropertyDescriptor>;
}

export class KnowledgeInputFault extends Error {
  public readonly code: Exclude<KnowledgeIssueCode, 'persistence_failed'>;
  public readonly path: KnowledgeIssuePath;
  public readonly budget: KnowledgeBudgetName | undefined;

  public constructor(
    code: Exclude<KnowledgeIssueCode, 'persistence_failed'>,
    path: KnowledgeIssuePath,
    budget?: KnowledgeBudgetName,
  ) {
    super('Manual knowledge input is invalid.');
    this.name = 'KnowledgeInputFault';
    this.code = code;
    this.path = path;
    this.budget = budget;
  }
}

class ClosedDecoder {
  private readonly ancestors = new WeakSet<object>();

  public context(input: unknown): ManualKnowledgeContext {
    return this.record(
      input,
      ['effectiveWorkspaceId', 'commandIdempotencyKey', 'authority'],
      [],
      'context',
      (record) =>
        defineRecord<ManualKnowledgeContext>({
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

  public request(input: unknown): ApplyManualKnowledgeChangeSetRequest {
    return this.record(
      input,
      ['authorization', 'operations'],
      [],
      'request',
      (record) => {
        const authorization = this.authorization(
          this.required(record, 'authorization'),
        );
        const operations = this.operations(this.required(record, 'operations'));
        this.rejectSameCommandDerivations(operations);
        return defineRecord<ApplyManualKnowledgeChangeSetRequest>({
          authorization,
          operations,
        });
      },
    );
  }

  public repositoryState(input: unknown): ManualKnowledgeRepositorySnapshot {
    return this.record(
      input,
      [
        'curationTargets',
        'intakeDecisions',
        'fragments',
        'items',
        'revisions',
        'relations',
        'relationRevisions',
        'changeSets',
        'changeOperations',
        'changeEvents',
      ],
      [],
      'state',
      (record) =>
        defineRecord<ManualKnowledgeRepositorySnapshot>({
          curationTargets: this.stateArray(
            this.required(record, 'curationTargets'),
            (value) => this.curationTargetState(value),
          ),
          intakeDecisions: this.stateArray(
            this.required(record, 'intakeDecisions'),
            (value) => this.intakeDecisionState(value),
          ),
          fragments: this.stateArray(
            this.required(record, 'fragments'),
            (value) => this.fragmentState(value),
          ),
          items: this.stateArray(this.required(record, 'items'), (value) =>
            this.itemState(value),
          ),
          revisions: this.stateArray(
            this.required(record, 'revisions'),
            (value) => this.revisionState(value),
          ),
          relations: this.stateArray(
            this.required(record, 'relations'),
            (value) => this.relationState(value),
          ),
          relationRevisions: this.stateArray(
            this.required(record, 'relationRevisions'),
            (value) => this.relationRevisionState(value),
          ),
          changeSets: this.stateArray(
            this.required(record, 'changeSets'),
            (value) => this.changeSetState(value),
          ),
          changeOperations: this.stateArray(
            this.required(record, 'changeOperations'),
            (value) => this.changeOperationState(value),
          ),
          changeEvents: this.stateArray(
            this.required(record, 'changeEvents'),
            (value) => this.changeEventState(value),
          ),
        }),
    );
  }

  private authorization(input: unknown): ManualKnowledgeAuthorization {
    return this.record(
      input,
      ['kind'],
      ['target', 'expectedDecisionRevision'],
      'request.authorization',
      (record) => {
        const kind = this.string(
          this.required(record, 'kind'),
          'request.authorization.kind',
        );
        if (kind === 'manual_edit') {
          this.requireExactBranch(record, ['kind'], 'request.authorization');
          return defineRecord({kind});
        }
        if (kind !== 'eligible_target') {
          throw fault('invalid_state', 'request.authorization.kind');
        }
        this.requireExactBranch(
          record,
          ['kind', 'target', 'expectedDecisionRevision'],
          'request.authorization',
        );
        return defineRecord({
          kind,
          target: this.targetRef(this.required(record, 'target')),
          expectedDecisionRevision: this.revision(
            this.required(record, 'expectedDecisionRevision'),
            'request.authorization.expectedDecisionRevision',
            false,
          ),
        });
      },
    );
  }

  private targetRef(input: unknown): KnowledgeSourceTargetRef {
    return this.record(
      input,
      ['kind'],
      ['snapshotId', 'fragmentId'],
      'request.authorization.target',
      (record) => {
        const kind = this.string(
          this.required(record, 'kind'),
          'request.authorization.target.kind',
        );
        if (kind === 'snapshot') {
          this.requireExactBranch(
            record,
            ['kind', 'snapshotId'],
            'request.authorization.target',
          );
          return defineRecord({
            kind,
            snapshotId: this.uuid(
              this.required(record, 'snapshotId'),
              'request.authorization.target.snapshotId',
            ),
          });
        }
        if (kind === 'fragment') {
          this.requireExactBranch(
            record,
            ['kind', 'fragmentId'],
            'request.authorization.target',
          );
          return defineRecord({
            kind,
            fragmentId: this.uuid(
              this.required(record, 'fragmentId'),
              'request.authorization.target.fragmentId',
            ),
          });
        }
        throw fault('invalid_state', 'request.authorization.target.kind');
      },
    );
  }

  private operations(input: unknown): readonly ManualKnowledgeOperation[] {
    const header = this.arrayHeader(
      input,
      'request.operations',
      KNOWLEDGE_LIMITS.changeSetOperations,
      'change_set_operations',
      true,
    );
    const itemIds = new Set<string>();
    const relationIds = new Set<string>();
    return this.decodeArray(header, (value, index) =>
      this.operation(value, index, itemIds, relationIds),
    );
  }

  private operation(
    input: unknown,
    index: number,
    itemIds: Set<string>,
    relationIds: Set<string>,
  ): ManualKnowledgeOperation {
    const path = operationPath(index);
    return this.record(
      input,
      ['kind'],
      ['itemId', 'relationId', 'expectedRevision', 'value', 'provenance'],
      path,
      (record) => {
        const kind = this.string(
          this.required(record, 'kind'),
          `${path}.kind` as KnowledgeIssuePath,
        );
        if (kind === 'put_item') {
          this.requireExactBranch(
            record,
            ['kind', 'itemId', 'expectedRevision', 'value', 'provenance'],
            path,
          );
          const itemId = this.uuid(
            this.required(record, 'itemId'),
            `${path}.itemId` as KnowledgeIssuePath,
          );
          if (itemIds.has(itemId)) {
            throw fault('duplicate_operation', path);
          }
          itemIds.add(itemId);
          return defineRecord<ManualKnowledgeOperation>({
            kind,
            itemId,
            expectedRevision: this.revision(
              this.required(record, 'expectedRevision'),
              `${path}.expectedRevision` as KnowledgeIssuePath,
              true,
            ),
            value: this.itemValue(this.required(record, 'value'), path),
            provenance: this.provenance(
              this.required(record, 'provenance'),
              path,
            ),
          });
        }
        if (kind === 'put_relation') {
          this.requireExactBranch(
            record,
            ['kind', 'relationId', 'expectedRevision', 'value', 'provenance'],
            path,
          );
          const relationId = this.uuid(
            this.required(record, 'relationId'),
            `${path}.relationId` as KnowledgeIssuePath,
          );
          if (relationIds.has(relationId)) {
            throw fault('duplicate_operation', path);
          }
          relationIds.add(relationId);
          return defineRecord<ManualKnowledgeOperation>({
            kind,
            relationId,
            expectedRevision: this.revision(
              this.required(record, 'expectedRevision'),
              `${path}.expectedRevision` as KnowledgeIssuePath,
              true,
            ),
            value: this.relationValue(this.required(record, 'value'), path),
            provenance: this.provenance(
              this.required(record, 'provenance'),
              path,
            ),
          });
        }
        throw fault('invalid_state', `${path}.kind` as KnowledgeIssuePath);
      },
    );
  }

  private itemValue(
    input: unknown,
    operationPathValue: KnowledgeIssuePath,
  ): KnowledgeItemRevisionValue {
    const path = `${operationPathValue}.value` as KnowledgeIssuePath;
    return this.record(
      input,
      ['knowledgeKind', 'epistemicRole', 'reviewState', 'title'],
      ['body'],
      path,
      (record) => {
        const hasBody = this.has(record, 'body');
        return defineRecord<KnowledgeItemRevisionValue>({
          knowledgeKind: this.knowledgeKind(
            this.required(record, 'knowledgeKind'),
            `${path}.knowledgeKind` as KnowledgeIssuePath,
          ),
          epistemicRole: this.epistemicRole(
            this.required(record, 'epistemicRole'),
            `${path}.epistemicRole` as KnowledgeIssuePath,
          ),
          reviewState: this.reviewState(
            this.required(record, 'reviewState'),
            `${path}.reviewState` as KnowledgeIssuePath,
          ),
          title: this.singleLineText(
            this.required(record, 'title'),
            `${path}.title` as KnowledgeIssuePath,
            KNOWLEDGE_LIMITS.titleCodePoints,
            'title_code_points',
          ),
          ...(!hasBody
            ? {}
            : {
                body: this.multilineText(
                  this.required(record, 'body'),
                  `${path}.body` as KnowledgeIssuePath,
                  KNOWLEDGE_LIMITS.bodyCodePoints,
                  'body_code_points',
                ),
              }),
        });
      },
    );
  }

  private relationValue(
    input: unknown,
    operationPathValue: KnowledgeIssuePath,
  ): KnowledgeRelationRevisionValue {
    const path = `${operationPathValue}.value` as KnowledgeIssuePath;
    return this.record(
      input,
      [
        'subjectItemId',
        'relationTypeKey',
        'objectItemId',
        'epistemicRole',
        'reviewState',
      ],
      ['qualifier'],
      path,
      (record) => {
        const hasQualifier = this.has(record, 'qualifier');
        const role = this.epistemicRole(
          this.required(record, 'epistemicRole'),
          `${path}.epistemicRole` as KnowledgeIssuePath,
        );
        if (role === 'source_excerpt') {
          throw fault(
            'invalid_state',
            `${path}.epistemicRole` as KnowledgeIssuePath,
          );
        }
        return defineRecord<KnowledgeRelationRevisionValue>({
          subjectItemId: this.uuid(
            this.required(record, 'subjectItemId'),
            `${path}.subjectItemId` as KnowledgeIssuePath,
          ),
          relationTypeKey: this.singleLineText(
            this.required(record, 'relationTypeKey'),
            `${path}.relationTypeKey` as KnowledgeIssuePath,
            KNOWLEDGE_LIMITS.relationTypeCodePoints,
            'relation_type_code_points',
          ),
          objectItemId: this.uuid(
            this.required(record, 'objectItemId'),
            `${path}.objectItemId` as KnowledgeIssuePath,
          ),
          epistemicRole: role,
          reviewState: this.reviewState(
            this.required(record, 'reviewState'),
            `${path}.reviewState` as KnowledgeIssuePath,
          ),
          ...(!hasQualifier
            ? {}
            : {
                qualifier: this.multilineText(
                  this.required(record, 'qualifier'),
                  `${path}.qualifier` as KnowledgeIssuePath,
                  KNOWLEDGE_LIMITS.qualifierCodePoints,
                  'qualifier_code_points',
                ),
              }),
        });
      },
    );
  }

  private provenance(
    input: unknown,
    operationPathValue: KnowledgeIssuePath,
  ): KnowledgeProvenanceInput {
    const path = `${operationPathValue}.provenance` as KnowledgeIssuePath;
    return this.record(
      input,
      ['citations', 'fragmentDerivations', 'knowledgeDerivations'],
      [],
      path,
      (record) => {
        const citationPath = `${path}.citations` as KnowledgeIssuePath;
        const fragmentPath =
          `${path}.fragmentDerivations` as KnowledgeIssuePath;
        const knowledgePath =
          `${path}.knowledgeDerivations` as KnowledgeIssuePath;
        const citationHeader = this.arrayHeader(
          this.required(record, 'citations'),
          citationPath,
        );
        const fragmentHeader = this.arrayHeader(
          this.required(record, 'fragmentDerivations'),
          fragmentPath,
        );
        const knowledgeHeader = this.arrayHeader(
          this.required(record, 'knowledgeDerivations'),
          knowledgePath,
        );
        if (
          citationHeader.length +
            fragmentHeader.length +
            knowledgeHeader.length >
          KNOWLEDGE_LIMITS.operationProvenanceInputs
        ) {
          throw fault('limit_exceeded', path, 'operation_provenance_inputs');
        }
        const citationArray = this.prepareArray(citationHeader);
        const fragmentArray = this.prepareArray(fragmentHeader);
        const knowledgeArray = this.prepareArray(knowledgeHeader);
        const seenFragments = new Set<string>();
        const citations = this.decodePreparedArray(
          citationArray,
          (value, index) => {
            const elementPath =
              `${citationPath}[${String(index)}]` as KnowledgeIssuePath;
            const fragmentId = this.uuid(value, elementPath);
            if (seenFragments.has(fragmentId)) {
              throw fault('invalid_provenance', elementPath);
            }
            seenFragments.add(fragmentId);
            return fragmentId;
          },
        );
        const fragmentDerivations = this.decodePreparedArray(
          fragmentArray,
          (value, index) => {
            const elementPath =
              `${fragmentPath}[${String(index)}]` as KnowledgeIssuePath;
            const fragmentId = this.uuid(value, elementPath);
            if (seenFragments.has(fragmentId)) {
              throw fault('invalid_provenance', elementPath);
            }
            seenFragments.add(fragmentId);
            return fragmentId;
          },
        );
        const seenKnowledge = new Set<string>();
        const knowledgeDerivations = this.decodePreparedArray(
          knowledgeArray,
          (value, index) => {
            const reference = this.formalRevisionRef(
              value,
              operationPathValue,
              index,
            );
            const identity = formalRevisionIdentity(reference);
            if (seenKnowledge.has(identity)) {
              throw fault(
                'invalid_provenance',
                `${knowledgePath}[${String(index)}]` as KnowledgeIssuePath,
              );
            }
            seenKnowledge.add(identity);
            return reference;
          },
        );
        if (
          citations.length === 0 &&
          fragmentDerivations.length === 0 &&
          knowledgeDerivations.length === 0
        ) {
          throw fault('invalid_provenance', path);
        }
        return defineRecord<KnowledgeProvenanceInput>({
          citations,
          fragmentDerivations,
          knowledgeDerivations,
        });
      },
    );
  }

  private formalRevisionRef(
    input: unknown,
    operationPathValue: KnowledgeIssuePath,
    index: number,
  ): FormalKnowledgeRevisionRef {
    const path =
      `${operationPathValue}.provenance.knowledgeDerivations[${String(index)}]` as KnowledgeIssuePath;
    return this.record(
      input,
      ['kind', 'revision'],
      ['itemId', 'relationId'],
      path,
      (record) => {
        const kind = this.string(
          this.required(record, 'kind'),
          `${path}.kind` as KnowledgeIssuePath,
        );
        if (kind === 'item') {
          this.requireExactBranch(record, ['kind', 'itemId', 'revision'], path);
          return defineRecord({
            kind,
            itemId: this.uuid(
              this.required(record, 'itemId'),
              `${path}.itemId` as KnowledgeIssuePath,
            ),
            revision: this.revision(
              this.required(record, 'revision'),
              `${path}.revision` as KnowledgeIssuePath,
              false,
            ),
          });
        }
        if (kind === 'relation') {
          this.requireExactBranch(
            record,
            ['kind', 'relationId', 'revision'],
            path,
          );
          return defineRecord({
            kind,
            relationId: this.uuid(
              this.required(record, 'relationId'),
              `${path}.relationId` as KnowledgeIssuePath,
            ),
            revision: this.revision(
              this.required(record, 'revision'),
              `${path}.revision` as KnowledgeIssuePath,
              false,
            ),
          });
        }
        throw fault('invalid_state', `${path}.kind` as KnowledgeIssuePath);
      },
    );
  }

  private rejectSameCommandDerivations(
    operations: readonly ManualKnowledgeOperation[],
  ): void {
    const itemIds = new Set(
      operations.flatMap((operation) =>
        operation.kind === 'put_item' ? [operation.itemId] : [],
      ),
    );
    const relationIds = new Set(
      operations.flatMap((operation) =>
        operation.kind === 'put_relation' ? [operation.relationId] : [],
      ),
    );
    for (
      let operationIndex = 0;
      operationIndex < operations.length;
      operationIndex += 1
    ) {
      const operation = operations[operationIndex];
      if (operation === undefined) {
        throw fault('invalid_shape', 'request.operations');
      }
      for (
        let derivationIndex = 0;
        derivationIndex < operation.provenance.knowledgeDerivations.length;
        derivationIndex += 1
      ) {
        const derivation =
          operation.provenance.knowledgeDerivations[derivationIndex];
        if (derivation === undefined) {
          throw fault('invalid_shape', 'request.operations');
        }
        const operatedOn =
          derivation.kind === 'item'
            ? itemIds.has(derivation.itemId)
            : relationIds.has(derivation.relationId);
        if (operatedOn) {
          throw fault(
            'invalid_provenance',
            `request.operations[${String(operationIndex)}].provenance.knowledgeDerivations[${String(derivationIndex)}]` as KnowledgeIssuePath,
          );
        }
      }
    }
  }

  private curationTargetState(input: unknown): KnowledgeCurationTargetState {
    return this.stateRecord(
      input,
      ['workspaceId', 'targetId', 'kind'],
      ['resourceId', 'snapshotId', 'fragmentId'],
      (record) => {
        const kind = this.stateString(this.required(record, 'kind'));
        if (kind === 'snapshot') {
          this.requireStateBranch(record, [
            'workspaceId',
            'targetId',
            'kind',
            'resourceId',
            'snapshotId',
          ]);
          return defineRecord({
            workspaceId: this.stateUuid(this.required(record, 'workspaceId')),
            targetId: this.stateUuid(this.required(record, 'targetId')),
            kind,
            resourceId: this.stateUuid(this.required(record, 'resourceId')),
            snapshotId: this.stateUuid(this.required(record, 'snapshotId')),
          });
        }
        if (kind === 'fragment') {
          this.requireStateBranch(record, [
            'workspaceId',
            'targetId',
            'kind',
            'fragmentId',
          ]);
          return defineRecord({
            workspaceId: this.stateUuid(this.required(record, 'workspaceId')),
            targetId: this.stateUuid(this.required(record, 'targetId')),
            kind,
            fragmentId: this.stateUuid(this.required(record, 'fragmentId')),
          });
        }
        throw stateFault();
      },
    );
  }

  private intakeDecisionState(input: unknown): KnowledgeIntakeDecisionState {
    return this.stateRecord(
      input,
      [
        'workspaceId',
        'targetId',
        'decisionId',
        'currentRevision',
        'currentRevisionId',
        'action',
      ],
      [],
      (record) =>
        defineRecord({
          workspaceId: this.stateUuid(this.required(record, 'workspaceId')),
          targetId: this.stateUuid(this.required(record, 'targetId')),
          decisionId: this.stateUuid(this.required(record, 'decisionId')),
          currentRevision: this.statePositiveRevision(
            this.required(record, 'currentRevision'),
          ),
          currentRevisionId: this.stateUuid(
            this.required(record, 'currentRevisionId'),
          ),
          action: this.stateIntakeAction(this.required(record, 'action')),
        }),
    );
  }

  private fragmentState(input: unknown): KnowledgeFragmentState {
    return this.stateRecord(
      input,
      [
        'workspaceId',
        'resourceId',
        'snapshotId',
        'fragmentId',
        'selectedTextSha256',
      ],
      [],
      (record) =>
        defineRecord({
          workspaceId: this.stateUuid(this.required(record, 'workspaceId')),
          resourceId: this.stateUuid(this.required(record, 'resourceId')),
          snapshotId: this.stateUuid(this.required(record, 'snapshotId')),
          fragmentId: this.stateUuid(this.required(record, 'fragmentId')),
          selectedTextSha256: this.stateSha256(
            this.required(record, 'selectedTextSha256'),
          ),
        }),
    );
  }

  private itemState(input: unknown): KnowledgeItemState {
    return this.stateRecord(
      input,
      ['workspaceId', 'itemId', 'currentRevision', 'currentRevisionId'],
      [],
      (record) =>
        defineRecord({
          workspaceId: this.stateUuid(this.required(record, 'workspaceId')),
          itemId: this.stateUuid(this.required(record, 'itemId')),
          currentRevision: this.statePositiveRevision(
            this.required(record, 'currentRevision'),
          ),
          currentRevisionId: this.stateUuid(
            this.required(record, 'currentRevisionId'),
          ),
        }),
    );
  }

  private revisionState(input: unknown): KnowledgeRevisionState {
    return this.stateRecord(
      input,
      [
        'workspaceId',
        'itemId',
        'revision',
        'revisionId',
        'value',
        'provenance',
      ],
      ['previousRevisionId'],
      (record) => {
        const hasPrevious = this.has(record, 'previousRevisionId');
        return defineRecord({
          workspaceId: this.stateUuid(this.required(record, 'workspaceId')),
          itemId: this.stateUuid(this.required(record, 'itemId')),
          revision: this.statePositiveRevision(
            this.required(record, 'revision'),
          ),
          revisionId: this.stateUuid(this.required(record, 'revisionId')),
          ...(!hasPrevious
            ? {}
            : {
                previousRevisionId: this.stateUuid(
                  this.required(record, 'previousRevisionId'),
                ),
              }),
          value: this.stateItemValue(this.required(record, 'value')),
          provenance: this.stateProvenance(this.required(record, 'provenance')),
        });
      },
    );
  }

  private relationState(input: unknown): KnowledgeRelationState {
    return this.stateRecord(
      input,
      [
        'workspaceId',
        'relationId',
        'subjectItemId',
        'relationTypeKey',
        'objectItemId',
        'currentRevision',
        'currentRevisionId',
      ],
      [],
      (record) =>
        defineRecord({
          workspaceId: this.stateUuid(this.required(record, 'workspaceId')),
          relationId: this.stateUuid(this.required(record, 'relationId')),
          subjectItemId: this.stateUuid(this.required(record, 'subjectItemId')),
          relationTypeKey: this.stateSingleLineText(
            this.required(record, 'relationTypeKey'),
            KNOWLEDGE_LIMITS.relationTypeCodePoints,
          ),
          objectItemId: this.stateUuid(this.required(record, 'objectItemId')),
          currentRevision: this.statePositiveRevision(
            this.required(record, 'currentRevision'),
          ),
          currentRevisionId: this.stateUuid(
            this.required(record, 'currentRevisionId'),
          ),
        }),
    );
  }

  private relationRevisionState(
    input: unknown,
  ): KnowledgeRelationRevisionState {
    return this.stateRecord(
      input,
      [
        'workspaceId',
        'relationId',
        'revision',
        'revisionId',
        'value',
        'provenance',
      ],
      ['previousRevisionId'],
      (record) => {
        const hasPrevious = this.has(record, 'previousRevisionId');
        return defineRecord({
          workspaceId: this.stateUuid(this.required(record, 'workspaceId')),
          relationId: this.stateUuid(this.required(record, 'relationId')),
          revision: this.statePositiveRevision(
            this.required(record, 'revision'),
          ),
          revisionId: this.stateUuid(this.required(record, 'revisionId')),
          ...(!hasPrevious
            ? {}
            : {
                previousRevisionId: this.stateUuid(
                  this.required(record, 'previousRevisionId'),
                ),
              }),
          value: this.stateRelationValue(this.required(record, 'value')),
          provenance: this.stateProvenance(this.required(record, 'provenance')),
        });
      },
    );
  }

  private changeSetState(input: unknown): StoredKnowledgeChangeSetState {
    return this.stateRecord(
      input,
      [
        'workspaceId',
        'commandIdempotencyKey',
        'changeSetId',
        'requestSha256',
        'authorization',
        'originalOutcome',
        'operationCount',
      ],
      [],
      (record) =>
        defineRecord({
          workspaceId: this.stateUuid(this.required(record, 'workspaceId')),
          commandIdempotencyKey: this.stateCommandKey(
            this.required(record, 'commandIdempotencyKey'),
          ),
          changeSetId: this.stateUuid(this.required(record, 'changeSetId')),
          requestSha256: this.stateSha256(
            this.required(record, 'requestSha256'),
          ),
          authorization: this.stateAuthorizationReceipt(
            this.required(record, 'authorization'),
          ),
          originalOutcome: this.stateOutcome(
            this.required(record, 'originalOutcome'),
          ),
          operationCount: this.stateOperationCount(
            this.required(record, 'operationCount'),
          ),
        }),
    );
  }

  private changeOperationState(
    input: unknown,
  ): StoredKnowledgeChangeOperationState {
    return this.stateRecord(
      input,
      [
        'workspaceId',
        'changeSetId',
        'operationIndex',
        'operationKind',
        'resultingRevision',
        'resultingRevisionId',
        'outcome',
      ],
      ['itemId', 'relationId'],
      (record) => {
        const operationKind = this.stateString(
          this.required(record, 'operationKind'),
        );
        const common = {
          workspaceId: this.stateUuid(this.required(record, 'workspaceId')),
          changeSetId: this.stateUuid(this.required(record, 'changeSetId')),
          operationIndex: this.stateBoundedIndex(
            this.required(record, 'operationIndex'),
          ),
          resultingRevision: this.statePositiveRevision(
            this.required(record, 'resultingRevision'),
          ),
          resultingRevisionId: this.stateUuid(
            this.required(record, 'resultingRevisionId'),
          ),
          outcome: this.stateOutcome(this.required(record, 'outcome')),
        } as const;
        if (operationKind === 'put_item') {
          this.requireStateBranch(record, [
            'workspaceId',
            'changeSetId',
            'operationIndex',
            'operationKind',
            'itemId',
            'resultingRevision',
            'resultingRevisionId',
            'outcome',
          ]);
          return defineRecord({
            ...common,
            operationKind,
            itemId: this.stateUuid(this.required(record, 'itemId')),
          });
        }
        if (operationKind === 'put_relation') {
          this.requireStateBranch(record, [
            'workspaceId',
            'changeSetId',
            'operationIndex',
            'operationKind',
            'relationId',
            'resultingRevision',
            'resultingRevisionId',
            'outcome',
          ]);
          return defineRecord({
            ...common,
            operationKind,
            relationId: this.stateUuid(this.required(record, 'relationId')),
          });
        }
        throw stateFault();
      },
    );
  }

  private changeEventState(input: unknown): KnowledgeChangeEventState {
    return this.stateRecord(
      input,
      [
        'workspaceId',
        'eventId',
        'eventKind',
        'eventSchemaVersion',
        'changeSetId',
      ],
      [],
      (record) => {
        const eventKind = this.stateString(this.required(record, 'eventKind'));
        const schemaVersion = this.required(record, 'eventSchemaVersion');
        if (
          eventKind !== 'knowledge_change_set_committed' ||
          schemaVersion !== 1
        ) {
          throw stateFault();
        }
        return defineRecord({
          workspaceId: this.stateUuid(this.required(record, 'workspaceId')),
          eventId: this.stateUuid(this.required(record, 'eventId')),
          eventKind,
          eventSchemaVersion: schemaVersion,
          changeSetId: this.stateUuid(this.required(record, 'changeSetId')),
        });
      },
    );
  }

  private stateItemValue(input: unknown): KnowledgeItemRevisionValue {
    return this.stateRecord(
      input,
      ['knowledgeKind', 'epistemicRole', 'reviewState', 'title'],
      ['body'],
      (record) => {
        const hasBody = this.has(record, 'body');
        return defineRecord({
          knowledgeKind: this.stateKnowledgeKind(
            this.required(record, 'knowledgeKind'),
          ),
          epistemicRole: this.stateEpistemicRole(
            this.required(record, 'epistemicRole'),
          ),
          reviewState: this.stateReviewState(
            this.required(record, 'reviewState'),
          ),
          title: this.stateSingleLineText(
            this.required(record, 'title'),
            KNOWLEDGE_LIMITS.titleCodePoints,
          ),
          ...(!hasBody
            ? {}
            : {
                body: this.stateMultilineText(
                  this.required(record, 'body'),
                  KNOWLEDGE_LIMITS.bodyCodePoints,
                ),
              }),
        });
      },
    );
  }

  private stateRelationValue(input: unknown): KnowledgeRelationRevisionValue {
    return this.stateRecord(
      input,
      [
        'subjectItemId',
        'relationTypeKey',
        'objectItemId',
        'epistemicRole',
        'reviewState',
      ],
      ['qualifier'],
      (record) => {
        const hasQualifier = this.has(record, 'qualifier');
        const role = this.stateEpistemicRole(
          this.required(record, 'epistemicRole'),
        );
        if (role === 'source_excerpt') {
          throw stateFault();
        }
        return defineRecord({
          subjectItemId: this.stateUuid(this.required(record, 'subjectItemId')),
          relationTypeKey: this.stateSingleLineText(
            this.required(record, 'relationTypeKey'),
            KNOWLEDGE_LIMITS.relationTypeCodePoints,
          ),
          objectItemId: this.stateUuid(this.required(record, 'objectItemId')),
          epistemicRole: role,
          reviewState: this.stateReviewState(
            this.required(record, 'reviewState'),
          ),
          ...(!hasQualifier
            ? {}
            : {
                qualifier: this.stateMultilineText(
                  this.required(record, 'qualifier'),
                  KNOWLEDGE_LIMITS.qualifierCodePoints,
                ),
              }),
        });
      },
    );
  }

  private stateProvenance(input: unknown): KnowledgeProvenanceInput {
    return this.stateRecord(
      input,
      ['citations', 'fragmentDerivations', 'knowledgeDerivations'],
      [],
      (record) => {
        const citations = this.stateArray(
          this.required(record, 'citations'),
          (value) => this.stateUuid(value),
        );
        const fragmentDerivations = this.stateArray(
          this.required(record, 'fragmentDerivations'),
          (value) => this.stateUuid(value),
        );
        const knowledgeDerivations = this.stateArray(
          this.required(record, 'knowledgeDerivations'),
          (value) => this.stateFormalRevisionRef(value),
        );
        if (
          citations.length +
            fragmentDerivations.length +
            knowledgeDerivations.length >
          KNOWLEDGE_LIMITS.operationProvenanceInputs
        ) {
          throw stateFault();
        }
        return defineRecord({
          citations,
          fragmentDerivations,
          knowledgeDerivations,
        });
      },
    );
  }

  private stateFormalRevisionRef(input: unknown): FormalKnowledgeRevisionRef {
    return this.stateRecord(
      input,
      ['kind', 'revision'],
      ['itemId', 'relationId'],
      (record) => {
        const kind = this.stateString(this.required(record, 'kind'));
        if (kind === 'item') {
          this.requireStateBranch(record, ['kind', 'itemId', 'revision']);
          return defineRecord({
            kind,
            itemId: this.stateUuid(this.required(record, 'itemId')),
            revision: this.statePositiveRevision(
              this.required(record, 'revision'),
            ),
          });
        }
        if (kind === 'relation') {
          this.requireStateBranch(record, ['kind', 'relationId', 'revision']);
          return defineRecord({
            kind,
            relationId: this.stateUuid(this.required(record, 'relationId')),
            revision: this.statePositiveRevision(
              this.required(record, 'revision'),
            ),
          });
        }
        throw stateFault();
      },
    );
  }

  private stateAuthorizationReceipt(
    input: unknown,
  ): KnowledgeAuthorizationReceipt {
    return this.stateRecord(
      input,
      ['kind'],
      ['targetId', 'decisionId', 'decisionRevision', 'decisionRevisionId'],
      (record) => {
        const kind = this.stateString(this.required(record, 'kind'));
        if (kind === 'manual_edit') {
          this.requireStateBranch(record, ['kind']);
          return defineRecord({kind});
        }
        if (kind === 'eligible_target') {
          this.requireStateBranch(record, [
            'kind',
            'targetId',
            'decisionId',
            'decisionRevision',
            'decisionRevisionId',
          ]);
          return defineRecord({
            kind,
            targetId: this.stateUuid(this.required(record, 'targetId')),
            decisionId: this.stateUuid(this.required(record, 'decisionId')),
            decisionRevision: this.statePositiveRevision(
              this.required(record, 'decisionRevision'),
            ),
            decisionRevisionId: this.stateUuid(
              this.required(record, 'decisionRevisionId'),
            ),
          });
        }
        throw stateFault();
      },
    );
  }

  private stateArray<Value>(
    input: unknown,
    decode: (value: unknown, index: number) => Value,
  ): readonly Value[] {
    return this.decodeArray(this.arrayHeader(input, 'state'), decode);
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
    path: KnowledgeIssuePath,
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
    const descriptors = Object.create(null) as Record<
      string,
      PropertyDescriptor
    >;
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

  private arrayHeader(
    input: unknown,
    path: KnowledgeIssuePath,
    maximumLength?: number,
    budget?: KnowledgeBudgetName,
    requireNonempty = false,
  ): ArrayHeader {
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
    return {input, length, path};
  }

  private decodeArray<Value>(
    header: ArrayHeader,
    decode: (value: unknown, index: number) => Value,
  ): readonly Value[] {
    return this.decodePreparedArray(this.prepareArray(header), decode);
  }

  private prepareArray(header: ArrayHeader): PreparedArray {
    let keys: readonly PropertyKey[];
    try {
      keys = Reflect.ownKeys(header.input);
    } catch {
      throw fault('invalid_shape', header.path);
    }
    const descriptors = new Map<number, PropertyDescriptor>();
    for (const key of keys) {
      if (key === 'length') {
        continue;
      }
      if (typeof key !== 'string' || !isArrayIndex(key, header.length)) {
        throw fault('invalid_shape', header.path);
      }
      const descriptor = Object.getOwnPropertyDescriptor(header.input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        throw fault('invalid_shape', header.path);
      }
      descriptors.set(Number(key), descriptor);
    }
    if (descriptors.size !== header.length) {
      throw fault('invalid_shape', header.path);
    }
    for (let index = 0; index < header.length; index += 1) {
      if (hasInheritedAccessor(Array.prototype, String(index))) {
        throw fault('invalid_shape', header.path);
      }
    }
    return {...header, descriptors};
  }

  private decodePreparedArray<Value>(
    prepared: PreparedArray,
    decode: (value: unknown, index: number) => Value,
  ): readonly Value[] {
    this.ancestors.add(prepared.input);
    try {
      const output = new Array<Value>(prepared.length);
      for (let index = 0; index < prepared.length; index += 1) {
        const descriptor = prepared.descriptors.get(index);
        if (descriptor === undefined) {
          throw fault('invalid_shape', prepared.path);
        }
        Object.defineProperty(output, String(index), {
          value: decode(descriptor.value as unknown, index),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return output;
    } finally {
      this.ancestors.delete(prepared.input);
    }
  }

  private requireExactBranch(
    record: DescriptorRecord,
    required: readonly string[],
    path: KnowledgeIssuePath,
  ): void {
    const allowed = new Set(required);
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
  ): void {
    const allowed = new Set(required);
    if (
      Object.keys(record).some((key) => !allowed.has(key)) ||
      required.some((key) => !Object.hasOwn(record, key))
    ) {
      throw stateFault();
    }
  }

  private required(record: DescriptorRecord, key: string): unknown {
    const descriptor = record[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
      throw stateFault();
    }
    return descriptor.value as unknown;
  }

  private has(record: DescriptorRecord, key: string): boolean {
    return Object.hasOwn(record, key);
  }

  private string(input: unknown, path: KnowledgeIssuePath): string {
    if (typeof input !== 'string') {
      throw fault('invalid_shape', path);
    }
    return input;
  }

  private uuid(input: unknown, path: KnowledgeIssuePath): string {
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
    if (value.length > KNOWLEDGE_LIMITS.idempotencyKeyCharacters) {
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

  private revision(
    input: unknown,
    path: KnowledgeIssuePath,
    allowZero: boolean,
  ): number {
    if (typeof input !== 'number') {
      throw fault('invalid_shape', path);
    }
    if (
      Object.is(input, -0) ||
      !Number.isFinite(input) ||
      !Number.isSafeInteger(input) ||
      input < 0 ||
      (!allowZero && input === 0)
    ) {
      throw fault('invalid_state', path);
    }
    if (input > KNOWLEDGE_LIMITS.revisionNumber) {
      throw fault('limit_exceeded', path, 'revision_number');
    }
    return input;
  }

  private knowledgeKind(
    input: unknown,
    path: KnowledgeIssuePath,
  ): KnowledgeItemRevisionValue['knowledgeKind'] {
    const value = this.string(input, path);
    if (!KNOWLEDGE_KIND_SET.has(value)) {
      throw fault('invalid_state', path);
    }
    return value as KnowledgeItemRevisionValue['knowledgeKind'];
  }

  private epistemicRole(
    input: unknown,
    path: KnowledgeIssuePath,
  ): EpistemicRole {
    const value = this.string(input, path);
    if (!EPISTEMIC_ROLE_SET.has(value)) {
      throw fault('invalid_state', path);
    }
    return value as EpistemicRole;
  }

  private reviewState(
    input: unknown,
    path: KnowledgeIssuePath,
  ): KnowledgeItemRevisionValue['reviewState'] {
    const value = this.string(input, path);
    if (!REVIEW_STATE_SET.has(value)) {
      throw fault('invalid_state', path);
    }
    return value as KnowledgeItemRevisionValue['reviewState'];
  }

  private singleLineText(
    input: unknown,
    path: KnowledgeIssuePath,
    limit: number,
    budget: KnowledgeBudgetName,
  ): string {
    const value = this.string(input, path);
    if (!isValidSingleLineText(value)) {
      throw fault('invalid_text', path);
    }
    if (Array.from(value).length > limit) {
      throw fault('limit_exceeded', path, budget);
    }
    return value;
  }

  private multilineText(
    input: unknown,
    path: KnowledgeIssuePath,
    limit: number,
    budget: KnowledgeBudgetName,
  ): string {
    const value = this.string(input, path);
    if (!isValidMultilineText(value)) {
      throw fault('invalid_text', path);
    }
    if (Array.from(value).length > limit) {
      throw fault('limit_exceeded', path, budget);
    }
    return value;
  }

  private stateString(input: unknown): string {
    if (typeof input !== 'string') {
      throw stateFault();
    }
    return input;
  }

  private stateUuid(input: unknown): string {
    const value = this.stateString(input);
    if (!UUID_PATTERN.test(value)) {
      throw stateFault();
    }
    return value;
  }

  private stateSha256(input: unknown): string {
    const value = this.stateString(input);
    if (!SHA256_PATTERN.test(value)) {
      throw stateFault();
    }
    return value;
  }

  private statePositiveRevision(input: unknown): number {
    if (
      typeof input !== 'number' ||
      Object.is(input, -0) ||
      !Number.isSafeInteger(input) ||
      input < 1 ||
      input > KNOWLEDGE_LIMITS.revisionNumber
    ) {
      throw stateFault();
    }
    return input;
  }

  private stateBoundedIndex(input: unknown): KnowledgeBoundedIndex {
    if (
      typeof input !== 'number' ||
      !Number.isSafeInteger(input) ||
      input < 0 ||
      input >= KNOWLEDGE_LIMITS.changeSetOperations
    ) {
      throw stateFault();
    }
    return input as KnowledgeBoundedIndex;
  }

  private stateOperationCount(input: unknown): number {
    if (
      typeof input !== 'number' ||
      !Number.isSafeInteger(input) ||
      input < 1 ||
      input > KNOWLEDGE_LIMITS.changeSetOperations
    ) {
      throw stateFault();
    }
    return input;
  }

  private stateCommandKey(input: unknown): string {
    const value = this.stateString(input);
    if (
      !IDEMPOTENCY_KEY_PATTERN.test(value) ||
      value.length > KNOWLEDGE_LIMITS.idempotencyKeyCharacters
    ) {
      throw stateFault();
    }
    return value;
  }

  private stateOutcome(input: unknown): 'applied' | 'unchanged' {
    const value = this.stateString(input);
    if (value !== 'applied' && value !== 'unchanged') {
      throw stateFault();
    }
    return value;
  }

  private stateIntakeAction(input: unknown): IntakeAction {
    const value = this.stateString(input);
    if (!INTAKE_ACTION_SET.has(value)) {
      throw stateFault();
    }
    return value as IntakeAction;
  }

  private stateKnowledgeKind(
    input: unknown,
  ): KnowledgeItemRevisionValue['knowledgeKind'] {
    const value = this.stateString(input);
    if (!KNOWLEDGE_KIND_SET.has(value)) {
      throw stateFault();
    }
    return value as KnowledgeItemRevisionValue['knowledgeKind'];
  }

  private stateEpistemicRole(input: unknown): EpistemicRole {
    const value = this.stateString(input);
    if (!EPISTEMIC_ROLE_SET.has(value)) {
      throw stateFault();
    }
    return value as EpistemicRole;
  }

  private stateReviewState(
    input: unknown,
  ): KnowledgeItemRevisionValue['reviewState'] {
    const value = this.stateString(input);
    if (!REVIEW_STATE_SET.has(value)) {
      throw stateFault();
    }
    return value as KnowledgeItemRevisionValue['reviewState'];
  }

  private stateSingleLineText(input: unknown, limit: number): string {
    const value = this.stateString(input);
    if (!isValidSingleLineText(value) || Array.from(value).length > limit) {
      throw stateFault();
    }
    return value;
  }

  private stateMultilineText(input: unknown, limit: number): string {
    const value = this.stateString(input);
    if (!isValidMultilineText(value) || Array.from(value).length > limit) {
      throw stateFault();
    }
    return value;
  }
}

export function decodeManualKnowledgeContext(
  input: unknown,
): ManualKnowledgeContext {
  return deepFreeze(new ClosedDecoder().context(input));
}

export function decodeApplyManualKnowledgeChangeSetRequest(
  input: unknown,
): ApplyManualKnowledgeChangeSetRequest {
  return deepFreeze(new ClosedDecoder().request(input));
}

export function decodeManualKnowledgeRepositorySnapshot(
  input: unknown,
): ManualKnowledgeRepositorySnapshot {
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

export function defineOwnedRecord<Value extends object>(values: Value): Value {
  return defineRecord(values);
}

function defineRecord<Value extends object>(values: Value): Value {
  const output = Object.create(Object.prototype) as Value;
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
  code: Exclude<KnowledgeIssueCode, 'persistence_failed'>,
  path: KnowledgeIssuePath,
  budget?: KnowledgeBudgetName,
): KnowledgeInputFault {
  return new KnowledgeInputFault(code, path, budget);
}

function stateFault(): KnowledgeInputFault {
  return fault('invalid_shape', 'state');
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

function hasValidUnicodeScalars(value: string): boolean {
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

function isValidSingleLineText(value: string): boolean {
  if (
    value.length === 0 ||
    value.trim().length === 0 ||
    value.trim() !== value ||
    !hasValidUnicodeScalars(value)
  ) {
    return false;
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    ) {
      return false;
    }
  }
  return true;
}

function isValidMultilineText(value: string): boolean {
  if (
    value.length === 0 ||
    value.trim().length === 0 ||
    !hasValidUnicodeScalars(value)
  ) {
    return false;
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      (codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    ) {
      return false;
    }
  }
  return true;
}

function formalRevisionIdentity(reference: FormalKnowledgeRevisionRef): string {
  return reference.kind === 'item'
    ? `item:${reference.itemId}:${String(reference.revision)}`
    : `relation:${reference.relationId}:${String(reference.revision)}`;
}

function operationPath(index: number): KnowledgeIssuePath {
  return `request.operations[${String(index)}]` as KnowledgeIssuePath;
}

function declaredPath(
  path: KnowledgeIssuePath,
  key: string,
): KnowledgeIssuePath {
  return path === 'state' ? path : (`${path}.${key}` as KnowledgeIssuePath);
}
