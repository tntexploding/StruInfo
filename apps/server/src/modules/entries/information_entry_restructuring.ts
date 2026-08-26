import {createHash} from 'node:crypto';

import {
  type CurrentInformationEntry,
  type EntryContentKeyword,
  type InformationEntryMaterializeRow,
  type InformationEntryRevisionValue,
  type ManualEntryFragmentGroupInput,
} from './information_entry_contract.js';
import {
  type CurrentInformationEntryAssociationOverride,
  type InformationEntryAssociationOverrideValue,
} from './information_entry_association_contract.js';
import {deriveInformationEntryAssociationOverrideRevisionId} from './information_entry_association_identity.js';
import {
  MANUAL_ENTRY_RESTRUCTURE_RULE_VERSION,
  type MaterializedEvidenceSnapshot,
  prepareManualSplitInformationEntries,
} from './information_entry.js';
import {
  deriveInformationEntryId,
  deriveInformationEntryRevisionId,
} from './information_entry_identity.js';

export interface InformationEntryStructureExpectedEntry {
  readonly entryId: string;
  readonly revision: number;
  readonly revisionId: string;
}

export interface InformationEntryStructureExpectedOverride {
  readonly entryLowId: string;
  readonly entryHighId: string;
  readonly revision: number;
  readonly revisionId: string;
}

export interface InformationEntryRestructureSuccessor {
  readonly operation: 'insert' | 'revise' | 'unchanged';
  readonly row: Readonly<InformationEntryMaterializeRow>;
  readonly expectedRevision?: number;
  readonly predecessorEntryIds: readonly string[];
  readonly annotationStatus: 'preserved' | 'combined' | 'requires_review';
}

export interface InformationEntryRestructureLineage {
  readonly successorEntryId: string;
  readonly predecessorEntryId: string;
  readonly kind: 'split_from' | 'merged_from' | 'boundary_from';
}

export interface InformationEntryRestructureOverrideTransfer {
  readonly sourceEntryLowId: string;
  readonly sourceEntryHighId: string;
  readonly destinationEntryLowId: string;
  readonly destinationEntryHighId: string;
  readonly revisionId: string;
  readonly value: Readonly<InformationEntryAssociationOverrideValue>;
}

export interface InformationEntryRestructurePreparation {
  readonly snapshotId: string;
  readonly expectedStructureSha256: string;
  readonly planSha256: string;
  readonly expectedEntries: readonly Readonly<InformationEntryStructureExpectedEntry>[];
  readonly expectedOverrides: readonly Readonly<InformationEntryStructureExpectedOverride>[];
  readonly currentGroups: readonly Readonly<ManualEntryFragmentGroupInput>[];
  readonly successors: readonly Readonly<InformationEntryRestructureSuccessor>[];
  readonly retiredEntryIds: readonly string[];
  readonly lineage: readonly Readonly<InformationEntryRestructureLineage>[];
  readonly overrideTransfers: readonly Readonly<InformationEntryRestructureOverrideTransfer>[];
  readonly transferredRelationshipCount: number;
  readonly collapsedRelationshipCount: number;
  readonly conflictingRelationshipCount: number;
  readonly annotationReviewCount: number;
  readonly hasChanges: boolean;
  readonly resultingEntries: readonly Readonly<CurrentInformationEntry>[];
}

