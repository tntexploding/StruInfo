import {describe, expect, it, vi} from 'vitest';
import type {CurrentInformationEntry} from './information_entry_contract.js';
import {
  EntryTranslationError,
  EntryTranslationService,
  type EntryTranslation,
  type EntryTranslationProviderPort,
  type EntryTranslationRepositoryPort,
  validateEntryTranslationText,
} from './information_entry_translation.js';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const TEXT = {
  title: '合成标题',
  body: '合成正文。\n\n保留数字 12 与代码 `x`。',
};
const ENTRY: Readonly<CurrentInformationEntry> = {
  workspaceId: WORKSPACE,
  entryId: ID,
  resourceId: '33333333-3333-4333-8333-333333333333',
  snapshotId: '44444444-4444-4444-8444-444444444444',
  revision: 1,
  revisionId: '55555555-5555-4555-8555-555555555555',
  sourceKey: 'synthetic:translation',
  capturedAt: '2040-01-01T00:00:00Z',
  value: {
    documentOrder: 0,
    titlePath: 'Synthetic title',
    body: 'Synthetic text.\n\nKeep 12 and `x`.',
    bodySha256: 'a'.repeat(64),
    chunkMode: 'whole',
    splitRuleVersion: 'synthetic-v1',
    isPrivate: false,
    contentKeywords: [],
    domains: [],
    fragmentIds: ['66666666-6666-4666-8666-666666666666'],
  },
};

function fixture(enabled = true) {
  let current: Readonly<CurrentInformationEntry> | undefined = ENTRY;
  let saved: Readonly<EntryTranslation> | undefined;
  const translate = vi.fn<EntryTranslationProviderPort['translate']>(() =>
    Promise.resolve(TEXT),
  );
  const provider: EntryTranslationProviderPort = {
    providerKey: 'openai-responses-v1',
    model: 'synthetic-model',
    promptVersion: 'synthetic-v1',
    translate,
  };
  const repository: EntryTranslationRepositoryPort = {
    load: vi.fn<EntryTranslationRepositoryPort['load']>(
      (_workspace, _id, revision) =>
        Promise.resolve(
          current !== undefined &&
            !current.value.isPrivate &&
            saved?.sourceRevisionId === current.revisionId &&
            current.revision === revision
            ? saved
            : undefined,
        ),
    ),
    replaceIfCurrent: vi.fn<
      NonNullable<EntryTranslationRepositoryPort['replaceIfCurrent']>
    >((_workspace, translation, expected) => {
      if (
        !current ||
        current.value.isPrivate ||
        current.revisionId !== translation.sourceRevisionId ||
        saved?.translatedAt !== expected ||
        saved.providerKey === 'provided-translation-v1'
      )
        return Promise.resolve(false);
      saved = translation;
      return Promise.resolve(true);
    }),
    saveIfCurrent: vi.fn<EntryTranslationRepositoryPort['saveIfCurrent']>(
      (_workspace, translation) => {
        if (
          current === undefined ||
          current.value.isPrivate ||
          current.revisionId !== translation.sourceRevisionId ||
          current.revision !== translation.sourceRevision ||
          saved?.sourceRevisionId === translation.sourceRevisionId
        )
          return Promise.resolve(false);
        saved = translation;
        return Promise.resolve(true);
      },
    ),
  };
  const service = new EntryTranslationService({
    workspaceId: WORKSPACE,
    loadPublicEntry: () => Promise.resolve(current),
    repository,
    ...(enabled ? {provider} : {}),
    now: () => '2040-01-01T00:00:00.000Z',
  });
  return {
    service,
    translate,
    repository,
    change: (value: Readonly<CurrentInformationEntry> | undefined) => {
      current = value;
    },
    saved: () => saved,
  };
}

