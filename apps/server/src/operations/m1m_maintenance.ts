import type {
  M1cWorkspaceBackupVerificationSummary,
  M1cWorkspaceTransferSummary,
} from '../workspace_transfer/m1c_workspace_transfer.js';
import type {
  M2P5cOperationalStatusReport,
  M2P5cOperationalStatusThresholds,
} from './m2_p5c_operational_status.js';
export type M1mMaintenanceRequest =
  | Readonly<{
      operation: 'preflight';
    }>
  | Readonly<
      {
        operation: 'operational_status';
      } & M2P5cOperationalStatusThresholds
    >
  | Readonly<{
      operation: 'backup';
    }>
  | Readonly<{
      operation: 'backup_list';
      limit: number;
    }>
  | Readonly<{
      operation: 'backup_verify';
      fileName: string;
    }>
  | Readonly<{
      operation: 'backup_retention_preview';
      keepLatest: number;
    }>
  | Readonly<{
      operation: 'restore';
      fileName: string;
    }>;
export type M1mMaintenanceReport =
  | Readonly<{
      event: 'm1m_preflight_completed';
      outcome: 'ready';
    }>
  | Readonly<M2P5cOperationalStatusReport>
  | Readonly<{
      event: 'm1m_backup_created' | 'm1m_restore_completed';
      outcome: 'succeeded';
      fileName: string;
      byteLength: number;
      sha256?: string;
      blobCount: number;
      tableRowCount: number;
    }>
  | Readonly<{
      event: 'm2_p5b_backup_catalog';
      outcome: 'ready';
      totalCount: number;
      backups: readonly Readonly<{
        fileName: string;
        exportedAt: string;
        byteLength: number;
      }>[];
    }>
  | Readonly<{
      event: 'm2_p5b_backup_verified';
      outcome: 'succeeded';
      fileName: string;
      exportedAt: string;
      byteLength: number;
      sha256: string;
      blobCount: number;
      tableRowCount: number;
      personalDataIncluded: boolean;
    }>
  | Readonly<{
      event: 'm2_p5b_backup_retention_preview';
      outcome: 'ready';
      keepLatest: number;
      totalCount: number;
      retainedCount: number;
      removalCandidateCount: number;
      removalCandidates: readonly string[];
      truncated: boolean;
    }>;
export interface M1mMaintenanceRuntimePort {
  checkReadiness(): Promise<boolean>;
  observeOperationalStatus(
    thresholds: Readonly<M2P5cOperationalStatusThresholds>,
  ): Promise<Readonly<M2P5cOperationalStatusReport>>;
  backup(): Promise<Readonly<M1cWorkspaceTransferSummary>>;
  listBackups(limit: number): Promise<
    Readonly<{
      totalCount: number;
      entries: readonly Readonly<{
        fileName: string;
        exportedAt: string;
        byteLength: number;
      }>[];
    }>
  >;
  verifyBackup(
    fileName: string,
  ): Promise<Readonly<M1cWorkspaceBackupVerificationSummary>>;
  previewBackupRetention(keepLatest: number): Promise<
    Readonly<{
      keepLatest: number;
      totalCount: number;
      retainedCount: number;
      removalCandidateCount: number;
      removalCandidates: readonly string[];
      truncated: boolean;
    }>
  >;
  restore(fileName: string): Promise<Readonly<M1cWorkspaceTransferSummary>>;
  close(): Promise<void>;
}
export type M1mMaintenanceErrorCode =
  'usage_invalid' | 'database_not_ready' | 'operation_failed';
