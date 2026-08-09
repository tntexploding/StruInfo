import type {ProcessRole} from '../config/runtime_config.js';
import type {DatabaseReadinessCheck} from '../database/database_readiness.js';

export type HealthResponse = Readonly<{
  statusCode: 200 | 503;
  body: Readonly<Record<string, unknown>>;
}>;

export class ReadinessGate {
  #accepting = false;

  public markInitialized(): void {
    this.#accepting = true;
  }

  public beginShutdown(): void {
    this.#accepting = false;
  }

  public isAccepting(): boolean {
    return this.#accepting;
  }
}

export class OperationalHealthService {
  readonly #role: ProcessRole;
  readonly #gate: ReadinessGate;
  readonly #database: DatabaseReadinessCheck;

  public constructor(options: {
    readonly role: ProcessRole;
    readonly gate: ReadinessGate;
    readonly database: DatabaseReadinessCheck;
  }) {
    this.#role = options.role;
    this.#gate = options.gate;
    this.#database = options.database;
  }

  public live(): HealthResponse {
    return {
      statusCode: 200,
      body: {
        schema_version: '1',
        service: 'struinfo',
        role: this.#role,
        status: 'ok',
      },
    };
  }

  public async ready(): Promise<HealthResponse> {
    if (!this.#gate.isAccepting()) {
      return this.notReady();
    }

    const databaseReady = await this.#database.check();
    if (!databaseReady || !this.#gate.isAccepting()) {
      return this.notReady();
    }

    return {
      statusCode: 200,
      body: {
        schema_version: '1',
        service: 'struinfo',
        role: this.#role,
        status: 'ready',
        checks: {database: 'ready'},
      },
    };
  }

  private notReady(): HealthResponse {
    return {
      statusCode: 503,
      body: {
        schema_version: '1',
        service: 'struinfo',
        role: this.#role,
        status: 'not_ready',
        checks: {database: 'not_ready'},
      },
    };
  }
}
