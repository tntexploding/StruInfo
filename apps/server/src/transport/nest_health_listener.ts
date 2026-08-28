import {NestFactory} from '@nestjs/core';
import type {INestApplication} from '@nestjs/common';
import type {NestExpressApplication} from '@nestjs/platform-express';
import type {NextFunction, Request, Response} from 'express';
import {fileURLToPath} from 'node:url';

import type {RuntimeResource} from '../lifecycle/runtime_resource.js';
import {toError} from '../lifecycle/runtime_resource.js';
import type {OperationalHealthService} from '../health/operational_health.js';
import type {M1cApiServicePort} from './m1c_api_service.js';
import {RuntimeHttpModule} from './runtime_http_module.js';

export const M1C_JSON_BODY_LIMIT = '2mb';
export const RUNTIME_HTTP_SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy':
    'camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
});
export const DEFAULT_WEB_APPLICATION_ROOT = fileURLToPath(
  new URL('../../../web/dist/', import.meta.url),
);

interface ClosableHttpServer {
  close(callback: (error?: Error) => void): void;
}

export interface HealthListenerFactory {
  start(options: {
    readonly health: OperationalHealthService;
    readonly api?: M1cApiServicePort;
    readonly host: string;
    readonly port: number;
    readonly webRoot?: string;
  }): Promise<RuntimeResource>;
}

export class NestHealthListenerFactory implements HealthListenerFactory {
  public async start(options: {
    readonly health: OperationalHealthService;
    readonly api?: M1cApiServicePort;
    readonly host: string;
    readonly port: number;
    readonly webRoot?: string;
  }): Promise<RuntimeResource> {
    const application = await createNestRuntimeHttpApplication(options);
    try {
      await application.listen(options.port, options.host);
    } catch (startupFailure) {
      try {
        await application.close();
      } catch (cleanupFailure) {
        throw new AggregateError(
          [toError(startupFailure), toError(cleanupFailure)],
          'Health listener startup and cleanup failed.',
          {cause: cleanupFailure},
        );
      }
      throw toError(startupFailure);
    }

    const server = application.getHttpServer() as unknown as ClosableHttpServer;
    return new NestHealthListener(application, server);
  }
}

export async function createNestRuntimeHttpApplication(options: {
  readonly health: OperationalHealthService;
  readonly api?: M1cApiServicePort;
  readonly webRoot?: string;
}): Promise<NestExpressApplication> {
  const application = await NestFactory.create<NestExpressApplication>(
    RuntimeHttpModule.register(options.health, options.api),
    {abortOnError: false, logger: false, bodyParser: false},
  );
  application.useBodyParser('json', {limit: M1C_JSON_BODY_LIMIT});
  application.disable('x-powered-by');
  application.use(
    (_request: Request, response: Response, next: NextFunction): void => {
      for (const [name, value] of Object.entries(
        RUNTIME_HTTP_SECURITY_HEADERS,
      )) {
        response.setHeader(name, value);
      }
      next();
    },
  );
  if (options.api !== undefined) {
    application.useStaticAssets(
      options.webRoot ?? DEFAULT_WEB_APPLICATION_ROOT,
      {index: 'index.html'},
    );
  }
  return application;
}

class NestHealthListener implements RuntimeResource {
  public readonly name = 'health-listener';
  readonly #application: INestApplication;
  readonly #server: ClosableHttpServer;
  #acceptingStopped: Promise<void> | undefined;
  #closed = false;

  public constructor(
    application: INestApplication,
    server: ClosableHttpServer,
  ) {
    this.#application = application;
    this.#server = server;
  }

  public stopAccepting(): void {
    if (this.#acceptingStopped !== undefined) {
      return;
    }
    this.#acceptingStopped = new Promise<void>((resolve, reject) => {
      this.#server.close((error) => {
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
    void this.#acceptingStopped.catch(() => undefined);
  }

  public async drain(): Promise<void> {
    await this.#acceptingStopped;
  }

  public async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.#application.close();
  }
}
