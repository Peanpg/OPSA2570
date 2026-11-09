export type LoadStatus = { facility_id: string; completed: number; updated_at: string; revision: string };
export type Change = { id: string; completed: boolean; expectedRevision: string | null };
export function parseChange(value: unknown, ids: Set<string>): Change | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !ids.has(v.id) || typeof v.completed !== "boolean" || !(v.expectedRevision === null || (typeof v.expectedRevision === "string" && v.expectedRevision.length > 0 && v.expectedRevision.length <= 80))) return null;
  return { id: v.id, completed: v.completed, expectedRevision: v.expectedRevision as string | null };
}
export function sameDesiredState(current: LoadStatus | null, desired: boolean) {
  return current !== null && Boolean(current.completed) === desired;
}
