export type DecisionPlanValue = { marketState: string; location: string; reasons: string[]; stop: string; target: string; note: string };
export const defaultDecisionReasonTags = ["顺势", "关键位置", "突破回踩", "失败突破", "二次入场", "信号K确认"];
export function mergeLegacyDecisionReasonTags(shared: readonly string[], legacy: readonly string[], deleted: readonly string[]) {
  const hidden = new Set(deleted);
  return [...new Set([...shared, ...legacy.filter(tag => !defaultDecisionReasonTags.includes(tag) && !hidden.has(tag))])].slice(0, 30);
}
export function updateDeletedDecisionReasonTags(previous: readonly string[], next: readonly string[], deleted: readonly string[]) {
  const kept = new Set(next);
  return [...new Set([...deleted, ...previous.filter(tag => !kept.has(tag))])].filter(tag => !kept.has(tag));
}
export type DecisionReasonTagChanges = { added: string[]; removed: string[] };
export function isDecisionReasonTagChanges(value: unknown): value is DecisionReasonTagChanges {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const changes = value as Partial<DecisionReasonTagChanges>;
  const valid = (tags: unknown): tags is string[] => Array.isArray(tags) && tags.length <= 30
    && tags.every(tag => typeof tag === "string" && tag.length > 0 && tag.length <= 20 && tag.trim() === tag);
  return valid(changes.added) && valid(changes.removed) && !changes.added.some(tag => changes.removed!.includes(tag));
}
export function mergeSavedDecisionReasonTags(incoming: Record<string, unknown>, existing: unknown, changes?: DecisionReasonTagChanges) {
  const stored = existing && typeof existing === "object" && !Array.isArray(existing) ? existing as Record<string, unknown> : {};
  const hasStoredTags = Array.isArray(stored.reasonTags) || Array.isArray(stored.customReasonTags);
  const source = hasStoredTags ? stored : incoming;
  const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];
  if (!hasStoredTags && !Array.isArray(source.reasonTags) && !Array.isArray(source.customReasonTags) && !changes) return incoming;
  const previous = Array.isArray(source.reasonTags) ? strings(source.reasonTags) : [...defaultDecisionReasonTags, ...strings(source.customReasonTags)];
  const added = new Set(changes?.added ?? []);
  const deletedReasonTags = [...new Set([...strings(source.deletedReasonTags), ...(changes?.removed ?? [])])].filter(tag => !added.has(tag));
  const hidden = new Set(deletedReasonTags);
  const reasonTags = [...new Set([...previous, ...added])].filter(tag => !hidden.has(tag));
  if (reasonTags.length > 30) throw new Error("最多保留 30 个理由标签，请先删除不用的标签");
  return { ...incoming, reasonTags, customReasonTags: reasonTags.filter(tag => !defaultDecisionReasonTags.includes(tag)), deletedReasonTags };
}
export function decisionPlanScore(value: DecisionPlanValue) {
  return [value.marketState, value.location, value.stop, value.target].filter(Boolean).length * 15 + Math.min(new Set(value.reasons).size, 2) * 20;
}
