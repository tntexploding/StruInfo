import type {InformationEntryEmbeddingProviderPort} from '../../modules/entries/index.js';
import type {EmbeddingProviderConfig} from '../../config/runtime_config.js';
import type {OpenAiFetch} from './openai_entry_tag_provider.js';

export const OPENAI_EMBEDDINGS_ENDPOINT =
  'https://api.openai.com/v1/embeddings' as const;
const MAXIMUM_RESPONSE_BYTES = 8 * 1024 * 1024;

export class OpenAiInformationEntryEmbeddingProvider implements InformationEntryEmbeddingProviderPort {
  public readonly providerKey = 'openai-embeddings-v1' as const;
  public readonly model: string;
  readonly #config: Readonly<EmbeddingProviderConfig>;
  readonly #fetch: OpenAiFetch;

  public constructor(
    config: Readonly<EmbeddingProviderConfig>,
    fetchImplementation: OpenAiFetch = globalThis.fetch,
  ) {
    this.#config = config;
    this.#fetch = fetchImplementation;
    this.model = config.model;
  }

  public async embed(
    inputs: readonly string[],
  ): Promise<readonly (readonly number[])[]> {
    if (
      inputs.length < 1 ||
      inputs.length > this.#config.maximumBatchSize ||
      inputs.some((input) => input.length === 0)
    ) {
      throw new Error('Invalid embedding input.');
    }
    let response: Response;
    try {
      response = await this.#fetch(OPENAI_EMBEDDINGS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.#config.model,
          input: inputs,
          encoding_format: 'float',
        }),
        signal: AbortSignal.timeout(this.#config.timeoutMs),
      });
    } catch {
      throw new Error('Embedding provider unavailable.');
    }
    if (!response.ok) throw new Error('Embedding provider rejected request.');
    const length = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(length) && length > MAXIMUM_RESPONSE_BYTES) {
      throw new Error('Embedding provider response too large.');
    }
    const source = await response.text();
    if (new TextEncoder().encode(source).byteLength > MAXIMUM_RESPONSE_BYTES) {
      throw new Error('Embedding provider response too large.');
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(source) as unknown;
    } catch {
      throw new Error('Embedding provider returned invalid JSON.');
    }
    return decodeEmbeddings(envelope, inputs.length);
  }
}

function decodeEmbeddings(
  value: unknown,
  expectedCount: number,
): readonly (readonly number[])[] {
  if (!isRecord(value) || !Array.isArray(value.data)) fail();
  const ordered: (readonly number[] | undefined)[] = Array.from({
    length: expectedCount,
  });
  let dimensions: number | undefined;
  for (const item of value.data) {
    if (
      !isRecord(item) ||
      typeof item.index !== 'number' ||
      !Number.isSafeInteger(item.index) ||
      item.index < 0 ||
      item.index >= expectedCount ||
      ordered[item.index] !== undefined ||
      !isFiniteNumberArray(item.embedding) ||
      item.embedding.length < 1 ||
      item.embedding.length > 16_384
    ) {
      fail();
    }
    dimensions ??= item.embedding.length;
    if (item.embedding.length !== dimensions) fail();
    ordered[item.index] = Object.freeze([...item.embedding] as number[]);
  }
  if (ordered.some((embedding) => embedding === undefined)) fail();
  return Object.freeze(ordered as readonly (readonly number[])[]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (component: unknown) =>
        typeof component === 'number' && Number.isFinite(component),
    )
  );
}

function fail(): never {
  throw new Error('Embedding provider returned an invalid response.');
}
