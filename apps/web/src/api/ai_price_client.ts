export interface AiPriceStatus {
  policy: {revision: number; enabled: boolean};
  rule: string;
  timeZone: 'Asia/Shanghai';
  provider: string | null;
  applicable: boolean;
  peak: boolean;
  blocked: boolean;
  checkedAt: string;
  nextAllowedAt: string | null;
}
export async function aiPriceCommand(
  operation: 'ai_price_status' | 'ai_price_save',
  input: object = {},
): Promise<AiPriceStatus> {
  const response = await fetch('/api/v1/ai-price/commands', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({operation, input}),
  });
  const value = record(await response.json());
  const result = record(value?.result);
  const policy = record(result?.policy);
  if (
    !response.ok ||
    !result ||
    !policy ||
    typeof policy.revision !== 'number' ||
    !Number.isSafeInteger(policy.revision) ||
    policy.revision < 0 ||
    typeof policy.enabled !== 'boolean' ||
    typeof result.blocked !== 'boolean' ||
    typeof result.applicable !== 'boolean' ||
    typeof result.peak !== 'boolean' ||
    result.timeZone !== 'Asia/Shanghai' ||
    typeof result.rule !== 'string' ||
    (result.provider !== null && typeof result.provider !== 'string') ||
    !validDate(result.checkedAt) ||
    (result.nextAllowedAt !== null && !validDate(result.nextAllowedAt)) ||
    (result.blocked && result.nextAllowedAt === null)
  ) {
    const error = record(value?.error);
    throw new Error(
      typeof error?.code === 'string' ? error.code : 'ai_price_unavailable',
    );
  }
  return {
    policy: {revision: policy.revision, enabled: policy.enabled},
    rule: result.rule,
    timeZone: result.timeZone,
    provider: result.provider,
    applicable: result.applicable,
    peak: result.peak,
    blocked: result.blocked,
    checkedAt: result.checkedAt,
    nextAllowedAt: result.nextAllowedAt,
  };
}
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
