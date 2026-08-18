import {types as utilityTypes} from 'node:util';

import {copyOwnedByteView, OwnedByteViewError} from './owned_byte_view.js';

export type JsonPrimitive = boolean | null | number | string;
export type JsonObject = Readonly<{[key: string]: JsonValue}>;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export type CanonicalJsonErrorCode =
  | 'input_invalid'
  | 'size_exceeded'
  | 'encoding_invalid'
  | 'syntax_invalid'
  | 'non_canonical';

export class CanonicalJsonError extends Error {
  public readonly code: CanonicalJsonErrorCode;

  public constructor(code: CanonicalJsonErrorCode, message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
    this.code = code;
  }
}

const DEFAULT_MAXIMUM_DEPTH = 64;
const DEFAULT_MAXIMUM_NODES = 100_000;
const DANGEROUS_PROPERTY_NAMES = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

interface NormalizationState {
  readonly ancestors: WeakSet<object>;
  readonly maximumDepth: number;
  readonly maximumNodes: number;
  nodesVisited: number;
}

export interface CanonicalJsonLimits {
  readonly maximumDepth?: number;
  readonly maximumValues?: number;
}

export function normalizeJsonValue(
  value: unknown,
  limits: Readonly<CanonicalJsonLimits> = {},
): JsonValue {
  const parsedLimits = parseLimits(limits);
  return normalizeValue(value, 0, {
    ancestors: new WeakSet<object>(),
    maximumDepth: parsedLimits.maximumDepth,
    maximumNodes: parsedLimits.maximumValues,
    nodesVisited: 0,
  });
}

export function encodeCanonicalJson(
  value: unknown,
  maximumBytes: number,
  limits: Readonly<CanonicalJsonLimits> = {},
): Uint8Array {
  validateMaximumBytes(maximumBytes);
  const normalized = normalizeJsonValue(value, limits);
  const encoded = new TextEncoder().encode(`${JSON.stringify(normalized)}\n`);
  if (encoded.byteLength > maximumBytes) {
    throw new CanonicalJsonError(
      'size_exceeded',
      'Canonical JSON exceeds the configured byte limit.',
    );
  }
  return encoded;
}

export function decodeCanonicalJson(
  input: Uint8Array,
  maximumBytes: number,
  limits: Readonly<CanonicalJsonLimits> = {},
): JsonValue {
  let ownedBytes: Uint8Array;
  try {
    ownedBytes = copyOwnedByteView(input, maximumBytes);
  } catch (error) {
    throw mapOwnedByteError(error);
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', {fatal: true}).decode(ownedBytes);
  } catch {
    throw new CanonicalJsonError(
      'encoding_invalid',
      'Canonical JSON must use valid UTF-8.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new CanonicalJsonError(
      'syntax_invalid',
      'Canonical JSON syntax is invalid.',
    );
  }
  const normalized = normalizeJsonValue(parsed, limits);
  const canonicalBytes = encodeCanonicalJson(normalized, maximumBytes, limits);
  if (!equalBytes(ownedBytes, canonicalBytes)) {
    throw new CanonicalJsonError(
      'non_canonical',
      'JSON does not use the required canonical encoding.',
    );
  }
  return normalized;
}

function normalizeValue(
  value: unknown,
  depth: number,
  state: NormalizationState,
): JsonValue {
  state.nodesVisited += 1;
  if (depth > state.maximumDepth || state.nodesVisited > state.maximumNodes) {
    throw invalidJsonValue();
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw invalidJsonValue();
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object' || utilityTypes.isProxy(value)) {
    throw invalidJsonValue();
  }
  if (state.ancestors.has(value)) {
    throw invalidJsonValue();
  }

  state.ancestors.add(value);
  try {
    if (isReadonlyArray(value)) {
      return normalizeArray(value, depth, state);
    }
    return normalizeObject(value, depth, state);
  } finally {
    state.ancestors.delete(value);
  }
}

function normalizeArray(
  value: readonly unknown[],
  depth: number,
  state: NormalizationState,
): readonly JsonValue[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw invalidJsonValue();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    string,
    PropertyDescriptor
  >;
  const keys = Reflect.ownKeys(value);
  const lengthDescriptor = descriptors.length;
  if (lengthDescriptor === undefined) {
    throw invalidJsonValue();
  }
  const lengthValue = lengthDescriptor.value as unknown;
  if (
    !('value' in lengthDescriptor) ||
    typeof lengthValue !== 'number' ||
    lengthValue > state.maximumNodes ||
    keys.length !== lengthValue + 1
  ) {
    throw invalidJsonValue();
  }

  const output: JsonValue[] = [];
  for (let index = 0; index < lengthValue; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw invalidJsonValue();
    }
    output.push(normalizeValue(descriptor.value as unknown, depth + 1, state));
  }
  for (const key of keys) {
    if (
      typeof key === 'symbol' ||
      (key !== 'length' && !isCanonicalArrayIndex(key, lengthValue))
    ) {
      throw invalidJsonValue();
    }
  }
  return Object.freeze(output);
}

function normalizeObject(
  value: object,
  depth: number,
  state: NormalizationState,
): JsonObject {
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidJsonValue();
  }

  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    string,
    PropertyDescriptor
  >;
  const keys = Reflect.ownKeys(value);
  const stringKeys: string[] = [];
  for (const key of keys) {
    if (typeof key === 'symbol' || DANGEROUS_PROPERTY_NAMES.has(key)) {
      throw invalidJsonValue();
    }
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw invalidJsonValue();
    }
    stringKeys.push(key);
  }

  const output = Object.create(null) as Record<string, JsonValue>;
  for (const key of stringKeys.sort()) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !('value' in descriptor)) {
      throw invalidJsonValue();
    }
    output[key] = normalizeValue(descriptor.value as unknown, depth + 1, state);
  }
  return Object.freeze(output);
}

function isCanonicalArrayIndex(key: string, length: number): boolean {
  if (!/^(0|[1-9][0-9]*)$/u.test(key)) {
    return false;
  }
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function isReadonlyArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function validateMaximumBytes(maximumBytes: number): void {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new CanonicalJsonError(
      'input_invalid',
      'The canonical JSON byte limit is invalid.',
    );
  }
}

function parseLimits(
  limits: Readonly<CanonicalJsonLimits>,
): Readonly<{maximumDepth: number; maximumValues: number}> {
  const maximumDepth = limits.maximumDepth ?? DEFAULT_MAXIMUM_DEPTH;
  const maximumValues = limits.maximumValues ?? DEFAULT_MAXIMUM_NODES;
  if (
    !Number.isSafeInteger(maximumDepth) ||
    maximumDepth < 0 ||
    !Number.isSafeInteger(maximumValues) ||
    maximumValues < 1
  ) {
    throw new CanonicalJsonError(
      'input_invalid',
      'The canonical JSON structural limits are invalid.',
    );
  }
  return Object.freeze({maximumDepth, maximumValues});
}

function mapOwnedByteError(error: unknown): CanonicalJsonError {
  if (error instanceof OwnedByteViewError && error.code === 'input_too_large') {
    return new CanonicalJsonError(
      'size_exceeded',
      'Canonical JSON exceeds the configured byte limit.',
    );
  }
  return new CanonicalJsonError(
    'input_invalid',
    'Canonical JSON input must be an ordinary byte view.',
  );
}

function invalidJsonValue(): CanonicalJsonError {
  return new CanonicalJsonError(
    'input_invalid',
    'Canonical JSON accepts only bounded ordinary JSON values.',
  );
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
