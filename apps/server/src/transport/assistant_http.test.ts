import {describe, expect, it, vi} from 'vitest';
import type {Request, Response} from 'express';
import {assistantHttpMiddleware} from './assistant_http.js';
import type {SystemAssistant} from '../application/system_assistant.js';
describe('assistant HTTP authentication', () => {
  it.each(['ask', 'delete'])(
    'requires its independent secret before %s',
    async (operation) => {
      const input =
        operation === 'delete'
          ? {sessionId: 'b'.repeat(64), expectedVersion: 1}
          : {message: '查看队列'};
      const execute = vi.fn(() => Promise.resolve({kind: 'result'}));
      for (const [authorization, expected] of [
        [undefined, 401],
        ['Bearer wrong', 401],
        ['Bearer ' + 'a'.repeat(32), 200],
      ] as const) {
        const json = vi.fn(),
          status = vi.fn(),
          response = {
            setHeader: vi.fn(),
            status,
            json,
          } as unknown as Response;
        status.mockReturnValue(response);
        await assistantHttpMiddleware({
          token: 'a'.repeat(32),
          service: {execute} as unknown as SystemAssistant,
        })(
          {
            path: '/api/v1/assistant/commands',
            method: 'POST',
            headers: {authorization},
            body: {operation, input},
          } as Request,
          response,
          vi.fn(),
        );
        if (expected === 401) expect(status).toHaveBeenCalledWith(401);
        else expect(json).toHaveBeenCalledWith({result: {kind: 'result'}});
      }
      expect(execute).toHaveBeenCalledExactlyOnceWith(operation, input);
    },
  );
  it('keeps the endpoint disabled without a secret', async () => {
    const json = vi.fn(),
      status = vi.fn(),
      response = {
        setHeader: vi.fn(),
        status,
        json,
      } as unknown as Response;
    status.mockReturnValue(response);
    await assistantHttpMiddleware(undefined)(
      {path: '/api/v1/assistant/commands'} as Request,
      response,
      vi.fn(),
    );
    expect(status).toHaveBeenCalledWith(404);
  });
});
