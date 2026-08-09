import type {LogLevel, ProcessRole} from '../config/runtime_config.js';

export interface Clock {
  now(): Date;
}

export interface LogSink {
  write(line: string): void;
}

export interface RuntimeLogger {
  write(
    level: LogLevel,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void;
}

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}

export class StandardOutputSink implements LogSink {
  public write(line: string): void {
    process.stdout.write(`${line}\n`);
  }
}

export class StructuredLogger implements RuntimeLogger {
  readonly #minimumLevel: LogLevel;
  readonly #role: ProcessRole;
  readonly #clock: Clock;
  readonly #sink: LogSink;
  readonly #secrets: readonly string[];

  public constructor(options: {
    readonly minimumLevel: LogLevel;
    readonly role: ProcessRole;
    readonly clock: Clock;
    readonly sink: LogSink;
    readonly secrets: readonly string[];
  }) {
    this.#minimumLevel = options.minimumLevel;
    this.#role = options.role;
    this.#clock = options.clock;
    this.#sink = options.sink;
    this.#secrets = [...options.secrets]
      .filter((secret) => secret.length > 0)
      .sort((left, right) => right.length - left.length);
  }

  public write(
    level: LogLevel,
    event: string,
    fields: Readonly<Record<string, unknown>> = {},
  ): void {
    if (!shouldWrite(this.#minimumLevel, level)) {
      return;
    }

    const safeFields = sanitizeRecord(fields, this.#secrets);
    this.#sink.write(
      JSON.stringify({
        ...safeFields,
        timestamp: this.#clock.now().toISOString(),
        level,
        event: redactString(event, this.#secrets),
        service: 'struinfo',
        role: this.#role,
      }),
    );
  }
}

export function collectEnvironmentSecrets(
  environment: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  return Object.entries(environment).flatMap(([name, value]) =>
    isSensitiveKey(name) && value !== undefined ? [value] : [],
  );
}

function shouldWrite(minimum: LogLevel, candidate: LogLevel): boolean {
  const priorities: Readonly<Record<LogLevel, number>> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };
  return priorities[candidate] >= priorities[minimum];
}

function sanitizeRecord(
  fields: Readonly<Record<string, unknown>>,
  secrets: readonly string[],
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : sanitizeValue(value, secrets),
    ]),
  );
}

function sanitizeValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') {
    return redactString(value, secrets);
  }
  if (value instanceof Error) {
    return {name: value.name};
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, secrets));
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeRecord(value as Readonly<Record<string, unknown>>, secrets);
  }
  return value;
}

function redactString(value: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (safeValue, secret) => safeValue.replaceAll(secret, '[REDACTED]'),
    value,
  );
}

function isSensitiveKey(key: string): boolean {
  return /(?:database.?url|password|secret|token|credential|private.?key)/iu.test(
    key,
  );
}
