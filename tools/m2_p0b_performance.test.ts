import {describe, expect, it} from 'vitest';

import {
  M2_P0B_PERFORMANCE_REPORT_SCHEMA,
  M2_P0B_SMOKE_PERFORMANCE_WORKLOAD,
  runM2P0bPerformanceWorkload,
} from './m2_p0b_performance.js';

describe('M2-P0B synthetic bulk-enrichment performance workload', () => {
  it('measures deterministic tags and incremental associations without owner data', () => {
    const report = runM2P0bPerformanceWorkload(
      M2_P0B_SMOKE_PERFORMANCE_WORKLOAD,
    );

    expect(report.schemaVersion).toBe(M2_P0B_PERFORMANCE_REPORT_SCHEMA);
    expect(report.evidenceScope).toBe('synthetic_core_only');
    expect(report.workload).toMatchObject({
      entryCount: 120,
      snapshotCount: 10,
      taggedEntryCount: 120,
    });
    expect(report.workload.extractedCandidateCount).toBeGreaterThanOrEqual(240);
    expect(report.workload.associationProjectionCount).toBeGreaterThan(0);
    expect(report.workloadSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      report.measurements.deterministicTaggingMilliseconds,
    ).toBeGreaterThanOrEqual(0);
    expect(
      report.measurements.incrementalAssociationMilliseconds,
    ).toBeGreaterThanOrEqual(0);
    expect(report.measurements.throughputEntriesPerSecond).toBeGreaterThan(0);
    expect(report.measurements.projected15000CoreSeconds).toBeGreaterThan(0);
    expect(report.measurements.projected15000CoreHours).toBeGreaterThan(0);
    expect(report.limitation).toContain('not an end-to-end');
    expect(JSON.stringify(report)).not.toMatch(/ruanyf|weekly|C:\\Users/iu);
  });
});
