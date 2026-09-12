import {createHash} from 'node:crypto';
import {describe, expect, it, vi} from 'vitest';
import type {
  CurrentInformationEntry,
  InformationEntryEmptySnapshotRepositoryPort,
} from '../modules/entries/index.js';
import type {EvidenceSnapshotReadState} from '../modules/evidence/index.js';
import type {ProcessingRun} from '../modules/processing/index.js';
import {
  DocumentUseCases,
  type DocumentUseCasesDependencies,
} from './document_use_cases.js';
import {
  EntryUseCases,
  type EntryUseCasesDependencies,
} from './entry_use_cases.js';
import {
  DELEGATED_READ_OPERATIONS,
  ExecutionAuthority,
} from './execution_authority.js';
import {
  ProcessingUseCases,
  type ProcessingUseCasesDependencies,
} from './processing_use_cases.js';
import {
  RelationUseCases,
  type RelationUseCasesDependencies,
  type GraphEdgeWriteRequest,
} from './relation_use_cases.js';

const WORKSPACE = '00000000-0000-4000-8000-000000000001';
const RESOURCE = '00000000-0000-4000-8000-000000000002';
const SNAPSHOT = '00000000-0000-4000-8000-000000000003';
const STRUCTURE = '00000000-0000-4000-8000-000000000004';
const FRAGMENT = '00000000-0000-4000-8000-000000000005';
const RELATED = '00000000-0000-4000-8000-000000000006';
const RUN = '00000000-0000-4000-8000-000000000007';
const SOURCE = '# Synthetic\n\nLocal 😀 evidence.\n';
const SHA = createHash('sha256').update(SOURCE).digest('hex');
const OWNER = ExecutionAuthority.owner(WORKSPACE);
const EDIT: GraphEdgeWriteRequest = {
  expectedRevision: 0,
  includePrivate: false,
  operation: 'edit',
  label: 'Synthetic relation',
  direction: 'symmetric',
  semanticKind: 'related',
  verificationStatus: 'unreviewed',
  note: '',
};

