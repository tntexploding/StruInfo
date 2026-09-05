import {createHash} from 'node:crypto';

import {encodeCanonicalJson} from '../../serialization/canonical_json.js';
import {
  cloneEntryTypeLearningState,
  DEFAULT_ENTRY_CLASSIFICATION_PROFILE,
  DEFAULT_ENTRY_TYPE_LEARNING_STATE,
  entryTypeLearningModelsEqual,
  ENTRY_CLASSIFICATION_PROFILE_VERSION,
  ENTRY_TYPE_KEYWORDS,
  isEntryTypeLearningModelActivationEligible,
  MAXIMUM_ENTRY_TYPE_LEARNING_CANDIDATES,
  MAXIMUM_ENTRY_TYPE_TRUSTED_EXAMPLES,
  selectEntryTypeLearningCandidates,
  trainEntryTypeLearningModel,
  type EntryClassificationProfile,
  type EntryTypeTrustedExample,
  type InformationEntryRepositoryPort,
  type LearnedEntryTypeKeyword,
} from '../entries/index.js';
import {
  patchReviewPreferences,
  updateReviewPreferences,
  type ReviewPreferencesStore,
} from '../../storage/review_preferences_store.js';
import {
  BULK_INGESTION_CODEX_PACKET_MAXIMUM_BYTES,
  BULK_INGESTION_CODEX_RESULT_MAXIMUM_BYTES,
} from './bulk_ingestion_codex_review_contract.js';
import {
  ENTRY_TYPE_LEARNING_CODEX_MAXIMUM_ITEMS,
  ENTRY_TYPE_LEARNING_CODEX_PACKET_SCHEMA,
  ENTRY_TYPE_LEARNING_CODEX_RESULT_SCHEMA,
  type ActivateEntryTypeLearningResult,
  type ApplyEntryTypeLearningCodexResult,
  type EntryTypeLearningCodexDecision,
  type EntryTypeLearningCodexFileStorePort,
  type EntryTypeLearningCodexPacket,
  type EntryTypeLearningCodexPacketItem,
  type EntryTypeLearningCodexResult,
  type ExportEntryTypeLearningCodexRequest,
  type ExportEntryTypeLearningCodexResult,
} from './entry_type_learning_codex_contract.js';
import {deriveProcessingRunId} from './processing_identity.js';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const LEARNED_TYPES = ENTRY_TYPE_KEYWORDS.filter(
  (keyword): keyword is LearnedEntryTypeKeyword => keyword !== 'other',
);

export type EntryTypeLearningCodexServiceErrorCode =
  | 'input_invalid'
  | 'packet_invalid'
  | 'result_invalid'
  | 'entry_stale'
  | 'profile_capacity_exceeded'
  | 'storage_failed';

export class EntryTypeLearningCodexServiceError extends Error {
  public readonly code: EntryTypeLearningCodexServiceErrorCode;

  public constructor(code: EntryTypeLearningCodexServiceErrorCode) {
    super('The Entry type-learning work operation failed.');
    this.name = 'EntryTypeLearningCodexServiceError';
    this.code = code;
  }
}

export interface EntryTypeLearningCodexServiceDependencies {
  readonly workspaceId: string;
  readonly entries: Pick<
    InformationEntryRepositoryPort,
    'loadCurrentEntries' | 'loadCurrentEntriesByIds'
  >;
  readonly preferences: ReviewPreferencesStore;
  readonly fileStore: EntryTypeLearningCodexFileStorePort;
}

type ApplyProfileUpdate =
  | Readonly<{outcome: 'stale'}>
  | Readonly<{
      outcome: 'applied';
      profileRevision: number;
      trustedExampleCount: number;
      evaluation?: Readonly<
        NonNullable<ApplyEntryTypeLearningCodexResult['evaluation']>
      >;
    }>;

type ActivateProfileUpdate =
  | Readonly<{outcome: 'stale' | 'not_eligible'}>
  | Readonly<{
      outcome: 'activated';
      profileRevision: number;
      trainingDigest: string;
    }>;

export class EntryTypeLearningCodexService {
  readonly #dependencies: Readonly<EntryTypeLearningCodexServiceDependencies>;

