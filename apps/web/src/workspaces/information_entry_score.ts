export function formatBasisPointPercentage(value: number): string {
  return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 1)}%`;
}

export function formatRuleSimilarity(
  projection: Readonly<{baseScore: number}> | undefined,
): string {
  return projection === undefined
    ? '未计算规则相似度'
    : `规则相似度 ${formatBasisPointPercentage(projection.baseScore)}`;
}
