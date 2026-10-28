import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {LocalModelUsageJournal} from './model_usage_journal.js';
import {priceAwareFetch} from './price_aware_fetch.js';
import {modelUsageScope} from './model_usage_scope.js';
import type {TopicUsage} from '../../modules/entries/content_topics.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const directories: string[] = [];
const request = JSON.stringify({
  model: 'synthetic-model',
  input: 'Synthetic source',
  max_output_tokens: 800,
  text: {format: {name: 'synthetic_review'}},
});
async function fixture(limitCny = 1) {
  const root = await mkdtemp(join(tmpdir(), 'struinfo-usage-'));
  directories.push(root);
  const budgetPath = join(root, workspaceId + '.ai-batch-budget.json');
  const journalPath = join(root, workspaceId + '.ai-usage.jsonl');
  await writeFile(
    budgetPath,
    JSON.stringify({
      format: 'struinfo.ai-batch-budget.v1',
      workspaceId,
      batchId: 'synthetic-pilot',
      model: 'synthetic-model',
      paused: false,
      limitCny,
      inputCnyPerMillion: 1,
      cachedInputCnyPerMillion: 0.02,
      outputCnyPerMillion: 4,
    }),
  );
  return {
    root,
    budgetPath,
    journalPath,
    store: new LocalModelUsageJournal(root, workspaceId),
  };
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((root) => rm(root, {recursive: true, force: true})),
  );
});

