import {describe, expect, it} from 'vitest';

import {
  startOwnedResources,
  type ResourceStarter,
  type RuntimeResource,
} from './runtime_resource.js';

describe('startOwnedResources', () => {
  it('cleans a partial startup in reverse acquisition order', async () => {
    const events: string[] = [];
    const starters: ResourceStarter[] = [
      () => Promise.resolve(createResource('database', events)),
      () => Promise.resolve(createResource('queue', events)),
      () => Promise.reject(new Error('synthetic listener startup failure')),
    ];

    await expect(startOwnedResources(starters)).rejects.toThrow(
      'synthetic listener startup failure',
    );
    expect(events).toEqual(['close:queue', 'close:database']);
  });

  it('returns acquired resources in dependency order', async () => {
    const events: string[] = [];
    const resources = await startOwnedResources([
      () => Promise.resolve(createResource('database', events)),
      () => Promise.resolve(createResource('queue', events)),
      () => Promise.resolve(createResource('listener', events)),
    ]);

    expect(resources.map(({name}) => name)).toEqual([
      'database',
      'queue',
      'listener',
    ]);
  });
});

function createResource(name: string, events: string[]): RuntimeResource {
  return {
    name,
    stopAccepting: () => undefined,
    drain: () => undefined,
    close: () => {
      events.push(`close:${name}`);
    },
  };
}
