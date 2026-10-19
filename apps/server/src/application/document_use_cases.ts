import {
  orderedSectionFragments,
  providerSections,
} from '../modules/processing/ai_split_proposal_service.js';
import {
  prepareManualSplitInformationEntries,
  prepareSplitInformationEntries,
  type InformationDocumentTagRepositoryPort,
  type InformationDocumentWorkingCopyRepositoryPort,
  type InformationEntryDocumentView,
  type InformationEntryEmptySnapshotRepositoryPort,
  type ManualEntryFragmentGroupInput,
} from '../modules/entries/index.js';
import {
  materializeEvidenceSnapshot,
  type EvidenceReadRepositoryPort,
} from '../modules/evidence/index.js';
import type {DocumentIntakeRepository} from './document_intake_contract.js';
import {
  intakeSnapshotIds,
  intakeTargetSnapshot,
} from './document_intake_contract.js';
import type {BlobStore} from '../storage/blob_store.js';

import type {ExecutionAuthority} from './execution_authority.js';
import {OperationError, assertOperationId} from './operation_error.js';
export type DocumentSplitRequest = Readonly<{
  snapshotId: string;
  includePrivate: boolean;
}> &
  (
    | Readonly<{mode: 'deterministic'}>
    | Readonly<{
        mode: 'manual';
        groups: readonly Readonly<ManualEntryFragmentGroupInput>[];
      }>
  );
export interface DocumentUseCasesDependencies {
  readonly stageDocument?: (snapshotId: string) => Promise<void>;
  readonly documentIntakeRepository?: DocumentIntakeRepository;
  readonly blobStore: BlobStore;
  readonly evidenceReadRepository: EvidenceReadRepositoryPort;
  readonly informationEntryRepository: InformationEntryEmptySnapshotRepositoryPort;
  readonly informationDocumentTagRepository: InformationDocumentTagRepositoryPort;
  readonly informationDocumentWorkingCopyRepository: InformationDocumentWorkingCopyRepositoryPort;
}

