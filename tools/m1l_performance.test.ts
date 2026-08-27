import {describe, expect, it} from 'vitest';

import {
  M1L_PERFORMANCE_REPORT_SCHEMA,
  M1L_SMOKE_PERFORMANCE_WORKLOAD,
  runM1lPerformanceWorkload,
} from './m1l_performance.js';

describe('M1L synthetic performance workload', () => {
  it('runs every frozen operation with a data-free smoke workload', async () => {
    const report = await runM1lPerformanceWorkload(
      M1L_SMOKE_PERFORMANCE_WORKLOAD,
    );

    expect(report.schemaVersion).toBe(M1L_PERFORMANCE_REPORT_SCHEMA);
    expect(report.workload).toMatchObject({
      markdownSections: M1L_SMOKE_PERFORMANCE_WORKLOAD.markdownSections,
      entryCount: M1L_SMOKE_PERFORMANCE_WORKLOAD.entryCount,
      embeddingDimensions: M1L_SMOKE_PERFORMANCE_WORKLOAD.embeddingDimensions,
      connectorDocuments: M1L_SMOKE_PERFORMANCE_WORKLOAD.connectorDocuments,
    });
    expect(report.workloadSha256).toMatch(/^[0-9a-f]{64}$/u);

    const operations = report.measurements.map(
      (measurement) => measurement.operation,
    );
    expect(operations).toEqual([
      'import.markdown.parse_and_materialize',
      'split.section.materialization',
      'search_index.local_projection',
      'association.projection_rebuild',
      'query.lexical_substring',
      'query.semantic_cosine',
      'query.hybrid',
      'query.association_two_hop',
      'knowledge_graph.bounded_neighborhood',
      'subscription.connector_batch_validation',
    ]);
    expect(new Set(operations).size).toBe(operations.length);
    for (const measurement of report.measurements) {
      expect(measurement.iterations).toBe(1);
      expect(measurement.minimumMilliseconds).toBeGreaterThanOrEqual(0);
      expect(measurement.medianMilliseconds).toBeGreaterThanOrEqual(0);
      expect(measurement.p95Milliseconds).toBeGreaterThanOrEqual(0);
      expect(measurement.maximumMilliseconds).toBeGreaterThanOrEqual(0);
      expect(measurement.totalMilliseconds).toBeGreaterThanOrEqual(0);
    }

    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/ruanyf|weekly|C:\\Users/iu);
  });
});
