import {z} from 'zod';
import {sourceProcessingProfileSchema} from '../subscriptions/source_processing_profile.js';

export const SOURCE_SPLIT_ENGINE = 'struinfo.source-split.v1';
export const SOURCE_RECIPE_SPLIT_VERSION =
  'struinfo.entry-split.source-recipe.v1';
export const sourceSplitSettingsSchema = z
  .object({
    template: z.enum(['whole', 'numbered', 'headings', 'directory']),
    headingLevel: z.number().int().min(1).max(6),
    titleIncludes: z.array(z.string().trim().min(1).max(80)).max(4),
    appendixHeadings: z.array(z.string().trim().min(1).max(80)).max(12),
    minimumEntries: z.number().int().min(1).max(64),
    maximumEntries: z.number().int().min(1).max(64),
    minimumBodyCharacters: z.number().int().min(0).max(2000),
    onMismatch: z.enum(['review', 'ai']),
  })
  .strict()
  .refine(
    (v) =>
      v.minimumEntries <= v.maximumEntries &&
      (v.template !== 'whole' || v.minimumEntries === 1),
  );
export type SourceSplitSettings = z.infer<typeof sourceSplitSettingsSchema>;
export const sourceSplitDefinitionSchema = z
  .object({
    recipeId: z.uuid(),
    revision: z.number().int().min(1),
    name: z.string().trim().min(1).max(80),
    scope: z.discriminatedUnion('kind', [
      z.object({kind: z.literal('source'), sourceId: z.uuid()}).strict(),
      z.object({kind: z.literal('document'), snapshotId: z.uuid()}).strict(),
    ]),
    settings: sourceSplitSettingsSchema,
    origin: z.enum(['manual', 'model']),
  })
  .strict();
export type SourceSplitDefinition = z.infer<typeof sourceSplitDefinitionSchema>;
export const sourceSplitTrialSchema = z
  .object({
    snapshotId: z.uuid(),
    recipeRevision: z.number().int().min(1),
    engine: z.literal(SOURCE_SPLIT_ENGINE),
    sampleKind: z.enum(['typical', 'variant', 'exception']),
    expected: z.enum(['ready', 'review']),
    outcome: z.enum(['ready', 'review']),
    entryCount: z.number().int().min(0).max(64),
    reason: z.string().max(120),
    checkedAt: z.iso.datetime(),
  })
  .strict();
export const sourceSplitRecipeSchema = sourceSplitDefinitionSchema
  .extend({
    status: z.enum(['draft', 'trial', 'enabled', 'paused', 'replaced']),
    trials: z.array(sourceSplitTrialSchema).max(16),
    approval: z
      .object({note: z.string().trim().min(1).max(400), at: z.iso.datetime()})
      .strict()
      .nullable()
      .default(null),
    replaces: z.uuid().nullable().default(null),
  })
  .strict();
export const sourceSplitCatalogSchema = z
  .object({
    revision: z.number().int().min(0),
    recipes: z.array(sourceSplitRecipeSchema).max(128),
  })
  .strict()
  .refine(
    (v) => new Set(v.recipes.map((r) => r.recipeId)).size === v.recipes.length,
  );
export type SourceSplitRecipe = z.infer<typeof sourceSplitRecipeSchema>;
export type SourceSplitCatalog = z.infer<typeof sourceSplitCatalogSchema>;
export const EMPTY_SOURCE_SPLIT_CATALOG: SourceSplitCatalog = {
  revision: 0,
  recipes: [],
};
export const frozenSourceSplitSchema = z
  .object({
    engine: z.literal(SOURCE_SPLIT_ENGINE),
    catalogRevision: z.number().int().min(0),
    recipes: z.array(sourceSplitDefinitionSchema).max(128),
    processingProfile: sourceProcessingProfileSchema.optional(),
  })
  .strict();
export type FrozenSourceSplit = z.infer<typeof frozenSourceSplitSchema>;
export const sourceSplitDecisionSchema = z
  .object({
    outcome: z.enum(['rule', 'ai', 'review']),
    recipeId: z.uuid().optional(),
    reason: z.string().max(120),
  })
  .strict();
export type SourceSplitDecision = z.infer<typeof sourceSplitDecisionSchema>;
export interface SourceSplitGroup {
  title: string;
  start: number;
  end: number;
}
export interface SourceSplitPlan {
  outcome: 'ready' | 'review';
  reason: string;
  groups: SourceSplitGroup[];
  characters: number;
  completeCoverage: boolean;
}
const normalized = (text: string) =>
  text.normalize('NFKC').trim().toLocaleLowerCase('en');
