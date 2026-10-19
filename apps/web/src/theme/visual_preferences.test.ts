import {describe, expect, it} from 'vitest';
import {
  DEFAULT_VISUAL_PREFERENCES,
  parseVisualPreferences,
} from './visual_preferences.js';

describe('browser appearance preferences', () => {
  it('keeps the accepted appearance when preferences are absent or unreadable', () => {
    for (const raw of [null, '', '{', 'null', '[]', '"theme"'])
      expect(parseVisualPreferences(raw)).toEqual(DEFAULT_VISUAL_PREFERENCES);
  });
  it('retains explicit off switches and zero glow when loading partial settings', () => {
    expect(
      parseVisualPreferences('{"glow":0,"motion":false,"glass":false}'),
    ).toEqual({
      ...DEFAULT_VISUAL_PREFERENCES,
      glow: 0,
      motion: false,
      glass: false,
    });
  });
  it('bounds numeric settings and rejects wrong types without losing valid fields', () => {
    expect(
      parseVisualPreferences(
        '{"glow":200,"readingSize":4,"glass":"false","motion":false}',
      ),
    ).toEqual({
      ...DEFAULT_VISUAL_PREFERENCES,
      glow: 100,
      readingSize: 15,
      motion: false,
    });
    expect(
      parseVisualPreferences('{"glow":null,"readingSize":1000}'),
    ).toMatchObject({glow: 100, readingSize: 24});
  });
});
