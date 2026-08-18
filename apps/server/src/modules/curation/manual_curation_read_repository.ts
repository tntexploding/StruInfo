import type {
  AssessmentState,
  ClassificationAssignmentState,
  CurationTargetState,
  IntakeDecisionState,
  VocabularyTermState,
} from './manual_curation_contract.js';

export interface ManualCurationReadState {
  readonly terms: readonly Readonly<VocabularyTermState>[];
  readonly targets: readonly Readonly<CurationTargetState>[];
  readonly assignments: readonly Readonly<ClassificationAssignmentState>[];
  readonly decisions: readonly Readonly<IntakeDecisionState>[];
  readonly assessments: readonly Readonly<AssessmentState>[];
}

/** Current-only read model used by the local review workspace. */
export interface ManualCurationReadRepositoryPort {
  loadCurrentCurationState(
    workspaceId: string,
  ): Promise<Readonly<ManualCurationReadState>>;
}
