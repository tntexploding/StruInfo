import {types as utilityTypes} from 'node:util';

import {copyOwnedByteView} from '../../../serialization/owned_byte_view.js';
import type {
  CodePointRange,
  ExactBlobIdentity,
  LineRange,
  PublicationInput,
  SnapshotInput,
} from '../evidence_contract.js';
import {
  MARKDOWN_PROFILES,
  type MarkdownDiagnostic,
  type MaterializeMarkdownEvidenceInput,
  type ParseMarkdownInput,
  type ParsedLinkReference,
  type ParsedLinkResolution,
  type ParsedMarkdownDocument,
  type ParsedMarkdownFragment,
  type ParsedMarkdownNode,
  type ParsedMediaReference,
} from './markdown_contract.js';
import {markdownFail} from './markdown_failure.js';

const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
const typedArrayBufferDescriptor = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'buffer',
);
const typedArrayByteOffsetDescriptor = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteOffset',
);
const typedArrayByteLengthDescriptor = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteLength',
);
const arrayBufferByteLengthDescriptor = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
);
const arrayBufferResizableDescriptor = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'resizable',
);
const arrayBufferDetachedDescriptor = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'detached',
);
const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype']);

export interface CheckedByteView {
  readonly value: Uint8Array;
  readonly byteLength: number;
}

export interface DecodedParseMarkdownInput extends Omit<
  ParseMarkdownInput,
  'sourceUtf8'
> {
  readonly sourceUtf8: Readonly<CheckedByteView>;
}

export interface DecodedParsedMarkdownDocument extends Omit<
  ParsedMarkdownDocument,
  'normalizedTextUtf8'
> {
  readonly normalizedTextUtf8: Readonly<CheckedByteView>;
}

export interface DecodedMaterializeMarkdownEvidenceInput extends Omit<
  MaterializeMarkdownEvidenceInput,
  'parsed' | 'sourceUtf8'
> {
  readonly parsed: Readonly<DecodedParsedMarkdownDocument>;
  readonly sourceUtf8: Readonly<CheckedByteView>;
}

type InspectedRecord = Readonly<Record<string, unknown>>;

export function decodeParseMarkdownInput(
  value: unknown,
): DecodedParseMarkdownInput {
  const record = inspectRecord(
    value,
    [
      'workspaceId',
      'resourceId',
      'snapshotId',
      'rawBlob',
      'profile',
      'sourceUtf8',
    ],
    ['documentBaseUri'],
  );
  const profile = requiredString(record, 'profile');
  if (!isOneOf(MARKDOWN_PROFILES, profile)) {
    invalidShape();
  }
  const documentBaseUri = optionalString(record, 'documentBaseUri');
  return {
    workspaceId: requiredString(record, 'workspaceId'),
    resourceId: requiredString(record, 'resourceId'),
    snapshotId: requiredString(record, 'snapshotId'),
    rawBlob: decodeExactBlob(requiredValue(record, 'rawBlob')),
    profile,
    sourceUtf8: inspectByteView(requiredValue(record, 'sourceUtf8')),
    ...(documentBaseUri === undefined ? {} : {documentBaseUri}),
  };
}

export function decodeMaterializeMarkdownEvidenceInput(
  value: unknown,
): DecodedMaterializeMarkdownEvidenceInput {
  const record = inspectRecord(
    value,
    ['parsed', 'snapshot', 'mediaPolicy', 'sourceUtf8'],
    [],
  );
  const mediaPolicy = requiredString(record, 'mediaPolicy');
  if (mediaPolicy !== 'external_reference_only') {
    invalidShape();
  }
  return {
    parsed: decodeParsedDocument(requiredValue(record, 'parsed')),
    snapshot: decodeSnapshot(requiredValue(record, 'snapshot')),
    mediaPolicy,
    sourceUtf8: inspectByteView(requiredValue(record, 'sourceUtf8')),
  };
}

export function copyCheckedByteView(
  checked: Readonly<CheckedByteView>,
): Uint8Array {
  try {
    return copyOwnedByteView(checked.value, checked.byteLength);
  } catch {
    invalidShape();
  }
}

