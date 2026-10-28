import type {AiActivityItem} from './ai_activity_state.js';
import {itemStage, type FlowStageId} from './overview_flow_state.js';

export const OVERVIEW_MOTION = {
  charge: 800,
  boost: 400,
  gather: 1200,
  flight: 1200,
  arrive: 2400,
  expand: 700,
  finish: 3400,
  count: 750,
  delta: 1000,
  orbit: 8500,
} as const;
export type MetricId =
  | 'documents'
  | 'fragments'
  | 'entries'
  | 'annotated'
  | 'tags'
  | 'relations'
  | 'reports';
export type OverviewMetrics = Record<MetricId, number | undefined>;
export interface OverviewObservation {
  items: readonly AiActivityItem[];
  metrics: OverviewMetrics;
}
export interface OverviewCompletion {
  source: FlowStageId;
  target?: FlowStageId;
  metrics: {id: MetricId; before: number; after: number}[];
}

/** A polling cycle can deliver counts before task state; keep one charging event. */
export function mergeOverviewCompletions(
  pending: readonly OverviewCompletion[],
  incoming: readonly OverviewCompletion[],
  metrics: OverviewMetrics,
): OverviewCompletion[] {
  const result = new Map<FlowStageId, OverviewCompletion>();
  for (const event of [...pending, ...incoming]) {
    const current = result.get(event.source) ?? {
      source: event.source,
      metrics: [],
    };
    if (event.target) current.target = event.target;
    for (const metric of event.metrics) {
      const previous = current.metrics.find((value) => value.id === metric.id);
      if (previous) previous.after = metric.after;
      else current.metrics.push({...metric});
    }
    result.set(event.source, current);
  }
  // A concurrent removal or reset wins over an unfinished visual count.
  for (const event of result.values())
    event.metrics = event.metrics.filter(
      (metric) => metrics[metric.id] === metric.after,
    );
  return [...result.values()];
}
const STAGE_LABELS: Record<string, FlowStageId> = {
  审核: 'intake',
  结构: 'split',
  标签: 'tags',
  联系: 'relations',
  入库: 'store',
};
const METRIC_STAGES: Record<MetricId, FlowStageId> = {
  documents: 'intake',
  fragments: 'intake',
  entries: 'split',
  annotated: 'tags',
  tags: 'tags',
  relations: 'relations',
  reports: 'report',
};

/** Compare observed records, not elapsed time or model call counts. */
export function overviewCompletions(
  previous: OverviewObservation | undefined,
  next: OverviewObservation,
): OverviewCompletion[] {
  if (!previous) return [];
  const events = new Map<FlowStageId, OverviewCompletion>();
  const add = (source: FlowStageId) => {
    let event = events.get(source);
    if (!event) {
      event = {source, metrics: []};
      events.set(source, event);
    }
    return event;
  };
  const oldItems = new Map(previous.items.map((item) => [item.id, item]));
  for (const item of next.items) {
    const old = oldItems.get(item.id);
    // A newly visible historical task does not represent a new completion.
    if (!old || ['review', 'settled'].includes(item.state)) continue;
    for (const stage of item.stages ?? []) {
      const source = STAGE_LABELS[stage.label];
      if (
        !source ||
        stage.state !== 'done' ||
        old.stages?.find((s) => s.label === stage.label)?.state === 'done'
      )
        continue;
      const event = add(source);
      const target = itemStage(item);
      if (item.state === 'working' && target !== source) event.target = target;
    }
    if (
      item.destination === 'reports' &&
      item.state === 'done' &&
      old.state !== 'done'
    )
      add('report');
  }
  for (const id of Object.keys(METRIC_STAGES) as MetricId[]) {
    const before = previous.metrics[id],
      after = next.metrics[id];
    if (
      before === undefined ||
      after === undefined ||
      !Number.isFinite(before) ||
      !Number.isFinite(after) ||
      after <= before
    )
      continue;
    add(METRIC_STAGES[id]).metrics.push({id, before, after});
  }
  return [...events.values()];
}
