import type {
  InformationEntryGraphRelationValue,
  InformationEntryGraphVerificationStatus,
} from './information_entry_association_contract.js';

export interface InformationEntrySourceReviewRevisions {
  readonly entryLowRevision: number;
  readonly entryHighRevision: number;
}
export interface InformationEntrySourceReview {
  readonly status: InformationEntryGraphVerificationStatus;
  readonly storedStatus: InformationEntryGraphVerificationStatus | 'calculated';
  readonly reason:
    | 'not_reviewed'
    | 'owner_requested'
    | 'unbound'
    | 'entry_changed'
    | 'current';
  readonly reviewedRevisions?: Readonly<InformationEntrySourceReviewRevisions>;
}
export type InformationEntrySourceReviewFilter =
  'pending' | 'all' | InformationEntryGraphVerificationStatus;
export type InformationEntrySourceReviewPrivacy =
  'public' | 'include_private' | 'private_only';
export interface InformationEntrySourceReviewCursor {
  readonly version: 1;
  readonly filter: InformationEntrySourceReviewFilter;
  readonly privacyScope: InformationEntrySourceReviewPrivacy;
  readonly entryLowId: string;
  readonly entryHighId: string;
}
export interface InformationEntrySourceReviewRequest {
  readonly filter: InformationEntrySourceReviewFilter;
  readonly privacyScope: InformationEntrySourceReviewPrivacy;
  readonly limit: number;
  readonly after?: Readonly<InformationEntrySourceReviewCursor>;
}

export function readInformationEntrySourceReview(
  graph: Readonly<InformationEntryGraphRelationValue> | undefined,
  current: Readonly<InformationEntrySourceReviewRevisions>,
): Readonly<InformationEntrySourceReview> {
  const storedStatus = graph?.verificationStatus ?? 'calculated';
  const reviewedRevisions = graph?.reviewedRevisions;
  const reason =
    storedStatus === 'source_checked'
      ? reviewedRevisions === undefined
        ? 'unbound'
        : reviewedRevisions.entryLowRevision !== current.entryLowRevision ||
            reviewedRevisions.entryHighRevision !== current.entryHighRevision
          ? 'entry_changed'
          : 'current'
      : storedStatus === 'needs_review'
        ? 'owner_requested'
        : 'not_reviewed';
  return Object.freeze({
    status:
      reason === 'current'
        ? 'source_checked'
        : reason === 'not_reviewed'
          ? 'unreviewed'
          : 'needs_review',
    storedStatus,
    reason,
    ...(reviewedRevisions === undefined ? {} : {reviewedRevisions}),
  });
}

export function sourceReviewMatches(
  filter: InformationEntrySourceReviewFilter,
  status: InformationEntryGraphVerificationStatus,
): boolean {
  return (
    filter === 'all' ||
    (filter === 'pending' ? status !== 'source_checked' : status === filter)
  );
}

export function decodeSourceReviewRequest(
  value: unknown,
): Readonly<InformationEntrySourceReviewRequest> | undefined {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) => !['filter', 'privacyScope', 'limit', 'after'].includes(key),
    )
  )
    return undefined;
  const filter = value.filter ?? 'pending';
  const privacyScope = value.privacyScope ?? 'public';
  const limit = value.limit ?? 20;
  if (
    typeof filter !== 'string' ||
    ![
      'pending',
      'all',
      'unreviewed',
      'needs_review',
      'source_checked',
    ].includes(filter) ||
    typeof privacyScope !== 'string' ||
    !['public', 'include_private', 'private_only'].includes(privacyScope) ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    return undefined;
  const after = value.after;
  if (
    after !== undefined &&
    (!record(after) ||
      Object.keys(after).sort().join(',') !==
        'entryHighId,entryLowId,filter,privacyScope,version' ||
      after.version !== 1 ||
      after.filter !== filter ||
      after.privacyScope !== privacyScope ||
      !isSourceReviewUuid(after.entryLowId) ||
      !isSourceReviewUuid(after.entryHighId) ||
      after.entryLowId >= after.entryHighId)
  )
    return undefined;
  return Object.freeze({
    filter: filter as InformationEntrySourceReviewFilter,
    privacyScope: privacyScope as InformationEntrySourceReviewPrivacy,
    limit,
    ...(after === undefined
      ? {}
      : {
          after: Object.freeze({
            ...after,
          }) as unknown as InformationEntrySourceReviewCursor,
        }),
  });
}

export function decodeSourceReviewRevisions(
  value: unknown,
): Readonly<InformationEntrySourceReviewRevisions> | undefined {
  if (
    !record(value) ||
    Object.keys(value).sort().join(',') !==
      'entryHighRevision,entryLowRevision' ||
    !revision(value.entryLowRevision) ||
    !revision(value.entryHighRevision)
  )
    return undefined;
  return Object.freeze({
    entryLowRevision: value.entryLowRevision,
    entryHighRevision: value.entryHighRevision,
  });
}
export function isSourceReviewUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      value,
    )
  );
}
function revision(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 2_147_483_647
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface InformationEntrySourceReviewWrite {
  readonly expectedRevision: number;
  readonly includePrivate: boolean;
  readonly expectedEntryRevisions: Readonly<InformationEntrySourceReviewRevisions>;
  readonly verificationStatus: InformationEntryGraphVerificationStatus;
  readonly note: string;
}
export function decodeSourceReviewWrite(
  value: unknown,
): Readonly<InformationEntrySourceReviewWrite> | undefined {
  if (
    !record(value) ||
    Object.keys(value).sort().join(',') !==
      'expectedEntryRevisions,expectedRevision,includePrivate,note,verificationStatus' ||
    typeof value.expectedRevision !== 'number' ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0 ||
    value.expectedRevision >= 2_147_483_647 ||
    typeof value.includePrivate !== 'boolean' ||
    typeof value.note !== 'string' ||
    typeof value.verificationStatus !== 'string' ||
    !['unreviewed', 'needs_review', 'source_checked'].includes(
      value.verificationStatus,
    )
  )
    return undefined;
  const expectedEntryRevisions = decodeSourceReviewRevisions(
    value.expectedEntryRevisions,
  );
  if (expectedEntryRevisions === undefined) return undefined;
  return Object.freeze({
    expectedRevision: value.expectedRevision,
    includePrivate: value.includePrivate,
    expectedEntryRevisions,
    verificationStatus:
      value.verificationStatus as InformationEntryGraphVerificationStatus,
    note: value.note,
  });
}
