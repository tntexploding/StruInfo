export const LOCAL_TEXT_FILE_MAX_BYTES = 1_048_576;

const LOCAL_FILE_NAME_MAX_CODE_POINTS = 255;
const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export type LocalTextFileMediaType = 'text/markdown' | 'text/plain';

export interface PreparedLocalTextFile {
  readonly fileName: string;
  readonly mediaType: LocalTextFileMediaType;
  readonly byteLength: number;
  readonly sourceText: string;
  readonly sourceBytes: Uint8Array;
}

export type PrepareLocalTextFileResult =
  | Readonly<{status: 'ready'; value: Readonly<PreparedLocalTextFile>}>
  | Readonly<{
      status: 'rejected';
      code:
        | 'file_name_invalid'
        | 'file_type_unsupported'
        | 'file_too_large'
        | 'file_utf8_invalid'
        | 'file_text_invalid';
    }>;

export interface ComposedLocalTextFileSource {
  readonly sourceBase64: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly defaultSourceKey: string;
  readonly composed: boolean;
}

export function prepareLocalTextFile(
  fileName: string,
  bytes: Uint8Array,
): PrepareLocalTextFileResult {
  const normalizedName = normalizeFileName(fileName);
  if (normalizedName === undefined) {
    return Object.freeze({status: 'rejected', code: 'file_name_invalid'});
  }
  const mediaType = mediaTypeForFileName(normalizedName);
  if (mediaType === undefined) {
    return Object.freeze({status: 'rejected', code: 'file_type_unsupported'});
  }
  if (bytes.byteLength > LOCAL_TEXT_FILE_MAX_BYTES) {
    return Object.freeze({status: 'rejected', code: 'file_too_large'});
  }
  const ownedBytes = Uint8Array.from(bytes);
  let sourceText: string;
  try {
    sourceText = new TextDecoder('utf-8', {fatal: true}).decode(ownedBytes);
  } catch {
    return Object.freeze({status: 'rejected', code: 'file_utf8_invalid'});
  }
  if (sourceText.includes('\u0000') || sourceText.trim().length === 0) {
    return Object.freeze({status: 'rejected', code: 'file_text_invalid'});
  }
  return Object.freeze({
    status: 'ready' as const,
    value: Object.freeze({
      fileName: normalizedName,
      mediaType,
      byteLength: ownedBytes.byteLength,
      sourceText,
      sourceBytes: ownedBytes,
    }),
  });
}

export async function composeLocalTextFileSource(
  file: Readonly<PreparedLocalTextFile>,
  prefix: string,
): Promise<Readonly<ComposedLocalTextFileSource> | undefined> {
  const normalizedPrefix = prefix.trim();
  const composed = normalizedPrefix !== '';
  const bytes = composed
    ? new TextEncoder().encode(`${normalizedPrefix}\n\n${file.sourceText}`)
    : Uint8Array.from(file.sourceBytes);
  if (bytes.byteLength > LOCAL_TEXT_FILE_MAX_BYTES) return undefined;
  const sha256 = await sha256Hex(bytes);
  return Object.freeze({
    sourceBase64: encodeBase64(bytes),
    byteLength: bytes.byteLength,
    sha256,
    defaultSourceKey: `${file.fileName}#sha256:${sha256}`,
    composed,
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

function mediaTypeForFileName(
  fileName: string,
): LocalTextFileMediaType | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return 'text/markdown';
  }
  return lower.endsWith('.txt') ? 'text/plain' : undefined;
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
