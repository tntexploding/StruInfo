import {entryTagWords} from './entry_tags.js';
import {createHash} from 'node:crypto';

import {informationEntrySearchKey} from './information_entry.js';
import type {CurrentInformationEntry} from './information_entry_contract.js';
import {
  INFORMATION_ENTRY_EMBEDDING_INPUT_MAXIMUM_UTF8_BYTES,
  INFORMATION_ENTRY_TERM_MAXIMUM_POSTINGS_PER_ENTRY,
  INFORMATION_ENTRY_TERM_TOKENIZER_VERSION,
  type InformationEntrySearchIndexField,
  type InformationEntryEmbeddingChunk,
  type InformationEntrySearchProjection,
  type InformationEntryTermPosting,
  type PreparedInformationEntrySearchProjection,
} from './information_entry_search_index_contract.js';

const WORD_CHARACTER = /^[\p{Letter}\p{Mark}\p{Number}]$/u;
const IDEOGRAPHIC_CHARACTER =
  /^(?:\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul})$/u;
const textEncoder = new TextEncoder();

export function tokenizeInformationEntryText(text: string): readonly string[] {
  const normalized = informationEntrySearchKey(text);
  const tokens: string[] = [];
  let word = '';
  let ideographicRun: string[] = [];
  const flushWord = (): void => {
    if (word !== '') tokens.push(word);
    word = '';
  };
  const flushIdeographic = (): void => {
    for (let index = 0; index < ideographicRun.length; index += 1) {
      const current = ideographicRun[index];
      if (current !== undefined) tokens.push(current);
      const next = ideographicRun[index + 1];
      if (current !== undefined && next !== undefined) {
        tokens.push(`${current}${next}`);
      }
    }
    ideographicRun = [];
  };

  for (const character of Array.from(normalized)) {
    if (IDEOGRAPHIC_CHARACTER.test(character)) {
      flushWord();
      ideographicRun.push(character);
      continue;
    }
    flushIdeographic();
    if (WORD_CHARACTER.test(character)) {
      word += character;
    } else {
      flushWord();
    }
  }
  flushWord();
  flushIdeographic();
  return Object.freeze(tokens.filter((token) => token.length <= 80));
}

export function prepareInformationEntrySearchProjection(
  entry: Readonly<CurrentInformationEntry>,
): Readonly<PreparedInformationEntrySearchProjection> {
  if (entry.value.isPrivate) {
    throw new Error('Private Entries cannot enter the derived search index.');
  }
  const tags = entryTagWords(entry.value);
  const tagText = tags.join(' ');
  const fields = Object.freeze({
    title: entry.value.titlePath,
    body: entry.value.body,
    tags: tagText,
  });
  const postings = createPostings(entry.entryId, fields);
  const chunks = informationEntryEmbeddingChunks(entry);
  return Object.freeze({
    entry,
    chunks,
    projection: Object.freeze({
      entryId: entry.entryId,
      entryRevision: entry.revision,
      entryRevisionId: entry.revisionId,
      projectionSha256: createHash('sha256')
        .update(
          JSON.stringify(chunks.map((chunk) => chunk.inputSha256)),
          'utf8',
        )
        .digest('hex'),
      tokenizerVersion: INFORMATION_ENTRY_TERM_TOKENIZER_VERSION,
      embeddingChunkCount: chunks.length,
    }),
    postings,
  });
}

export function informationEntryEmbeddingChunks(
  entry: Readonly<CurrentInformationEntry>,
): PreparedInformationEntrySearchProjection['chunks'] {
  if (entry.value.isPrivate)
    throw new Error('Private Entries cannot enter the derived search index.');
  const tags = entryTagWords(entry.value);
  const tagText = tags.join(' ');
  const tagBudget = 1_600;
  const embeddedTags =
    Buffer.byteLength(tagText, 'utf8') <= tagBudget
      ? tagText
      : tags
          .map(
            (tag) =>
              truncateUtf8(tag, Math.floor(tagBudget / tags.length) - 4) + '…',
          )
          .join(' ');
  const metadata = `标题\n${truncateUtf8(entry.value.titlePath, 800)}\n\n标签\n${embeddedTags}\n\n正文\n`;
  const maximum =
    INFORMATION_ENTRY_EMBEDDING_INPUT_MAXIMUM_UTF8_BYTES -
    Buffer.byteLength(metadata, 'utf8');
  const body = entry.value.body;
  const chunks: PreparedInformationEntrySearchProjection['chunks'][number][] =
    [];
  let start = 0;
  do {
    const bounded = truncateUtf8(
      Array.from(body.slice(start, start + 6001))
        .slice(0, 3000)
        .join(''),
      maximum,
    );
    let length = bounded.length;
    if (start + length < body.length) {
      for (const separator of ['\n\n', '\n', '。', '. ', ' ']) {
        const boundary = bounded.lastIndexOf(separator);
        if (boundary >= length * 0.6) {
          length = boundary + separator.length;
          break;
        }
      }
    }
    const end = start + length;
    const input = metadata + body.slice(start, end);
    chunks.push(
      Object.freeze({
        start,
        end,
        input,
        inputSha256: createHash('sha256').update(input, 'utf8').digest('hex'),
      }),
    );
    start = end;
  } while (start < body.length);
  return Object.freeze(chunks);
}