export function deriveInformationEntryRestructureGroups(
  snapshot: Readonly<MaterializedEvidenceSnapshot>,
  currentEntriesInput: readonly Readonly<CurrentInformationEntry>[],
): readonly Readonly<ManualEntryFragmentGroupInput>[] | undefined {
  const structure = snapshot.structures[0];
  if (structure === undefined) return undefined;
  const fragmentLengths = new Map(
    structure.fragments.map((fragment) => [
      fragment.fragmentId,
      Array.from(fragment.selectedText).length,
    ]),
  );
  const currentEntries = [...currentEntriesInput]
    .filter((entry) => entry.snapshotId === snapshot.snapshotId)
    .sort(compareEntries);
  if (currentEntries.length === 0) return undefined;
  const groups: ManualEntryFragmentGroupInput[] = [];
  for (const entry of currentEntries) {
    const fragments = entry.value.fragmentIds.map((fragmentId, index) => {
      const length = fragmentLengths.get(fragmentId);
      if (length === undefined) return undefined;
      const range = entry.value.fragmentRanges?.[index];
      return Object.freeze({
        fragmentId,
        startCodePoint: range?.startCodePoint ?? 0,
        endCodePoint: range?.endCodePoint ?? length,
      });
    });
    if (fragments.some((fragment) => fragment === undefined)) return undefined;
    groups.push(
      Object.freeze({
        titlePath: entry.value.titlePath,
        fragments: Object.freeze(
          fragments as readonly Readonly<{
            fragmentId: string;
            startCodePoint: number;
            endCodePoint: number;
          }>[],
        ),
      }),
    );
  }
  return Object.freeze(groups);
}

