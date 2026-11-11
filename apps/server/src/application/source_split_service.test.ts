import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {SourceSplitService} from './source_split_service.js';
import {ExecutionAuthority} from './execution_authority.js';
import {LocalReviewPreferencesStore} from '../platform/storage/local_review_preferences_store.js';
import {patchReviewPreferences} from '../storage/review_preferences_store.js';
import {
  PERSONAL_DATA_BUNDLE_CODEC,
  PERSONAL_DATA_BUNDLE_SCHEMA,
} from '../workspace_transfer/personal_data_bundle.js';
import type {
  SourceSplitCatalog,
  SourceSplitDefinition,
  SourceSplitSettings,
} from '../modules/entries/source_split_recipe.js';
import type {EvidenceSnapshotReadState} from '../modules/evidence/index.js';
import type {CurrentInformationEntry} from '../modules/entries/index.js';
import type {IntakeRecord} from './document_intake_contract.js';
import type {JsonValue} from '../serialization/canonical_json.js';
import {requireOperationValue} from './operation_error.js';
import {
  DEFAULT_SOURCE_SPLIT_ROUTING,
  type SourceSplitRouting,
} from '../modules/subscriptions/source_processing_profile.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, {recursive: true, force: true});
});
const settings: SourceSplitSettings = {
  template: 'numbered',
  headingLevel: 2,
  titleIncludes: [],
  appendixHeadings: ['References'],
  minimumEntries: 2,
  maximumEntries: 4,
  minimumBodyCharacters: 10,
  onMismatch: 'review',
};
const body =
  '# Synthetic weekly😀\n\nPreface is preserved.\n\n## 1. Alpha\n\nSynthetic complete alpha explanation.\n\n## 2. Beta\n\nSynthetic independent beta explanation.\n\n## References\n\nReference attached to the final article.\n';
