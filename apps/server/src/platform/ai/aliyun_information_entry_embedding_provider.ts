import type {InformationEntryEmbeddingProviderPort} from '../../modules/entries/index.js';
import {INFORMATION_ENTRY_EMBEDDING_INPUT_MAXIMUM_UTF8_BYTES} from '../../modules/entries/information_entry_search_index_contract.js';
import {embeddingSettingsSchema} from '../../modules/processing/ai_price_policy.js';
import type {z} from 'zod';
import {decodeEmbeddings} from './openai_information_entry_embedding_provider.js';
import {OperationError} from '../../application/operation_error.js';

export const ALIYUN_EMBEDDING_MODEL = 'qwen3.7-text-embedding';
export const ALIYUN_EMBEDDING_DIMENSIONS = 1024;

/** Batched public-text embeddings; the shared index owns scheduling and checkpoints. */
export class AliyunInformationEntryEmbeddingProvider implements InformationEntryEmbeddingProviderPort {
  readonly providerKey = 'aliyun-embeddings-1024-v1';
  readonly model = ALIYUN_EMBEDDING_MODEL;
  // Bound the whole index batch by UTF-8 bytes, without splitting a paid call internally.
  readonly maximumBatchSize = Math.min(
    20,
    Math.floor(128_000 / INFORMATION_ENTRY_EMBEDDING_INPUT_MAXIMUM_UTF8_BYTES),
  );
  constructor(
    private readonly apiKey: string,
    private readonly settings: () => Promise<
      z.infer<typeof embeddingSettingsSchema>
    >,
    private readonly fetcher: typeof fetch,
  ) {}
  async embed(
    inputs: readonly string[],
  ): Promise<readonly (readonly number[])[]> {
    if (
      !inputs.length ||
      inputs.length > 20 ||
      inputs.some((s) => !s.trim()) ||
      inputs.reduce((n, s) => n + Buffer.byteLength(s), 0) > 128_000
    )
      throw new OperationError('invalid_input', 'embedding_input_too_large');
    const settings = embeddingSettingsSchema.parse(await this.settings());
    if (!settings.enabled || !settings.baseUrl)
      throw new OperationError('rejected', 'embedding_disabled');
    const response = await this.fetcher(settings.baseUrl + '/embeddings', {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: inputs,
        dimensions: ALIYUN_EMBEDDING_DIMENSIONS,
        encoding_format: 'float',
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new OperationError('rejected', 'embedding_provider_rejected');
    const source = await response.text();
    if (Buffer.byteLength(source) > 8_388_608)
      throw new OperationError('rejected', 'embedding_response_too_large');
    const decoded = decodeEmbeddings(JSON.parse(source), inputs.length);
    if (decoded.some((v) => v.length !== ALIYUN_EMBEDDING_DIMENSIONS))
      throw new OperationError('rejected', 'embedding_dimensions_mismatch');
    return decoded;
  }
}
