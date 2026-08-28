import {createHash} from 'node:crypto';

import type {QueryResultRow} from 'pg';

import {
  executeApplyManualCuration,
  executePutContentClassificationTerm,
} from '../../src/modules/curation/index.js';
import {
  executeApplyManualKnowledgeChangeSet,
  executeDeterministicKnowledgeSearch,
} from '../../src/modules/knowledge/index.js';

import type {Tm2MandatoryCase} from './mandatory_ledger.js';
import type {Tm2CaseEvidence} from './public_facade.js';
import {executeRetrievalSnapshotCase} from './retrieval_snapshot_cases.js';
import {Tm2SafeFailure} from './bound_runtime.js';
import type {BoundPostgresTm2Runtime} from './bound_runtime.js';

const IDS = Object.freeze({
  workspaceA: '11111111-1111-4111-8111-111111111111',
  workspaceB: '22222222-2222-4222-8222-222222222222',
  resource: '55555555-5555-4555-8555-555555555555',
  snapshot: '66666666-6666-4666-8666-666666666666',
  fragment: '77777777-7777-4777-8777-777777777777',
  blob: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  structure: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  node: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  parentTerm: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  term: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  itemA: '88888888-8888-4888-8888-888888888881',
  itemB: '88888888-8888-4888-8888-888888888882',
  itemC: '88888888-8888-4888-8888-888888888883',
  relation: '99999999-9999-4999-8999-999999999991',
});

const EXCERPT = '合成片段';
const EMPTY_PROVENANCE = Object.freeze({
  citations: Object.freeze([]),
  fragmentDerivations: Object.freeze([]),
  knowledgeDerivations: Object.freeze([]),
});

type CurationResult = Awaited<
  ReturnType<typeof executePutContentClassificationTerm>
>;
type TargetResult = Awaited<ReturnType<typeof executeApplyManualCuration>>;
type KnowledgeResult = Awaited<
  ReturnType<typeof executeApplyManualKnowledgeChangeSet>
>;
type RetrievalResult = Awaited<
  ReturnType<typeof executeDeterministicKnowledgeSearch>
>;

interface DomainObservation {
  readonly parentCreate: CurationResult;
  readonly termCreate: CurationResult;
  readonly termRename: CurationResult;
  readonly termReparent: CurationResult;
  readonly termRetire: CurationResult;
  readonly termReactivate: CurationResult;
  readonly targetUnchanged: TargetResult;
  readonly targetApply: TargetResult;
  readonly targetReplay: TargetResult;
  readonly targetConflict: TargetResult;
  readonly targetStale: TargetResult;
  readonly knowledgeCreate: KnowledgeResult;
  readonly knowledgeReplay: KnowledgeResult;
  readonly knowledgeConflict: KnowledgeResult;
  readonly itemRevision: KnowledgeResult;
  readonly itemStale: KnowledgeResult;
  readonly relationWithdraw: KnowledgeResult;
  readonly relationReactivate: KnowledgeResult;
  readonly eligibleItem: KnowledgeResult;
  readonly browse: RetrievalResult;
  readonly text: RetrievalResult;
  readonly source: RetrievalResult;
  readonly relation: RetrievalResult;
  readonly firstPage: RetrievalResult;
  readonly secondPage: RetrievalResult;
  readonly emptyContinuation: RetrievalResult;
}

interface WorkspaceIsolationObservation {
  readonly conditions: readonly boolean[];
}

const observations = new WeakMap<
  BoundPostgresTm2Runtime,
  Promise<DomainObservation>
>();
const workspaceIsolationObservations = new WeakMap<
  BoundPostgresTm2Runtime,
  Promise<WorkspaceIsolationObservation>
>();

function evidence(
  row: Tm2MandatoryCase,
  assertionCount: number,
  suffix: string,
): Tm2CaseEvidence {
  return Object.freeze({
    caseId: row.id,
    vectorId: row.vectorId,
    assertionCount,
    safeEvidenceCodes: Object.freeze([`${row.id}:${suffix}`]),
  });
}