export class DocumentUseCases {
  readonly #dependencies: Readonly<DocumentUseCasesDependencies>;
  readonly #authority: ExecutionAuthority;
  public constructor(
    authority: ExecutionAuthority,
    dependencies: Readonly<DocumentUseCasesDependencies>,
  ) {
    this.#authority = authority;
    this.#dependencies = dependencies;
  }
  public async read(snapshotId: string, includePrivate = false) {
    this.#authority.require('documents.read', includePrivate);
    assertOperationId(snapshotId, 'snapshotId');

    const snapshot =
      await this.#dependencies.evidenceReadRepository.loadSnapshot(
        this.#authority.workspaceId,
        snapshotId,
      );
    if (snapshot === undefined) {
      throw new OperationError('not_found', 'snapshot_not_found');
    }
    if (snapshot.isPrivate === true && !includePrivate) {
      throw new OperationError(
        'forbidden',
        'private_content_requires_opt_in',
        'includePrivate',
      );
    }
    return {
      status: 'ok' as const,
      entries: (
        await this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#authority.workspaceId,
          includePrivate,
        )
      ).filter((entry) => entry.snapshotId === snapshotId),
      snapshot: await materializeEvidenceSnapshot(
        snapshot,
        this.#dependencies.blobStore,
      ),
    };
  }
  public async sections(snapshotId: string) {
    const {snapshot} = await this.read(snapshotId);
    return {
      snapshotId,
      sections: providerSections(orderedSectionFragments(snapshot), snapshot),
    };
  }
  public async list(includePrivate = false, includeInbox = false) {
    this.#authority.require('documents.read', includePrivate);

    const [snapshots, entries, currentTags, workingCopies, intake] =
      await Promise.all([
        this.#dependencies.evidenceReadRepository.listSnapshots(
          this.#authority.workspaceId,
        ),
        this.#dependencies.informationEntryRepository.loadCurrentEntries(
          this.#authority.workspaceId,
          includePrivate,
        ),
        this.#dependencies.informationDocumentTagRepository.loadCurrentDocumentTags(
          this.#authority.workspaceId,
          includePrivate,
        ),
        this.#dependencies.informationDocumentWorkingCopyRepository.list(
          this.#authority.workspaceId,
        ),
        this.#dependencies.documentIntakeRepository?.list() ?? [],
      ]);
    const workingCopyBySource = new Map(
      workingCopies.map((workingCopy) => [
        workingCopy.sourceSnapshotId,
        workingCopy,
      ]),
    );
    const sourceByDerived = new Map(
      workingCopies.flatMap((workingCopy) =>
        workingCopy.derivedSnapshotId === undefined
          ? []
          : [
              [
                workingCopy.derivedSnapshotId,
                workingCopy.sourceSnapshotId,
              ] as const,
            ],
      ),
    );
    const inboxOnly = new Set(
      intake
        .filter(
          (record) =>
            record.value.receipt && record.value.receipt !== 'accepted',
        )
        .flatMap(intakeSnapshotIds),
    );
    const evidenceCopies = new Set(
      intake.flatMap((record) =>
        intakeSnapshotIds(record).filter(
          (id) => id !== intakeTargetSnapshot(record),
        ),
      ),
    );
    const receivedByBody = new Map(
      intake.map((record) => [intakeTargetSnapshot(record), record.snapshotId]),
    );
    const documents = snapshots
      .filter((snapshot) => !evidenceCopies.has(snapshot.snapshotId))
      .filter((snapshot) => includeInbox || !inboxOnly.has(snapshot.snapshotId))
      .filter((snapshot) => includePrivate || snapshot.isPrivate !== true)
      .map((snapshot): Readonly<InformationEntryDocumentView> => {
        const documentEntries = entries.filter(
          (entry) => entry.snapshotId === snapshot.snapshotId,
        );
        const tags = currentTags.find(
          (candidate) => candidate.snapshotId === snapshot.snapshotId,
        );
        if (tags !== undefined && tags.resourceId !== snapshot.resourceId) {
          throw new Error('Document tag source identity mismatch.');
        }
        const workingCopy = workingCopyBySource.get(snapshot.snapshotId);
        const origin = receivedByBody.get(snapshot.snapshotId);
        const derivedFromSnapshotId =
          sourceByDerived.get(snapshot.snapshotId) ??
          (origin !== snapshot.snapshotId ? origin : undefined);
        return Object.freeze({
          ...snapshot,
          entryCount: documentEntries.length,
          annotatedEntryCount: documentEntries.filter(
            (entry) =>
              entry.value.contentKeywords.length > 0 ||
              entry.value.typeKeyword !== undefined ||
              entry.value.domains.length > 0,
          ).length,
          ...(tags === undefined ? {} : {currentTags: tags}),
          ...(workingCopy === undefined ? {} : {workingCopy}),
          ...(derivedFromSnapshotId === undefined
            ? {}
            : {derivedFromSnapshotId}),
        });
      });
    return {
      status: 'ok' as const,
      totalCount: documents.length,
      documents: Object.freeze(documents),
    };
  }
  public async materialize(input: DocumentSplitRequest) {
    this.#authority.require('documents.split', input.includePrivate);
    assertOperationId(input.snapshotId, 'snapshotId');
    const snapshot =
      await this.#dependencies.evidenceReadRepository.loadSnapshot(
        this.#authority.workspaceId,
        input.snapshotId,
      );
    if (
      snapshot === undefined ||
      (snapshot.isPrivate === true && !input.includePrivate)
    )
      throw new OperationError('not_found', 'snapshot_not_found');
    const receipt = (
      await this.#dependencies.documentIntakeRepository?.read(input.snapshotId)
    )?.value.receipt;
    if (receipt && receipt !== 'accepted')
      throw new OperationError(
        'rejected',
        receipt === 'pending'
          ? 'intake_receipt_pending'
          : 'intake_receipt_rejected',
      );
    const materialized = await materializeEvidenceSnapshot(
      snapshot,
      this.#dependencies.blobStore,
    );
    const entries =
      input.mode === 'deterministic'
        ? prepareSplitInformationEntries(materialized)
        : prepareManualSplitInformationEntries(materialized, input.groups);
    if (entries === undefined || entries.length === 0)
      throw new OperationError(
        'rejected',
        input.mode === 'deterministic'
          ? 'entry_sections_not_found'
          : 'manual_split_invalid',
      );
    if (!snapshot.isPrivate)
      await this.#dependencies.stageDocument?.(input.snapshotId);
    const persisted =
      await this.#dependencies.informationEntryRepository.materializeEntriesIfSnapshotEmpty(
        entries,
      );
    if (persisted.outcome === 'snapshot_not_empty')
      throw new OperationError(
        'conflict',
        'split_structure_already_materialized',
      );
    const current =
      await this.#dependencies.informationEntryRepository.loadCurrentEntries(
        this.#authority.workspaceId,
        input.includePrivate,
      );
    const entryIds = new Set(entries.map((entry) => entry.entryId));
    return Object.freeze({
      status: persisted.outcome,
      snapshotId: input.snapshotId,
      createdCount: persisted.createdCount,
      entries: Object.freeze(
        current.filter((entry) => entryIds.has(entry.entryId)),
      ),
    });
  }
}
