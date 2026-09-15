import {
  importMarkdownEvidence,
  materializeEvidenceSnapshot,
  type EvidenceReadRepositoryPort,
  type EvidenceRepositoryPort,
} from '../modules/evidence/index.js';
import type {SourceConnectorReadResult} from '../modules/subscriptions/source_connector.js';
import {deriveProcessingRunId} from '../modules/processing/processing_identity.js';
import type {BlobStore} from '../storage/blob_store.js';
import type {
  DocumentIntelligenceProvider,
  DocumentIntakeRepository,
  IntakePolicy,
  IntakeRecord,
  IntakeRecordValue,
} from './document_intake_contract.js';
import {
  intakeAssessmentSchema,
  intakePolicySchema,
} from './document_intake_contract.js';
import {
  OperationError,
  assertOperationId,
  requireOperationValue,
  assertOperationVersion,
} from './operation_error.js';

const pending: IntakeRecordValue = {
  decision: 'pending',
  origin: 'system',
  reason: '',
  preparation: 'received',
};

/** Evidence capture and current routing decisions are deliberately separate. */
export class DocumentIntakeService {
  public constructor(
    private readonly deps: {
      workspaceId: string;
      repository: DocumentIntakeRepository;
      evidence: EvidenceReadRepositoryPort;
      capture: EvidenceRepositoryPort;
      blobStore: BlobStore;
      readWeb: (
        snapshotId: string,
        url: string,
      ) => Promise<Readonly<SourceConnectorReadResult>>;
      provider?: DocumentIntelligenceProvider;
    },
  ) {}

  public async publicSnapshot(snapshotId: string) {
    assertOperationId(snapshotId, 'snapshotId');
    const snapshot = await this.deps.evidence.loadSnapshot(
      this.deps.workspaceId,
      snapshotId,
    );
    if (!snapshot) throw new OperationError('not_found', 'snapshot_not_found');
    if (snapshot.isPrivate)
      throw new OperationError('forbidden', 'private_model_transfer_forbidden');
    return snapshot;
  }

  public async list(): Promise<readonly IntakeRecord[]> {
    const visible = new Set(
      (await this.deps.evidence.listSnapshots(this.deps.workspaceId))
        .filter((s) => !s.isPrivate)
        .map((s) => s.snapshotId),
    );
    return (await this.deps.repository.list()).filter(
      (r) =>
        visible.has(r.snapshotId) &&
        (!r.value.preparedSnapshotId ||
          visible.has(r.value.preparedSnapshotId)),
    );
  }

  public async record(snapshotId: string) {
    await this.publicSnapshot(snapshotId);
    return (
      (await this.deps.repository.read(snapshotId)) ??
      (await this.list()).find((r) => r.value.preparedSnapshotId === snapshotId)
    );
  }

  public async guard(snapshotId: string): Promise<string | undefined> {
    const record = await this.record(snapshotId);
    return record?.value.decision === 'blocked'
      ? 'intake_blocked'
      : record?.value.decision === 'held'
        ? 'intake_held'
        : undefined;
  }

  public async control(
    snapshotId: string,
    expectedVersion: number,
    action: 'block' | 'admit' | 'reset',
    reason: string,
  ) {
    assertOperationVersion(expectedVersion, 'expectedVersion', 0);
    const record = await this.record(snapshotId);
    const root = record?.snapshotId ?? snapshotId;
    if ((record?.version ?? 0) !== expectedVersion)
      throw new OperationError('conflict', 'stale_intake_version');
    const value: IntakeRecordValue = {
      ...(record?.value ?? pending),
      decision:
        action === 'block'
          ? 'blocked'
          : action === 'admit'
            ? 'admitted'
            : 'pending',
      origin: action === 'reset' ? 'system' : 'manual',
      reason,
    };
    if (action === 'reset') {
      delete value.assessment;
      delete value.policy;
      delete value.model;
    }
    if (!(await this.deps.repository.save(root, expectedVersion, value)))
      throw new OperationError('conflict', 'stale_intake_version');
    return this.deps.repository.read(root);
  }