export function prepareInformationEntryRestructure(
  snapshot: Readonly<MaterializedEvidenceSnapshot>,
  currentEntriesInput: readonly Readonly<CurrentInformationEntry>[],
  groups: readonly Readonly<ManualEntryFragmentGroupInput>[],
  overrides: readonly Readonly<CurrentInformationEntryAssociationOverride>[],
): Readonly<InformationEntryRestructurePreparation> | undefined {
  const currentEntries = [...currentEntriesInput]
    .filter((entry) => entry.snapshotId === snapshot.snapshotId)
    .sort(compareEntries);
  if (currentEntries.length === 0) return undefined;
  const referenceEntry = currentEntries[0];
  if (referenceEntry === undefined) return undefined;
  if (
    currentEntries.some(
      (entry) =>
        entry.workspaceId !== snapshot.workspaceId ||
        entry.resourceId !== snapshot.resourceId ||
        entry.value.isPrivate !== (snapshot.isPrivate === true),
    )
  ) {
    return undefined;
  }
  const materialized = prepareManualSplitInformationEntries(snapshot, groups);
  if (materialized === undefined || materialized.length === 0) return undefined;

  const structure = snapshot.structures[0];
  if (structure === undefined) return undefined;
  const fragmentLengths = new Map(
    structure.fragments.map((fragment) => [
      fragment.fragmentId,
      Array.from(fragment.selectedText).length,
    ]),
  );
  const expectedEntries = Object.freeze(
    currentEntries.map((entry) =>
      Object.freeze({
        entryId: entry.entryId,
        revision: entry.revision,
        revisionId: entry.revisionId,
      }),
    ),
  );
  const expectedStructureSha256 = digest(expectedEntries);
  const planSeed = digest({
    expectedStructureSha256,
    groups: groups.map((group) => ({
      titlePath: group.titlePath.normalize('NFC').trim(),
      fragments: group.fragments,
    })),
  });
  const oldSegments = new Map(
    currentEntries.map((entry) => [
      entry.entryId,
      normalizedSegments(entry.value, fragmentLengths),
    ]),
  );
  if ([...oldSegments.values()].some((segments) => segments === undefined)) {
    return undefined;
  }

  const successors: InformationEntryRestructureSuccessor[] = [];
  for (const [index, prepared] of materialized.entries()) {
    const segments = normalizedSegments(prepared.value, fragmentLengths);
    if (segments === undefined) return undefined;
    const exact = currentEntries.find((entry) =>
      sameSegments(oldSegments.get(entry.entryId), segments),
    );
    const predecessors = currentEntries.filter((entry) =>
      hasSegmentOverlap(oldSegments.get(entry.entryId), segments),
    );
    if (predecessors.length === 0) return undefined;
    const entryId =
      exact?.entryId ??
      deriveInformationEntryId(
        snapshot.snapshotId,
        structure.structureId,
        `manual-restructure-v1:${planSeed}:${index.toString()}`,
      );
    const annotations = inheritAnnotations(predecessors);
    if (annotations === undefined) return undefined;
    const preservesExistingStructure =
      exact?.value.documentOrder === prepared.value.documentOrder &&
      exact.value.titlePath === prepared.value.titlePath &&
      exact.value.bodySha256 === prepared.value.bodySha256;
    const preparedValue =
      preservesExistingStructure && exact.value.fragmentRanges === undefined
        ? withoutFragmentRanges(prepared.value)
        : prepared.value;
    const value = Object.freeze({
      ...preparedValue,
      splitRuleVersion: preservesExistingStructure
        ? exact.value.splitRuleVersion
        : MANUAL_ENTRY_RESTRUCTURE_RULE_VERSION,
      ...annotations.value,
    });
    const operation =
      exact === undefined
        ? 'insert'
        : sameValue(exact.value, value)
          ? 'unchanged'
          : 'revise';
    const revision =
      exact === undefined
        ? 1
        : exact.revision + (operation === 'revise' ? 1 : 0);
    const row = Object.freeze({
      ...prepared,
      entryId,
      revisionId:
        exact !== undefined && operation === 'unchanged'
          ? exact.revisionId
          : deriveInformationEntryRevisionId(entryId, revision),
      value,
    });
    successors.push(
      Object.freeze({
        operation,
        row,
        ...(exact === undefined ? {} : {expectedRevision: exact.revision}),
        predecessorEntryIds: Object.freeze(
          predecessors.map((entry) => entry.entryId),
        ),
        annotationStatus: annotations.status,
      }),
    );
  }

  const successorByPredecessor = new Map<string, string>();
  for (const predecessor of currentEntries) {
    const segments = oldSegments.get(predecessor.entryId);
    const matches = successors
      .map((successor) => ({
        successor,
        overlap: segmentOverlap(
          segments,
          normalizedSegments(successor.row.value, fragmentLengths),
        ),
      }))
      .filter((candidate) => candidate.overlap > 0)
      .sort(
        (left, right) =>
          right.overlap - left.overlap ||
          left.successor.row.value.documentOrder -
            right.successor.row.value.documentOrder ||
          left.successor.row.entryId.localeCompare(right.successor.row.entryId),
      );
    const primary = matches[0]?.successor.row.entryId;
    if (primary === undefined) return undefined;
    successorByPredecessor.set(predecessor.entryId, primary);
  }

  const currentIds = new Set(currentEntries.map((entry) => entry.entryId));
  const expectedOverrides = Object.freeze(
    overrides
      .filter(
        (override) =>
          currentIds.has(override.entryLowId) ||
          currentIds.has(override.entryHighId),
      )
      .map((override) =>
        Object.freeze({
          entryLowId: override.entryLowId,
          entryHighId: override.entryHighId,
          revision: override.revision,
          revisionId: override.revisionId,
        }),
      )
      .sort(compareExpectedOverrides),
  );
  const destinationValues = new Map(
    overrides.map((override) => [
      `${override.entryLowId}:${override.entryHighId}`,
      JSON.stringify(override.value),
    ]),
  );
  const overrideTransfers: InformationEntryRestructureOverrideTransfer[] = [];
  let collapsedRelationshipCount = 0;
  let conflictingRelationshipCount = 0;
  for (const override of overrides) {
    if (
      !currentIds.has(override.entryLowId) &&
      !currentIds.has(override.entryHighId)
    ) {
      continue;
    }
    const mappedLeft =
      successorByPredecessor.get(override.entryLowId) ?? override.entryLowId;
    const mappedRight =
      successorByPredecessor.get(override.entryHighId) ?? override.entryHighId;
    if (mappedLeft === mappedRight) {
      collapsedRelationshipCount += 1;
      continue;
    }
    const [destinationEntryLowId, destinationEntryHighId] =
      mappedLeft < mappedRight
        ? [mappedLeft, mappedRight]
        : [mappedRight, mappedLeft];
    if (
      destinationEntryLowId === override.entryLowId &&
      destinationEntryHighId === override.entryHighId
    ) {
      continue;
    }
    const key = `${destinationEntryLowId}:${destinationEntryHighId}`;
    const transferredValue = transferOverrideValue(
      override.value,
      mappedLeft <= mappedRight,
    );
    const serialized = JSON.stringify(transferredValue);
    const prior = destinationValues.get(key);
    if (prior !== undefined && prior !== serialized) {
      conflictingRelationshipCount += 1;
      continue;
    }
    if (prior === serialized) continue;
    destinationValues.set(key, serialized);
    overrideTransfers.push(
      Object.freeze({
        sourceEntryLowId: override.entryLowId,
        sourceEntryHighId: override.entryHighId,
        destinationEntryLowId,
        destinationEntryHighId,
        revisionId: deriveInformationEntryAssociationOverrideRevisionId(
          destinationEntryLowId,
          destinationEntryHighId,
          1,
        ),
        value: transferredValue,
      }),
    );
  }

  const successorCountByPredecessor = new Map<string, number>();
  for (const successor of successors) {
    for (const predecessorEntryId of successor.predecessorEntryIds) {
      successorCountByPredecessor.set(
        predecessorEntryId,
        (successorCountByPredecessor.get(predecessorEntryId) ?? 0) + 1,
      );
    }
  }
  const lineage = successors.flatMap((successor) =>
    successor.predecessorEntryIds
      .filter(
        (predecessorEntryId) => predecessorEntryId !== successor.row.entryId,
      )
      .map((predecessorEntryId) =>
        Object.freeze({
          successorEntryId: successor.row.entryId,
          predecessorEntryId,
          kind:
            successor.predecessorEntryIds.length > 1
              ? ('merged_from' as const)
              : (successorCountByPredecessor.get(predecessorEntryId) ?? 0) > 1
                ? ('split_from' as const)
                : ('boundary_from' as const),
        }),
      ),
  );
  const successorIds = new Set(
    successors.map((successor) => successor.row.entryId),
  );
  const retiredEntryIds = Object.freeze(
    currentEntries
      .map((entry) => entry.entryId)
      .filter((entryId) => !successorIds.has(entryId)),
  );
  const currentById = new Map(
    currentEntries.map((entry) => [entry.entryId, entry]),
  );
  const resultingEntries = Object.freeze(
    successors.map((successor) => {
      const previous = currentById.get(successor.row.entryId);
      const revision =
        previous === undefined
          ? 1
          : previous.revision + (successor.operation === 'revise' ? 1 : 0);
      return Object.freeze({
        workspaceId: snapshot.workspaceId,
        entryId: successor.row.entryId,
        resourceId: snapshot.resourceId,
        snapshotId: snapshot.snapshotId,
        revision,
        revisionId: successor.row.revisionId,
        sourceKey: previous?.sourceKey ?? referenceEntry.sourceKey,
        ...(previous?.canonicalUri === undefined
          ? referenceEntry.canonicalUri === undefined
            ? {}
            : {canonicalUri: referenceEntry.canonicalUri}
          : {canonicalUri: previous.canonicalUri}),
        capturedAt: previous?.capturedAt ?? referenceEntry.capturedAt,
        ...(previous?.publishedAt === undefined
          ? referenceEntry.publishedAt === undefined
            ? {}
            : {publishedAt: referenceEntry.publishedAt}
          : {publishedAt: previous.publishedAt}),
        value: successor.row.value,
      });
    }),
  );
  const currentGroups = deriveInformationEntryRestructureGroups(
    snapshot,
    currentEntries,
  );
  if (currentGroups === undefined) return undefined;
  const annotationReviewCount = successors.filter(
    (successor) => successor.annotationStatus === 'requires_review',
  ).length;
  const hasChanges =
    retiredEntryIds.length > 0 ||
    successors.some((successor) => successor.operation !== 'unchanged');
  const planSha256 = digest({
    expectedStructureSha256,
    successors: successors.map((successor) => ({
      operation: successor.operation,
      entryId: successor.row.entryId,
      revisionId: successor.row.revisionId,
      value: successor.row.value,
      predecessorEntryIds: successor.predecessorEntryIds,
    })),
    retiredEntryIds,
    lineage,
    overrideTransfers,
    collapsedRelationshipCount,
    conflictingRelationshipCount,
  });
  return Object.freeze({
    snapshotId: snapshot.snapshotId,
    expectedStructureSha256,
    planSha256,
    expectedEntries,
    expectedOverrides,
    currentGroups,
    successors: Object.freeze(successors),
    retiredEntryIds,
    lineage: Object.freeze(lineage),
    overrideTransfers: Object.freeze(overrideTransfers),
    transferredRelationshipCount: overrideTransfers.length,
    collapsedRelationshipCount,
    conflictingRelationshipCount,
    annotationReviewCount,
    hasChanges,
    resultingEntries,
  });
}