function decodeParsedDocument(value: unknown): DecodedParsedMarkdownDocument {
  const record = inspectRecord(
    value,
    [
      'workspaceId',
      'resourceId',
      'snapshotId',
      'rawBlob',
      'profile',
      'parserName',
      'parserVersion',
      'textNormalizationVersion',
      'structureProjectionVersion',
      'normalizedTextUtf8',
      'normalizedTextSha256',
      'normalizedTextByteLength',
      'structureSha256',
      'nodes',
      'fragments',
      'intakeTargetNodeKeys',
      'links',
      'media',
      'diagnostics',
    ],
    ['documentBaseUri'],
  );
  const profile = requiredString(record, 'profile');
  const documentBaseUri = optionalString(record, 'documentBaseUri');
  return {
    workspaceId: requiredString(record, 'workspaceId'),
    resourceId: requiredString(record, 'resourceId'),
    snapshotId: requiredString(record, 'snapshotId'),
    rawBlob: decodeExactBlob(requiredValue(record, 'rawBlob')),
    profile: profile as ParsedMarkdownDocument['profile'],
    parserName: requiredString(
      record,
      'parserName',
    ) as ParsedMarkdownDocument['parserName'],
    parserVersion: requiredString(
      record,
      'parserVersion',
    ) as ParsedMarkdownDocument['parserVersion'],
    textNormalizationVersion: requiredString(
      record,
      'textNormalizationVersion',
    ) as ParsedMarkdownDocument['textNormalizationVersion'],
    structureProjectionVersion: requiredString(
      record,
      'structureProjectionVersion',
    ) as ParsedMarkdownDocument['structureProjectionVersion'],
    ...(documentBaseUri === undefined ? {} : {documentBaseUri}),
    normalizedTextUtf8: inspectByteView(
      requiredValue(record, 'normalizedTextUtf8'),
    ),
    normalizedTextSha256: requiredString(record, 'normalizedTextSha256'),
    normalizedTextByteLength: requiredNumber(
      record,
      'normalizedTextByteLength',
    ),
    structureSha256: requiredString(record, 'structureSha256'),
    nodes: decodeArray(requiredValue(record, 'nodes'), decodeParsedNode),
    fragments: decodeArray(
      requiredValue(record, 'fragments'),
      decodeParsedFragment,
    ),
    intakeTargetNodeKeys: decodeArray(
      requiredValue(record, 'intakeTargetNodeKeys'),
      decodeString,
    ),
    links: decodeArray(requiredValue(record, 'links'), decodeLink),
    media: decodeArray(requiredValue(record, 'media'), decodeMedia),
    diagnostics: decodeArray(
      requiredValue(record, 'diagnostics'),
      decodeDiagnostic,
    ),
  };
}

function decodeParsedNode(value: unknown): ParsedMarkdownNode {
  const record = inspectRecord(
    value,
    ['localKey', 'kind', 'siblingOrdinal', 'codePointRange', 'lineRange'],
    ['parentLocalKey'],
  );
  const parentLocalKey = optionalString(record, 'parentLocalKey');
  return {
    localKey: requiredString(record, 'localKey'),
    ...(parentLocalKey === undefined ? {} : {parentLocalKey}),
    kind: requiredString(record, 'kind') as ParsedMarkdownNode['kind'],
    siblingOrdinal: requiredNumber(record, 'siblingOrdinal'),
    codePointRange: decodeCodePointRange(
      requiredValue(record, 'codePointRange'),
    ),
    lineRange: decodeLineRange(requiredValue(record, 'lineRange')),
  };
}

function decodeParsedFragment(value: unknown): ParsedMarkdownFragment {
  const record = inspectRecord(
    value,
    [
      'localKey',
      'nodeLocalKey',
      'role',
      'selectedTextSha256',
      'codePointRange',
      'lineRange',
    ],
    [],
  );
  return {
    localKey: requiredString(record, 'localKey'),
    nodeLocalKey: requiredString(record, 'nodeLocalKey'),
    role: requiredString(record, 'role') as ParsedMarkdownFragment['role'],
    selectedTextSha256: requiredString(record, 'selectedTextSha256'),
    codePointRange: decodeCodePointRange(
      requiredValue(record, 'codePointRange'),
    ),
    lineRange: decodeLineRange(requiredValue(record, 'lineRange')),
  };
}

