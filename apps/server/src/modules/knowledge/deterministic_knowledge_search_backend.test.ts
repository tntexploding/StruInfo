import {describe, expect, it, vi} from 'vitest';

import {
  type DeterministicKnowledgeSearchRepositoryPort,
  type DeterministicKnowledgeSearchRequest,
  type DeterministicKnowledgeSearchResult,
  type DeterministicKnowledgeSearchSnapshot,
  deriveKnowledgeItemRevisionId,
  deriveKnowledgeRelationRevisionId,
  executeDeterministicKnowledgeSearch,
  searchKeyV1,
} from './index.js';
import {digestDeterministicKnowledgeSearchQuery} from './deterministic_knowledge_search_identity.js';

const WORKSPACE_ID = uuid(1);
const ANCHOR_ID = uuid(2);

interface ItemFixture {
  readonly itemId: string;
  readonly revision?: number;
  readonly title: string;
  readonly body?: string;
  readonly knowledgeKind?:
    | 'entity'
    | 'concept'
    | 'assertion'
    | 'event'
    | 'method'
    | 'framework'
    | 'resource'
    | 'work';
  readonly epistemicRole?:
    | 'source_excerpt'
    | 'source_claim'
    | 'summary'
    | 'inference'
    | 'user_assertion';
  readonly reviewState?:
    | 'draft'
    | 'pending_review'
    | 'confirmed'
    | 'disputed'
    | 'rejected'
    | 'withdrawn';
}

interface RelationFixture {
  readonly relationId: string;
  readonly subjectItemId: string;
  readonly objectItemId: string;
  readonly relationTypeKey: string;
  readonly reviewState?:
    | 'draft'
    | 'pending_review'
    | 'confirmed'
    | 'disputed'
    | 'rejected'
    | 'withdrawn';
  readonly qualifier?: string;
}

interface FragmentInputFixture {
  readonly itemId: string;
  readonly inputKind: 'citation' | 'derivation';
  readonly inputOrdinal: number;
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly fragmentId: string;
}

describe('deterministic knowledge search normalization', () => {
  it('implements both NFC passes, ASCII-only lowercase, and idempotence', () => {
    const vectors: readonly [string, string][] = [
      ['ABC', 'abc'],
      ['e\u0301', '\u00e9'],
      ['J\u030c', '\u01f0'],
      ['H\u0331', '\u1e96'],
      ['知识数据库', '知识数据库'],
      ['🧪', '🧪'],
      ['Ａ', 'Ａ'],
      ['Straße', 'straße'],
    ];
    for (const [input, expected] of vectors) {
      const key = searchKeyV1(input);
      expect(key).toBe(expected);
      expect(searchKeyV1(key)).toBe(key);
    }
    expect(searchKeyV1('Ａ')).not.toBe(searchKeyV1('A'));
    expect(searchKeyV1('Straße')).not.toBe(searchKeyV1('STRASSE'));
  });

  it('uses one digest for NFC/NFD queries and excludes page state', () => {
    const left = request({
      text: {value: 'e\u0301', mode: 'exact', fields: ['title']},
      limit: 1,
    });
    const right = request({
      text: {value: '\u00e9', mode: 'exact', fields: ['title']},
      limit: 100,
    });
    expect(digestDeterministicKnowledgeSearchQuery(left)).toBe(
      digestDeterministicKnowledgeSearchQuery(right),
    );
  });
});

