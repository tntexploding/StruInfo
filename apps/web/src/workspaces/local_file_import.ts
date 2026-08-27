export const LOCAL_DOCUMENT_FILE_MAX_BYTES = 1_048_576;
export const LOCAL_DOCUMENT_BATCH_MAX_FILES = 20;

const LOCAL_FILE_NAME_MAX_CODE_POINTS = 255;
const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export type LocalDocumentFormat = 'markdown' | 'html' | 'pdf';
export type LocalDocumentMediaType =
  'text/markdown' | 'text/plain' | 'text/html' | 'application/pdf';

export type LocalDocumentFileIssueCode =
  | 'file_name_invalid'
  | 'file_type_unsupported'
  | 'file_too_large'
  | 'file_utf8_invalid'
  | 'file_content_invalid';

export interface PreparedLocalDocumentFile {
  readonly fileName: string;
  readonly documentFormat: LocalDocumentFormat;
  readonly mediaType: LocalDocumentMediaType;
  readonly byteLength: number;
  readonly sourceText: string;
  readonly sourceBytes: Uint8Array;
}

export type PrepareLocalDocumentFileResult =
  | Readonly<{status: 'ready'; value: Readonly<PreparedLocalDocumentFile>}>
  | Readonly<{
      status: 'rejected';
      code: LocalDocumentFileIssueCode;
    }>;

export interface ComposedLocalDocumentSource {
  readonly sourceBase64: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly defaultSourceKey: string;
  readonly documentFormat: LocalDocumentFormat;
  readonly sourcePreface?: string;
  readonly composed: boolean;
}

export interface LocalDocumentImportIdentity {
  readonly commandIdempotencyKey: string;
  readonly capturedAt: string;
  readonly resourceId: string;
  readonly snapshotId: string;
}

export interface LocalDocumentImportOptions {
  readonly identity: Readonly<LocalDocumentImportIdentity>;
  readonly file: Readonly<PreparedLocalDocumentFile>;
  readonly isPrivate: boolean;
  readonly publicationDate: string;
  readonly profile: 'commonmark-v1' | 'ruanyf-weekly-v1';
  readonly sourcePreface: string;
  readonly sourceKey?: string;
  readonly canonicalUri?: string;
}

export type ComposeLocalDocumentImportRequestResult =
  | Readonly<{status: 'ready'; body: Readonly<Record<string, unknown>>}>
  | Readonly<{status: 'rejected'; code: 'composed_too_large'}>;

export function prepareLocalDocumentFile(
  fileName: string,
  bytes: Uint8Array,
): PrepareLocalDocumentFileResult {
  const normalizedName = normalizeFileName(fileName);
  if (normalizedName === undefined) {
    return Object.freeze({status: 'rejected', code: 'file_name_invalid'});
  }
  const format = formatForFileName(normalizedName);
  if (format === undefined) {
    return Object.freeze({status: 'rejected', code: 'file_type_unsupported'});
  }
  if (bytes.byteLength > LOCAL_DOCUMENT_FILE_MAX_BYTES) {
    return Object.freeze({status: 'rejected', code: 'file_too_large'});
  }
  const ownedBytes = Uint8Array.from(bytes);
  if (format.documentFormat === 'pdf') {
    if (!startsWithPdfMagic(ownedBytes)) {
      return Object.freeze({status: 'rejected', code: 'file_content_invalid'});
    }
    return readyFile(normalizedName, format, ownedBytes, '');
  }
  let sourceText: string;
  try {
    sourceText = new TextDecoder('utf-8', {fatal: true}).decode(ownedBytes);
  } catch {
    return Object.freeze({status: 'rejected', code: 'file_utf8_invalid'});
  }
  if (sourceText.includes('\u0000') || sourceText.trim().length === 0) {
    return Object.freeze({status: 'rejected', code: 'file_content_invalid'});
  }
  return readyFile(normalizedName, format, ownedBytes, sourceText);
}

export async function composeLocalDocumentSource(
  file: Readonly<PreparedLocalDocumentFile>,
  prefix: string,
): Promise<Readonly<ComposedLocalDocumentSource> | undefined> {
  const normalizedPrefix = prefix.trim();
  const composeIntoRaw =
    file.documentFormat === 'markdown' && normalizedPrefix !== '';
  const bytes = composeIntoRaw
    ? new TextEncoder().encode(`${normalizedPrefix}\n\n${file.sourceText}`)
    : Uint8Array.from(file.sourceBytes);
  if (bytes.byteLength > LOCAL_DOCUMENT_FILE_MAX_BYTES) return undefined;
  const sha256 = await sha256Hex(bytes);
  return Object.freeze({
    sourceBase64: encodeBase64(bytes),
    byteLength: bytes.byteLength,
    sha256,
    defaultSourceKey: `${file.fileName}#sha256:${sha256}`,
    documentFormat: file.documentFormat,
    ...(file.documentFormat === 'markdown' || normalizedPrefix === ''
      ? {}
      : {sourcePreface: normalizedPrefix}),
    composed: composeIntoRaw,
  });
}

