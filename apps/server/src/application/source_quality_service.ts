import {z} from 'zod';
import type {DocumentIntakeService} from './document_intake_service.js';
import {
  distinctReviewedDocuments,
  intakeSourceId,
  manualIntakeDecision,
  type IntakeEvidenceSummary,
} from './intake_feedback.js';
import {OperationError} from './operation_error.js';
import {
  updateReviewPreferences,
  type ReviewPreferencesStore,
} from '../storage/review_preferences_store.js';

export const sourceQualityOwnerSchemas = {
  source_quality_status: z.object({}).strict(),
  source_quality_control: z
    .object({
      subscriptionId: z.uuid(),
      expectedRevision: z.number().int().min(0),
      action: z.enum(['keep', 'close']),
      samples: z
        .array(
          z
            .object({snapshotId: z.uuid(), version: z.number().int().min(1)})
            .strict(),
        )
        .max(20),
    })
    .strict(),
};
export const SOURCE_QUALITY_WINDOW = 20;
export const SOURCE_QUALITY_MINIMUM_ISSUES = 5;

export class SourceQualityService {
  constructor(
    private readonly workspaceId: string,
    private readonly deps: {
      preferences: ReviewPreferencesStore;
      intake: Pick<DocumentIntakeService, 'list'>;
      snapshots: () => Promise<readonly IntakeEvidenceSummary[]>;
      now?: () => string;
    },
  ) {}

  async status() {
    const [preferences, records, snapshots] = await Promise.all([
      this.deps.preferences.load(this.workspaceId),
      this.deps.intake.list(),
      this.deps.snapshots(),
    ]);
    const catalog = preferences.sourceSubscriptions;
    const reviewed = distinctReviewedDocuments(
      records.filter(
        (record) =>
          manualIntakeDecision(record) !== undefined ||
          ['admitted', 'held', 'blocked'].includes(record.value.decision),
      ),
      snapshots,
    );
    const sources = (catalog?.subscriptions ?? [])
      .filter((s) => !s.isPrivate)
      .map((source) => {
        const rows = reviewed
          .filter(
            ({record}) => intakeSourceId(record) === source.subscriptionId,
          )
          .slice(0, SOURCE_QUALITY_WINDOW);
        const samples = rows.map(({record, source: evidence}) => {
          const manual = manualIntakeDecision(record);
          const accepted =
            manual === 'accept' ||
            (!manual && record.value.decision === 'admitted');
          const technical =
            !accepted &&
            record.value.origin === 'system' &&
            !record.value.assessment;
          return {
            snapshotId: record.snapshotId,
            version: record.version,
            documentKey: evidence.canonicalUri ?? record.snapshotId,
            title: evidence.sourceKey ?? '来源文档',
            outcome: accepted
              ? ('accepted' as const)
              : manual === 'reject'
                ? ('manual_rejected' as const)
                : technical
                  ? ('technical_hold' as const)
                  : ('ai_held' as const),
            cause: accepted
              ? ('accepted' as const)
              : technical
                ? ('capture' as const)
                : record.value.assessment?.completeness === 'summary'
                  ? ('incomplete' as const)
                  : record.value.assessment?.completeness === 'uncertain'
                    ? ('uncertain' as const)
                    : ('selection' as const),
            reason: record.value.manualReviewNote ?? record.value.reason,
            reasonOrigin: record.value.manualReviewNote
              ? ('manual' as const)
              : record.value.assessment
                ? ('model' as const)
                : record.value.origin,
          };
        });
        const issues = samples.filter((s) => s.outcome !== 'accepted');
        const newIssues = issues.filter(
          (s) => !source.qualityReview?.documentKeys.includes(s.documentKey),
        );
        return {
          subscriptionId: source.subscriptionId,
          label: source.label,
          enabled: source.enabled,
          reviewed: samples.length,
          accepted: samples.length - issues.length,
          manualRejected: samples.filter((s) => s.outcome === 'manual_rejected')
            .length,
          aiHeld: samples.filter((s) => s.outcome === 'ai_held').length,
          technicalHolds: samples.filter((s) => s.cause === 'capture').length,
          incomplete: samples.filter((s) => s.cause === 'incomplete').length,
          needsReview:
            source.enabled &&
            issues.length >= SOURCE_QUALITY_MINIMUM_ISSUES &&
            issues.length * 2 >= samples.length &&
            newIssues.length >= SOURCE_QUALITY_MINIMUM_ISSUES,
          samples,
        };
      });
    return {
      revision: catalog?.revision ?? 0,
      window: SOURCE_QUALITY_WINDOW,
      minimumIssues: SOURCE_QUALITY_MINIMUM_ISSUES,
      manualExamples: reviewed.filter(({record}) =>
        manualIntakeDecision(record),
      ).length,
      sources,
    };
  }

  async control(
    input: z.infer<typeof sourceQualityOwnerSchemas.source_quality_control>,
  ) {
    const current = await this.status();
    const source = current.sources.find(
      (s) => s.subscriptionId === input.subscriptionId,
    );
    if (!source)
      throw new OperationError('not_found', 'source_quality_unavailable');
    const versions = source.samples.map(({snapshotId, version}) => ({
      snapshotId,
      version,
    }));
    if (
      current.revision !== input.expectedRevision ||
      JSON.stringify(input.samples) !== JSON.stringify(versions)
    )
      throw new OperationError('conflict', 'source_quality_changed');
    await updateReviewPreferences(
      this.deps.preferences,
      this.workspaceId,
      (preferences) => {
        const catalog = preferences.sourceSubscriptions;
        if (catalog?.revision !== input.expectedRevision)
          throw new OperationError('conflict', 'source_quality_changed');
        const subscription = catalog.subscriptions.find(
          (s) => s.subscriptionId === input.subscriptionId,
        );
        if (!subscription || subscription.isPrivate)
          throw new OperationError('not_found', 'source_quality_unavailable');
        return {
          next: {
            ...preferences,
            sourceSubscriptions: {
              revision: catalog.revision + 1,
              subscriptions: catalog.subscriptions.map((s) =>
                s.subscriptionId !== input.subscriptionId
                  ? s
                  : {
                      ...s,
                      ...(input.action === 'close' ? {enabled: false} : {}),
                      qualityReview: {
                        reviewedAt: (
                          this.deps.now ?? (() => new Date().toISOString())
                        )(),
                        documentKeys: source.samples.map((s) => s.documentKey),
                      },
                    },
              ),
            },
          },
          result: undefined,
        };
      },
    );
    return this.status();
  }
}
