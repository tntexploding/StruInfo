import {describe, expect, it, vi} from 'vitest';
import {
  decodeM1mMaintenanceRequest,
  executeM1mMaintenance,
  type M1mMaintenanceRuntimePort,
} from './m1m_maintenance.js';

describe('maintenance boundary', () => {
  it('accepts health, backup and restore commands and rejects retired processing commands', () => {
    expect(decodeM1mMaintenanceRequest(['status']).operation).toBe(
      'operational_status',
    );
    expect(
      decodeM1mMaintenanceRequest([
        'backup',
        'verify',
        '--file',
        'test.personal-data.json',
      ]),
    ).toEqual({
      operation: 'backup_verify',
      fileName: 'test.personal-data.json',
    });
    expect(
      decodeM1mMaintenanceRequest([
        'restore',
        '--file',
        'test.personal-data.json',
      ]).operation,
    ).toBe('restore');
    for (const command of [
      'bulk-ingestion',
      'bulk-ingestion-enrich',
      'entry-automation',
      'type-learning',
    ])
      expect(() => decodeM1mMaintenanceRequest([command])).toThrow();
    expect(() =>
      decodeM1mMaintenanceRequest([
        'restore',
        '--file',
        '../test.personal-data.json',
      ]),
    ).toThrow();
  });
  it('requires a ready database for backup and surfaces failures', async () => {
    const backup = vi.fn(() =>
      Promise.resolve({
        fileName: 'test.personal-data.json',
        byteLength: 10,
        blobCount: 1,
        personalDataIncluded: true,
        tableCounts: {entries: 2},
      }),
    );
    const checkReadiness = vi.fn(() => Promise.resolve(false));
    const runtime = {
      checkReadiness,
      backup,
    } as unknown as M1mMaintenanceRuntimePort;
    await expect(
      executeM1mMaintenance({operation: 'backup'}, runtime),
    ).rejects.toMatchObject({code: 'database_not_ready'});
    expect(backup).not.toHaveBeenCalled();
    checkReadiness.mockResolvedValue(true);
    await expect(
      executeM1mMaintenance({operation: 'backup'}, runtime),
    ).resolves.toMatchObject({event: 'm1m_backup_created', tableRowCount: 2});
    backup.mockRejectedValueOnce(new Error('unavailable'));
    await expect(
      executeM1mMaintenance({operation: 'backup'}, runtime),
    ).rejects.toMatchObject({code: 'operation_failed'});
  });
});
