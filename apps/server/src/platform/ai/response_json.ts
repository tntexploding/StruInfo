/** Remove only a complete, single JSON code fence. Syntax and schema validation
 * still reject prose, multiple values, broken JSON and unrequested fields. */
export function parseResponseJson(text: string): unknown {
  const source = text.trim();
  const fenced = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/iu.exec(source);
  return JSON.parse(fenced?.[1] ?? source) as unknown;
}