function fixture() {
  const w = randomUUID(),
    sourceId = randomUUID();
  const root = mkdtempSync(join(tmpdir(), 'struinfo-p3-'));
  roots.push(root);
  const preferences = new LocalReviewPreferencesStore(root);
  const snapshots = new Map<string, EvidenceSnapshotReadState>();
  const blobs = new Map<string, Uint8Array>();
  const records = new Map<string, IntakeRecord>();
  const entries: CurrentInformationEntry[] = [];
  const add = (text = body, isPrivate = false) => {
    const id = randomUUID(),
      structureId = randomUUID();
    const bytes = new TextEncoder().encode(text),
      hash = createHash('sha256').update(bytes).digest('hex');
    blobs.set(hash, bytes);
    snapshots.set(id, {
      snapshotId: id,
      resourceId: randomUUID(),
      workspaceId: w,
      resourceKind: 'manual_text',
      sourceKey: 'synthetic-p3',
      capturedAt: '2026-10-24T00:00:00.000Z',
      fragmentCount: 2,
      rawSha256: hash,
      canonicalContentSha256: hash,
      canonicalizationVersion: 'synthetic-v1',
      ...(isPrivate ? {isPrivate: true} : {}),
      structures: [
        {
          structureId,
          parserName: 'synthetic',
          parserVersion: '1',
          structureSha256: hash,
          textNormalizationVersion: 'synthetic-v1',
          textBlob: {
            algorithm: 'sha256',
            digest: hash,
            byteLength: bytes.length,
          },
          fragments: ['document', 'section'].map((nodeKind) => ({
            fragmentId: randomUUID(),
            structureId,
            nodeId: randomUUID(),
            nodeKind: nodeKind as 'document' | 'section',
            selectedTextSha256: hash,
            codePointRange: {start: 0, end: Array.from(text).length},
          })),
        },
      ],
    });
    records.set(id, {
      snapshotId: id,
      version: 1,
      updatedAt: '2026-10-24T00:00:00.000Z',
      value: {
        decision: 'admitted',
        origin: 'manual',
        reason: '',
        preparation: 'received',
        receipt: 'accepted',
        captureOrigin: {kind: 'subscription', subscriptionId: sourceId},
      },
    });
    return id;
  };
  const stage = vi.fn(() => Promise.resolve());
  const checkModelCall = vi.fn(() => Promise.resolve());
  const workingCopyPending = vi.fn(() => Promise.resolve(false));
  const provider = {
    suggestSplitRecipe: vi.fn(() =>
      Promise.resolve({
        name: 'Synthetic draft',
        explanation: '合成建议，需核对。',
        settings,
      }),
    ),
  };
  type Deps = ConstructorParameters<typeof SourceSplitService>[0];
  const deps: Deps = {
    workspaceId: w,
    preferences,
    stage,
    checkModelCall,
    workingCopyPending,
    provider,
    evidence: {
      loadSnapshot: (_w, id) => Promise.resolve(snapshots.get(id)),
      listSnapshots: () => Promise.resolve([...snapshots.values()]),
    },
    blobStore: {
      put: vi.fn(),
      read: (id) => {
        const b = blobs.get(id.digest);
        if (!b) throw new Error('Missing synthetic blob');
        return Promise.resolve(b);
      },
    },
    intake: {
      list: () => Promise.resolve([...records.values()]),
      read: (id) => Promise.resolve(records.get(id)),
      save: vi.fn(),
      withLock: async (_id, action) => action(),
    },
    entries: {
      loadCurrentEntries: () => Promise.resolve(entries),
      materializeEntries: vi.fn(),
      reviseEntry: vi.fn(),
      materializeEntriesIfSnapshotEmpty: vi.fn<
        Deps['entries']['materializeEntriesIfSnapshotEmpty']
      >((rows) => {
        entries.push(
          ...rows.map((r) => ({
            ...r,
            revision: 1,
            sourceKey: 'synthetic-p3',
            capturedAt: '2026-10-24T00:00:00.000Z',
          })),
        );
        return Promise.resolve({outcome: 'created', createdCount: rows.length});
      }),
    },
  };
  const service = new SourceSplitService(deps),
    owner = ExecutionAuthority.owner(w);
  const first = add(),
    second = add(body.replace('Alpha', 'Gamma'));
  const definition: SourceSplitDefinition = {
    recipeId: randomUUID(),
    revision: 1,
    name: 'Synthetic weekly',
    origin: 'manual',
    scope: {kind: 'source', sourceId},
    settings,
  };
  const catalog = async () =>
    (await preferences.load(w)).sourceSplitRecipes as SourceSplitCatalog;
  const command = async (
    name: string,
    input: Record<string, unknown> = {},
    snapshotId = first,
  ) =>
    service.execute(owner, name, {
      snapshotId,
      expectedRevision: (await catalog()).revision,
      ...input,
    });
  const save = () => command('split_recipe_save', {definition});
  const trial = (
    snapshotId = first,
    sampleKind = 'typical',
    expected = 'ready',
  ) =>
    command(
      'split_recipe_trial',
      {recipeId: definition.recipeId, sampleKind, expected},
      snapshotId,
    );
  const enable = () =>
    command('split_recipe_control', {
      recipeId: definition.recipeId,
      action: 'enable',
      note: '已核对两个样本的连续范围和附录归属。',
    });
  return {
    w,
    root,
    first,
    second,
    add,
    definition,
    owner,
    deps,
    service,
    preferences,
    snapshots,
    records,
    entries,
    stage,
    checkModelCall,
    workingCopyPending,
    provider,
    command,
    catalog,
    save,
    trial,
    enable,
  };
}
async function configureSource(
  f: ReturnType<typeof fixture>,
  overrides: Partial<SourceSplitRouting> = {},
) {
  const sourceId =
    f.definition.scope.kind === 'source' ? f.definition.scope.sourceId : '';
  await f.preferences.update(f.w, (current) => ({
    next: patchReviewPreferences(current, {
      sourceSubscriptions: {
        revision: 1,
        subscriptions: [
          {
            subscriptionId: sourceId,
            kind: 'rss_atom',
            label: 'Synthetic source',
            feedUrl: 'https://example.invalid/feed',
            sourceAlias: 'synthetic',
            enabled: false,
            isPrivate: false,
            intervalMinutes: 1440,
            itemLimit: 20,
            processingProfile: {
              split: 'Keep context when AI is needed.',
              tags: '',
              relations: '',
              accent: '#c4b08b',
              splitRouting: {...DEFAULT_SOURCE_SPLIT_ROUTING, ...overrides},
            },
          },
        ],
      },
    }),
    result: undefined,
  }));
  return sourceId;
}