type Segment = Readonly<{
  fragmentId: string;
  startCodePoint: number;
  endCodePoint: number;
}>;

function normalizedSegments(
  value: Readonly<InformationEntryRevisionValue>,
  fragmentLengths: ReadonlyMap<string, number>,
): readonly Segment[] | undefined {
  if (
    value.fragmentRanges !== undefined &&
    value.fragmentRanges.length !== value.fragmentIds.length
  ) {
    return undefined;
  }
  const result: Segment[] = [];
  for (const [index, fragmentId] of value.fragmentIds.entries()) {
    const length = fragmentLengths.get(fragmentId);
    if (length === undefined) return undefined;
    const range = value.fragmentRanges?.[index];
    const segment = Object.freeze({
      fragmentId,
      startCodePoint: range?.startCodePoint ?? 0,
      endCodePoint: range?.endCodePoint ?? length,
    });
    const previous = result.at(-1);
    if (
      previous?.fragmentId === segment.fragmentId &&
      previous.endCodePoint === segment.startCodePoint
    ) {
      result[result.length - 1] = Object.freeze({
        ...previous,
        endCodePoint: segment.endCodePoint,
      });
    } else {
      result.push(segment);
    }
  }
  return Object.freeze(result);
}

function sameSegments(
  left: readonly Segment[] | undefined,
  right: readonly Segment[] | undefined,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    JSON.stringify(left) === JSON.stringify(right)
  );
}

