import {Module} from '@nestjs/common';
import type {DynamicModule} from '@nestjs/common';

import type {OperationalHealthService} from '../health/operational_health.js';
import {M1cApiModule} from './m1c_api_controller.js';
import type {M1cApiServicePort} from './m1c_api_service.js';
import {OperationalHealthModule} from './operational_health_controller.js';

@Module({})
export class RuntimeHttpModule {
  public readonly moduleName = 'runtime-http';

  public static register(
    health: OperationalHealthService,
    api?: M1cApiServicePort,
  ): DynamicModule {
    return {
      module: RuntimeHttpModule,
      imports: [
        OperationalHealthModule.register(health),
        ...(api === undefined ? [] : [M1cApiModule.register(api)]),
      ],
    };
  }
}
