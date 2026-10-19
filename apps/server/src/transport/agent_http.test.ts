import {describe, it, expect, vi} from 'vitest';
import type {Request, Response} from 'express';
import type {AgentCommands} from '../application/agent_commands.js';
import {agentHttpMiddleware} from './agent_http.js';
import {OperationError} from '../application/operation_error.js';
describe('Agent HTTP authentication and dispatch', () => {
  function fixture() {
    const owner = {execute: vi.fn(() => Promise.resolve({kind: 'owner'}))};
    const agent = {execute: vi.fn(() => Promise.resolve({kind: 'agent'}))};
    const send = async (
      path: string,
      authorization?: string,
      body: unknown = {operation: 'tasks_list', input: {}},
    ) => {
      const json = vi.fn();
      const status = vi.fn(() => response);
      const response = {
        status,
        json,
        setHeader: vi.fn(),
      } as unknown as Response;
      await agentHttpMiddleware({
        owner: owner as unknown as AgentCommands,
        agent: {
          token: 'a'.repeat(32),
          commands: agent as unknown as AgentCommands,
        },
      })(
        {
          path,
          method: 'POST',
          headers: authorization ? {authorization} : {},
          body,
        } as Request,
        response,
        vi.fn(),
      );
      return {status, json};
    };
    return {send, owner, agent};
  }

  it('keeps report writes on the owner route and rejects bearer access there', async () => {
    const f = fixture();
    await f.send('/api/v1/reports/commands', undefined, {
      operation: 'report_create',
      input: {},
    });
    expect(f.owner.execute).toHaveBeenCalledWith('report_create', {});
    expect(
      (
        await f.send('/api/v1/reports/commands', 'Bearer ' + 'a'.repeat(32), {
          operation: 'report_generate',
          input: {},
        })
      ).status,
    ).toHaveBeenCalledWith(403);
    expect(
      (
        await f.send('/api/v1/reports/commands', undefined, {
          operation: 'task_start',
          input: {},
        })
      ).status,
    ).toHaveBeenCalledWith(400);
  });
  it('restricts the price-settings route to its two operations and rejects agent credentials', async () => {
    const f = fixture();
    await f.send('/api/v1/ai-price/commands', undefined, {
      operation: 'ai_price_save',
      input: {revision: 0, enabled: true},
    });
    expect(f.owner.execute).toHaveBeenCalledWith('ai_price_save', {
      revision: 0,
      enabled: true,
    });
    expect(
      (
        await f.send('/api/v1/ai-price/commands', 'Bearer ' + 'a'.repeat(32), {
          operation: 'ai_price_save',
          input: {},
        })
      ).status,
    ).toHaveBeenCalledWith(403);
    expect(
      (
        await f.send('/api/v1/ai-price/commands', undefined, {
          operation: 'task_start',
          input: {},
        })
      ).status,
    ).toHaveBeenCalledWith(400);
  });
  it('uses the same authenticated gateway for unattended policy controls', async () => {
    const f = fixture();
    await f.send('/api/v1/ingestion/commands', undefined, {
      operation: 'ingestion_status',
      input: {},
    });
    expect(f.owner.execute).toHaveBeenCalledWith('ingestion_status', {});
    expect(
      (
        await f.send('/api/v1/ingestion/commands', 'Bearer ' + 'a'.repeat(32), {
          operation: 'ingestion_policy_save',
          input: {},
        })
      ).status,
    ).toHaveBeenCalledWith(403);
    expect(
      (
        await f.send('/api/v1/ingestion/commands', undefined, {
          operation: 'task_start',
          input: {},
        })
      ).status,
    ).toHaveBeenCalledWith(400);
  });

  it.each([
    ['source_quality_status', '/api/v1/ingestion/commands'],
    ['source_quality_control', '/api/v1/ingestion/commands'],
    ['source_description_generate', '/api/v1/ingestion/commands'],
    ['ai_execution_save', '/api/v1/ai-price/commands'],
  ])('keeps %s on the owner route', async (operation, path) => {
    const f = fixture();
    await f.send(path, undefined, {operation, input: {}});
    expect(f.owner.execute).toHaveBeenCalledWith(operation, {});
    expect(
      (await f.send(path, 'Bearer ' + 'a'.repeat(32), {operation, input: {}}))
        .status,
    ).toHaveBeenCalledWith(403);
  });

  it('never dispatches missing or wrong credentials to owner operations', async () => {
    const f = fixture();
    expect(
      (await f.send('/api/v1/agent/commands')).status,
    ).toHaveBeenCalledWith(401);
    expect(
      (await f.send('/api/v1/agent/commands', 'Bearer invalid')).status,
    ).toHaveBeenCalledWith(401);
    expect(f.owner.execute).not.toHaveBeenCalled();
    expect(f.agent.execute).not.toHaveBeenCalled();
    await f.send('/api/v1/agent/commands', 'Bearer ' + 'a'.repeat(32));
    expect(f.agent.execute).toHaveBeenCalledWith('tasks_list', {});
    expect(f.owner.execute).not.toHaveBeenCalled();
    expect(
      (await f.send('/api/v1/ai-tasks/commands', 'Bearer ' + 'a'.repeat(32)))
        .status,
    ).toHaveBeenCalledWith(403);
  });
  it('exposes the shared standard through owner and authenticated Agent task routes', async () => {
    const f = fixture();
    const body = {operation: 'processing_standard', input: {stage: 'split'}};
    await f.send('/api/v1/ai-tasks/commands', undefined, body);
    expect(f.owner.execute).toHaveBeenCalledWith('processing_standard', {
      stage: 'split',
    });
    await f.send('/api/v1/agent/commands', 'Bearer ' + 'a'.repeat(32), body);
    expect(f.agent.execute).toHaveBeenCalledWith('processing_standard', {
      stage: 'split',
    });
  });
  it('preserves safe conflicts and hides raw errors', async () => {
    const f = fixture();
    f.agent.execute.mockRejectedValueOnce(
      new OperationError('conflict', 'stale_task_version'),
    );
    const result = await f.send(
      '/api/v1/agent/commands',
      'Bearer ' + 'a'.repeat(32),
    );
    expect(result.status).toHaveBeenCalledWith(409);
    expect(result.json).toHaveBeenCalledWith({
      error: {code: 'stale_task_version'},
    });
    f.agent.execute.mockRejectedValueOnce(new Error('synthetic secret'));
    expect(
      (await f.send('/api/v1/agent/commands', 'Bearer ' + 'a'.repeat(32))).json,
    ).toHaveBeenCalledWith({error: {code: 'agent_operation_failed'}});
  });
});
