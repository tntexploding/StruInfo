import {
  ASSESSMENT_DIMENSIONS,
  INTAKE_ACTIONS,
  INTAKE_FEEDBACK_REASONS,
  type AssessmentState,
  type ClassificationAssignmentState,
  type CurationTargetState,
  type IntakeDecisionState,
  type VocabularyTermState,
} from '../../../modules/curation/index.js';
import type {
  ManualCurationReadRepositoryPort,
  ManualCurationReadState,
} from '../../../modules/curation/manual_curation_read_repository.js';

import type {PostgresPoolBoundary} from './postgres_pool.js';
import {runPostgresTransaction} from './postgres_transaction.js';
import {
  canonicalUuid,
  enumValue,
  integer,
  optionalText,
  PostgresAdapterError,
  text,
} from './postgres_values.js';

export const READ_CURRENT_CURATION_TERMS_SQL = `SELECT
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
ORDER BY t.term_id` as const;

export const READ_CURRENT_CURATION_TARGETS_SQL = `SELECT
  workspace_id::text, target_id::text, target_kind,
  resource_id::text, snapshot_id::text, fragment_id::text, current_version
FROM struinfo.curation_target
WHERE workspace_id = $1
ORDER BY target_id` as const;

export const READ_CURRENT_CURATION_ASSIGNMENTS_SQL = `SELECT
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
WHERE a.workspace_id = $1
ORDER BY a.assignment_id` as const;

export const READ_CURRENT_CURATION_DECISIONS_SQL = `SELECT
  d.workspace_id::text, d.decision_id::text, d.target_id::text,
  d.current_revision, d.current_decision_revision_id::text AS current_revision_id,
  r.intake_action, r.note
FROM struinfo.intake_decision AS d
JOIN struinfo.intake_decision_revision AS r
  ON r.workspace_id = d.workspace_id
 AND r.decision_id = d.decision_id
 AND r.revision_number = d.current_revision
 AND r.decision_revision_id = d.current_decision_revision_id
WHERE d.workspace_id = $1
ORDER BY d.decision_id` as const;

export const READ_CURRENT_CURATION_REASONS_SQL = `SELECT
  r.workspace_id::text, r.decision_id::text, r.decision_revision_id::text,
  r.reason_ordinal, r.reason_code
FROM struinfo.intake_decision_reason AS r
JOIN struinfo.intake_decision AS d
  ON d.workspace_id = r.workspace_id
 AND d.decision_id = r.decision_id
 AND d.current_decision_revision_id = r.decision_revision_id
WHERE r.workspace_id = $1
ORDER BY r.decision_id, r.reason_ordinal` as const;

export const READ_CURRENT_CURATION_ASSESSMENTS_SQL = `SELECT
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
WHERE a.workspace_id = $1
ORDER BY a.assessment_id` as const;

type Row = Readonly<Record<string, unknown>>;

export class PostgresManualCurationReadRepository implements ManualCurationReadRepositoryPort {
  readonly #pool: PostgresPoolBoundary;

  public constructor(pool: PostgresPoolBoundary) {
    this.#pool = pool;
  }

  public loadCurrentCurationState(
    workspaceIdInput: string,
  ): Promise<Readonly<ManualCurationReadState>> {
    const workspaceId = canonicalUuid(workspaceIdInput);
    return runPostgresTransaction(
      this.#pool,
      'repeatable_read_only',
      async (client) => {
        const terms = await client.query<Row>(READ_CURRENT_CURATION_TERMS_SQL, [
          workspaceId,
        ]);
        const targets = await client.query<Row>(
          READ_CURRENT_CURATION_TARGETS_SQL,
          [workspaceId],
        );
        const assignments = await client.query<Row>(
          READ_CURRENT_CURATION_ASSIGNMENTS_SQL,
          [workspaceId],
        );
        const decisions = await client.query<Row>(
          READ_CURRENT_CURATION_DECISIONS_SQL,
          [workspaceId],
        );
        const reasons = await client.query<Row>(
          READ_CURRENT_CURATION_REASONS_SQL,
          [workspaceId],
        );
        const assessments = await client.query<Row>(
          READ_CURRENT_CURATION_ASSESSMENTS_SQL,
          [workspaceId],
        );
        const value = Object.freeze({
          terms: Object.freeze(terms.rows.map(mapTerm)),
          targets: Object.freeze(targets.rows.map(mapTarget)),
          assignments: Object.freeze(assignments.rows.map(mapAssignment)),
          decisions: Object.freeze(
            decisions.rows.map((row) => mapDecision(row, reasons.rows)),
          ),
          assessments: Object.freeze(assessments.rows.map(mapAssessment)),
        });
        if (
          Object.values(value).some((rows) =>
            rows.some((row) => row.workspaceId !== workspaceId),
          )
        ) {
          throw new PostgresAdapterError();
        }
        return value;
      },
    );
  }
}

function mapTarget(row: Row): CurationTargetState {
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

function mapTerm(row: Row): VocabularyTermState {
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

function mapAssignment(row: Row): ClassificationAssignmentState {
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

function mapDecision(
  row: Row,
  reasonRows: readonly Row[],
): IntakeDecisionState {
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

function mapAssessment(row: Row): AssessmentState {
  const state = enumValue(row.assessment_state, ['rated', 'cleared'] as const);
  const note = optionalText(row.note);
  const score = state === 'rated' ? integer(row.score, 0) : undefined;
  if (score !== undefined && score > 4) throw new PostgresAdapterError();
  return Object.freeze({
    workspaceId: canonicalUuid(row.workspace_id),
    assessmentId: canonicalUuid(row.assessment_id),
    targetId: canonicalUuid(row.target_id),
    dimension: enumValue(row.dimension, ASSESSMENT_DIMENSIONS),
    currentRevision: integer(row.current_revision, 1),
    currentRevisionId: canonicalUuid(row.current_revision_id),
    value:
      state === 'cleared'
        ? Object.freeze({state})
        : Object.freeze({
            state,
            score: score as 0 | 1 | 2 | 3 | 4,
            ...(note === undefined ? {} : {note}),
          }),
  });
}
