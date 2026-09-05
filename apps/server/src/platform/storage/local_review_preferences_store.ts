import {
  DEFAULT_ENTRY_SAVED_QUERIES,
  decodeEntrySavedQueries,
  type EntrySavedQueries,
} from '../../modules/entries/information_entry_saved_queries.js';
import {randomUUID} from 'node:crypto';
import {lstat, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {
  decodeEntrySplitRuleProfile,
  DEFAULT_ENTRY_SPLIT_RULE_PROFILE,
  type EntrySplitRuleProfile,
} from '../../modules/entries/information_entry_split_rule.js';
import {
  decodeEntryClassificationProfile,
  DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
  type EntryClassificationProfile,
} from '../../modules/entries/information_entry_deterministic_classification.js';

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
  DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
  DEFAULT_ENTRY_AUTOMATION_POLICY,
  DEFAULT_ENTRY_PREFERENCE_PROFILE,
  DEFAULT_REVIEW_EXPLORATION_POLICY_PREFERENCES,
  DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
  DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
  REVIEW_PREFERENCES_FORMAT,
  REVIEW_PREFERENCES_VERSION,
  ReviewPreferencesStoreError,
  type ReviewPreferences,
  type EntryAutomationPolicy,
  type EntryPreferenceProfile,
  type ReviewAssociationPolicyPreferences,
  type ReviewAutomaticKeywordPreferences,
  type ReviewExplorationPolicyPreferences,
  type ReviewPreferencesStore,
  type ReviewPreferencesUpdater,
  type ReviewPreferencesUpdateResult,
  type ReviewSourceSubscriptionPreferences,
  type ReviewVocabularyPreferences,
} from '../../storage/review_preferences_store.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAXIMUM_PREFERENCES_FILE_BYTES = 512 * 1024;

/** Workspace-scoped personal UI preferences under the external data root. */
export class LocalReviewPreferencesStore implements ReviewPreferencesStore {
  readonly #preferencesRoot: string;
  readonly #writeTails = new Map<string, Promise<void>>();
  readonly #restoreAttempts = new Map<string, {active: boolean}>();

  public constructor(preferencesRoot: string) {
    this.#preferencesRoot = preferencesRoot;
  }

  public async load(workspaceId: string): Promise<Readonly<ReviewPreferences>> {
    validateWorkspaceId(workspaceId);
    const attempt = this.#restoreAttempts.get(workspaceId);
    this.#assertRestoreAvailable(workspaceId, attempt);
    const preferences = await this.#loadUnlocked(workspaceId);
    this.#assertRestoreAvailable(workspaceId, attempt);
    return preferences;
  }

