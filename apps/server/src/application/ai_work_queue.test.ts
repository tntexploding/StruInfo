import {AsyncLocalStorage} from 'node:async_hooks';
import {expect, it} from 'vitest';
import {AiWorkQueue} from './ai_work_queue.js';

it('keeps each queued request in its own budget and source context', async () => {
  const context = new AsyncLocalStorage<string>();
  const queue = new AiWorkQueue(() => Promise.resolve(1));
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = context.run('first', () =>
    queue.run(async () => {
      await gate;
      return context.getStore();
    }),
  );
  const second = context.run('second', () =>
    queue.run(() => Promise.resolve(context.getStore())),
  );
  if (!release) throw new Error('Missing gate');
  release();
  expect(await first).toBe('first');
  expect(await second).toBe('second');
  expect(context.getStore()).toBeUndefined();
});
