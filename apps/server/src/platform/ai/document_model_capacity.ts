import type {AiProposalProviderConfig} from '../../config/runtime_config.js';

/** Known 1M-context models; unknown/provider-switched models keep the old bound. */
export function documentModelInputLimit(
  config: Readonly<AiProposalProviderConfig>,
) {
  return config.providerKey === 'deepseek-responses-v1' &&
    /^(?:deepseek-flash|deepseek-v4(?:\.1)?-(?:flash|pro)(?:-\d+)?)$/u.test(
      config.model,
    )
    ? 360_000
    : 160_000;
}