export async function composeLocalDocumentImportRequest(
  options: Readonly<LocalDocumentImportOptions>,
): Promise<ComposeLocalDocumentImportRequestResult> {
  const composed = await composeLocalDocumentSource(
    options.file,
    options.sourcePreface,
  );
  if (composed === undefined) {
    return Object.freeze({
      status: 'rejected' as const,
      code: 'composed_too_large' as const,
    });
  }
  const canonicalUri = options.canonicalUri?.trim() ?? '';
  const requestedSourceKey = options.sourceKey?.trim();
  const sourceKey =
    requestedSourceKey === undefined || requestedSourceKey === ''
      ? composed.defaultSourceKey
      : requestedSourceKey;
  const profile =
    options.file.documentFormat === 'markdown' &&
    options.file.mediaType === 'text/markdown'
      ? options.profile
      : 'commonmark-v1';
  return Object.freeze({
    status: 'ready' as const,
    body: Object.freeze({
      commandIdempotencyKey: options.identity.commandIdempotencyKey,
      resource: {
        resourceId: options.identity.resourceId,
        resourceKind: 'uploaded_file',
        sourceKey,
        ...(options.isPrivate ? {isPrivate: true} : {}),
        ...(canonicalUri === '' ? {} : {canonicalUri}),
      },
      snapshot: {
        snapshotId: options.identity.snapshotId,
        resourceId: options.identity.resourceId,
        capturedAt: options.identity.capturedAt,
        mediaType: options.file.mediaType,
        ...(options.publicationDate === ''
          ? {}
          : {
              publication: {
                instant: `${options.publicationDate}T00:00:00.000Z`,
                sourceTimezone: 'UTC',
                precision: 'day',
                sourceText: options.publicationDate,
                inferred: false,
              },
            }),
      },
      gitObservations: [],
      documentFormat: composed.documentFormat,
      profile,
      sourceBase64: composed.sourceBase64,
      ...(composed.sourcePreface === undefined
        ? {}
        : {sourcePreface: composed.sourcePreface}),
      ...(canonicalUri === '' ? {} : {documentBaseUri: canonicalUri}),
    }),
  });
}

export function describeLocalDocumentFileIssue(
  code: LocalDocumentFileIssueCode,
): string {
  if (code === 'file_name_invalid') return '文件名无效；请选择普通文件名。';
  if (code === 'file_type_unsupported')
    return '仅支持 .md、.markdown、.txt、.html、.htm 和 .pdf。';
  if (code === 'file_too_large')
    return `文件超过 ${formatLocalDocumentFileBytes(LOCAL_DOCUMENT_FILE_MAX_BYTES)} 上限。`;
  if (code === 'file_utf8_invalid') return '文件不是有效的 UTF-8 文本。';
  return '文件为空、PDF 标识无效，或文本含有不允许的 NUL 字符。';
}

export function formatLocalDocumentFileBytes(value: number): string {
  return value < 1024
    ? `${value.toString()} B`
    : `${(value / 1024).toFixed(value < 1024 * 1024 ? 1 : 0)} KiB`;
}

function readyFile(
  fileName: string,
  format: Readonly<{
    documentFormat: LocalDocumentFormat;
    mediaType: LocalDocumentMediaType;
  }>,
  sourceBytes: Uint8Array,
  sourceText: string,
): PrepareLocalDocumentFileResult {
  return Object.freeze({
    status: 'ready' as const,
    value: Object.freeze({
      fileName,
      documentFormat: format.documentFormat,
      mediaType: format.mediaType,
      byteLength: sourceBytes.byteLength,
      sourceText,
      sourceBytes,
    }),
  });
}

function normalizeFileName(value: string): string | undefined {
  const normalized = value.trim().normalize('NFC');
  if (
    normalized === '' ||
    normalized.includes('/') ||
    normalized.includes('\\') ||
    normalized.includes('\u0000') ||
    Array.from(normalized).length > LOCAL_FILE_NAME_MAX_CODE_POINTS
  ) {
    return undefined;
  }
  return normalized;
}

function formatForFileName(fileName: string):
  | Readonly<{
      documentFormat: LocalDocumentFormat;
      mediaType: LocalDocumentMediaType;
    }>
  | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return Object.freeze({
      documentFormat: 'markdown' as const,
      mediaType: 'text/markdown' as const,
    });
  }
  if (lower.endsWith('.txt')) {
    return Object.freeze({
      documentFormat: 'markdown' as const,
      mediaType: 'text/plain' as const,
    });
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return Object.freeze({
      documentFormat: 'html' as const,
      mediaType: 'text/html' as const,
    });
  }
  if (lower.endsWith('.pdf')) {
    return Object.freeze({
      documentFormat: 'pdf' as const,
      mediaType: 'application/pdf' as const,
    });
  }
  return undefined;
}

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

function encodeBase64(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const value = (first << 16) | (second << 8) | third;
    output += BASE64_ALPHABET.charAt((value >>> 18) & 63);
    output += BASE64_ALPHABET.charAt((value >>> 12) & 63);
    output +=
      index + 1 < bytes.length
        ? BASE64_ALPHABET.charAt((value >>> 6) & 63)
        : '=';
    output +=
      index + 2 < bytes.length ? BASE64_ALPHABET.charAt(value & 63) : '=';
  }
  return output;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}
