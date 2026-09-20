import type {AiProposalProviderConfig} from '../../config/runtime_config.js';

type ProviderConfig = Pick<AiProposalProviderConfig, 'providerKey'>;
export const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
export const DEEPSEEK_RESPONSES_ENDPOINT = 'https://api.deepseek.com/responses';

export function responsesEndpoint(config: ProviderConfig): string {
  return config.providerKey === 'deepseek-responses-v1'
    ? DEEPSEEK_RESPONSES_ENDPOINT
    : OPENAI_RESPONSES_ENDPOINT;
}

export function responsesOptions(
  config: ProviderConfig,
): Readonly<Record<string, unknown>> {
  // DeepSeek otherwise defaults to thinking, which consumes the bounded output budget.
  return config.providerKey === 'deepseek-responses-v1'
    ? {reasoning: {effort: 'none'}}
    : {};
}

export function responsesPromptVersion(
  config: ProviderConfig,
  openAiVersion: string,
): string {
  return config.providerKey === 'deepseek-responses-v1'
    ? openAiVersion.replace('openai-', 'deepseek-')
    : openAiVersion;
}
