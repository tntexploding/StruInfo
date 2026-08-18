import {types as utilityTypes} from 'node:util';

import {
  deepFreeze,
  defineOwnedRecord,
} from './closed_manual_knowledge_input.js';
import {
  EPISTEMIC_ROLES,
  type EpistemicRole,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_REVIEW_STATES,
  type KnowledgeItemRevisionValue,
  type KnowledgeKind,
  type KnowledgeRelationRevisionValue,
  type KnowledgeReviewState,
} from './manual_knowledge_contract.js';
import {SHA256_PATTERN, UUID_PATTERN} from './manual_knowledge_identity.js';
import {
  type DeterministicKnowledgeSearchContext,
  type DeterministicKnowledgeSearchRequest,
  type DeterministicKnowledgeSearchSnapshot,
  KNOWLEDGE_SEARCH_LIMITS,
  KNOWLEDGE_SEARCH_RELATION_DIRECTIONS,
  KNOWLEDGE_SEARCH_SOURCE_INPUT_KINDS,
  KNOWLEDGE_SEARCH_TEXT_FIELDS,
  KNOWLEDGE_SEARCH_TEXT_MODES,
  type KnowledgeSearchBudgetName,
  type KnowledgeSearchCursor,
  type KnowledgeSearchFilters,
  type KnowledgeSearchFragmentInputState,
  type KnowledgeSearchIssueCode,
  type KnowledgeSearchIssuePath,
  type KnowledgeSearchItemState,
  type KnowledgeSearchRelationFilter,
  type KnowledgeSearchRelationRevisionState,
  type KnowledgeSearchRelationState,
  type KnowledgeSearchRevisionState,
  type KnowledgeSearchSourceFilter,
  type KnowledgeSearchSourceInputKind,
  type KnowledgeSearchTextClause,
  type KnowledgeSearchTextField,
} from './deterministic_knowledge_search_contract.js';
import {
  compareUnsignedUtf8,
  searchKeyV1,
} from './deterministic_knowledge_search_identity.js';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const KNOWLEDGE_KIND_SET = new Set<string>(KNOWLEDGE_KINDS);
const EPISTEMIC_ROLE_SET = new Set<string>(EPISTEMIC_ROLES);
const REVIEW_STATE_SET = new Set<string>(KNOWLEDGE_REVIEW_STATES);
const TEXT_MODE_SET = new Set<string>(KNOWLEDGE_SEARCH_TEXT_MODES);
const TEXT_FIELD_SET = new Set<string>(KNOWLEDGE_SEARCH_TEXT_FIELDS);
const SOURCE_INPUT_KIND_SET = new Set<string>(
  KNOWLEDGE_SEARCH_SOURCE_INPUT_KINDS,
);
const RELATION_DIRECTION_SET = new Set<string>(
  KNOWLEDGE_SEARCH_RELATION_DIRECTIONS,
);

type DescriptorRecord = Readonly<Record<string, PropertyDescriptor>>;

interface ArrayHeader {
  readonly input: readonly unknown[];
  readonly length: number;
  readonly path: string;
}

interface PreparedArray extends ArrayHeader {
  readonly descriptors: ReadonlyMap<number, PropertyDescriptor>;
}

export class KnowledgeSearchInputFault extends Error {
  public readonly code: KnowledgeSearchIssueCode;
  public readonly path: KnowledgeSearchIssuePath;
  public readonly budget: KnowledgeSearchBudgetName | undefined;

  public constructor(
    code: KnowledgeSearchIssueCode,
    path: KnowledgeSearchIssuePath,
    budget?: KnowledgeSearchBudgetName,
  ) {
    super('Deterministic knowledge search input is invalid.');
    this.name = 'KnowledgeSearchInputFault';
    this.code = code;
    this.path = path;
    this.budget = budget;
  }
}

export class KnowledgeSearchRepositorySnapshotFault extends Error {
  public constructor() {
    super('Deterministic knowledge search repository snapshot is invalid.');
    this.name = 'KnowledgeSearchRepositorySnapshotFault';
  }
}

class ClosedInspector {
  private readonly ancestors = new WeakSet<object>();

  public constructor(private readonly invalid: (path: string) => Error) {}

