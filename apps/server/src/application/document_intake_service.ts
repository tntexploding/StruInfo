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
  IntakePreparation,
} from './document_intake_contract.js';
import {
  intakeAssessmentSchema,
  intakePolicySchema,
  intakePreparationSchema,
  intakeSnapshotIds,
  intakeTargetSnapshot,
} from './document_intake_contract.js';
import {
  OperationError,
  assertOperationId,
  requireOperationValue,
  assertOperationVersion,
} from './operation_error.js';

import {
  manualIntakeDecision,
  selectManualIntakeExamples,
} from './intake_feedback.js';

const pending: IntakeRecordValue = {
  decision: 'pending',
  origin: 'system',
  reason: '',
  preparation: 'received',
};

/** These thresholds choose text to review; only a model/owner can admit it. */
function readableParagraphSizes(text: string): number[] {
  return text
    .split(/\n\s*\n/u)
    .filter((p) => !/^\s*#/u.test(p) && !/^\s*!?\[[^\]]+\]\(https?:/u.test(p))
    .map((p) => p.match(/[\p{L}\p{N}]/gu)?.length ?? 0);
}
function substantialReceivedBody(text: string): boolean {
  const sizes = readableParagraphSizes(text);
  return (
    sizes.filter((n) => n >= 100).length >= 2 &&
    sizes.reduce((a, b) => a + b, 0) >= 800
  );
}

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
      assertBodyChangeAllowed: (
        snapshotIds: readonly string[],
      ) => Promise<void>;
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
    return (await this.deps.repository.list()).filter((r) =>
      intakeSnapshotIds(r).every((id) => visible.has(id)),
    );
  }

  public async record(snapshotId: string) {
    await this.publicSnapshot(snapshotId);
    return (
      (await this.deps.repository.read(snapshotId)) ??
      (await this.list()).find((r) => intakeSnapshotIds(r).includes(snapshotId))
    );
  }

  public async guard(
    snapshotId: string,
    allowIntakeRoot = false,
    allowPendingReceipt = false,
  ): Promise<string | undefined> {
    const record = await this.record(snapshotId);
    if (record?.value.receipt === 'pending' && !allowPendingReceipt)
      return 'intake_receipt_pending';
    if (record?.value.receipt === 'rejected') return 'intake_receipt_rejected';
    return record?.value.decision === 'blocked'
      ? 'intake_blocked'
      : record?.value.decision === 'held'
        ? 'intake_held'
        : record &&
            !(allowIntakeRoot && snapshotId === record.snapshotId) &&
            intakeTargetSnapshot(record) !== snapshotId
          ? 'intake_body_not_selected'
          : undefined;
  }

  /** Each selected version is checked independently; successful decisions survive retries. */
  public async receive(
    items: readonly {snapshotId: string; expectedVersion: number}[],
    action: 'accept' | 'reject' | 'reset',
  ) {
    const records: IntakeRecord[] = [];
    const failed: {snapshotId: string; code: string}[] = [];
    for (const item of items) {
      try {
        const record = await this.record(item.snapshotId);
        const root = record?.snapshotId ?? item.snapshotId;
        await this.deps.repository.withLock(root, async () => {
          const current = await this.record(root);
          if ((current?.version ?? 0) !== item.expectedVersion)
            throw new OperationError('conflict', 'stale_intake_version');
          if (action !== 'accept' || !current?.value.receipt)
            await this.deps.assertBodyChangeAllowed(
              current ? intakeSnapshotIds(current) : [root],
            );
          const value: IntakeRecordValue = {
            ...(current?.value ?? pending),
            receipt:
              action === 'accept'
                ? 'accepted'
                : action === 'reject'
                  ? 'rejected'
                  : 'pending',
          };
          value.receiptOrigin = 'manual';
          // Confirming the same explicit review must retain its explanation.
          // A reversal or reset must not reuse the reason for the opposite choice.
          if (
            action === 'reset' ||
            value.origin !== 'manual' ||
            value.decision !== (action === 'accept' ? 'admitted' : 'blocked')
          )
            delete value.manualReviewNote;
          delete value.receiptTaskId;
          delete value.deferProcessing;
          if (action === 'reset') {
            value.decision = 'pending';
            value.origin = 'system';
            delete value.assessment;
            delete value.appliedManualReviews;
            delete value.policy;
            delete value.model;
          }
          if (action === 'accept') {
            value.decision = 'admitted';
            value.origin = 'manual';
            if (current?.value.receipt !== 'accepted' && !value.publication)
              value.publication = {
                origin: 'manual',
                confirmedAt: new Date().toISOString(),
                entries: [],
              };
          }
          if (
            !(await this.deps.repository.save(
              root,
              item.expectedVersion,
              value,
            ))
          )
            throw new OperationError('conflict', 'stale_intake_version');
          records.push(
            requireOperationValue(await this.deps.repository.read(root)),
          );
        });
      } catch (error) {
        failed.push({
          snapshotId: item.snapshotId,
          code:
            error instanceof OperationError
              ? error.code
              : 'intake_receipt_failed',
        });
      }
    }
    return {records, failed};
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
      ...(action !== 'reset' ? {manualReviewNote: reason} : {}),
    };
    if (action === 'reset') {
      delete value.manualReviewNote;
      delete value.assessment;
      delete value.appliedManualReviews;
      delete value.policy;
      delete value.model;
    }
    if (!(await this.deps.repository.save(root, expectedVersion, value)))
      throw new OperationError('conflict', 'stale_intake_version');
    return this.deps.repository.read(root);
  }

  /** Reuses a linked capture; a retry after a crash never silently replaces it. */
  public async prepare(
    snapshotId: string,
    input: IntakePolicy,
    selection?: IntakePreparation,
  ) {
    const policy = intakePolicySchema.parse(input);
    const options = selection
      ? intakePreparationSchema.parse(selection)
      : undefined;
    const root = (await this.record(snapshotId))?.snapshotId ?? snapshotId;
    const snapshot = await this.publicSnapshot(root);
    return this.deps.repository.withLock(root, async () => {
      const current = await this.record(root);
      if (options) {
        if ((current?.version ?? 0) !== options.expectedVersion)
          throw new OperationError('conflict', 'stale_intake_version');
        if (current?.value.decision === 'blocked')
          throw new OperationError('rejected', 'intake_blocked');
        await this.deps.assertBodyChangeAllowed(
          current ? intakeSnapshotIds(current) : [root],
        );
        if (
          options.source === 'received' ||
          (current?.value.preparedSnapshotId && !options.refresh)
        ) {
          if (options.source === 'web_article')
            await this.publicSnapshot(
              requireOperationValue(current?.value.preparedSnapshotId),
            );
          const value = this.pendingBody(
            current,
            options.source,
            '正文选择已更新，等待重新审核。',
          );
          if (
            !(await this.deps.repository.save(
              root,
              options.expectedVersion,
              value,
            ))
          )
            throw new OperationError('conflict', 'stale_intake_version');
          return this.record(root);
        }
        if ((current?.value.previousPreparedSnapshotIds?.length ?? 0) >= 16)
          throw new OperationError('rejected', 'intake_capture_history_limit');
      }
      if (
        !options &&
        current &&
        (current.value.origin === 'manual' ||
          current.value.decision === 'held' ||
          current.value.bodySource === 'received' ||
          current.value.preparedSnapshotId)
      )
        return current;
      if (
        !policy.fetchFullText ||
        !snapshot.canonicalUri ||
        snapshot.resourceKind !== 'remote_document'
      ) {
        if (options)
          throw new OperationError('rejected', 'intake_fulltext_unavailable');
        return current;
      }
      const received = await this.sourceText(root);
      const key =
        'intake-fulltext:' +
        root +
        (options?.refresh
          ? ':refresh:' + options.expectedVersion.toString()
          : '');
      const preparedId = deriveProcessingRunId(
        this.deps.workspaceId,
        key + ':snapshot',
      );
      try {
        if (
          !options &&
          received.syndicated &&
          substantialReceivedBody(received.text)
        ) {
          if (
            !(await this.deps.repository.save(
              root,
              current?.version ?? 0,
              this.pendingBody(
                current,
                'received',
                '订阅原文已有可读正文，优先使用原文等待审核。',
              ),
            ))
          )
            throw new OperationError('conflict', 'stale_intake_version');
          return await this.record(root);
        }
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
          const fetched = await this.deps.readWeb(root, snapshot.canonicalUri);
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
                sourceKey:
                  snapshot.sourceKey +
                  ' · 网页正文' +
                  (options?.refresh
                    ? ' · 重新获取 ' + options.expectedVersion.toString()
                    : ''),
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
        // A source switch chooses evidence to review, never an admission decision.
        const bodySource = options
          ? 'web_article'
          : await this.preferredBody(root, preparedId);
        if (options)
          await this.deps.assertBodyChangeAllowed(
            current ? intakeSnapshotIds(current) : [root],
          );
        const history = [...(current?.value.previousPreparedSnapshotIds ?? [])];
        if (
          current?.value.preparedSnapshotId &&
          current.value.preparedSnapshotId !== preparedId
        )
          history.push(current.value.preparedSnapshotId);
        const saved = await this.deps.repository.save(
          root,
          current?.version ?? 0,
          {
            ...this.pendingBody(
              current,
              bodySource,
              bodySource === 'received'
                ? '网页正文不足，改用已接收正文等待审核。'
                : '网页正文已获取，等待审核。',
            ),
            preparedSnapshotId: preparedId,
            ...(history.length ? {previousPreparedSnapshotIds: history} : {}),
          },
        );
        if (!saved)
          throw new OperationError('conflict', 'stale_intake_version');
      } catch (error) {
        if (
          error instanceof OperationError &&
          (error.kind === 'forbidden' || error.kind === 'conflict')
        )
          throw error;
        // Automatic preparation can still review received prose. An explicit web
        // selection must not silently switch, and neither path admits material.
        const canReviewReceived =
          !options &&
          readableParagraphSizes(received.text).reduce((a, b) => a + b, 0) >=
            80;
        const value: IntakeRecordValue = canReviewReceived
          ? this.pendingBody(
              current,
              'received',
              '网页正文获取失败，改用已接收正文等待审核；完整性仍需判断。',
            )
          : {
              ...(current?.value ?? pending),
              decision: 'held',
              origin: 'system',
              reason:
                '网页正文获取失败，现有正文不足或已指定网页正文；请核对原文后重试。',
            };
        if (
          !(await this.deps.repository.save(root, current?.version ?? 0, value))
        )
          throw new OperationError('conflict', 'stale_intake_version');
      }
      return this.record(root);
    });
  }

  private pendingBody(
    current: IntakeRecord | undefined,
    source: 'received' | 'web_article',
    reason: string,
  ): IntakeRecordValue {
    const value: IntakeRecordValue = {
      ...(current?.value ?? pending),
      decision: 'pending',
      origin: 'system',
      reason,
      bodySource: source,
      preparation: source,
    };
    delete value.assessment;
    delete value.appliedManualReviews;
    delete value.policy;
    delete value.model;
    return value;
  }

  private async sourceText(snapshotId: string) {
    const snapshot = await this.publicSnapshot(snapshotId);
    const evidence = await materializeEvidenceSnapshot(
      snapshot,
      this.deps.blobStore,
    );
    const text = evidence.structures[0]?.normalizedText ?? '';
    const mediaType = snapshot.mediaType?.split(';')[0]?.trim().toLowerCase();
    const feed =
      snapshot.resourceKind === 'remote_document' &&
      [
        'application/rss+xml',
        'application/atom+xml',
        'application/xml',
        'text/xml',
      ].includes(mediaType ?? '');
    // Strip only the connector's exact trailing return link for this source.
    // Stored evidence and genuine links within the publisher's body stay intact.
    const uri = snapshot.canonicalUri
      ?.replace(/\s/gu, '%20')
      .replace(/\)/gu, '%29');
    const footer = uri ? '\n\n[查看原始条目](' + uri + ')' : undefined;
    const syndicated =
      feed && footer !== undefined && text.trimEnd().endsWith(footer);
    return {
      syndicated,
      text:
        syndicated && footer
          ? text.trimEnd().slice(0, -footer.length).trimEnd()
          : text,
    };
  }

  private async preferredBody(
    receivedId: string,
    webId: string,
  ): Promise<'received' | 'web_article'> {
    const [received, web] = await Promise.all([
      this.sourceText(receivedId),
      this.sourceText(webId),
    ]);
    // Recover an obviously short web projection, without claiming completeness.
    return substantialReceivedBody(received.text) &&
      readableParagraphSizes(web.text).reduce((a, b) => a + b, 0) < 200
      ? 'received'
      : 'web_article';
  }

  public async review(
    snapshotId: string,
    input: IntakePolicy,
    receiptOnly = false,
  ) {
    const policy = intakePolicySchema.parse(input);
    const current = await this.record(snapshotId);
    if (receiptOnly && current?.value.receipt !== 'pending')
      throw new OperationError('conflict', 'intake_receipt_not_pending');
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
    const source = await this.sourceText(
      current ? intakeTargetSnapshot(current) : snapshotId,
    );
    const examples = selectManualIntakeExamples(
      await this.list(),
      await this.deps.evidence.listSnapshots(this.deps.workspaceId),
      current,
      current?.snapshotId ?? snapshotId,
    );
    const manualReviews = [];
    const appliedManualReviews = [];
    for (const {record} of examples) {
      const decision = manualIntakeDecision(record);
      if (!decision) continue;
      const body = await this.sourceText(intakeTargetSnapshot(record));
      manualReviews.push({
        decision,
        excerpt: Array.from(body.text).slice(0, 900).join(''),
        ...(record.value.manualReviewNote
          ? {ownerReason: record.value.manualReviewNote}
          : {}),
        ...(record.value.assessment
          ? {previousAiAssessment: record.value.assessment}
          : {}),
      });
      appliedManualReviews.push({
        snapshotId: record.snapshotId,
        version: record.version,
      });
    }
    const assessment = intakeAssessmentSchema.parse(
      await this.deps.provider.reviewIntake({
        text: source.text,
        preparation: current?.value.preparation ?? 'received',
        policy,
        ...(manualReviews.length ? {manualReviews} : {}),
      }),
    );
    const admitted =
      assessment.decision === 'admit' &&
      assessment.completeness === 'complete' &&
      !policy.blockedKinds.includes(assessment.contentKind);
    const saved = await this.deps.repository.save(
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
        appliedManualReviews,
      },
    );
    // A concurrent manual decision wins over the result of an in-flight model call.
    const result = await this.record(snapshotId);
    if (
      receiptOnly &&
      (!saved || result?.version !== (current?.version ?? 0) + 1)
    )
      throw new OperationError('conflict', 'stale_intake_version');
    return result;
  }

  public async receiptReviewReady(snapshotId: string, expectedVersion: number) {
    const record = await this.record(snapshotId);
    if (record?.snapshotId !== snapshotId || record.version !== expectedVersion)
      throw new OperationError('conflict', 'stale_intake_version');
    if (record.value.receipt !== 'pending')
      throw new OperationError('rejected', 'intake_receipt_not_pending');
    if (record.value.decision === 'blocked')
      throw new OperationError('rejected', 'intake_blocked');
    await this.deps.assertBodyChangeAllowed(intakeSnapshotIds(record));
  }

  /** Review and receipt acceptance are separate so pause/cancel is rechecked after the call. */
  public async acceptReviewedReceipt(
    snapshotId: string,
    taskId: string,
    expectedVersion: number,
    continueProcessing = false,
  ) {
    return this.deps.repository.withLock(snapshotId, async () => {
      const current = requireOperationValue(await this.record(snapshotId));
      if (
        current.value.receipt === 'accepted' &&
        current.value.receiptTaskId === taskId
      )
        return 'accepted' as const;
      if (current.version !== expectedVersion)
        throw new OperationError('conflict', 'stale_intake_version');
      if (current.value.receipt !== 'pending')
        throw new OperationError('conflict', 'intake_receipt_not_pending');
      if (
        current.value.decision !== 'admitted' ||
        current.value.origin !== 'model' ||
        current.value.assessment?.decision !== 'admit' ||
        current.value.assessment.completeness !== 'complete'
      )
        return 'held' as const;
      if (
        !(await this.deps.repository.save(snapshotId, expectedVersion, {
          ...current.value,
          receipt: 'accepted',
          receiptOrigin: 'model',
          receiptTaskId: taskId,
          deferProcessing: !continueProcessing,
          publication: {
            origin: 'internal_ai',
            confirmedAt: new Date().toISOString(),
            entries: [],
          },
        }))
      )
        throw new OperationError('conflict', 'stale_intake_version');
      return 'accepted' as const;
    });
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
