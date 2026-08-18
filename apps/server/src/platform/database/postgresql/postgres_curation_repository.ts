import {
  ASSESSMENT_DIMENSIONS,
  INTAKE_ACTIONS,
  INTAKE_FEEDBACK_REASONS,
  type AssessmentIdentityInsert,
  type AssessmentRevisionInsert,
  type ClassificationAssignmentIdentityInsert,
  type ClassificationAssignmentRevisionInsert,
  type CurationCommandInsert,
  type CurationTargetInsert,
  type CurrentPointerCas,
  type IntakeDecisionIdentityInsert,
  type IntakeDecisionReasonInsert,
  type IntakeDecisionRevisionInsert,
  type LockedTargetCommandSnapshotQuery,
  type LockedTermCommandSnapshotQuery,
  type ManualCurationRepositoryPort,
  type ManualCurationRepositorySnapshot,
  type ManualCurationTransactionPort,
  type TargetVersionCas,
  type VocabularyTermIdentityInsert,
  type VocabularyTermRevisionInsert,
} from '../../../modules/curation/index.js';

import type {
  PostgresClientBoundary,
  PostgresPoolBoundary,
} from './postgres_pool.js';
import {runPostgresTransaction} from './postgres_transaction.js';
import {
  canonicalUuid,
  enumValue,
  expectOneAffected,
  integer,
  optionalText,
  PostgresAdapterError,
  sha256,
  text,
} from './postgres_values.js';
import {acquireWorkspaceWriteLock} from './workspace_write_lock.js';

export const READ_CURATION_COMMAND_SQL = `SELECT
  workspace_id::text, command_idempotency_key, request_sha256,
  command_kind, term_id::text, target_id::text, outcome, resulting_version
FROM struinfo.curation_command
WHERE workspace_id = $1 AND command_idempotency_key = $2` as const;

const LOCK_TERMS_SQL = `SELECT term_id::text
FROM struinfo.vocabulary_term
WHERE workspace_id = $1 AND term_id = ANY($2::uuid[])
ORDER BY term_id
FOR UPDATE`;
const LOCK_ALL_TERMS_SQL = `SELECT term_id::text
FROM struinfo.vocabulary_term
WHERE workspace_id = $1
ORDER BY term_id
FOR UPDATE`;
const LOCK_TARGET_SQL = `SELECT target_id::text
FROM struinfo.curation_target
WHERE workspace_id = $1 AND target_id = $2
FOR UPDATE`;

