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

export interface DocumentBrowseOptions {
  readonly limit?: number;
  readonly query?: string;
  readonly type?: string;
  readonly readingState?: string;
  readonly snapshotId?: string;
  readonly after?: Readonly<{capturedAt: string; snapshotId: string}>;
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
      entries: this.#dependencies.informationEntryRepository
        .loadCurrentEntriesForSnapshot
        ? await this.#dependencies.informationEntryRepository.loadCurrentEntriesForSnapshot(
            this.#authority.workspaceId,
            includePrivate,
            snapshotId,
          )
        : (
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
  public async list(
    includePrivate = false,
    includeInbox = false,
    options: DocumentBrowseOptions = {},
  ) {
    this.#authority.require('documents.read', includePrivate);

    const [snapshots, entryCounts, currentTags, workingCopies, intake] =
      await Promise.all([
        this.#dependencies.evidenceReadRepository.listSnapshots(
          this.#authority.workspaceId,
        ),
        this.documentEntryCounts(includePrivate),
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
    const countsBySnapshot = new Map(
      entryCounts.map((row) => [row.snapshotId, row]),
    );
    let documents = snapshots
      .filter((snapshot) => !evidenceCopies.has(snapshot.snapshotId))
      .filter((snapshot) => includeInbox || !inboxOnly.has(snapshot.snapshotId))
      .filter((snapshot) => includePrivate || snapshot.isPrivate !== true)
      .map((snapshot): Readonly<InformationEntryDocumentView> => {
        const counts = countsBySnapshot.get(snapshot.snapshotId);
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
          entryCount: counts?.entryCount ?? 0,
          annotatedEntryCount: counts?.annotatedEntryCount ?? 0,
          ...(counts?.title ? {title: counts.title} : {}),
          types: counts?.types ?? [],
          readingState: counts?.readingState ?? 'unread',
          ...(tags === undefined ? {} : {currentTags: tags}),
          ...(workingCopy === undefined ? {} : {workingCopy}),
          ...(derivedFromSnapshotId === undefined
            ? {}
            : {derivedFromSnapshotId}),
        });
      });
    const facets = {
      types: [...new Set(documents.flatMap((d) => d.types ?? []))].sort(),
      sources: [...new Set(documents.map((d) => d.sourceKey))].sort(),
    };
    const type = options.type;
    if (type) documents = documents.filter((d) => d.types?.includes(type));
    if (options.readingState)
      documents = documents.filter(
        (d) => d.readingState === options.readingState,
      );
    if (options.snapshotId)
      documents = documents.filter((d) => d.snapshotId === options.snapshotId);
    if (options.query) {
      const query = options.query.toLocaleLowerCase();
      documents = documents.filter((d) =>
        [
          d.title,
          d.sourceKey,
          d.canonicalUri,
          ...(d.currentTags?.value.tags.map((t) => t.displayValue) ?? []),
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query),
      );
    }
    const totalCount = documents.length;
    documents.sort(
      (a, b) =>
        b.capturedAt.localeCompare(a.capturedAt) ||
        a.snapshotId.localeCompare(b.snapshotId),
    );
    if (options.after) {
      const after = options.after;
      documents = documents.filter(
        (d) =>
          d.capturedAt < after.capturedAt ||
          (d.capturedAt === after.capturedAt &&
            d.snapshotId > after.snapshotId),
      );
    }
    const hasMore =
      options.limit !== undefined && documents.length > options.limit;
    if (options.limit !== undefined)
      documents = documents.slice(0, options.limit);
    const last = documents.at(-1);
    return {
      status: 'ok' as const,
      totalCount,
      facets,
      documents: Object.freeze(documents),
      ...(hasMore && last
        ? {
            nextCursor: {
              capturedAt: last.capturedAt,
              snapshotId: last.snapshotId,
            },
          }
        : {}),
    };
  }
  private async documentEntryCounts(includePrivate: boolean) {
    const repo = this.#dependencies.informationEntryRepository;
    if (repo.loadDocumentEntryCounts)
      return repo.loadDocumentEntryCounts(
        this.#authority.workspaceId,
        includePrivate,
      );
    const result = new Map<
      string,
      {
        snapshotId: string;
        entryCount: number;
        annotatedEntryCount: number;
        title?: string;
        types: string[];
        readingState: string;
      }
    >();
    for (const e of await repo.loadCurrentEntries(
      this.#authority.workspaceId,
      includePrivate,
    )) {
      const row = result.get(e.snapshotId) ?? {
        snapshotId: e.snapshotId,
        entryCount: 0,
        annotatedEntryCount: 0,
        title: e.value.titlePath,
        types: [],
        readingState: 'unread',
      };
      row.entryCount++;
      if (
        e.value.contentKeywords.length ||
        e.value.typeKeyword !== undefined ||
        e.value.domains.length
      )
        row.annotatedEntryCount++;
      const type = e.value.typeCustomName ?? e.value.typeKeyword;
      if (type && !row.types.includes(type)) row.types.push(type);
      const reading = e.value.annotations?.readingState ?? 'unread';
      row.readingState =
        row.entryCount === 1
          ? reading
          : row.readingState === reading
            ? reading
            : 'reading';
      result.set(e.snapshotId, row);
    }
    return [...result.values()];
  }
  public async summary() {
    const [all, intake] = await Promise.all([
      this.list(false, true),
      this.#dependencies.documentIntakeRepository?.list() ?? [],
    ]);
    const pending = new Set(
      intake
        .filter((r) => r.value.receipt === 'pending')
        .map(intakeTargetSnapshot),
    );
    return {
      status: 'ok',
      documents: all.totalCount,
      entries: all.documents.reduce((n, d) => n + d.entryCount, 0),
      tagNames: [
        ...new Set(
          all.documents.flatMap(
            (d) => d.currentTags?.value.tags.map((t) => t.displayValue) ?? [],
          ),
        ),
      ],
      pendingCount: all.documents.filter((d) => pending.has(d.snapshotId))
        .length,
      recentDocuments: all.documents.slice(0, 100).map((d) => ({
        snapshotId: d.snapshotId,
        sourceKey: d.sourceKey,
        canonicalUri: d.canonicalUri,
      })),
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