function decodeLink(value: unknown): ParsedLinkReference {
  const record = inspectRecord(
    value,
    [
      'localKey',
      'nodeLocalKey',
      'ordinal',
      'rawDestination',
      'resolution',
      'captureState',
      'codePointRange',
      'lineRange',
    ],
    [],
  );
  return {
    localKey: requiredString(record, 'localKey'),
    nodeLocalKey: requiredString(record, 'nodeLocalKey'),
    ordinal: requiredNumber(record, 'ordinal'),
    rawDestination: requiredString(record, 'rawDestination'),
    resolution: decodeLinkResolution(requiredValue(record, 'resolution')),
    captureState: requiredString(
      record,
      'captureState',
    ) as ParsedLinkReference['captureState'],
    codePointRange: decodeCodePointRange(
      requiredValue(record, 'codePointRange'),
    ),
    lineRange: decodeLineRange(requiredValue(record, 'lineRange')),
  };
}

function decodeLinkResolution(value: unknown): ParsedLinkResolution {
  const inspected = inspectRecordForDiscriminant(value, 'status');
  const status = requiredString(inspected.record, 'status');
  if (status === 'resolved') {
    const record = inspectRecord(value, ['status', 'uri'], []);
    return {status, uri: requiredString(record, 'uri')};
  }
  if (status === 'not_resolved') {
    const record = inspectRecord(value, ['status', 'reason'], []);
    return {
      status,
      reason: requiredString(record, 'reason') as Extract<
        ParsedLinkResolution,
        {status: 'not_resolved'}
      >['reason'],
    };
  }
  invalidShape();
}

function decodeMedia(value: unknown): ParsedMediaReference {
  const record = inspectRecord(
    value,
    [
      'localKey',
      'imageNodeLocalKey',
      'ordinal',
      'rawDestination',
      'resolvedUri',
      'purpose',
      'purposeOrigin',
      'codePointRange',
      'lineRange',
    ],
    [],
  );
  return {
    localKey: requiredString(record, 'localKey'),
    imageNodeLocalKey: requiredString(record, 'imageNodeLocalKey'),
    ordinal: requiredNumber(record, 'ordinal'),
    rawDestination: requiredString(record, 'rawDestination'),
    resolvedUri: requiredString(record, 'resolvedUri'),
    purpose: requiredString(
      record,
      'purpose',
    ) as ParsedMediaReference['purpose'],
    purposeOrigin: requiredString(
      record,
      'purposeOrigin',
    ) as ParsedMediaReference['purposeOrigin'],
    codePointRange: decodeCodePointRange(
      requiredValue(record, 'codePointRange'),
    ),
    lineRange: decodeLineRange(requiredValue(record, 'lineRange')),
  };
}

function decodeDiagnostic(value: unknown): MarkdownDiagnostic {
  const record = inspectRecord(
    value,
    ['code', 'codePointRange', 'lineRange'],
    [],
  );
  return {
    code: requiredString(record, 'code') as MarkdownDiagnostic['code'],
    codePointRange: decodeCodePointRange(
      requiredValue(record, 'codePointRange'),
    ),
    lineRange: decodeLineRange(requiredValue(record, 'lineRange')),
  };
}

function decodeSnapshot(value: unknown): SnapshotInput {
  const record = inspectRecord(
    value,
    [
      'workspaceId',
      'snapshotId',
      'resourceId',
      'rawSha256',
      'canonicalContentSha256',
      'canonicalizationVersion',
      'capturedAt',
    ],
    ['rawBlob', 'mediaType', 'publication'],
  );
  const rawBlobValue = optionalValue(record, 'rawBlob');
  const mediaType = optionalString(record, 'mediaType');
  const publicationValue = optionalValue(record, 'publication');
  return {
    workspaceId: requiredString(record, 'workspaceId'),
    snapshotId: requiredString(record, 'snapshotId'),
    resourceId: requiredString(record, 'resourceId'),
    rawSha256: requiredString(record, 'rawSha256'),
    ...(rawBlobValue === undefined
      ? {}
      : {rawBlob: decodeExactBlob(rawBlobValue)}),
    canonicalContentSha256: requiredString(record, 'canonicalContentSha256'),
    canonicalizationVersion: requiredString(record, 'canonicalizationVersion'),
    ...(mediaType === undefined ? {} : {mediaType}),
    ...(publicationValue === undefined
      ? {}
      : {publication: decodePublication(publicationValue)}),
    capturedAt: requiredString(record, 'capturedAt'),
  };
}

