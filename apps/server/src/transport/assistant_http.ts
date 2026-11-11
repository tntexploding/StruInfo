import {timingSafeEqual} from 'node:crypto';
import type {Request, Response, NextFunction} from 'express';
import {z} from 'zod';
import {OperationError} from '../application/operation_error.js';
import type {SystemAssistant} from '../application/system_assistant.js';

export interface AssistantHttpOptions {
  readonly token: string;
  readonly service: SystemAssistant;
}
const requestSchema = z
  .object({
    operation: z.enum([
      'status',
      'tools',
      'sessions',
      'delete',
      'open',
      'read',
      'events',
      'ask',
      'invoke',
      'confirm',
      'dismiss',
      'resume',
      'cancel',
    ]),
    input: z.unknown(),
  })
  .strict();
export function assistantHttpMiddleware(
  options: AssistantHttpOptions | undefined,
) {
  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (request.path !== '/api/v1/assistant/commands') {
      next();
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    if (!options) {
      response.status(404).json({error: {code: 'assistant_not_configured'}});
      return;
    }
    if (request.method !== 'POST') {
      response.status(405).json({error: {code: 'method_not_allowed'}});
      return;
    }
    const supplied = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from('Bearer ' + options.token);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      response
        .status(401)
        .json({error: {code: 'assistant_authentication_required'}});
      return;
    }
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({error: {code: 'assistant_invalid_request'}});
      return;
    }
    try {
      response.json({
        result: await options.service.execute(
          parsed.data.operation,
          parsed.data.input,
        ),
      });
    } catch (error) {
      const failure = error instanceof OperationError ? error : undefined;
      response
        .status(
          failure?.kind === 'conflict'
            ? 409
            : failure?.kind === 'forbidden'
              ? 403
              : failure?.kind === 'not_found'
                ? 404
                : failure
                  ? 400
                  : 500,
        )
        .json({error: {code: failure?.code ?? 'assistant_operation_failed'}});
    }
  };
}