const READ_TERMS_SQL = `SELECT
  t.workspace_id::text, t.term_id::text, t.current_revision,
  t.current_term_revision_id::text AS current_revision_id,
  r.display_name, r.description, r.parent_term_id::text, r.lifecycle
FROM struinfo.vocabulary_term AS t
JOIN struinfo.vocabulary_term_revision AS r
  ON r.workspace_id = t.workspace_id
 AND r.term_id = t.term_id
 AND r.revision_number = t.current_revision
 AND r.term_revision_id = t.current_term_revision_id
WHERE t.workspace_id = $1
ORDER BY t.term_id`;
const READ_TARGETS_SQL = `SELECT
  workspace_id::text, target_id::text, target_kind,
  resource_id::text, snapshot_id::text, fragment_id::text, current_version
FROM struinfo.curation_target
WHERE workspace_id = $1 AND target_id = ANY($2::uuid[])
ORDER BY target_id`;
const READ_ASSIGNMENTS_SQL = `SELECT
  a.workspace_id::text, a.assignment_id::text, a.target_id::text,
  a.term_id::text, a.current_revision,
  a.current_assignment_revision_id::text AS current_revision_id,
  r.assignment_state, r.term_revision_number, r.term_revision_id::text
FROM struinfo.classification_assignment AS a
JOIN struinfo.classification_assignment_revision AS r
  ON r.workspace_id = a.workspace_id
 AND r.assignment_id = a.assignment_id
 AND r.revision_number = a.current_revision
 AND r.assignment_revision_id = a.current_assignment_revision_id
WHERE a.workspace_id = $1 AND a.target_id = ANY($2::uuid[])
ORDER BY a.assignment_id`;
const READ_DECISIONS_SQL = `SELECT
  d.workspace_id::text, d.decision_id::text, d.target_id::text,
  d.current_revision, d.current_decision_revision_id::text AS current_revision_id,
  r.intake_action, r.note
FROM struinfo.intake_decision AS d
JOIN struinfo.intake_decision_revision AS r
  ON r.workspace_id = d.workspace_id
 AND r.decision_id = d.decision_id
 AND r.revision_number = d.current_revision
 AND r.decision_revision_id = d.current_decision_revision_id
WHERE d.workspace_id = $1 AND d.target_id = ANY($2::uuid[])
ORDER BY d.decision_id`;
const READ_DECISION_REASONS_SQL = `SELECT
  r.workspace_id::text, r.decision_id::text, r.decision_revision_id::text,
  r.reason_ordinal, r.reason_code
FROM struinfo.intake_decision_reason AS r
JOIN struinfo.intake_decision AS d
  ON d.workspace_id = r.workspace_id AND d.decision_id = r.decision_id
WHERE r.workspace_id = $1 AND d.target_id = ANY($2::uuid[])
ORDER BY r.decision_id, r.decision_revision_id, r.reason_ordinal`;
const READ_ASSESSMENTS_SQL = `SELECT
  a.workspace_id::text, a.assessment_id::text, a.target_id::text,
  a.dimension, a.current_revision,
  a.current_assessment_revision_id::text AS current_revision_id,
  r.assessment_state, r.score, r.note
FROM struinfo.assessment AS a
JOIN struinfo.assessment_revision AS r
  ON r.workspace_id = a.workspace_id
 AND r.assessment_id = a.assessment_id
 AND r.revision_number = a.current_revision
 AND r.assessment_revision_id = a.current_assessment_revision_id
WHERE a.workspace_id = $1 AND a.target_id = ANY($2::uuid[])
ORDER BY a.assessment_id`;
const READ_SNAPSHOT_EVIDENCE_SQL = `SELECT
  workspace_id::text, resource_id::text, snapshot_id::text
FROM struinfo.snapshot
WHERE workspace_id = $1 AND snapshot_id = $2`;
const READ_FRAGMENT_EVIDENCE_SQL = `SELECT
  workspace_id::text, fragment_id::text
FROM struinfo.fragment
WHERE workspace_id = $1 AND fragment_id = $2`;

type Row = Readonly<Record<string, unknown>>;

export class PostgresManualCurationRepository implements ManualCurationRepositoryPort {
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public runCommandTransaction<Value>(
    work: (transaction: ManualCurationTransactionPort) => Promise<Value>,
  ): Promise<Value> {
    return runPostgresTransaction(this.#pool, 'read_committed', (client) =>
      work(new PostgresManualCurationTransaction(client)),
    );
  }
}

class PostgresManualCurationTransaction implements ManualCurationTransactionPort {
  readonly #client: PostgresClientBoundary;

  public constructor(client: PostgresClientBoundary) {
    this.#client = client;
  }