describe('on-demand Entry translation', () => {
  it('imports supplied Chinese text with the Provider off and preserves the first cache', async () => {
    const f = fixture(false);
    const source = structuredClone(ENTRY);
    const first = await f.service.importProvided(ID, 1, ENTRY.revisionId, TEXT);
    expect(first).toMatchObject({
      ...TEXT,
      providerKey: 'provided-translation-v1',
      model: '',
      promptVersion: '',
    });
    expect(
      await f.service.importProvided(ID, 1, ENTRY.revisionId, TEXT),
    ).toEqual(first);
    await expect(
      f.service.importProvided(ID, 1, ENTRY.revisionId, {
        ...TEXT,
        body: 'Different',
      }),
    ).rejects.toMatchObject({code: 'translation_already_exists'});
    expect(await f.service.read(ID, 1)).toEqual(first);
    expect(f.translate).not.toHaveBeenCalled();
    expect(ENTRY).toEqual(source);
  });
  it('rejects malformed, stale and private supplied translations', async () => {
    const f = fixture(false);
    await expect(
      f.service.importProvided(ID, 1, ENTRY.revisionId, {...TEXT, body: ''}),
    ).rejects.toMatchObject({code: 'translation_invalid_text'});
    await expect(
      f.service.importProvided(
        ID,
        1,
        '77777777-7777-4777-8777-777777777777',
        TEXT,
      ),
    ).rejects.toMatchObject({code: 'translation_source_stale'});
    f.change({...ENTRY, value: {...ENTRY.value, isPrivate: true}});
    await expect(
      f.service.importProvided(ID, 1, ENTRY.revisionId, TEXT),
    ).rejects.toMatchObject({code: 'translation_entry_unavailable'});
    expect(f.saved()).toBeUndefined();
    expect(f.translate).not.toHaveBeenCalled();
  });
  it('preserves an import completed during a Provider request', async () => {
    const f = fixture();
    f.translate.mockImplementation(async () => {
      await f.service.importProvided(ID, 1, ENTRY.revisionId, TEXT);
      return {...TEXT, body: 'Later Provider result'};
    });
    const result = await f.service.generate(ID, 1);
    expect(result).toMatchObject({
      ...TEXT,
      providerKey: 'provided-translation-v1',
    });
  });
  it('reads locally and stores a reusable reading aid without changing evidence', async () => {
    const f = fixture();
    const original = structuredClone(ENTRY);
    expect(await f.service.read(ID, 1)).toBeUndefined();
    expect(f.translate).not.toHaveBeenCalled();
    const result = await f.service.generate(ID, 1);
    expect(result).toMatchObject({
      ...TEXT,
      sourceRevisionId: ENTRY.revisionId,
      targetLanguage: 'zh-CN',
    });
    expect(f.translate).toHaveBeenCalledWith({
      title: ENTRY.value.titlePath,
      body: ENTRY.value.body,
    });
    expect(ENTRY).toEqual(original);
    expect(await f.service.generate(ID, 1)).toEqual(result);
    expect(f.translate).toHaveBeenCalledTimes(1);
    const offline = new EntryTranslationService({
      workspaceId: WORKSPACE,
      loadPublicEntry: () => Promise.resolve(ENTRY),
      repository: f.repository,
    });
    expect(offline.enabled).toBe(false);
    expect(await offline.read(ID, 1)).toEqual(result);
  });
  it('deduplicates simultaneous requests for the same exact Entry version', async () => {
    const f = fixture();
    const [first, second] = await Promise.all([
      f.service.generate(ID, 1),
      f.service.generate(ID, 1),
    ]);
    expect(first).toEqual(second);
    expect(f.translate).toHaveBeenCalledTimes(1);
  });
  it('keeps an unconfigured Provider closed', async () => {
    const f = fixture(false);
    await expect(f.service.generate(ID, 1)).rejects.toMatchObject({
      code: 'ai_provider_not_configured',
    });
    expect(f.saved()).toBeUndefined();
  });
  it.each(['missing', 'private', 'foreign'] as const)(
    'rejects %s sources before Provider or translation storage reads',
    async (kind) => {
      const f = fixture();
      f.change(
        kind === 'missing'
          ? undefined
          : kind === 'private'
            ? {...ENTRY, value: {...ENTRY.value, isPrivate: true}}
            : {...ENTRY, workspaceId: '77777777-7777-4777-8777-777777777777'},
      );
      await expect(f.service.generate(ID, 1)).rejects.toMatchObject({
        code: 'translation_entry_unavailable',
      });
      expect(f.translate).not.toHaveBeenCalled();
    },
  );
  it('rejects stale and oversized input without truncating or sending it', async () => {
    const f = fixture();
    await expect(f.service.generate(ID, 2)).rejects.toMatchObject({
      code: 'translation_source_stale',
    });
    f.change({...ENTRY, value: {...ENTRY.value, body: '😀'.repeat(24_001)}});
    await expect(f.service.generate(ID, 1)).rejects.toMatchObject({
      code: 'translation_input_too_large',
    });
    expect(f.translate).not.toHaveBeenCalled();
  });
  it.each(['edit', 'private', 'retire'] as const)(
    'rejects a source changed during generation: %s',
    async (kind) => {
      const f = fixture();
      f.translate.mockImplementation(() => {
        f.change(
          kind === 'retire'
            ? undefined
            : kind === 'private'
              ? {...ENTRY, value: {...ENTRY.value, isPrivate: true}}
              : {
                  ...ENTRY,
                  revision: 2,
                  revisionId: '77777777-7777-4777-8777-777777777777',
                },
        );
        return Promise.resolve(TEXT);
      });
      await expect(f.service.generate(ID, 1)).rejects.toMatchObject({
        code: 'translation_source_stale',
      });
      expect(f.saved()).toBeUndefined();
    },
  );
  it('invalidates cached content after revision and blocks it after privacy changes', async () => {
    const f = fixture();
    await f.service.generate(ID, 1);
    f.change({
      ...ENTRY,
      revision: 2,
      revisionId: '77777777-7777-4777-8777-777777777777',
    });
    expect(await f.service.read(ID, 2)).toBeUndefined();
    f.change({...ENTRY, value: {...ENTRY.value, isPrivate: true}});
    await expect(f.service.read(ID, 1)).rejects.toMatchObject({
      code: 'translation_entry_unavailable',
    });
  });
  it('lets the user retry after Provider failure without saving partial output', async () => {
    const f = fixture();
    f.translate.mockRejectedValueOnce(
      new EntryTranslationError('ai_provider_timeout'),
    );
    await expect(f.service.generate(ID, 1)).rejects.toMatchObject({
      code: 'ai_provider_timeout',
    });
    expect(f.saved()).toBeUndefined();
    await expect(f.service.generate(ID, 1)).resolves.toMatchObject(TEXT);
  });
  it('accepts paragraphs and Unicode, rejecting empty, oversized or opaque output', () => {
    expect(
      validateEntryTranslationText({...TEXT, body: '😀\n\t`x`'}).body,
    ).toBe('😀\n\t`x`');
    for (const input of [
      {...TEXT, body: ''},
      {...TEXT, body: '文'.repeat(48_001)},
      {...TEXT, body: '\ud800'},
      {...TEXT, raw: 'provider metadata'},
    ]) {
      expect(() => validateEntryTranslationText(input)).toThrow(
        EntryTranslationError,
      );
    }
  });
});

