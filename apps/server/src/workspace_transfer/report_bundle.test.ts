import {describe, it, expect} from 'vitest';
import {reportStateSchema} from '../application/report_contract.js';
import {
  M1E_PROCESSING_BUNDLE_SCHEMA,
  M1E_PROCESSING_TABLES,
  M1E_PROCESSING_VERSION_THIRTEEN_BUNDLE_CODEC,
  createEmptyM1eProcessingSnapshot,
  normalizeM1eProcessingSnapshot,
} from './m1e_processing_bundle.js';

const W = '10000000-0000-4000-8000-000000000001';
const R = '10000000-0000-4000-8000-000000000002';
const state = reportStateSchema.parse({
  request: {kind: 'daily', date: '2040-01-02', timeZone: 'UTC'},
  actor: {kind: 'owner', id: 'local-owner'},
  title: 'Synthetic report',
  period: {from: '2040-01-02', to: '2040-01-02'},
  sources: [
    {
      handle: 1,
      entryId: R,
      snapshotId: W,
      intakeSnapshotId: W,
      revision: 1,
      title: 'Synthetic source',
      sourceKey: 'Synthetic',
      date: '2040-01-02',
      excerpt: 'Synthetic text',
      keywords: [],
      reason: 'Synthetic admission',
    },
  ],
  totalEligible: 1,
  duplicateCount: 0,
  items: [],
  planned: false,
  status: 'running',
  origin: 'internal_model',
  model: 'synthetic-model',
  calls: 1,
});
function bundle(value: unknown = state) {
  return {
    schemaVersion: M1E_PROCESSING_BUNDLE_SCHEMA,
    tables: M1E_PROCESSING_TABLES.map((t) => ({
      name: t.name,
      rows:
        t.name === 'processing_report'
          ? [
              {
                workspace_id: W,
                report_id: R,
                state_text: JSON.stringify(value),
                current_version: 2,
                created_at: '2040-01-02T00:00:00Z',
                updated_at: '2040-01-02T00:00:00Z',
              },
            ]
          : [],
    })),
  };
}
describe('report bundle compatibility', () => {
  it('round-trips dates, structured points and remaining events while accepting legacy drafts', () => {
    const revised = {
      ...state,
      planned: true,
      status: 'ready',
      otherGroups: [],
      sources: state.sources.map((s) => ({
        ...s,
        receivedDate: '2040-01-02',
        publishedDate: '2039-12-01',
        publicationInferred: true,
      })),
      items: [
        {
          group: {title: 'Synthetic', sources: [1]},
          included: true,
          draft: {
            title: 'Synthetic',
            points: [
              {text: 'Synthetic finding', sources: [1], role: 'finding'},
            ],
          },
        },
      ],
    };
    const result = normalizeM1eProcessingSnapshot(bundle(revised));
    expect(
      JSON.parse(
        String(
          result.tables.find((t) => t.name === 'processing_report')?.rows[0]
            ?.state_text,
        ),
      ),
    ).toEqual(revised);
    expect(() =>
      normalizeM1eProcessingSnapshot(
        bundle({...revised, otherGroups: [{title: 'Repeated', sources: [1]}]}),
      ),
    ).toThrow();
  });
  it('upgrades v13 to an empty report history and round-trips typed drafts and spent call budgets', () => {
    expect(
      M1E_PROCESSING_VERSION_THIRTEEN_BUNDLE_CODEC.decode({
        schemaVersion: 'struinfo.m1e-processing.v13',
        tables: M1E_PROCESSING_TABLES.slice(0, 23).map((t) => ({
          name: t.name,
          rows: [],
        })),
      }),
    ).toEqual(createEmptyM1eProcessingSnapshot());
    const result = normalizeM1eProcessingSnapshot(bundle());
    expect(
      JSON.parse(
        String(
          result.tables.find((t) => t.name === 'processing_report')?.rows[0]
            ?.state_text,
        ),
      ),
    ).toEqual(state);
  });
  it('rejects opaque fields, budget overrun, invalid dates and made-up citation handles on restore', () => {
    expect(() =>
      normalizeM1eProcessingSnapshot(bundle({...state, secret: 'forbidden'})),
    ).toThrow();
    expect(() =>
      normalizeM1eProcessingSnapshot(bundle({...state, calls: 20})),
    ).toThrow();
    expect(() =>
      normalizeM1eProcessingSnapshot(
        bundle({...state, request: {...state.request, date: '2040-02-30'}}),
      ),
    ).toThrow();
    expect(() =>
      normalizeM1eProcessingSnapshot(
        bundle({
          ...state,
          planned: true,
          items: [{group: {title: 'Synthetic', sources: [40]}, included: true}],
        }),
      ),
    ).toThrow();
  });
});
