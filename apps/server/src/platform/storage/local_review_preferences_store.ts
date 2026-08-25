import {randomUUID} from 'node:crypto';
import {lstat, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {
  createReviewPreferences,
  decodeReviewAssociationPolicyPreferences,
  decodeReviewAutomaticKeywordPreferences,
  decodeReviewExplorationPolicyPreferences,
  decodeReviewQuickTags,
  decodeReviewVocabularyPreferences,
  DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
  DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES,
  DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
  REVIEW_PREFERENCES_FORMAT,
  REVIEW_PREFERENCES_VERSION,
  ReviewPreferencesStoreError,
  type ReviewPreferences,
  type ReviewAssociationPolicyPreferences,
  type ReviewAutomaticKeywordPreferences,
  type ReviewExplorationPolicyPreferences,
  type ReviewPreferencesStore,
  type ReviewVocabularyPreferences,
} from '../../storage/review_preferences_store.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAXIMUM_PREFERENCES_FILE_BYTES = 512 * 1024;

/** Workspace-scoped personal UI preferences under the external data root. */
export class LocalReviewPreferencesStore implements ReviewPreferencesStore {
  readonly #preferencesRoot: string;

  public constructor(preferencesRoot: string) {
    this.#preferencesRoot = preferencesRoot;
  }

  public async load(workspaceId: string): Promise<Readonly<ReviewPreferences>> {
    validateWorkspaceId(workspaceId);
    const path = this.#path(workspaceId);
    let status;
    try {
      status = await lstat(path);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        return createReviewPreferences(
          workspaceId,
          [],
          DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
          DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
        );
      }
      throw unavailable();
    }
    if (
      status.isSymbolicLink() ||
      !status.isFile() ||
      status.size > MAXIMUM_PREFERENCES_FILE_BYTES
    ) {
      throw invalid();
    }
    try {
      const bytes = await readFile(path);
      if (bytes.byteLength !== status.size) throw invalid();
      const parsed = JSON.parse(
        new TextDecoder('utf-8', {fatal: true}).decode(bytes),
      ) as unknown;
      return decodePreferences(parsed, workspaceId);
    } catch (error) {
      if (error instanceof ReviewPreferencesStoreError) throw error;
      throw invalid();
    }
  }

  public async save(
    workspaceId: string,
    quickTags: readonly string[],
    automaticKeywords: Readonly<ReviewAutomaticKeywordPreferences> = DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
    vocabulary: Readonly<ReviewVocabularyPreferences> = DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
    associationPolicy?: Readonly<ReviewAssociationPolicyPreferences>,
    explorationPolicy?: Readonly<ReviewExplorationPolicyPreferences>,
  ): Promise<Readonly<ReviewPreferences>> {
    validateWorkspaceId(workspaceId);
    const decoded = decodeReviewQuickTags(quickTags);
    const decodedAutomaticKeywords =
      decodeReviewAutomaticKeywordPreferences(automaticKeywords);
    const decodedVocabulary = decodeReviewVocabularyPreferences(vocabulary);
    const decodedAssociationPolicy =
      associationPolicy === undefined
        ? undefined
        : decodeReviewAssociationPolicyPreferences(associationPolicy);
    const decodedExplorationPolicy =
      explorationPolicy === undefined
        ? undefined
        : decodeReviewExplorationPolicyPreferences(explorationPolicy);
    if (
      decoded === undefined ||
      decodedAutomaticKeywords === undefined ||
      decodedVocabulary === undefined ||
      (associationPolicy !== undefined &&
        decodedAssociationPolicy === undefined) ||
      (explorationPolicy !== undefined &&
        decodedExplorationPolicy === undefined)
    ) {
      throw invalid();
    }
    const preferences = createReviewPreferences(
      workspaceId,
      decoded,
      decodedAutomaticKeywords,
      decodedVocabulary,
      decodedAssociationPolicy,
      decodedExplorationPolicy,
    );
    const bytes = new TextEncoder().encode(
      `${JSON.stringify(preferences, undefined, 2)}\n`,
    );
    if (bytes.byteLength > MAXIMUM_PREFERENCES_FILE_BYTES) throw invalid();
    const temporaryPath = join(
      this.#preferencesRoot,
      `.${workspaceId}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporaryPath, bytes, {flag: 'wx', mode: 0o600});
      await replaceFile(temporaryPath, this.#path(workspaceId));
      return preferences;
    } catch (error) {
      await removeIfPresent(temporaryPath);
      if (error instanceof ReviewPreferencesStoreError) throw error;
      throw unavailable();
    }
  }

  #path(workspaceId: string): string {
    return join(
      this.#preferencesRoot,
      `${workspaceId}.review-preferences.json`,
    );
  }
}

function decodePreferences(
  value: unknown,
  workspaceId: string,
): Readonly<ReviewPreferences> {
  if (
    !isRecord(value) ||
    value.format !== REVIEW_PREFERENCES_FORMAT ||
    value.version !== REVIEW_PREFERENCES_VERSION ||
    value.workspaceId !== workspaceId
  ) {
    throw invalid();
  }
  const quickTags = decodeReviewQuickTags(value.quickTags);
  if (quickTags === undefined) throw invalid();
  const automaticKeywords =
    value.automaticKeywords === undefined
      ? DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES
      : decodeReviewAutomaticKeywordPreferences(value.automaticKeywords);
  if (automaticKeywords === undefined) throw invalid();
  const vocabulary =
    value.vocabulary === undefined
      ? DEFAULT_REVIEW_VOCABULARY_PREFERENCES
      : decodeReviewVocabularyPreferences(value.vocabulary);
  if (vocabulary === undefined) throw invalid();
  const associationPolicy =
    value.associationPolicy === undefined
      ? undefined
      : decodeReviewAssociationPolicyPreferences(value.associationPolicy);
  const explorationPolicy =
    value.explorationPolicy === undefined
      ? DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES
      : decodeReviewExplorationPolicyPreferences(value.explorationPolicy);
  if (
    value.associationPolicy !== undefined &&
    associationPolicy === undefined
  ) {
    throw invalid();
  }
  if (explorationPolicy === undefined) throw invalid();
  return createReviewPreferences(
    workspaceId,
    quickTags,
    automaticKeywords,
    vocabulary,
    associationPolicy,
    explorationPolicy,
  );
}

async function replaceFile(source: string, target: string): Promise<void> {
  try {
    await rename(source, target);
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST') && !hasErrorCode(error, 'EPERM')) {
      throw error;
    }
    await removeIfPresent(target);
    await rename(source, target);
  }
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
}

function validateWorkspaceId(workspaceId: string): void {
  if (!CANONICAL_UUID.test(workspaceId)) throw invalid();
}

function invalid(): ReviewPreferencesStoreError {
  return new ReviewPreferencesStoreError(
    'preferences_invalid',
    'The review preferences file is invalid.',
  );
}

function unavailable(): ReviewPreferencesStoreError {
  return new ReviewPreferencesStoreError('preferences_unavailable');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === code
  );
}