  async #loadUnlocked(
    workspaceId: string,
  ): Promise<Readonly<ReviewPreferences>> {
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
    sourceSubscriptions: Readonly<ReviewSourceSubscriptionPreferences> = DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
    entryPreferenceProfile: Readonly<EntryPreferenceProfile> = DEFAULT_ENTRY_PREFERENCE_PROFILE,
    entryAutomationPolicy: Readonly<EntryAutomationPolicy> = DEFAULT_ENTRY_AUTOMATION_POLICY,
    entrySplitRuleProfile: Readonly<EntrySplitRuleProfile> = DEFAULT_ENTRY_SPLIT_RULE_PROFILE,
    entryClassificationProfile: Readonly<EntryClassificationProfile> = DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
    entrySavedQueries: Readonly<EntrySavedQueries> = DEFAULT_ENTRY_SAVED_QUERIES,
  ): Promise<Readonly<ReviewPreferences>> {
    validateWorkspaceId(workspaceId);
    const attempt = this.#restoreAttempts.get(workspaceId);
    this.#assertRestoreAvailable(workspaceId, attempt);
    return this.#serializeWrite(workspaceId, () => {
      this.#assertRestoreAvailable(workspaceId, attempt);
      return this.#saveUnlocked(
        workspaceId,
        quickTags,
        automaticKeywords,
        vocabulary,
        associationPolicy,
        explorationPolicy,
        sourceSubscriptions,
        entryPreferenceProfile,
        entryAutomationPolicy,
        entrySplitRuleProfile,
        entryClassificationProfile,
        entrySavedQueries,
      );
    });
  }

  public async update<T>(
    workspaceId: string,
    updater: ReviewPreferencesUpdater<T>,
  ): Promise<Readonly<ReviewPreferencesUpdateResult<T>>> {
    validateWorkspaceId(workspaceId);
    const attempt = this.#restoreAttempts.get(workspaceId);
    this.#assertRestoreAvailable(workspaceId, attempt);
    return this.#serializeWrite(workspaceId, async () => {
      this.#assertRestoreAvailable(workspaceId, attempt);
      const current = await this.#loadUnlocked(workspaceId);
      const update = updater(current);
      if (update.next.workspaceId !== workspaceId) throw invalid();
      const preferences =
        update.next === current
          ? current
          : await this.#savePreferencesUnlocked(workspaceId, update.next);
      return Object.freeze({preferences, result: update.result});
    });
  }

  public async replaceForRestore<T>(
    workspaceId: string,
    replacement: Readonly<ReviewPreferences>,
    restore: () => Promise<T>,
  ): Promise<T> {
    validateWorkspaceId(workspaceId);
    if (replacement.workspaceId !== workspaceId) throw invalid();
    const previousAttempt = this.#restoreAttempts.get(workspaceId);
    this.#assertRestoreAvailable(workspaceId, previousAttempt);
    return this.#serializeWrite(workspaceId, async () => {
      this.#assertRestoreAvailable(workspaceId, previousAttempt);
      const attempt = {active: true};
      this.#restoreAttempts.set(workspaceId, attempt);
      try {
        const previous = await this.#loadUnlocked(workspaceId);
        await this.#savePreferencesUnlocked(workspaceId, replacement);
        try {
          return await restore();
        } catch (error) {
          await this.#savePreferencesUnlocked(workspaceId, previous);
          throw error;
        }
      } finally {
        attempt.active = false;
      }
    });
  }

  #assertRestoreAvailable(
    workspaceId: string,
    expected: {active: boolean} | undefined,
  ): void {
    const current = this.#restoreAttempts.get(workspaceId);
    // Reject instead of waiting: a caller may already hold the database workspace lock.
    if (current?.active === true || current !== expected) throw unavailable();
  }

  #savePreferencesUnlocked(
    workspaceId: string,
    preferences: Readonly<ReviewPreferences>,
  ): Promise<Readonly<ReviewPreferences>> {
    return this.#saveUnlocked(
      workspaceId,
      preferences.quickTags,
      preferences.automaticKeywords ??
        DEFAULT_REVIEW_AUTOMATIC_KEYWORD_PREFERENCES,
      preferences.vocabulary ?? DEFAULT_REVIEW_VOCABULARY_PREFERENCES,
      preferences.associationPolicy,
      preferences.explorationPolicy,
      preferences.sourceSubscriptions ??
        DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES,
      preferences.entryPreferenceProfile ?? DEFAULT_ENTRY_PREFERENCE_PROFILE,
      preferences.entryAutomationPolicy ?? DEFAULT_ENTRY_AUTOMATION_POLICY,
      preferences.entrySplitRuleProfile ?? DEFAULT_ENTRY_SPLIT_RULE_PROFILE,
      preferences.entryClassificationProfile ??
        DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
      preferences.entrySavedQueries ?? DEFAULT_ENTRY_SAVED_QUERIES,
    );
  }

  async #saveUnlocked(
    workspaceId: string,
    quickTags: readonly string[],
    automaticKeywords: Readonly<ReviewAutomaticKeywordPreferences>,
    vocabulary: Readonly<ReviewVocabularyPreferences>,
    associationPolicy: Readonly<ReviewAssociationPolicyPreferences> | undefined,
    explorationPolicy: Readonly<ReviewExplorationPolicyPreferences> | undefined,
    sourceSubscriptions: Readonly<ReviewSourceSubscriptionPreferences>,
    entryPreferenceProfile: Readonly<EntryPreferenceProfile>,
    entryAutomationPolicy: Readonly<EntryAutomationPolicy>,
    entrySplitRuleProfile: Readonly<EntrySplitRuleProfile>,
    entryClassificationProfile: Readonly<EntryClassificationProfile>,
    entrySavedQueries: Readonly<EntrySavedQueries>,
  ): Promise<Readonly<ReviewPreferences>> {
    const savedQueries = decodeEntrySavedQueries(entrySavedQueries);
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
    const decodedSourceSubscriptions =
      decodeReviewSourceSubscriptionPreferences(sourceSubscriptions);
    const decodedEntryPreferenceProfile = decodeEntryPreferenceProfile(
      entryPreferenceProfile,
    );
    const decodedEntryAutomationPolicy = decodeEntryAutomationPolicy(
      entryAutomationPolicy,
    );
    const decodedEntrySplitRuleProfile = decodeEntrySplitRuleProfile(
      entrySplitRuleProfile,
    );
    const decodedEntryClassificationProfile = decodeEntryClassificationProfile(
      entryClassificationProfile,
    );
    if (
      savedQueries === undefined ||
      decoded === undefined ||
      decodedAutomaticKeywords === undefined ||
      decodedVocabulary === undefined ||
      (associationPolicy !== undefined &&
        decodedAssociationPolicy === undefined) ||
      (explorationPolicy !== undefined &&
        decodedExplorationPolicy === undefined) ||
      decodedSourceSubscriptions === undefined ||
      decodedEntryPreferenceProfile === undefined ||
      decodedEntryAutomationPolicy === undefined ||
      decodedEntrySplitRuleProfile === undefined ||
      decodedEntryClassificationProfile === undefined
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
      decodedSourceSubscriptions,
      decodedEntryPreferenceProfile,
      decodedEntryAutomationPolicy,
      decodedEntrySplitRuleProfile,
      decodedEntryClassificationProfile,
      savedQueries,
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

  async #serializeWrite<T>(
    workspaceId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#writeTails.get(workspaceId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.#writeTails.set(workspaceId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.#writeTails.get(workspaceId) === tail) {
        this.#writeTails.delete(workspaceId);
      }
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
  const savedQueries =
    value.entrySavedQueries === undefined
      ? DEFAULT_ENTRY_SAVED_QUERIES
      : decodeEntrySavedQueries(value.entrySavedQueries);
  if (savedQueries === undefined) throw invalid();
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
  const sourceSubscriptions =
    value.sourceSubscriptions === undefined
      ? DEFAULT_REVIEW_SOURCE_SUBSCRIPTION_PREFERENCES
      : decodeReviewSourceSubscriptionPreferences(value.sourceSubscriptions);
  const entryPreferenceProfile =
    value.entryPreferenceProfile === undefined
      ? DEFAULT_ENTRY_PREFERENCE_PROFILE
      : decodeEntryPreferenceProfile(value.entryPreferenceProfile);
  const entryAutomationPolicy =
    value.entryAutomationPolicy === undefined
      ? DEFAULT_ENTRY_AUTOMATION_POLICY
      : decodeEntryAutomationPolicy(value.entryAutomationPolicy);
  const entrySplitRuleProfile =
    value.entrySplitRuleProfile === undefined
      ? DEFAULT_ENTRY_SPLIT_RULE_PROFILE
      : decodeEntrySplitRuleProfile(value.entrySplitRuleProfile);
  const entryClassificationProfile =
    value.entryClassificationProfile === undefined
      ? DEFAULT_ENTRY_CLASSIFICATION_PROFILE
      : decodeEntryClassificationProfile(value.entryClassificationProfile);
  if (
    value.associationPolicy !== undefined &&
    associationPolicy === undefined
  ) {
    throw invalid();
  }
  if (
    explorationPolicy === undefined ||
    sourceSubscriptions === undefined ||
    entryPreferenceProfile === undefined ||
    entryAutomationPolicy === undefined ||
    entrySplitRuleProfile === undefined ||
    entryClassificationProfile === undefined
  )
    throw invalid();
  return createReviewPreferences(
    workspaceId,
    quickTags,
    automaticKeywords,
    vocabulary,
    associationPolicy,
    explorationPolicy,
    sourceSubscriptions,
    entryPreferenceProfile,
    entryAutomationPolicy,
    entrySplitRuleProfile,
    entryClassificationProfile,
    savedQueries,
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