describe('deterministic knowledge search semantics', () => {
  it('assigns all four text ranks and reports title before body', async () => {
    const state = snapshot([
      {itemId: uuid(10), title: 'alpha', body: 'body alpha suffix'},
      {itemId: uuid(11), title: 'prefix alpha suffix'},
      {itemId: uuid(12), title: 'other', body: 'alpha'},
      {itemId: uuid(13), title: 'other two', body: 'prefix alpha suffix'},
      {itemId: uuid(14), title: 'unmatched'},
    ]);
    const result = await execute(
      state,
      request({
        text: {
          value: 'ALPHA',
          mode: 'substring',
          fields: ['body', 'title'],
        },
      }),
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.items.map((item) => item.matchRank)).toEqual([0, 1, 2, 3]);
    expect(result.items[0]?.textMatches).toEqual([
      {field: 'title', kind: 'exact', rank: 0},
      {field: 'body', kind: 'substring', rank: 3},
    ]);
  });

  it('keeps exact mode, absent body, no-text rank, and item filters explicit', async () => {
    const state = snapshot(
      [
        {
          itemId: uuid(20),
          revision: 2,
          title: 'synthetic-title',
          knowledgeKind: 'method',
          epistemicRole: 'summary',
          reviewState: 'withdrawn',
        },
        {
          itemId: uuid(21),
          title: 'synthetic-title-extra',
          knowledgeKind: 'concept',
          epistemicRole: 'source_claim',
          reviewState: 'confirmed',
        },
      ],
      [
        {
          itemId: uuid(21),
          inputKind: 'citation',
          inputOrdinal: 0,
          resourceId: uuid(22),
          snapshotId: uuid(23),
          fragmentId: uuid(24),
        },
      ],
    );
    const exact = await execute(
      state,
      request({
        text: {
          value: 'synthetic-title',
          mode: 'exact',
          fields: ['title', 'body'],
        },
        knowledgeKinds: ['method'],
        epistemicRoles: ['summary'],
        reviewStates: ['withdrawn'],
      }),
    );
    expect(okItems(exact).map((item) => item.itemId)).toEqual([uuid(20)]);
    expect(okItems(exact)[0]?.textMatches).toEqual([
      {field: 'title', kind: 'exact', rank: 0},
    ]);

    const browse = await execute(state, request());
    expect(okItems(browse).every((item) => item.matchRank === 4)).toBe(true);
    expect(okItems(browse).every((item) => item.textMatches.length === 0)).toBe(
      true,
    );
  });

  it('matches direct resource/snapshot/fragment inputs in stable order', async () => {
    const resourceId = uuid(30);
    const snapshotId = uuid(31);
    const fragmentCitation = uuid(32);
    const fragmentDerivation = uuid(33);
    const itemId = uuid(34);
    const state = snapshot(
      [{itemId, title: 'source-target'}],
      [
        {
          itemId,
          inputKind: 'derivation',
          inputOrdinal: 0,
          resourceId,
          snapshotId,
          fragmentId: fragmentDerivation,
        },
        {
          itemId,
          inputKind: 'citation',
          inputOrdinal: 0,
          resourceId,
          snapshotId,
          fragmentId: fragmentCitation,
        },
      ],
    );
    const resource = await execute(
      state,
      request({
        source: {kind: 'resource', resourceId, inputKinds: []},
      }),
    );
    expect(
      okItems(resource)[0]?.sourceMatches.map((row) => row.inputKind),
    ).toEqual(['citation', 'derivation']);
    const citationOnly = await execute(
      state,
      request({
        source: {
          kind: 'snapshot',
          snapshotId,
          inputKinds: ['citation'],
        },
      }),
    );
    expect(okItems(citationOnly)[0]?.sourceMatches).toHaveLength(1);
    const fragment = await execute(
      state,
      request({
        source: {
          kind: 'fragment',
          fragmentId: fragmentDerivation,
          inputKinds: ['derivation'],
        },
      }),
    );
    expect(okItems(fragment)[0]?.sourceMatches[0]?.fragmentId).toBe(
      fragmentDerivation,
    );
  });

  it('matches outgoing, incoming, and either one-hop relations', async () => {
    const outgoingId = uuid(41);
    const incomingId = uuid(42);
    const state = snapshot(
      [
        {itemId: ANCHOR_ID, title: 'anchor'},
        {itemId: outgoingId, title: 'outgoing'},
        {itemId: incomingId, title: 'incoming'},
      ],
      [],
      [
        {
          relationId: uuid(50),
          subjectItemId: ANCHOR_ID,
          objectItemId: outgoingId,
          relationTypeKey: 'synthetic:edge-a',
        },
        {
          relationId: uuid(51),
          subjectItemId: incomingId,
          objectItemId: ANCHOR_ID,
          relationTypeKey: 'synthetic:edge-b',
          reviewState: 'disputed',
        },
      ],
    );
    const outgoing = await execute(
      state,
      request({
        relation: {
          kind: 'connected_to',
          anchorItemId: ANCHOR_ID,
          direction: 'outgoing',
          relationTypeKeys: [],
          reviewStates: [],
        },
      }),
    );
    expect(okItems(outgoing).map((item) => item.itemId)).toEqual([outgoingId]);
    expect(okItems(outgoing)[0]?.relationMatches[0]?.direction).toBe(
      'outgoing',
    );
    const incoming = await execute(
      state,
      request({
        relation: {
          kind: 'connected_to',
          anchorItemId: ANCHOR_ID,
          direction: 'incoming',
          relationTypeKeys: ['synthetic:edge-b'],
          reviewStates: ['disputed'],
        },
      }),
    );
    expect(okItems(incoming).map((item) => item.itemId)).toEqual([incomingId]);
    expect(okItems(incoming)[0]?.relationMatches[0]?.direction).toBe(
      'incoming',
    );
    const either = await execute(
      state,
      request({
        relation: {
          kind: 'connected_to',
          anchorItemId: ANCHOR_ID,
          direction: 'either',
          relationTypeKeys: [],
          reviewStates: [],
        },
      }),
    );
    expect(new Set(okItems(either).map((item) => item.itemId))).toEqual(
      new Set([outgoingId, incomingId]),
    );
  });

  it('counts every parallel relation while returning a stable 32-row prefix', async () => {
    const targetId = uuid(60);
    const relations = Array.from({length: 33}, (_, index) => ({
      relationId: uuid(100 + index),
      subjectItemId: ANCHOR_ID,
      objectItemId: targetId,
      relationTypeKey: `synthetic:parallel-${String(index).padStart(2, '0')}`,
    }));
    const result = await execute(
      snapshot(
        [
          {itemId: ANCHOR_ID, title: 'anchor'},
          {itemId: targetId, title: 'target'},
        ],
        [],
        relations,
      ),
      request({
        relation: {
          kind: 'connected_to',
          anchorItemId: ANCHOR_ID,
          direction: 'outgoing',
          relationTypeKeys: [],
          reviewStates: [],
        },
      }),
    );
    const item = okItems(result)[0];
    expect(item?.relationMatchCount).toBe(33);
    expect(item?.relationMatches).toHaveLength(32);
    expect(item?.relationMatchesTruncated).toBe(true);
    expect(item?.relationMatches[0]?.relationTypeKey).toBe(
      'synthetic:parallel-00',
    );
  });

  it('uses unsigned UTF-8 title ordering, exclusive cursors, and stable totalCount', async () => {
    const state = snapshot([
      {itemId: uuid(201), title: 'z'},
      {itemId: uuid(202), title: '知识'},
      {itemId: uuid(203), title: '🧪'},
      {itemId: uuid(204), title: 'a'},
    ]);
    const first = await execute(state, request({limit: 2}));
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') return;
    expect(first.totalCount).toBe(4);
    expect(first.items.map((item) => item.value.title)).toEqual(['a', 'z']);
    expect(first.nextCursor).toBeDefined();
    const second = await execute(
      state,
      request({limit: 100, after: first.nextCursor}),
    );
    expect(second.status).toBe('ok');
    if (second.status !== 'ok') return;
    expect(second.totalCount).toBe(4);
    expect(second.items.map((item) => item.value.title)).toEqual([
      '知识',
      '🧪',
    ]);
    expect(second.nextCursor).toBeUndefined();

    const beyond = await execute(
      state,
      request({
        after: {
          schemaVersion: 1,
          querySha256: first.querySha256,
          matchRank: 4,
          normalizedTitle: '\u{10ffff}',
          itemId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        },
      }),
    );
    expect(beyond).toMatchObject({status: 'ok', totalCount: 4, items: []});
  });

  it('generates and decodes the 900-code-point cursor witness', async () => {
    const saturatedTitle = '\ufb2c'.repeat(300);
    expect(Array.from(searchKeyV1(saturatedTitle))).toHaveLength(900);
    const state = snapshot([
      {itemId: uuid(301), title: saturatedTitle},
      {itemId: uuid(302), title: saturatedTitle},
    ]);
    const first = await execute(state, request({limit: 1}));
    expect(first.status).toBe('ok');
    if (first.status !== 'ok' || first.nextCursor === undefined) return;
    expect(Array.from(first.nextCursor.normalizedTitle)).toHaveLength(900);
    const second = await execute(
      state,
      request({limit: 1, after: first.nextCursor}),
    );
    expect(okItems(second)).toHaveLength(1);
  });

  it('returns a successful zero-match result and hides absent anchors', async () => {
    const state = snapshot([{itemId: uuid(401), title: 'alpha'}]);
    const noText = await execute(
      state,
      request({
        text: {value: 'missing', mode: 'substring', fields: ['title']},
      }),
    );
    expect(noText).toMatchObject({status: 'ok', totalCount: 0, items: []});
    const noAnchor = await execute(
      state,
      request({
        relation: {
          kind: 'connected_to',
          anchorItemId: uuid(499),
          direction: 'either',
          relationTypeKeys: [],
          reviewStates: [],
        },
      }),
    );
    expect(noAnchor).toMatchObject({status: 'ok', totalCount: 0, items: []});
  });
});

