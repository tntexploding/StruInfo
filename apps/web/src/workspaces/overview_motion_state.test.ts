import {describe, expect, it} from 'vitest';
import type {AiActivityItem} from './ai_activity_state.js';
import {
  overviewCompletions,
  mergeOverviewCompletions,
  type OverviewObservation,
} from './overview_motion_state.js';

function observation(items: AiActivityItem[] = []): OverviewObservation {
  return {
    items,
    metrics: {
      documents: 5,
      fragments: 50,
      entries: 20,
      annotated: 10,
      tags: 30,
      relations: 4,
      reports: 2,
    },
  };
}
function item(phase: string, completed: string[] = []): AiActivityItem {
  return {
    id: 'synthetic-document',
    kind: '文档整理',
    title: '合成文档',
    detail: '',
    state: 'working',
    phase,
    updatedAt: '2040-01-01T00:00:00Z',
    destination: 'documents',
    stages: ['审核', '结构', '标签', '联系', '入库'].map((label) => ({
      label,
      state: completed.includes(label) ? 'done' : 'pending',
      detail: '',
      completed: completed.includes(label) ? 1 : 0,
      total: 1,
    })),
  };
}

describe('overview completion observations', () => {
  it('combines separately delivered counts and task progress without replaying the count', () => {
    const next = observation();
    next.metrics.entries = 23;
    const pending = [
      {
        source: 'split' as const,
        metrics: [{id: 'entries' as const, before: 20, after: 23}],
      },
    ];
    expect(
      mergeOverviewCompletions(
        pending,
        [{source: 'split', target: 'tags', metrics: []}],
        next.metrics,
      ),
    ).toEqual([
      {
        source: 'split',
        target: 'tags',
        metrics: [{id: 'entries', before: 20, after: 23}],
      },
    ]);
    expect(
      mergeOverviewCompletions(pending, [], observation().metrics)[0]?.metrics,
    ).toEqual([]);
  });
  it('does not replay initial, unchanged or newly discovered historical completions', () => {
    const current = observation([item('tags', ['审核', '结构'])]);
    expect(overviewCompletions(undefined, current)).toEqual([]);
    expect(overviewCompletions(current, current)).toEqual([]);
    expect(overviewCompletions(observation(), current)).toEqual([]);
  });
  it('connects a newly completed stage to the actual next running stage and true statistic', () => {
    const before = observation([item('split', ['审核'])]);
    const after = observation([item('tags', ['审核', '结构'])]);
    after.metrics.entries = 23;
    expect(overviewCompletions(before, after)).toEqual([
      {
        source: 'split',
        target: 'tags',
        metrics: [{id: 'entries', before: 20, after: 23}],
      },
    ]);
  });
  it('accepts relation completion without manufacturing an edge count', () => {
    const before = observation([item('relations', ['审核', '结构', '标签'])]);
    const after = observation([
      item('publish', ['审核', '结构', '标签', '联系']),
    ]);
    expect(overviewCompletions(before, after)).toEqual([
      {source: 'relations', target: 'store', metrics: []},
    ]);
  });
  it('does not treat holds or unchanged failed/price-wait tasks as completed', () => {
    for (const state of ['review', 'failed', 'price', 'settled'] as const) {
      const task = {...item('tags', ['审核', '结构']), state};
      expect(
        overviewCompletions(observation([task]), observation([task])),
      ).toEqual([]);
    }
  });
  it('groups concurrent completions and omits removed, missing or invalid statistics', () => {
    const before = observation([
      item('split', ['审核']),
      {...item('split', ['审核']), id: 'second'},
    ]);
    const after = observation([
      item('tags', ['审核', '结构']),
      {...item('tags', ['审核', '结构']), id: 'second'},
    ]);
    after.metrics.entries = 22;
    after.metrics.tags = undefined;
    after.metrics.documents = 4;
    after.metrics.fragments = NaN;
    expect(overviewCompletions(before, after)).toEqual([
      {
        source: 'split',
        target: 'tags',
        metrics: [{id: 'entries', before: 20, after: 22}],
      },
    ]);
  });
  it('animates only measured relation increases, not newly available counts', () => {
    const before = observation();
    const after = observation();
    after.metrics.relations = 6;
    expect(overviewCompletions(before, after)).toEqual([
      {source: 'relations', metrics: [{id: 'relations', before: 4, after: 6}]},
    ]);
    before.metrics.relations = undefined;
    expect(overviewCompletions(before, after)).toEqual([]);
  });
  it('supports newly received documents and completed reports without model tasks', () => {
    const before = observation();
    const after = observation();
    after.metrics.documents = 7;
    after.metrics.reports = 3;
    expect(overviewCompletions(before, after)).toEqual([
      {source: 'intake', metrics: [{id: 'documents', before: 5, after: 7}]},
      {source: 'report', metrics: [{id: 'reports', before: 2, after: 3}]},
    ]);
  });
});
