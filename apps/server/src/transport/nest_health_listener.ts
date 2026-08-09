import {NestFactory} from '@nestjs/core';
import type {INestApplication} from '@nestjs/common';

import type {RuntimeResource} from '../lifecycle/runtime_resource.js';
import {toError} from '../lifecycle/runtime_resource.js';
import type {OperationalHealthService} from '../health/operational_health.js';
import {OperationalHealthModule} from './operational_health_controller.js';

interface ClosableHttpServer {
  close(callback: (error?: Error) => void): void;
}

export interface HealthListenerFactory {
  start(options: {
    readonly health: OperationalHealthService;
    readonly host: string;
    readonly port: number;
  }): Promise<RuntimeResource>;
}

export class NestHealthListenerFactory implements HealthListenerFactory {
  public async start(options: {
    readonly health: OperationalHealthService;
    readonly host: string;
    readonly port: number;
  }): Promise<RuntimeResource> {
    const application = await NestFactory.create(
      OperationalHealthModule.register(options.health),
      {abortOnError: false, logger: false},
    );
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