describe('closed input, repository, and complexity boundaries', () => {
  it('rejects Proxy and accessor input without executing caller code or calling the repository', async () => {
    let traps = 0;
    const proxy = new Proxy(request(), {
      ownKeys() {
        traps += 1;
        return [];
      },
    });
    const load = vi.fn(() => Promise.resolve(snapshot([])));
    const proxied = await executeDeterministicKnowledgeSearch(
      {loadCurrentKnowledgeSearchSnapshot: load},
      context(),
      proxy,
    );
    expect(proxied).toEqual({
      status: 'rejected',
      issue: {code: 'invalid_shape', path: 'request'},
    });
    expect(traps).toBe(0);
    expect(load).not.toHaveBeenCalled();

    let getters = 0;
    const accessor = {
      page: {limit: 10},
      get filters() {
        getters += 1;
        return {};
      },
    };
    const accessed = await executeDeterministicKnowledgeSearch(
      {loadCurrentKnowledgeSearchSnapshot: load},
      context(),
      accessor,
    );
    expect(accessed).toEqual({
      status: 'rejected',
      issue: {code: 'invalid_shape', path: 'request.filters'},
    });
    expect(getters).toBe(0);
    expect(load).not.toHaveBeenCalled();
  });

  it('rejects sparse/extra arrays, duplicate values, and bad cursors before repository access', async () => {
    const load = vi.fn(() => Promise.resolve(snapshot([])));
    const sparse = request();
    const fields = new Array<string>(1);
    const sparseRequest = {
      ...sparse,
      text: {value: 'alpha', mode: 'exact', fields},
    };
    expect(
      await executeDeterministicKnowledgeSearch(
        {loadCurrentKnowledgeSearchSnapshot: load},
        context(),
        sparseRequest,
      ),
    ).toEqual({
      status: 'rejected',
      issue: {code: 'invalid_shape', path: 'request.text.fields'},
    });

    const duplicate = request({knowledgeKinds: ['entity', 'entity']});
    expect(
      await executeDeterministicKnowledgeSearch(
        {loadCurrentKnowledgeSearchSnapshot: load},
        context(),
        duplicate,
      ),
    ).toEqual({
      status: 'rejected',
      issue: {
        code: 'duplicate_value',
        path: 'request.filters.knowledgeKinds[1]',
      },
    });

    const valid = request();
    const digest = digestDeterministicKnowledgeSearchQuery(valid);
    const badCursor = request({
      after: {
        schemaVersion: 1,
        querySha256: `${digest.startsWith('0') ? '1' : '0'}${digest.slice(1)}`,
        matchRank: 4,
        normalizedTitle: 'alpha',
        itemId: uuid(1),
      },
    });
    const cursorResult = await executeDeterministicKnowledgeSearch(
      {loadCurrentKnowledgeSearchSnapshot: load},
      context(),
      badCursor,
    );
    expect(cursorResult).toMatchObject({
      status: 'rejected',
      issue: {
        code: 'invalid_cursor',
        path: 'request.page.after.querySha256',
      },
    });
    expect(load).not.toHaveBeenCalled();
  });

  it('copies request/snapshot values and recursively freezes successful output', async () => {
    const mutableRequest = request({
      text: {value: 'alpha', mode: 'exact', fields: ['title']},
    }) as Mutable<DeterministicKnowledgeSearchRequest>;
    const mutableSnapshot = snapshot([
      {itemId: uuid(501), title: 'alpha'},
    ]) as DeepMutable<DeterministicKnowledgeSearchSnapshot>;
    const load = vi.fn(() => {
      mutableRequest.text = {
        value: 'changed',
        mode: 'exact',
        fields: ['title'],
      };
      return Promise.resolve(mutableSnapshot);
    });
    const result = await executeDeterministicKnowledgeSearch(
      {loadCurrentKnowledgeSearchSnapshot: load},
      context(),
      mutableRequest,
    );
    expect(okItems(result)).toHaveLength(1);
    requiredAt(mutableSnapshot.revisions, 0).value.title = 'later-change';
    expect(okItems(result)[0]?.value.title).toBe('alpha');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(okItems(result))).toBe(true);
    expect(Object.isFrozen(okItems(result)[0]?.value)).toBe(true);
  });

  it('calls a legal repository once and maps throw/malformed state without echoing values', async () => {
    const requestValue = request({
      text: {
        value: 'synthetic-non-echo-query',
        mode: 'exact',
        fields: ['title'],
      },
    });
    const successLoad = vi.fn(() => Promise.resolve(snapshot([])));
    await executeDeterministicKnowledgeSearch(
      {loadCurrentKnowledgeSearchSnapshot: successLoad},
      context(),
      requestValue,
    );
    expect(successLoad).toHaveBeenCalledTimes(1);
    expect(successLoad).toHaveBeenCalledWith(WORKSPACE_ID);

    const failed = await executeDeterministicKnowledgeSearch(
      {
        loadCurrentKnowledgeSearchSnapshot() {
          return Promise.reject(new Error('synthetic-database-detail'));
        },
      },
      context(),
      requestValue,
    );
    expect(failed).toEqual({
      status: 'failed',
      issue: {code: 'repository_failed', path: 'repository'},
    });
    expect(JSON.stringify(failed)).not.toContain('synthetic-database-detail');
    expect(JSON.stringify(failed)).not.toContain('synthetic-non-echo-query');

    let getterCalls = 0;
    const malformed = {
      get items() {
        getterCalls += 1;
        return [];
      },
      revisions: [],
      fragmentInputs: [],
      relations: [],
      relationRevisions: [],
    };
    const invalid = await executeDeterministicKnowledgeSearch(
      {
        loadCurrentKnowledgeSearchSnapshot() {
          return Promise.resolve(malformed);
        },
      },
      context(),
      requestValue,
    );
    expect(invalid).toEqual({
      status: 'failed',
      issue: {code: 'invalid_repository_snapshot', path: 'repository'},
    });
    expect(getterCalls).toBe(0);
  });

  it('validates large map/adjacency closure and rejects duplicate or dangling rows', async () => {
    const items = Array.from({length: 200}, (_, index) => ({
      itemId: uuid(1_000 + index),
      title: `synthetic-item-${String(index).padStart(3, '0')}`,
    }));
    const relations = Array.from({length: 199}, (_, index) => ({
      relationId: uuid(2_000 + index),
      subjectItemId: requiredAt(items, index).itemId,
      objectItemId: requiredAt(items, index + 1).itemId,
      relationTypeKey: 'synthetic:next',
    }));
    const state = snapshot(items, [], relations);
    const result = await execute(state, request({limit: 100}));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.totalCount).toBe(200);

    const duplicate = structuredClone(
      state,
    ) as DeepMutable<DeterministicKnowledgeSearchSnapshot>;
    duplicate.items.splice(
      1,
      0,
      structuredClone(requiredAt(duplicate.items, 0)),
    );
    const invalidDuplicate = await execute(duplicate, request());
    expect(invalidDuplicate).toEqual({
      status: 'failed',
      issue: {code: 'invalid_repository_snapshot', path: 'repository'},
    });

    const dangling = structuredClone(
      state,
    ) as DeepMutable<DeterministicKnowledgeSearchSnapshot>;
    requiredAt(dangling.relations, 0).objectItemId = uuid(9_999);
    requiredAt(dangling.relationRevisions, 0).value.objectItemId = uuid(9_999);
    const invalidDangling = await execute(dangling, request());
    expect(invalidDangling).toEqual({
      status: 'failed',
      issue: {code: 'invalid_repository_snapshot', path: 'repository'},
    });
  });
});