  public async lockAndLoadTermCommandSnapshot(
    query: LockedTermCommandSnapshotQuery,
  ): Promise<ManualCurationRepositorySnapshot> {
    const commands = await this.#beginWorkspaceCommand(
      query.workspaceId,
      query.commandIdempotencyKey,
    );
    await this.#client.query(LOCK_ALL_TERMS_SQL, [query.workspaceId]);
    return this.#loadSnapshot(
      query.workspaceId,
      commands,
      commandTargetIds(commands),
    );
  }

  public async lockAndLoadTargetCommandSnapshot(
    query: LockedTargetCommandSnapshotQuery,
  ): Promise<ManualCurationRepositorySnapshot> {
    const commands = await this.#beginWorkspaceCommand(
      query.workspaceId,
      query.commandIdempotencyKey,
    );
    if (query.referencedTermIds.length > 0) {
      await this.#client.query(LOCK_TERMS_SQL, [
        query.workspaceId,
        [...query.referencedTermIds].sort(),
      ]);
    }
    const target = await this.#resolveTarget(query);
    if (target !== undefined) {
      await this.#client.query(LOCK_TARGET_SQL, [query.workspaceId, target]);
    }
    const targetIds = uniqueSorted([
      ...commandTargetIds(commands),
      ...(target === undefined ? [] : [target]),
    ]);
    const snapshot = await this.#loadSnapshot(
      query.workspaceId,
      commands,
      targetIds,
    );
    if (
      snapshot.evidenceTargets.some((candidate) =>
        targetRefMatches(candidate, query.target),
      )
    ) {
      return snapshot;
    }
    const evidence = await this.#loadRequestedEvidence(query);
    return Object.freeze({
      ...snapshot,
      evidenceTargets: Object.freeze([
        ...snapshot.evidenceTargets,
        ...evidence,
      ]),
    });
  }

  async #beginWorkspaceCommand(
    workspaceId: string,
    key: string,
  ): Promise<readonly Row[]> {
    await acquireWorkspaceWriteLock(this.#client, workspaceId);
    const result = await this.#client.query<Row>(READ_CURATION_COMMAND_SQL, [
      workspaceId,
      key,
    ]);
    if (result.rows.length > 1) throw new PostgresAdapterError();
    return result.rows;
  }

  async #resolveTarget(
    query: LockedTargetCommandSnapshotQuery,
  ): Promise<string | undefined> {
    const sql =
      query.target.kind === 'snapshot'
        ? `SELECT target_id::text FROM struinfo.curation_target
WHERE workspace_id = $1 AND snapshot_id = $2`
        : `SELECT target_id::text FROM struinfo.curation_target
WHERE workspace_id = $1 AND fragment_id = $2`;
    const value =
      query.target.kind === 'snapshot'
        ? query.target.snapshotId
        : query.target.fragmentId;
    const result = await this.#client.query<Row>(sql, [
      query.workspaceId,
      value,
    ]);
    if (result.rows.length > 1) throw new PostgresAdapterError();
    return result.rows[0] === undefined
      ? undefined
      : canonicalUuid(result.rows[0].target_id);
  }

  async #loadRequestedEvidence(query: LockedTargetCommandSnapshotQuery) {
    const result = await this.#client.query<Row>(
      query.target.kind === 'snapshot'
        ? READ_SNAPSHOT_EVIDENCE_SQL
        : READ_FRAGMENT_EVIDENCE_SQL,
      [
        query.workspaceId,
        query.target.kind === 'snapshot'
          ? query.target.snapshotId
          : query.target.fragmentId,
      ],
    );
    return Object.freeze(
      result.rows.map((row) => {
        const workspaceId = canonicalUuid(row.workspace_id);
        if (workspaceId !== query.workspaceId) {
          throw new PostgresAdapterError();
        }
        return query.target.kind === 'snapshot'
          ? Object.freeze({
              workspaceId,
              kind: 'snapshot' as const,
              resourceId: canonicalUuid(row.resource_id),
              snapshotId: canonicalUuid(row.snapshot_id),
            })
          : Object.freeze({
              workspaceId,
              kind: 'fragment' as const,
              fragmentId: canonicalUuid(row.fragment_id),
            });
      }),
    );
  }

  async #loadSnapshot(
    workspaceId: string,
    commandRows: readonly Row[],
    targetIds: readonly string[],
  ): Promise<ManualCurationRepositorySnapshot> {
    const terms = await this.#client.query<Row>(READ_TERMS_SQL, [workspaceId]);
    const targets = await this.#client.query<Row>(READ_TARGETS_SQL, [
      workspaceId,
      targetIds,
    ]);
    const assignments = await this.#client.query<Row>(READ_ASSIGNMENTS_SQL, [
      workspaceId,
      targetIds,
    ]);
    const decisions = await this.#client.query<Row>(READ_DECISIONS_SQL, [
      workspaceId,
      targetIds,
    ]);
    const reasons = await this.#client.query<Row>(READ_DECISION_REASONS_SQL, [
      workspaceId,
      targetIds,
    ]);
    const assessments = await this.#client.query<Row>(READ_ASSESSMENTS_SQL, [
      workspaceId,
      targetIds,
    ]);
    const mappedTerms = terms.rows.map(mapTerm);
    const mappedTargets = targets.rows.map(mapTarget);
    const mappedAssignments = assignments.rows.map(mapAssignment);
    const mappedDecisions = decisions.rows.map((row) =>
      mapDecision(row, reasons.rows),
    );
    const mappedAssessments = assessments.rows.map(mapAssessment);
    const mappedCommands = commandRows.map(mapCommand);
    const workspaceRows: readonly (readonly {
      readonly workspaceId: string;
    }[])[] = [
      mappedTerms,
      mappedTargets,
      mappedAssignments,
      mappedDecisions,
      mappedAssessments,
      mappedCommands,
    ];
    if (
      workspaceRows.some((rows) =>
        rows.some((row) => row.workspaceId !== workspaceId),
      )
    ) {
      throw new PostgresAdapterError();
    }
    const evidenceTargets = mappedTargets.map((target) =>
      target.kind === 'snapshot'
        ? Object.freeze({
            workspaceId: target.workspaceId,
            kind: target.kind,
            resourceId: target.resourceId,
            snapshotId: target.snapshotId,
          })
        : Object.freeze({
            workspaceId: target.workspaceId,
            kind: target.kind,
            fragmentId: target.fragmentId,
          }),
    );
    return Object.freeze({
      evidenceTargets: Object.freeze(evidenceTargets),
      targets: Object.freeze(mappedTargets),
      terms: Object.freeze(mappedTerms),
      assignments: Object.freeze(mappedAssignments),
      decisions: Object.freeze(mappedDecisions),
      assessments: Object.freeze(mappedAssessments),
      commands: Object.freeze(mappedCommands),
    });
  }

  public insertCurationTarget(row: CurationTargetInsert): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.curation_target
