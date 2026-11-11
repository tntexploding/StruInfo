import {it, expect, vi} from 'vitest';
import {publishedEntryRepository} from './document_publication.js';
import type {DocumentPublicationRepository} from './document_publication_contract.js';
import type {InformationEntryRepositoryPort} from '../modules/entries/information_entry_repository.js';

it('reads only confirmed content and forwards the exact entry scope to storage', async () => {
  const raw = {
    loadCurrentEntries: vi.fn(),
    loadCurrentEntriesByIds: vi.fn(),
  };
  const loadPublished = vi.fn(() => Promise.resolve({entries: []}));
  const published = publishedEntryRepository(
    raw as unknown as InformationEntryRepositoryPort,
    {
      loadPublished,
    } as unknown as DocumentPublicationRepository,
  );
  await expect(
    published.loadCurrentEntries('workspace', false),
  ).resolves.toEqual([]);
  await expect(
    published.loadCurrentEntriesByIds?.('workspace', true, ['entry']),
  ).resolves.toEqual([]);
  expect(loadPublished).toHaveBeenLastCalledWith('workspace', true, ['entry']);
  expect(raw.loadCurrentEntries).not.toHaveBeenCalled();
  expect(raw.loadCurrentEntriesByIds).not.toHaveBeenCalled();
  loadPublished.mockClear();
  await expect(
    published.loadCurrentEntriesByIds?.('workspace', false, []),
  ).resolves.toEqual([]);
  expect(loadPublished).not.toHaveBeenCalled();
});