function context(): {effectiveWorkspaceId: string; authority: 'manual_user'} {
  return {effectiveWorkspaceId: WORKSPACE_ID, authority: 'manual_user'};
}

function request(
  overrides: Readonly<{
    text?: DeterministicKnowledgeSearchRequest['text'];
    knowledgeKinds?: DeterministicKnowledgeSearchRequest['filters']['knowledgeKinds'];
    epistemicRoles?: DeterministicKnowledgeSearchRequest['filters']['epistemicRoles'];
    reviewStates?: DeterministicKnowledgeSearchRequest['filters']['reviewStates'];
    source?: DeterministicKnowledgeSearchRequest['filters']['source'];
    relation?: DeterministicKnowledgeSearchRequest['filters']['relation'];
    limit?: number;
    after?: DeterministicKnowledgeSearchRequest['page']['after'];
  }> = {},
): DeterministicKnowledgeSearchRequest {
  return {
    ...(overrides.text === undefined ? {} : {text: overrides.text}),
    filters: {
      knowledgeKinds: overrides.knowledgeKinds ?? [],
      epistemicRoles: overrides.epistemicRoles ?? [],
      reviewStates: overrides.reviewStates ?? [],
      source: overrides.source ?? {kind: 'any'},
      relation: overrides.relation ?? {kind: 'any'},
    },
    page: {
      limit: overrides.limit ?? 100,
      ...(overrides.after === undefined ? {} : {after: overrides.after}),
    },
  };
}

