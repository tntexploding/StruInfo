import type {CurrentInformationEntry} from './information_entry_contract.js';
import {
  INFORMATION_ENTRY_GRAPH_DIRECTIONS,
  type InformationEntryAssociationOverrideValue,
  type InformationEntryAssociationRepositorySnapshot,
  type InformationEntryGraphDirection,
  type InformationEntryGraphEdge,
  type InformationEntryGraphOrigin,
  type InformationEntryGraphRelationValue,
  type InformationEntryKnowledgeGraph,
} from './information_entry_association_contract.js';
import {listInformationEntryAssociations} from './information_entry_association.js';

export const INFORMATION_ENTRY_GRAPH_DEFAULT_LABEL = 'similarity';
export const INFORMATION_ENTRY_GRAPH_MAXIMUM_LABEL_CODE_POINTS = 80;
export const INFORMATION_ENTRY_GRAPH_MAXIMUM_NEIGHBORS = 24;

export function prepareInformationEntryGraphRelation(
  labelInput: string,
  direction: InformationEntryGraphDirection,
  origin: InformationEntryGraphOrigin,
): Readonly<InformationEntryGraphRelationValue> | undefined {
  const label = labelInput.trim().normalize('NFC');
  if (
    label.length === 0 ||
    Array.from(label).length >
      INFORMATION_ENTRY_GRAPH_MAXIMUM_LABEL_CODE_POINTS ||
    containsControlCodePoint(label) ||
    !INFORMATION_ENTRY_GRAPH_DIRECTIONS.includes(direction)
  ) {
    return undefined;
  }
  return Object.freeze({origin, label, direction});
}

export function prepareInformationEntryGraphEdit(
  current: Readonly<InformationEntryAssociationOverrideValue> | undefined,
  hasProjection: boolean,
  graph: Readonly<InformationEntryGraphRelationValue>,
): Readonly<InformationEntryAssociationOverrideValue> {
  const currentAction = current?.action;
  const preservesAdjustment =
    currentAction === 'enhance' || currentAction === 'weaken';
  return Object.freeze({
    action: preservesAdjustment
      ? currentAction
      : hasProjection
        ? 'restore'
        : 'enhance',
    manualAdjustment: preservesAdjustment
      ? (current?.manualAdjustment ?? 0)
      : 0,
    isBlocked: false,
    graph,
  });
}

export function prepareInformationEntryGraphVisibility(
  current: Readonly<InformationEntryAssociationOverrideValue> | undefined,
  hasProjection: boolean,
  blocked: boolean,
): Readonly<InformationEntryAssociationOverrideValue> {
  const graph = current?.graph;
  if (blocked) {
    return Object.freeze({
      action: 'block',
      manualAdjustment: 0,
      isBlocked: true,
      ...(graph === undefined ? {} : {graph}),
    });
  }
  return Object.freeze({
    action: hasProjection ? 'restore' : 'enhance',
    manualAdjustment: 0,
    isBlocked: false,
    ...(graph === undefined ? {} : {graph}),
  });
}

export function buildInformationEntryKnowledgeGraph(
  centerEntryId: string,
  entries: readonly Readonly<CurrentInformationEntry>[],
  snapshot: Readonly<InformationEntryAssociationRepositorySnapshot>,
  neighborLimit = 12,
): Readonly<InformationEntryKnowledgeGraph> | undefined {
  if (
    !Number.isSafeInteger(neighborLimit) ||
    neighborLimit < 1 ||
    neighborLimit > INFORMATION_ENTRY_GRAPH_MAXIMUM_NEIGHBORS
  ) {
    throw new Error('Information Entry graph neighbor limit is invalid.');
  }
  const center = entries.find((entry) => entry.entryId === centerEntryId);
  if (center === undefined) return undefined;
  const views = listInformationEntryAssociations(
    centerEntryId,
    entries,
    snapshot,
  ).filter(
    (view) =>
      view.projection !== undefined || view.override?.value.graph !== undefined,
  );
  const visible = views
    .filter((view) => !view.isBlocked)
    .sort(compareGraphViews)
    .slice(0, neighborLimit);
  const hidden = views.filter((view) => view.isBlocked);
  const edges = Object.freeze(visible.map(toGraphEdge));
  const hiddenEdges = Object.freeze(hidden.map(toGraphEdge));
  return Object.freeze({
    center,
    nodes: Object.freeze([
      center,
      ...visible.map((view) => view.relatedEntry),
      ...hidden.map((view) => view.relatedEntry),
    ]),
    edges,
    hiddenEdges,
  });
}

function compareGraphViews(
  left: ReturnType<typeof listInformationEntryAssociations>[number],
  right: ReturnType<typeof listInformationEntryAssociations>[number],
): number {
  const priorityDifference = graphViewPriority(left) - graphViewPriority(right);
  return priorityDifference !== 0
    ? priorityDifference
    : left.effectiveScore !== right.effectiveScore
      ? right.effectiveScore - left.effectiveScore
      : left.relatedEntry.entryId.localeCompare(right.relatedEntry.entryId);
}

function graphViewPriority(
  view: ReturnType<typeof listInformationEntryAssociations>[number],
): number {
  if (view.override?.value.graph?.origin === 'user') return 0;
  if (view.override?.value.graph?.origin === 'association') return 1;
  return 2;
}

function toGraphEdge(
  view: ReturnType<typeof listInformationEntryAssociations>[number],
): Readonly<InformationEntryGraphEdge> {
  const projection = view.projection;
  const override = view.override;
  const graph = override?.value.graph;
  const entryLowId = projection?.entryLowId ?? override?.entryLowId;
  const entryHighId = projection?.entryHighId ?? override?.entryHighId;
  if (entryLowId === undefined || entryHighId === undefined) {
    throw new Error('Information Entry graph endpoints are unavailable.');
  }
  return Object.freeze({
    entryLowId,
    entryHighId,
    label: graph?.label ?? INFORMATION_ENTRY_GRAPH_DEFAULT_LABEL,
    direction: graph?.direction ?? 'symmetric',
    origin:
      graph?.origin === 'user'
        ? 'user_created'
        : graph === undefined
          ? 'automatically_calculated'
          : 'user_edited',
    effectiveScore: view.effectiveScore,
    isBlocked: view.isBlocked,
    overrideRevision: override?.revision ?? 0,
    ...(projection === undefined ? {} : {projection}),
  });
}

function containsControlCodePoint(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}