  public constructor(
    dependencies: Readonly<EntryTypeLearningCodexServiceDependencies>,
  ) {
    if (!CANONICAL_UUID.test(dependencies.workspaceId)) {
      throw new EntryTypeLearningCodexServiceError('input_invalid');
    }
    this.#dependencies = dependencies;
  }

  public async export(
    request: Readonly<ExportEntryTypeLearningCodexRequest>,
  ): Promise<Readonly<ExportEntryTypeLearningCodexResult>> {
    if (
      typeof request.includePrivate !== 'boolean' ||
      !Number.isSafeInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > ENTRY_TYPE_LEARNING_CODEX_MAXIMUM_ITEMS
    ) {
      throw new EntryTypeLearningCodexServiceError('input_invalid');
    }
    const [preferences, entries] = await Promise.all([
      this.#dependencies.preferences.load(this.#dependencies.workspaceId),
      this.#dependencies.entries.loadCurrentEntries(
        this.#dependencies.workspaceId,
        request.includePrivate,
      ),
    ]);
    const profile =
      preferences.entryClassificationProfile ??
      DEFAULT_ENTRY_CLASSIFICATION_PROFILE;
    const state = profile.typeLearning ?? DEFAULT_ENTRY_TYPE_LEARNING_STATE;
    const candidates = selectEntryTypeLearningCandidates(entries, state, {
      includePrivate: request.includePrivate,
      limit: Math.min(request.limit, MAXIMUM_ENTRY_TYPE_LEARNING_CANDIDATES),
    });
    if (candidates.length === 0) return Object.freeze({outcome: 'empty'});
    const items = Object.freeze(
      candidates.map((candidate, index) =>
        Object.freeze({
          ordinal: index,
          reason: candidate.reason,
          snapshotId: candidate.entry.snapshotId,
          isPrivate: candidate.entry.value.isPrivate,
          entryId: candidate.entry.entryId,
          entryRevision: candidate.entry.revision,
          entryRevisionId: candidate.entry.revisionId,
          titlePath: candidate.entry.value.titlePath,
          body: candidate.entry.value.body,
          contentKeywords: Object.freeze(
            candidate.entry.value.contentKeywords.map(
              (keyword) => keyword.displayValue,
            ),
          ),
          ...(candidate.entry.value.typeKeyword === undefined
            ? {}
            : {currentTypeKeyword: candidate.entry.value.typeKeyword}),
          ...(candidate.targetTypeKeyword === undefined
            ? {}
            : {targetTypeKeyword: candidate.targetTypeKeyword}),
        }),
      ),
    );
    const content = Object.freeze({
      schemaVersion: ENTRY_TYPE_LEARNING_CODEX_PACKET_SCHEMA,
      workspaceId: this.#dependencies.workspaceId,
      expectedProfileRevision: profile.revision,
      includePrivate: request.includePrivate,
      items,
    });
    const packetSha256 = digestCanonical(content);
    const packetId = deriveProcessingRunId(
      this.#dependencies.workspaceId,
      'm2-p4-type-learning:' + packetSha256,
    );
    const packet: Readonly<EntryTypeLearningCodexPacket> = Object.freeze({
      ...content,
      packetId,
      packetSha256,
    });
    try {
      const stored = await this.#dependencies.fileStore.writePackage({
        packetId,
        packetBytes: encodeCanonicalJson(
          packet,
          BULK_INGESTION_CODEX_PACKET_MAXIMUM_BYTES,
        ),
        resultTemplateBytes: encodeCanonicalJson(
          resultTemplate(packet),
          BULK_INGESTION_CODEX_RESULT_MAXIMUM_BYTES,
        ),
      });
      return Object.freeze({
        outcome: stored.outcome,
        packetId,
        packetSha256,
        itemCount: items.length,
        privateItemCount: items.filter((item) => item.isPrivate).length,
        packetFileName: stored.packetFileName,
        resultFileName: stored.resultFileName,
        packetByteLength: stored.packetByteLength,
        packetFileSha256: stored.packetFileSha256,
      });
    } catch {
      throw new EntryTypeLearningCodexServiceError('storage_failed');
    }
  }

  public async apply(
    packetId: string,
  ): Promise<Readonly<ApplyEntryTypeLearningCodexResult>> {
    if (!CANONICAL_UUID.test(packetId)) {
      throw new EntryTypeLearningCodexServiceError('input_invalid');
    }
    let packetBytes: Uint8Array;
    let resultBytes: Uint8Array;
    try {
      [packetBytes, resultBytes] = await Promise.all([
        this.#dependencies.fileStore.readPacket(packetId),
        this.#dependencies.fileStore.readResult(packetId),
      ]);
    } catch {
      throw new EntryTypeLearningCodexServiceError('storage_failed');
    }
    const packet = decodePacket(packetBytes);
    if (
      packet?.packetId !== packetId ||
      packet.workspaceId !== this.#dependencies.workspaceId ||
      packet.packetId !== expectedPacketId(packet) ||
      !packetDigestMatches(packet)
    ) {
      throw new EntryTypeLearningCodexServiceError('packet_invalid');
    }
    const result = decodeResult(resultBytes, packet);
    if (result === undefined) {
      throw new EntryTypeLearningCodexServiceError('result_invalid');
    }
    const currentEntries = await this.#dependencies.entries.loadCurrentEntries(
      this.#dependencies.workspaceId,
      packet.includePrivate,
    );
    const entryById = new Map(
      currentEntries.map((entry) => [entry.entryId, entry]),
    );
    for (const item of packet.items) {
      const entry = entryById.get(item.entryId);
      if (
        entry?.revision !== item.entryRevision ||
        entry.revisionId !== item.entryRevisionId ||
        entry.snapshotId !== item.snapshotId ||
        entry.value.isPrivate !== item.isPrivate
      ) {
        throw new EntryTypeLearningCodexServiceError('entry_stale');
      }
    }

    const accepted = result.decisions.filter(
      (
        decision,
      ): decision is Extract<
        EntryTypeLearningCodexDecision,
        {action: 'trust'}
      > => decision.action === 'trust',
    );
    const update = await updateReviewPreferences<ApplyProfileUpdate>(
      this.#dependencies.preferences,
      this.#dependencies.workspaceId,
      (current) => {
        const profile =
          current.entryClassificationProfile ??
          DEFAULT_ENTRY_CLASSIFICATION_PROFILE;
        if (profile.revision !== packet.expectedProfileRevision) {
          return Object.freeze({
            next: current,
            result: Object.freeze({outcome: 'stale' as const}),
          });
        }
        const previous =
          profile.typeLearning ?? DEFAULT_ENTRY_TYPE_LEARNING_STATE;
        const incoming = accepted.map((decision) => {
          const item = packet.items.find(
            (candidate) => candidate.entryId === decision.entryId,
          );
          return Object.freeze({
            entryId: decision.entryId,
            entryRevision: decision.entryRevision,
            snapshotId: item?.snapshotId ?? '',
            typeKeyword: decision.typeKeyword,
            authority: decision.authority,
          });
        });
        const merged = mergeExamples(previous.trustedExamples, incoming);
        if (merged.length > MAXIMUM_ENTRY_TYPE_TRUSTED_EXAMPLES) {
          throw new EntryTypeLearningCodexServiceError(
            'profile_capacity_exceeded',
          );
        }
        const candidateModel = trainEntryTypeLearningModel(
          merged,
          currentEntries,
          {includePrivate: packet.includePrivate},
        );
        const nextProfile: Readonly<EntryClassificationProfile> = Object.freeze(
          {
            ...profile,
            version: ENTRY_CLASSIFICATION_PROFILE_VERSION,
            revision: profile.revision + 1,
            typeLearning: cloneEntryTypeLearningState({
              trustedExamples: merged,
              ...(candidateModel === undefined ? {} : {candidateModel}),
              ...(previous.activeModel === undefined
                ? {}
                : {activeModel: previous.activeModel}),
            }),
          },
        );
        return Object.freeze({
          next: patchReviewPreferences(current, {
            entryClassificationProfile: nextProfile,
          }),
          result: Object.freeze({
            outcome: 'applied' as const,
            profileRevision: nextProfile.revision,
            trustedExampleCount: merged.length,
            ...(candidateModel === undefined
              ? {}
              : {evaluation: candidateModel.evaluation}),
          }),
        });
      },
    );
    if (update.result.outcome === 'stale') {
      const profile =
        update.preferences.entryClassificationProfile ??
        DEFAULT_ENTRY_CLASSIFICATION_PROFILE;
      return Object.freeze({
        outcome: 'stale',
        profileRevision: profile.revision,
        trustedExampleCount: profile.typeLearning?.trustedExamples.length ?? 0,
        acceptedCount: 0,
        rejectedCount: 0,
      });
    }
    return Object.freeze({
      outcome: 'applied',
      profileRevision: update.result.profileRevision,
      trustedExampleCount: update.result.trustedExampleCount,
      acceptedCount: accepted.length,
      rejectedCount: result.decisions.length - accepted.length,
      ...(update.result.evaluation === undefined
        ? {}
        : {evaluation: update.result.evaluation}),
    });
  }

  public async activate(
    expectedProfileRevision: number,
  ): Promise<Readonly<ActivateEntryTypeLearningResult>> {
    if (
      !Number.isSafeInteger(expectedProfileRevision) ||
      expectedProfileRevision < 0
    ) {
      throw new EntryTypeLearningCodexServiceError('input_invalid');
    }
    const currentEntries = await this.#dependencies.entries.loadCurrentEntries(
      this.#dependencies.workspaceId,
      true,
    );
    const update = await updateReviewPreferences<ActivateProfileUpdate>(
      this.#dependencies.preferences,
      this.#dependencies.workspaceId,
      (current) => {
        const profile =
          current.entryClassificationProfile ??
          DEFAULT_ENTRY_CLASSIFICATION_PROFILE;
        if (profile.revision !== expectedProfileRevision) {
          return Object.freeze({
            next: current,
            result: Object.freeze({outcome: 'stale' as const}),
          });
        }
        const state = profile.typeLearning ?? DEFAULT_ENTRY_TYPE_LEARNING_STATE;
        const candidate = state.candidateModel;
        if (
          candidate === undefined ||
          !isEntryTypeLearningModelActivationEligible(candidate)
        ) {
          return Object.freeze({
            next: current,
            result: Object.freeze({outcome: 'not_eligible' as const}),
          });
        }
        const refreshed = trainEntryTypeLearningModel(
          state.trustedExamples,
          currentEntries,
          {
            includePrivate:
              candidate.evaluation.projection?.includePrivate ?? false,
          },
        );
        if (
          !isEntryTypeLearningModelActivationEligible(refreshed) ||
          !entryTypeLearningModelsEqual(candidate, refreshed)
        ) {
          return Object.freeze({
            next: current,
            result: Object.freeze({outcome: 'not_eligible' as const}),
          });
        }
        const nextProfile: Readonly<EntryClassificationProfile> = Object.freeze(
          {
            ...profile,
            version: ENTRY_CLASSIFICATION_PROFILE_VERSION,
            revision: profile.revision + 1,
            typeLearning: cloneEntryTypeLearningState({
              ...state,
              activeModel: candidate,
            }),
          },
        );
        return Object.freeze({
          next: patchReviewPreferences(current, {
            entryClassificationProfile: nextProfile,
          }),
          result: Object.freeze({
            outcome: 'activated' as const,
            profileRevision: nextProfile.revision,
            trainingDigest: candidate.trainingDigest,
          }),
        });
      },
    );
    const profile =
      update.preferences.entryClassificationProfile ??
      DEFAULT_ENTRY_CLASSIFICATION_PROFILE;
    return update.result.outcome === 'activated'
      ? update.result
      : Object.freeze({
          outcome: update.result.outcome,
          profileRevision: profile.revision,
        });
  }
}

