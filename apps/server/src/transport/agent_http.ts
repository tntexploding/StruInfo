import {REPORT_OPERATIONS} from '../application/report_commands.js';
import {timingSafeEqual} from 'node:crypto';
import type {Request, Response, NextFunction} from 'express';
import type {AgentCommands} from '../application/agent_commands.js';
import {OperationError} from '../application/operation_error.js';
export interface AgentHttpOptions {
  readonly owner: AgentCommands;
  readonly agent?: Readonly<{token: string; commands: AgentCommands}>;
}
export function agentHttpMiddleware(options: AgentHttpOptions) {
  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    const external = request.path === '/api/v1/agent/commands';
    const ingestion = request.path === '/api/v1/ingestion/commands';
    const reports = request.path === '/api/v1/reports/commands';
    const price = request.path === '/api/v1/ai-price/commands';
    const owner =
      request.path === '/api/v1/ai-tasks/commands' ||
      ingestion ||
      reports ||
      price;
    if (!external && !owner) {
      next();
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') {
      response.status(405).json({error: {code: 'method_not_allowed'}});
      return;
    }
    let commands = options.owner;
    if (external) {
      const configured = options.agent;
      if (!configured) {
        response.status(404).json({error: {code: 'agent_interface_disabled'}});
        return;
      }
      const supplied = request.headers.authorization ?? '';
      const expected = 'Bearer ' + configured.token;
      if (
        Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
      ) {
        response
          .status(401)
          .json({error: {code: 'agent_authentication_required'}});
        return;
      }
      commands = configured.commands;
    } else if (request.headers.authorization !== undefined) {
      response.status(403).json({error: {code: 'owner_session_required'}});
      return;
    }
    const body: unknown = request.body;
    if (
      typeof body !== 'object' ||
      body === null ||
      !('operation' in body) ||
      typeof body.operation !== 'string' ||
      !('input' in body) ||
      Object.keys(body).some((k) => !['operation', 'input'].includes(k))
    ) {
      response.status(400).json({error: {code: 'invalid_agent_request'}});
      return;
    }
    // Owner controls expose only tasks; ordinary owner reads keep their HTTP routes.
    if (
      owner &&
      !(
        price
          ? ['ai_price_status', 'ai_price_save']
          : reports
            ? REPORT_OPERATIONS
            : ingestion
              ? [
                  'system_status',
                  'ingestion_status',
                  'intake_status',
                  'intake_control',
                  'intake_prepare',
                  'ingestion_policy_save',
                  'ingestion_item_control',
                  'subscriptions_list',
                ]
              : [
                  'system_status',
                  'tasks_list',
                  'task_read',
                  'task_start',
                  'task_control',
                ]
      ).includes(body.operation)
    ) {
      response.status(400).json({error: {code: 'unknown_agent_operation'}});
      return;
    }
    try {
      response
        .status(200)
        .json({result: await commands.execute(body.operation, body.input)});
    } catch (error) {
      const failure = error instanceof OperationError ? error : undefined;
      response
        .status(
          failure?.kind === 'forbidden'
            ? 403
            : failure?.kind === 'not_found'
              ? 404
              : failure?.kind === 'conflict'
                ? 409
                : failure
                  ? 400
                  : 500,
        )
        .json({error: {code: failure?.code ?? 'agent_operation_failed'}});
    }
  };
}
