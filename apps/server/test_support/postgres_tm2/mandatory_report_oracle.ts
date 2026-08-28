import {readFile, stat} from 'node:fs/promises';
import {types} from 'node:util';

import type {Tm2BoundedChildResult} from './bounded_child.js';
import {TM2_MANDATORY_LEDGER} from './mandatory_ledger.js';

export const TM2_MANDATORY_REPORT_MAX_BYTES = 4 * 1024 * 1024;
export const TM2_MANDATORY_SUITE_PATH =
  'tests/postgres/postgres_tm2_mandatory.tm2.ts';
export const TM2_SELFTEST_SUITE_PATH =
  'tests/postgres/postgres_tm2_oracle_selftest.tm2.ts';

const ROOT_KEYS = Object.freeze([
  'numFailedTests',
  'numFailedTestSuites',
  'numPassedTests',
  'numPassedTestSuites',
  'numPendingTests',
  'numPendingTestSuites',
  'numTodoTests',
  'numTotalTests',
  'numTotalTestSuites',
  'snapshot',
  'startTime',
  'success',
  'testResults',
] as const);

const SNAPSHOT_KEYS = Object.freeze([
  'added',
  'didUpdate',
  'failure',
  'filesAdded',
  'filesRemoved',
  'filesRemovedList',
  'filesUnmatched',
  'filesUpdated',
  'matched',
  'total',
  'unchecked',
  'uncheckedKeysByFile',
  'unmatched',
  'updated',
] as const);

const TEST_RESULT_KEYS = Object.freeze([
  'assertionResults',
  'endTime',
  'message',
  'name',
  'startTime',
  'status',
] as const);

const ASSERTION_REQUIRED_KEYS = Object.freeze([
  'ancestorTitles',
  'failureMessages',
  'fullName',
  'meta',
  'status',
  'tags',
  'title',
] as const);

const ASSERTION_ALLOWED_KEYS = Object.freeze([
  ...ASSERTION_REQUIRED_KEYS,
  'duration',
  'location',
] as const);

const EXPECTED_MANDATORY_IDS = Object.freeze(
  TM2_MANDATORY_LEDGER.map((row) => row.id),
);
const EXPECTED_MANDATORY_ID_SET: ReadonlySet<string> = new Set(
  EXPECTED_MANDATORY_IDS,
);
const ALLOWED_SUITE_PATHS = new Set([
  TM2_MANDATORY_SUITE_PATH,
  TM2_SELFTEST_SUITE_PATH,
]);

export interface Tm2MandatoryReportIo {
  stat(
    path: string,
  ): Promise<{readonly size: number; readonly isFile: () => boolean}>;
  read(path: string): Promise<Uint8Array>;
}

export type Tm2MandatoryReportAudit =
  | {readonly status: 'valid'; readonly mandatoryCount: number}
  | {readonly status: 'invalid'};

export type Tm2MandatoryExecutionAudit =
  | {
      readonly status: 'valid';
      readonly mandatoryCount: number;
      readonly reportRead: true;
    }
  | {
      readonly status: 'child_not_completed' | 'child_failed';
      readonly reportRead: false;
    }
  | {readonly status: 'report_invalid'; readonly reportRead: true};

const SYSTEM_REPORT_IO: Tm2MandatoryReportIo = Object.freeze({
  async stat(path: string) {
    return await stat(path);
  },
  async read(path: string) {
    return await readFile(path);
  },
});

function readClosedRecord(
  value: unknown,
  requiredKeys: readonly string[],
  allowedKeys: readonly string[] = requiredKeys,
): ReadonlyMap<string, unknown> | undefined {
  if (types.isProxy(value)) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return undefined;
  }
  const allowed = new Set(allowedKeys);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((key) => typeof key !== 'string' || !allowed.has(key)) ||
    requiredKeys.some((key) => !ownKeys.includes(key))
  ) {
    return undefined;
  }
  const result = new Map<string, unknown>();
  for (const key of ownKeys) {
    if (typeof key !== 'string') {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return undefined;
    }
    result.set(key, descriptor.value);
  }
  return result;
}