function resultTemplate(packet: Readonly<EntryTypeLearningCodexPacket>) {
  return Object.freeze({
    schemaVersion: ENTRY_TYPE_LEARNING_CODEX_RESULT_SCHEMA,
    packetId: packet.packetId,
    packetSha256: packet.packetSha256,
    decisions: Object.freeze(
      packet.items.map((item) =>
        Object.freeze({
          entryId: item.entryId,
          entryRevision: item.entryRevision,
          entryRevisionId: item.entryRevisionId,
          action: 'replace_me',
          authority: 'replace_me',
          typeKeyword: item.currentTypeKeyword ?? 'replace_me',
        }),
      ),
    ),
  });
}

function decodePacket(
  bytes: Uint8Array,
): Readonly<EntryTypeLearningCodexPacket> | undefined {
  const value = parseJson(bytes);
  if (
    !isRecord(value) ||
    !closedKeys(value, [
      'schemaVersion',
      'packetId',
      'packetSha256',
      'workspaceId',
      'expectedProfileRevision',
      'includePrivate',
      'items',
    ]) ||
    value.schemaVersion !== ENTRY_TYPE_LEARNING_CODEX_PACKET_SCHEMA ||
    !CANONICAL_UUID.test(value.packetId as string) ||
    typeof value.packetSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(value.packetSha256) ||
    !CANONICAL_UUID.test(value.workspaceId as string) ||
    !Number.isSafeInteger(value.expectedProfileRevision) ||
    (value.expectedProfileRevision as number) < 0 ||
    (value.includePrivate !== true && value.includePrivate !== false) ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > ENTRY_TYPE_LEARNING_CODEX_MAXIMUM_ITEMS
  ) {
    return undefined;
  }
  const items: EntryTypeLearningCodexPacketItem[] = [];
  const ids = new Set<string>();
  for (const candidate of value.items) {
    const item = decodePacketItem(candidate);
    if (item === undefined || ids.has(item.entryId)) return undefined;
    ids.add(item.entryId);
    items.push(item);
  }
  return Object.freeze({
    schemaVersion: ENTRY_TYPE_LEARNING_CODEX_PACKET_SCHEMA,
    packetId: value.packetId as string,
    packetSha256: value.packetSha256,
    workspaceId: value.workspaceId as string,
    expectedProfileRevision: value.expectedProfileRevision as number,
    includePrivate: value.includePrivate,
    items: Object.freeze(items),
  });
}