export function hasCurrentInformationEntryEmbeddingInput(
  entry: Readonly<CurrentInformationEntry>,
  projection: Readonly<InformationEntrySearchProjection>,
): boolean {
  return (
    createHash('sha256')
      .update(
        JSON.stringify(
          informationEntryEmbeddingChunks(entry).map(
            (chunk) => chunk.inputSha256,
          ),
        ),
        'utf8',
      )
      .digest('hex') === projection.projectionSha256
  );
}

export function withInformationEntryEmbedding(
  projection: Readonly<InformationEntrySearchProjection>,
  providerKey: string,
  model: string,
  embedding: readonly Readonly<InformationEntryEmbeddingChunk>[],
): Readonly<InformationEntrySearchProjection> {
  if (!embedding.length || embedding.length > projection.embeddingChunkCount)
    throw new Error('Invalid embedding chunks.');
  const dimensions = embedding[0]?.vector.length;
  const ranges = new Set<number>();
  for (const chunk of embedding) {
    validateEmbedding(chunk.vector);
    if (
      !Number.isSafeInteger(chunk.start) ||
      !Number.isSafeInteger(chunk.end) ||
      chunk.start < 0 ||
      chunk.end < chunk.start ||
      ranges.has(chunk.start) ||
      !/^[a-f0-9]{64}$/u.test(chunk.inputSha256) ||
      chunk.vector.length !== dimensions
    )
      throw new Error('Invalid embedding chunk.');
    ranges.add(chunk.start);
  }
  return Object.freeze({
    ...projection,
    embeddingProvider: providerKey,
    embeddingModel: model,
    embedding: Object.freeze(
      embedding.map((chunk) =>
        Object.freeze({...chunk, vector: Object.freeze([...chunk.vector])}),
      ),
    ),
  });
}

export function cosineSimilarityBasisPoints(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftLength = 0;
  let rightLength = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (
      leftValue === undefined ||
      rightValue === undefined ||
      !Number.isFinite(leftValue) ||
      !Number.isFinite(rightValue)
    ) {
      return 0;
    }
    dot += leftValue * rightValue;
    leftLength += leftValue * leftValue;
    rightLength += rightValue * rightValue;
  }
  if (leftLength === 0 || rightLength === 0) return 0;
  const similarity = dot / Math.sqrt(leftLength * rightLength);
  return Math.max(0, Math.min(10_000, Math.round(similarity * 10_000)));
}

function createPostings(
  entryId: string,
  fields: Readonly<Record<InformationEntrySearchIndexField, string>>,
): readonly Readonly<InformationEntryTermPosting>[] {
  const postings: InformationEntryTermPosting[] = [];
  for (const field of ['tags', 'title', 'body'] as const) {
    const counts = new Map<string, number>();
    for (const term of tokenizeInformationEntryText(fields[field])) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
    for (const [term, occurrences] of [...counts.entries()].sort(
      ([left], [right]) => compareUnsignedUtf8(left, right),
    )) {
      postings.push(Object.freeze({entryId, field, term, occurrences}));
      if (
        postings.length >= INFORMATION_ENTRY_TERM_MAXIMUM_POSTINGS_PER_ENTRY
      ) {
        return Object.freeze(postings);
      }
    }
  }
  return Object.freeze(postings);
}

function compareUnsignedUtf8(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const leftByte = leftBytes[index] ?? 0;
    const rightByte = rightBytes[index] ?? 0;
    if (leftByte !== rightByte) return leftByte - rightByte;
  }
  return leftBytes.length - rightBytes.length;
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maximumBytes) return value;
  const output: string[] = [];
  let bytes = 0;
  for (const character of Array.from(value)) {
    const next = Buffer.byteLength(character, 'utf8');
    if (bytes + next > maximumBytes) break;
    output.push(character);
    bytes += next;
  }
  return output.join('');
}

export function isUsableInformationEntryEmbedding(
  embedding: readonly number[] | undefined,
): embedding is readonly number[] {
  return (
    embedding !== undefined &&
    embedding.length > 0 &&
    embedding.length <= 16_384 &&
    embedding.every(Number.isFinite)
  );
}

function validateEmbedding(embedding: readonly number[]): void {
  if (
    embedding.length < 1 ||
    embedding.length > 16_384 ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new Error('Invalid Information Entry embedding.');
  }
}