(workspace_id, target_id, target_kind, resource_id, snapshot_id, fragment_id, current_version)
VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.workspaceId,
        row.targetId,
        row.kind,
        row.kind === 'snapshot' ? row.resourceId : null,
        row.kind === 'snapshot' ? row.snapshotId : null,
        row.kind === 'fragment' ? row.fragmentId : null,
        row.currentVersion,
      ],
    );
  }

  public async compareAndSetTargetVersion(
    change: TargetVersionCas,
  ): Promise<void> {
    const result = await this.#client.executeSimple(
      `UPDATE struinfo.curation_target
SET current_version = $4
WHERE workspace_id = $1 AND target_id = $2 AND current_version = $3`,
      [
        change.workspaceId,
        change.targetId,
        change.expectedVersion,
        change.nextVersion,
      ],
    );
    expectOneAffected(result.rowCount);
  }

  public insertVocabularyTerm(
    row: VocabularyTermIdentityInsert,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.vocabulary_term
(workspace_id, term_id, current_revision, current_term_revision_id)
VALUES ($1, $2, $3, $4)`,
      [row.workspaceId, row.termId, row.currentRevision, row.currentRevisionId],
    );
  }

  public insertVocabularyTermRevision(
    row: VocabularyTermRevisionInsert,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.vocabulary_term_revision
(workspace_id, term_id, term_revision_id, revision_number, display_name, description, parent_term_id, lifecycle)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        row.workspaceId,
        row.termId,
        row.termRevisionId,
        row.revisionNumber,
        row.value.displayName,
        row.value.description ?? null,
        row.value.parentTermId ?? null,
        row.value.lifecycle,
      ],
    );
  }

  public compareAndSetVocabularyTermCurrent(
    change: CurrentPointerCas,
  ): Promise<void> {
    return this.#cas(
      'vocabulary_term',
      'term_id',
      'current_term_revision_id',
      change,
    );
  }

  public insertClassificationAssignment(
    row: ClassificationAssignmentIdentityInsert,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.classification_assignment
(workspace_id, assignment_id, target_id, term_id, current_revision, current_assignment_revision_id)
VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        row.workspaceId,
        row.assignmentId,
        row.targetId,
        row.termId,
        row.currentRevision,
        row.currentRevisionId,
      ],
    );
  }

  public insertClassificationAssignmentRevision(
    row: ClassificationAssignmentRevisionInsert,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.classification_assignment_revision
(workspace_id, assignment_id, assignment_revision_id, revision_number, assignment_state, term_id, term_revision_number, term_revision_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        row.workspaceId,
        row.assignmentId,
        row.assignmentRevisionId,
        row.revisionNumber,
        row.state,
        row.termId,
        row.termRevisionNumber,
        row.termRevisionId,
      ],
    );
  }

  public compareAndSetClassificationAssignmentCurrent(
    change: CurrentPointerCas,
  ): Promise<void> {
    return this.#cas(
      'classification_assignment',
      'assignment_id',
      'current_assignment_revision_id',
      change,
    );
  }

  public insertIntakeDecision(
    row: IntakeDecisionIdentityInsert,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.intake_decision
(workspace_id, decision_id, target_id, current_revision, current_decision_revision_id)
VALUES ($1, $2, $3, $4, $5)`,
      [
        row.workspaceId,
        row.decisionId,
        row.targetId,
        row.currentRevision,
        row.currentRevisionId,
      ],
    );
  }

  public insertIntakeDecisionRevision(
    row: IntakeDecisionRevisionInsert,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.intake_decision_revision
(workspace_id, decision_id, decision_revision_id, revision_number, intake_action, note)
VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        row.workspaceId,
        row.decisionId,
        row.decisionRevisionId,
        row.revisionNumber,
        row.value.action,
        row.value.note ?? null,
      ],
    );
  }

  public insertIntakeDecisionReason(
    row: IntakeDecisionReasonInsert,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.intake_decision_reason
(workspace_id, decision_id, decision_revision_id, reason_ordinal, reason_code)
VALUES ($1, $2, $3, $4, $5)`,
      [
        row.workspaceId,
        row.decisionId,
        row.decisionRevisionId,
        row.reasonOrdinal,
        row.reasonCode,
      ],
    );
  }

  public compareAndSetIntakeDecisionCurrent(
    change: CurrentPointerCas,
  ): Promise<void> {
    return this.#cas(
      'intake_decision',
      'decision_id',
      'current_decision_revision_id',
      change,
    );
  }

  public insertAssessment(row: AssessmentIdentityInsert): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.assessment
(workspace_id, assessment_id, target_id, dimension, current_revision, current_assessment_revision_id)
VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        row.workspaceId,
        row.assessmentId,
        row.targetId,
        row.dimension,
        row.currentRevision,
        row.currentRevisionId,
      ],
    );
  }

  public insertAssessmentRevision(
    row: AssessmentRevisionInsert,
  ): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.assessment_revision
(workspace_id, assessment_id, assessment_revision_id, revision_number, assessment_state, score, note)
VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.workspaceId,
        row.assessmentId,
        row.assessmentRevisionId,
        row.revisionNumber,
        row.value.state,
        row.value.state === 'rated' ? row.value.score : null,
        row.value.state === 'rated' ? (row.value.note ?? null) : null,
      ],
    );
  }

  public compareAndSetAssessmentCurrent(
    change: CurrentPointerCas,
  ): Promise<void> {
    return this.#cas(
      'assessment',
      'assessment_id',
      'current_assessment_revision_id',
      change,
    );
  }

  public insertCurationCommand(row: CurationCommandInsert): Promise<void> {
    return this.#insert(
      `INSERT INTO struinfo.curation_command
(workspace_id, command_idempotency_key, request_sha256, command_kind, authority, target_id, term_id, outcome, resulting_version)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        row.workspaceId,
        row.commandIdempotencyKey,
        row.requestSha256,
        row.commandKind,
        row.authority,
        row.targetId ?? null,
        row.termId ?? null,
        row.outcome,
        row.resultingVersion,
      ],
    );
  }

  async #insert(sql: string, parameters: readonly unknown[]): Promise<void> {
    const result = await this.#client.executeSimple(sql, parameters);
    expectOneAffected(result.rowCount);
  }

  async #cas(
    table:
      | 'vocabulary_term'
      | 'classification_assignment'
      | 'intake_decision'
      | 'assessment',
    idColumn: string,
    revisionIdColumn: string,
    change: CurrentPointerCas,
  ): Promise<void> {
    const allowed = {
      vocabulary_term: ['term_id', 'current_term_revision_id'],
      classification_assignment: [
        'assignment_id',
        'current_assignment_revision_id',
      ],
      intake_decision: ['decision_id', 'current_decision_revision_id'],
      assessment: ['assessment_id', 'current_assessment_revision_id'],
    } as const;
    const selection = allowed[table];
    if (selection[0] !== idColumn || selection[1] !== revisionIdColumn)
      throw new PostgresAdapterError();
    const result = await this.#client.executeSimple(
      `UPDATE struinfo.${table}
SET current_revision = $4, ${revisionIdColumn} = $5
WHERE workspace_id = $1 AND ${idColumn} = $2 AND current_revision = $3`,
      [
        change.workspaceId,
        change.stableId,
        change.expectedRevision,
        change.nextRevision,
        change.nextRevisionId,
      ],
    );
    expectOneAffected(result.rowCount);
  }
}