const titleText = (text: string) =>
  text
    .replace(/^#{1,6}\s+/u, '')
    .replace(/^\d+[.)、]\s*/u, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[*_`]/gu, '')
    .trim();

/** Bounded declarative rules; source text never becomes executable code. */
export function planSourceSplit(
  text: string,
  settings: SourceSplitSettings,
): SourceSplitPlan {
  const characters = Array.from(text).length;
  const review = (reason: string): SourceSplitPlan => ({
    outcome: 'review',
    reason,
    groups: [],
    characters,
    completeCoverage: false,
  });
  if (!sourceSplitSettingsSchema.safeParse(settings).success)
    return review('recipe_settings_invalid');
  if (!text.trim() || characters > 320_000)
    return review('recipe_text_capacity');
  const lines = text.split('\n');
  if (lines.length > 32_000) return review('recipe_text_capacity');
  const title =
    titleText(lines.find((line) => line.trim()) ?? '').slice(0, 240) ||
    '未命名文档';
  if (
    settings.titleIncludes.some(
      (term) => !normalized(title).includes(normalized(term)),
    )
  )
    return review('recipe_title_mismatch');
  const cuts: {start: number; title: string; number?: number}[] = [];
  const appendices: number[] = [];
  let offset = 0;
  let fence = '';
  let appendixLevel: number | undefined;
  for (const line of lines) {
    const opening = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    const end = offset + Array.from(line).length + 1;
    if (opening) {
      if (!fence) fence = opening;
      else if (
        opening.startsWith(fence.charAt(0)) &&
        opening.length >= fence.length
      )
        fence = '';
      offset = end;
      continue;
    }
    if (fence || settings.template === 'whole') {
      offset = end;
      continue;
    }
    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    const level = heading?.[1]?.length;
    if (level && appendixLevel !== undefined && level <= appendixLevel)
      appendixLevel = undefined;
    if (
      heading &&
      settings.appendixHeadings.some(
        (s) => normalized(s) === normalized(titleText(heading[2] ?? '')),
      )
    ) {
      appendixLevel = level;
      appendices.push(offset);
    }
    if (appendixLevel !== undefined) {
      offset = end;
      continue;
    }
    const numbered = /^ {0,3}(?:#{1,6}\s+)?(\d{1,4})[.)、]\s+(.+)$/u.exec(line);
    const directory =
      /^ {0,3}(?:#{1,6}\s+|\d{1,4}[.)、]\s+)\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/u.exec(
        line,
      );
    if (settings.template === 'headings' && level === settings.headingLevel)
      cuts.push({start: offset, title: titleText(heading?.[2] ?? '')});
    else if (
      settings.template === 'numbered' &&
      numbered &&
      (!heading || level === settings.headingLevel)
    )
      cuts.push({
        start: offset,
        title: titleText(numbered[2] ?? ''),
        number: Number(numbered[1]),
      });
    else if (
      settings.template === 'directory' &&
      directory &&
      (!heading || level === settings.headingLevel)
    )
      cuts.push({start: offset, title: titleText(directory[1] ?? '')});
    if (cuts.length > 64) return review('recipe_entry_capacity');
    offset = end;
  }
  if (settings.template === 'whole') cuts.push({start: 0, title});
  if (!cuts.length) return review('recipe_format_mismatch');
  if (
    settings.template === 'numbered' &&
    cuts.some(
      (cut, i) => i > 0 && cut.number !== (cuts[i - 1]?.number ?? 0) + 1,
    )
  )
    return review('recipe_number_sequence_changed');
  if (
    cuts.length < settings.minimumEntries ||
    cuts.length > settings.maximumEntries
  )
    return review('recipe_entry_count_changed');
  const scalars = Array.from(text);
  const groups = cuts.map((cut, index) => ({
    title: cut.title.slice(0, 240) || title,
    start: index === 0 ? 0 : cut.start,
    end: cuts[index + 1]?.start ?? characters,
  }));
  if (
    groups.some((group, index) => {
      // Count the item's own prose, excluding the attached preface and heading.
      const content = scalars
        .slice(
          cuts[index]?.start ?? group.start,
          appendices.find(
            (start) =>
              start > (cuts[index]?.start ?? group.start) && start < group.end,
          ) ?? group.end,
        )
        .join('');
      const body = (
        settings.template === 'whole' && !/^\s*#{1,6}\s/u.test(content)
          ? content
          : content.split('\n').slice(1).join('\n')
      ).trim();
      const prose =
        settings.template === 'directory'
          ? body
              .split('\n')
              .filter(
                (line) =>
                  !/^\s*(?:[-*+]\s+)?(?:\[[^\]]*\]\([^)]*\)|https?:\/\/\S+)\s*$/u.test(
                    line,
                  ),
              )
              .join('\n')
              .trim()
          : body;
      return (
        Array.from(prose).length <
        Math.max(
          settings.minimumBodyCharacters,
          settings.template === 'directory' ? 1 : 0,
        )
      );
    })
  )
    return review('recipe_body_too_short');
  const completeCoverage =
    groups[0]?.start === 0 &&
    groups.at(-1)?.end === characters &&
    groups.every(
      (g, i) => g.end > g.start && (i === 0 || groups[i - 1]?.end === g.start),
    );
  return completeCoverage
    ? {
        outcome: 'ready',
        reason: 'recipe_ready',
        groups,
        characters,
        completeCoverage,
      }
    : review('recipe_coverage_invalid');
}

export function chooseSourceSplit(
  text: string,
  frozen: FrozenSourceSplit,
): SourceSplitDecision {
  if (!frozen.recipes.length)
    return {outcome: 'ai', reason: 'recipe_not_configured'};
  const title = normalized(
    titleText(text.split('\n').find((line) => line.trim()) ?? ''),
  );
  const matching = frozen.recipes.filter((r) =>
    r.settings.titleIncludes.every((term) => title.includes(normalized(term))),
  );
  const score = (r: SourceSplitDefinition) =>
    (r.scope.kind === 'document' ? 100 : 0) +
    r.settings.titleIncludes.length * 10 +
    (r.settings.template === 'whole' ? 0 : 1);
  matching.sort((a, b) => score(b) - score(a));
  const best = matching[0];
  if (!best || (matching[1] && score(best) === score(matching[1])))
    return {
      outcome: 'review',
      reason: best ? 'recipe_match_ambiguous' : 'recipe_format_mismatch',
    };
  const plan = planSourceSplit(text, best.settings);
  return {
    outcome: plan.outcome === 'ready' ? 'rule' : best.settings.onMismatch,
    recipeId: best.recipeId,
    reason: plan.reason,
  };
}
