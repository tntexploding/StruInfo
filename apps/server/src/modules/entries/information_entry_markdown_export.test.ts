import {createHash} from 'node:crypto';
import {describe, expect, it, vi} from 'vitest';
import type {CurrentInformationEntry} from './information_entry_contract.js';
import type {EvidenceSnapshotReadState} from '../evidence/evidence_read_repository.js';
import type {
  EntryMarkdownExportRead,
  EntryMarkdownExportRepositoryPort,
  EntryMarkdownExportRequest,
  EntryMarkdownFileStore,
} from './information_entry_markdown_export.js';
import {decodeEntryMarkdownExportRequest} from './information_entry_markdown_export.js';
import {EntryMarkdownExportService} from './information_entry_markdown_export_service.js';
import {buildInformationEntryAssociationProjection} from './information_entry_association.js';

const uuid = (n: number) =>
  '10000000-0000-4000-8000-' + n.toString().padStart(12, '0');
const workspaceId = uuid(1);
const sourceText = '前言\n甲🙂乙丙末';
const fragmentText = '甲🙂乙丙末';
const digest = (text: string) =>
  createHash('sha256').update(text).digest('hex');
function entry(id = 20): CurrentInformationEntry {
  const body = '合成编辑正文，不是来源原文。';
  return {
    workspaceId,
    entryId: uuid(id),
    revision: 2,
    revisionId: uuid(id + 100),
    resourceId: uuid(2),
    snapshotId: uuid(3),
    sourceKey: 'synthetic:export',
    canonicalUri: 'https://example.invalid/synthetic',
    capturedAt: '2040-01-02T00:00:00.000Z',
    value: {
      documentOrder: id - 20,
      titlePath: '合成条目 ' + id.toString(),
      body,
      bodySha256: digest(body),
      chunkMode: 'split',
      splitRuleVersion: 'synthetic.range.v1',
      isPrivate: false,
      contentKeywords: [],
      domains: [],
      fragmentIds: [uuid(4)],
      fragmentRanges: [{startCodePoint: 1, endCodePoint: 4}],
    },
  };
}
function snapshot(): EvidenceSnapshotReadState {
  return {
    workspaceId,
    resourceId: uuid(2),
    snapshotId: uuid(3),
    resourceKind: 'manual_text',
    sourceKey: 'synthetic:export',
    capturedAt: '2040-01-02T00:00:00.000Z',
    fragmentCount: 1,
    rawSha256: digest(sourceText),
    canonicalContentSha256: digest(sourceText),
    canonicalizationVersion: 'synthetic.v1',
    structures: [
      {
        structureId: uuid(5),
        parserName: 'synthetic',
        parserVersion: '1',
        textNormalizationVersion: 'synthetic.v1',
        structureSha256: digest(sourceText),
        textBlob: {
          algorithm: 'sha256',
          digest: digest(sourceText),
          byteLength: Buffer.byteLength(sourceText),
        },
        fragments: [
          {
            fragmentId: uuid(4),
            structureId: uuid(5),
            nodeId: uuid(6),
            nodeKind: 'section',
            codePointRange: {start: 3, end: 8},
            selectedTextSha256: digest(fragmentText),
          },
        ],
      },
    ],
  };
}
function harness() {
  let state: EntryMarkdownExportRead = {
    entries: [entry(), entry(21)],
    snapshots: [snapshot()],
    associations: {projections: [], overrides: []},
  };
  const read = vi.fn(() =>
    Promise.resolve(new TextEncoder().encode(sourceText)),
  );
  const write = vi.fn<EntryMarkdownFileStore['write']>((_workspaceId, bytes) =>
    Promise.resolve({
      fileName: 'synthetic.entries.md',
      byteLength: bytes.byteLength,
    }),
  );
  const repository: EntryMarkdownExportRepositoryPort = {
    withSelection: <Result>(
      _id: string,
      _request: Readonly<EntryMarkdownExportRequest>,
      work: (selection: Readonly<EntryMarkdownExportRead>) => Promise<Result>,
    ) => work(state),
  };
  return {
    get state() {
      return state;
    },
    set state(value: EntryMarkdownExportRead) {
      state = value;
    },
    read,
    write,
    service: new EntryMarkdownExportService({
      workspaceId,
      repository,
      blobStore: {read, put: () => Promise.reject(new Error('No Blob write'))},
      files: {write},
    }),
    request: {
      title: '合成资料清单',
      privacyScope: 'public',
      entries: [entry(21), entry()].map(({entryId, revision, revisionId}) => ({
        entryId,
        revision,
        revisionId,
      })),
    } as const,
  };
}

