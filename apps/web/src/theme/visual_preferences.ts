export interface VisualPreferences {
  readonly glow: number;
  readonly glass: boolean;
  readonly motion: boolean;
  readonly flowMotion: boolean;
  readonly readingSize: number;
  readonly readingMeasure: number;
}

export const VISUAL_PREFERENCES_KEY = 'struinfo.visual-preferences.v1';
export const DEFAULT_VISUAL_PREFERENCES: Readonly<VisualPreferences> = {
  glow: 100,
  glass: true,
  motion: true,
  flowMotion: true,
  readingSize: 17,
  readingMeasure: 78,
};

export function parseVisualPreferences(raw: string | null): VisualPreferences {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return {...DEFAULT_VISUAL_PREFERENCES};
    const fields = value as Record<string, unknown>;
    const number = (
      key: 'glow' | 'readingSize' | 'readingMeasure',
      min: number,
      max: number,
    ) => {
      const n = fields[key];
      return typeof n === 'number' && Number.isFinite(n)
        ? Math.max(min, Math.min(max, Math.round(n)))
        : DEFAULT_VISUAL_PREFERENCES[key];
    };
    const flag = (key: 'glass' | 'motion' | 'flowMotion') =>
      typeof fields[key] === 'boolean'
        ? fields[key]
        : DEFAULT_VISUAL_PREFERENCES[key];
    return {
      glow: number('glow', 0, 100),
      glass: flag('glass'),
      motion: flag('motion'),
      flowMotion: flag('flowMotion'),
      readingSize: number('readingSize', 15, 24),
      readingMeasure: number('readingMeasure', 48, 110),
    };
  } catch {
    return {...DEFAULT_VISUAL_PREFERENCES};
  }
}

export function loadVisualPreferences(): VisualPreferences {
  try {
    return parseVisualPreferences(localStorage.getItem(VISUAL_PREFERENCES_KEY));
  } catch {
    return {...DEFAULT_VISUAL_PREFERENCES};
  }
}
