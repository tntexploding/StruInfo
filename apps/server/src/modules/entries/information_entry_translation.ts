import type {
  CurrentInformationEntry,
  InformationEntrySearchRequest,
} from './information_entry_contract.js';

export const ENTRY_TRANSLATION_MAXIMUM_SOURCE_CHARACTERS = 24_000;
export const ENTRY_TRANSLATION_MAXIMUM_BODY_CHARACTERS = 48_000;

export interface EntryTranslationText {
  readonly title: string;
  readonly body: string;
}

export interface EntryTranslation extends EntryTranslationText {
  readonly entryId: string;
  readonly sourceRevision: number;
  readonly sourceRevisionId: string;
  readonly targetLanguage: 'zh-CN';
  readonly providerKey:
    'openai-responses-v1' | 'deepseek-responses-v1' | 'provided-translation-v1';
  readonly model: string;
  readonly promptVersion: string;
  readonly translatedAt: string;
}

export type EntryTranslationErrorCode =
  | 'ai_price_window_closed'
  | 'translation_entry_unavailable'
  | 'translation_source_stale'
  | 'translation_input_too_large'
  | 'translation_already_exists'
  | 'translation_invalid_text'
  | 'ai_provider_not_configured'
  | 'ai_provider_timeout'
  | 'ai_provider_unavailable'
  | 'ai_provider_rejected'
  | 'ai_provider_invalid_response';

export class EntryTranslationError extends Error {
  public constructor(public readonly code: EntryTranslationErrorCode) {
    super(code);
    this.name = 'EntryTranslationError';
  }
}

export interface EntryTranslationProviderPort {
  readonly providerKey: 'openai-responses-v1' | 'deepseek-responses-v1';
  readonly model: string;
  readonly promptVersion: string;
  translate(
    source: Readonly<EntryTranslationText>,
  ): Promise<Readonly<EntryTranslationText>>;
}

export interface EntryTranslationRepositoryPort {
  /** Returns only a translation matching a public, current Entry and its revision. */
  load(
    workspaceId: string,
    entryId: string,
    revision: number,
  ): Promise<Readonly<EntryTranslation> | undefined>;
  /** Revalidates public/current source identity atomically with the write. */
  saveIfCurrent(
    workspaceId: string,
    translation: Readonly<EntryTranslation>,
  ): Promise<boolean>;
}

/** Search reads completed public caches without any generation authority. */
export interface EntryTranslationSearchRepositoryPort {
  loadCurrentTranslations(
    workspaceId: string,
  ): Promise<readonly Readonly<EntryTranslation>[]>;
}

export async function loadCachedEntrySearchTranslations(
  workspaceId: string,
  request: Readonly<InformationEntrySearchRequest>,
  repository: EntryTranslationSearchRepositoryPort | undefined,
): Promise<ReadonlyMap<string, Readonly<EntryTranslation>>> {
  if (
    repository === undefined ||
    request.onlyPrivate ||
    request.retrievalMode === 'semantic' ||
    (request.text ?? '').trim() === '' ||
    (request.textFields !== undefined &&
      !request.textFields.some(
        (field) => field === 'title' || field === 'body',
      ))
  )
    return new Map();
  const translations = await repository.loadCurrentTranslations(workspaceId);
  return new Map(
    translations.map((translation) => [translation.entryId, translation]),
  );
}

export interface EntryTranslationServicePort {
  readonly enabled: boolean;
  importProvided(
    entryId: string,
    expectedRevision: number,
    sourceRevisionId: string,
    text: Readonly<EntryTranslationText>,
  ): Promise<Readonly<EntryTranslation>>;
  read(
    entryId: string,
    expectedRevision: number,
  ): Promise<Readonly<EntryTranslation> | undefined>;
  generate(
    entryId: string,
    expectedRevision: number,
  ): Promise<Readonly<EntryTranslation>>;
}

export interface EntryTranslationDependencies {
  readonly workspaceId: string;
  readonly loadPublicEntry: (
    entryId: string,
  ) => Promise<Readonly<CurrentInformationEntry> | undefined>;
  readonly repository: EntryTranslationRepositoryPort;
  readonly provider?: EntryTranslationProviderPort;
  readonly now?: () => string;
}

export class EntryTranslationService implements EntryTranslationServicePort {
  readonly #dependencies: Readonly<EntryTranslationDependencies>;
  readonly #pending = new Map<string, Promise<Readonly<EntryTranslation>>>();
  public readonly enabled: boolean;

  public constructor(dependencies: Readonly<EntryTranslationDependencies>) {
    this.#dependencies = dependencies;
    this.enabled = dependencies.provider !== undefined;
  }