export class M1mMaintenanceError extends Error {
  public readonly code: M1mMaintenanceErrorCode;
  public constructor(code: M1mMaintenanceErrorCode) {
    super('The StruInfo maintenance operation failed.');
    this.name = 'M1mMaintenanceError';
    this.code = code;
  }
}
const BACKUP_FILE_NAME_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,220}\.personal-data\.json$/u;
export function decodeM1mMaintenanceRequest(
  arguments_: readonly string[],
): Readonly<M1mMaintenanceRequest> {
  if (arguments_.length === 1 && arguments_[0] === 'preflight') {
    return Object.freeze({operation: 'preflight'});
  }
  if (arguments_.length === 1 && arguments_[0] === 'backup') {
    return Object.freeze({operation: 'backup'});
  }
  if (arguments_[0] === 'status') {
    const flags = decodeFlags(arguments_.slice(1));
    if (
      flags === undefined ||
      !onlyFlags(flags, [
        'max-backup-age-hours',
        'minimum-free-percent',
        'max-running-age-minutes',
      ])
    ) {
      throw new M1mMaintenanceError('usage_invalid');
    }
    return Object.freeze({
      operation: 'operational_status' as const,
      maxBackupAgeHours: parseBoundedInteger(
        flags.get('max-backup-age-hours') ?? '168',
        1,
        8760,
      ),
      minimumFreePercent: parseBoundedInteger(
        flags.get('minimum-free-percent') ?? '10',
        1,
        99,
      ),
      maxRunningAgeMinutes: parseBoundedInteger(
        flags.get('max-running-age-minutes') ?? '60',
        1,
        10080,
      ),
    });
  }
  if (arguments_[0] === 'backup' && arguments_.length >= 2) {
    const action = arguments_[1];
    const flags = decodeFlags(arguments_.slice(2));
    if (flags === undefined) throw new M1mMaintenanceError('usage_invalid');
    if (action === 'list' && onlyFlags(flags, ['limit'])) {
      return Object.freeze({
        operation: 'backup_list' as const,
        limit: parseBoundedInteger(flags.get('limit') ?? '20', 1, 100),
      });
    }
    if (action === 'verify') {
      const fileName = flags.get('file');
      if (
        flags.size === 1 &&
        fileName !== undefined &&
        BACKUP_FILE_NAME_PATTERN.test(fileName)
      ) {
        return Object.freeze({operation: 'backup_verify' as const, fileName});
      }
    }
    if (action === 'retention-preview') {
      const keepLatest = flags.get('keep-latest');
      if (flags.size === 1 && keepLatest !== undefined) {
        return Object.freeze({
          operation: 'backup_retention_preview' as const,
          keepLatest: parseBoundedInteger(keepLatest, 1, 10000),
        });
      }
    }
    throw new M1mMaintenanceError('usage_invalid');
  }
  if (
    arguments_.length === 3 &&
    arguments_[0] === 'restore' &&
    arguments_[1] === '--file' &&
    BACKUP_FILE_NAME_PATTERN.test(arguments_[2] ?? '')
  ) {
    return Object.freeze({operation: 'restore', fileName: arguments_[2] ?? ''});
  }
  throw new M1mMaintenanceError('usage_invalid');
}
export async function executeM1mMaintenance(
  request: Readonly<M1mMaintenanceRequest>,
  runtime: M1mMaintenanceRuntimePort,
): Promise<Readonly<M1mMaintenanceReport>> {
  const databaseIndependent =
    request.operation === 'operational_status' ||
    request.operation === 'backup_list' ||
    request.operation === 'backup_verify' ||
    request.operation === 'backup_retention_preview';
  if (!databaseIndependent && !(await runtime.checkReadiness())) {
    throw new M1mMaintenanceError('database_not_ready');
  }
  if (request.operation === 'preflight') {
    return Object.freeze({
      event: 'm1m_preflight_completed' as const,
      outcome: 'ready' as const,
    });
  }
  if (request.operation === 'operational_status') {
    try {
      return await runtime.observeOperationalStatus(request);
    } catch {
      throw new M1mMaintenanceError('operation_failed');
    }
  }
  if (
    request.operation === 'backup_list' ||
    request.operation === 'backup_verify' ||
    request.operation === 'backup_retention_preview'
  ) {
    return executeBackupReviewMaintenance(request, runtime);
  }
  let summary: Readonly<M1cWorkspaceTransferSummary>;
  try {
    summary =
      request.operation === 'backup'
        ? await runtime.backup()
        : await runtime.restore(request.fileName);
  } catch {
    throw new M1mMaintenanceError('operation_failed');
  }
  return Object.freeze({
    event:
      request.operation === 'backup'
        ? ('m1m_backup_created' as const)
        : ('m1m_restore_completed' as const),
    outcome: 'succeeded' as const,
    fileName: summary.fileName,
    byteLength: summary.byteLength,
    ...(summary.sha256 === undefined ? {} : {sha256: summary.sha256}),
    blobCount: summary.blobCount,
    tableRowCount: Object.values(summary.tableCounts).reduce(
      (total, count) => total + count,
      0,
    ),
  });
}
async function executeBackupReviewMaintenance(
  request: Extract<
    M1mMaintenanceRequest,
    {
      operation: 'backup_list' | 'backup_verify' | 'backup_retention_preview';
    }
  >,
  runtime: M1mMaintenanceRuntimePort,
): Promise<Readonly<M1mMaintenanceReport>> {
  try {
    if (request.operation === 'backup_list') {
      const catalog = await runtime.listBackups(request.limit);
      return Object.freeze({
        event: 'm2_p5b_backup_catalog' as const,
        outcome: 'ready' as const,
        totalCount: catalog.totalCount,
        backups: Object.freeze(
          catalog.entries.map((entry) => Object.freeze({...entry})),
        ),
      });
    }
    if (request.operation === 'backup_verify') {
      const summary = await runtime.verifyBackup(request.fileName);
      return Object.freeze({
        event: 'm2_p5b_backup_verified' as const,
        outcome: 'succeeded' as const,
        fileName: summary.fileName,
        exportedAt: summary.exportedAt,
        byteLength: summary.byteLength,
        sha256: summary.sha256,
        blobCount: summary.blobCount,
        tableRowCount: Object.values(summary.tableCounts).reduce(
          (total, count) => total + count,
          0,
        ),
        personalDataIncluded: summary.personalDataIncluded,
      });
    }
    const preview = await runtime.previewBackupRetention(request.keepLatest);
    return Object.freeze({
      event: 'm2_p5b_backup_retention_preview' as const,
      outcome: 'ready' as const,
      ...preview,
    });
  } catch {
    throw new M1mMaintenanceError('operation_failed');
  }
}
function decodeFlags(
  values: readonly string[],
): ReadonlyMap<string, string> | undefined {
  if (values.length % 2 !== 0) return undefined;
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (
      flag === undefined ||
      value === undefined ||
      !flag.startsWith('--') ||
      flag.length < 3 ||
      result.has(flag.slice(2))
    ) {
      return undefined;
    }
    result.set(flag.slice(2), value);
  }
  return result;
}
function onlyFlags(
  flags: ReadonlyMap<string, string>,
  allowed: readonly string[],
): boolean {
  return [...flags.keys()].every((key) => allowed.includes(key));
}
function parseBoundedInteger(
  value: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new M1mMaintenanceError('usage_invalid');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new M1mMaintenanceError('usage_invalid');
  }
  return parsed;
}
