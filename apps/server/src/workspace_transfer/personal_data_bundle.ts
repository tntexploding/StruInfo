import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';

import {
  createReviewPreferences,
  decodeEntryAutomationPolicy,
  decodeEntryPreferenceProfile,
  decodeReviewAssociationPolicyPreferences,
  decodeReviewAutomaticKeywordPreferences,
  decodeReviewExplorationPolicyPreferences,
  decodeReviewSourceSubscriptionPreferences,
  decodeReviewQuickTags,
  decodeReviewVocabularyPreferences,
  type ReviewPreferences,
} from '../storage/review_preferences_store.js';
import {
  decodeEntrySplitRuleProfile,
  type EntrySplitRuleProfile,
} from '../modules/entries/information_entry_split_rule.js';
import {
  BLOB_DIGEST_ALGORITHM,
  type BlobIdentity,
} from '../storage/blob_store.js';
import {
  normalizeJsonValue,
  type JsonObject,
  type JsonValue,
} from '../serialization/canonical_json.js';
import type {WorkspaceBundleSectionCodec} from './workspace_bundle.js';

export const PERSONAL_DATA_BUNDLE_SECTION_TYPE = 'struinfo.personal-data';
export const PERSONAL_DATA_BUNDLE_SECTION_VERSION = 1;
export const PERSONAL_DATA_BUNDLE_SCHEMA = 'struinfo.personal-data.v1';

const MAXIMUM_PERSONAL_BLOBS = 10_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface PortableBlob {
  readonly identity: Readonly<BlobIdentity>;
  readonly bytes: Uint8Array;
}

export interface PersonalDataBundleSection {
  readonly schemaVersion: typeof PERSONAL_DATA_BUNDLE_SCHEMA;
  readonly blobs: readonly Readonly<PortableBlob>[];
  readonly reviewPreferences: Readonly<ReviewPreferences>;
}

export const PERSONAL_DATA_BUNDLE_CODEC: WorkspaceBundleSectionCodec =
  Object.freeze({
    type: PERSONAL_DATA_BUNDLE_SECTION_TYPE,
    version: PERSONAL_DATA_BUNDLE_SECTION_VERSION,
    encode(value: unknown): unknown {
      const section = normalizePersonalDataBundleSection(value);
      return {
        schemaVersion: section.schemaVersion,
        blobs: section.blobs.map((blob) => ({
          algorithm: blob.identity.algorithm,
          digest: blob.identity.digest,
          byteLength: blob.identity.byteLength,
          bytesBase64: Buffer.from(blob.bytes).toString('base64'),
        })),
        reviewPreferences: section.reviewPreferences,
      };
    },
    decode(payload: JsonValue): unknown {
      return decodePersonalDataBundleSection(payload);
    },
  });

export function normalizePersonalDataBundleSection(
  value: unknown,
): Readonly<PersonalDataBundleSection> {
  if (!isRecord(value) || value.schemaVersion !== PERSONAL_DATA_BUNDLE_SCHEMA) {
    fail();
  }
  if (
    !Array.isArray(value.blobs) ||
    value.blobs.length > MAXIMUM_PERSONAL_BLOBS
  ) {
    fail();
  }
  const blobs = value.blobs.map((candidate) => {
    if (!isRecord(candidate) || !isRecord(candidate.identity)) fail();
    const identity = decodeIdentity(candidate.identity);
    if (!(candidate.bytes instanceof Uint8Array)) fail();
    const bytes = Uint8Array.from(candidate.bytes);
    assertBlobIntegrity(identity, bytes);
    return Object.freeze({identity, bytes});
  });
  blobs.sort((left, right) =>
    left.identity.digest.localeCompare(right.identity.digest),
  );
  assertUniqueBlobs(blobs);
  const reviewPreferences = decodePreferences(value.reviewPreferences);
  return Object.freeze({
    schemaVersion: PERSONAL_DATA_BUNDLE_SCHEMA,
    blobs: Object.freeze(blobs),
    reviewPreferences,
  });
}

function decodePersonalDataBundleSection(
  payload: JsonValue,
): Readonly<PersonalDataBundleSection> {
  const normalized = normalizeJsonValue(payload);
  const record = requireClosedObject(normalized, [
    'blobs',
    'reviewPreferences',
    'schemaVersion',
  ]);
  if (
    record.schemaVersion !== PERSONAL_DATA_BUNDLE_SCHEMA ||
    !isJsonArray(record.blobs)
  ) {
    fail();
  }
  const blobs = record.blobs.map((candidate) => {
    const blob = requireClosedObject(candidate, [
      'algorithm',
      'byteLength',
      'bytesBase64',
      'digest',
    ]);
    const identity = decodeIdentity(blob);
    if (typeof blob.bytesBase64 !== 'string') fail();
    const bytes = Buffer.from(blob.bytesBase64, 'base64');
    if (bytes.toString('base64') !== blob.bytesBase64) fail();
    const owned = Uint8Array.from(bytes);
    assertBlobIntegrity(identity, owned);
    return Object.freeze({identity, bytes: owned});
  });
  if (blobs.length > MAXIMUM_PERSONAL_BLOBS) fail();
  blobs.sort((left, right) =>
    left.identity.digest.localeCompare(right.identity.digest),
  );
  assertUniqueBlobs(blobs);
  const reviewPreferences = decodePreferences(record.reviewPreferences);
  return Object.freeze({
    schemaVersion: PERSONAL_DATA_BUNDLE_SCHEMA,
    blobs: Object.freeze(blobs),
    reviewPreferences,
  });
}