describe('shared application use cases without HTTP', () => {
  it('lists and reads the fixed workspace, then rebuilds the first structure from local evidence', async () => {
    const fixture = createFixture();
    const documents = new DocumentUseCases(OWNER, fixture.dependencies);
    expect((await documents.list()).documents).toMatchObject([
      {snapshotId: SNAPSHOT, entryCount: 0},
    ]);
    expect(
      (await documents.read(SNAPSHOT)).snapshot.structures[0]?.normalizedText,
    ).toBe(SOURCE);
    const result = await documents.materialize({
      snapshotId: SNAPSHOT,
      includePrivate: false,
      mode: 'deterministic',
    });
    expect(result).toMatchObject({
      status: 'created',
      createdCount: 1,
      snapshotId: SNAPSHOT,
    });
    expect(result.entries[0]?.value).toMatchObject({
      body: SOURCE,
      fragmentIds: [FRAGMENT],
      isPrivate: false,
    });
    expect(fixture.materialize).toHaveBeenCalledTimes(1);
    expect(fixture.loadSnapshot).toHaveBeenCalledWith(WORKSPACE, SNAPSHOT);
    expect((await documents.list()).documents[0]?.entryCount).toBe(1);
    await expect(
      documents.materialize({
        snapshotId: SNAPSHOT,
        includePrivate: false,
        mode: 'manual',
        groups: fullGroup(),
      }),
    ).rejects.toMatchObject({
      kind: 'conflict',
      code: 'split_structure_already_materialized',
    });
    expect(fixture.entries()).toHaveLength(1);
  });

  it('reconstructs manual range bodies and rejects incomplete source coverage before persistence', async () => {
    const fixture = createFixture();
    const documents = new DocumentUseCases(OWNER, fixture.dependencies);
    const incomplete = [
      {
        titlePath: 'Synthetic',
        fragments: [
          {
            fragmentId: FRAGMENT,
            startCodePoint: 1,
            endCodePoint: Array.from(SOURCE).length,
          },
        ],
      },
    ];
    await expect(
      documents.materialize({
        snapshotId: SNAPSHOT,
        includePrivate: false,
        mode: 'manual',
        groups: incomplete,
      }),
    ).rejects.toMatchObject({code: 'manual_split_invalid'});
    expect(fixture.materialize).not.toHaveBeenCalled();
    const result = await documents.materialize({
      snapshotId: SNAPSHOT,
      includePrivate: false,
      mode: 'manual',
      groups: fullGroup().map((group) => ({
        ...group,
        body: 'Untrusted replacement',
      })),
    });
    expect(result.entries[0]?.value).toMatchObject({
      body: SOURCE,
      splitRuleVersion: 'struinfo.entry-split.manual-range.v1',
      fragmentIds: [FRAGMENT],
      fragmentRanges: [
        {startCodePoint: 0, endCodePoint: Array.from(SOURCE).length},
      ],
    });
  });

  it('requires an explicit private view before any private Blob read or materialization', async () => {
    const fixture = createFixture(true);
    const documents = new DocumentUseCases(OWNER, fixture.dependencies);
    expect((await documents.list()).documents).toHaveLength(0);
    await expect(documents.read(SNAPSHOT)).rejects.toMatchObject({
      code: 'private_content_requires_opt_in',
    });
    await expect(
      documents.materialize({
        snapshotId: SNAPSHOT,
        includePrivate: false,
        mode: 'deterministic',
      }),
    ).rejects.toMatchObject({code: 'snapshot_not_found'});
    expect(fixture.readBlob).not.toHaveBeenCalled();
    expect(fixture.materialize).not.toHaveBeenCalled();
    expect((await documents.read(SNAPSHOT, true)).snapshot.isPrivate).toBe(
      true,
    );
  });

  it.each(['external_agent', 'automation'] as const)(
    'does not let %s invoke owner writes through a shared method',
    async (kind) => {
      const fixture = createFixture();
      const authority = ExecutionAuthority.delegate(
        WORKSPACE,
        {kind, id: 'synthetic-caller'},
        {operations: DELEGATED_READ_OPERATIONS},
      );
      await expect(
        new DocumentUseCases(authority, fixture.dependencies).materialize({
          snapshotId: SNAPSHOT,
          includePrivate: false,
          mode: 'deterministic',
        }),
      ).rejects.toMatchObject({
        kind: 'forbidden',
        code: 'operation_not_authorized',
      });
      await expect(
        new EntryUseCases(authority, fixture.dependencies).revise(RELATED, {
          expectedRevision: 1,
          includePrivate: false,
          annotation: annotation(),
        }),
      ).rejects.toMatchObject({code: 'operation_not_authorized'});
      await expect(
        new RelationUseCases(authority, fixture.dependencies).reviseEdge(
          RESOURCE,
          RELATED,
          EDIT,
        ),
      ).rejects.toMatchObject({code: 'operation_not_authorized'});
      await expect(
        new ProcessingUseCases(authority, fixture.dependencies).cancel(RUN, 1),
      ).rejects.toMatchObject({code: 'operation_not_authorized'});
      expect(fixture.loadSnapshot).not.toHaveBeenCalled();
      expect(fixture.loadEntries).not.toHaveBeenCalled();
      expect(fixture.materialize).not.toHaveBeenCalled();
      expect(fixture.revise).not.toHaveBeenCalled();
      expect(fixture.writeEdge).not.toHaveBeenCalled();
      expect(fixture.cancel).not.toHaveBeenCalled();
    },
  );

  it('rejects a private request without its independent grant before repository access', async () => {
    const fixture = createFixture(true);
    const authority = ExecutionAuthority.delegate(
      WORKSPACE,
      {kind: 'external_agent', id: 'synthetic-caller'},
      {operations: DELEGATED_READ_OPERATIONS},
    );
    await expect(
      new DocumentUseCases(authority, fixture.dependencies).read(
        SNAPSHOT,
        true,
      ),
    ).rejects.toMatchObject({code: 'private_access_not_authorized'});
    await expect(
      new EntryUseCases(authority, fixture.dependencies).search({
        includePrivate: true,
        limit: 10,
      }),
    ).rejects.toMatchObject({code: 'private_access_not_authorized'});
    await expect(
      new RelationUseCases(authority, fixture.dependencies).list(RELATED, true),
    ).rejects.toMatchObject({code: 'private_access_not_authorized'});
    await expect(
      new ProcessingUseCases(authority, fixture.dependencies).list(10, true),
    ).rejects.toMatchObject({code: 'private_access_not_authorized'});
    expect(fixture.loadSnapshot).not.toHaveBeenCalled();
    expect(fixture.loadEntries).not.toHaveBeenCalled();
    expect(fixture.loadRuns).not.toHaveBeenCalled();
  });

  it('preserves the separate private-document channel and per-call privacy opt-in for delegated reads', async () => {
    const fixture = createFixture(true);
    const authority = ExecutionAuthority.delegate(
      WORKSPACE,
      {kind: 'external_agent', id: 'synthetic-caller'},
      {operations: ['entries.search'], includePrivate: true},
    );
    const entries = new EntryUseCases(authority, fixture.dependencies);
    const publicResult = await entries.search({
      text: 'evidence',
      includePrivate: false,
      limit: 10,
    });
    expect(publicResult.totalCount).toBe(0);
    expect(publicResult.privateDocuments.totalCount).toBe(0);
    expect(fixture.readBlob).not.toHaveBeenCalled();
    const privateResult = await entries.search({
      text: 'evidence',
      includePrivate: true,
      limit: 10,
    });
    expect(privateResult.privateDocuments).toMatchObject({
      totalCount: 1,
      items: [{snapshot: {snapshotId: SNAPSHOT}, matchReasons: ['body']}],
    });
    expect(fixture.loadEntries).toHaveBeenLastCalledWith(WORKSPACE, true);
    expect(fixture.readBlob).toHaveBeenCalledTimes(1);
  });

  it.each(['semantic', 'hybrid'] as const)(
    'does not treat a read grant as permission for %s model calls',
    async (retrievalMode) => {
      const fixture = createFixture();
      const authority = ExecutionAuthority.delegate(
        WORKSPACE,
        {kind: 'external_agent', id: 'synthetic-caller'},
        {operations: ['entries.search']},
      );
      await expect(
        new EntryUseCases(authority, fixture.dependencies).search({
          text: 'Synthetic',
          includePrivate: false,
          limit: 10,
          retrievalMode,
        }),
      ).rejects.toMatchObject({code: 'operation_not_authorized'});
      expect(fixture.loadEntries).not.toHaveBeenCalled();
      expect(fixture.readBlob).not.toHaveBeenCalled();
    },
  );

  it('preserves manual origin, exact evidence and optimistic revision checks on direct entry writes', async () => {
    const fixture = createFixture();
    const created = await new DocumentUseCases(
      OWNER,
      fixture.dependencies,
    ).materialize({
      snapshotId: SNAPSHOT,
      includePrivate: false,
      mode: 'deterministic',
    });
    const current = created.entries[0];
    if (current === undefined) throw new Error('Synthetic Entry missing.');
    const entries = new EntryUseCases(OWNER, fixture.dependencies);
    const result = await entries.revise(current.entryId, {
      expectedRevision: 1,
      includePrivate: false,
      annotation: annotation(),
    });
    expect(result).toMatchObject({
      status: 'applied',
      entry: {
        revision: 2,
        value: {
          fragmentIds: current.value.fragmentIds,
          titlePath: current.value.titlePath,
          body: SOURCE,
          usefulnessScore: 4,
          interestScore: 2,
          contentKeywords: [{displayValue: 'Synthetic', origin: 'manual'}],
        },
      },
    });
    await expect(
      entries.revise(current.entryId, {
        expectedRevision: 1,
        includePrivate: false,
        annotation: {...annotation(), body: 'Stale change'},
      }),
    ).rejects.toMatchObject({code: 'stale_entry_revision'});
    expect(fixture.entries()[0]?.revision).toBe(2);
    expect(fixture.entries()[0]?.value.body).toBe(SOURCE);
    expect(
      (
        await entries.search({
          text: 'Synthetic',
          includePrivate: false,
          limit: 10,
        })
      ).items[0]?.entry.revision,
    ).toBe(2);
  });

  it('binds source-checked graph edits to endpoint revisions and propagates a stale override', async () => {
    const fixture = createFixture();
    const created = await new DocumentUseCases(
      OWNER,
      fixture.dependencies,
    ).materialize({
      snapshotId: SNAPSHOT,
      includePrivate: false,
      mode: 'deterministic',
    });
    const first = created.entries[0];
    if (first === undefined) throw new Error('Synthetic Entry missing.');
    fixture.seed([first, {...first, entryId: RELATED}]);
    const relations = new RelationUseCases(OWNER, fixture.dependencies);
    await expect(
      relations.reviseEdge(first.entryId, RELATED, {
        ...EDIT,
        verificationStatus: 'source_checked',
      }),
    ).rejects.toMatchObject({kind: 'invalid_input'});
    expect(fixture.writeEdge).not.toHaveBeenCalled();
    const expectedEntryRevisions = {entryLowRevision: 1, entryHighRevision: 1};
    await expect(
      relations.reviseEdge(first.entryId, RELATED, {
        ...EDIT,
        verificationStatus: 'source_checked',
        expectedEntryRevisions,
      }),
    ).resolves.toMatchObject({status: 'applied'});
    expect(fixture.writeEdge.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: WORKSPACE,
      expectedRevision: 0,
      expectedEntryRevisions,
      value: {
        graph: {
          origin: 'user',
          verificationStatus: 'source_checked',
          reviewedRevisions: expectedEntryRevisions,
        },
      },
    });
    fixture.writeEdge.mockResolvedValueOnce('stale');
    await expect(
      relations.reviseEdge(first.entryId, RELATED, EDIT),
    ).rejects.toMatchObject({code: 'stale_association_override_revision'});
    const graph = await relations.readGraph({
      includePrivate: false,
      onlyPrivate: false,
      candidateLimit: 8,
      neighborLimit: 12,
      centerEntryId: first.entryId,
    });
    expect(graph.graph?.center.entryId).toBe(first.entryId);
  });

  it('filters private processing summaries and keeps cancellation version conflicts explicit', async () => {
    const fixture = createFixture();
    fixture.loadRuns.mockResolvedValue([
      processingRun(false),
      processingRun(true),
    ]);
    const authority = ExecutionAuthority.delegate(
      WORKSPACE,
      {kind: 'external_agent', id: 'synthetic-caller'},
      {operations: ['processing.read']},
    );
    expect(
      await new ProcessingUseCases(authority, fixture.dependencies).list(10),
    ).toHaveLength(1);
    const processing = new ProcessingUseCases(OWNER, fixture.dependencies);
    expect(await processing.list(10, true)).toHaveLength(2);
    fixture.cancel.mockResolvedValueOnce('stale');
    await expect(processing.cancel(RUN, 1)).rejects.toMatchObject({
      code: 'stale_processing_run_version',
    });
    fixture.cancel.mockResolvedValueOnce('terminal');
    await expect(processing.cancel(RUN, 1)).rejects.toMatchObject({
      code: 'processing_run_terminal',
    });
    fixture.cancel.mockResolvedValueOnce('applied');
    await expect(processing.cancel(RUN, 1)).resolves.toEqual({
      status: 'cancelled',
      runId: RUN,
      version: 2,
    });
    expect(fixture.cancel).toHaveBeenLastCalledWith(WORKSPACE, RUN, 1);
  });
});