function mapTarget(row: Row): CurationTargetInsert {
  const common = {
    workspaceId: canonicalUuid(row.workspace_id),
    targetId: canonicalUuid(row.target_id),
    currentVersion: integer(row.current_version, 1),
  };
  const kind = enumValue(row.target_kind, ['snapshot', 'fragment'] as const);
  return kind === 'snapshot'
    ? Object.freeze({
        ...common,
        kind,
        resourceId: canonicalUuid(row.resource_id),
        snapshotId: canonicalUuid(row.snapshot_id),
      })
    : Object.freeze({
        ...common,
        kind,
        fragmentId: canonicalUuid(row.fragment_id),
      });
}

function mapTerm(row: Row) {
  const description = optionalText(row.description);
  const parentTermId =
    row.parent_term_id === null ? undefined : canonicalUuid(row.parent_term_id);
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    termId: canonicalUuid(row.term_id),
    currentRevision: integer(row.current_revision, 1),
    currentRevisionId: canonicalUuid(row.current_revision_id),
    value: Object.freeze({
      displayName: text(row.display_name),
      ...(description === undefined ? {} : {description}),
      ...(parentTermId === undefined ? {} : {parentTermId}),
      lifecycle: enumValue(row.lifecycle, ['active', 'retired'] as const),
    }),
  });
}

