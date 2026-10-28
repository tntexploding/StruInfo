import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {
  EMPTY_SOURCE_SPLIT_CATALOG,
  SOURCE_SPLIT_ENGINE,
  SOURCE_RECIPE_SPLIT_VERSION,
  sourceSplitDefinitionSchema,
  sourceSplitSettingsSchema,
  sourceSplitTrialSchema,
  planSourceSplit,
  chooseSourceSplit,
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
} from './document_intake_contract.js';
import type {ExecutionAuthority} from './execution_authority.js';
import {OperationError} from './operation_error.js';

const documentInput = {
  snapshotId: z.uuid(),
  includePrivate: z.boolean().default(false),
};
const versionInput = {
  recipeId: z.uuid(),
  expectedRevision: z.number().int().min(0),
};
export const splitRecipeReadSchemas = {
  split_recipes_read: z.object(documentInput).strict(),
  split_recipe_preview: z
    .object({...documentInput, definition: sourceSplitDefinitionSchema})
    .strict(),
  split_recipe_apply: z.object({...documentInput, ...versionInput}).strict(),
};
export const splitRecipeOwnerSchemas = {
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
  })
  .strict();
export interface SplitRecipeProvider {
  suggestSplitRecipe(input: {
    text: string;
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
        const next = {revision: catalog.revision + 1, recipes: edit(catalog)};
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
      return planSourceSplit(text, request.definition.settings);
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
      const {text} = await this.material(
        request.snapshotId,
        request.includePrivate,
      );
      const plan = planSourceSplit(text, recipe.settings);
      const trial = sourceSplitTrialSchema.parse({
        snapshotId: request.snapshotId,
        recipeRevision: recipe.revision,
        engine: SOURCE_SPLIT_ENGINE,
        sampleKind: request.sampleKind,
        expected: request.expected,
        outcome: plan.outcome,
        entryCount: plan.groups.length,
        reason: plan.reason,
        checkedAt: this.now(),
      });
      const result = await this.update(request.expectedRevision, (current) =>
        current.recipes.map((r) =>
          r.recipeId !== recipe.recipeId
            ? r
            : {
                ...r,
                status: r.status === 'draft' ? 'trial' : r.status,
                trials: [
                  ...r.trials.filter(
                    (t) => t.snapshotId !== request.snapshotId,
                  ),
                  trial,
                ].slice(-16),
              },
        ),
      );
      return {catalog: result, plan};
    }
    if (name === 'split_recipe_control' && 'action' in request) {
      return this.update(request.expectedRevision, (current) => {
        const r = current.recipes.find(
          (entry) => entry.recipeId === recipe.recipeId,
        );
        if (!r || r.status === 'replaced')
          throw new OperationError('conflict', 'recipe_replaced');
        if (request.action === 'enable') {
          const valid = r.trials.filter((t) => t.recipeRevision === r.revision);
          const positive = valid.filter(
            (t) => t.outcome === 'ready' && t.expected === 'ready',
          );
          const enough =
            r.scope.kind === 'document'
              ? positive.length >= 1
              : positive.length >= 2 &&
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
  public async freeze(snapshotId: string): Promise<FrozenSourceSplit> {
    const {sourceId} = await this.context(snapshotId);
    const preferences = await this.deps.preferences.load(this.deps.workspaceId);
    const catalog =
      preferences.sourceSplitRecipes ?? EMPTY_SOURCE_SPLIT_CATALOG;
    const profile = preferences.sourceSubscriptions?.subscriptions.find(
      (s) => s.subscriptionId === sourceId,
    )?.processingProfile;
    return {
      engine: SOURCE_SPLIT_ENGINE,
      catalogRevision: catalog.revision,
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
    if (frozen.processingProfile?.split.trim())
      return {outcome: 'ai', reason: 'source_processing_guidance'};
    if (!frozen.recipes.length)
      return {outcome: 'ai', reason: 'recipe_not_configured'};
    const {text} = await this.material(snapshotId, false);
    return chooseSourceSplit(text, {
      ...frozen,
      recipes: frozen.recipes.filter(
        (r) => r.scope.kind !== 'document' || r.scope.snapshotId === snapshotId,
      ),
    });
  }
  public async prepare(
    snapshotId: string,
    recipe: SourceSplitDefinition,
    includePrivate = false,
  ) {
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
