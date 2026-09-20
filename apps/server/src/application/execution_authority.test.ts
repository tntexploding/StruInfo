import {describe, expect, it} from 'vitest';
import {
  DELEGATED_READ_OPERATIONS,
  ExecutionAuthority,
  type ApplicationOperation,
  type DelegatedReadOperation,
} from './execution_authority.js';

const WORKSPACE = '00000000-0000-4000-8000-000000000001';
const OWNER_OPERATIONS: readonly ApplicationOperation[] = [
  ...DELEGATED_READ_OPERATIONS,
  'documents.split',
  'entries.revise',
  'relations.revise',
  'processing.cancel',
  'models.use',
];

describe('execution authority', () => {
  it.each(['external_agent', 'automation'] as const)(
    'defaults %s to no authority',
    (kind) => {
      const authority = ExecutionAuthority.delegate(
        WORKSPACE,
        {kind, id: 'synthetic-caller'},
        {operations: []},
      );
      for (const operation of OWNER_OPERATIONS) {
        expect(() => {
          authority.require(operation);
        }).toThrow('operation_not_authorized');
      }
    },
  );

  it.each(['external_agent', 'automation'] as const)(
    'grants %s only explicit reads',
    (kind) => {
      const authority = ExecutionAuthority.delegate(
        WORKSPACE,
        {kind, id: 'synthetic-caller'},
        {operations: DELEGATED_READ_OPERATIONS},
      );
      for (const operation of DELEGATED_READ_OPERATIONS) {
        expect(() => {
          authority.require(operation);
        }).not.toThrow();
        expect(() => {
          authority.require(operation, true);
        }).toThrow('private_access_not_authorized');
      }
      for (const operation of OWNER_OPERATIONS.filter(
        (operation) =>
          !DELEGATED_READ_OPERATIONS.some((read) => read === operation),
      )) {
        expect(() => {
          authority.require(operation);
        }).toThrow('operation_not_authorized');
      }
    },
  );

  it('copies the caller identity and grant list at construction', () => {
    const identity = {kind: 'external_agent' as const, id: 'synthetic-caller'};
    const operations: DelegatedReadOperation[] = ['documents.read'];
    const grants = {operations, includePrivate: false};
    const authority = ExecutionAuthority.delegate(WORKSPACE, identity, grants);
    identity.id = 'different-caller';
    operations.push('entries.search');
    grants.includePrivate = true;
    expect(authority.identity.id).toBe('synthetic-caller');
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.isFrozen(authority.identity)).toBe(true);
    expect(() => {
      authority.require('entries.search');
    }).toThrow('operation_not_authorized');
    expect(() => {
      authority.require('documents.read', true);
    }).toThrow('private_access_not_authorized');
  });

  it('requires a separate private grant and never broadens the operation grant', () => {
    const authority = ExecutionAuthority.delegate(
      WORKSPACE,
      {kind: 'external_agent', id: 'synthetic-caller'},
      {operations: ['entries.search'], includePrivate: true},
    );
    expect(() => {
      authority.require('entries.search', true);
    }).not.toThrow();
    expect(() => {
      authority.require('documents.read', true);
    }).toThrow('operation_not_authorized');
  });

  it('rejects attempts to construct a delegated owner or grant manual writes', () => {
    expect(() =>
      ExecutionAuthority.delegate(
        WORKSPACE,
        {kind: 'owner', id: 'synthetic'} as never,
        {operations: []},
      ),
    ).toThrow('invalid_execution_authority');
    expect(() =>
      ExecutionAuthority.delegate(
        WORKSPACE,
        {kind: 'external_agent', id: 'synthetic'},
        {operations: ['entries.revise'] as never},
      ),
    ).toThrow('invalid_execution_authority');
  });

  it('preserves owner authority while rejecting malformed workspace identity', () => {
    const authority = ExecutionAuthority.owner(WORKSPACE);
    for (const operation of OWNER_OPERATIONS)
      expect(() => {
        authority.require(operation, true);
      }).not.toThrow();
    expect(() => ExecutionAuthority.owner('not-a-workspace')).toThrow(
      'invalid_request',
    );
  });
});
