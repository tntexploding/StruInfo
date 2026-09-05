import type {CurrentInformationEntry} from './information_entry_contract.js';
import type {InformationEntryAssociationRepositorySnapshot} from './information_entry_association_contract.js';
import type {EvidenceSnapshotReadState} from '../evidence/evidence_read_repository.js';

export const MAXIMUM_ENTRY_MARKDOWN_EXPORT_ITEMS = 20;
export const MAXIMUM_ENTRY_MARKDOWN_EXPORT_BYTES = 2 * 1024 * 1024;
export type EntryMarkdownPrivacyScope =
  'public' | 'include_private' | 'private_only';

export interface EntryMarkdownSelection {
  readonly entryId: string;
  readonly revision: number;
  readonly revisionId: string;
}
export interface EntryMarkdownExportRequest {
  readonly title: string;
  readonly privacyScope: EntryMarkdownPrivacyScope;
  readonly entries: readonly Readonly<EntryMarkdownSelection>[];
  readonly expectedSha256?: string;
}
export interface EntryMarkdownExportRead {
  readonly entries: readonly Readonly<CurrentInformationEntry>[];
  readonly snapshots: readonly Readonly<EvidenceSnapshotReadState>[];
  readonly associations: Readonly<InformationEntryAssociationRepositorySnapshot>;
}
/** Keeps the current selection stable through local preparation and file creation. */
export interface EntryMarkdownExportRepositoryPort {
  withSelection<Result>(
    workspaceId: string,
    request: Readonly<EntryMarkdownExportRequest>,
    work: (selection: Readonly<EntryMarkdownExportRead>) => Promise<Result>,
  ): Promise<Result>;
}
export interface EntryMarkdownStoredFile {
  readonly fileName: string;
  readonly byteLength: number;
}
export interface EntryMarkdownFileStore {
  write(
    workspaceId: string,
    bytes: Uint8Array,
  ): Promise<Readonly<EntryMarkdownStoredFile>>;
}
export interface EntryMarkdownPreview {
  readonly title: string;
  readonly privacyScope: EntryMarkdownPrivacyScope;
  readonly entries: readonly Readonly<
    EntryMarkdownSelection & {
      title: string;
      isPrivate: boolean;
    }
  >[];
  readonly relationCount: number;
  readonly markdown: string;
  readonly sha256: string;
  readonly byteLength: number;
}
export type EntryMarkdownExportFailureCode =
  | 'input_invalid'
  | 'selection_unavailable'
  | 'selection_stale'
  | 'preview_stale'
  | 'evidence_unavailable'
  | 'export_too_large'
  | 'export_storage_unavailable'
  | 'export_read_unavailable';
export type EntryMarkdownExportResult =
  | Readonly<{status: 'ready'; preview: Readonly<EntryMarkdownPreview>}>
  | Readonly<{
      status: 'exported';
      preview: Readonly<EntryMarkdownPreview>;
      file: Readonly<EntryMarkdownStoredFile>;
    }>
  | Readonly<{
      status: 'rejected';
      issue: Readonly<{code: EntryMarkdownExportFailureCode}>;
    }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function decodeEntryMarkdownExportRequest(
  value: unknown,
  generating: boolean,
): Readonly<EntryMarkdownExportRequest> | undefined {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          'title',
          'privacyScope',
          'entries',
          ...(generating ? ['expectedSha256'] : []),
        ].includes(key),
    ) ||
    typeof value.title !== 'string' ||
    value.title.trim() === '' ||
    Array.from(value.title.trim()).length > 120 ||
    Array.from(value.title).some(
      (char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f,
    ) ||
    typeof value.privacyScope !== 'string' ||
    !['public', 'include_private', 'private_only'].includes(
      value.privacyScope,
    ) ||
    !Array.isArray(value.entries) ||
    value.entries.length < 1 ||
    value.entries.length > MAXIMUM_ENTRY_MARKDOWN_EXPORT_ITEMS ||
    (generating &&
      (typeof value.expectedSha256 !== 'string' ||
        !DIGEST.test(value.expectedSha256)))
  )
    return undefined;
  const entries: EntryMarkdownSelection[] = [];
  for (const item of value.entries as unknown[]) {
    if (
      !record(item) ||
      Object.keys(item).some(
        (key) => !['entryId', 'revision', 'revisionId'].includes(key),
      ) ||
      typeof item.entryId !== 'string' ||
      !UUID.test(item.entryId) ||
      typeof item.revisionId !== 'string' ||
      !UUID.test(item.revisionId) ||
      typeof item.revision !== 'number' ||
      !Number.isSafeInteger(item.revision) ||
      item.revision < 1 ||
      entries.some((entry) => entry.entryId === item.entryId)
    )
      return undefined;
    entries.push(
      Object.freeze({
        entryId: item.entryId,
        revision: item.revision,
        revisionId: item.revisionId,
      }),
    );
  }
  return Object.freeze({
    title: value.title.trim(),
    privacyScope: value.privacyScope as EntryMarkdownPrivacyScope,
    entries: Object.freeze(entries),
    ...(generating ? {expectedSha256: value.expectedSha256 as string} : {}),
  });
}
export function entryMarkdownExportFailure(
  code: EntryMarkdownExportFailureCode,
): EntryMarkdownExportResult {
  return Object.freeze({status: 'rejected', issue: Object.freeze({code})});
}
