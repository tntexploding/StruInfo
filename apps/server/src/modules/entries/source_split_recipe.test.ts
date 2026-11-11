import {describe, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {
  chooseSourceSplit,
  evaluateSourceSplit,
  planSourceSplit,
  SOURCE_SPLIT_ENGINE,
  type SourceSplitSettings,
  type SourceSplitDefinition,
  type FrozenSourceSplit,
} from './source_split_recipe.js';
import {
  inspectSourceStructure,
  learnSourceStructure,
  scoreSourceStructure,
} from './source_split_structure.js';

const whole: SourceSplitSettings = {
  template: 'whole',
  headingLevel: 2,
  titleIncludes: [],
  appendixHeadings: [],
  minimumEntries: 1,
  maximumEntries: 64,
  minimumBodyCharacters: 10,
  onMismatch: 'review',
};
const collection: SourceSplitSettings = {
  ...whole,
  template: 'numbered',
  minimumEntries: 2,
  appendixHeadings: ['参考资料'],
};
const digest =
  '# 合成周刊😀\n\n本期前言。\n\n## 1. 存储机制\n\n完整说明合成缓存的工作原理。\n\n```md\n## 9. 代码里的标题\n```\n\n## 2. 网络协议\n\n独立说明合成网络协议的用途。\n\n## 参考资料\n\n[资料](https://example.invalid/ref)\n';
const definition = (settings = collection): SourceSplitDefinition => ({
  recipeId: randomUUID(),
  revision: 1,
  name: 'Synthetic recipe',
  scope: {kind: 'source', sourceId: randomUUID()},
  origin: 'manual',
  settings,
});

describe('source-bound split templates', () => {
  it('keeps semantic strategies on the AI route without inventing rule cuts', () => {
    const recipe = {
      ...definition(collection),
      execution: 'ai' as const,
      match: learnSourceStructure([digest]),
    };
    expect(evaluateSourceSplit(digest, recipe)).toMatchObject({
      score: 100,
      plan: {
        outcome: 'ready',
        reason: 'recipe_ai_required',
        groups: [],
        completeCoverage: false,
      },
    });
    expect(
      chooseSourceSplit(digest, {
        engine: SOURCE_SPLIT_ENGINE,
        catalogRevision: 1,
        recipes: [recipe],
      }),
    ).toMatchObject({outcome: 'ai', reason: 'recipe_ready', score: 100});
    const numbered =
      '# Collection\n\n1、First\nComplete first entry.\n\n2、Second\nComplete second entry.\n\n1、Third\nComplete third entry.';
    expect(inspectSourceStructure(numbered).format).toBe('numbered:0');
    expect(planSourceSplit(numbered, collection).reason).toBe(
      'recipe_number_sequence_changed',
    );
    expect(
      planSourceSplit(numbered, {...collection, allowNumberReset: true}).groups,
    ).toHaveLength(3);
  });
  it('scores learned structure rather than topics and keeps equal candidates ambiguous', () => {
    const learned = definition({...collection, onMismatch: 'ai'});
    learned.match = learnSourceStructure([
      digest,
      digest.replaceAll('存储', '园艺'),
    ]);
    const coherent = definition(whole);
    coherent.match = learnSourceStructure([
      '# A guide\n\nA continuous explanation.',
      '# Another\n\nAnother continuous explanation.',
    ]);
    const frozen: FrozenSourceSplit = {
      engine: SOURCE_SPLIT_ENGINE,
      catalogRevision: 1,
      recipes: [learned, coherent],
    };
    expect(
      chooseSourceSplit(digest.replaceAll('协议', '植物'), frozen),
    ).toMatchObject({recipeId: learned.recipeId, score: 100, outcome: 'rule'});
    expect(
      chooseSourceSplit('# A continuous guide\n\nComplete text.', frozen)
        .recipeId,
    ).toBe(coherent.recipeId);
    expect(
      chooseSourceSplit(digest, {
        ...frozen,
        recipes: [learned, {...learned, recipeId: randomUUID()}],
      }),
    ).toMatchObject({outcome: 'ai', reason: 'recipe_match_ambiguous'});
    expect(JSON.stringify(learned.match)).not.toContain('存储');
    expect(
      scoreSourceStructure(
        inspectSourceStructure('# A\n\n## Section\n\nText\n\n## Next\n\nText'),
        learned.match,
      ).score,
    ).toBeLessThan(80);
  });
  it('treats coverage and unclosed code as hard failures even with a perfect structural score', () => {
    const recipe = definition({...collection, onMismatch: 'ai'});
    recipe.match = learnSourceStructure([digest]);
    const broken = digest + '\n```js\nconst incomplete = true;';
    expect(
      chooseSourceSplit(broken, {
        engine: SOURCE_SPLIT_ENGINE,
        catalogRevision: 1,
        recipes: [recipe],
      }),
    ).toMatchObject({
      outcome: 'ai',
      reason: 'recipe_unclosed_code',
      score: 100,
    });
  });
  it('keeps a coherent tutorial and a short plain-text brief intact', () => {
    for (const text of [
      '# Guide\n\n## Preparation\n\nStep one depends on this preparation.\n\n## Results\n\nThese results follow that step.',
      'A short complete synthetic technical finding.',
    ]) {
      const plan = planSourceSplit(text, whole);
      expect(plan).toMatchObject({
        outcome: 'ready',
        completeCoverage: true,
        groups: [{start: 0, end: Array.from(text).length}],
      });
    }
  });
  it('preserves exact Unicode ranges, preface, fenced code and appendices', () => {
    const plan = planSourceSplit(digest, collection);
    expect(plan.outcome).toBe('ready');
    expect(plan.groups.map((g) => g.title)).toEqual(['存储机制', '网络协议']);
    const parts = plan.groups.map((g) =>
      Array.from(digest).slice(g.start, g.end).join(''),
    );
    expect(parts.join('')).toBe(digest);
    expect(parts[0]).toContain('本期前言');
    expect(parts[0]).toContain('代码里的标题');
    expect(parts[1]).toContain('参考资料');
  });
  it('holds a changed numbering sequence and an unexpected collection size', () => {
    expect(
      planSourceSplit(digest.replace('## 2.', '## 1.'), collection).reason,
    ).toBe('recipe_number_sequence_changed');
    expect(
      planSourceSplit(digest, {...collection, minimumEntries: 3}).reason,
    ).toBe('recipe_entry_count_changed');
    expect(
      planSourceSplit(digest.replace('## 2.', '### 2.'), collection).outcome,
    ).toBe('review');
  });
  it('does not treat inline links or bare resource listings as directory articles', () => {
    const settings = {
      ...whole,
      template: 'directory' as const,
      minimumEntries: 2,
    };
    expect(
      planSourceSplit(
        '# Guide\n\nRead [one](https://example.invalid/one) and [two](https://example.invalid/two).',
        settings,
      ).outcome,
    ).toBe('review');
    expect(
      planSourceSplit(
        '## [One](https://example.invalid/one)\n\n## [Two](https://example.invalid/two)',
        settings,
      ).reason,
    ).toBe('recipe_body_too_short');
    expect(
      planSourceSplit(
        '## [One](https://example.invalid/one)\n\nFirst resource has a complete description.\n\n## [Two](https://example.invalid/two)\n\nSecond resource has another complete description.',
        settings,
      ),
    ).toMatchObject({
      outcome: 'ready',
      groups: [{title: 'One'}, {title: 'Two'}],
    });
  });
  it('keeps the 64-entry boundary and never truncates overflow', () => {
    const text = (n: number) =>
      Array.from(
        {length: n},
        (_, i) =>
          `## ${String(i + 1)}. Item\n\nA complete synthetic item ${String(i)}.\n`,
      ).join('\n');
    expect(planSourceSplit(text(64), collection).groups).toHaveLength(64);
    expect(planSourceSplit(text(65), collection)).toMatchObject({
      outcome: 'review',
      groups: [],
      reason: 'recipe_entry_capacity',
    });
  });
  it('does not count an appendix as the missing body of an independent item', () => {
    const text =
      '# Synthetic\n\n## 1. First\n\nA complete first article.\n\n## 2. Empty\n\n## 参考资料\n\nA very long reference list cannot fill in the missing article.';
    expect(
      planSourceSplit(text, {...collection, appendixHeadings: ['参考资料']})
        .reason,
    ).toBe('recipe_body_too_short');
    expect(
      planSourceSplit(
        '## [Link](https://example.invalid/one)\n\n[Reference](https://example.invalid/two)',
        {...whole, template: 'directory', minimumBodyCharacters: 0},
      ).reason,
    ).toBe('recipe_body_too_short');
  });
  it('prioritizes explicit format and document overrides, holds ambiguous matches and uses only opted-in AI fallback', () => {
    const general = definition(whole);
    const specific = definition({...collection, titleIncludes: ['合成周刊']});
    const frozen: FrozenSourceSplit = {
      engine: SOURCE_SPLIT_ENGINE,
      catalogRevision: 1,
      recipes: [general, specific],
    };
    expect(chooseSourceSplit(digest, frozen)).toMatchObject({
      outcome: 'rule',
      recipeId: specific.recipeId,
    });
    const override: SourceSplitDefinition = {
      ...definition(whole),
      scope: {kind: 'document', snapshotId: randomUUID()},
    };
    expect(
      chooseSourceSplit(digest, {
        ...frozen,
        recipes: [...frozen.recipes, override],
      }).recipeId,
    ).toBe(override.recipeId);
    expect(
      chooseSourceSplit(digest, {
        ...frozen,
        recipes: [specific, {...specific, recipeId: randomUUID()}],
      }),
    ).toMatchObject({outcome: 'review', reason: 'recipe_match_ambiguous'});
    const changed = digest.replace('## 2.', '## 4.');
    expect(chooseSourceSplit(changed, frozen).outcome).toBe('review');
    expect(
      chooseSourceSplit(changed, {
        ...frozen,
        recipes: [
          {...specific, settings: {...specific.settings, onMismatch: 'ai'}},
        ],
      }).outcome,
    ).toBe('ai');
    expect(chooseSourceSplit(digest, {...frozen, recipes: []})).toEqual({
      outcome: 'ai',
      reason: 'recipe_not_configured',
    });
  });
});
