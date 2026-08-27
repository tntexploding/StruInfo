import {describe, expect, it, vi} from 'vitest';

import {
  decodeM1mMaintenanceRequest,
  executeM1mMaintenance,
  M1mMaintenanceError,
  type M1mMaintenanceRuntimePort,
} from './m1m_maintenance.js';

const SUMMARY = Object.freeze({
  fileName:
    '11111111-1111-4111-8111-111111111111-20400102030405000-11111111-1111-4111-8111-111111111111.personal-data.json',
  byteLength: 1234,
  sha256: 'a'.repeat(64),
  blobCount: 2,
  personalDataIncluded: true,
  tableCounts: Object.freeze({first: 3, second: 4}),
});

describe('M1M maintenance command', () => {
  it('decodes only preflight, backup and safe explicit restore requests', () => {
    expect(decodeM1mMaintenanceRequest(['preflight'])).toEqual({
      operation: 'preflight',
    });
    expect(decodeM1mMaintenanceRequest(['backup'])).toEqual({
      operation: 'backup',
    });
    expect(
      decodeM1mMaintenanceRequest(['restore', '--file', SUMMARY.fileName]),
    ).toEqual({operation: 'restore', fileName: SUMMARY.fileName});
    for (const candidate of [
      [],
      ['restore'],
      ['restore', '--file', '../outside.personal-data.json'],
      ['backup', '--force'],
    ]) {
      expect(() => decodeM1mMaintenanceRequest(candidate)).toThrow(
        expect.objectContaining({code: 'usage_invalid'}),
      );
    }
  });

  it('preflights the database before reporting readiness', async () => {
    const runtime = createRuntime();
    await expect(
      executeM1mMaintenance({operation: 'preflight'}, runtime),
    ).resolves.toEqual({
      event: 'm1m_preflight_completed',
      outcome: 'ready',
    });
    expect(runtime.checkReadiness.mock.calls).toHaveLength(1);
    expect(runtime.backup.mock.calls).toHaveLength(0);
  });

  it('creates a complete backup summary and restores only the named package', async () => {
    const runtime = createRuntime();
    await expect(
      executeM1mMaintenance({operation: 'backup'}, runtime),
    ).resolves.toEqual({
      event: 'm1m_backup_created',
      outcome: 'succeeded',
      fileName: SUMMARY.fileName,
      byteLength: 1234,
      sha256: 'a'.repeat(64),
      blobCount: 2,
      tableRowCount: 7,
    });
    await expect(
      executeM1mMaintenance(
        {operation: 'restore', fileName: SUMMARY.fileName},
        runtime,
      ),
    ).resolves.toMatchObject({
      event: 'm1m_restore_completed',
      outcome: 'succeeded',
      fileName: SUMMARY.fileName,
    });
    expect(runtime.restore.mock.calls).toEqual([[SUMMARY.fileName]]);
  });

  it('fails closed when readiness or a transfer operation fails', async () => {
    const unavailable = createRuntime({ready: false});
    await expect(
      executeM1mMaintenance({operation: 'backup'}, unavailable),
    ).rejects.toEqual(new M1mMaintenanceError('database_not_ready'));
    expect(unavailable.backup.mock.calls).toHaveLength(0);

    const failed = createRuntime({backupFailure: true});
    await expect(
      executeM1mMaintenance({operation: 'backup'}, failed),
    ).rejects.toEqual(new M1mMaintenanceError('operation_failed'));
  });
});

function createRuntime(
  options: {
    readonly ready?: boolean;
    readonly backupFailure?: boolean;
  } = {},
): M1mMaintenanceRuntimePort & {
  checkReadiness: ReturnType<typeof vi.fn>;
  backup: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
} {
  const checkReadiness = vi.fn(() => Promise.resolve(options.ready ?? true));
  const backup = vi.fn(() =>
    options.backupFailure
      ? Promise.reject(new Error('synthetic private failure'))
      : Promise.resolve(SUMMARY),
  );
  const restore = vi.fn(() => Promise.resolve(SUMMARY));
  return {
    checkReadiness,
    backup,
    restore,
    close: () => Promise.resolve(),
  };
}