function mapAssignment(row: Row) {
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    assignmentId: canonicalUuid(row.assignment_id),
    targetId: canonicalUuid(row.target_id),
    termId: canonicalUuid(row.term_id),
    currentRevision: integer(row.current_revision, 1),
    currentRevisionId: canonicalUuid(row.current_revision_id),
    state: enumValue(row.assignment_state, ['assigned', 'removed'] as const),
    termRevisionNumber: integer(row.term_revision_number, 1),
    termRevisionId: canonicalUuid(row.term_revision_id),
  });
}

function mapDecision(row: Row, reasonRows: readonly Row[]) {
  const workspaceId = canonicalUuid(row.workspace_id);
  const decisionId = canonicalUuid(row.decision_id);
  const revisionId = canonicalUuid(row.current_revision_id);
  const note = optionalText(row.note);
  const selectedReasons = reasonRows.filter(
    (reason) =>
      reason.decision_id === decisionId &&
      reason.decision_revision_id === revisionId,
  );
  const reasonCodes = selectedReasons.map((reason, index) => {
    if (
      canonicalUuid(reason.workspace_id) !== workspaceId ||
      canonicalUuid(reason.decision_id) !== decisionId ||
      canonicalUuid(reason.decision_revision_id) !== revisionId ||
      integer(reason.reason_ordinal, 0) !== index
    ) {
      throw new PostgresAdapterError();
    }
    return enumValue(reason.reason_code, INTAKE_FEEDBACK_REASONS);
  });
  return Object.freeze({
    workspaceId,
    decisionId,
    targetId: canonicalUuid(row.target_id),
    currentRevision: integer(row.current_revision, 1),
    currentRevisionId: revisionId,
    value: Object.freeze({
      action: enumValue(row.intake_action, INTAKE_ACTIONS),
      reasonCodes: Object.freeze(reasonCodes),
      ...(note === undefined ? {} : {note}),
    }),
  });
}