function decodePacketItem(
  value: unknown,
): Readonly<EntryTypeLearningCodexPacketItem> | undefined {
  if (
    !isRecord(value) ||
    !closedKeys(
      value,
      [
        'ordinal',
        'reason',
        'snapshotId',
        'isPrivate',
        'entryId',
        'entryRevision',
        'entryRevisionId',
        'titlePath',
        'body',
        'contentKeywords',
      ],
      ['currentTypeKeyword', 'targetTypeKeyword'],
    ) ||
    !Number.isSafeInteger(value.ordinal) ||
    (value.ordinal as number) < 0 ||
    ![
      'missing_type',
      'other_type',
      'untrusted_existing_type',
      'model_disagreement',
      'model_low_margin',
    ].includes(value.reason as string) ||
    !CANONICAL_UUID.test(value.snapshotId as string) ||
    (value.isPrivate !== true && value.isPrivate !== false) ||
    !CANONICAL_UUID.test(value.entryId as string) ||
    !Number.isSafeInteger(value.entryRevision) ||
    (value.entryRevision as number) < 1 ||
    !CANONICAL_UUID.test(value.entryRevisionId as string) ||
    typeof value.titlePath !== 'string' ||
    typeof value.body !== 'string' ||
    !Array.isArray(value.contentKeywords) ||
    !value.contentKeywords.every((item) => typeof item === 'string') ||
    (value.currentTypeKeyword !== undefined &&
      !ENTRY_TYPE_KEYWORDS.includes(value.currentTypeKeyword as never)) ||
    (value.targetTypeKeyword !== undefined &&
      !LEARNED_TYPES.includes(
        value.targetTypeKeyword as LearnedEntryTypeKeyword,
      ))
  )
    return undefined;
  return Object.freeze({
    ordinal: value.ordinal as number,
    reason: value.reason as EntryTypeLearningCodexPacketItem['reason'],
    snapshotId: value.snapshotId as string,
    isPrivate: value.isPrivate,
    entryId: value.entryId as string,
    entryRevision: value.entryRevision as number,
    entryRevisionId: value.entryRevisionId as string,
    titlePath: value.titlePath,
    body: value.body,
    contentKeywords: Object.freeze(value.contentKeywords),
    ...(value.currentTypeKeyword === undefined
      ? {}
      : {currentTypeKeyword: value.currentTypeKeyword as string}),
    ...(value.targetTypeKeyword === undefined
      ? {}
      : {
          targetTypeKeyword: value.targetTypeKeyword as LearnedEntryTypeKeyword,
        }),
  });
}