  public record<Value>(
    input: unknown,
    requiredKeys: readonly string[],
    optionalKeys: readonly string[],
    path: string,
    project: (record: DescriptorRecord) => Value,
  ): Value {
    if (input === null || typeof input !== 'object' || isProxy(input)) {
      throw this.invalid(path);
    }
    if (this.ancestors.has(input)) {
      throw this.invalid(path);
    }
    let prototype: object | null;
    try {
      prototype = Reflect.getPrototypeOf(input);
    } catch {
      throw this.invalid(path);
    }
    if (prototype !== Object.prototype) {
      throw this.invalid(path);
    }
    for (const key of [...requiredKeys, ...optionalKeys]) {
      if (hasInheritedAccessor(Object.prototype, key)) {
        throw this.invalid(declaredPath(path, key));
      }
    }
    let keys: readonly PropertyKey[];
    try {
      keys = Reflect.ownKeys(input);
    } catch {
      throw this.invalid(path);
    }
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    const descriptors = Object.create(null) as Record<
      string,
      PropertyDescriptor
    >;
    for (const key of keys) {
      if (
        typeof key !== 'string' ||
        DANGEROUS_KEYS.has(key) ||
        !allowed.has(key)
      ) {
        throw this.invalid(path);
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        throw this.invalid(declaredPath(path, key));
      }
      Object.defineProperty(descriptors, key, {
        value: descriptor,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    for (const key of requiredKeys) {
      if (!Object.hasOwn(descriptors, key)) {
        throw this.invalid(declaredPath(path, key));
      }
    }
    this.ancestors.add(input);
    try {
      return project(descriptors);
    } finally {
      this.ancestors.delete(input);
    }
  }

  public arrayHeader(
    input: unknown,
    path: string,
    maximumLength?: number,
    tooLong?: () => Error,
  ): ArrayHeader {
    if (input === null || typeof input !== 'object' || isProxy(input)) {
      throw this.invalid(path);
    }
    if (this.ancestors.has(input)) {
      throw this.invalid(path);
    }
    let prototype: object | null;
    try {
      prototype = Reflect.getPrototypeOf(input);
    } catch {
      throw this.invalid(path);
    }
    if (!Array.isArray(input) || prototype !== Array.prototype) {
      throw this.invalid(path);
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(input, 'length');
    const length = lengthDescriptor?.value as unknown;
    if (
      lengthDescriptor === undefined ||
      !Object.hasOwn(lengthDescriptor, 'value') ||
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 0
    ) {
      throw this.invalid(path);
    }
    if (maximumLength !== undefined && length > maximumLength) {
      throw tooLong?.() ?? this.invalid(path);
    }
    return {input, length, path};
  }

  public decodeArray<Value>(
    header: ArrayHeader,
    decode: (value: unknown, index: number) => Value,
  ): readonly Value[] {
    const prepared = this.prepareArray(header);
    this.ancestors.add(prepared.input);
    try {
      const output = new Array<Value>(prepared.length);
      for (let index = 0; index < prepared.length; index += 1) {
        const descriptor = prepared.descriptors.get(index);
        if (descriptor === undefined) {
          throw this.invalid(prepared.path);
        }
        Object.defineProperty(output, String(index), {
          value: decode(descriptor.value as unknown, index),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return output;
    } finally {
      this.ancestors.delete(prepared.input);
    }
  }

  public required(
    record: DescriptorRecord,
    key: string,
    path: string,
  ): unknown {
    const descriptor = record[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
      throw this.invalid(path);
    }
    return descriptor.value as unknown;
  }

  public has(record: DescriptorRecord, key: string): boolean {
    return Object.hasOwn(record, key);
  }

  public requireExactBranch(
    record: DescriptorRecord,
    required: readonly string[],
    path: string,
  ): void {
    const allowed = new Set(required);
    for (const key of Object.keys(record)) {
      if (!allowed.has(key)) {
        throw this.invalid(path);
      }
    }
    for (const key of required) {
      if (!Object.hasOwn(record, key)) {
        throw this.invalid(declaredPath(path, key));
      }
    }
  }

  private prepareArray(header: ArrayHeader): PreparedArray {
    let keys: readonly PropertyKey[];
    try {
      keys = Reflect.ownKeys(header.input);
    } catch {
      throw this.invalid(header.path);
    }
    const descriptors = new Map<number, PropertyDescriptor>();
    for (const key of keys) {
      if (key === 'length') {
        continue;
      }
      if (typeof key !== 'string' || !isArrayIndex(key, header.length)) {
        throw this.invalid(header.path);
      }
      const descriptor = Object.getOwnPropertyDescriptor(header.input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        throw this.invalid(header.path);
      }
      descriptors.set(Number(key), descriptor);
    }
    if (descriptors.size !== header.length) {
      throw this.invalid(header.path);
    }
    for (let index = 0; index < header.length; index += 1) {
      if (hasInheritedAccessor(Array.prototype, String(index))) {
        throw this.invalid(header.path);
      }
    }
    return {...header, descriptors};
  }
}

class RequestDecoder {
  private readonly inspector = new ClosedInspector((path) =>
    inputFault('invalid_shape', path as KnowledgeSearchIssuePath),
  );

  public context(input: unknown): DeterministicKnowledgeSearchContext {
    return this.inspector.record(
      input,
      ['effectiveWorkspaceId', 'authority'],
      [],
      'context',
      (record) =>
        defineOwnedRecord({
          effectiveWorkspaceId: this.uuid(
            this.inspector.required(
              record,
              'effectiveWorkspaceId',
              'context.effectiveWorkspaceId',
            ),
            'context.effectiveWorkspaceId',
          ),
          authority: this.authority(
            this.inspector.required(record, 'authority', 'context.authority'),
          ),
        }),
    );
  }

  public request(input: unknown): DeterministicKnowledgeSearchRequest {
    return this.inspector.record(
      input,
      ['filters', 'page'],
      ['text'],
      'request',
      (record) => {
        const hasText = this.inspector.has(record, 'text');
        return defineOwnedRecord({
          ...(!hasText
            ? {}
            : {
                text: this.textClause(
                  this.inspector.required(record, 'text', 'request.text'),
                ),
              }),
          filters: this.filters(
            this.inspector.required(record, 'filters', 'request.filters'),
          ),
          page: this.page(
            this.inspector.required(record, 'page', 'request.page'),
          ),
        });
      },
    );
  }

  private textClause(input: unknown): KnowledgeSearchTextClause {
    return this.inspector.record(
      input,
      ['value', 'mode', 'fields'],
      [],
      'request.text',
      (record) => {
        const value = this.queryText(
          this.inspector.required(record, 'value', 'request.text.value'),
        );
        const mode = this.enumValue(
          this.inspector.required(record, 'mode', 'request.text.mode'),
          'request.text.mode',
          TEXT_MODE_SET,
        ) as KnowledgeSearchTextClause['mode'];
        const fields = this.protocolSet(
          this.inspector.required(record, 'fields', 'request.text.fields'),
          'request.text.fields',
          KNOWLEDGE_SEARCH_LIMITS.textFields,
          'text_fields',
          TEXT_FIELD_SET,
          KNOWLEDGE_SEARCH_TEXT_FIELDS,
        ) as readonly KnowledgeSearchTextField[];
        if (fields.length === 0) {
          throw inputFault('invalid_state', 'request.text.fields');
        }
        return defineOwnedRecord({value, mode, fields});
      },
    );
  }

  private filters(input: unknown): KnowledgeSearchFilters {
    return this.inspector.record(
      input,
      [
        'knowledgeKinds',
        'epistemicRoles',
        'reviewStates',
        'source',
        'relation',
      ],
      [],
      'request.filters',
      (record) =>
        defineOwnedRecord({
          knowledgeKinds: this.protocolSet(
            this.inspector.required(
              record,
              'knowledgeKinds',
              'request.filters.knowledgeKinds',
            ),
            'request.filters.knowledgeKinds',
            KNOWLEDGE_SEARCH_LIMITS.knowledgeKinds,
            'knowledge_kinds',
            KNOWLEDGE_KIND_SET,
            KNOWLEDGE_KINDS,
          ) as readonly KnowledgeKind[],
          epistemicRoles: this.protocolSet(
            this.inspector.required(
              record,
              'epistemicRoles',
              'request.filters.epistemicRoles',
            ),
            'request.filters.epistemicRoles',
            KNOWLEDGE_SEARCH_LIMITS.epistemicRoles,
            'epistemic_roles',
            EPISTEMIC_ROLE_SET,
            EPISTEMIC_ROLES,
          ) as readonly EpistemicRole[],
          reviewStates: this.protocolSet(
            this.inspector.required(
              record,
              'reviewStates',
              'request.filters.reviewStates',
            ),
            'request.filters.reviewStates',
            KNOWLEDGE_SEARCH_LIMITS.itemReviewStates,
            'item_review_states',
            REVIEW_STATE_SET,
            KNOWLEDGE_REVIEW_STATES,
          ) as readonly KnowledgeReviewState[],
          source: this.sourceFilter(
            this.inspector.required(record, 'source', 'request.filters.source'),
          ),
          relation: this.relationFilter(
            this.inspector.required(
              record,
              'relation',
              'request.filters.relation',
            ),
          ),
        }),
    );
  }

  private sourceFilter(input: unknown): KnowledgeSearchSourceFilter {
    return this.inspector.record(
      input,
      ['kind'],
      ['resourceId', 'snapshotId', 'fragmentId', 'inputKinds'],
      'request.filters.source',
      (record) => {
        const kind = this.string(
          this.inspector.required(
            record,
            'kind',
            'request.filters.source.kind',
          ),
          'request.filters.source.kind',
        );
        if (kind === 'any') {
          this.inspector.requireExactBranch(
            record,
            ['kind'],
            'request.filters.source',
          );
          return defineOwnedRecord({kind});
        }
        const identifierField =
          kind === 'resource'
            ? 'resourceId'
            : kind === 'snapshot'
              ? 'snapshotId'
              : kind === 'fragment'
                ? 'fragmentId'
                : undefined;
        if (identifierField === undefined) {
          throw inputFault('invalid_enum', 'request.filters.source.kind');
        }
        this.inspector.requireExactBranch(
          record,
          ['kind', identifierField, 'inputKinds'],
          'request.filters.source',
        );
        const identifierPath =
          `request.filters.source.${identifierField}` as KnowledgeSearchIssuePath;
        const identifier = this.uuid(
          this.inspector.required(record, identifierField, identifierPath),
          identifierPath,
        );
        const inputKinds = this.protocolSet(
          this.inspector.required(
            record,
            'inputKinds',
            'request.filters.source.inputKinds',
          ),
          'request.filters.source.inputKinds',
          KNOWLEDGE_SEARCH_LIMITS.sourceInputKinds,
          'source_input_kinds',
          SOURCE_INPUT_KIND_SET,
          KNOWLEDGE_SEARCH_SOURCE_INPUT_KINDS,
        ) as readonly KnowledgeSearchSourceInputKind[];
        if (kind === 'resource') {
          return defineOwnedRecord({kind, resourceId: identifier, inputKinds});
        }
        if (kind === 'snapshot') {
          return defineOwnedRecord({kind, snapshotId: identifier, inputKinds});
        }
        return defineOwnedRecord({
          kind: 'fragment',
          fragmentId: identifier,
          inputKinds,
        });
      },
    );
  }

  private relationFilter(input: unknown): KnowledgeSearchRelationFilter {
    return this.inspector.record(
      input,
      ['kind'],
      ['anchorItemId', 'direction', 'relationTypeKeys', 'reviewStates'],
      'request.filters.relation',
      (record) => {
        const kind = this.string(
          this.inspector.required(
            record,
            'kind',
            'request.filters.relation.kind',
          ),
          'request.filters.relation.kind',
        );
        if (kind === 'any') {
          this.inspector.requireExactBranch(
            record,
            ['kind'],
            'request.filters.relation',
          );
          return defineOwnedRecord({kind});
        }
        if (kind !== 'connected_to') {
          throw inputFault('invalid_enum', 'request.filters.relation.kind');
        }
        this.inspector.requireExactBranch(
          record,
          [
            'kind',
            'anchorItemId',
            'direction',
            'relationTypeKeys',
            'reviewStates',
          ],
          'request.filters.relation',
        );
        return defineOwnedRecord({
          kind,
          anchorItemId: this.uuid(
            this.inspector.required(
              record,
              'anchorItemId',
              'request.filters.relation.anchorItemId',
            ),
            'request.filters.relation.anchorItemId',
          ),
          direction: this.enumValue(
            this.inspector.required(
              record,
              'direction',
              'request.filters.relation.direction',
            ),
            'request.filters.relation.direction',
            RELATION_DIRECTION_SET,
          ) as Extract<
            KnowledgeSearchRelationFilter,
            {kind: 'connected_to'}
          >['direction'],
          relationTypeKeys: this.relationTypeKeys(
            this.inspector.required(
              record,
              'relationTypeKeys',
              'request.filters.relation.relationTypeKeys',
            ),
          ),
          reviewStates: this.protocolSet(
            this.inspector.required(
              record,
              'reviewStates',
              'request.filters.relation.reviewStates',
            ),
            'request.filters.relation.reviewStates',
            KNOWLEDGE_SEARCH_LIMITS.relationReviewStates,
            'relation_review_states',
            REVIEW_STATE_SET,
            KNOWLEDGE_REVIEW_STATES,
          ) as readonly KnowledgeReviewState[],
        });
      },
    );
  }

  private relationTypeKeys(input: unknown): readonly string[] {
    const path = 'request.filters.relation.relationTypeKeys';
    const header = this.inspector.arrayHeader(
      input,
      path,
      KNOWLEDGE_SEARCH_LIMITS.relationTypeFilters,
      () => inputFault('limit_exceeded', path, 'relation_type_filters'),
    );
    const seen = new Set<string>();
    const values = this.inspector.decodeArray(header, (entry, index) => {
      const elementPath =
        `${path}[${String(index)}]` as KnowledgeSearchIssuePath;
      const value = this.singleLineText(
        entry,
        elementPath,
        KNOWLEDGE_SEARCH_LIMITS.relationTypeCodePoints,
        'relation_type_code_points',
      );
      if (seen.has(value)) {
        throw inputFault('duplicate_value', elementPath);
      }
      seen.add(value);
      return value;
    });
    return [...values].sort(compareUnsignedUtf8);
  }

  private page(input: unknown): DeterministicKnowledgeSearchRequest['page'] {
    return this.inspector.record(
      input,
      ['limit'],
      ['after'],
      'request.page',
      (record) => {
        const limit = this.pageLimit(
          this.inspector.required(record, 'limit', 'request.page.limit'),
        );
        const hasAfter = this.inspector.has(record, 'after');
        return defineOwnedRecord({
          limit,
          ...(!hasAfter
            ? {}
            : {
                after: this.cursor(
                  this.inspector.required(
                    record,
                    'after',
                    'request.page.after',
                  ),
                ),
              }),
        });
      },
    );
  }

  private cursor(input: unknown): KnowledgeSearchCursor {
    return this.inspector.record(
      input,
      [
        'schemaVersion',
        'querySha256',
        'matchRank',
        'normalizedTitle',
        'itemId',
      ],
      [],
      'request.page.after',
      (record) => {
        const schemaVersion = this.cursorNumber(
          this.inspector.required(
            record,
            'schemaVersion',
            'request.page.after.schemaVersion',
          ),
          'request.page.after.schemaVersion',
        );
        if (schemaVersion !== 1) {
          throw inputFault(
            'invalid_cursor',
            'request.page.after.schemaVersion',
          );
        }
        const querySha256 = this.cursorString(
          this.inspector.required(
            record,
            'querySha256',
            'request.page.after.querySha256',
          ),
          'request.page.after.querySha256',
        );
        if (!SHA256_PATTERN.test(querySha256)) {
          throw inputFault('invalid_cursor', 'request.page.after.querySha256');
        }
        const matchRank = this.cursorNumber(
          this.inspector.required(
            record,
            'matchRank',
            'request.page.after.matchRank',
          ),
          'request.page.after.matchRank',
        );
        if (
          Object.is(matchRank, -0) ||
          !Number.isInteger(matchRank) ||
          matchRank < 0 ||
          matchRank > 4
        ) {
          throw inputFault('invalid_cursor', 'request.page.after.matchRank');
        }
        const normalizedTitle = this.cursorString(
          this.inspector.required(
            record,
            'normalizedTitle',
            'request.page.after.normalizedTitle',
          ),
          'request.page.after.normalizedTitle',
        );
        if (
          !isValidSingleLineText(normalizedTitle) ||
          countCodePoints(normalizedTitle) >
            KNOWLEDGE_SEARCH_LIMITS.cursorTitleCodePoints ||
          searchKeyV1(normalizedTitle) !== normalizedTitle
        ) {
          throw inputFault(
            'invalid_cursor',
            'request.page.after.normalizedTitle',
          );
        }
        const itemId = this.cursorString(
          this.inspector.required(
            record,
            'itemId',
            'request.page.after.itemId',
          ),
          'request.page.after.itemId',
        );
        if (!UUID_PATTERN.test(itemId)) {
          throw inputFault('invalid_cursor', 'request.page.after.itemId');
        }
        return defineOwnedRecord({
          schemaVersion: 1,
          querySha256,
          matchRank: matchRank as KnowledgeSearchCursor['matchRank'],
          normalizedTitle,
          itemId,
        });
      },
    );
  }

  private protocolSet(
    input: unknown,
    path: KnowledgeSearchIssuePath,
    maximum: number,
    budget: KnowledgeSearchBudgetName,
    allowed: ReadonlySet<string>,
    declarationOrder: readonly string[],
  ): readonly string[] {
    const header = this.inspector.arrayHeader(input, path, maximum, () =>
      inputFault('limit_exceeded', path, budget),
    );
    const seen = new Set<string>();
    const values = this.inspector.decodeArray(header, (entry, index) => {
      const elementPath =
        `${path}[${String(index)}]` as KnowledgeSearchIssuePath;
      const value = this.enumValue(entry, elementPath, allowed);
      if (seen.has(value)) {
        throw inputFault('duplicate_value', elementPath);
      }
      seen.add(value);
      return value;
    });
    const order = new Map(
      declarationOrder.map((value, index) => [value, index] as const),
    );
    return [...values].sort(
      (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0),
    );
  }

  private queryText(input: unknown): string {
    const path = 'request.text.value';
    const value = this.string(input, path);
    if (!isValidQueryText(value)) {
      throw inputFault('invalid_text', path);
    }
    if (countCodePoints(value) > KNOWLEDGE_SEARCH_LIMITS.queryTextCodePoints) {
      throw inputFault('limit_exceeded', path, 'query_text_code_points');
    }
    return value;
  }

  private singleLineText(
    input: unknown,
    path: KnowledgeSearchIssuePath,
    limit: number,
    budget: KnowledgeSearchBudgetName,
  ): string {
    const value = this.string(input, path);
    if (!isValidSingleLineText(value)) {
      throw inputFault('invalid_text', path);
    }
    if (countCodePoints(value) > limit) {
      throw inputFault('limit_exceeded', path, budget);
    }
    return value;
  }

  private pageLimit(input: unknown): number {
    const path = 'request.page.limit';
    if (typeof input !== 'number') {
      throw inputFault('invalid_shape', path);
    }
    if (
      Object.is(input, -0) ||
      !Number.isFinite(input) ||
      !Number.isSafeInteger(input) ||
      input < 1
    ) {
      throw inputFault('invalid_state', path);
    }
    if (input > KNOWLEDGE_SEARCH_LIMITS.resultLimit) {
      throw inputFault('limit_exceeded', path, 'result_limit');
    }
    return input;
  }

  private authority(input: unknown): 'manual_user' {
    const value = this.string(input, 'context.authority');
    if (value !== 'manual_user') {
      throw inputFault('invalid_enum', 'context.authority');
    }
    return value;
  }

  private uuid(input: unknown, path: KnowledgeSearchIssuePath): string {
    const value = this.string(input, path);
    if (!UUID_PATTERN.test(value)) {
      throw inputFault('invalid_identifier', path);
    }
    return value;
  }

  private enumValue(
    input: unknown,
    path: KnowledgeSearchIssuePath,
    allowed: ReadonlySet<string>,
  ): string {
    const value = this.string(input, path);
    if (!allowed.has(value)) {
      throw inputFault('invalid_enum', path);
    }
    return value;
  }

  private string(input: unknown, path: KnowledgeSearchIssuePath): string {
    if (typeof input !== 'string') {
      throw inputFault('invalid_shape', path);
    }
    return input;
  }

  private cursorString(input: unknown, path: KnowledgeSearchIssuePath): string {
    return this.string(input, path);
  }

  private cursorNumber(input: unknown, path: KnowledgeSearchIssuePath): number {
    if (typeof input !== 'number') {
      throw inputFault('invalid_shape', path);
    }
    return input;
  }
}

class RepositorySnapshotDecoder {
  private readonly inspector = new ClosedInspector(
    () => new KnowledgeSearchRepositorySnapshotFault(),
  );

  public snapshot(input: unknown): DeterministicKnowledgeSearchSnapshot {
    return this.stateRecord(
      input,
      [
        'items',
        'revisions',
        'fragmentInputs',
        'relations',
        'relationRevisions',
      ],
      [],
      (record) =>
        defineOwnedRecord({
          items: this.stateArray(this.required(record, 'items'), (value) =>
            this.item(value),
          ),
          revisions: this.stateArray(
            this.required(record, 'revisions'),
            (value) => this.revision(value),
          ),
          fragmentInputs: this.stateArray(
            this.required(record, 'fragmentInputs'),
            (value) => this.fragmentInput(value),
          ),
          relations: this.stateArray(
            this.required(record, 'relations'),
            (value) => this.relation(value),
          ),
          relationRevisions: this.stateArray(
            this.required(record, 'relationRevisions'),
            (value) => this.relationRevision(value),
          ),
        }),
    );
  }

  private item(input: unknown): KnowledgeSearchItemState {
    return this.stateRecord(
      input,
      ['workspaceId', 'itemId', 'currentRevision', 'currentRevisionId'],
      [],
      (record) =>
        defineOwnedRecord({
          workspaceId: this.uuid(this.required(record, 'workspaceId')),
          itemId: this.uuid(this.required(record, 'itemId')),
          currentRevision: this.revisionNumber(
            this.required(record, 'currentRevision'),
          ),
          currentRevisionId: this.uuid(
            this.required(record, 'currentRevisionId'),
          ),
        }),
    );
  }

  private revision(input: unknown): KnowledgeSearchRevisionState {
    return this.stateRecord(
      input,
      ['workspaceId', 'itemId', 'revision', 'revisionId', 'value'],
      ['isPrivate'],
      (record) => {
        const isPrivate = this.optionalPrivacy(record, 'isPrivate');
        return defineOwnedRecord({
          workspaceId: this.uuid(this.required(record, 'workspaceId')),
          itemId: this.uuid(this.required(record, 'itemId')),
          revision: this.revisionNumber(this.required(record, 'revision')),
          revisionId: this.uuid(this.required(record, 'revisionId')),
          value: this.itemValue(this.required(record, 'value')),
          ...(isPrivate === true ? {isPrivate: true as const} : {}),
        });
      },
    );
  }

  private fragmentInput(input: unknown): KnowledgeSearchFragmentInputState {
    return this.stateRecord(
      input,
      [
        'workspaceId',
        'itemId',
        'revision',
        'revisionId',
        'inputKind',
        'inputOrdinal',
        'resourceId',
        'snapshotId',
        'fragmentId',
      ],
      [],
      (record) =>
        defineOwnedRecord({
          workspaceId: this.uuid(this.required(record, 'workspaceId')),
          itemId: this.uuid(this.required(record, 'itemId')),
          revision: this.revisionNumber(this.required(record, 'revision')),
          revisionId: this.uuid(this.required(record, 'revisionId')),
          inputKind: this.sourceInputKind(this.required(record, 'inputKind')),
          inputOrdinal: this.inputOrdinal(
            this.required(record, 'inputOrdinal'),
          ),
          resourceId: this.uuid(this.required(record, 'resourceId')),
          snapshotId: this.uuid(this.required(record, 'snapshotId')),
          fragmentId: this.uuid(this.required(record, 'fragmentId')),
        }),
    );
  }

  private relation(input: unknown): KnowledgeSearchRelationState {
    return this.stateRecord(
      input,
      [
        'workspaceId',
        'relationId',
        'subjectItemId',
        'relationTypeKey',
        'objectItemId',
        'currentRevision',
        'currentRevisionId',
      ],
      [],
      (record) =>
        defineOwnedRecord({
          workspaceId: this.uuid(this.required(record, 'workspaceId')),
          relationId: this.uuid(this.required(record, 'relationId')),
          subjectItemId: this.uuid(this.required(record, 'subjectItemId')),
          relationTypeKey: this.singleLineText(
            this.required(record, 'relationTypeKey'),
            KNOWLEDGE_SEARCH_LIMITS.relationTypeCodePoints,
          ),
          objectItemId: this.uuid(this.required(record, 'objectItemId')),
          currentRevision: this.revisionNumber(
            this.required(record, 'currentRevision'),
          ),
          currentRevisionId: this.uuid(
            this.required(record, 'currentRevisionId'),
          ),
        }),
    );
  }

  private relationRevision(
    input: unknown,
  ): KnowledgeSearchRelationRevisionState {
    return this.stateRecord(
      input,
      ['workspaceId', 'relationId', 'revision', 'revisionId', 'value'],
      ['isPrivate'],
      (record) => {
        const isPrivate = this.optionalPrivacy(record, 'isPrivate');
        return defineOwnedRecord({
          workspaceId: this.uuid(this.required(record, 'workspaceId')),
          relationId: this.uuid(this.required(record, 'relationId')),
          revision: this.revisionNumber(this.required(record, 'revision')),
          revisionId: this.uuid(this.required(record, 'revisionId')),
          value: this.relationValue(this.required(record, 'value')),
          ...(isPrivate === true ? {isPrivate: true as const} : {}),
        });
      },
    );
  }

  private itemValue(input: unknown): KnowledgeItemRevisionValue {
    return this.stateRecord(
      input,
      ['knowledgeKind', 'epistemicRole', 'reviewState', 'title'],
      ['body'],
      (record) => {
        const hasBody = this.inspector.has(record, 'body');
        return defineOwnedRecord({
          knowledgeKind: this.knowledgeKind(
            this.required(record, 'knowledgeKind'),
          ),
          epistemicRole: this.epistemicRole(
            this.required(record, 'epistemicRole'),
          ),
          reviewState: this.reviewState(this.required(record, 'reviewState')),
          title: this.singleLineText(this.required(record, 'title'), 300),
          ...(!hasBody
            ? {}
            : {
                body: this.multilineText(this.required(record, 'body'), 20_000),
              }),
        });
      },
    );
  }

  private relationValue(input: unknown): KnowledgeRelationRevisionValue {
    return this.stateRecord(
      input,
      [
        'subjectItemId',
        'relationTypeKey',
        'objectItemId',
        'epistemicRole',
        'reviewState',
      ],
      ['qualifier'],
      (record) => {
        const hasQualifier = this.inspector.has(record, 'qualifier');
        const epistemicRole = this.epistemicRole(
          this.required(record, 'epistemicRole'),
        );
        if (epistemicRole === 'source_excerpt') {
          throw new KnowledgeSearchRepositorySnapshotFault();
        }
        return defineOwnedRecord({
          subjectItemId: this.uuid(this.required(record, 'subjectItemId')),
          relationTypeKey: this.singleLineText(
            this.required(record, 'relationTypeKey'),
            KNOWLEDGE_SEARCH_LIMITS.relationTypeCodePoints,
          ),
          objectItemId: this.uuid(this.required(record, 'objectItemId')),
          epistemicRole,
          reviewState: this.reviewState(this.required(record, 'reviewState')),
          ...(!hasQualifier
            ? {}
            : {
                qualifier: this.multilineText(
                  this.required(record, 'qualifier'),
                  2_000,
                ),
              }),
        });
      },
    );
  }

  private stateRecord<Value>(
    input: unknown,
    required: readonly string[],
    optional: readonly string[],
    project: (record: DescriptorRecord) => Value,
  ): Value {
    return this.inspector.record(
      input,
      required,
      optional,
      'repository',
      project,
    );
  }

  private stateArray<Value>(
    input: unknown,
    decode: (value: unknown, index: number) => Value,
  ): readonly Value[] {
    return this.inspector.decodeArray(
      this.inspector.arrayHeader(input, 'repository'),
      decode,
    );
  }

  private required(record: DescriptorRecord, key: string): unknown {
    return this.inspector.required(record, key, 'repository');
  }

  private uuid(input: unknown): string {
    if (typeof input !== 'string' || !UUID_PATTERN.test(input)) {
      throw new KnowledgeSearchRepositorySnapshotFault();
    }
    return input;
  }

  private revisionNumber(input: unknown): number {
    if (
      typeof input !== 'number' ||
      Object.is(input, -0) ||
      !Number.isSafeInteger(input) ||
      input < 1 ||
      input > KNOWLEDGE_SEARCH_LIMITS.revisionNumber
    ) {
      throw new KnowledgeSearchRepositorySnapshotFault();
    }
    return input;
  }

  private inputOrdinal(input: unknown): number {
    if (
      typeof input !== 'number' ||
      Object.is(input, -0) ||
      !Number.isSafeInteger(input) ||
      input < 0 ||
      input >= 64
    ) {
      throw new KnowledgeSearchRepositorySnapshotFault();
    }
    return input;
  }

  private optionalPrivacy(
    record: DescriptorRecord,
    key: string,
  ): true | undefined {
    if (!this.inspector.has(record, key)) return undefined;
    const value = this.required(record, key);
    if (typeof value !== 'boolean') {
      throw new KnowledgeSearchRepositorySnapshotFault();
    }
    return value ? true : undefined;
  }

  private knowledgeKind(input: unknown): KnowledgeKind {
    if (typeof input !== 'string' || !KNOWLEDGE_KIND_SET.has(input)) {
      throw new KnowledgeSearchRepositorySnapshotFault();
    }
    return input as KnowledgeKind;
  }

  private epistemicRole(input: unknown): EpistemicRole {
    if (typeof input !== 'string' || !EPISTEMIC_ROLE_SET.has(input)) {
      throw new KnowledgeSearchRepositorySnapshotFault();
    }
    return input as EpistemicRole;
  }

  private reviewState(input: unknown): KnowledgeReviewState {
    if (typeof input !== 'string' || !REVIEW_STATE_SET.has(input)) {
      throw new KnowledgeSearchRepositorySnapshotFault();
    }
    return input as KnowledgeReviewState;
  }

  private sourceInputKind(input: unknown): KnowledgeSearchSourceInputKind {
    if (typeof input !== 'string' || !SOURCE_INPUT_KIND_SET.has(input)) {
      throw new KnowledgeSearchRepositorySnapshotFault();
    }
    return input as KnowledgeSearchSourceInputKind;
  }

  private singleLineText(input: unknown, maximum: number): string {
    if (
      typeof input !== 'string' ||
      !isValidSingleLineText(input) ||
      countCodePoints(input) > maximum
    ) {
      throw new KnowledgeSearchRepositorySnapshotFault();
    }
    return input;
  }

  private multilineText(input: unknown, maximum: number): string {
    if (
      typeof input !== 'string' ||
      !isValidMultilineText(input) ||
      countCodePoints(input) > maximum
    ) {
      throw new KnowledgeSearchRepositorySnapshotFault();
    }
    return input;
  }
}

export function decodeDeterministicKnowledgeSearchContext(
  input: unknown,
): DeterministicKnowledgeSearchContext {
  return deepFreeze(new RequestDecoder().context(input));
}

export function decodeDeterministicKnowledgeSearchRequest(
  input: unknown,
): DeterministicKnowledgeSearchRequest {
  return deepFreeze(new RequestDecoder().request(input));
}

export function decodeDeterministicKnowledgeSearchSnapshot(
  input: unknown,
): DeterministicKnowledgeSearchSnapshot {
  return deepFreeze(new RepositorySnapshotDecoder().snapshot(input));
}

function inputFault(
  code: KnowledgeSearchIssueCode,
  path: KnowledgeSearchIssuePath,
  budget?: KnowledgeSearchBudgetName,
): KnowledgeSearchInputFault {
  return new KnowledgeSearchInputFault(code, path, budget);
}

function isProxy(value: object): boolean {
  try {
    return utilityTypes.isProxy(value);
  } catch {
    return true;
  }
}

function isArrayIndex(key: string, length: number): boolean {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(key)) {
    return false;
  }
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function hasInheritedAccessor(
  prototype: object | null,
  key: PropertyKey,
): boolean {
  let cursor = prototype;
  while (cursor !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (
      descriptor !== undefined &&
      (typeof descriptor.get === 'function' ||
        typeof descriptor.set === 'function')
    ) {
      return true;
    }
    cursor = Object.getPrototypeOf(cursor) as object | null;
  }
  return false;
}

function declaredPath(path: string, key: string): string {
  return path === 'repository' ? path : `${path}.${key}`;
}

function countCodePoints(value: string): number {
  return Array.from(value).length;
}

function hasValidUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return false;
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isValidQueryText(value: string): boolean {
  if (
    value.length === 0 ||
    value.trim().length === 0 ||
    value.trim() !== value ||
    !hasValidUnicodeScalars(value)
  ) {
    return false;
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    ) {
      return false;
    }
  }
  return true;
}

function isValidSingleLineText(value: string): boolean {
  return isValidQueryText(value);
}

function isValidMultilineText(value: string): boolean {
  if (
    value.length === 0 ||
    value.trim().length === 0 ||
    !hasValidUnicodeScalars(value)
  ) {
    return false;
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      (codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    ) {
      return false;
    }
  }
  return true;
}
