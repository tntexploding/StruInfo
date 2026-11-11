import {z} from 'zod';

const featureNames = [
  'headingLevel',
  'sectionCount',
  'numberedRatio',
  'linkedRatio',
] as const;
export const sourceStructureMatchSchema = z
  .object({
    minimumScore: z.number().min(1).max(100).optional(),
    conditions: z
      .array(
        z
          .object({
            feature: z.enum(featureNames),
            min: z.number().min(0).max(32000),
            max: z.number().min(0).max(32000),
            weight: z.number().min(1).max(100),
          })
          .strict()
          .refine((v) => v.min <= v.max),
      )
      .min(1)
      .max(4),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.conditions.map((c) => c.feature)).size === v.conditions.length,
  );
export type SourceStructureMatch = z.infer<typeof sourceStructureMatchSchema>;
export interface SourceStructure {
  headingLevel: number;
  sectionCount: number;
  numberedRatio: number;
  linkedRatio: number;
  format: string;
}

/** Only syntax and positions. Topics, names and document prose are not retained. */
export function inspectSourceStructure(text: string): SourceStructure {
  let fence = '';
  const rows: {level: number; numbered: boolean; linked: boolean}[] = [];
  for (const line of text.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (
        marker.startsWith(fence.charAt(0)) &&
        marker.length >= fence.length
      )
        fence = '';
      continue;
    }
    if (fence || /^(?: {4}|\t|\s*>)/u.test(line)) continue;
    const heading = /^ {0,3}(#{1,6})\s+(.+)/u.exec(line);
    const numbered = /^ {0,3}(?:#{1,6}\s+)?\d{1,4}(?:[.)]\s+|、\s*)(.+)/u.exec(
      line,
    );
    const linked =
      /^ {0,3}(?:#{1,6}\s+|\d{1,4}(?:[.)]\s+|、\s*))\[[^\]]+\]\(https?:\/\/[^\s)]+\)/u.test(
        line,
      );
    if (heading || numbered)
      rows.push({
        level: heading?.[1]?.length ?? 0,
        numbered: Boolean(numbered),
        linked,
      });
  }
  const candidates = rows.filter((r) => r.level !== 1);
  const level =
    [0, 2, 3, 4, 5, 6].find(
      (n) => candidates.filter((r) => r.level === n).length >= 2,
    ) ?? 0;
  const sections = candidates.filter((r) => r.level === level);
  const count = sections.length;
  const numberedRatio = count
    ? sections.filter((r) => r.numbered).length / count
    : 0;
  const linkedRatio = count
    ? sections.filter((r) => r.linked).length / count
    : 0;
  const family =
    count < 2
      ? 'whole'
      : linkedRatio >= 0.5
        ? 'directory'
        : numberedRatio >= 0.5
          ? 'numbered'
          : 'headings';
  return {
    headingLevel: level,
    sectionCount: count,
    numberedRatio,
    linkedRatio,
    format: `${family}:${String(level)}`,
  };
}

export function learnSourceStructure(
  texts: readonly string[],
): SourceStructureMatch {
  const structures = texts.map(inspectSourceStructure);
  if (!structures.length) throw new Error('source_samples_required');
  return {
    conditions: featureNames.map((feature) => {
      const values = structures.map((s) => s[feature]);
      const low = Math.min(...values),
        high = Math.max(...values);
      const tolerance =
        feature === 'sectionCount'
          ? Math.max(1, Math.ceil(high * 0.25))
          : feature.endsWith('Ratio')
            ? 0.1
            : 0;
      return {
        feature,
        min: Math.max(0, low - tolerance),
        max: Math.min(feature.endsWith('Ratio') ? 1 : 32000, high + tolerance),
        weight: feature.endsWith('Ratio') ? 30 : 20,
      };
    }),
  };
}

export function scoreSourceStructure(
  structure: SourceStructure,
  match: SourceStructureMatch,
) {
  const checks = match.conditions.map((c) => {
    const actual = structure[c.feature];
    const distance =
      actual < c.min ? c.min - actual : actual > c.max ? actual - c.max : 0;
    const scale = c.feature.endsWith('Ratio')
      ? 0.25
      : c.feature === 'headingLevel'
        ? 1
        : Math.max(1, c.max - c.min);
    const fit = Math.max(0, 1 - distance / scale);
    return {...c, actual, fit};
  });
  const total = checks.reduce((n, c) => n + c.weight, 0);
  return {
    score: Math.round(
      (checks.reduce((n, c) => n + c.weight * c.fit, 0) / total) * 100,
    ),
    checks,
  };
}

/** Select evenly across capture time, then give every observed format a turn. */
export function spreadSourceSamples<T>(rows: readonly T[], limit: number): T[] {
  if (rows.length <= limit) return [...rows];
  return Array.from(
    {length: limit},
    (_, i) => rows[Math.round((i * (rows.length - 1)) / (limit - 1))],
  ).filter((v): v is T => v !== undefined);
}