it('explicit AI translation redo requires the displayed cache and preserves manual supplied translations', async () => {
  const f = fixture();
  const first = await f.service.generate(ID, 1);
  f.translate.mockResolvedValue({...TEXT, body: '重新生成的合成译文。'});
  const second = await f.service.generate(ID, 1, first.translatedAt);
  expect(second.body).toBe('重新生成的合成译文。');
  expect(second.translatedAt).not.toBe(first.translatedAt);
  await expect(
    f.service.generate(ID, 1, first.translatedAt),
  ).rejects.toMatchObject({code: 'translation_source_stale'});
  expect(f.translate).toHaveBeenCalledTimes(2);
  const manual = fixture();
  const supplied = await manual.service.importProvided(
    ID,
    1,
    ENTRY.revisionId,
    TEXT,
  );
  await expect(
    manual.service.generate(ID, 1, supplied.translatedAt),
  ).rejects.toMatchObject({code: 'translation_already_exists'});
  expect(manual.translate).not.toHaveBeenCalled();
});
it('a concurrent source revision prevents a redo from replacing the old translation', async () => {
  const f = fixture();
  const first = await f.service.generate(ID, 1);
  f.translate.mockImplementation(() => {
    f.change({
      ...ENTRY,
      revision: 2,
      revisionId: '77777777-7777-4777-8777-777777777777',
    });
    return Promise.resolve(TEXT);
  });
  await expect(
    f.service.generate(ID, 1, first.translatedAt),
  ).rejects.toMatchObject({code: 'translation_source_stale'});
  expect(f.saved()).toEqual(first);
});
