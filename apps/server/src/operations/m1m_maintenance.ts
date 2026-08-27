import type {M1cWorkspaceTransferSummary} from '../workspace_transfer/m1c_workspace_transfer.js';

export type M1mMaintenanceRequest =
  | Readonly<{operation: 'preflight'}>
  | Readonly<{operation: 'backup'}>
  | Readonly<{operation: 'restore'; fileName: string}>;

export type M1mMaintenanceReport =
  | Readonly<{
      event: 'm1m_preflight_completed';
      outcome: 'ready';
    }>
  | Readonly<{
      event: 'm1m_backup_created' | 'm1m_restore_completed';
      outcome: 'succeeded';
      fileName: string;
      byteLength: number;
      sha256?: string;
      blobCount: number;
      tableRowCount: number;
    }>;

export interface M1mMaintenanceRuntimePort {
  checkReadiness(): Promise<boolean>;
  backup(): Promise<Readonly<M1cWorkspaceTransferSummary>>;
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
  if (!(await runtime.checkReadiness())) {
    throw new M1mMaintenanceError('database_not_ready');
  }
  if (request.operation === 'preflight') {
    return Object.freeze({
      event: 'm1m_preflight_completed' as const,
      outcome: 'ready' as const,
    });
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
