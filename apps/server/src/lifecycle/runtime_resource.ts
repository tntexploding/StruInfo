export interface RuntimeResource {
  readonly name: string;
  stopAccepting(): void | Promise<void>;
  drain(): void | Promise<void>;
  close(): void | Promise<void>;
}

export type ResourceStarter = () => Promise<RuntimeResource>;

export async function startOwnedResources(
  starters: readonly ResourceStarter[],
): Promise<readonly RuntimeResource[]> {
  const resources: RuntimeResource[] = [];
  try {
    for (const start of starters) {
      resources.push(await start());
    }
    return resources;
  } catch (startupFailure) {
    const cleanupFailures = await closeResourcesInReverse(resources);
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [toError(startupFailure), ...cleanupFailures],
        'Runtime startup and cleanup failed.',
        {cause: startupFailure},
      );
    }
    throw toError(startupFailure);
  }
}

export async function closeResourcesInReverse(
  resources: readonly RuntimeResource[],
): Promise<readonly Error[]> {
  const failures: Error[] = [];
  for (const resource of [...resources].reverse()) {
    try {
      await resource.close();
    } catch (error) {
      failures.push(toError(error));
    }
  }
  return failures;
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error('Unknown runtime failure.');
}