describe('bounded model usage journal', () => {
  it('requires the selected existing budget and reports one scoped reservation/settlement', async () => {
    const {store} = await fixture();
    const record = vi.fn<(usage: TopicUsage) => Promise<void>>(() =>
      Promise.resolve(),
    );
    await expect(
      modelUsageScope.run({batchId: 'wrong-batch', record}, () =>
        store.reserve(request),
      ),
    ).rejects.toMatchObject({code: 'ai_batch_budget_paused'});
    await modelUsageScope.run(
      {batchId: 'synthetic-pilot', record},
      async () => {
        const ticket = await store.reserve(request);
        expect(ticket).toBeDefined();
        if (!ticket) throw new Error('ticket');
        await store.settle(
          ticket,
          200,
          new TextEncoder().encode(
            JSON.stringify({usage: {input_tokens: 100, output_tokens: 20}}),
          ),
        );
        await store.settle(ticket, 200);
      },
    );
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      batchId: 'synthetic-pilot',
    });
    expect(record.mock.calls[1]?.[0]).toMatchObject({
      chargedNanoCny: 180000,
      usageKnown: true,
    });
  });
  it('keeps an off-peak budget behind the tariff gate even if general settings change', async () => {
    const {root, budgetPath} = await fixture();
    const saved = JSON.parse(await readFile(budgetPath, 'utf8')) as Record<
      string,
      unknown
    >;
    await writeFile(budgetPath, JSON.stringify({...saved, offPeakOnly: true}));
    const peak = new LocalModelUsageJournal(
      root,
      workspaceId,
      () => new Date('2026-09-28T02:00:00Z'),
    );
    await expect(peak.reserve(request)).rejects.toMatchObject({
      code: 'ai_price_window_closed',
    });
    const low = new LocalModelUsageJournal(
      root,
      workspaceId,
      () => new Date('2026-09-27T02:00:00Z'),
    );
    expect(await low.reserve(request)).toBeDefined();
  });
  it('reserves before dispatch and settles actual cached usage without recording content', async () => {
    const {store, journalPath} = await fixture();
    const usage = {
      input_tokens: 1000,
      output_tokens: 100,
      input_tokens_details: {cached_tokens: 800},
    };
    const ticket = await store.reserve(request);
    if (!ticket) throw Error('expected reservation');
    await store.settle(
      ticket,
      200,
      new TextEncoder().encode(
        JSON.stringify({usage, output: 'secret synthetic response'}),
      ),
    );
    const text = await readFile(journalPath, 'utf8');
    const rows = text
      .trim()
      .split('\n')
      .map((s) => JSON.parse(s) as {chargedNanoCny: number});
    expect(rows).toHaveLength(2);
    expect(rows[1]?.chargedNanoCny).toBe(616000);
    expect(text).not.toContain('secret synthetic response');
    expect(text).not.toContain('Synthetic source');
    await store.settle(ticket, 200);
    expect(await readFile(journalPath, 'utf8')).toBe(text);
  });
  it('serializes concurrent reservations and retains crash-time reservations after restart', async () => {
    const {root, store} = await fixture(0.009);
    const results = await Promise.allSettled([
      store.reserve(request),
      store.reserve(request),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    await expect(
      new LocalModelUsageJournal(root, workspaceId).reserve(request),
    ).rejects.toMatchObject({code: 'ai_batch_budget_paused'});
  });
  it.each([
    undefined,
    {
      input_tokens: 1,
      output_tokens: 1,
      input_tokens_details: {cached_tokens: 2},
    },
  ])(
    'keeps the conservative charge when usage is absent or invalid',
    async (usage) => {
      const {store, journalPath} = await fixture();
      const ticket = await store.reserve(request);
      if (!ticket) throw Error('expected reservation');
      await store.settle(
        ticket,
        200,
        new TextEncoder().encode(JSON.stringify({usage})),
      );
      const lines = (await readFile(journalPath, 'utf8')).trim().split('\n');
      expect(JSON.parse(lines[1] ?? '')).toMatchObject({
        usageKnown: false,
        chargedNanoCny: ticket.record.reservedNanoCny,
      });
    },
  );
  it('fails closed on a corrupt budget or journal and never dispatches', async () => {
    const {store, journalPath, budgetPath} = await fixture();
    const network = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('{}')),
    );
    const dispatch = priceAwareFetch(
      {assertAllowed: () => Promise.resolve()},
      network,
      store,
    );
    await writeFile(journalPath, '{broken\n');
    await expect(
      dispatch('https://example.invalid/model', {body: request}),
    ).rejects.toMatchObject({code: 'ai_batch_budget_paused'});
    await writeFile(budgetPath, '{broken');
    await expect(
      dispatch('https://example.invalid/model', {body: request}),
    ).rejects.toMatchObject({code: 'ai_batch_budget_paused'});
    expect(network).not.toHaveBeenCalled();
  });
  it('settles HTTP and network failures without losing reservations', async () => {
    const {store, journalPath} = await fixture();
    const network = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(new Response('{}', {status: 429}));
    const dispatch = priceAwareFetch(
      {assertAllowed: () => Promise.resolve()},
      network,
      store,
    );
    await expect(
      dispatch('https://example.invalid/model', {body: request}),
    ).rejects.toThrow('timeout');
    await expect(
      dispatch('https://example.invalid/model', {body: request}),
    ).rejects.toMatchObject({code: 'ai_provider_unavailable'});
    const rows = (await readFile(journalPath, 'utf8'))
      .trim()
      .split('\n')
      .map((s) => JSON.parse(s) as {kind: string; usageKnown?: boolean});
    expect(rows.filter((r) => r.kind === 'reserved')).toHaveLength(2);
    expect(
      rows.filter((r) => r.kind === 'settled' && r.usageKnown === false),
    ).toHaveLength(2);
  });
  it('does not discard a paid response when settlement storage fails', async () => {
    const {store} = await fixture();
    vi.spyOn(store, 'settle').mockRejectedValue(new Error('disk unavailable'));
    const dispatch = priceAwareFetch(
      {assertAllowed: () => Promise.resolve()},
      () => Promise.resolve(new Response('synthetic paid result')),
      store,
    );
    expect(
      await (
        await dispatch('https://example.invalid/model', {body: request})
      ).text(),
    ).toBe('synthetic paid result');
  });
  it.each([400, 401, 402, 403])(
    'pauses the batch after HTTP %d rejection, including after restart',
    async (status) => {
      const {root, store, budgetPath} = await fixture();
      const network = vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response('{}', {status})),
      );
      const dispatch = priceAwareFetch(
        {assertAllowed: () => Promise.resolve()},
        network,
        store,
      );
      expect(
        (await dispatch('https://example.invalid/model', {body: request}))
          .status,
      ).toBe(status);
      await expect(
        dispatch('https://example.invalid/model', {body: request}),
      ).rejects.toMatchObject({code: 'ai_batch_budget_paused'});
      await expect(
        new LocalModelUsageJournal(root, workspaceId).reserve(request),
      ).rejects.toMatchObject({code: 'ai_batch_budget_paused'});
      expect(network).toHaveBeenCalledTimes(1);
      const saved = JSON.parse(await readFile(budgetPath, 'utf8')) as Record<
        string,
        unknown
      >;
      expect(saved).toMatchObject({paused: true, limitCny: 1});
      await writeFile(budgetPath, JSON.stringify({...saved, paused: false}));
      expect(await store.reserve(request)).toBeDefined();
    },
  );
  it('pauses after four transport failures and preserves late in-flight answers without reopening', async () => {
    const {root, store, budgetPath, journalPath} = await fixture();
    const tickets = await Promise.all(
      Array.from({length: 5}, () => store.reserve(request)),
    );
    for (let i = 0; i < 4; i++) {
      const ticket = tickets[i];
      if (!ticket) throw Error('expected reservation');
      await store.settle(ticket, i % 2 === 0 ? undefined : 503);
    }
    await expect(store.reserve(request)).rejects.toMatchObject({
      code: 'ai_batch_budget_paused',
    });
    const last = tickets[4];
    if (!last) throw Error('expected reservation');
    await store.settle(
      last,
      200,
      new TextEncoder().encode(
        JSON.stringify({usage: {input_tokens: 10, output_tokens: 10}}),
      ),
    );
    expect(JSON.parse(await readFile(budgetPath, 'utf8'))).toMatchObject({
      paused: true,
    });
    await expect(
      new LocalModelUsageJournal(root, workspaceId).reserve(request),
    ).rejects.toMatchObject({code: 'ai_batch_budget_paused'});
    const records = (await readFile(journalPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as {kind: string; usageKnown?: boolean});
    expect(
      records.filter(
        (record) => record.kind === 'settled' && record.usageKnown === false,
      ),
    ).toHaveLength(4);
    expect(records.filter((record) => record.usageKnown === true)).toHaveLength(
      1,
    );
  });
  it('counts completion order across restart and resets the streak on a full HTTP 200', async () => {
    const {root, store, budgetPath} = await fixture();
    const tickets = await Promise.all(
      Array.from({length: 5}, () => store.reserve(request)),
    );
    for (const index of [1, 2, 0, 3, 4]) {
      const ticket = tickets[index];
      if (!ticket) throw Error('expected reservation');
      await store.settle(ticket, index === 0 ? 200 : 503);
    }
    const restarted = new LocalModelUsageJournal(root, workspaceId);
    const third = await restarted.reserve(request);
    if (!third) throw Error('expected reservation');
    await restarted.settle(third, 429);
    expect(JSON.parse(await readFile(budgetPath, 'utf8'))).toMatchObject({
      paused: false,
    });
    const fourth = await restarted.reserve(request);
    if (!fourth) throw Error('expected reservation');
    await restarted.settle(fourth);
    await expect(restarted.reserve(request)).rejects.toMatchObject({
      code: 'ai_batch_budget_paused',
    });
  });
  it('does not let old transport failures pause a replacement batch', async () => {
    const {store, budgetPath} = await fixture();
    const tickets = await Promise.all(
      Array.from({length: 4}, () => store.reserve(request)),
    );
    for (const ticket of tickets.slice(0, 3)) {
      if (!ticket) throw Error('expected reservation');
      await store.settle(ticket, 503);
    }
    const saved = JSON.parse(await readFile(budgetPath, 'utf8')) as Record<
      string,
      unknown
    >;
    await writeFile(
      budgetPath,
      JSON.stringify({...saved, batchId: 'replacement'}),
    );
    const last = tickets[3];
    if (!last) throw Error('expected reservation');
    await store.settle(last, 503);
    const firstNew = await store.reserve(request);
    if (!firstNew) throw Error('expected reservation');
    await store.settle(firstNew, 503);
    expect(JSON.parse(await readFile(budgetPath, 'utf8'))).toMatchObject({
      batchId: 'replacement',
      paused: false,
    });
  });
  it('does not pause a replacement batch for an older in-flight payment failure', async () => {
    const {store, budgetPath} = await fixture();
    const ticket = await store.reserve(request);
    if (!ticket) throw Error('expected reservation');
    const saved = JSON.parse(await readFile(budgetPath, 'utf8')) as Record<
      string,
      unknown
    >;
    await writeFile(
      budgetPath,
      JSON.stringify({...saved, batchId: 'replacement'}),
    );
    await store.settle(ticket, 402);
    expect(JSON.parse(await readFile(budgetPath, 'utf8'))).toMatchObject({
      batchId: 'replacement',
      paused: false,
    });
    expect(await store.reserve(request)).toBeDefined();
  });
  it('leaves ordinary calls unchanged when no batch budget exists', async () => {
    const {root, budgetPath, store} = await fixture();
    await rm(budgetPath);
    expect(await store.reserve('')).toBeUndefined();
    expect(
      await new LocalModelUsageJournal(root, workspaceId).reserve(request),
    ).toBeUndefined();
  });
});