function decodePublication(value: unknown): PublicationInput {
  const record = inspectRecord(
    value,
    ['inferred'],
    ['instant', 'sourceTimezone', 'precision', 'sourceText'],
  );
  const instant = optionalString(record, 'instant');
  const sourceTimezone = optionalString(record, 'sourceTimezone');
  const precision = optionalString(record, 'precision');
  const sourceText = optionalString(record, 'sourceText');
  return {
    ...(instant === undefined ? {} : {instant}),
    ...(sourceTimezone === undefined ? {} : {sourceTimezone}),
    ...(precision === undefined
      ? {}
      : {precision: precision as NonNullable<PublicationInput['precision']>}),
    ...(sourceText === undefined ? {} : {sourceText}),
    inferred: requiredBoolean(record, 'inferred'),
  };
}

function decodeExactBlob(value: unknown): ExactBlobIdentity {
  const record = inspectRecord(
    value,
    ['workspaceId', 'blobId', 'digestAlgorithm', 'digest', 'byteLength'],
    [],
  );
  return {
    workspaceId: requiredString(record, 'workspaceId'),
    blobId: requiredString(record, 'blobId'),
    digestAlgorithm: requiredString(
      record,
      'digestAlgorithm',
    ) as ExactBlobIdentity['digestAlgorithm'],
    digest: requiredString(record, 'digest'),
    byteLength: requiredNumber(record, 'byteLength'),
  };
}

function decodeCodePointRange(value: unknown): CodePointRange {
  const record = inspectRecord(value, ['start', 'end'], []);
  return {
    start: requiredNumber(record, 'start'),
    end: requiredNumber(record, 'end'),
  };
}

function decodeLineRange(value: unknown): LineRange {
  const record = inspectRecord(value, ['start', 'end'], []);
  return {
    start: requiredNumber(record, 'start'),
    end: requiredNumber(record, 'end'),
  };
}

function inspectByteView(value: unknown): Readonly<CheckedByteView> {
  if (
    value === null ||
    typeof value !== 'object' ||
    utilityTypes.isProxy(value)
  ) {
    invalidShape();
  }
  try {
    if (
      !utilityTypes.isUint8Array(value) ||
      Object.getPrototypeOf(value) !== Uint8Array.prototype ||
      typedArrayBufferDescriptor?.get === undefined ||
      typedArrayByteOffsetDescriptor?.get === undefined ||
      typedArrayByteLengthDescriptor?.get === undefined ||
      arrayBufferByteLengthDescriptor?.get === undefined ||
      arrayBufferResizableDescriptor?.get === undefined ||
      arrayBufferDetachedDescriptor?.get === undefined
    ) {
      invalidShape();
    }
    const backingBuffer = typedArrayBufferDescriptor.get.call(
      value,
    ) as ArrayBufferLike;
    const byteOffset = typedArrayByteOffsetDescriptor.get.call(value) as number;
    const byteLength = typedArrayByteLengthDescriptor.get.call(value) as number;
    if (
      utilityTypes.isSharedArrayBuffer(backingBuffer) ||
      !utilityTypes.isArrayBuffer(backingBuffer)
    ) {
      invalidShape();
    }
    const backingByteLength = arrayBufferByteLengthDescriptor.get.call(
      backingBuffer,
    ) as number;
    const resizable = arrayBufferResizableDescriptor.get.call(
      backingBuffer,
    ) as boolean;
    const detached = arrayBufferDetachedDescriptor.get.call(
      backingBuffer,
    ) as boolean;
    if (
      resizable ||
      detached ||
      byteOffset !== 0 ||
      byteLength !== backingByteLength
    ) {
      invalidShape();
    }
    validateTypedArrayOwnProperties(value, byteLength);
    return Object.freeze({value, byteLength});
  } catch (error) {
    if (isMarkdownFault(error)) {
      throw error;
    }
    invalidShape();
  }
}

function validateTypedArrayOwnProperties(
  value: object,
  byteLength: number,
): void {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== byteLength) {
    invalidShape();
  }
  for (const key of keys) {
    if (typeof key !== 'string' || !isCanonicalArrayIndex(key)) {
      invalidShape();
    }
    const index = Number(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      index >= byteLength ||
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      invalidShape();
    }
  }
}

function inspectRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): InspectedRecord {
  if (
    value === null ||
    typeof value !== 'object' ||
    utilityTypes.isProxy(value)
  ) {
    invalidShape();
  }
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Reflect.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    invalidShape();
  }
  if (prototype !== Object.prototype) {
    invalidShape();
  }
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const descriptors: (readonly [string, PropertyDescriptor])[] = [];
  for (const key of keys) {
    if (
      typeof key !== 'string' ||
      dangerousKeys.has(key) ||
      !allowed.has(key)
    ) {
      invalidShape();
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      invalidShape();
    }
    descriptors.push([key, descriptor]);
  }
  const present = new Set(descriptors.map(([key]) => key));
  if (requiredKeys.some((key) => !present.has(key))) {
    invalidShape();
  }
  const result = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of descriptors) {
    Object.defineProperty(result, key, {
      value: descriptor.value as unknown,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return result;
}

function inspectRecordForDiscriminant(
  value: unknown,
  discriminant: string,
): Readonly<{record: InspectedRecord}> {
  if (
    value === null ||
    typeof value !== 'object' ||
    utilityTypes.isProxy(value)
  ) {
    invalidShape();
  }
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Reflect.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    invalidShape();
  }
  if (prototype !== Object.prototype) {
    invalidShape();
  }
  const result = Object.create(null) as Record<string, unknown>;
  let found = false;
  for (const key of keys) {
    if (typeof key !== 'string' || dangerousKeys.has(key)) {
      invalidShape();
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      invalidShape();
    }
    if (key === discriminant) {
      found = true;
      Object.defineProperty(result, key, {
        value: descriptor.value as unknown,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
  }
  if (!found) {
    invalidShape();
  }
  return Object.freeze({record: result});
}

function decodeArray<Value>(
  value: unknown,
  decodeItem: (item: unknown) => Value,
): readonly Value[] {
  if (
    value === null ||
    typeof value !== 'object' ||
    utilityTypes.isProxy(value)
  ) {
    invalidShape();
  }
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Reflect.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    invalidShape();
  }
  if (!Array.isArray(value) || prototype !== Array.prototype) {
    invalidShape();
  }
  const indexes = new Map<number, PropertyDescriptor>();
  let lengthDescriptor: PropertyDescriptor | undefined;
  for (const key of keys) {
    if (typeof key !== 'string') {
      invalidShape();
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, 'value') ||
      (key !== 'length' && !descriptor.enumerable)
    ) {
      invalidShape();
    }
    if (key === 'length') {
      lengthDescriptor = descriptor;
    } else if (dangerousKeys.has(key) || !isCanonicalArrayIndex(key)) {
      invalidShape();
    } else {
      indexes.set(Number(key), descriptor);
    }
  }
  const length = lengthDescriptor?.value as unknown;
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    indexes.size !== length ||
    [...indexes.keys()].some((index) => index >= length)
  ) {
    invalidShape();
  }
  return [...indexes.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, descriptor]) => decodeItem(descriptor.value as unknown));
}

function requiredValue(record: InspectedRecord, key: string): unknown {
  if (!Object.hasOwn(record, key)) {
    invalidShape();
  }
  return record[key];
}

function optionalValue(record: InspectedRecord, key: string): unknown {
  if (!Object.hasOwn(record, key)) {
    return undefined;
  }
  const value = record[key];
  if (value === undefined) {
    invalidShape();
  }
  return value;
}

function requiredString(record: InspectedRecord, key: string): string {
  const value = requiredValue(record, key);
  if (typeof value !== 'string') {
    invalidShape();
  }
  return value;
}

function optionalString(
  record: InspectedRecord,
  key: string,
): string | undefined {
  const value = optionalValue(record, key);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    invalidShape();
  }
  return value;
}

function requiredNumber(record: InspectedRecord, key: string): number {
  const value = requiredValue(record, key);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalidShape();
  }
  return value;
}

function requiredBoolean(record: InspectedRecord, key: string): boolean {
  const value = requiredValue(record, key);
  if (typeof value !== 'boolean') {
    invalidShape();
  }
  return value;
}

function decodeString(value: unknown): string {
  if (typeof value !== 'string') {
    invalidShape();
  }
  return value;
}

function isCanonicalArrayIndex(key: string): boolean {
  if (!/^(0|[1-9][0-9]*)$/u.test(key)) {
    return false;
  }
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0;
}

function isOneOf<const Values extends readonly string[]>(
  values: Values,
  candidate: string,
): candidate is Values[number] {
  return values.some((value) => value === candidate);
}

function isMarkdownFault(error: unknown): boolean {
  return error instanceof Error && error.name === 'MarkdownFault';
}

function invalidShape(): never {
  markdownFail('invalid_shape', '$');
}