  public async read(
    entryId: string,
    expectedRevision: number,
  ): Promise<Readonly<EntryTranslation> | undefined> {
    await this.#source(entryId, expectedRevision);
    return this.#dependencies.repository.load(
      this.#dependencies.workspaceId,
      entryId,
      expectedRevision,
    );
  }

  public async importProvided(
    entryId: string,
    expectedRevision: number,
    sourceRevisionId: string,
    text: Readonly<EntryTranslationText>,
  ): Promise<Readonly<EntryTranslation>> {
    const source = await this.#source(entryId, expectedRevision);
    if (source.revisionId !== sourceRevisionId)
      throw new EntryTranslationError('translation_source_stale');
    let translated: Readonly<EntryTranslationText>;
    try {
      translated = validateEntryTranslationText(text);
    } catch {
      throw new EntryTranslationError('translation_invalid_text');
    }
    const translation: Readonly<EntryTranslation> = {
      ...translated,
      entryId,
      sourceRevision: source.revision,
      sourceRevisionId,
      targetLanguage: 'zh-CN',
      providerKey: 'provided-translation-v1',
      model: '',
      promptVersion: '',
      translatedAt: this.#dependencies.now?.() ?? new Date().toISOString(),
    };
    // An existing current cache is reusable, but import never replaces it.
    await this.#dependencies.repository.saveIfCurrent(
      this.#dependencies.workspaceId,
      translation,
    );
    const saved = await this.#dependencies.repository.load(
      this.#dependencies.workspaceId,
      entryId,
      source.revision,
    );
    if (saved?.sourceRevisionId !== sourceRevisionId)
      throw new EntryTranslationError('translation_source_stale');
    if (saved.title !== translated.title || saved.body !== translated.body)
      throw new EntryTranslationError('translation_already_exists');
    return saved;
  }

  public async generate(
    entryId: string,
    expectedRevision: number,
  ): Promise<Readonly<EntryTranslation>> {
    const source = await this.#source(entryId, expectedRevision);
    const key = `${entryId}:${source.revisionId}`;
    const pending = this.#pending.get(key);
    if (pending !== undefined) return pending;
    const operation = this.#generate(source);
    this.#pending.set(key, operation);
    try {
      return await operation;
    } finally {
      this.#pending.delete(key);
    }
  }

  async #source(
    entryId: string,
    expectedRevision: number,
  ): Promise<Readonly<CurrentInformationEntry>> {
    const source = await this.#dependencies.loadPublicEntry(entryId);
    if (
      source?.workspaceId !== this.#dependencies.workspaceId ||
      source.entryId !== entryId ||
      source.value.isPrivate
    ) {
      throw new EntryTranslationError('translation_entry_unavailable');
    }
    if (source.revision !== expectedRevision)
      throw new EntryTranslationError('translation_source_stale');
    return source;
  }

  async #generate(
    source: Readonly<CurrentInformationEntry>,
  ): Promise<Readonly<EntryTranslation>> {
    const {workspaceId, repository, provider} = this.#dependencies;
    const cached = await repository.load(
      workspaceId,
      source.entryId,
      source.revision,
    );
    if (cached?.sourceRevisionId === source.revisionId) return cached;
    if (provider === undefined)
      throw new EntryTranslationError('ai_provider_not_configured');
    if (
      Array.from(source.value.titlePath + source.value.body).length >
      ENTRY_TRANSLATION_MAXIMUM_SOURCE_CHARACTERS
    ) {
      throw new EntryTranslationError('translation_input_too_large');
    }
    // Recheck immediately before sending; a local privacy opt-in never authorizes transfer.
    const current = await this.#source(source.entryId, source.revision);
    if (current.revisionId !== source.revisionId)
      throw new EntryTranslationError('translation_source_stale');
    const translated = validateEntryTranslationText(
      await provider.translate({
        title: source.value.titlePath,
        body: source.value.body,
      }),
    );
    const translation: Readonly<EntryTranslation> = Object.freeze({
      ...translated,
      entryId: source.entryId,
      sourceRevision: source.revision,
      sourceRevisionId: source.revisionId,
      targetLanguage: 'zh-CN',
      providerKey: provider.providerKey,
      model: provider.model,
      promptVersion: provider.promptVersion,
      translatedAt: this.#dependencies.now?.() ?? new Date().toISOString(),
    });
    // A concurrent supplied translation may have completed first; preserve it.
    await repository.saveIfCurrent(workspaceId, translation);
    // Read through the same privacy/version filter, including a change just after settlement.
    const saved = await repository.load(
      workspaceId,
      source.entryId,
      source.revision,
    );
    if (saved?.sourceRevisionId !== source.revisionId)
      throw new EntryTranslationError('translation_source_stale');
    return saved;
  }
}

export function validateEntryTranslationText(
  value: unknown,
): Readonly<EntryTranslationText> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'body,title'
  ) {
    throw new EntryTranslationError('ai_provider_invalid_response');
  }
  const record = value as Record<string, unknown>;
  for (const [key, maximum] of [
    ['title', 2_000],
    ['body', ENTRY_TRANSLATION_MAXIMUM_BODY_CHARACTERS],
  ] as const) {
    const text = record[key];
    if (
      typeof text !== 'string' ||
      (key === 'body' && text.trim().length === 0) ||
      Array.from(text).length > maximum ||
      Array.from(text).some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return (
          (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
          code === 127 ||
          (code >= 0xd800 && code <= 0xdfff)
        );
      })
    ) {
      throw new EntryTranslationError('ai_provider_invalid_response');
    }
  }
  return Object.freeze({
    title: record.title as string,
    body: record.body as string,
  });
}
