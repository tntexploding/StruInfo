export interface M2P5cOperationalStatusThresholds {
  readonly maxBackupAgeHours: number;
  readonly minimumFreePercent: number;
  readonly maxRunningAgeMinutes: number;
}

export interface M2P5cDatabaseObservation {
  readonly databaseBytes: string;
  readonly evidenceBlobBytes: string;
  readonly resourceCount: number;
  readonly snapshotCount: number;
  readonly fragmentCount: number;
  readonly currentEntryCount: number;
  readonly associationProjectionCount: number;
  readonly currentSearchProjectionCount: number;
  readonly missingSearchProjectionCount: number;
  readonly processingRunCount: number;
  readonly failedProcessingRunCount: number;
  readonly staleRunningProcessingRunCount: number;
  readonly failedBulkIngestionBatchCount: number;
  readonly pendingProposalCount: number;
  readonly pendingOwnerWorkItemCount: number;
}

export interface M2P5cFilesystemObservation {
  readonly totalBytes: string;
  readonly availableBytes: string;
  readonly availablePercentBasisPoints: number;
}

export interface M2P5cBackupObservation {
  readonly totalCount: number;
  readonly entries: readonly Readonly<{
    fileName: string;
    exportedAt: string;
    byteLength: number;
  }>[];
}

export type M2P5cOperationalAlertCode =
  | 'database_unavailable'
  | 'database_observation_failed'
  | 'data_root_observation_failed'
  | 'data_root_low_space'
  | 'backup_observation_failed'
  | 'backup_missing'
  | 'backup_stale'
  | 'backup_timestamp_in_future'
  | 'processing_failures_present'
  | 'processing_runs_stalled'
  | 'search_index_incomplete';

export interface M2P5cOperationalAlert {
  readonly code: M2P5cOperationalAlertCode;
  readonly severity: 'warning' | 'critical';
}

export interface M2P5cOperationalStatusReport {
  readonly event: 'm2_p5c_operational_status';
  readonly outcome: 'ready' | 'attention';
  readonly observedAt: string;
  readonly thresholds: Readonly<M2P5cOperationalStatusThresholds>;
  readonly database: Readonly<
    | {status: 'ready'; metrics: Readonly<M2P5cDatabaseObservation>}
    | {status: 'unavailable' | 'failed'}
  >;
  readonly dataRoot: Readonly<
    | {status: 'ready'; capacity: Readonly<M2P5cFilesystemObservation>}
    | {status: 'failed'}
  >;
  readonly backups: Readonly<
    | {
        status: 'ready';
        totalCount: number;
        latest?: Readonly<{
          fileName: string;
          exportedAt: string;
          byteLength: number;
          ageHours: number;
        }>;
      }
    | {status: 'failed'}
  >;
  readonly alerts: readonly Readonly<M2P5cOperationalAlert>[];
}

export interface M2P5cOperationalStatusDependencies {
  readonly checkDatabase: () => Promise<boolean>;
  readonly observeDatabase: (
    maxRunningAgeMinutes: number,
  ) => Promise<Readonly<M2P5cDatabaseObservation>>;
  readonly observeFilesystem: () => Promise<
    Readonly<M2P5cFilesystemObservation>
  >;
  readonly listBackups: () => Promise<Readonly<M2P5cBackupObservation>>;
  readonly now?: () => string;
}

/**
 * Produces one bounded, privacy-safe operations snapshot. Observation failures
 * remain visible as stable alert codes instead of hiding the other signals.
 */
