export type OperationErrorKind =
  'invalid_input' | 'not_found' | 'conflict' | 'rejected' | 'forbidden';

/** Business failures carry no transport status or provider error text. */
export class OperationError extends Error {
  public constructor(
    public readonly kind: OperationErrorKind,
    public readonly code: string,
    public readonly field?: string,
  ) {
    super(code);
    this.name = 'OperationError';
  }
}

export function assertOperationId(value: string, field: string): void {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      value,
    )
  ) {
    throw new OperationError('invalid_input', 'invalid_request', field);
  }
}

export function assertOperationVersion(
  value: number,
  field: string,
  minimum = 1,
): void {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value >= 2_147_483_647
  ) {
    throw new OperationError('invalid_input', 'invalid_request', field);
  }
}

export function requireOperationValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new OperationError('rejected', 'task_state_incomplete');
  return value;
}