describe('cited Entry Markdown export', () => {
  it('accepts only an explicit bounded unique version selection and a closed preview/generation request', () => {
    const {request} = harness();
    expect(decodeEntryMarkdownExportRequest(request, false)).toEqual(request);
    for (const input of [
      {...request, entries: []},
      {...request, entries: Array.from({length: 21}, () => request.entries[0])},
      {...request, entries: [request.entries[0], request.entries[0]]},
      {...request, title: '🙂'.repeat(121)},
      {...request, title: 'line\nbreak'},
      {...request, privacyScope: 'all'},
      {...request, privacyScope: {toString: null}},
      {...request, privacyScope: ['public']},
      {...request, markdown: 'client text'},
      {...request, path: '../outside.md'},
      {...request, expectedSha256: 'a'.repeat(64)},
      {...request, entries: [{...request.entries[0], revision: 0}]},
      {...request, entries: [{...request.entries[0], revisionId: 'invalid'}]},
    ])
      expect(decodeEntryMarkdownExportRequest(input, false)).toBeUndefined();
    expect(decodeEntryMarkdownExportRequest(request, true)).toBeUndefined();
    expect(
      decodeEntryMarkdownExportRequest(
        {...request, expectedSha256: 'a'.repeat(64)},
        true,
      ),
    ).toBeDefined();
  });

  it('preserves selection order, exact scalar-range sources and unknown publication, and writes exactly previewed bytes', async () => {
    const h = harness();
    const original = structuredClone(h.state);
    const result = await h.service.preview(h.request);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected preview');
    const {preview} = result;
    expect(preview.entries.map((item) => item.entryId)).toEqual(
      h.request.entries.map((item) => item.entryId),
    );
    expect(preview.markdown.indexOf('## 1. 合成条目 21')).toBeLessThan(
      preview.markdown.indexOf('## 2. 合成条目 20'),
    );
    expect(preview.markdown).toContain('版本 2 · revisionId ' + uuid(121));
    expect(preview.markdown).toContain('合成编辑正文，不是来源原文。');
    expect(preview.markdown).toContain('🙂乙丙');
    expect(preview.markdown).not.toContain('甲🙂乙丙末');
    expect(preview.markdown).toContain('Fragment 内 Unicode 范围：[1, 4)');
    expect(preview.markdown).toContain('结构全文 Unicode 范围：[4, 7)');
    expect(preview.markdown).toContain('发布时间：未提供');
    expect(preview.markdown).toContain(digest(fragmentText));
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.write).not.toHaveBeenCalled();
    const exported = await h.service.generate({
      ...h.request,
      expectedSha256: preview.sha256,
    });
    expect(exported.status).toBe('exported');
    expect(new TextDecoder().decode(h.write.mock.calls[0]?.[1])).toBe(
      preview.markdown,
    );
    expect(h.state).toEqual(original);
  });

  it('rejects stale, missing, other-workspace and private selections before reading any Blob or writing a file', async () => {
    for (const kind of [
      'stale',
      'revisionId',
      'missing',
      'workspace',
      'private',
      'snapshotPrivacy',
      'privateOnly',
    ] as const) {
      const h = harness();
      const original = h.state.entries[0];
      if (original === undefined) throw new Error('fixture');
      if (kind === 'missing') h.state = {...h.state, entries: [entry(21)]};
      else if (kind === 'snapshotPrivacy')
        h.state = {...h.state, snapshots: [{...snapshot(), isPrivate: true}]};
      else if (kind !== 'privateOnly')
        h.state = {
          ...h.state,
          entries: [
            {
              ...original,
              ...(kind === 'stale' ? {revision: 3} : {}),
              ...(kind === 'revisionId' ? {revisionId: uuid(500)} : {}),
              ...(kind === 'workspace' ? {workspaceId: uuid(99)} : {}),
              ...(kind === 'private'
                ? {value: {...original.value, isPrivate: true}}
                : {}),
            },
            entry(21),
          ],
        };
      const result = await h.service.preview({
        ...h.request,
        ...(kind === 'privateOnly' ? {privacyScope: 'private_only'} : {}),
      });
      expect(result).toEqual({
        status: 'rejected',
        issue: {
          code: ['stale', 'revisionId'].includes(kind)
            ? 'selection_stale'
            : 'selection_unavailable',
        },
      });
      expect(h.read).not.toHaveBeenCalled();
      expect(h.write).not.toHaveBeenCalled();
    }
  });

  it('rejects a newly private selection at generation before another Blob read', async () => {
    const h = harness();
    const preview = await h.service.preview(h.request);
    if (preview.status !== 'ready') throw new Error('Expected preview');
    h.state = {
      ...h.state,
      entries: h.state.entries.map((entry) => ({
        ...entry,
        value: {...entry.value, isPrivate: true},
      })),
    };
    h.read.mockClear();
    await expect(
      h.service.generate({
        ...h.request,
        expectedSha256: preview.preview.sha256,
      }),
    ).resolves.toEqual({
      status: 'rejected',
      issue: {code: 'selection_unavailable'},
    });
    expect(h.read).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
  });

  it('exports private entries only in explicit local scopes, with labels and no complete-document channel', async () => {
    const h = harness();
    h.state = {
      ...h.state,
      entries: h.state.entries.map((item) => ({
        ...item,
        value: {...item.value, isPrivate: true},
      })),
      snapshots: [{...snapshot(), isPrivate: true}],
    };
    for (const privacyScope of ['include_private', 'private_only']) {
      const result = await h.service.preview({...h.request, privacyScope});
      expect(result.status).toBe('ready');
      if (result.status !== 'ready')
        throw new Error('Expected private preview');
      expect(result.preview.entries.every((item) => item.isPrivate)).toBe(true);
      expect(result.preview.markdown).toContain('隐私资料');
      expect(result.preview.markdown).not.toContain('前言');
    }
  });

  it('uses visible selected-pair relationships with AI origin and effective review state, rejecting changed preview content', async () => {
    const h = harness();
    h.state = {
      ...h.state,
      associations: {
        projections: [],
        overrides: [
          {
            workspaceId,
            entryLowId: uuid(20),
            entryHighId: uuid(21),
            revision: 1,
            revisionId: uuid(201),
            value: {
              action: 'restore',
              manualAdjustment: 0,
              isBlocked: false,
              graph: {
                origin: 'ai',
                label: '合成关联',
                direction: 'high_to_low',
                semanticKind: 'related',
                verificationStatus: 'source_checked',
                note: '合成维护说明',
              },
            },
          },
        ],
      },
    };
    const preview = await h.service.preview(h.request);
    if (preview.status !== 'ready') throw new Error('Expected relationship');
    expect(preview.preview.relationCount).toBe(1);
    expect(preview.preview.markdown).toContain('AI 辅助关系');
    expect(preview.preview.markdown).toContain('后者指向前者');
    expect(preview.preview.markdown).toContain('### 条目 2 ← 条目 1');
    expect(preview.preview.markdown).toContain('需复核（历史记录未绑定版本）');
    expect(preview.preview.markdown).toContain('合成维护说明');
    h.state = {...h.state, associations: {projections: [], overrides: []}};
    await expect(
      h.service.generate({
        ...h.request,
        expectedSha256: preview.preview.sha256,
      }),
    ).resolves.toEqual({status: 'rejected', issue: {code: 'preview_stale'}});
    expect(h.write).not.toHaveBeenCalled();
  });

  it('excludes off-selection, blocked and stale projections without inventing a relationship', async () => {
    const h = harness();
    const all = [entry(), entry(21), entry(22)].map((item) => ({
      ...item,
      value: {...item.value, body: '合成共享关键词'},
    }));
    const projections = buildInformationEntryAssociationProjection(all);
    expect(projections.length).toBeGreaterThan(0);
    h.state = {
      ...h.state,
      entries: all,
      associations: {
        projections,
        overrides: [
          {
            workspaceId,
            entryLowId: uuid(20),
            entryHighId: uuid(21),
            revision: 1,
            revisionId: uuid(201),
            value: {action: 'block', manualAdjustment: 0, isBlocked: true},
          },
        ],
      },
    };
    const result = await h.service.preview(h.request);
    if (result.status !== 'ready') throw new Error('Expected preview');
    expect(result.preview.relationCount).toBe(0);
    expect(result.preview.markdown).not.toContain('合成条目 22');
    h.state = {
      ...h.state,
      associations: {
        projections: projections.map((projection) => ({
          ...projection,
          entryLowRevision: 1,
        })),
        overrides: [],
      },
    };
    const stale = await h.service.preview(h.request);
    expect(stale.status === 'ready' && stale.preview.relationCount).toBe(0);
  });

  it('fails visibly on broken evidence or file storage without changing domain state', async () => {
    const h = harness();
    h.read.mockResolvedValueOnce(new TextEncoder().encode('broken'));
    await expect(h.service.preview(h.request)).resolves.toEqual({
      status: 'rejected',
      issue: {code: 'evidence_unavailable'},
    });
    expect(h.write).not.toHaveBeenCalled();
    const preview = await h.service.preview(h.request);
    if (preview.status !== 'ready') throw new Error('Expected preview');
    h.write.mockRejectedValueOnce(
      new Error('external path secret must not escape'),
    );
    await expect(
      h.service.generate({
        ...h.request,
        expectedSha256: preview.preview.sha256,
      }),
    ).resolves.toEqual({
      status: 'rejected',
      issue: {code: 'export_storage_unavailable'},
    });
  });

  it('keeps Markdown/HTML inert and truncates entry text on Unicode scalar boundaries', async () => {
    const h = harness();
    h.state = {
      ...h.state,
      entries: h.state.entries.map((item) => ({
        ...item,
        canonicalUri: 'javascript:alert(1)',
        value: {
          ...item.value,
          titlePath: '<img src=x> [title](javascript:x)',
          body:
            '```\n<script>unsafe</script>\n![image](https://example.invalid/x)\n' +
            '🙂'.repeat(1400),
        },
      })),
    };
    const result = await h.service.preview({
      ...h.request,
      title: '# [合成](javascript:x)',
    });
    if (result.status !== 'ready') throw new Error('Expected preview');
    expect(result.preview.markdown).toContain('&lt;img src=x&gt;');
    expect(result.preview.markdown).toContain('````text\n```\n<script>');
    expect(result.preview.markdown).toContain('仅摘录前 1200 个 Unicode 字符');
    expect(result.preview.markdown).not.toContain('�');
    expect(result.preview.markdown).not.toContain('](javascript:');
  });
});
