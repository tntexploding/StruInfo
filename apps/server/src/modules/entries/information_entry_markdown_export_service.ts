import {createHash} from 'node:crypto';
import type {BlobStore} from '../../storage/blob_store.js';
import {materializeEvidenceSnapshot} from '../evidence/materialized_evidence_snapshot.js';
import {listInformationEntrySourceReviewItems} from './information_entry_source_review_list.js';
import {
  renderEntryMarkdown,
  type EntryMarkdownSource,
} from './information_entry_markdown_render.js';
import {
  decodeEntryMarkdownExportRequest,
  entryMarkdownExportFailure,
  MAXIMUM_ENTRY_MARKDOWN_EXPORT_BYTES,
  type EntryMarkdownExportRepositoryPort,
  type EntryMarkdownFileStore,
  type EntryMarkdownExportResult,
  type EntryMarkdownPreview,
} from './information_entry_markdown_export.js';

export interface EntryMarkdownExportServicePort {
  preview(body: unknown): Promise<EntryMarkdownExportResult>;
  generate(body: unknown): Promise<EntryMarkdownExportResult>;
}
export class EntryMarkdownExportService implements EntryMarkdownExportServicePort {
  public constructor(
    private readonly dependencies: Readonly<{
      workspaceId: string;
      repository: EntryMarkdownExportRepositoryPort;
      blobStore: BlobStore;
      files: EntryMarkdownFileStore;
    }>,
  ) {}
  public preview(body: unknown): Promise<EntryMarkdownExportResult> {
    return this.#prepare(body, false);
  }
  public generate(body: unknown): Promise<EntryMarkdownExportResult> {
    return this.#prepare(body, true);
  }
  async #prepare(
    body: unknown,
    generating: boolean,
  ): Promise<EntryMarkdownExportResult> {
    const request = decodeEntryMarkdownExportRequest(body, generating);
    if (request === undefined)
      return entryMarkdownExportFailure('input_invalid');
    const {workspaceId, repository, blobStore, files} = this.dependencies;
    try {
      return await repository.withSelection(
        workspaceId,
        request,
        async (selection): Promise<EntryMarkdownExportResult> => {
          const ordered = request.entries.map((expected) =>
            selection.entries.find(
              (entry) =>
                entry.workspaceId === workspaceId &&
                entry.entryId === expected.entryId &&
                (request.privacyScope !== 'public' || !entry.value.isPrivate) &&
                (request.privacyScope !== 'private_only' ||
                  entry.value.isPrivate),
            ),
          );
          if (ordered.some((entry) => entry === undefined))
            return entryMarkdownExportFailure('selection_unavailable');
          const entries = ordered.filter((entry) => entry !== undefined);
          if (
            entries.some(
              (entry, index) =>
                entry.revision !== request.entries[index]?.revision ||
                entry.revisionId !== request.entries[index].revisionId,
            )
          ) {
            return entryMarkdownExportFailure('selection_stale');
          }
          const snapshots = entries.map((entry) =>
            selection.snapshots.find(
              (snapshot) =>
                snapshot.workspaceId === workspaceId &&
                snapshot.snapshotId === entry.snapshotId &&
                snapshot.resourceId === entry.resourceId,
            ),
          );
          if (
            snapshots.some(
              (snapshot) =>
                snapshot === undefined ||
                (snapshot.isPrivate === true &&
                  request.privacyScope === 'public'),
            )
          )
            return entryMarkdownExportFailure('selection_unavailable');
          let markdown: string;
          const relations = listInformationEntrySourceReviewItems(
            workspaceId,
            entries,
            selection.associations,
            {filter: 'all', privacyScope: request.privacyScope, limit: 50},
          );
          try {
            const sources: EntryMarkdownSource[] = [];
            const cache = new Map<
              string,
              Awaited<ReturnType<typeof materializeEvidenceSnapshot>>
            >();
            for (const [index, entry] of entries.entries()) {
              const snapshot = snapshots[index];
              if (snapshot === undefined)
                return entryMarkdownExportFailure('evidence_unavailable');
              let materialized = cache.get(snapshot.snapshotId);
              if (materialized === undefined) {
                const fragmentIds = new Set(
                  entries
                    .filter((item) => item.snapshotId === snapshot.snapshotId)
                    .flatMap((item) => item.value.fragmentIds),
                );
                materialized = await materializeEvidenceSnapshot(
                  {
                    ...snapshot,
                    structures: snapshot.structures
                      .map((structure) => ({
                        ...structure,
                        fragments: structure.fragments.filter((fragment) =>
                          fragmentIds.has(fragment.fragmentId),
                        ),
                      }))
                      .filter((structure) => structure.fragments.length > 0),
                  },
                  blobStore,
                );
                cache.set(snapshot.snapshotId, materialized);
              }
              sources.push({entry, snapshot, materialized});
            }
            markdown = renderEntryMarkdown(
              workspaceId,
              request.title,
              request.privacyScope,
              sources,
              relations,
            );
          } catch {
            return entryMarkdownExportFailure('evidence_unavailable');
          }
          const bytes = new TextEncoder().encode(markdown);
          if (bytes.byteLength > MAXIMUM_ENTRY_MARKDOWN_EXPORT_BYTES)
            return entryMarkdownExportFailure('export_too_large');
          const sha256 = createHash('sha256').update(bytes).digest('hex');
          const preview: Readonly<EntryMarkdownPreview> = Object.freeze({
            title: request.title,
            privacyScope: request.privacyScope,
            entries: Object.freeze(
              entries.map((entry) =>
                Object.freeze({
                  entryId: entry.entryId,
                  revision: entry.revision,
                  revisionId: entry.revisionId,
                  title: entry.value.titlePath || '未命名条目',
                  isPrivate: entry.value.isPrivate,
                }),
              ),
            ),
            relationCount: relations.length,
            markdown,
            sha256,
            byteLength: bytes.byteLength,
          });
          if (!generating) return Object.freeze({status: 'ready', preview});
          if (request.expectedSha256 !== sha256)
            return entryMarkdownExportFailure('preview_stale');
          try {
            const file = await files.write(workspaceId, bytes);
            return Object.freeze({status: 'exported', preview, file});
          } catch {
            return entryMarkdownExportFailure('export_storage_unavailable');
          }
        },
      );
    } catch {
      return entryMarkdownExportFailure('export_read_unavailable');
    }
  }
}
