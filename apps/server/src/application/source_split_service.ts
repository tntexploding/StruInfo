import {MAXIMUM_AI_SPLIT_ENTRIES} from '../modules/processing/ai_split_proposal.js';
import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import {DEFAULT_SOURCE_SPLIT_ROUTING} from '../modules/subscriptions/source_processing_profile.js';
import {
  inspectSourceStructure,
  learnSourceStructure,
  spreadSourceSamples,
} from '../modules/entries/source_split_structure.js';
import {
  EMPTY_SOURCE_SPLIT_CATALOG,
  SOURCE_SPLIT_ENGINE,
  SOURCE_RECIPE_SPLIT_VERSION,
  sourceSplitDefinitionSchema,
  sourceSplitSettingsSchema,
  sourceSplitTrialSchema,
  planSourceSplit,
  chooseSourceSplit,
  evaluateSourceSplit,
  type SourceSplitCatalog,
  type SourceSplitDefinition,
  type SourceSplitRecipe,
  type FrozenSourceSplit,
  type SourceSplitDecision,
} from '../modules/entries/source_split_recipe.js';
import {
  materializeEvidenceSnapshot,
  type EvidenceReadRepositoryPort,
} from '../modules/evidence/index.js';
import {
  prepareManualSplitInformationEntries,
  type InformationEntryEmptySnapshotRepositoryPort,
} from '../modules/entries/index.js';
import {
  patchReviewPreferences,
  updateReviewPreferences,
  type ReviewPreferencesStore,
} from '../storage/review_preferences_store.js';
import type {BlobStore} from '../storage/blob_store.js';
import {
  intakeSnapshotIds,
  intakeTargetSnapshot,
  type DocumentIntakeRepository,
  type IntakeRecordValue,
} from './document_intake_contract.js';
import type {ExecutionAuthority} from './execution_authority.js';
import {OperationError, requireOperationValue} from './operation_error.js';

const documentInput = {
  snapshotId: z.uuid(),
  includePrivate: z.boolean().default(false),
};
const versionInput = {
  recipeId: z.uuid(),
  expectedRevision: z.number().int().min(0),
};
const sourceInput = {
  sourceId: z.uuid(),
  includePrivate: z.boolean().default(false),
};
const qualityVerdict = z.enum(['good', 'boundary', 'context', 'title']);
export const splitRecipeReadSchemas = {
  split_recipes_read: z.object(documentInput).strict(),
  split_recipe_preview: z
    .object({...documentInput, definition: sourceSplitDefinitionSchema})
    .strict(),
  split_recipe_apply: z.object({...documentInput, ...versionInput}).strict(),
};
export const splitRecipeOwnerSchemas = {
  split_source_status: z
    .object({includePrivate: z.boolean().default(false)})
    .strict(),
  split_source_read: z.object(sourceInput).strict(),
  split_source_sample: z.object(sourceInput).strict(),
  split_source_feedback: z
    .object({
      ...sourceInput,
      snapshotId: z.uuid(),
      recipeId: z.uuid(),
      recipeRevision: z.number().int().positive(),
      quality: qualityVerdict,
    })
    .strict(),
  split_source_calibrate: z
    .object({
      ...sourceInput,
      format: z.string().min(1).max(40),
      expectedRevision: z.number().int().min(0),
      recipeId: z.uuid().optional(),
      ruleOnly: z.boolean().default(false),
    })
    .strict(),
  split_source_suggest: z
    .object({...sourceInput, snapshotIds: z.array(z.uuid()).min(2).max(12)})
    .strict(),
  split_recipe_save: z
    .object({
      ...documentInput,
      expectedRevision: z.number().int().min(0),
      definition: sourceSplitDefinitionSchema,
      replaces: z.uuid().optional(),
    })
    .strict(),
  split_recipe_trial: z
    .object({
      ...documentInput,
      ...versionInput,
      sampleKind: z.enum(['typical', 'variant', 'exception']),
      expected: z.enum(['ready', 'review']),
      samples: z
        .array(
          z
            .object({
              snapshotId: z.uuid(),
              sampleKind: z.enum(['typical', 'variant', 'exception']),
              expected: z.enum(['ready', 'review']),
            })
            .strict(),
        )
        .max(11)
        .optional(),
    })
    .strict(),
  split_recipe_control: z
    .object({
      ...documentInput,
      ...versionInput,
      action: z.enum(['enable', 'pause']),
      note: z.string().trim().max(400),
    })
    .strict(),
  split_recipe_suggest: z.object(documentInput).strict(),
};
const commandSchema = z.discriminatedUnion('operation', [
  splitRecipeOwnerSchemas.split_source_feedback.extend({
    operation: z.literal('split_source_feedback'),
  }),
  splitRecipeOwnerSchemas.split_source_calibrate.extend({
    operation: z.literal('split_source_calibrate'),
  }),
  splitRecipeOwnerSchemas.split_source_status.extend({
    operation: z.literal('split_source_status'),
  }),
  splitRecipeOwnerSchemas.split_source_read.extend({
    operation: z.literal('split_source_read'),
  }),
  splitRecipeOwnerSchemas.split_source_sample.extend({
    operation: z.literal('split_source_sample'),
  }),
  splitRecipeOwnerSchemas.split_source_suggest.extend({
    operation: z.literal('split_source_suggest'),
  }),
  splitRecipeReadSchemas.split_recipes_read.extend({
    operation: z.literal('split_recipes_read'),
  }),
  splitRecipeReadSchemas.split_recipe_preview.extend({
    operation: z.literal('split_recipe_preview'),
  }),
  splitRecipeReadSchemas.split_recipe_apply.extend({
    operation: z.literal('split_recipe_apply'),
  }),
  splitRecipeOwnerSchemas.split_recipe_save.extend({
    operation: z.literal('split_recipe_save'),
  }),
  splitRecipeOwnerSchemas.split_recipe_trial.extend({
    operation: z.literal('split_recipe_trial'),
  }),
  splitRecipeOwnerSchemas.split_recipe_control.extend({
    operation: z.literal('split_recipe_control'),
  }),
  splitRecipeOwnerSchemas.split_recipe_suggest.extend({
    operation: z.literal('split_recipe_suggest'),
  }),
]);
export const splitRecipeSuggestionSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    explanation: z.string().trim().min(1).max(400),
    settings: sourceSplitSettingsSchema,
    method: z.string().trim().max(2000).optional(),
    execution: z.enum(['rule', 'ai']).optional(),
  })
  .strict();