function mapAssessment(row: Row) {
  const state = enumValue(row.assessment_state, ['rated', 'cleared'] as const);
  const note = optionalText(row.note);
  const score = state === 'rated' ? integer(row.score, 0) : undefined;
  if (score !== undefined && score > 4) throw new PostgresAdapterError();
  const value =
    state === 'cleared'
      ? Object.freeze({state})
      : Object.freeze({
          state,
          score: score as 0 | 1 | 2 | 3 | 4,
          ...(note === undefined ? {} : {note}),
        });
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    assessmentId: canonicalUuid(row.assessment_id),
    targetId: canonicalUuid(row.target_id),
    dimension: enumValue(row.dimension, ASSESSMENT_DIMENSIONS),
    currentRevision: integer(row.current_revision, 1),
    currentRevisionId: canonicalUuid(row.current_revision_id),
    value,
  });
}

function mapCommand(row: Row) {
  const workspaceId = canonicalUuid(row.workspace_id);
  const commandIdempotencyKey = text(row.command_idempotency_key);
  const requestSha256 = sha256(row.request_sha256);
  const originalOutcome = enumValue(row.outcome, [
    'applied',
    'unchanged',
  ] as const);
  const resulting = integer(row.resulting_version, 0);
  const kind = enumValue(row.command_kind, [
    'put_content_classification_term',
    'apply_manual_curation',
  ] as const);
  const receipt =
    kind === 'put_content_classification_term'
      ? Object.freeze({
          workspaceId,
          commandIdempotencyKey,
          commandKind: kind,
          termId: canonicalUuid(row.term_id),
          resultingRevision: resulting,
          originalOutcome,
        })
      : Object.freeze({
          workspaceId,
          commandIdempotencyKey,
          commandKind: kind,
          targetId: canonicalUuid(row.target_id),
          resultingVersion: resulting,
          originalOutcome,
        });
  return Object.freeze({
    workspaceId,
    commandIdempotencyKey,
    requestSha256,
    receipt,
  });
}

function targetRefMatches(
  candidate: {
    readonly kind: string;
    readonly snapshotId?: string;
    readonly fragmentId?: string;
  },
  target: LockedTargetCommandSnapshotQuery['target'],
): boolean {
  return target.kind === 'snapshot'
    ? candidate.kind === 'snapshot' &&
        candidate.snapshotId === target.snapshotId
    : candidate.kind === 'fragment' &&
        candidate.fragmentId === target.fragmentId;
}

function commandTargetIds(rows: readonly Row[]): readonly string[] {
  return uniqueSorted(
    rows.flatMap((row) =>
      row.target_id === null ? [] : [canonicalUuid(row.target_id)],
    ),
  );
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
