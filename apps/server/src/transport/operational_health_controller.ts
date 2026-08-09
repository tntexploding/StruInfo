import {Controller, Get, Inject, Module, Res} from '@nestjs/common';
import type {DynamicModule} from '@nestjs/common';
import type {Response} from 'express';

import type {
  OperationalHealthService,
  HealthResponse,
} from '../health/operational_health.js';

export const HEALTH_CONTENT_TYPE = 'application/json';
export const HEALTH_CACHE_CONTROL = 'no-store';
const OPERATIONAL_HEALTH_SERVICE = Symbol('OPERATIONAL_HEALTH_SERVICE');

@Controller('health')
export class OperationalHealthController {
  readonly #health: OperationalHealthService;

  public constructor(
    @Inject(OPERATIONAL_HEALTH_SERVICE) health: OperationalHealthService,
  ) {
    this.#health = health;
  }

  @Get('live')
  public live(@Res() response: Response): void {
    writeHealthResponse(response, this.#health.live());
  }

  @Get('ready')
  public async ready(@Res() response: Response): Promise<void> {
    writeHealthResponse(response, await this.#health.ready());
  }
}

@Module({})
export class OperationalHealthModule {
  public readonly moduleName = 'operational-health';

  public static register(health: OperationalHealthService): DynamicModule {
    return {
      module: OperationalHealthModule,
      controllers: [OperationalHealthController],
      providers: [
        {
          provide: OPERATIONAL_HEALTH_SERVICE,
          useValue: health,
        },
      ],
    };
  }
}

function writeHealthResponse(
  response: Response,
  healthResponse: HealthResponse,
): void {
  response.status(healthResponse.statusCode);
  response.setHeader('Content-Type', HEALTH_CONTENT_TYPE);
  response.setHeader('Cache-Control', HEALTH_CACHE_CONTROL);
  response.end(JSON.stringify(healthResponse.body));
}
