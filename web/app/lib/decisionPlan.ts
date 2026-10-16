export type DecisionPlanValue = { marketState: string; location: string; reasons: string[]; stop: string; target: string; note: string };
export const defaultDecisionReasonTags = ["顺势", "关键位置", "突破回踩", "失败突破", "二次入场", "信号K确认"];
export function decisionPlanScore(value: DecisionPlanValue) {
  return [value.marketState, value.location, value.stop, value.target].filter(Boolean).length * 15 + Math.min(new Set(value.reasons).size, 2) * 20;
}