function fullGroup() {
  return [
    {
      titlePath: 'Synthetic range',
      fragments: [
        {
          fragmentId: FRAGMENT,
          startCodePoint: 0,
          endCodePoint: Array.from(SOURCE).length,
        },
      ],
    },
  ];
}

function annotation() {
  return {
    body: SOURCE,
    contentKeywords: ['Synthetic'],
    typeKeyword: 'knowledge_explanation' as const,
    usefulnessScore: 4 as const,
    interestScore: 2 as const,
    domains: [{keyword: 'engineering_computing' as const}],
  };
}

function processingRun(isPrivate: boolean): Readonly<ProcessingRun> {
  return {
    workspaceId: WORKSPACE,
    runId: RUN,
    idempotencyKey: 'synthetic-run',
    origin: 'deterministic',
    status: 'queued',
    privacyScope: isPrivate ? 'include_private' : 'public_only',
    currentStage: 'split',
    currentStep: 'Synthetic step',
    completedUnits: 0,
    attempt: 1,
    version: 1,
    createdAt: '2040-01-02T03:04:05Z',
    updatedAt: '2040-01-02T03:04:05Z',
    proposals: [],
  };
}

function createFixture(isPrivate = false) {
  const bytes = new TextEncoder().encode(SOURCE);
  const snapshot: Readonly<EvidenceSnapshotReadState> = {
    workspaceId: WORKSPACE,
    snapshotId: SNAPSHOT,
    resourceId: RESOURCE,
    resourceKind: 'uploaded_file',
    sourceKey: 'synthetic:application',
    capturedAt: '2040-01-02T03:04:05Z',
    fragmentCount: 1,
    ...(isPrivate ? {isPrivate: true as const} : {}),
    rawSha256: SHA,
    canonicalContentSha256: SHA,
    canonicalizationVersion: 'synthetic.v1',
    structures: [
      {
        structureId: STRUCTURE,
        parserName: 'synthetic',
        parserVersion: 'synthetic.v1',
        textNormalizationVersion: 'synthetic.v1',
        structureSha256: SHA,
        textBlob: {
          algorithm: 'sha256',
          digest: SHA,
          byteLength: bytes.byteLength,
        },
        fragments: [
          {
            fragmentId: FRAGMENT,
            structureId: STRUCTURE,
            nodeId: FRAGMENT,
            nodeKind: 'section',
            codePointRange: {start: 0, end: Array.from(SOURCE).length},
            selectedTextSha256: SHA,
          },
        ],
      },
    ],
  };
  let rows: readonly Readonly<CurrentInformationEntry>[] = [];
  const loadSnapshot = vi.fn((_workspaceId: string, snapshotId: string) =>
    Promise.resolve(snapshotId === SNAPSHOT ? snapshot : undefined),
  );
  const readBlob = vi.fn(() => Promise.resolve(bytes));
  const loadEntries = vi.fn((_workspaceId: string, includePrivate: boolean) =>
    Promise.resolve(
      rows.filter((row) => includePrivate || !row.value.isPrivate),
    ),
  );
  const materialize = vi.fn<
    InformationEntryEmptySnapshotRepositoryPort['materializeEntriesIfSnapshotEmpty']
  >((entries) => {
    if (rows.length > 0)
      return Promise.resolve({outcome: 'snapshot_not_empty', createdCount: 0});
    rows = entries.map((row) => ({
      ...row,
      revision: 1,
      sourceKey: snapshot.sourceKey,
      capturedAt: snapshot.capturedAt,
    }));
    return Promise.resolve({outcome: 'created', createdCount: rows.length});
  });
  const revise = vi.fn<
    InformationEntryEmptySnapshotRepositoryPort['reviseEntry']
  >((write) => {
    const current = rows.find((row) => row.entryId === write.entryId);
    if (current === undefined) return Promise.resolve('not_found');
    if (current.revision !== write.expectedRevision)
      return Promise.resolve('stale');
    rows = rows.map((row) =>
      row.entryId === write.entryId
        ? {
            ...row,
            value: write.value,
            revisionId: write.revisionId,
            revision: row.revision + 1,
          }
        : row,
    );
    return Promise.resolve('applied');
  });
  const writeEdge = vi.fn<
    RelationUseCasesDependencies['informationEntryAssociationRepository']['writeAssociationOverride']
  >(() => Promise.resolve('applied'));
  const loadRuns = vi.fn<
    ProcessingUseCasesDependencies['processingRunRepository']['listRecentRuns']
  >(() => Promise.resolve([]));
  const cancel = vi.fn<
    ProcessingUseCasesDependencies['processingRunRepository']['cancelRun']
  >(() => Promise.resolve('not_found'));
  const dependencies: DocumentUseCasesDependencies &
    EntryUseCasesDependencies &
    RelationUseCasesDependencies &
    ProcessingUseCasesDependencies = {
    blobStore: {
      put: () => Promise.reject(new Error('Unexpected Blob write.')),
      read: readBlob,
    },
    evidenceReadRepository: {
      loadSnapshot,
      listSnapshots: () => Promise.resolve([snapshot]),
    },
    informationEntryRepository: {
      loadCurrentEntries: loadEntries,
      materializeEntriesIfSnapshotEmpty: materialize,
      reviseEntry: revise,
      materializeEntries: () =>
        Promise.reject(new Error('Expected atomic empty-snapshot write.')),
    },
    informationDocumentTagRepository: {
      loadCurrentDocumentTags: () => Promise.resolve([]),
      writeDocumentTags: () => Promise.resolve('stale'),
    },
    informationDocumentWorkingCopyRepository: {
      load: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      save: () => Promise.resolve({outcome: 'stale'}),
      restore: () => Promise.resolve('not_found'),
      commit: () => Promise.resolve({outcome: 'not_found'}),
    },
    informationEntryAssociationRepository: {
      loadAssociationSnapshot: () =>
        Promise.resolve({projections: [], overrides: []}),
      replaceAssociationProjections: () => Promise.resolve(0),
      writeAssociationOverride: writeEdge,
    },
    reviewPreferences: {
      load: (workspaceId) =>
        Promise.resolve({
          format: 'struinfo.review-preferences',
          version: 1,
          workspaceId,
          quickTags: [],
        }),
      save: () => Promise.reject(new Error('Unexpected preference write.')),
    },
    processingRunRepository: {
      listRecentRuns: loadRuns,
      cancelRun: cancel,
      createRun: () => Promise.resolve('not_found'),
      writeProgress: () => Promise.resolve('not_found'),
      appendProposal: () => Promise.resolve('not_found'),
    },
  };
  return {
    dependencies,
    loadSnapshot,
    readBlob,
    loadEntries,
    materialize,
    revise,
    writeEdge,
    loadRuns,
    cancel,
    entries: () => rows,
    seed: (next: readonly Readonly<CurrentInformationEntry>[]) => {
      rows = next;
    },
  };
}
