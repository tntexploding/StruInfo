import type {HealthReadiness} from './health_contract.js';

export interface HealthRequestOptions {
  readonly signal?: AbortSignal;
}

export interface HealthClient {
  checkReadiness(options?: HealthRequestOptions): Promise<HealthReadiness>;
}

export type HealthFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class HealthConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HealthConfigurationError';
  }
}

export class HealthContractError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HealthContractError';
  }
}

export class HealthNetworkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HealthNetworkError';
  }
}

export class HealthResponseError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(
      `Operational health returned unsupported HTTP status ${status.toString()}.`,
    );
    this.name = 'HealthResponseError';
    this.status = status;
  }
}
