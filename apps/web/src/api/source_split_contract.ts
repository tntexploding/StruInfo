export interface SourceSplitSettings {
  template: 'whole' | 'numbered' | 'headings' | 'directory';
  headingLevel: number;
  titleIncludes: string[];
  appendixHeadings: string[];
  minimumEntries: number;
  maximumEntries: number;
  minimumBodyCharacters: number;
  onMismatch: 'review' | 'ai';
}
export interface SourceSplitDefinition {
  recipeId: string;
  revision: number;
  name: string;
  scope:
    {kind: 'source'; sourceId: string} | {kind: 'document'; snapshotId: string};
  settings: SourceSplitSettings;
  origin: 'manual' | 'model';
}
export interface SourceSplitRecipe extends SourceSplitDefinition {
  status: 'draft' | 'trial' | 'enabled' | 'paused' | 'replaced';
  replaces: string | null;
  approval: {note: string; at: string} | null;
  trials: {
    snapshotId: string;
    recipeRevision: number;
    sampleKind: 'typical' | 'variant' | 'exception';
    expected: 'ready' | 'review';
    outcome: 'ready' | 'review';
    entryCount: number;
    reason: string;
  }[];
}
export interface SourceSplitCatalogView {
  revision: number;
  sourceId: string | null;
  recipes: SourceSplitRecipe[];
}
export interface SourceSplitPlan {
  outcome: 'ready' | 'review';
  reason: string;
  characters: number;
  completeCoverage: boolean;
  groups: {title: string; start: number; end: number}[];
}