function decodeIdentity(
  value: Readonly<Record<string, unknown>>,
): BlobIdentity {
  if (
    value.algorithm !== BLOB_DIGEST_ALGORITHM ||
    typeof value.digest !== 'string' ||
    !SHA256_PATTERN.test(value.digest) ||
    typeof value.byteLength !== 'number' ||
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength < 0
  ) {
    fail();
  }
  return Object.freeze({
    algorithm: BLOB_DIGEST_ALGORITHM,
    digest: value.digest,
    byteLength: value.byteLength,
  });
}

function decodePreferences(value: unknown): Readonly<ReviewPreferences> {
  if (!isRecord(value)) fail();
  const quickTags = decodeReviewQuickTags(value.quickTags);
  const automaticKeywords = decodeReviewAutomaticKeywordPreferences(
    value.automaticKeywords,
  );
  const vocabulary = decodeReviewVocabularyPreferences(value.vocabulary);
  const associationPolicy =
    value.associationPolicy === undefined
      ? undefined
      : decodeReviewAssociationPolicyPreferences(value.associationPolicy);
  const explorationPolicy =
    value.explorationPolicy === undefined
      ? undefined
      : decodeReviewExplorationPolicyPreferences(value.explorationPolicy);
  const sourceSubscriptions =
    value.sourceSubscriptions === undefined
      ? undefined
      : decodeReviewSourceSubscriptionPreferences(value.sourceSubscriptions);
  const entryPreferenceProfile =
    value.entryPreferenceProfile === undefined
      ? undefined
      : decodeEntryPreferenceProfile(value.entryPreferenceProfile);
  const entryAutomationPolicy =
    value.entryAutomationPolicy === undefined
      ? undefined
      : decodeEntryAutomationPolicy(value.entryAutomationPolicy);
  const entrySplitRuleProfile: Readonly<EntrySplitRuleProfile> | undefined =
    value.entrySplitRuleProfile === undefined
      ? undefined
      : decodeEntrySplitRuleProfile(value.entrySplitRuleProfile);
  if (
    value.format !== 'struinfo.review-preferences' ||
    value.version !== 1 ||
    typeof value.workspaceId !== 'string' ||
    quickTags === undefined ||
    automaticKeywords === undefined ||
    vocabulary === undefined ||
    (value.associationPolicy !== undefined &&
      associationPolicy === undefined) ||
    (value.explorationPolicy !== undefined &&
      explorationPolicy === undefined) ||
    (value.sourceSubscriptions !== undefined &&
      sourceSubscriptions === undefined) ||
    (value.entryPreferenceProfile !== undefined &&
      entryPreferenceProfile === undefined) ||
    (value.entryAutomationPolicy !== undefined &&
      entryAutomationPolicy === undefined) ||
    (value.entrySplitRuleProfile !== undefined &&
      entrySplitRuleProfile === undefined)
  ) {
    fail();
  }
  return createReviewPreferences(
    value.workspaceId,
    quickTags,
    automaticKeywords,
    vocabulary,
    associationPolicy,
    explorationPolicy,
    sourceSubscriptions,
    entryPreferenceProfile,
    entryAutomationPolicy,
    entrySplitRuleProfile,
  );
}

function assertBlobIntegrity(
  identity: Readonly<BlobIdentity>,
  bytes: Uint8Array,
): void {
  if (
    bytes.byteLength !== identity.byteLength ||
    createHash('sha256').update(bytes).digest('hex') !== identity.digest
  ) {
    fail();
  }
}

function assertUniqueBlobs(blobs: readonly Readonly<PortableBlob>[]): void {
  for (let index = 1; index < blobs.length; index += 1) {
    if (blobs[index - 1]?.identity.digest === blobs[index]?.identity.digest) {
      fail();
    }
  }
}

function requireClosedObject(
  value: JsonValue | undefined,
  expectedKeys: readonly string[],
): JsonObject {
  if (
    value === undefined ||
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    fail();
  }
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    fail();
  }
  return value as JsonObject;
}

function isJsonArray(
  value: JsonValue | undefined,
): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(): never {
  throw new Error('The personal-data Bundle section is invalid.');
}
