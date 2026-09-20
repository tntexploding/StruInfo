import {
  type ProcessingRun,
  type ProcessingRunRepositoryPort,
} from '../modules/processing/index.js';

import type {ExecutionAuthority} from './execution_authority.js';
import {
  OperationError,
  assertOperationId,
  assertOperationVersion,
} from './operation_error.js';
export interface ProcessingUseCasesDependencies {
  readonly processingRunRepository: ProcessingRunRepositoryPort;
}

export class ProcessingUseCases {
  readonly #dependencies: Readonly<ProcessingUseCasesDependencies>;
  readonly #authority: ExecutionAuthority;
  public constructor(
    authority: ExecutionAuthority,
    dependencies: Readonly<ProcessingUseCasesDependencies>,
  ) {
    this.#authority = authority;
    this.#dependencies = dependencies;
  }
  /** A bounded recent window; private runs are omitted unless this call opts in. */
  public async list(
    limit = 20,
    includePrivate = false,
  ): Promise<readonly Readonly<ProcessingRun>[]> {
    this.#authority.require('processing.read', includePrivate);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new OperationError('invalid_input', 'invalid_request', 'limit');
    const runs =
      await this.#dependencies.processingRunRepository.listRecentRuns(
        this.#authority.workspaceId,
        limit,
      );
    return Object.freeze(
      runs.filter(
        (run) => includePrivate || run.privacyScope === 'public_only',
      ),
    );
  }
  public async cancel(runId: string, expectedVersion: number) {
    this.#authority.require('processing.cancel');
    assertOperationId(runId, 'runId');
    assertOperationVersion(expectedVersion, 'expectedVersion');
    const outcome = await this.#dependencies.processingRunRepository.cancelRun(
      this.#authority.workspaceId,
      runId,
      expectedVersion,
    );
    if (outcome === 'not_found')
      throw new OperationError('not_found', 'processing_run_not_found');
    if (outcome === 'stale')
      throw new OperationError('conflict', 'stale_processing_run_version');
    if (outcome === 'terminal')
      throw new OperationError('conflict', 'processing_run_terminal');
    if (outcome !== 'applied')
      throw new Error('Processing cancellation was not applied.');
    return Object.freeze({
      status: 'cancelled' as const,
      runId,
      version: expectedVersion + 1,
    });
  }
}