  /** Reuses a linked capture; a retry after a crash never silently replaces it. */
  public async prepare(snapshotId: string, input: IntakePolicy) {
    const policy = intakePolicySchema.parse(input);
    const snapshot = await this.publicSnapshot(snapshotId);
    return this.deps.repository.withLock(snapshotId, async () => {
      const current = await this.record(snapshotId);
      if (
        current &&
        (current.value.origin === 'manual' ||
          current.value.decision === 'held' ||
          current.value.preparedSnapshotId)
      )
        return current;
      if (
        !policy.fetchFullText ||
        !snapshot.canonicalUri ||
        snapshot.resourceKind !== 'remote_document'
      )
        return current;
      const key = 'intake-fulltext:' + snapshotId;
      const preparedId = deriveProcessingRunId(
        this.deps.workspaceId,
        key + ':snapshot',
      );
      try {
        const previous = await this.deps.evidence.loadSnapshot(
          this.deps.workspaceId,
          preparedId,
        );
        if (previous?.isPrivate)
          throw new OperationError(
            'forbidden',
            'private_model_transfer_forbidden',
          );
        if (!previous) {
          const fetched = await this.deps.readWeb(
            snapshotId,
            snapshot.canonicalUri,
          );
          if (fetched.status !== 'changed' || fetched.documents.length !== 1)
            throw new OperationError('rejected', 'intake_fulltext_unavailable');
          const doc = requireOperationValue(fetched.documents[0]);
          const resourceId = deriveProcessingRunId(
            this.deps.workspaceId,
            key + ':resource',
          );
          const result = await importMarkdownEvidence(
            {
              blobStore: this.deps.blobStore,
              evidenceRepository: this.deps.capture,
            },
            {
              workspaceId: this.deps.workspaceId,
              commandIdempotencyKey: key,
              resource: {
                workspaceId: this.deps.workspaceId,
                resourceId,
                resourceKind: 'remote_document',
                sourceKey: snapshot.sourceKey + ' · 网页正文',
                canonicalUri: snapshot.canonicalUri,
              },
              snapshot: {
                workspaceId: this.deps.workspaceId,
                resourceId,
                snapshotId: preparedId,
                capturedAt: new Date().toISOString(),
                mediaType: doc.mediaType,
                ...(snapshot.publication
                  ? {publication: snapshot.publication}
                  : {}),
              },
              profile: 'commonmark-v1',
              sourceUtf8: doc.sourceUtf8,
              ...(doc.rawSourceBytes
                ? {rawSourceBytes: doc.rawSourceBytes}
                : {}),
              documentBaseUri: snapshot.canonicalUri,
              gitObservations: [],
            },
          );
          if (result.status !== 'created' && result.status !== 'existing')
            throw new OperationError('rejected', 'intake_capture_failed');
        }
        await this.deps.repository.save(snapshotId, current?.version ?? 0, {
          ...pending,
          reason: '网页正文已获取，等待审核。',
          preparedSnapshotId: preparedId,
          preparation: 'web_article',
        });
      } catch (error) {
        if (error instanceof OperationError && error.kind === 'forbidden')
          throw error;
        // Keep feed evidence visible, but do not quietly process a failed full-text fetch.
        await this.deps.repository.save(snapshotId, current?.version ?? 0, {
          ...(current?.value ?? pending),
          decision: 'held',
          origin: 'system',
          reason: '网页正文获取失败，请检查原文；可重试或人工放行。',
        });
      }
      return this.record(snapshotId);
    });
  }

  public async review(snapshotId: string, input: IntakePolicy) {
    const policy = intakePolicySchema.parse(input);
    const current = await this.record(snapshotId);
    if (
      current?.value.origin === 'manual' ||
      current?.value.decision === 'held'
    )
      return current;
    if (
      current?.value.assessment &&
      JSON.stringify(current.value.policy) === JSON.stringify(policy)
    )
      return current;
    if (!this.deps.provider)
      throw new OperationError('rejected', 'ai_not_configured');
    const snapshot = await this.publicSnapshot(
      current?.value.preparedSnapshotId ?? snapshotId,
    );
    const evidence = await materializeEvidenceSnapshot(
      snapshot,
      this.deps.blobStore,
    );
    const assessment = intakeAssessmentSchema.parse(
      await this.deps.provider.reviewIntake({
        text: evidence.structures[0]?.normalizedText ?? '',
        preparation: current?.value.preparation ?? 'received',
        policy,
      }),
    );
    const admitted =
      assessment.decision === 'admit' &&
      assessment.completeness === 'complete' &&
      !policy.blockedKinds.includes(assessment.contentKind);
    await this.deps.repository.save(
      current?.snapshotId ?? snapshotId,
      current?.version ?? 0,
      {
        ...(current?.value ?? pending),
        decision: admitted ? 'admitted' : 'held',
        origin: 'model',
        reason: assessment.reason,
        assessment,
        policy,
        model: this.deps.provider.model,
      },
    );
    // A concurrent manual decision wins over the result of an in-flight model call.
    return this.record(snapshotId);
  }

  public async needsReview(snapshotId: string, policy: IntakePolicy) {
    const current = await this.prepare(snapshotId, policy);
    return !(
      current &&
      (current.value.origin === 'manual' ||
        current.value.decision === 'held' ||
        (current.value.assessment &&
          JSON.stringify(current.value.policy) === JSON.stringify(policy)))
    );
  }
}