function decodeResult(
  bytes: Uint8Array,
  packet: Readonly<EntryTypeLearningCodexPacket>,
): Readonly<EntryTypeLearningCodexResult> | undefined {
  const value = parseJson(bytes);
  if (
    !isRecord(value) ||
    !closedKeys(value, [
      'schemaVersion',
      'packetId',
      'packetSha256',
      'decisions',
    ]) ||
    value.schemaVersion !== ENTRY_TYPE_LEARNING_CODEX_RESULT_SCHEMA ||
    value.packetId !== packet.packetId ||
    value.packetSha256 !== packet.packetSha256 ||
    !Array.isArray(value.decisions) ||
    value.decisions.length !== packet.items.length
  )
    return undefined;
  const decisions: EntryTypeLearningCodexDecision[] = [];
  const ids = new Set<string>();
  for (const candidate of value.decisions) {
    if (!isRecord(candidate)) return undefined;
    const commonValid =
      typeof candidate.entryId === 'string' &&
      Number.isSafeInteger(candidate.entryRevision) &&
      typeof candidate.entryRevisionId === 'string' &&
      packet.items.some(
        (item) =>
          item.entryId === candidate.entryId &&
          item.entryRevision === candidate.entryRevision &&
          item.entryRevisionId === candidate.entryRevisionId,
      ) &&
      !ids.has(candidate.entryId);
    if (!commonValid) return undefined;
    ids.add(candidate.entryId as string);
    if (
      candidate.action === 'reject' &&
      closedKeys(candidate, [
        'entryId',
        'entryRevision',
        'entryRevisionId',
        'action',
      ])
    ) {
      decisions.push(
        Object.freeze({
          entryId: candidate.entryId as string,
          entryRevision: candidate.entryRevision as number,
          entryRevisionId: candidate.entryRevisionId as string,
          action: 'reject',
        }),
      );
    } else if (
      candidate.action === 'trust' &&
      closedKeys(candidate, [
        'entryId',
        'entryRevision',
        'entryRevisionId',
        'action',
        'typeKeyword',
        'authority',
      ]) &&
      LEARNED_TYPES.includes(
        candidate.typeKeyword as LearnedEntryTypeKeyword,
      ) &&
      (candidate.authority === 'manual' ||
        candidate.authority === 'codex_accepted')
    ) {
      decisions.push(
        Object.freeze({
          entryId: candidate.entryId as string,
          entryRevision: candidate.entryRevision as number,
          entryRevisionId: candidate.entryRevisionId as string,
          action: 'trust',
          typeKeyword: candidate.typeKeyword as LearnedEntryTypeKeyword,
          authority: candidate.authority,
        }),
      );
    } else return undefined;
  }
  return Object.freeze({
    schemaVersion: ENTRY_TYPE_LEARNING_CODEX_RESULT_SCHEMA,
    packetId: packet.packetId,
    packetSha256: packet.packetSha256,
    decisions: Object.freeze(decisions),
  });
}

