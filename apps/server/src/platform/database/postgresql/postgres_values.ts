const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

export class PostgresAdapterError extends Error {
  public constructor() {
    super('PostgreSQL adapter operation failed.');
    this.name = 'PostgresAdapterError';
  }
}

export function canonicalUuid(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_UUID.test(value)) {
    throw new PostgresAdapterError();
  }
  return value;
}

export function sha256(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new PostgresAdapterError();
  }
  return value;
}

export function text(value: unknown): string {
  if (typeof value !== 'string') {
    throw new PostgresAdapterError();
  }
  return value;
}

export function optionalText(value: unknown): string | undefined {
  return value === null ? undefined : text(value);
}

export function integer(value: unknown, minimum = 0): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > 2_147_483_647
  ) {
    throw new PostgresAdapterError();
  }
  return value;
}

export function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new PostgresAdapterError();
  }
  return value;
}

export function expectOneAffected(rowCount: number | null): void {
  if (rowCount !== 1) {
    throw new PostgresAdapterError();
  }
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
