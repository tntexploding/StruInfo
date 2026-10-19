import {z} from 'zod';
import {parseResponseJson} from './response_json.js';
import {isAiDispatchWait} from '../../modules/processing/ai_price_policy.js';
import type {AiProposalProviderConfig} from '../../config/runtime_config.js';
import {OperationError} from '../../application/operation_error.js';
import {
  responsesEndpoint,
  responsesOptions,
} from './responses_configuration.js';
export async function requestStructuredResponse<T extends z.ZodType>(
  config: Readonly<AiProposalProviderConfig>,
  fetcher: typeof fetch,
  name: string,
  instructions: string,
  input: unknown,
  schema: T,
  formatErrors: 'generic' | 'detailed' = 'generic',
  limits: {maximumInputCodePoints?: number; maximumOutputTokens?: number} = {},
): Promise<z.infer<T>> {
  const formatFailure = (code: string) =>
    new OperationError(
      'rejected',
      formatErrors === 'detailed' ? code : 'ai_provider_invalid_response',
    );
  const source = JSON.stringify(input);
  if (Array.from(source).length > (limits.maximumInputCodePoints ?? 160_000))
    throw new OperationError('rejected', 'ai_intake_input_too_large');
  let response: Response;
  try {
    response = await fetcher(responsesEndpoint(config), {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + config.apiKey,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(config.timeoutMs),
      body: JSON.stringify({
        model: config.model,
        ...responsesOptions(config),
        store: false,
        max_output_tokens: limits.maximumOutputTokens ?? config.maxOutputTokens,
        instructions,
        input: source,
        text: {
          format: {
            type: 'json_schema',
            name,
            strict: true,
            schema: z.toJSONSchema(schema),
          },
        },
      }),
    });
  } catch (error) {
    if (isAiDispatchWait(error)) throw error;
    throw new OperationError('rejected', 'ai_provider_unavailable');
  }
  if (!response.ok)
    throw new OperationError('rejected', 'ai_provider_rejected');
  if (Number(response.headers.get('content-length') ?? 0) > 1_048_576)
    throw new OperationError('rejected', 'ai_provider_invalid_response');
  const text = await response.text();
  if (Buffer.byteLength(text) > 1_048_576)
    throw new OperationError('rejected', 'ai_provider_invalid_response');
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw formatFailure('ai_provider_invalid_envelope');
  }
  const envelope = z
    .object({status: z.string(), output: z.array(z.unknown())})
    .safeParse(raw);
  if (!envelope.success) throw formatFailure('ai_provider_invalid_envelope');
  if (envelope.data.status === 'incomplete')
    throw formatFailure('ai_provider_incomplete_response');
  if (envelope.data.status !== 'completed')
    throw formatFailure('ai_provider_invalid_envelope');
  const texts: string[] = [];
  for (const message of envelope.data.output) {
    const m = z
      .object({type: z.literal('message'), content: z.array(z.unknown())})
      .safeParse(message);
    if (!m.success) continue;
    for (const part of m.data.content) {
      const p = z
        .object({type: z.literal('output_text'), text: z.string()})
        .safeParse(part);
      if (p.success) texts.push(p.data.text);
    }
  }
  if (texts.length !== 1) throw formatFailure('ai_provider_invalid_envelope');
  let payload: unknown;
  try {
    payload = parseResponseJson(texts[0] ?? '');
  } catch {
    throw formatFailure('ai_provider_invalid_json');
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw formatFailure('ai_provider_invalid_schema');
  return parsed.data;
}