export interface SplitRecipeProvider {
  suggestSplitRecipe(input: {
    text: string;
    samples?: readonly {text: string}[];
    previous?: {
      method: string;
      settings: SourceSplitDefinition['settings'];
      issues: readonly string[];
    };
  }): Promise<z.infer<typeof splitRecipeSuggestionSchema>>;
}
interface Dependencies {
  workspaceId: string;
  preferences: ReviewPreferencesStore;
  evidence: EvidenceReadRepositoryPort;
  blobStore: BlobStore;
  entries: InformationEntryEmptySnapshotRepositoryPort;
  intake: DocumentIntakeRepository;
  workingCopyPending: (snapshotId: string) => Promise<boolean>;
  stage: (snapshotId: string) => Promise<void>;
  checkModelCall: () => Promise<void>;
  provider?: SplitRecipeProvider;
  now?: () => string;
}

/** One recipe service for owner controls, delegated previews and native tasks. */
export class SourceSplitService {
  public constructor(private readonly deps: Dependencies) {}
  private now() {
    return this.deps.now?.() ?? new Date().toISOString();
  }
  private async catalog() {
    return (
      (await this.deps.preferences.load(this.deps.workspaceId))
        .sourceSplitRecipes ?? EMPTY_SOURCE_SPLIT_CATALOG
    );
  }
  private async context(snapshotId: string, includePrivate = false) {
    const snapshot = await this.deps.evidence.loadSnapshot(
      this.deps.workspaceId,
      snapshotId,
    );
    if (!snapshot || (snapshot.isPrivate && !includePrivate))
      throw new OperationError('not_found', 'snapshot_not_found');
    const record =
      (await this.deps.intake.read(snapshotId)) ??
      (await this.deps.intake.list()).find((r) =>
        intakeSnapshotIds(r).includes(snapshotId),
      );
    const origin = record?.value.captureOrigin;
    const sourceId =
      origin?.kind === 'subscription' ? origin.subscriptionId : undefined;
    return {snapshot, record, sourceId};
  }
  private inScope(
    definition: SourceSplitDefinition,
    snapshotId: string,
    sourceId?: string,
  ) {
    return definition.scope.kind === 'source'
      ? definition.scope.sourceId === sourceId
      : definition.scope.snapshotId === snapshotId;
  }
  private async material(snapshotId: string, includePrivate: boolean) {
    const context = await this.context(snapshotId, includePrivate);
    const snapshot = await materializeEvidenceSnapshot(
      context.snapshot,
      this.deps.blobStore,
    );
    const structure = snapshot.structures[0];
    if (!structure?.normalizedText)
      throw new OperationError('rejected', 'recipe_source_unavailable');
    return {...context, snapshot, text: structure.normalizedText};
  }
  private async update(
    expectedRevision: number,
    edit: (catalog: SourceSplitCatalog) => SourceSplitRecipe[],
  ) {
    const {result} = await updateReviewPreferences(
      this.deps.preferences,
      this.deps.workspaceId,
      (current) => {
        const catalog =
          current.sourceSplitRecipes ?? EMPTY_SOURCE_SPLIT_CATALOG;
        if (catalog.revision !== expectedRevision)
          throw new OperationError('conflict', 'stale_split_recipes');
        const next = {
          ...catalog,
          revision: catalog.revision + 1,
          recipes: edit(catalog),
        };
        return {
          next: patchReviewPreferences(current, {sourceSplitRecipes: next}),
          result: next,
        };
      },
    );
    return result;
  }
  public async execute(
    authority: ExecutionAuthority,
    name: string,
    input: unknown,
  ): Promise<unknown> {
    if (authority.workspaceId !== this.deps.workspaceId)
      throw new OperationError('forbidden', 'workspace_mismatch');
    const all = {...splitRecipeReadSchemas, ...splitRecipeOwnerSchemas};
    if (!Object.hasOwn(all, name))
      throw new OperationError('not_found', 'unknown_operation');
    const schema = all[name as keyof typeof all];
    const parsed = schema.safeParse(input);
    if (!parsed.success)
      throw new OperationError('invalid_input', 'split_recipe_invalid');
    const request = commandSchema.parse({...parsed.data, operation: name});
    authority.require('documents.read', request.includePrivate);
    if (
      Object.hasOwn(splitRecipeOwnerSchemas, name) &&
      authority.identity.kind !== 'owner'
    )
      throw new OperationError('forbidden', 'recipe_owner_required');
    if (request.operation === 'split_source_status') {
      const preferences = await this.deps.preferences.load(
        this.deps.workspaceId,
      );
      const observed = new Set(
        preferences.sourceSplitRecipes?.observations?.map((o) => o.sourceId),
      );
      const sources = [];
      for (const source of preferences.sourceSubscriptions?.subscriptions ??
        []) {
        if (
          !observed.has(source.subscriptionId) ||
          (source.isPrivate && !request.includePrivate)
        )
          continue;
        const out = await this.sourceCommand(
          authority,
          {
            operation: 'split_source_read',
            sourceId: source.subscriptionId,
            includePrivate: request.includePrivate,
          },
          true,
        );
        if ('feedback' in out)
          for (const feedback of out.feedback) {
            if (feedback.needsReview)
              sources.push({
                subscriptionId: source.subscriptionId,
                label: source.label,
                ...feedback,
              });
          }
      }
      return {sources};
    }
    if ('sourceId' in request) return this.sourceCommand(authority, request);
    const context = await this.context(
      request.snapshotId,
      request.includePrivate,
    );
    const catalog = await this.catalog();
    if (name === 'split_recipes_read') {
      const recipes = catalog.recipes.filter((r) =>
        this.inScope(r, request.snapshotId, context.sourceId),
      );
      // Trial evidence obeys the same explicit privacy scope as document reads.
      const visible = new Set<string>();
      for (const id of new Set(
        recipes.flatMap((r) => r.trials.map((t) => t.snapshotId)),
      )) {
        const snapshot = await this.deps.evidence.loadSnapshot(
          this.deps.workspaceId,
          id,
        );
        if (snapshot && (!snapshot.isPrivate || request.includePrivate))
          visible.add(id);
      }
      return {
        revision: catalog.revision,
        sourceId: context.sourceId ?? null,
        recipes: recipes.map((r) => ({
          ...r,
          trials: r.trials.filter((t) => visible.has(t.snapshotId)),
        })),
      };
    }
    if (name === 'split_recipe_suggest') {
      authority.require('models.use');
      if (context.snapshot.isPrivate)
        throw new OperationError(
          'forbidden',
          'private_model_transfer_forbidden',
        );
      if (!this.deps.provider)
        throw new OperationError('rejected', 'ai_not_configured');
      await this.deps.checkModelCall();
      const {text} = await this.material(request.snapshotId, false);
      if (text.length > 320_000)
        throw new OperationError('rejected', 'recipe_text_capacity');
      await this.deps.checkModelCall();
      const suggestion = splitRecipeSuggestionSchema.safeParse(
        await this.deps.provider.suggestSplitRecipe({text}),
      );
      if (!suggestion.success)
        throw new OperationError('rejected', 'ai_provider_invalid_schema');
      return {
        ...suggestion.data,
        preview: planSourceSplit(text, suggestion.data.settings),
      };
    }
    if (
      'definition' in request &&
      !this.inScope(request.definition, request.snapshotId, context.sourceId)
    )
      throw new OperationError('invalid_input', 'recipe_source_mismatch');
    if (name === 'split_recipe_preview' && 'definition' in request) {
      const {text} = await this.material(
        request.snapshotId,
        request.includePrivate,
      );
      const evaluated = evaluateSourceSplit(text, request.definition);
      return {
        ...evaluated.plan,
        score: evaluated.score,
        checks: evaluated.checks,
      };
    }
    if (
      name === 'split_recipe_save' &&
      'definition' in request &&
      'expectedRevision' in request
    ) {
      return this.update(request.expectedRevision, (current) => {
        const previous = current.recipes.find(
          (r) => r.recipeId === request.definition.recipeId,
        );
        if (!previous && current.recipes.length >= 128)
          throw new OperationError('rejected', 'recipe_catalog_full');
        if (
          previous &&
          (previous.status === 'enabled' || previous.status === 'replaced')
        )
          throw new OperationError('conflict', 'recipe_copy_required');
        if (request.definition.revision !== (previous?.revision ?? 0) + 1)
          throw new OperationError('conflict', 'stale_split_recipe');
        const replaces = 'replaces' in request ? request.replaces : undefined;
        if (
          replaces &&
          !current.recipes.some(
            (r) =>
              r.recipeId === replaces &&
              r.status !== 'replaced' &&
              JSON.stringify(r.scope) ===
                JSON.stringify(request.definition.scope),
          )
        )
          throw new OperationError(
            'invalid_input',
            'recipe_replacement_invalid',
          );
        const recipe: SourceSplitRecipe = {
          ...request.definition,
          status: 'draft',
          trials: [],
          approval: null,
          replaces: replaces ?? null,
        };
        return [
          ...current.recipes.filter((r) => r.recipeId !== recipe.recipeId),
          recipe,
        ];
      });
    }
    if (!('recipeId' in request))
      throw new OperationError('invalid_input', 'split_recipe_invalid');
    const recipe = catalog.recipes.find(
      (r) =>
        r.recipeId === request.recipeId &&
        this.inScope(r, request.snapshotId, context.sourceId),
    );
    if (!recipe)
      throw new OperationError('not_found', 'split_recipe_not_found');
    if (catalog.revision !== request.expectedRevision)
      throw new OperationError('conflict', 'stale_split_recipes');
    if (name === 'split_recipe_apply') {
      authority.require(
        authority.identity.kind === 'owner' ? 'documents.split' : 'agent.split',
        request.includePrivate,
      );
      if (recipe.status !== 'enabled')
        throw new OperationError('rejected', 'recipe_not_enabled');
      const result = await this.apply(
        request.snapshotId,
        recipe,
        request.includePrivate,
        false,
      );
      return {
        snapshotId: request.snapshotId,
        createdCount: result.rows.length,
        recipeId: recipe.recipeId,
        revision: recipe.revision,
      };
    }
    if (name === 'split_recipe_trial' && 'sampleKind' in request) {
      if (recipe.status === 'replaced')
        throw new OperationError('conflict', 'recipe_replaced');
      const samples = [
        {
          snapshotId: request.snapshotId,
          sampleKind: request.sampleKind,
          expected: request.expected,
        },
        ...(request.samples ?? []),
      ];
      if (new Set(samples.map((s) => s.snapshotId)).size !== samples.length)
        throw new OperationError('invalid_input', 'recipe_duplicate_samples');
      const results = [];
      for (const sample of samples) {
        const material = await this.material(
          sample.snapshotId,
          request.includePrivate,
        );
        if (!this.inScope(recipe, sample.snapshotId, material.sourceId))
          throw new OperationError('invalid_input', 'recipe_source_mismatch');
        const evaluated = evaluateSourceSplit(material.text, recipe);
        results.push({sample, evaluated});
      }
      const trials = results.map(({sample, evaluated}) =>
        sourceSplitTrialSchema.parse({
          snapshotId: sample.snapshotId,
          recipeRevision: recipe.revision,
          engine: SOURCE_SPLIT_ENGINE,
          sampleKind: sample.sampleKind,
          expected: sample.expected,
          outcome: evaluated.plan.outcome,
          entryCount: evaluated.plan.groups.length,
          reason: evaluated.plan.reason,
          score: evaluated.score,
          checkedAt: this.now(),
        }),
      );
      const result = await this.update(request.expectedRevision, (current) =>
        current.recipes.map((r) =>
          r.recipeId !== recipe.recipeId
            ? r
            : {
                ...r,
                status: r.status === 'draft' ? 'trial' : r.status,
                trials: [
                  ...r.trials.filter(
                    (t) => !samples.some((s) => s.snapshotId === t.snapshotId),
                  ),
                  ...trials,
                ].slice(-16),
              },
        ),
      );
      return {
        catalog: result,
        plan: requireOperationValue(results[0]).evaluated.plan,
        results: results.map(({sample, evaluated}) => ({
          snapshotId: sample.snapshotId,
          ...evaluated,
        })),
      };
    }
    if (name === 'split_recipe_control' && 'action' in request) {
      const source = (
        await this.deps.preferences.load(this.deps.workspaceId)
      ).sourceSubscriptions?.subscriptions.find(
        (s) => s.subscriptionId === context.sourceId,
      );
      const policy =
        source?.processingProfile?.splitRouting ?? DEFAULT_SOURCE_SPLIT_ROUTING;
      return this.update(request.expectedRevision, (current) => {
        const r = current.recipes.find(
          (entry) => entry.recipeId === recipe.recipeId,
        );
        if (!r || r.status === 'replaced')
          throw new OperationError('conflict', 'recipe_replaced');
        if (request.action === 'enable') {
          const valid = r.trials.filter((t) => t.recipeRevision === r.revision);
          const positive = valid.filter(
            (t) =>
              t.outcome === 'ready' &&
              t.expected === 'ready' &&
              (t.score ?? 0) >= (r.match?.minimumScore ?? policy.minimumScore),
          );
          const enough =
            r.scope.kind === 'document'
              ? positive.length >= 1
              : positive.length >= policy.samplesPerFormat &&
                valid.some((t) => t.sampleKind !== 'typical');
          if (
            !enough ||
            valid.some((t) => t.outcome !== t.expected) ||
            !request.note.trim()
          )
            throw new OperationError('rejected', 'recipe_trials_required');
        }
        return current.recipes.map((entry) =>
          entry.recipeId === r.recipeId
            ? {
                ...entry,
                status: request.action === 'enable' ? 'enabled' : 'paused',
                ...(request.action === 'enable'
                  ? {approval: {note: request.note, at: this.now()}}
                  : {}),
              }
            : request.action === 'enable' && entry.recipeId === r.replaces
              ? {...entry, status: 'replaced'}
              : entry,
        );
      });
    }
    throw new OperationError('invalid_input', 'split_recipe_invalid');
  }
  private async sourceCommand(
    authority: ExecutionAuthority,
    request: Extract<z.infer<typeof commandSchema>, {sourceId: string}>,
    summaryOnly = false,
  ) {
    const preferences = await this.deps.preferences.load(this.deps.workspaceId);
    const source = preferences.sourceSubscriptions?.subscriptions.find(
      (s) => s.subscriptionId === request.sourceId,
    );
    if (!source || (source.isPrivate && !request.includePrivate))
      throw new OperationError('not_found', 'source_not_found');
    const policy =
      source.processingProfile?.splitRouting ?? DEFAULT_SOURCE_SPLIT_ROUTING;
    const catalog =
      preferences.sourceSplitRecipes ?? EMPTY_SOURCE_SPLIT_CATALOG;
    const recipes = catalog.recipes.filter(
      (r) =>
        r.scope.kind === 'source' && r.scope.sourceId === source.subscriptionId,
    );
    if (request.operation === 'split_source_feedback') {
      const context = await this.context(
        request.snapshotId,
        request.includePrivate,
      );
      if (context.sourceId !== source.subscriptionId)
        throw new OperationError('not_found', 'snapshot_not_found');
      return (
        await updateReviewPreferences(
          this.deps.preferences,
          this.deps.workspaceId,
          (p) => {
            const current = p.sourceSplitRecipes ?? EMPTY_SOURCE_SPLIT_CATALOG;
            const observed = current.observations?.find(
              (o) =>
                o.snapshotId === request.snapshotId &&
                o.sourceId === source.subscriptionId &&
                o.recipeId === request.recipeId &&
                o.recipeRevision === request.recipeRevision,
            );
            if (!observed)
              throw new OperationError(
                'conflict',
                'recipe_observation_changed',
              );
            const observations = current.observations?.map((o) =>
              o === observed ? {...o, quality: request.quality} : o,
            );
            return {
              next: patchReviewPreferences(p, {
                sourceSplitRecipes: {...current, observations},
              }),
              result: {quality: request.quality},
            };
          },
        )
      ).result;
    }
    if (request.operation === 'split_source_read') {
      const visible = new Set<string>();
      const ids = new Set([
        ...recipes.flatMap((r) => r.trials.map((t) => t.snapshotId)),
        ...(catalog.observations ?? [])
          .filter((o) => o.sourceId === source.subscriptionId)
          .map((o) => o.snapshotId),
      ]);
      for (const id of ids) {
        const snapshot = await this.deps.evidence.loadSnapshot(
          this.deps.workspaceId,
          id,
        );
        if (snapshot && (!snapshot.isPrivate || request.includePrivate))
          visible.add(id);
      }
      const buckets = new Map<
        string,
        NonNullable<SourceSplitCatalog['observations']>
      >();
      const matched = new Map<string, string>();
      const active = new Map(
        recipes
          .filter((r) => r.status === 'enabled')
          .map((r) => [r.recipeId, r.revision]),
      );
      for (const row of catalog.observations ?? []) {
        if (
          row.sourceId === source.subscriptionId &&
          !row.low &&
          row.recipeId &&
          active.get(row.recipeId) === row.recipeRevision
        ) {
          const key = row.snapshotId + ':' + row.format;
          if (row.checkedAt > (matched.get(key) ?? ''))
            matched.set(key, row.checkedAt);
        }
      }
      for (const observation of catalog.observations ?? []) {
        if (
          observation.sourceId !== source.subscriptionId ||
          !visible.has(observation.snapshotId) ||
          (observation.low &&
            (!observation.quality || observation.quality === 'good') &&
            (matched.get(observation.snapshotId + ':' + observation.format) ??
              '') > observation.checkedAt)
        )
          continue;
        if (
          observation.recipeId &&
          !recipes.some(
            (r) =>
              r.recipeId === observation.recipeId &&
              r.revision === observation.recipeRevision &&
              r.status === 'enabled',
          )
        )
          continue;
        const key = `${observation.recipeId ?? 'unmatched'}:${observation.format}`;
        buckets.set(
          key,
          [...(buckets.get(key) ?? []), observation].slice(
            -policy.reviewWindow,
          ),
        );
      }
      const feedback = [...buckets.entries()].map(([key, rows]) => {
        const low = rows.filter((r) => r.low).length;
        const flagged = rows.filter(
          (r) => r.low || (r.quality && r.quality !== 'good'),
        );
        return {
          key,
          recipeId: rows[0]?.recipeId,
          format: rows[0]?.format,
          count: rows.length,
          low,
          qualityIssues: rows.filter((r) => r.quality && r.quality !== 'good')
            .length,
          flagged: flagged.length,
          rate: flagged.length / rows.length,
          needsReview:
            rows.length >= policy.reviewWindow &&
            flagged.length / rows.length >= policy.lowScoreRate,
          examples: flagged.slice(-policy.samplesPerFormat),
        };
      });
      const recent = [];
      if (!summaryOnly) {
        for (const observation of [...buckets.values()]
          .flat()
          .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))
          .slice(0, 8)) {
          const material = await this.material(
            observation.snapshotId,
            request.includePrivate,
          );
          recent.push({
            ...observation,
            title: material.text
              .trimStart()
              .split('\n', 1)[0]
              ?.replace(/^#+\s*/u, '')
              .slice(0, 200),
          });
        }
      }
      return {
        revision: catalog.revision,
        policy,
        recipes: recipes.map((r) => ({
          ...r,
          trials: r.trials.filter((t) => visible.has(t.snapshotId)),
        })),
        feedback,
        recent,
      };
    }
    if (request.operation === 'split_source_sample')
      return this.sampleSource(
        source.subscriptionId,
        request.includePrivate,
        policy,
      );
    const calibration =
      request.operation === 'split_source_calibrate' ? request : undefined;
    if (calibration && calibration.expectedRevision !== catalog.revision)
      throw new OperationError('conflict', 'stale_split_recipes');
    const previous = calibration?.recipeId
      ? recipes.find(
          (r) => r.recipeId === calibration.recipeId && r.status === 'enabled',
        )
      : undefined;
    if (calibration?.recipeId && !previous)
      throw new OperationError('conflict', 'recipe_replaced');
    if (source.isPrivate)
      throw new OperationError('forbidden', 'private_model_transfer_forbidden');
    const observations = (catalog.observations ?? []).filter(
      (o) =>
        o.sourceId === source.subscriptionId &&
        o.recipeId === previous?.recipeId &&
        o.recipeRevision === previous?.revision &&
        o.format === calibration?.format,
    );
    let selected: string[];
    if (request.operation === 'split_source_suggest')
      selected = request.snapshotIds;
    else {
      const sampled = await this.sampleSource(
        source.subscriptionId,
        false,
        policy,
      );
      const group = sampled.groups.find((g) => g.format === request.format);
      const observed = observations.filter((o) =>
        request.ruleOnly
          ? !o.low && (!o.quality || o.quality === 'good')
          : o.low || (o.quality && o.quality !== 'good'),
      );
      // Use observed failures first; keep a separate document outside the model request.
      const pool = [
        ...new Set([
          ...observed.map((o) => o.snapshotId),
          ...(request.ruleOnly && previous
            ? []
            : (group?.samples.map((s) => s.snapshotId) ?? [])),
        ]),
      ];
      selected = pool.slice(0, policy.samplesPerFormat);
    }
    const ids = [...new Set(selected)];
    if (ids.length !== selected.length || ids.length < policy.samplesPerFormat)
      throw new OperationError('invalid_input', 'recipe_samples_required');
    const materials = [];
    for (const id of ids) {
      const material = await this.material(id, false);
      if (material.sourceId !== source.subscriptionId)
        throw new OperationError('invalid_input', 'recipe_source_mismatch');
      if (
        material.record?.value.receipt === 'rejected' ||
        material.record?.value.decision === 'blocked' ||
        material.record?.value.assessment?.completeness === 'summary'
      )
        throw new OperationError('rejected', 'recipe_sample_unavailable');
      materials.push({
        snapshotId: id,
        text: material.text,
        publication: material.record?.value.publication,
      });
    }
    if (
      new Set(materials.map((m) => inspectSourceStructure(m.text).format))
        .size > 1
    )
      throw new OperationError('invalid_input', 'recipe_mixed_sample_formats');
    const training = materials.slice(0, -1);
    if (
      training.some((m) => !m.text.trim()) ||
      training.reduce((n, m) => n + Array.from(m.text).length, 0) > 320_000
    )
      throw new OperationError('rejected', 'recipe_text_capacity');
    const reported = observations.some(
      (o) => ids.includes(o.snapshotId) && o.quality && o.quality !== 'good',
    );
    const verified =
      calibration && !reported
        ? await this.verifiedRule(materials, previous)
        : undefined;
    if (calibration?.ruleOnly && !verified)
      throw new OperationError('rejected', 'recipe_rule_unverified');
    const suggest = async () => {
      authority.require('models.use');
      if (!this.deps.provider)
        throw new OperationError('rejected', 'ai_not_configured');
      await this.deps.checkModelCall();
      return this.deps.provider.suggestSplitRecipe({
        text: requireOperationValue(training[0]).text,
        samples: training.slice(1).map((m) => ({text: m.text})),
        ...(previous
          ? {
              previous: {
                method: previous.method ?? '',
                settings: previous.settings,
                issues: [
                  ...new Set(
                    observations.flatMap((o) => [
                      o.reason,
                      ...(o.quality ? [o.quality] : []),
                    ]),
                  ),
                ],
              },
            }
          : {}),
      });
    };
    const suggestion = splitRecipeSuggestionSchema.safeParse(
      verified ?? (await suggest()),
    );
    if (!suggestion.success)
      throw new OperationError('rejected', 'ai_provider_invalid_schema');
    const definition: SourceSplitDefinition = {
      recipeId: randomUUID(),
      revision: 1,
      name: suggestion.data.name,
      scope: {kind: 'source', sourceId: source.subscriptionId},
      origin: verified ? 'verified_rule' : 'model',
      settings: {...suggestion.data.settings, onMismatch: 'ai'},
      match: learnSourceStructure(training.map((m) => m.text)),
      ...(suggestion.data.method ? {method: suggestion.data.method} : {}),
      execution: suggestion.data.execution ?? 'rule',
    };
    const results = materials.map((m, index) => ({
      snapshotId: m.snapshotId,
      heldOut: index === materials.length - 1,
      ...evaluateSourceSplit(m.text, definition),
    }));
    let revision = catalog.revision,
      replaces: string | null = null;
    if (calibration) {
      if (previous?.trials.length) {
        const prior = await this.material(
          requireOperationValue(previous.trials[0]).snapshotId,
          false,
        );
        if (inspectSourceStructure(prior.text).format === calibration.format) {
          // A repair for exceptional documents must still accept the earlier
          // positive controls before it can retire their recipe.
          let compatible = true;
          for (const trial of previous.trials.filter(
            (t) => t.expected === 'ready' && t.outcome === 'ready',
          )) {
            if (ids.includes(trial.snapshotId)) continue;
            const sample = await this.material(trial.snapshotId, false);
            const next = evaluateSourceSplit(sample.text, definition);
            if (
              next.plan.outcome !== 'ready' ||
              next.score <
                (definition.match?.minimumScore ?? policy.minimumScore)
            ) {
              compatible = false;
              break;
            }
            if (
              previous.execution !== 'ai' &&
              definition.execution !== 'ai' &&
              !isDeepStrictEqual(
                next.plan.groups,
                planSourceSplit(sample.text, previous.settings).groups,
              )
            ) {
              compatible = false;
              break;
            }
          }
          if (compatible) replaces = previous.recipeId;
        }
      }
      const trials = results.map((r) =>
        sourceSplitTrialSchema.parse({
          snapshotId: r.snapshotId,
          recipeRevision: 1,
          engine: SOURCE_SPLIT_ENGINE,
          sampleKind: r.heldOut ? 'variant' : 'typical',
          expected: 'ready',
          outcome: r.plan.outcome,
          entryCount: r.plan.groups.length,
          reason: r.plan.reason,
          score: r.score,
          checkedAt: this.now(),
        }),
      );
      const saved = await this.update(
        calibration.expectedRevision,
        (current) => [
          ...current.recipes,
          {...definition, status: 'trial', replaces, trials, approval: null},
        ],
      );
      revision = saved.revision;
    }
    return {
      definition,
      revision,
      replaces,
      explanation: suggestion.data.explanation,
      results,
    };
  }

  private async verifiedRule(
    samples: {
      snapshotId: string;
      text: string;
      publication: IntakeRecordValue['publication'];
    }[],
    prior?: SourceSplitRecipe,
  ): Promise<z.infer<typeof splitRecipeSuggestionSchema> | undefined> {
    if (
      !samples.every(
        (s) =>
          s.publication && !s.publication.draft && s.publication.entries.length,
      )
    )
      return;
    const entries = await this.deps.entries.loadCurrentEntries(
      this.deps.workspaceId,
      false,
    );
    const observed = samples.map((s) => {
      const rows = entries
        .filter((e) => e.snapshotId === s.snapshotId)
        .sort((a, b) => a.value.documentOrder - b.value.documentOrder);
      const refs = s.publication?.entries ?? [];
      const current =
        rows.length === refs.length &&
        rows.every((e) =>
          refs.some(
            (r) => r.entryId === e.entryId && r.revision === e.revision,
          ),
        );
      return {text: s.text, rows, current};
    });
    if (observed.some((o) => !o.current)) return;
    const training = observed.slice(0, -1),
      holdout = requireOperationValue(observed.at(-1));
    const settings = {
      headingLevel:
        prior?.settings.headingLevel ??
        (inspectSourceStructure(requireOperationValue(training[0]).text)
          .headingLevel ||
          2),
      titleIncludes: prior?.settings.titleIncludes ?? [],
      appendixHeadings: prior?.settings.appendixHeadings ?? [],
      minimumEntries: 1,
      maximumEntries: 64,
      minimumBodyCharacters: 0,
      onMismatch: 'ai' as const,
      allowNumberReset: prior?.settings.allowNumberReset ?? false,
    };
    const agrees = (
      s: (typeof observed)[number],
      candidate: SourceSplitDefinition['settings'],
    ) => {
      const plan = planSourceSplit(s.text, candidate),
        points = Array.from(s.text);
      return (
        plan.completeCoverage &&
        plan.groups.length === s.rows.length &&
        plan.groups.every(
          (g, i) =>
            points.slice(g.start, g.end).join('') === s.rows[i]?.value.body &&
            g.title === s.rows[i].value.titlePath,
        )
      );
    };
    const templates = ['whole', 'numbered', 'directory', 'headings'] as const;
    const chosen = templates
      .map((template) => ({...settings, template}))
      .find((candidate) => training.every((s) => agrees(s, candidate)));
    if (chosen && agrees(holdout, chosen))
      return {
        name: (prior?.name.slice(0, 60) ?? '来源拆分') + ' · 规则版',
        settings: chosen,
        method: '按已核对的原文范围和标题拆分。',
        execution: 'rule',
        explanation:
          '规则在取样文章和独立检查文章上均重现了已确认条目的正文与标题。',
      };
    return undefined;
  }
  private async sampleSource(
    sourceId: string,
    includePrivate: boolean,
    policy: typeof DEFAULT_SOURCE_SPLIT_ROUTING,
  ) {
    const records = (await this.deps.intake.list()).filter(
      (r) =>
        r.value.captureOrigin?.kind === 'subscription' &&
        r.value.captureOrigin.subscriptionId === sourceId &&
        r.value.receipt !== 'rejected' &&
        r.value.decision !== 'blocked' &&
        r.value.assessment?.completeness !== 'summary',
    );
    const snapshots = [];
    for (const record of records) {
      const snapshotId = intakeTargetSnapshot(record);
      const snapshot = await this.deps.evidence.loadSnapshot(
        this.deps.workspaceId,
        snapshotId,
      );
      if (snapshot && (!snapshot.isPrivate || includePrivate))
        snapshots.push({
          snapshotId,
          capturedAt: snapshot.publication?.instant ?? snapshot.capturedAt,
        });
    }
    snapshots.sort(
      (a, b) =>
        a.capturedAt.localeCompare(b.capturedAt) ||
        a.snapshotId.localeCompare(b.snapshotId),
    );
    const scanned = spreadSourceSamples(snapshots, policy.sampleLimit);
    const groups = new Map<
      string,
      {snapshotId: string; title: string; capturedAt: string}[]
    >();
    const skipped: {snapshotId: string; reason: string}[] = [];
    for (const sample of scanned) {
      const {text} = await this.material(sample.snapshotId, includePrivate);
      if (
        !text.trim() ||
        Array.from(text).length > 320_000 ||
        text.split('\n').length > 32_000
      ) {
        skipped.push({
          snapshotId: sample.snapshotId,
          reason: 'recipe_text_capacity',
        });
        continue;
      }
      const format = inspectSourceStructure(text).format;
      const title =
        text
          .split('\n')
          .find((l) => l.trim())
          ?.replace(/^#+\s*/u, '')
          .slice(0, 240) ?? '未命名文档';
      groups.set(format, [...(groups.get(format) ?? []), {...sample, title}]);
    }
    return {
      policy,
      available: snapshots.length,
      scanned: scanned.length,
      skipped,
      groups: [...groups].map(([format, rows]) => ({
        format,
        available: rows.length,
        samples: spreadSourceSamples(rows, policy.samplesPerFormat),
        ready: rows.length >= policy.samplesPerFormat,
      })),
    };
  }
  private async recordDecision(
    snapshotId: string,
    sourceId: string,
    frozen: FrozenSourceSplit,
    decision: SourceSplitDecision,
  ) {
    const policy =
      frozen.processingProfile?.splitRouting ?? DEFAULT_SOURCE_SPLIT_ROUTING;
    const recipe = frozen.recipes.find((r) => r.recipeId === decision.recipeId);
    const observation = {
      snapshotId,
      sourceId,
      ...(recipe
        ? {recipeId: recipe.recipeId, recipeRevision: recipe.revision}
        : {}),
      format: decision.format ?? 'unknown',
      score: decision.score ?? 0,
      low: decision.reason !== 'recipe_ready',
      reason: decision.reason,
      checkedAt: this.now(),
    };
    await updateReviewPreferences(
      this.deps.preferences,
      this.deps.workspaceId,
      (preferences) => {
        const catalog =
          preferences.sourceSplitRecipes ?? EMPTY_SOURCE_SPLIT_CATALOG;
        const same = (
          o: NonNullable<SourceSplitCatalog['observations']>[number],
        ) =>
          o.sourceId === sourceId &&
          o.recipeId === observation.recipeId &&
          o.recipeRevision === observation.recipeRevision &&
          o.format === observation.format;
        const existing = catalog.observations ?? [];
        const prior = existing.find(
          (o) => same(o) && o.snapshotId === snapshotId,
        );
        const bucket = [
          ...existing.filter((o) => same(o) && o.snapshotId !== snapshotId),
          {...observation, ...(prior?.quality ? {quality: prior.quality} : {})},
        ].slice(-policy.reviewWindow);
        const next = {
          ...catalog,
          observations: [...existing.filter((o) => !same(o)), ...bucket].slice(
            -12800,
          ),
        };
        return {
          next: patchReviewPreferences(preferences, {sourceSplitRecipes: next}),
          result: undefined,
        };
      },
    );
  }
  public async freeze(
    snapshotId: string,
    includePrivate = false,
  ): Promise<FrozenSourceSplit> {
    const {sourceId} = await this.context(snapshotId, includePrivate);
    const preferences = await this.deps.preferences.load(this.deps.workspaceId);
    const catalog =
      preferences.sourceSplitRecipes ?? EMPTY_SOURCE_SPLIT_CATALOG;
    const profile = preferences.sourceSubscriptions?.subscriptions.find(
      (s) => s.subscriptionId === sourceId,
    )?.processingProfile;
    return {
      engine: SOURCE_SPLIT_ENGINE,
      catalogRevision: catalog.revision,
      ...(sourceId
        ? {
            sourceEntryLimit:
              profile?.maxEntriesPerDocument ?? MAXIMUM_AI_SPLIT_ENTRIES,
          }
        : {}),
      ...(profile ? {processingProfile: {...profile}} : {}),
      recipes: catalog.recipes
        .filter(
          (r) =>
            r.status === 'enabled' && this.inScope(r, snapshotId, sourceId),
        )
        .map((r) => sourceSplitDefinitionSchema.strip().parse(r)),
    };
  }
  public async decide(
    snapshotId: string,
    frozen: FrozenSourceSplit,
  ): Promise<SourceSplitDecision> {
    const {text, sourceId, record} = await this.material(snapshotId, false);
    const decision = chooseSourceSplit(text, {
      ...frozen,
      recipes: frozen.recipes.filter(
        (r) => r.scope.kind !== 'document' || r.scope.snapshotId === snapshotId,
      ),
    });
    if (sourceId && record?.value.assessment?.completeness !== 'summary') {
      decision.format ??= inspectSourceStructure(text).format;
      await this.recordDecision(snapshotId, sourceId, frozen, decision);
    }
    return decision;
  }
  public async prepare(
    snapshotId: string,
    recipe: SourceSplitDefinition,
    includePrivate = false,
  ) {
    if (recipe.execution === 'ai')
      throw new OperationError('rejected', 'recipe_ai_required');
    const {snapshot, text} = await this.material(snapshotId, includePrivate);
    const plan = planSourceSplit(text, recipe.settings);
    if (plan.outcome !== 'ready')
      throw new OperationError('rejected', plan.reason);
    const whole = snapshot.structures[0]?.fragments.find(
      (f) => f.nodeKind === 'document',
    );
    if (!whole)
      throw new OperationError('rejected', 'recipe_source_unavailable');
    const prepared = prepareManualSplitInformationEntries(
      snapshot,
      plan.groups.map((g) => ({
        titlePath: g.title,
        fragments: [
          {
            fragmentId: whole.fragmentId,
            startCodePoint: g.start,
            endCodePoint: g.end,
          },
        ],
      })),
    );
    if (!prepared)
      throw new OperationError('rejected', 'recipe_coverage_invalid');
    const rows = prepared.map((row) => ({
      ...row,
      value: {
        ...row.value,
        splitRuleVersion: SOURCE_RECIPE_SPLIT_VERSION,
        chunkMode:
          plan.groups.length === 1 ? ('whole' as const) : ('split' as const),
      },
    }));
    return {plan, rows};
  }
  public async apply(
    snapshotId: string,
    recipe: SourceSplitDefinition,
    includePrivate = false,
    recover = true,
    check?: (
      rows: Awaited<ReturnType<SourceSplitService['prepare']>>['rows'],
    ) => void,
  ) {
    const prepared = await this.prepare(snapshotId, recipe, includePrivate);
    if (!recover) {
      const limit = (await this.freeze(snapshotId, includePrivate))
        .sourceEntryLimit;
      if (limit !== undefined && prepared.rows.length > limit)
        throw new OperationError('rejected', 'recipe_entry_capacity');
    }
    check?.(prepared.rows);
    const {record, snapshot} = await this.context(snapshotId, includePrivate);
    if (record && intakeTargetSnapshot(record) !== snapshotId)
      throw new OperationError('conflict', 'intake_body_not_selected');
    if (
      record &&
      ((record.value.receipt && record.value.receipt !== 'accepted') ||
        record.value.decision !== 'admitted' ||
        record.value.deferProcessing)
    )
      throw new OperationError('rejected', 'recipe_receipt_not_accepted');
    if (await this.deps.workingCopyPending(snapshotId))
      throw new OperationError('conflict', 'document_working_copy_pending');
    const current = (
      await this.deps.entries.loadCurrentEntries(
        this.deps.workspaceId,
        includePrivate,
      )
    ).filter((e) => e.snapshotId === snapshotId);
    if (current.length) {
      if (
        recover &&
        current.length === prepared.rows.length &&
        prepared.rows.every((r) =>
          current.some(
            (e) =>
              e.entryId === r.entryId &&
              e.revision === 1 &&
              isDeepStrictEqual(e.value, r.value),
          ),
        )
      )
        return prepared;
      throw new OperationError('conflict', 'document_structure_changed');
    }
    // Native tasks already have a durable unpublished lifecycle. Only an explicit
    // manual/Agent application creates a draft that requires owner confirmation.
    if (!recover && !snapshot.isPrivate) await this.deps.stage(snapshotId);
    const result = await this.deps.entries.materializeEntriesIfSnapshotEmpty(
      prepared.rows,
    );
    if (result.outcome === 'snapshot_not_empty')
      throw new OperationError('conflict', 'document_structure_changed');
    return prepared;
  }
}
