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
  public async executionSettings() {
    const {policy} = await this.status();
    return {
      maxConcurrentRequests: policy.maxConcurrentRequests ?? 1,
      automaticRetryLimit: policy.automaticRetryLimit ?? 0,
    };
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
  public async assertBackgroundOperationsAllowed() {
    const {policy} = await this.status();
    if (policy.operationsAllowed === false || policy.backgroundPaused)
      throw new AiOperationsPausedError();
  }
  public async assertBackgroundAllowed() {
    await this.assertBackgroundOperationsAllowed();
    await this.assertAllowed();
  }
  public async assertAssistantAllowed() {
    const status = await this.status();
    if (status.policy.operationsAllowed === false)
      throw new AiOperationsPausedError();
    if (status.blocked && status.policy.assistantPriceRestricted !== false)
      throw new AiPriceWindowClosedError();
  }
  public async save(
    authority: ExecutionAuthority,
    input: unknown,
    operationsOnly: boolean | 'execution' | 'assistant' | 'queue' = false,
  ) {
    if (
      authority.identity.kind !== 'owner' ||
      authority.workspaceId !== this.workspaceId
    )
      throw new OperationError('forbidden', 'ai_price_owner_required');
    const schema =
      operationsOnly === 'queue'
        ? aiPricePolicySchema.pick({revision: true}).extend({
            backgroundPaused:
              aiPricePolicySchema.shape.backgroundPaused.unwrap(),
          })
        : operationsOnly === 'assistant'
          ? aiPricePolicySchema.pick({revision: true}).extend({
              assistantPriceRestricted:
                aiPricePolicySchema.shape.assistantPriceRestricted.unwrap(),
            })
          : operationsOnly === 'execution'
            ? aiPricePolicySchema.pick({revision: true}).extend({
                maxConcurrentRequests:
                  aiPricePolicySchema.shape.maxConcurrentRequests.unwrap(),
                automaticRetryLimit:
                  aiPricePolicySchema.shape.automaticRetryLimit.unwrap(),
              })
            : operationsOnly
              ? aiPricePolicySchema.pick({revision: true}).extend({
                  operationsAllowed:
                    aiPricePolicySchema.shape.operationsAllowed.unwrap(),
                })
              : aiPricePolicySchema.pick({revision: true, enabled: true});
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