function packetDigestMatches(
  packet: Readonly<EntryTypeLearningCodexPacket>,
): boolean {
  return (
    packet.packetSha256 ===
    digestCanonical({
      schemaVersion: packet.schemaVersion,
      workspaceId: packet.workspaceId,
      expectedProfileRevision: packet.expectedProfileRevision,
      includePrivate: packet.includePrivate,
      items: packet.items,
    })
  );
}

function expectedPacketId(
  packet: Readonly<EntryTypeLearningCodexPacket>,
): string {
  return deriveProcessingRunId(
    packet.workspaceId,
    'm2-p4-type-learning:' + packet.packetSha256,
  );
}

function mergeExamples(
  previous: readonly Readonly<EntryTypeTrustedExample>[],
  incoming: readonly Readonly<EntryTypeTrustedExample>[],
): readonly Readonly<EntryTypeTrustedExample>[] {
  const byEntry = new Map(
    previous.map((example) => [example.entryId, Object.freeze({...example})]),
  );
  for (const example of incoming) byEntry.set(example.entryId, example);
  return Object.freeze(
    [...byEntry.values()].sort(
      (left, right) =>
        left.snapshotId.localeCompare(right.snapshotId) ||
        left.entryId.localeCompare(right.entryId),
    ),
  );
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch {
    return undefined;
  }
}

function digestCanonical(value: unknown): string {
  return createHash('sha256')
    .update(
      encodeCanonicalJson(value, BULK_INGESTION_CODEX_PACKET_MAXIMUM_BYTES),
    )
    .digest('hex');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function closedKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}
