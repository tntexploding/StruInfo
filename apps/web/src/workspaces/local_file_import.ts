export const LOCAL_DOCUMENT_FILE_MAX_BYTES = 1_048_576;

const LOCAL_FILE_NAME_MAX_CODE_POINTS = 255;
const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export type LocalDocumentFormat = 'markdown' | 'html' | 'pdf';
export type LocalDocumentMediaType =
  'text/markdown' | 'text/plain' | 'text/html' | 'application/pdf';

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
      code:
        | 'file_name_invalid'
        | 'file_type_unsupported'
        | 'file_too_large'
        | 'file_utf8_invalid'
        | 'file_content_invalid';
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