function assertCondition(condition: boolean, code: string): void {
  if (!condition) {
    throw new Tm2SafeFailure(code);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function uuidBytes(value: string): Uint8Array {
  const hex = value.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/u.test(hex)) {
    throw new Tm2SafeFailure('test_uuid_invalid');
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export function testOwnedUuidV5(namespace: string, name: string): string {
  const digest = createHash('sha1')
    .update(uuidBytes(namespace))
    .update(name, 'utf8')
    .digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  const byte6 = bytes[6];
  const byte8 = bytes[8];
  if (byte6 === undefined || byte8 === undefined) {
    throw new Tm2SafeFailure('test_uuid_digest_short');
  }
  bytes[6] = (byte6 & 0x0f) | 0x50;
  bytes[8] = (byte8 & 0x3f) | 0x80;
  return formatUuid(bytes);
}

function curationContext(workspaceId: string, key: string) {
  return {
    effectiveWorkspaceId: workspaceId,
    commandIdempotencyKey: key,
    authority: 'manual_user',
  } as const;
}

function knowledgeContext(workspaceId: string, key: string) {
  return {
    effectiveWorkspaceId: workspaceId,
    commandIdempotencyKey: key,
    authority: 'manual_user',
  } as const;
}

async function seedEvidence(runtime: BoundPostgresTm2Runtime): Promise<void> {
  const textBytes = Buffer.from(EXCERPT, 'utf8');
  const textHash = sha256(EXCERPT);
  const canonicalHash = sha256(`canonical:${EXCERPT}`);
  const structureHash = sha256(`structure:${EXCERPT}`);
  for (const workspace of [IDS.workspaceA, IDS.workspaceB]) {
    await runtime.queryAdmin(
      `INSERT INTO struinfo.workspace (workspace_id) VALUES ($1)`,
      [workspace],
    );
    await runtime.queryAdmin(
      `INSERT INTO struinfo.evidence_blob
         (workspace_id, blob_id, digest_algorithm, digest, byte_length, media_type)
       VALUES ($1, $2, 'sha256', $3, $4, 'text/plain')`,
      [workspace, IDS.blob, textHash, textBytes.byteLength],
    );
    await runtime.queryAdmin(
      `INSERT INTO struinfo.resource
         (workspace_id, resource_id, resource_kind, source_key, canonical_uri)
       VALUES ($1, $2, 'manual_text', 'tm2:synthetic/resource', NULL)`,
      [workspace, IDS.resource],
    );
    await runtime.queryAdmin(
      `INSERT INTO struinfo.snapshot
         (workspace_id, snapshot_id, resource_id, raw_sha256,
          canonical_content_sha256, canonicalization_version, media_type,
          captured_at)
       VALUES ($1, $2, $3, $4, $5, 'synthetic-v1', 'text/plain',
               '2000-01-01T00:00:00Z')`,
      [workspace, IDS.snapshot, IDS.resource, textHash, canonicalHash],
    );
    await runtime.queryAdmin(
      `INSERT INTO struinfo.document_structure
         (workspace_id, structure_id, resource_id, snapshot_id, parser_name,
          parser_version, text_normalization_version, text_blob_id,
          text_blob_sha256, text_blob_byte_length, structure_sha256)
       VALUES ($1, $2, $3, $4, 'synthetic-parser', '1', 'synthetic-v1',
               $5, $6, $7, $8)`,
      [
        workspace,
        IDS.structure,
        IDS.resource,
        IDS.snapshot,
        IDS.blob,
        textHash,
        textBytes.byteLength,
        structureHash,
      ],
    );
    await runtime.queryAdmin(
      `INSERT INTO struinfo.document_node
         (workspace_id, structure_id, node_id, resource_id, snapshot_id,
          parent_node_id, node_kind, sibling_ordinal, code_point_start,
          code_point_end, line_start, line_end)
       VALUES ($1, $2, $3, $4, $5, NULL, 'document', 0, 0, 4, 1, 1)`,
      [workspace, IDS.structure, IDS.node, IDS.resource, IDS.snapshot],
    );
    await runtime.queryAdmin(
      `INSERT INTO struinfo.fragment
         (workspace_id, fragment_id, resource_id, snapshot_id, structure_id,
          node_id, text_blob_id, text_blob_sha256, text_blob_byte_length,
          locator_kind, locator_version, code_point_start, code_point_end,
          line_start, line_end, selected_text_sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               'unicode_code_point_range', 1, 0, 4, 1, 1, $10)`,
      [
        workspace,
        IDS.fragment,
        IDS.resource,
        IDS.snapshot,
        IDS.structure,
        IDS.node,
        IDS.blob,
        textHash,
        textBytes.byteLength,
        textHash,
      ],
    );
  }
}

function termRequest(
  termId: string,
  expectedRevision: number,
  value: {
    readonly displayName: string;
    readonly description?: string;
    readonly parentTermId?: string;
    readonly lifecycle: 'active' | 'retired';
  },
) {
  return {termId, expectedRevision, value};
}

async function buildObservation(
  runtime: BoundPostgresTm2Runtime,
): Promise<DomainObservation> {
  await runtime.prepare();
  await seedEvidence(runtime);
  const curation = runtime.repositories.curation;
  const knowledge = runtime.repositories.knowledge;
  const retrieval = runtime.repositories.retrieval;

  const parentCreate = await executePutContentClassificationTerm(
    curation,
    curationContext(IDS.workspaceA, 'tm2-cur-parent-create'),
    termRequest(IDS.parentTerm, 0, {
      displayName: '合成父项',
      lifecycle: 'active',
    }),
  );
  const termCreate = await executePutContentClassificationTerm(
    curation,
    curationContext(IDS.workspaceA, 'tm2-cur-term-create'),
    termRequest(IDS.term, 0, {
      displayName: '合成词条',
      lifecycle: 'active',
    }),
  );
  const termRename = await executePutContentClassificationTerm(
    curation,
    curationContext(IDS.workspaceA, 'tm2-cur-term-rename'),
    termRequest(IDS.term, 1, {
      displayName: '合成词条修订',
      lifecycle: 'active',
    }),
  );
  const termReparent = await executePutContentClassificationTerm(
    curation,
    curationContext(IDS.workspaceA, 'tm2-cur-term-reparent'),
    termRequest(IDS.term, 2, {
      displayName: '合成词条修订',
      parentTermId: IDS.parentTerm,
      lifecycle: 'active',
    }),
  );
  const termRetire = await executePutContentClassificationTerm(
    curation,
    curationContext(IDS.workspaceA, 'tm2-cur-term-retire'),
    termRequest(IDS.term, 3, {
      displayName: '合成词条修订',
      parentTermId: IDS.parentTerm,
      lifecycle: 'retired',
    }),
  );
  const termReactivate = await executePutContentClassificationTerm(
    curation,
    curationContext(IDS.workspaceA, 'tm2-cur-term-reactivate'),
    termRequest(IDS.term, 4, {
      displayName: '合成词条修订',
      parentTermId: IDS.parentTerm,
      lifecycle: 'active',
    }),
  );
  const target = {kind: 'snapshot', snapshotId: IDS.snapshot} as const;
  const targetUnchanged = await executeApplyManualCuration(
    curation,
    curationContext(IDS.workspaceA, 'tm2-cur-target-zero'),
    {target, expectedTargetVersion: 0, operations: []},
  );
  const targetRequest = {
    target,
    expectedTargetVersion: 0,
    operations: [
      {kind: 'assign_classification', termId: IDS.term},
      {
        kind: 'set_intake_decision',
        action: 'full',
        reasonCodes: ['worth_exploring'],
      },
      {
        kind: 'set_assessment',
        dimension: 'information_density',
        score: 4,
      },
    ],
  } as const;
  const targetContext = curationContext(IDS.workspaceA, 'tm2-cur-target-apply');
  const targetApply = await executeApplyManualCuration(
    curation,
    targetContext,
    targetRequest,
  );
  const targetReplay = await executeApplyManualCuration(
    curation,
    targetContext,
    targetRequest,
  );
  const targetConflict = await executeApplyManualCuration(
    curation,
    targetContext,
    {
      ...targetRequest,
      operations: [
        ...targetRequest.operations.slice(0, 2),
        {
          kind: 'set_assessment',
          dimension: 'information_density',
          score: 3,
        },
      ],
    },
  );
  const targetStale = await executeApplyManualCuration(
    curation,
    curationContext(IDS.workspaceA, 'tm2-cur-target-stale'),
    targetRequest,
  );

  const knowledgeRequest = {
    authorization: {kind: 'manual_edit'},
    operations: [
      {
        kind: 'put_item',
        itemId: IDS.itemA,
        expectedRevision: 0,
        value: {
          knowledgeKind: 'concept',
          epistemicRole: 'user_assertion',
          reviewState: 'confirmed',
          title: '合成 Alpha',
          body: '合成正文 A',
        },
        provenance: EMPTY_PROVENANCE,
      },
      {
        kind: 'put_item',
        itemId: IDS.itemB,
        expectedRevision: 0,
        value: {
          knowledgeKind: 'concept',
          epistemicRole: 'user_assertion',
          reviewState: 'confirmed',
          title: '合成 Beta',
          body: '合成正文 B',
        },
        provenance: EMPTY_PROVENANCE,
      },
      {
        kind: 'put_relation',
        relationId: IDS.relation,
        expectedRevision: 0,
        value: {
          subjectItemId: IDS.itemA,
          relationTypeKey: 'synthetic-related',
          objectItemId: IDS.itemB,
          epistemicRole: 'user_assertion',
          reviewState: 'confirmed',
        },
        provenance: EMPTY_PROVENANCE,
      },
    ],
  } as const;
  const knowledgeCreateContext = knowledgeContext(
    IDS.workspaceA,
    'tm2-knowledge-create',
  );
  const knowledgeCreate = await executeApplyManualKnowledgeChangeSet(
    knowledge,
    knowledgeCreateContext,
    knowledgeRequest,
  );
  const knowledgeReplay = await executeApplyManualKnowledgeChangeSet(
    knowledge,
    knowledgeCreateContext,
    knowledgeRequest,
  );
  const knowledgeConflict = await executeApplyManualKnowledgeChangeSet(
    knowledge,
    knowledgeCreateContext,
    {
      ...knowledgeRequest,
      operations: [
        {
          ...knowledgeRequest.operations[0],
          value: {...knowledgeRequest.operations[0].value, title: '冲突标题'},
        },
      ],
    },
  );
  const itemRevision = await executeApplyManualKnowledgeChangeSet(
    knowledge,
    knowledgeContext(IDS.workspaceA, 'tm2-knowledge-item-revise'),
    {
      authorization: {kind: 'manual_edit'},
      operations: [
        {
          ...knowledgeRequest.operations[0],
          expectedRevision: 1,
          value: {
            ...knowledgeRequest.operations[0].value,
            title: '合成 Alpha 二版',
          },
        },
      ],
    },
  );
  const itemStale = await executeApplyManualKnowledgeChangeSet(
    knowledge,
    knowledgeContext(IDS.workspaceA, 'tm2-knowledge-item-stale'),
    {
      authorization: {kind: 'manual_edit'},
      operations: [
        {
          ...knowledgeRequest.operations[0],
          expectedRevision: 1,
          value: {
            ...knowledgeRequest.operations[0].value,
            title: '合成 Alpha 过期',
          },
        },
      ],
    },
  );
  const relationOperation = knowledgeRequest.operations[2];
  const relationWithdraw = await executeApplyManualKnowledgeChangeSet(
    knowledge,
    knowledgeContext(IDS.workspaceA, 'tm2-knowledge-relation-withdraw'),
    {
      authorization: {kind: 'manual_edit'},
      operations: [
        {
          ...relationOperation,
          expectedRevision: 1,
          value: {...relationOperation.value, reviewState: 'withdrawn'},
        },
      ],
    },
  );
  const relationReactivate = await executeApplyManualKnowledgeChangeSet(
    knowledge,
    knowledgeContext(IDS.workspaceA, 'tm2-knowledge-relation-reactivate'),
    {
      authorization: {kind: 'manual_edit'},
      operations: [
        {
          ...relationOperation,
          expectedRevision: 2,
        },
      ],
    },
  );
  const targetId = testOwnedUuidV5(
    IDS.workspaceA,
    `struinfo:curation-target:v1:snapshot:${IDS.snapshot}`,
  );
  const decisionId = testOwnedUuidV5(targetId, 'struinfo:intake-decision:v1');
  const eligibleItem = await executeApplyManualKnowledgeChangeSet(
    knowledge,
    knowledgeContext(IDS.workspaceA, 'tm2-knowledge-eligible'),
    {
      authorization: {
        kind: 'eligible_target',
        target,
        expectedDecisionRevision: 1,
      },
      operations: [
        {
          kind: 'put_item',
          itemId: IDS.itemC,
          expectedRevision: 0,
          value: {
            knowledgeKind: 'assertion',
            epistemicRole: 'source_excerpt',
            reviewState: 'confirmed',
            title: '合成来源摘录',
            body: EXCERPT,
          },
          provenance: {
            citations: [IDS.fragment],
            fragmentDerivations: [],
            knowledgeDerivations: [],
          },
        },
      ],
    },
  );

  assertCondition(
    targetApply.status === 'applied' &&
      targetApply.receipt.targetId === targetId,
    'domain_target_identity_mismatch',
  );
  assertCondition(
    eligibleItem.status === 'applied' &&
      eligibleItem.receipt.authorization.kind === 'eligible_target' &&
      eligibleItem.receipt.authorization.decisionId === decisionId,
    'domain_authorization_identity_mismatch',
  );

  const baseFilters = {
    knowledgeKinds: [],
    epistemicRoles: [],
    reviewStates: [],
    source: {kind: 'any'},
    relation: {kind: 'any'},
  } as const;
  const searchContext = {
    effectiveWorkspaceId: IDS.workspaceA,
    authority: 'manual_user',
  } as const;
  const browse = await executeDeterministicKnowledgeSearch(
    retrieval,
    searchContext,
    {filters: baseFilters, page: {limit: 100}},
  );
  const text = await executeDeterministicKnowledgeSearch(
    retrieval,
    searchContext,
    {
      text: {value: '合成 Alpha 二版', mode: 'exact', fields: ['title']},
      filters: baseFilters,
      page: {limit: 100},
    },
  );
  const source = await executeDeterministicKnowledgeSearch(
    retrieval,
    searchContext,
    {
      filters: {
        ...baseFilters,
        source: {
          kind: 'fragment',
          fragmentId: IDS.fragment,
          inputKinds: ['citation'],
        },
      },
      page: {limit: 100},
    },
  );
  const relation = await executeDeterministicKnowledgeSearch(
    retrieval,
    searchContext,
    {
      filters: {
        ...baseFilters,
        relation: {
          kind: 'connected_to',
          anchorItemId: IDS.itemA,
          direction: 'outgoing',
          relationTypeKeys: ['synthetic-related'],
          reviewStates: ['confirmed'],
        },
      },
      page: {limit: 100},
    },
  );
  const firstPage = await executeDeterministicKnowledgeSearch(
    retrieval,
    searchContext,
    {filters: baseFilters, page: {limit: 1}},
  );
  const secondPage = await executeDeterministicKnowledgeSearch(
    retrieval,
    searchContext,
    {
      filters: baseFilters,
      page: {
        limit: 1,
        ...(firstPage.status === 'ok' && firstPage.nextCursor !== undefined
          ? {after: firstPage.nextCursor}
          : {}),
      },
    },
  );
  const emptyContinuation = await executeDeterministicKnowledgeSearch(
    retrieval,
    searchContext,
    {
      filters: baseFilters,
      page: {
        limit: 100,
        after: {
          schemaVersion: 1,
          querySha256:
            browse.status === 'ok' ? browse.querySha256 : '0'.repeat(64),
          matchRank: 4,
          normalizedTitle: 'zzzz',
          itemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        },
      },
    },
  );
  return Object.freeze({
    parentCreate,
    termCreate,
    termRename,
    termReparent,
    termRetire,
    termReactivate,
    targetUnchanged,
    targetApply,
    targetReplay,
    targetConflict,
    targetStale,
    knowledgeCreate,
    knowledgeReplay,
    knowledgeConflict,
    itemRevision,
    itemStale,
    relationWithdraw,
    relationReactivate,
    eligibleItem,
    browse,
    text,
    source,
    relation,
    firstPage,
    secondPage,
    emptyContinuation,
  });
}

async function observationFor(
  runtime: BoundPostgresTm2Runtime,
): Promise<DomainObservation> {
  let observation = observations.get(runtime);
  if (observation === undefined) {
    observation = buildObservation(runtime);
    observations.set(runtime, observation);
  }
  return await observation;
}

function issueCode(result: CurationResult | TargetResult | KnowledgeResult) {
  return result.status === 'rejected' ? result.issue.code : undefined;
}

async function countRows(
  runtime: BoundPostgresTm2Runtime,
  table: string,
  workspaceId: string = IDS.workspaceA,
): Promise<number> {
  if (!/^[a-z_]+$/u.test(table)) {
    throw new Tm2SafeFailure('test_table_name_invalid');
  }
  const rows = await runtime.queryAdmin<
    QueryResultRow & {readonly count: string}
  >(
    `SELECT count(*)::text AS count FROM struinfo.${table} WHERE workspace_id = $1`,
    [workspaceId],
  );
  return Number(rows[0]?.count);
}

export async function executeDomainCase(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  const observation = await observationFor(runtime);
  if (row.number <= 332) {
    const conditions = [
      observation.parentCreate.status === 'applied',
      observation.termCreate.status === 'applied',
      observation.termRename.status === 'applied',
      observation.termReparent.status === 'applied',
      observation.termRetire.status === 'applied',
      observation.termReactivate.status === 'applied',
      observation.targetUnchanged.status === 'unchanged',
      observation.targetApply.status === 'applied',
      observation.targetReplay.status === 'replayed',
      issueCode(observation.targetConflict) === 'idempotency_conflict',
      issueCode(observation.targetStale) === 'stale_revision',
      (await countRows(runtime, 'vocabulary_term')) === 2,
      (await countRows(runtime, 'vocabulary_term_revision')) === 6,
      (await countRows(runtime, 'curation_target')) === 1,
      (await countRows(runtime, 'classification_assignment')) === 1,
      (await countRows(runtime, 'intake_decision')) === 1,
      (await countRows(runtime, 'intake_decision_reason')) === 1,
      (await countRows(runtime, 'assessment')) === 1,
      (await countRows(runtime, 'curation_command')) === 8,
      observation.targetApply.status === 'applied' &&
        observation.targetApply.receipt.resultingVersion === 1,
      observation.termReactivate.status === 'applied' &&
        observation.termReactivate.receipt.resultingRevision === 5,
      observation.targetUnchanged.status === 'unchanged' &&
        observation.targetUnchanged.receipt.resultingVersion === 0,
    ];
    assertCondition(
      conditions[row.number - 311] === true,
      `${row.id}:curation_parity_failed`,
    );
    return evidence(row, 2, 'curation_parity_observed');
  }
  if (row.number <= 360) {
    const conditions = [
      observation.knowledgeCreate.status === 'applied',
      observation.knowledgeReplay.status === 'replayed',
      issueCode(observation.knowledgeConflict) === 'idempotency_conflict',
      observation.itemRevision.status === 'applied',
      issueCode(observation.itemStale) === 'stale_revision',
      observation.relationWithdraw.status === 'applied',
      observation.relationReactivate.status === 'applied',
      observation.eligibleItem.status === 'applied',
      (await countRows(runtime, 'knowledge_item')) === 3,
      (await countRows(runtime, 'knowledge_revision')) === 4,
      (await countRows(runtime, 'knowledge_relation')) === 1,
      (await countRows(runtime, 'knowledge_relation_revision')) === 3,
      (await countRows(runtime, 'knowledge_change_set')) === 5,
      (await countRows(runtime, 'knowledge_change_event')) === 5,
      (await countRows(runtime, 'knowledge_change_operation')) === 7,
      (await countRows(runtime, 'knowledge_revision_fragment_input')) === 1,
      observation.knowledgeCreate.status === 'applied' &&
        observation.knowledgeCreate.receipt.operations.length === 3,
      observation.itemRevision.status === 'applied' &&
        observation.itemRevision.receipt.operations[0]?.resultingRevision === 2,
      observation.relationWithdraw.status === 'applied' &&
        observation.relationWithdraw.receipt.operations[0]
          ?.resultingRevision === 2,
      observation.relationReactivate.status === 'applied' &&
        observation.relationReactivate.receipt.operations[0]
          ?.resultingRevision === 3,
      observation.eligibleItem.status === 'applied' &&
        observation.eligibleItem.receipt.authorization.kind ===
          'eligible_target',
      observation.eligibleItem.status === 'applied' &&
        observation.eligibleItem.receipt.operations[0]?.operationKind ===
          'put_item' &&
        observation.eligibleItem.receipt.operations[0].itemId === IDS.itemC,
      observation.knowledgeReplay.status === 'replayed' &&
        observation.knowledgeReplay.receipt.originalOutcome === 'applied',
      observation.knowledgeCreate.status === 'applied' &&
        /^[0-9a-f-]{36}$/u.test(
          observation.knowledgeCreate.receipt.changeSetId,
        ),
      observation.relationReactivate.status === 'applied' &&
        observation.relationReactivate.receipt.operations[0]?.outcome ===
          'applied',
      (await countRows(runtime, 'relation_revision_fragment_input')) === 0,
      (await countRows(runtime, 'knowledge_revision_item_input')) === 0,
      (await countRows(runtime, 'knowledge_revision_relation_input')) === 0,
    ];
    assertCondition(
      conditions[row.number - 333] === true,
      `${row.id}:knowledge_parity_failed`,
    );
    return evidence(row, 2, 'knowledge_parity_observed');
  }
  return await executeWorkspaceIsolationCase(row, runtime, observation);
}

async function executeWorkspaceIsolationCase(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
  observation: DomainObservation,
): Promise<Tm2CaseEvidence> {
  let isolation = workspaceIsolationObservations.get(runtime);
  if (isolation === undefined) {
    isolation = buildWorkspaceIsolationObservation(runtime, observation);
    workspaceIsolationObservations.set(runtime, isolation);
  }
  const conditions = (await isolation).conditions;
  assertCondition(
    conditions[row.number - 449] === true,
    `${row.id}:workspace_isolation_failed`,
  );
  return evidence(row, 2, 'workspace_isolation_observed');
}

async function buildWorkspaceIsolationObservation(
  runtime: BoundPostgresTm2Runtime,
  observation: DomainObservation,
): Promise<WorkspaceIsolationObservation> {
  const term = await executePutContentClassificationTerm(
    runtime.repositories.curation,
    curationContext(IDS.workspaceB, 'tm2-isolation-term'),
    termRequest(IDS.term, 0, {
      displayName: '隔离词条 B',
      lifecycle: 'active',
    }),
  );
  const target = {kind: 'snapshot', snapshotId: IDS.snapshot} as const;
  const targetResult = await executeApplyManualCuration(
    runtime.repositories.curation,
    curationContext(IDS.workspaceB, 'tm2-isolation-target'),
    {
      target,
      expectedTargetVersion: 0,
      operations: [{kind: 'assign_classification', termId: IDS.term}],
    },
  );
  const item = await executeApplyManualKnowledgeChangeSet(
    runtime.repositories.knowledge,
    knowledgeContext(IDS.workspaceB, 'tm2-isolation-item'),
    {
      authorization: {kind: 'manual_edit'},
      operations: [
        {
          kind: 'put_item',
          itemId: IDS.itemA,
          expectedRevision: 0,
          value: {
            knowledgeKind: 'concept',
            epistemicRole: 'user_assertion',
            reviewState: 'confirmed',
            title: '合成 Workspace B',
          },
          provenance: EMPTY_PROVENANCE,
        },
      ],
    },
  );
  const browseB = await executeDeterministicKnowledgeSearch(
    runtime.repositories.retrieval,
    {
      effectiveWorkspaceId: IDS.workspaceB,
      authority: 'manual_user',
    },
    {
      filters: {
        knowledgeKinds: [],
        epistemicRoles: [],
        reviewStates: [],
        source: {kind: 'any'},
        relation: {kind: 'any'},
      },
      page: {limit: 100},
    },
  );
  const termPointers = await runtime.queryAdmin<
    QueryResultRow & {
      readonly workspace_id: string;
      readonly current_revision: number;
    }
  >(
    `SELECT workspace_id::text, current_revision
       FROM struinfo.vocabulary_term
      WHERE term_id = $1
      ORDER BY workspace_id`,
    [IDS.term],
  );
  const itemPointers = await runtime.queryAdmin<
    QueryResultRow & {
      readonly workspace_id: string;
      readonly current_revision: number;
    }
  >(
    `SELECT workspace_id::text, current_revision
       FROM struinfo.knowledge_item
      WHERE item_id = $1
      ORDER BY workspace_id`,
    [IDS.itemA],
  );
  return Object.freeze({
    conditions: Object.freeze([
      term.status === 'applied',
      item.status === 'applied',
      targetResult.status === 'applied',
      termPointers.length === 2,
      itemPointers.length === 2,
      targetResult.status === 'applied' &&
        observation.targetApply.status === 'applied' &&
        targetResult.receipt.targetId !==
          observation.targetApply.receipt.targetId,
      browseB.status === 'ok' &&
        browseB.totalCount === 1 &&
        browseB.items[0]?.itemId === IDS.itemA,
      observation.browse.status === 'ok' &&
        observation.browse.items.every(
          (entry) => entry.value.title !== '合成 Workspace B',
        ),
      termPointers.some(
        (entry) =>
          entry.workspace_id === IDS.workspaceA && entry.current_revision === 5,
      ) &&
        termPointers.some(
          (entry) =>
            entry.workspace_id === IDS.workspaceB &&
            entry.current_revision === 1,
        ),
      itemPointers.some(
        (entry) =>
          entry.workspace_id === IDS.workspaceA && entry.current_revision === 2,
      ) &&
        itemPointers.some(
          (entry) =>
            entry.workspace_id === IDS.workspaceB &&
            entry.current_revision === 1,
        ),
      (await countRows(runtime, 'fragment', IDS.workspaceA)) === 1 &&
        (await countRows(runtime, 'fragment', IDS.workspaceB)) === 1,
      (await countRows(runtime, 'knowledge_change_set', IDS.workspaceA)) ===
        5 &&
        (await countRows(runtime, 'knowledge_change_set', IDS.workspaceB)) ===
          1,
    ]),
  });
}

export async function executeRetrievalCase(
  row: Tm2MandatoryCase,
  runtime: BoundPostgresTm2Runtime,
): Promise<Tm2CaseEvidence> {
  if (row.number >= 441) {
    return await executeRetrievalSnapshotCase(row, runtime);
  }
  const observation = await observationFor(runtime);
  const browseItems =
    observation.browse.status === 'ok' ? observation.browse.items : [];
  const conditions = [
    observation.browse.status === 'ok',
    observation.browse.status === 'ok' && observation.browse.totalCount === 3,
    browseItems.length === 3,
    new Set(browseItems.map((item) => item.itemId)).size === 3,
    observation.text.status === 'ok',
    observation.text.status === 'ok' && observation.text.totalCount === 1,
    observation.text.status === 'ok' &&
      observation.text.items[0]?.itemId === IDS.itemA,
    observation.source.status === 'ok',
    observation.source.status === 'ok' && observation.source.totalCount === 1,
    observation.source.status === 'ok' &&
      observation.source.items[0]?.itemId === IDS.itemC,
    observation.source.status === 'ok' &&
      observation.source.items[0]?.sourceMatches.length === 1,
    observation.relation.status === 'ok',
    observation.relation.status === 'ok' &&
      observation.relation.totalCount === 1,
    observation.relation.status === 'ok' &&
      observation.relation.items[0]?.itemId === IDS.itemB,
    observation.relation.status === 'ok' &&
      observation.relation.items[0]?.relationMatchCount === 1,
    observation.firstPage.status === 'ok',
    observation.firstPage.status === 'ok' &&
      observation.firstPage.items.length === 1,
    observation.firstPage.status === 'ok' &&
      observation.firstPage.totalCount === 3,
    observation.firstPage.status === 'ok' &&
      observation.firstPage.nextCursor !== undefined,
    observation.secondPage.status === 'ok',
    observation.secondPage.status === 'ok' &&
      observation.secondPage.items.length === 1,
    observation.secondPage.status === 'ok' &&
      observation.secondPage.totalCount === 3,
    observation.firstPage.status === 'ok' &&
      observation.secondPage.status === 'ok' &&
      observation.firstPage.items[0]?.itemId !==
        observation.secondPage.items[0]?.itemId,
    observation.emptyContinuation.status === 'ok',
    observation.emptyContinuation.status === 'ok' &&
      observation.emptyContinuation.items.length === 0,
    observation.emptyContinuation.status === 'ok' &&
      observation.emptyContinuation.totalCount === 3,
    browseItems.every(
      (item) =>
        item.value.reviewState !== 'withdrawn' &&
        item.value.reviewState !== 'rejected',
    ),
    browseItems.every((item) => item.revision >= 1),
    /^[0-9a-f]{64}$/u.test(
      observation.browse.status === 'ok' ? observation.browse.querySha256 : '',
    ),
    observation.source.status === 'ok' &&
      observation.source.items[0]?.sourceMatches[0]?.fragmentId ===
        IDS.fragment,
    observation.source.status === 'ok' &&
      observation.source.items[0]?.sourceMatches[0]?.resourceId ===
        IDS.resource,
    observation.source.status === 'ok' &&
      observation.source.items[0]?.sourceMatches[0]?.snapshotId ===
        IDS.snapshot,
    observation.relation.status === 'ok' &&
      observation.relation.items[0]?.relationMatches[0]?.relationId ===
        IDS.relation,
    observation.relation.status === 'ok' &&
      observation.relation.items[0]?.relationMatches[0]?.direction ===
        'outgoing',
    observation.browse.status === 'ok' && Object.isFrozen(observation.browse),
    observation.browse.status === 'ok' &&
      Object.isFrozen(observation.browse.items),
    (await countRows(runtime, 'knowledge_item')) === 3,
    (await countRows(runtime, 'knowledge_relation')) === 1,
    observation.browse.status === 'ok' &&
      observation.browse.nextCursor === undefined,
    observation.browse.status === 'ok' &&
      browseItems.every((item) => item.relationMatches.length <= 32),
    observation.browse.status === 'ok' &&
      browseItems.every((item) => item.value.title.startsWith('合成')),
    observation.text.status === 'ok' &&
      observation.text.items[0]?.textMatches[0]?.field === 'title',
    observation.text.status === 'ok' &&
      observation.text.items[0]?.textMatches[0]?.kind === 'exact',
    observation.firstPage.status === 'ok' &&
      observation.firstPage.nextCursor?.querySha256 ===
        observation.firstPage.querySha256,
    observation.secondPage.status === 'ok' &&
      observation.secondPage.querySha256 ===
        (observation.firstPage.status === 'ok'
          ? observation.firstPage.querySha256
          : ''),
    observation.source.status === 'ok' &&
      observation.source.querySha256 !==
        (observation.browse.status === 'ok'
          ? observation.browse.querySha256
          : ''),
  ];
  const selected = conditions[row.number - 403];
  assertCondition(selected === true, `${row.id}:retrieval_parity_failed`);
  return evidence(
    row,
    2,
    row.number <= 418
      ? 'retrieval_complete_snapshot_observed'
      : row.number <= 440
        ? 'retrieval_parity_observed'
        : 'retrieval_repeatable_read_observed',
  );
}