function snapshot(
  itemFixtures: readonly ItemFixture[],
  fragmentFixtures: readonly FragmentInputFixture[] = [],
  relationFixtures: readonly RelationFixture[] = [],
): DeterministicKnowledgeSearchSnapshot {
  const sortedItems = [...itemFixtures].sort((left, right) =>
    left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0,
  );
  const items = sortedItems.map((fixture) => ({
    workspaceId: WORKSPACE_ID,
    itemId: fixture.itemId,
    currentRevision: fixture.revision ?? 1,
    currentRevisionId: deriveKnowledgeItemRevisionId(
      fixture.itemId,
      fixture.revision ?? 1,
    ),
  }));
  const revisions = sortedItems.map((fixture) => ({
    workspaceId: WORKSPACE_ID,
    itemId: fixture.itemId,
    revision: fixture.revision ?? 1,
    revisionId: deriveKnowledgeItemRevisionId(
      fixture.itemId,
      fixture.revision ?? 1,
    ),
    value: {
      knowledgeKind: fixture.knowledgeKind ?? ('entity' as const),
      epistemicRole: fixture.epistemicRole ?? ('user_assertion' as const),
      reviewState: fixture.reviewState ?? ('confirmed' as const),
      title: fixture.title,
      ...(fixture.body === undefined ? {} : {body: fixture.body}),
    },
  }));
  const fragmentInputs = [...fragmentFixtures]
    .sort((left, right) => {
      if (left.itemId !== right.itemId) {
        return left.itemId < right.itemId ? -1 : 1;
      }
      if (left.inputKind !== right.inputKind) {
        return left.inputKind === 'citation' ? -1 : 1;
      }
      return left.inputOrdinal - right.inputOrdinal;
    })
    .map((fixture) => ({
      workspaceId: WORKSPACE_ID,
      itemId: fixture.itemId,
      revision:
        itemFixtures.find((item) => item.itemId === fixture.itemId)?.revision ??
        1,
      revisionId: deriveKnowledgeItemRevisionId(
        fixture.itemId,
        itemFixtures.find((item) => item.itemId === fixture.itemId)?.revision ??
          1,
      ),
      inputKind: fixture.inputKind,
      inputOrdinal: fixture.inputOrdinal,
      resourceId: fixture.resourceId,
      snapshotId: fixture.snapshotId,
      fragmentId: fixture.fragmentId,
    }));
  const sortedRelations = [...relationFixtures].sort((left, right) =>
    left.relationId < right.relationId
      ? -1
      : left.relationId > right.relationId
        ? 1
        : 0,
  );
  const relations = sortedRelations.map((fixture) => ({
    workspaceId: WORKSPACE_ID,
    relationId: fixture.relationId,
    subjectItemId: fixture.subjectItemId,
    relationTypeKey: fixture.relationTypeKey,
    objectItemId: fixture.objectItemId,
    currentRevision: 1,
    currentRevisionId: deriveKnowledgeRelationRevisionId(fixture.relationId, 1),
  }));
  const relationRevisions = sortedRelations.map((fixture) => ({
    workspaceId: WORKSPACE_ID,
    relationId: fixture.relationId,
    revision: 1,
    revisionId: deriveKnowledgeRelationRevisionId(fixture.relationId, 1),
    value: {
      subjectItemId: fixture.subjectItemId,
      relationTypeKey: fixture.relationTypeKey,
      objectItemId: fixture.objectItemId,
      epistemicRole: 'source_claim' as const,
      reviewState: fixture.reviewState ?? ('confirmed' as const),
      ...(fixture.qualifier === undefined
        ? {}
        : {qualifier: fixture.qualifier}),
    },
  }));
  return {items, revisions, fragmentInputs, relations, relationRevisions};
}

