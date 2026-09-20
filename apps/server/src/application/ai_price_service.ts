import {
  AiPriceWindowClosedError,
  AiOperationsPausedError,
  aiPricePolicySchema,
  aiPriceWindow,
  DEFAULT_AI_PRICE_POLICY,
} from '../modules/processing/ai_price_policy.js';
import {
  patchReviewPreferences,
  updateReviewPreferences,
  type ReviewPreferencesStore,
} from '../storage/review_preferences_store.js';
import type {ExecutionAuthority} from './execution_authority.js';
import {OperationError} from './operation_error.js';

/** Price restrictions do not grant permission to process additional material. */
export class AiPriceService {
  public constructor(
    private readonly workspaceId: string,
    private readonly preferences: ReviewPreferencesStore,
    private readonly provider: string | undefined,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async status() {
    const policy =
      (await this.preferences.load(this.workspaceId)).aiPricePolicy ??
      DEFAULT_AI_PRICE_POLICY;
    return aiPriceWindow(policy, this.provider, this.now());
  }
  public async assertOperationsAllowed() {
    if ((await this.status()).policy.operationsAllowed === false)
      throw new AiOperationsPausedError();
  }
  public async assertAllowed() {
    const status = await this.status();
    if (status.policy.operationsAllowed === false)
      throw new AiOperationsPausedError();
    if (status.blocked) throw new AiPriceWindowClosedError();
  }
  public async save(
    authority: ExecutionAuthority,
    input: unknown,
    operationsOnly = false,
  ) {
    if (
      authority.identity.kind !== 'owner' ||
      authority.workspaceId !== this.workspaceId
    )
      throw new OperationError('forbidden', 'ai_price_owner_required');
    const schema = operationsOnly
      ? aiPricePolicySchema.pick({revision: true}).extend({
          operationsAllowed:
            aiPricePolicySchema.shape.operationsAllowed.unwrap(),
        })
      : aiPricePolicySchema.omit({operationsAllowed: true});
    const parsed = schema.safeParse(input);
    if (!parsed.success || parsed.data.revision >= 2147483646)
      throw new OperationError('invalid_input', 'invalid_ai_price_policy');
    await updateReviewPreferences(
      this.preferences,
      this.workspaceId,
      (current) => {
        const previous = current.aiPricePolicy ?? DEFAULT_AI_PRICE_POLICY;
        if (previous.revision !== parsed.data.revision)
          throw new OperationError('conflict', 'stale_ai_price_policy');
        return {
          next: patchReviewPreferences(current, {
            aiPricePolicy: {
              ...previous,
              ...parsed.data,
              revision: previous.revision + 1,
            },
          }),
          result: undefined,
        };
      },
    );
    return this.status();
  }
}
