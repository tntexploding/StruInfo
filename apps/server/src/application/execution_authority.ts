import {OperationError, assertOperationId} from './operation_error.js';

export const DELEGATED_READ_OPERATIONS = Object.freeze([
  'documents.read',
  'entries.search',
  'relations.read',
  'processing.read',
] as const);
export type DelegatedReadOperation = (typeof DELEGATED_READ_OPERATIONS)[number];
export const AGENT_WRITE_OPERATIONS = [
  'agent.split',
  'sources.capture',
  'agent.tags',
  'agent.relations',
  'tasks.control',
  'models.use',
  'ingestion.manage',
] as const;
export type AgentWriteOperation = (typeof AGENT_WRITE_OPERATIONS)[number];
export type ApplicationOperation =
  | AgentWriteOperation
  | DelegatedReadOperation
  | 'documents.split'
  | 'entries.revise'
  | 'relations.revise'
  | 'processing.cancel'
  | 'models.use';
export type ExecutionIdentity =
  | Readonly<{kind: 'owner'; id: string}>
  | Readonly<{kind: 'external_agent'; id: string}>
  | Readonly<{kind: 'automation'; id: string}>;

/** Constructed by trusted composition, never decoded from a business request.
 * This is an in-process authority boundary, not HTTP authentication.
 */
export class ExecutionAuthority {
  public readonly identity: ExecutionIdentity;
  readonly #operations: ReadonlySet<ApplicationOperation>;
  readonly #includePrivate: boolean;

  private constructor(
    public readonly workspaceId: string,
    identity: ExecutionIdentity,
    operations: readonly (DelegatedReadOperation | AgentWriteOperation)[],
    includePrivate: boolean,
  ) {
    assertOperationId(workspaceId, 'workspaceId');
    if (
      typeof identity.id !== 'string' ||
      identity.id.trim() === '' ||
      identity.id.length > 128 ||
      !['owner', 'external_agent', 'automation'].includes(identity.kind) ||
      typeof includePrivate !== 'boolean' ||
      !operations.every((operation) =>
        [...DELEGATED_READ_OPERATIONS, ...AGENT_WRITE_OPERATIONS].includes(
          operation,
        ),
      )
    ) {
      throw new OperationError('invalid_input', 'invalid_execution_authority');
    }
    this.identity = Object.freeze({...identity});
    this.#operations = new Set(operations);
    this.#includePrivate = includePrivate;
    Object.freeze(this);
  }

  public static owner(workspaceId: string): ExecutionAuthority {
    return new ExecutionAuthority(
      workspaceId,
      {kind: 'owner', id: 'local-owner'},
      [],
      true,
    );
  }

  public static delegate(
    workspaceId: string,
    identity: Exclude<ExecutionIdentity, Readonly<{kind: 'owner'; id: string}>>,
    grants: Readonly<{
      operations: readonly DelegatedReadOperation[];
      includePrivate?: boolean;
    }>,
  ): ExecutionAuthority {
    if (
      !['external_agent', 'automation'].includes(identity.kind) ||
      !grants.operations.every((op) => DELEGATED_READ_OPERATIONS.includes(op))
    ) {
      throw new OperationError('invalid_input', 'invalid_execution_authority');
    }
    return new ExecutionAuthority(
      workspaceId,
      identity,
      grants.operations,
      grants.includePrivate ?? false,
    );
  }

  public static automation(
    workspaceId: string,
    id: string,
  ): ExecutionAuthority {
    return new ExecutionAuthority(
      workspaceId,
      {kind: 'automation', id},
      ['tasks.control', 'models.use', 'processing.read'],
      false,
    );
  }

  public static agent(
    workspaceId: string,
    id: string,
    operations: readonly (DelegatedReadOperation | AgentWriteOperation)[],
  ): ExecutionAuthority {
    return new ExecutionAuthority(
      workspaceId,
      {kind: 'external_agent', id},
      operations,
      false,
    );
  }

  public require(
    operation: ApplicationOperation,
    includePrivate = false,
  ): void {
    if (typeof includePrivate !== 'boolean') {
      throw new OperationError(
        'invalid_input',
        'invalid_request',
        'includePrivate',
      );
    }
    if (this.identity.kind !== 'owner' && !this.#operations.has(operation)) {
      throw new OperationError('forbidden', 'operation_not_authorized');
    }
    if (includePrivate && !this.#includePrivate) {
      throw new OperationError('forbidden', 'private_access_not_authorized');
    }
  }
}
