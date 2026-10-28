import {structuredAnnotationsSchema} from '../modules/entries/structured_annotations.js';
import {z} from 'zod';
import {
  ENTRY_ANNOTATION_ORIGINS,
  ENTRY_CHUNK_MODES,
  ENTRY_DOMAIN_KEYWORDS,
  ENTRY_TYPE_KEYWORDS,
  type CurrentInformationEntry,
} from '../modules/entries/information_entry_contract.js';
import type {IntakeRecordValue} from './document_intake_contract.js';

const annotation = {
  origin: z.enum(ENTRY_ANNOTATION_ORIGINS),
  originVersion: z.string(),
};
const score = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
// A publication contains reading units and their immutable evidence references.
// Retrieval fragments remain evidence, not independently published articles.
export const publishedEntrySchema = z
  .object({
    workspaceId: z.uuid(),
    entryId: z.uuid(),
    resourceId: z.uuid(),
    snapshotId: z.uuid(),
    revision: z.number().int().positive(),
    revisionId: z.uuid(),
    sourceKey: z.string(),
    canonicalUri: z.string().optional(),
    capturedAt: z.iso.datetime(),
    publishedAt: z.iso.datetime().optional(),
    value: z
      .object({
        annotations: structuredAnnotationsSchema.optional(),
        documentOrder: z.number().int().min(0),
        titlePath: z.string(),
        body: z.string().min(1),
        bodySha256: z.string().regex(/^[0-9a-f]{64}$/u),
        chunkMode: z.enum(ENTRY_CHUNK_MODES),
        splitRuleVersion: z.string(),
        isPrivate: z.boolean(),
        typeKeyword: z.enum(ENTRY_TYPE_KEYWORDS).optional(),
        typeCustomName: z.string().optional(),
        usefulnessScore: score.optional(),
        interestScore: score.optional(),
        contentKeywords: z.array(
          z
            .object({
              displayValue: z.string(),
              normalizedValue: z.string(),
              ...annotation,
            })
            .strict(),
        ),
        domains: z.array(
          z
            .object({
              keyword: z.enum(ENTRY_DOMAIN_KEYWORDS),
              customName: z.string().optional(),
              ...annotation,
            })
            .strict(),
        ),
        fragmentIds: z.array(z.uuid()).min(1),
        fragmentRanges: z
          .array(
            z
              .object({
                startCodePoint: z.number().int().min(0),
                endCodePoint: z.number().int().positive(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict(),
  })
  .strict()
  .transform((value) => value as CurrentInformationEntry);

export const publicationContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentId: z.uuid(),
    source: z
      .object({
        resourceId: z.uuid(),
        sourceKey: z.string(),
        canonicalUri: z.string().optional(),
      })
      .strict(),
    snapshotId: z.uuid(),
    times: z
      .object({
        receivedAt: z.iso.datetime(),
        sourcePublishedAt: z.iso.datetime().nullable(),
        eventAt: z.iso.datetime().nullable(),
        lastVerifiedAt: z.iso.datetime().nullable(),
      })
      .strict(),
    entries: z.array(publishedEntrySchema).min(1).max(512),
  })
  .strict();
export type PublicationContent = z.infer<typeof publicationContentSchema>;
export const organizationStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'paused',
  'superseded',
]);
export type OrganizationStatus = z.infer<typeof organizationStatusSchema>;
export interface PublicationStatus {
  readonly publicationId: string;
  readonly documentId: string;
  readonly snapshotId: string;
  readonly confirmedAt: string;
  readonly times: PublicationContent['times'];
  readonly entries: readonly {entryId: string; revision: number}[];
  readonly organization: {
    status: OrganizationStatus;
    version: number;
    errorCode: string | null;
  };
}
export interface PublicationCommit {
  readonly documentId: string;
  readonly snapshotId: string;
  readonly expectedIntakeVersion: number;
  readonly intake: IntakeRecordValue;
  readonly expectedEntries: readonly {entryId: string; revision: number}[];
}
export interface PublishedContentView {
  // Include hidden publications here as well, so legacy fallback cannot reveal drafts.
  readonly managedSnapshotIds: ReadonlySet<string>;
  readonly entries: readonly CurrentInformationEntry[];
}
export interface DocumentPublicationRepository {
  commit(
    input: PublicationCommit,
  ): Promise<
    | {status: 'published'; publication: PublicationStatus}
    | {status: 'stale' | 'not_admitted'}
  >;
  read(documentId: string): Promise<PublicationStatus | undefined>;
  forSnapshot?(snapshotId: string): Promise<PublicationStatus | undefined>;
  loadPublished(
    workspaceId: string,
    includePrivate: boolean,
  ): Promise<PublishedContentView>;
  /** Internal worker checkpoint only. Does not dispatch a model or authorize work. */
  transitionOrganization(input: {
    publicationId: string;
    expectedVersion: number;
    from: OrganizationStatus;
    to: OrganizationStatus;
    errorCode?: string;
  }): Promise<boolean>;
}