async function execute(
  state: DeterministicKnowledgeSearchSnapshot,
  requestValue: DeterministicKnowledgeSearchRequest,
): Promise<DeterministicKnowledgeSearchResult> {
  const repository: DeterministicKnowledgeSearchRepositoryPort = {
    loadCurrentKnowledgeSearchSnapshot() {
      return Promise.resolve(state);
    },
  };
  return executeDeterministicKnowledgeSearch(
    repository,
    context(),
    requestValue,
  );
}

function okItems(
  result: DeterministicKnowledgeSearchResult,
): Extract<DeterministicKnowledgeSearchResult, {status: 'ok'}>['items'] {
  expect(result.status).toBe('ok');
  return result.status === 'ok' ? result.items : [];
}

function requiredAt<Value>(values: readonly Value[], index: number): Value {
  const value = values[index];
  if (value === undefined) {
    throw new Error('Synthetic test fixture index is missing.');
  }
  return value;
}

function uuid(value: number): string {
  return `00000000-0000-0000-0000-${String(value).padStart(12, '0')}`;
}

type Mutable<Value> = {
  -readonly [Key in keyof Value]: Value[Key];
};

type DeepMutable<Value> = Value extends readonly (infer Element)[]
  ? DeepMutable<Element>[]
  : Value extends object
    ? {-readonly [Key in keyof Value]: DeepMutable<Value[Key]>}
    : Value;