function hasSegmentOverlap(
  left: readonly Segment[] | undefined,
  right: readonly Segment[] | undefined,
): boolean {
  return segmentOverlap(left, right) > 0;
}

function segmentOverlap(
  left: readonly Segment[] | undefined,
  right: readonly Segment[] | undefined,
): number {
  if (left === undefined || right === undefined) return 0;
  let result = 0;
  for (const first of left) {
    for (const second of right) {
      if (first.fragmentId !== second.fragmentId) continue;
      result += Math.max(
        0,
        Math.min(first.endCodePoint, second.endCodePoint) -
          Math.max(first.startCodePoint, second.startCodePoint),
      );
    }
  }
  return result;
}

function inheritAnnotations(
  predecessors: readonly Readonly<CurrentInformationEntry>[],
):
  | Readonly<{
      status: 'preserved' | 'combined' | 'requires_review';
      value: Pick<
        InformationEntryRevisionValue,
        | 'contentKeywords'
        | 'domains'
        | 'typeKeyword'
        | 'typeCustomName'
        | 'usefulnessScore'
        | 'interestScore'
      >;
    }>
  | undefined {
  const contentKeywords = uniqueContentKeywords(predecessors);
  const first = predecessors.at(0)?.value;
  if (first === undefined) return undefined;
  const sameType = predecessors.every(
    (entry) =>
      entry.value.typeKeyword === first.typeKeyword &&
      entry.value.typeCustomName === first.typeCustomName,
  );
  const sameDomains = predecessors.every(
    (entry) =>
      JSON.stringify(entry.value.domains) === JSON.stringify(first.domains),
  );
  const sameUsefulness = predecessors.every(
    (entry) => entry.value.usefulnessScore === first.usefulnessScore,
  );
  const sameInterest = predecessors.every(
    (entry) => entry.value.interestScore === first.interestScore,
  );
  const requiresReview =
    !sameType ||
    !sameDomains ||
    !sameUsefulness ||
    !sameInterest ||
    contentKeywords.length > 32;
  return Object.freeze({
    status:
      predecessors.length === 1
        ? 'preserved'
        : requiresReview
          ? 'requires_review'
          : 'combined',
    value: Object.freeze({
      contentKeywords: Object.freeze(contentKeywords.slice(0, 32)),
      domains: sameDomains ? first.domains : Object.freeze([]),
      ...(sameType && first.typeKeyword !== undefined
        ? {typeKeyword: first.typeKeyword}
        : {}),
      ...(sameType && first.typeCustomName !== undefined
        ? {typeCustomName: first.typeCustomName}
        : {}),
      ...(sameUsefulness && first.usefulnessScore !== undefined
        ? {usefulnessScore: first.usefulnessScore}
        : {}),
      ...(sameInterest && first.interestScore !== undefined
        ? {interestScore: first.interestScore}
        : {}),
    }),
  });
}