describe('source splitting lifecycle', () => {
  it('samples each observed format and keeps a holdout out of the model request', async () => {
    const f = fixture();
    const sourceId = await configureSource(f);
    const heldOut = f.add(body.replace('Alpha', 'Unique holdout'));
    f.add('# Separate guide\n\nA continuous guide without independent items.');
    const grouped = (await f.service.execute(f.owner, 'split_source_sample', {
      sourceId,
    })) as {groups: {format: string; samples: unknown[]; ready: boolean}[]};
    expect(
      grouped.groups.map((g) => [g.format, g.samples.length, g.ready]),
    ).toEqual(
      expect.arrayContaining([
        ['numbered:2', 3, true],
        ['whole:0', 1, false],
      ]),
    );
    const out = (await f.service.execute(f.owner, 'split_source_suggest', {
      sourceId,
      snapshotIds: [f.first, f.second, heldOut],
    })) as {
      definition: SourceSplitDefinition;
      results: {snapshotId: string; heldOut: boolean}[];
    };
    expect(out.results.at(-1)).toMatchObject({
      snapshotId: heldOut,
      heldOut: true,
    });
    expect(
      JSON.stringify(f.provider.suggestSplitRecipe.mock.calls),
    ).not.toContain('Unique holdout');
    expect(out.definition.match?.conditions).toHaveLength(4);
    expect((await f.catalog()).recipes).toEqual([]);
  });
  it('uses configurable trials, routes despite freeform guidance and flags sustained exceptions without revising thresholds', async () => {
    const f = fixture();
    const sourceId = await configureSource(f, {
      samplesPerFormat: 2,
      reviewWindow: 5,
      lowScoreRate: 0.6,
    });
    f.definition.settings = {...settings, onMismatch: 'ai'};
    await f.save();
    await f.trial();
    await f.trial(f.second, 'variant');
    await f.enable();
    const frozen = await f.service.freeze(f.first);
    expect(await f.service.decide(f.first, frozen)).toMatchObject({
      outcome: 'rule',
    });
    const revision = (await f.catalog()).revision;
    let last = '';
    for (let i = 0; i < 5; i++) {
      last = f.add(body.replace('## 2.', '## 9.'));
      expect(await f.service.decide(last, frozen)).toMatchObject({
        outcome: 'ai',
        reason: 'recipe_number_sequence_changed',
      });
    }
    await f.service.decide(last, frozen);
    const feedback = (await f.service.execute(f.owner, 'split_source_read', {
      sourceId,
    })) as {feedback: {needsReview: boolean; count: number; low: number}[]};
    expect(feedback.feedback).toEqual(
      expect.arrayContaining([
        expect.objectContaining({needsReview: true, count: 5, low: 5}),
      ]),
    );
    expect((await f.catalog()).revision).toBe(revision);
    expect((await f.catalog()).observations).toHaveLength(5);
    expect(JSON.stringify(await f.catalog())).not.toContain(
      'Synthetic complete alpha explanation',
    );
    expect(
      (await f.service.freeze(f.first)).processingProfile?.splitRouting
        ?.minimumScore,
    ).toBe(80);
    f.provider.suggestSplitRecipe.mockResolvedValueOnce({
      name: 'Heading revision',
      explanation: 'Use the independent headings after the sequence changes.',
      settings: {...settings, template: 'headings'},
    });
    const revisionDraft = (await f.service.execute(
      f.owner,
      'split_source_calibrate',
      {
        sourceId,
        format: 'numbered:2',
        recipeId: f.definition.recipeId,
        expectedRevision: revision,
      },
    )) as {
      revision: number;
      replaces: string;
      definition: SourceSplitDefinition;
      results: {snapshotId: string}[];
    };
    expect(revisionDraft.replaces).toBe(f.definition.recipeId);
    expect(
      (await f.service.freeze(last)).recipes.map((r) => r.recipeId),
    ).toEqual([f.definition.recipeId]);
    await f.service.execute(f.owner, 'split_recipe_control', {
      snapshotId: last,
      recipeId: revisionDraft.definition.recipeId,
      expectedRevision: revisionDraft.revision,
      action: 'enable',
      note: 'Compared revision with samples.',
    });
    expect(
      await f.service.decide(last, await f.service.freeze(last)),
    ).toMatchObject({
      outcome: 'rule',
      recipeId: revisionDraft.definition.recipeId,
    });
    expect(frozen.recipes[0]?.recipeId).toBe(f.definition.recipeId);
  });
  it('counts human reports on high scores once per document and verifies rule conversion against published ranges', async () => {
    const f = fixture(),
      sourceId = await configureSource(f, {
        samplesPerFormat: 2,
        reviewWindow: 5,
        lowScoreRate: 0.6,
      });
    await f.save();
    await f.trial();
    await f.trial(f.second, 'variant');
    await f.enable();
    const frozen = await f.service.freeze(f.first),
      ids = [f.first, f.second, f.add(), f.add(), f.add()];
    for (const id of ids) {
      const d = await f.service.decide(id, frozen);
      expect(d.score).toBe(100);
      await f.service.apply(id, f.definition);
      const original = requireOperationValue(f.records.get(id));
      f.records.set(id, {
        ...original,
        value: {
          ...original.value,
          publication: {
            origin: 'manual',
            confirmedAt: new Date().toISOString(),
            entries: f.entries
              .filter((e) => e.snapshotId === id)
              .map((e) => ({entryId: e.entryId, revision: e.revision})),
          },
        },
      });
    }
    const feedback = {
      sourceId,
      recipeId: f.definition.recipeId,
      recipeRevision: 1,
      quality: 'title',
    };
    for (const snapshotId of [ids[0], ids[1], ids[2], ids[2]])
      await f.service.execute(f.owner, 'split_source_feedback', {
        ...feedback,
        snapshotId,
      });
    const alerts = await f.service.execute(f.owner, 'split_source_status', {});
    expect(alerts).toMatchObject({
      sources: [{count: 5, low: 0, qualityIssues: 3, flagged: 3}],
    });
    const cal = {
      sourceId,
      recipeId: f.definition.recipeId,
      expectedRevision: (await f.catalog()).revision,
      format: 'numbered:2',
      ruleOnly: true,
    };
    await expect(
      f.service.execute(f.owner, 'split_source_calibrate', cal),
    ).resolves.toMatchObject({
      definition: {execution: 'rule', origin: 'verified_rule'},
    });
    expect(f.provider.suggestSplitRecipe).not.toHaveBeenCalled();
  });
  it('persists source guidance and freezes it independently of later configuration edits', async () => {
    const f = fixture();
    if (f.definition.scope.kind !== 'source')
      throw new Error('source fixture expected');
    const sourceId = f.definition.scope.sourceId;
    const profile = {
      split: 'Keep each tutorial complete.',
      tags: 'Identify its tool and use.',
      relations: 'Require shared mechanisms.',
      accent: '#bfa070',
    };
    const saveProfile = async (value: typeof profile) =>
      f.preferences.update(f.w, (current) => ({
        next: patchReviewPreferences(current, {
          sourceSubscriptions: {
            revision: (current.sourceSubscriptions?.revision ?? 0) + 1,
            subscriptions: [
              {
                subscriptionId: sourceId,
                kind: 'rss_atom',
                label: 'Synthetic',
                feedUrl: 'https://example.invalid/feed',
                sourceAlias: 'fixture',
                enabled: false,
                isPrivate: false,
                intervalMinutes: 1440,
                itemLimit: 20,
                processingProfile: value,
              },
            ],
          },
        }),
        result: undefined,
      }));
    await saveProfile(profile);
    const frozen = await f.service.freeze(f.first);
    expect(frozen.processingProfile).toEqual(profile);
    await saveProfile({...profile, split: 'A later source revision.'});
    expect(frozen.processingProfile?.split).toBe(profile.split);
    expect((await f.service.freeze(f.first)).processingProfile?.split).toBe(
      'A later source revision.',
    );
    expect(await f.service.decide(f.first, frozen)).toMatchObject({
      outcome: 'ai',
      reason: 'recipe_not_configured',
    });
    const reopened = await new LocalReviewPreferencesStore(f.root).load(f.w);
    expect(
      reopened.sourceSubscriptions?.subscriptions[0]?.processingProfile?.tags,
    ).toBe(profile.tags);
    const bundle = {
      schemaVersion: PERSONAL_DATA_BUNDLE_SCHEMA,
      blobs: [],
      reviewPreferences: reopened,
    };
    expect(
      PERSONAL_DATA_BUNDLE_CODEC.decode(
        PERSONAL_DATA_BUNDLE_CODEC.encode(bundle) as JsonValue,
      ),
    ).toEqual(bundle);
  });

  it('requires several checked samples, retains frozen versions and replaces only after explicit enablement', async () => {
    const f = fixture();
    await f.save();
    await f.trial();
    await expect(f.enable()).rejects.toMatchObject({
      code: 'recipe_trials_required',
    });
    await f.trial(f.second, 'variant');
    await f.trial(f.add(body.replace('Alpha', 'Delta')));
    await f.enable();
    const frozen = await f.service.freeze(f.first);
    expect(frozen.recipes).toEqual([f.definition]);
    await expect(
      f.command('split_recipe_save', {
        definition: {...f.definition, revision: 2},
      }),
    ).rejects.toMatchObject({code: 'recipe_copy_required'});
    await f.command('split_recipe_control', {
      recipeId: f.definition.recipeId,
      action: 'pause',
      note: '',
    });
    expect((await f.service.freeze(f.first)).recipes).toEqual([]);
    expect(await f.service.decide(f.first, frozen)).toMatchObject({
      outcome: 'rule',
      recipeId: f.definition.recipeId,
    });
    const replacement = {
      ...f.definition,
      recipeId: randomUUID(),
      name: 'Replacement',
    };
    await f.command('split_recipe_save', {
      definition: replacement,
      replaces: f.definition.recipeId,
    });
    expect((await f.catalog()).recipes[0]?.status).toBe('paused');
    for (const snapshotId of [f.first, f.second, f.add()])
      await f.command(
        'split_recipe_trial',
        {
          recipeId: replacement.recipeId,
          sampleKind: 'variant',
          expected: 'ready',
        },
        snapshotId,
      );
    await f.command('split_recipe_control', {
      recipeId: replacement.recipeId,
      action: 'enable',
      note: 'Replacement checked.',
    });
    expect((await f.catalog()).recipes.map((r) => r.status)).toEqual([
      'replaced',
      'enabled',
    ]);
    expect((await f.service.freeze(f.first)).recipes[0]?.recipeId).toBe(
      replacement.recipeId,
    );
  });
  it('keeps preview read-only, applies exact ranges once, and protects manual changes and receipt decisions', async () => {
    const f = fixture();
    const preview = await f.service.execute(f.owner, 'split_recipe_preview', {
      snapshotId: f.first,
      definition: f.definition,
    });
    expect(preview).toMatchObject({outcome: 'ready', completeCoverage: true});
    expect(f.entries).toEqual([]);
    const prepared = await f.service.apply(f.first, f.definition);
    expect(prepared.rows.map((r) => r.value.body).join('')).toBe(body);
    expect(
      prepared.rows.every((r) => r.value.fragmentRanges?.length === 1),
    ).toBe(true);
    expect(f.stage).not.toHaveBeenCalled();
    await f.service.apply(f.first, f.definition); // Recovery after a write but before saving task progress.
    expect(f.entries).toHaveLength(2);
    f.entries[0] = {...requireOperationValue(f.entries[0]), revision: 2};
    await expect(f.service.apply(f.first, f.definition)).rejects.toMatchObject({
      code: 'document_structure_changed',
    });
    f.workingCopyPending.mockResolvedValue(true);
    await expect(f.service.apply(f.second, f.definition)).rejects.toMatchObject(
      {code: 'document_working_copy_pending'},
    );
    f.workingCopyPending.mockResolvedValue(false);
    const record = requireOperationValue(f.records.get(f.second));
    f.records.set(f.second, {
      ...record,
      value: {...record.value, receipt: 'rejected'},
    });
    await expect(f.service.apply(f.second, f.definition)).rejects.toMatchObject(
      {code: 'recipe_receipt_not_accepted'},
    );
  });
  it('checks the remaining task budget before writing and stages manual public applications even with private visibility selected', async () => {
    const f = fixture();
    await expect(
      f.service.apply(f.first, f.definition, false, true, () => {
        throw new Error('budget');
      }),
    ).rejects.toThrow('budget');
    expect(f.entries).toEqual([]);
    await f.service.apply(f.first, f.definition, true, false);
    expect(f.stage).toHaveBeenCalledWith(f.first);
  });
  it('inherits source rules for the selected full-text capture but never applies to a superseded body', async () => {
    const f = fixture();
    await f.save();
    await f.trial();
    await f.trial(f.second, 'variant');
    await f.trial(f.add());
    await f.enable();
    const original = requireOperationValue(f.records.get(f.first));
    f.records.delete(f.second);
    f.records.set(f.first, {
      ...original,
      value: {
        ...original.value,
        preparedSnapshotId: f.second,
        preparation: 'web_article',
      },
    });
    expect((await f.service.freeze(f.second)).recipes[0]?.recipeId).toBe(
      f.definition.recipeId,
    );
    await expect(f.service.apply(f.first, f.definition)).rejects.toMatchObject({
      code: 'intake_body_not_selected',
    });
    await f.service.apply(f.second, f.definition);
    expect(f.entries.every((entry) => entry.snapshotId === f.second)).toBe(
      true,
    );
  });
  it('keeps AI suggestions editable, enforces dispatch and rejects private model transfer', async () => {
    const f = fixture();
    await expect(
      f.service.execute(f.owner, 'split_recipe_suggest', {snapshotId: f.first}),
    ).resolves.toMatchObject({preview: {outcome: 'ready'}});
    expect((await f.catalog()).recipes).toEqual([]);
    f.checkModelCall.mockRejectedValueOnce(new Error('price gate'));
    await expect(
      f.service.execute(f.owner, 'split_recipe_suggest', {snapshotId: f.first}),
    ).rejects.toThrow('price gate');
    const privateId = f.add(body, true);
    await expect(
      f.service.execute(f.owner, 'split_recipe_suggest', {
        snapshotId: privateId,
        includePrivate: true,
      }),
    ).rejects.toMatchObject({code: 'private_model_transfer_forbidden'});
    expect(f.provider.suggestSplitRecipe).toHaveBeenCalledOnce();
  });
  it('uses existing read/write grants, optimistic catalog revisions and filters private trial evidence', async () => {
    const f = fixture();
    const reader = ExecutionAuthority.agent(f.w, 'reader', ['documents.read']);
    await f.save();
    await f.trial();
    await f.trial(f.second, 'variant');
    await f.trial(f.add());
    await f.enable();
    await expect(
      f.service.execute(reader, 'split_recipe_apply', {
        snapshotId: f.first,
        recipeId: f.definition.recipeId,
        expectedRevision: (await f.catalog()).revision,
      }),
    ).rejects.toMatchObject({code: 'operation_not_authorized'});
    await expect(
      f.service.execute(reader, 'split_recipe_control', {
        snapshotId: f.first,
        recipeId: f.definition.recipeId,
        expectedRevision: (await f.catalog()).revision,
        action: 'pause',
        note: '',
      }),
    ).rejects.toMatchObject({code: 'recipe_owner_required'});
    await expect(
      f.service.execute(f.owner, 'split_recipe_control', {
        snapshotId: f.first,
        recipeId: f.definition.recipeId,
        expectedRevision: 0,
        action: 'pause',
        note: '',
      }),
    ).rejects.toMatchObject({code: 'stale_split_recipes'});
    const privateId = f.add(body, true);
    await f.command(
      'split_recipe_trial',
      {
        recipeId: f.definition.recipeId,
        sampleKind: 'variant',
        expected: 'ready',
        includePrivate: true,
      },
      privateId,
    );
    const view = (await f.service.execute(reader, 'split_recipes_read', {
      snapshotId: f.first,
    })) as SourceSplitCatalog;
    expect(view.recipes[0]?.trials).toHaveLength(3);
    expect(JSON.stringify(view)).not.toContain(privateId);
  });
  it('persists recipes through sibling preference updates, reopening and personal backup round trips', async () => {
    const f = fixture();
    await f.save();
    await f.trial();
    await f.preferences.update(f.w, (current) => ({
      next: patchReviewPreferences(current, {quickTags: ['Synthetic']}),
      result: undefined,
    }));
    const reopened = await new LocalReviewPreferencesStore(f.root).load(f.w);
    expect(reopened.sourceSplitRecipes).toEqual(await f.catalog());
    const bundle = {
      schemaVersion: PERSONAL_DATA_BUNDLE_SCHEMA,
      blobs: [],
      reviewPreferences: reopened,
    };
    expect(
      PERSONAL_DATA_BUNDLE_CODEC.decode(
        PERSONAL_DATA_BUNDLE_CODEC.encode(bundle) as JsonValue,
      ),
    ).toEqual(bundle);
  });
});
