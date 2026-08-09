import {
  HealthConfigurationError,
  HealthContractError,
  type HealthClient,
  HealthNetworkError,
  HealthResponseError,
} from './health_client.js';
import type {
  HealthReadiness,
  NotReadyHealthResponse,
  ReadyHealthResponse,
} from './health_contract.js';

export type HealthPageState =
  | {readonly kind: 'loading'}
  | {readonly kind: 'ready'; readonly response: ReadyHealthResponse}
  | {
      readonly kind: 'not_ready';
      readonly reason: 'contract';
      readonly response: NotReadyHealthResponse;
    }
  | {readonly kind: 'not_ready'; readonly reason: 'offline'}
  | {
      readonly kind: 'unexpected_error';
      readonly reason: 'configuration' | 'contract' | 'http' | 'unknown';
    };

export const INITIAL_HEALTH_STATE: HealthPageState = {kind: 'loading'};

export type HealthStatePublisher = (state: HealthPageState) => void;

function mapReadiness(readiness: HealthReadiness): HealthPageState {
  if (readiness.status === 'ready') {
    return {kind: 'ready', response: readiness};
  }
  return {kind: 'not_ready', reason: 'contract', response: readiness};
}

function mapFailure(error: unknown): HealthPageState {
  if (error instanceof HealthNetworkError) {
    return {kind: 'not_ready', reason: 'offline'};
  }
  if (error instanceof HealthConfigurationError) {
    return {kind: 'unexpected_error', reason: 'configuration'};
  }
  if (error instanceof HealthContractError) {
    return {kind: 'unexpected_error', reason: 'contract'};
  }
  if (error instanceof HealthResponseError) {
    return {kind: 'unexpected_error', reason: 'http'};
  }
  return {kind: 'unexpected_error', reason: 'unknown'};
}

export async function runHealthCheck(
  client: HealthClient,
  publish: HealthStatePublisher,
  signal?: AbortSignal,
): Promise<void> {
  publish(INITIAL_HEALTH_STATE);
  try {
    const options = signal === undefined ? undefined : {signal};
    publish(mapReadiness(await client.checkReadiness(options)));
  } catch (error) {
    publish(mapFailure(error));
  }
}