function readDenseArray(value: unknown): readonly unknown[] | undefined {
  if (types.isProxy(value)) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return undefined;
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return undefined;
  }
  const result: unknown[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return undefined;
    }
    result.push(descriptor.value);
  }
  const expectedKeys = new Set<string>([
    'length',
    ...Array.from({length: result.length}, (_, index) => String(index)),
  ]);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
  ) {
    return undefined;
  }
  return Object.freeze(result);
}

function isClosedString(value: unknown): value is string {
  return !types.isProxy(value) && typeof value === 'string';
}

function isClosedBoolean(value: unknown): value is boolean {
  return !types.isProxy(value) && typeof value === 'boolean';
}

function isFiniteNonnegativeNumber(value: unknown): value is number {
  return (
    !types.isProxy(value) &&
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function isNonnegativeInteger(value: unknown): value is number {
  return isFiniteNonnegativeNumber(value) && Number.isSafeInteger(value);
}

function readStringArray(value: unknown): readonly string[] | undefined {
  const values = readDenseArray(value);
  if (values === undefined) {
    return undefined;
  }
  const result: string[] = [];
  for (const item of values) {
    if (!isClosedString(item)) {
      return undefined;
    }
    result.push(item);
  }
  return Object.freeze(result);
}

function isClosedSnapshot(value: unknown): boolean {
  const fields = readClosedRecord(value, SNAPSHOT_KEYS);
  if (fields === undefined) {
    return false;
  }
  for (const key of [
    'added',
    'filesAdded',
    'filesRemoved',
    'filesUnmatched',
    'filesUpdated',
    'matched',
    'total',
    'unchecked',
    'unmatched',
    'updated',
  ] as const) {
    if (!isNonnegativeInteger(fields.get(key))) {
      return false;
    }
  }
  if (
    !isClosedBoolean(fields.get('didUpdate')) ||
    !isClosedBoolean(fields.get('failure')) ||
    readStringArray(fields.get('filesRemovedList')) === undefined
  ) {
    return false;
  }
  const unchecked = readDenseArray(fields.get('uncheckedKeysByFile'));
  if (unchecked === undefined) {
    return false;
  }
  for (const value of unchecked) {
    const record = readClosedRecord(value, ['filePath', 'keys']);
    if (
      record === undefined ||
      !isClosedString(record.get('filePath')) ||
      readStringArray(record.get('keys')) === undefined
    ) {
      return false;
    }
  }
  return true;
}

function normalizedSlashes(value: string): string {
  return value.replaceAll('\\', '/');
}

export function normalizeTm2ReportSuitePath(
  value: string,
  repositoryRoot: string,
): string | undefined {
  const candidate = normalizedSlashes(value);
  const root = normalizedSlashes(repositoryRoot).replace(/\/+$/u, '');
  let relative: string;
  const candidateHasDrive = /^[A-Za-z]:\//u.test(candidate);
  const rootHasDrive = /^[A-Za-z]:\//u.test(root);
  if (candidateHasDrive || rootHasDrive) {
    const prefix = `${root}/`;
    if (!candidate.toLowerCase().startsWith(prefix.toLowerCase())) {
      return undefined;
    }
    relative = candidate.slice(prefix.length);
  } else if (candidate.startsWith('/')) {
    const prefix = `${root}/`;
    if (!candidate.startsWith(prefix)) {
      return undefined;
    }
    relative = candidate.slice(prefix.length);
  } else {
    relative = candidate;
  }
  if (
    relative === '' ||
    relative.startsWith('/') ||
    relative.endsWith('/') ||
    relative
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    return undefined;
  }
  return relative;
}

function mandatoryIdsIn(value: string): readonly string[] {
  return Object.freeze(
    value.match(/(?<![A-Za-z0-9_-])PG-TM2-[0-9]{3}(?![0-9])/gu) ?? [],
  );
}

function isClosedLocation(value: unknown): boolean {
  const fields = readClosedRecord(value, ['column', 'line']);
  return (
    fields !== undefined &&
    isNonnegativeInteger(fields.get('line')) &&
    isNonnegativeInteger(fields.get('column'))
  );
}

function auditAssertion(
  value: unknown,
  mandatory: boolean,
  seenMandatoryIds: Set<string>,
): boolean {
  const fields = readClosedRecord(
    value,
    ASSERTION_REQUIRED_KEYS,
    ASSERTION_ALLOWED_KEYS,
  );
  if (fields === undefined) {
    return false;
  }
  const title = fields.get('title');
  const fullName = fields.get('fullName');
  const failureMessages = readStringArray(fields.get('failureMessages'));
  const meta = readClosedRecord(fields.get('meta'), []);
  const tags = readStringArray(fields.get('tags'));
  if (
    !isClosedString(title) ||
    !isClosedString(fullName) ||
    fields.get('status') !== 'passed' ||
    readStringArray(fields.get('ancestorTitles')) === undefined ||
    failureMessages?.length !== 0 ||
    meta === undefined ||
    tags === undefined
  ) {
    return false;
  }
  const duration = fields.get('duration');
  if (
    fields.has('duration') &&
    duration !== null &&
    !isFiniteNonnegativeNumber(duration)
  ) {
    return false;
  }
  const location = fields.get('location');
  if (
    fields.has('location') &&
    location !== null &&
    !isClosedLocation(location)
  ) {
    return false;
  }
  if (!mandatory) {
    return true;
  }
  const titleIds = mandatoryIdsIn(title);
  const fullNameIds = mandatoryIdsIn(fullName);
  if (
    titleIds.length !== 1 ||
    fullNameIds.length !== 1 ||
    titleIds[0] !== fullNameIds[0]
  ) {
    return false;
  }
  const id = titleIds[0];
  if (
    id === undefined ||
    !EXPECTED_MANDATORY_ID_SET.has(id) ||
    seenMandatoryIds.has(id)
  ) {
    return false;
  }
  seenMandatoryIds.add(id);
  return true;
}

function auditReportValue(
  value: unknown,
  repositoryRoot: string,
): Tm2MandatoryReportAudit {
  const root = readClosedRecord(value, ROOT_KEYS);
  if (root?.get('success') !== true) {
    return {status: 'invalid'};
  }
  for (const key of [
    'numFailedTests',
    'numFailedTestSuites',
    'numPassedTests',
    'numPassedTestSuites',
    'numPendingTests',
    'numPendingTestSuites',
    'numTodoTests',
    'numTotalTests',
    'numTotalTestSuites',
  ] as const) {
    if (!isNonnegativeInteger(root.get(key))) {
      return {status: 'invalid'};
    }
  }
  if (
    root.get('numFailedTests') !== 0 ||
    root.get('numFailedTestSuites') !== 0 ||
    root.get('numPendingTests') !== 0 ||
    root.get('numPendingTestSuites') !== 0 ||
    root.get('numTodoTests') !== 0 ||
    !isFiniteNonnegativeNumber(root.get('startTime')) ||
    !isClosedSnapshot(root.get('snapshot'))
  ) {
    return {status: 'invalid'};
  }
  const testResults = readDenseArray(root.get('testResults'));
  if (testResults === undefined || testResults.length === 0) {
    return {status: 'invalid'};
  }
  const seenSuites = new Set<string>();
  const seenMandatoryIds = new Set<string>();
  let assertionCount = 0;
  let mandatorySuiteCount = 0;
  for (const value of testResults) {
    const result = readClosedRecord(value, TEST_RESULT_KEYS);
    if (result === undefined) {
      return {status: 'invalid'};
    }
    const name = result.get('name');
    const assertions = readDenseArray(result.get('assertionResults'));
    if (
      !isClosedString(name) ||
      !isClosedString(result.get('message')) ||
      result.get('status') !== 'passed' ||
      !isFiniteNonnegativeNumber(result.get('startTime')) ||
      !isFiniteNonnegativeNumber(result.get('endTime')) ||
      assertions === undefined
    ) {
      return {status: 'invalid'};
    }
    const normalized = normalizeTm2ReportSuitePath(name, repositoryRoot);
    if (
      normalized === undefined ||
      !ALLOWED_SUITE_PATHS.has(normalized) ||
      seenSuites.has(normalized)
    ) {
      return {status: 'invalid'};
    }
    seenSuites.add(normalized);
    const mandatory = normalized === TM2_MANDATORY_SUITE_PATH;
    if (mandatory) {
      mandatorySuiteCount += 1;
    }
    for (const assertion of assertions) {
      assertionCount += 1;
      if (!auditAssertion(assertion, mandatory, seenMandatoryIds)) {
        return {status: 'invalid'};
      }
    }
  }
  const totalTests = root.get('numTotalTests');
  const passedTests = root.get('numPassedTests');
  const totalSuites = root.get('numTotalTestSuites');
  const passedSuites = root.get('numPassedTestSuites');
  if (
    totalTests !== assertionCount ||
    passedTests !== assertionCount ||
    typeof totalSuites !== 'number' ||
    typeof passedSuites !== 'number' ||
    totalSuites <= 0 ||
    passedSuites !== totalSuites ||
    mandatorySuiteCount !== 1 ||
    seenMandatoryIds.size !== EXPECTED_MANDATORY_IDS.length
  ) {
    return {status: 'invalid'};
  }
  for (const id of EXPECTED_MANDATORY_IDS) {
    if (!seenMandatoryIds.has(id)) {
      return {status: 'invalid'};
    }
  }
  return Object.freeze({
    status: 'valid',
    mandatoryCount: seenMandatoryIds.size,
  });
}

export function auditTm2MandatoryReportSource(
  source: string,
  repositoryRoot: string,
): Tm2MandatoryReportAudit {
  if (
    Buffer.byteLength(source, 'utf8') === 0 ||
    Buffer.byteLength(source, 'utf8') > TM2_MANDATORY_REPORT_MAX_BYTES
  ) {
    return {status: 'invalid'};
  }
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    return {status: 'invalid'};
  }
  return auditReportValue(value, repositoryRoot);
}

export async function readAndAuditTm2MandatoryReport(
  path: string,
  repositoryRoot: string,
  io: Tm2MandatoryReportIo = SYSTEM_REPORT_IO,
): Promise<Tm2MandatoryReportAudit> {
  try {
    const metadata = await io.stat(path);
    if (
      !metadata.isFile() ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size <= 0 ||
      metadata.size > TM2_MANDATORY_REPORT_MAX_BYTES
    ) {
      return {status: 'invalid'};
    }
    const bytes = await io.read(path);
    if (
      types.isProxy(bytes) ||
      bytes.byteLength !== metadata.size ||
      bytes.byteLength > TM2_MANDATORY_REPORT_MAX_BYTES
    ) {
      return {status: 'invalid'};
    }
    const source = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    return auditTm2MandatoryReportSource(source, repositoryRoot);
  } catch {
    return {status: 'invalid'};
  }
}

export async function auditTm2MandatoryExecution(
  child: Tm2BoundedChildResult,
  readReport: () => Promise<Tm2MandatoryReportAudit>,
): Promise<Tm2MandatoryExecutionAudit> {
  if (
    child.status !== 'completed' ||
    !child.confirmedClosed ||
    !child.safeToDeleteTaskRoot
  ) {
    return Object.freeze({
      status: 'child_not_completed',
      reportRead: false,
    });
  }
  if (child.exitCode !== 0 || child.signal !== null) {
    return Object.freeze({status: 'child_failed', reportRead: false});
  }
  let report: Tm2MandatoryReportAudit;
  try {
    report = await readReport();
  } catch {
    return Object.freeze({status: 'report_invalid', reportRead: true});
  }
  if (report.status !== 'valid') {
    return Object.freeze({status: 'report_invalid', reportRead: true});
  }
  return Object.freeze({
    status: 'valid',
    mandatoryCount: report.mandatoryCount,
    reportRead: true,
  });
}
