import {createHash} from 'node:crypto';
import {z} from 'zod';
import {isAiDispatchWait} from '../modules/processing/ai_price_policy.js';
import type {ExecutionAuthority} from './execution_authority.js';
import {OperationError} from './operation_error.js';

export const sourceDescriptionRequest = z
  .object({
    label: z.string().trim().min(1).max(80),
    kind: z.enum(['rss_atom', 'web', 'github_markdown', 'json_api', 'plugin']),
    isPrivate: z.boolean(),
    url: z.string().trim().max(2000).optional(),
    notes: z.string().trim().max(500).default(''),
  })
  .strict();
export interface SourceDescriptionEvidence {
  title: string;
  description: string;
  sampleTitles: string[];
  sampleExcerpts?: {title: string; text: string}[];
}
export interface SourceDescriptionProvider {
  describeSource(
    input: SourceDescriptionEvidence & {label: string; notes: string},
  ): Promise<{text: string}>;
}
export const sourceDescriptionResult = z
  .object({text: z.string().trim().min(1).max(500)})
  .strict();

/** Explicit, one-call draft generation. No subscription or document write port. */
export class SourceDescriptionService {
  private readonly running = new Map<
    string,
    Promise<{text: string; sampleCount: number}>
  >();
  public constructor(
    private readonly deps: {
      provider?: SourceDescriptionProvider;
      checkModelCall: () => Promise<void>;
      read: (
        kind: 'rss_atom' | 'web',
        url: string,
      ) => Promise<SourceDescriptionEvidence>;
    },
  ) {}

  public async generate(authority: ExecutionAuthority, input: unknown) {
    if (authority.identity.kind !== 'owner')
      throw new OperationError('forbidden', 'operation_not_authorized');
    authority.require('models.use');
    const parsed = sourceDescriptionRequest.safeParse(input);
    if (!parsed.success)
      throw new OperationError('invalid_input', 'source_description_invalid');
    const request = parsed.data;
    if (request.isPrivate)
      throw new OperationError('forbidden', 'private_model_transfer_forbidden');
    if (!this.deps.provider)
      throw new OperationError('rejected', 'ai_not_configured');
    const key = createHash('sha256')
      .update(JSON.stringify(request))
      .digest('hex');
    const active = this.running.get(key);
    if (active) return active;
    const work = this.describe(request).catch((error: unknown) => {
      if (isAiDispatchWait(error))
        throw new OperationError('rejected', error.code);
      throw error;
    });
    this.running.set(key, work);
    try {
      return await work;
    } finally {
      this.running.delete(key);
    }
  }

  private async describe(request: z.infer<typeof sourceDescriptionRequest>) {
    await this.deps.checkModelCall();
    let evidence: SourceDescriptionEvidence = {
      title: '',
      description: '',
      sampleTitles: [],
    };
    if (request.kind === 'rss_atom' || request.kind === 'web') {
      if (!request.url)
        throw new OperationError(
          'invalid_input',
          'source_description_url_required',
        );
      try {
        evidence = await this.deps.read(request.kind, request.url);
      } catch {
        throw new OperationError('rejected', 'source_description_read_failed');
      }
    }
    if (
      !evidence.description &&
      !evidence.sampleTitles.length &&
      !request.notes
    )
      throw new OperationError(
        'rejected',
        'source_description_evidence_required',
      );
    // Recheck after source I/O. The provider's dispatch wrapper checks once more
    // after waiting for its shared concurrency slot.
    await this.deps.checkModelCall();
    const result = sourceDescriptionResult.safeParse(
      await this.deps.provider?.describeSource({
        ...evidence,
        label: request.label,
        notes: request.notes,
      }),
    );
    if (!result.success)
      throw new OperationError('rejected', 'ai_provider_invalid_schema');
    return {...result.data, sampleCount: evidence.sampleTitles.length};
  }
}
