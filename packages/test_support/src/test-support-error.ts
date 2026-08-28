export const testSupportErrorCodes = {
  fixedClockInvalidInstant: 'FIXED_CLOCK_INVALID_INSTANT',
  finiteIdSourceDuplicate: 'FINITE_ID_SOURCE_DUPLICATE',
  finiteIdSourceExhausted: 'FINITE_ID_SOURCE_EXHAUSTED',
  finiteIdSourceInvalidId: 'FINITE_ID_SOURCE_INVALID_ID',
  finiteIdSourceUnconsumed: 'FINITE_ID_SOURCE_UNCONSUMED',
  scriptedHttpConsumptionExceeded: 'SCRIPTED_HTTP_CONSUMPTION_EXCEEDED',
  scriptedHttpDuplicateMatch: 'SCRIPTED_HTTP_DUPLICATE_MATCH',
  scriptedHttpInvalidRequest: 'SCRIPTED_HTTP_INVALID_REQUEST',
  scriptedHttpInvalidScript: 'SCRIPTED_HTTP_INVALID_SCRIPT',
  scriptedHttpLiveNetworkFallbackForbidden:
    'SCRIPTED_HTTP_LIVE_NETWORK_FALLBACK_FORBIDDEN',
  scriptedHttpUnexpectedRequest: 'SCRIPTED_HTTP_UNEXPECTED_REQUEST',
  scriptedHttpUnconsumedRequests: 'SCRIPTED_HTTP_UNCONSUMED_REQUESTS',
} as const;

export type TestSupportErrorCode =
  (typeof testSupportErrorCodes)[keyof typeof testSupportErrorCodes];

export class TestSupportError extends Error {
  readonly code: TestSupportErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: TestSupportErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'TestSupportError';
    this.code = code;
    this.details = Object.freeze({...details});
  }
}
