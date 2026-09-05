import {describe, expect, it, vi} from 'vitest';

import {
  observeM2P5cOperationalStatus,
  type M2P5cDatabaseObservation,
} from './m2_p5c_operational_status.js';

const THRESHOLDS = Object.freeze({
  maxBackupAgeHours: 24,
  minimumFreePercent: 10,
  maxRunningAgeMinutes: 60,
});
const DATABASE: Readonly<M2P5cDatabaseObservation> = Object.freeze({
  databaseBytes: '4096',
  evidenceBlobBytes: '2048',
  resourceCount: 2,
  snapshotCount: 3,
  fragmentCount: 8,
  currentEntryCount: 5,
  associationProjectionCount: 4,
  currentSearchProjectionCount: 5,
  missingSearchProjectionCount: 0,
  processingRunCount: 6,
  failedProcessingRunCount: 0,
  staleRunningProcessingRunCount: 0,
  failedBulkIngestionBatchCount: 0,
  pendingProposalCount: 1,
  pendingOwnerWorkItemCount: 2,
});

describe('M2-P5C operational status', () => {
  it('returns one frozen ready report when every observation is healthy', async () => {
    const report = await observeM2P5cOperationalStatus(THRESHOLDS, {
      checkDatabase: () => Promise.resolve(true),
      observeDatabase: () => Promise.resolve(DATABASE),
      observeFilesystem: () =>
        Promise.resolve({
          totalBytes: '10000',
          availableBytes: '5000',
          availablePercentBasisPoints: 5000,
        }),
      listBackups: () =>
        Promise.resolve({
          totalCount: 3,
          entries: [
            {
              fileName: 'synthetic.personal-data.json',
              exportedAt: '2040-01-02T00:00:00.000Z',
              byteLength: 1024,
            },
          ],
        }),
      now: () => '2040-01-02T12:00:00.000Z',
    });

    expect(report).toMatchObject({
      event: 'm2_p5c_operational_status',
      outcome: 'ready',
      database: {status: 'ready', metrics: DATABASE},
      dataRoot: {status: 'ready'},
      backups: {status: 'ready', totalCount: 3, latest: {ageHours: 12}},
      alerts: [],
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.alerts)).toBe(true);
  });

  it('reports stable attention codes for reachable capacity and task problems', async () => {
    const report = await observeM2P5cOperationalStatus(THRESHOLDS, {
      checkDatabase: () => Promise.resolve(true),
      observeDatabase: () =>
        Promise.resolve({
          ...DATABASE,
          failedProcessingRunCount: 2,
          staleRunningProcessingRunCount: 1,
          failedBulkIngestionBatchCount: 1,
          currentSearchProjectionCount: 4,
          missingSearchProjectionCount: 1,
        }),
      observeFilesystem: () =>
        Promise.resolve({
          totalBytes: '10000',
          availableBytes: '900',
          availablePercentBasisPoints: 900,
        }),
      listBackups: () =>
        Promise.resolve({
          totalCount: 1,
          entries: [
            {
              fileName: 'synthetic.personal-data.json',
              exportedAt: '2039-12-31T00:00:00.000Z',
              byteLength: 1024,
            },
          ],
        }),
      now: () => '2040-01-02T12:00:00.000Z',
    });

    expect(report.outcome).toBe('attention');
    expect(report.alerts.map(({code}) => code)).toEqual([
      'processing_failures_present',
      'processing_runs_stalled',
      'search_index_incomplete',
      'data_root_low_space',
      'backup_stale',
    ]);
    expect(JSON.stringify(report)).not.toContain('private');
  });

  it('keeps independent observations visible when the database is unavailable', async () => {
    const observeDatabase = vi.fn(() => Promise.resolve(DATABASE));
    const report = await observeM2P5cOperationalStatus(THRESHOLDS, {
      checkDatabase: () => Promise.resolve(false),
      observeDatabase,
      observeFilesystem: () =>
        Promise.resolve({
          totalBytes: '10000',
          availableBytes: '5000',
          availablePercentBasisPoints: 5000,
        }),
      listBackups: () => Promise.resolve({totalCount: 0, entries: []}),
      now: () => '2040-01-02T12:00:00.000Z',
    });

    expect(report).toMatchObject({
      outcome: 'attention',
      database: {status: 'unavailable'},
      dataRoot: {status: 'ready'},
      backups: {status: 'ready', totalCount: 0},
    });
    expect(report.alerts.map(({code}) => code)).toEqual([
      'database_unavailable',
      'backup_missing',
    ]);
    expect(observeDatabase).not.toHaveBeenCalled();
  });

  it('fails each malformed or failed observer closed without leaking causes', async () => {
    const report = await observeM2P5cOperationalStatus(THRESHOLDS, {
      checkDatabase: () => Promise.resolve(true),
      observeDatabase: () =>
        Promise.reject(new Error('synthetic database secret')),
      observeFilesystem: () =>
        Promise.reject(new Error('synthetic filesystem path')),
      listBackups: () => Promise.reject(new Error('synthetic backup filename')),
      now: () => '2040-01-02T12:00:00.000Z',
    });

    expect(report.alerts.map(({code}) => code)).toEqual([
      'database_observation_failed',
      'data_root_observation_failed',
      'backup_observation_failed',
    ]);
    expect(JSON.stringify(report)).not.toMatch(
      /secret|filesystem path|filename/u,
    );
  });
});
