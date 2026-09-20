export interface IntakeOrigin {
  snapshotId: string;
  subscriptionId?: string;
  kind: string;
}
export function isManualIntakeOrigin(
  origin: IntakeOrigin | undefined,
): boolean {
  return Boolean(
    origin && ['upload', 'uploaded_file', 'manual_text'].includes(origin.kind),
  );
}
export function matchesIntakeSource(
  origin: IntakeOrigin | undefined,
  sourceId: string,
  subscriptionIds: ReadonlySet<string>,
): boolean {
  if (sourceId === 'all') return true;
  if (!origin) return false;
  if (sourceId === 'manual') return isManualIntakeOrigin(origin);
  if (sourceId === 'other')
    return (
      !isManualIntakeOrigin(origin) &&
      (!origin.subscriptionId || !subscriptionIds.has(origin.subscriptionId))
    );
  return origin.subscriptionId === sourceId;
}