function uniqueContentKeywords(
  predecessors: readonly Readonly<CurrentInformationEntry>[],
): readonly Readonly<EntryContentKeyword>[] {
  const values = new Map<string, Readonly<EntryContentKeyword>>();
  for (const predecessor of predecessors) {
    for (const keyword of predecessor.value.contentKeywords) {
      const current = values.get(keyword.normalizedValue);
      if (
        current === undefined ||
        originPriority(keyword.origin) < originPriority(current.origin)
      ) {
        values.set(keyword.normalizedValue, keyword);
      }
    }
  }
  return Object.freeze([...values.values()]);
}

function originPriority(origin: EntryContentKeyword['origin']): number {
  return origin === 'manual' ? 0 : origin === 'ai' ? 1 : 2;
}

function withoutFragmentRanges(
  value: Readonly<InformationEntryRevisionValue>,
): Readonly<InformationEntryRevisionValue> {
  const remaining = {...value};
  Reflect.deleteProperty(remaining, 'fragmentRanges');
  return Object.freeze(remaining);
}

function transferOverrideValue(
  value: Readonly<InformationEntryAssociationOverrideValue>,
  preservesEndpointOrder: boolean,
): Readonly<InformationEntryAssociationOverrideValue> {
  if (preservesEndpointOrder || value.graph?.direction === 'symmetric') {
    return value;
  }
  const graph = value.graph;
  if (graph === undefined) return value;
  return Object.freeze({
    ...value,
    graph: Object.freeze({
      ...graph,
      direction:
        graph.direction === 'low_to_high' ? 'high_to_low' : 'low_to_high',
    }),
  });
}

function sameValue(
  left: Readonly<InformationEntryRevisionValue>,
  right: Readonly<InformationEntryRevisionValue>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

function compareEntries(
  left: Readonly<CurrentInformationEntry>,
  right: Readonly<CurrentInformationEntry>,
): number {
  return (
    left.value.documentOrder - right.value.documentOrder ||
    left.entryId.localeCompare(right.entryId)
  );
}

function compareExpectedOverrides(
  left: Readonly<InformationEntryStructureExpectedOverride>,
  right: Readonly<InformationEntryStructureExpectedOverride>,
): number {
  return (
    left.entryLowId.localeCompare(right.entryLowId) ||
    left.entryHighId.localeCompare(right.entryHighId)
  );
}