export async function observeM2P5cOperationalStatus(
  thresholds: Readonly<M2P5cOperationalStatusThresholds>,
  dependencies: Readonly<M2P5cOperationalStatusDependencies>,
): Promise<Readonly<M2P5cOperationalStatusReport>> {
  validateThresholds(thresholds);
  const observedAt = dependencies.now?.() ?? new Date().toISOString();
  const observedAtMilliseconds = Date.parse(observedAt);
  if (
    !Number.isFinite(observedAtMilliseconds) ||
    new Date(observedAtMilliseconds).toISOString() !== observedAt
  ) {
    throw new Error('The operational observation clock is invalid.');
  }

  const alerts: M2P5cOperationalAlert[] = [];
  let database: M2P5cOperationalStatusReport['database'];
  let databaseReady = false;
  try {
    databaseReady = await dependencies.checkDatabase();
  } catch {
    // A readiness failure is reported below without disclosing its cause.
  }
  if (!databaseReady) {
    database = Object.freeze({status: 'unavailable' as const});
    alerts.push(alert('database_unavailable', 'critical'));
  } else {
    try {
      const metrics = freezeDatabaseObservation(
        await dependencies.observeDatabase(thresholds.maxRunningAgeMinutes),
      );
      database = Object.freeze({status: 'ready' as const, metrics});
      if (
        metrics.failedProcessingRunCount > 0 ||
        metrics.failedBulkIngestionBatchCount > 0
      ) {
        alerts.push(alert('processing_failures_present', 'warning'));
      }
      if (metrics.staleRunningProcessingRunCount > 0) {
        alerts.push(alert('processing_runs_stalled', 'warning'));
      }
      if (metrics.missingSearchProjectionCount > 0) {
        alerts.push(alert('search_index_incomplete', 'warning'));
      }
    } catch {
      database = Object.freeze({status: 'failed' as const});
      alerts.push(alert('database_observation_failed', 'critical'));
    }
  }

  let dataRoot: M2P5cOperationalStatusReport['dataRoot'];
  try {
    const capacity = freezeFilesystemObservation(
      await dependencies.observeFilesystem(),
    );
    dataRoot = Object.freeze({status: 'ready' as const, capacity});
    if (
      capacity.availablePercentBasisPoints <
      thresholds.minimumFreePercent * 100
    ) {
      alerts.push(alert('data_root_low_space', 'critical'));
    }
  } catch {
    dataRoot = Object.freeze({status: 'failed' as const});
    alerts.push(alert('data_root_observation_failed', 'critical'));
  }

  let backups: M2P5cOperationalStatusReport['backups'];
  try {
    const catalog = await dependencies.listBackups();
    validateBackupObservation(catalog);
    const first = catalog.entries[0];
    if (first === undefined) {
      backups = Object.freeze({status: 'ready' as const, totalCount: 0});
      alerts.push(alert('backup_missing', 'warning'));
    } else {
      const exportedAtMilliseconds = Date.parse(first.exportedAt);
      if (
        !Number.isFinite(exportedAtMilliseconds) ||
        new Date(exportedAtMilliseconds).toISOString() !== first.exportedAt
      ) {
        throw new Error('The backup timestamp is invalid.');
      }
      const ageMilliseconds = observedAtMilliseconds - exportedAtMilliseconds;
      const ageHours = roundToHundredths(ageMilliseconds / 3_600_000);
      backups = Object.freeze({
        status: 'ready' as const,
        totalCount: catalog.totalCount,
        latest: Object.freeze({...first, ageHours}),
      });
      if (ageMilliseconds < 0) {
        alerts.push(alert('backup_timestamp_in_future', 'warning'));
      } else if (ageMilliseconds > thresholds.maxBackupAgeHours * 3_600_000) {
        alerts.push(alert('backup_stale', 'warning'));
      }
    }
  } catch {
    backups = Object.freeze({status: 'failed' as const});
    alerts.push(alert('backup_observation_failed', 'critical'));
  }

  return Object.freeze({
    event: 'm2_p5c_operational_status' as const,
    outcome: alerts.length === 0 ? ('ready' as const) : ('attention' as const),
    observedAt,
    thresholds: Object.freeze({...thresholds}),
    database,
    dataRoot,
    backups,
    alerts: Object.freeze(alerts),
  });
}

function validateThresholds(
  thresholds: Readonly<M2P5cOperationalStatusThresholds>,
): void {
  const values = [
    [thresholds.maxBackupAgeHours, 1, 8_760],
    [thresholds.minimumFreePercent, 1, 99],
    [thresholds.maxRunningAgeMinutes, 1, 10_080],
  ] as const;
  if (
    values.some(
      ([value, minimum, maximum]) =>
        !Number.isSafeInteger(value) || value < minimum || value > maximum,
    )
  ) {
    throw new Error('The operational thresholds are invalid.');
  }
}

function freezeDatabaseObservation(
  value: Readonly<M2P5cDatabaseObservation>,
): Readonly<M2P5cDatabaseObservation> {
  if (
    !isDecimalString(value.databaseBytes) ||
    !isDecimalString(value.evidenceBlobBytes) ||
    Object.entries(value).some(
      ([key, item]) =>
        key !== 'databaseBytes' &&
        key !== 'evidenceBlobBytes' &&
        (!Number.isSafeInteger(item) || Number(item) < 0),
    )
  ) {
    throw new Error('The database observation is invalid.');
  }
  return Object.freeze({...value});
}

function freezeFilesystemObservation(
  value: Readonly<M2P5cFilesystemObservation>,
): Readonly<M2P5cFilesystemObservation> {
  if (
    !isDecimalString(value.totalBytes) ||
    !isDecimalString(value.availableBytes) ||
    !Number.isSafeInteger(value.availablePercentBasisPoints) ||
    value.availablePercentBasisPoints < 0 ||
    value.availablePercentBasisPoints > 10_000 ||
    BigInt(value.availableBytes) > BigInt(value.totalBytes)
  ) {
    throw new Error('The filesystem observation is invalid.');
  }
  return Object.freeze({...value});
}

function validateBackupObservation(
  value: Readonly<M2P5cBackupObservation>,
): void {
  if (
    !Number.isSafeInteger(value.totalCount) ||
    value.totalCount < 0 ||
    value.entries.length > value.totalCount ||
    value.entries.length > 1 ||
    value.entries.some(
      (entry) =>
        typeof entry.fileName !== 'string' ||
        entry.fileName.length === 0 ||
        typeof entry.exportedAt !== 'string' ||
        !Number.isSafeInteger(entry.byteLength) ||
        entry.byteLength < 0,
    )
  ) {
    throw new Error('The backup observation is invalid.');
  }
}

function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/u.test(value);
}

function roundToHundredths(value: number): number {
  return Math.round(value * 100) / 100;
}

function alert(
  code: M2P5cOperationalAlertCode,
  severity: M2P5cOperationalAlert['severity'],
): Readonly<M2P5cOperationalAlert> {
  return Object.freeze({code, severity});
}
