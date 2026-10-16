import type { PersistedDrawing } from "../../components/KLineReplayChart";
import { decisionPlanScore, defaultDecisionReasonTags } from "../../lib/decisionPlan.ts";

export type Mt4DecisionDraft = { marketState: string; location: string; reasons: string[]; stopLoss: string; takeProfit: string; note: string };
export type Mt4Decision = { id: string; recordedAt: number; candleTimestamp: number; referencePrice: number; draft: Mt4DecisionDraft; drawings: PersistedDrawing[]; backfilled?: boolean; updatedAt?: number };
export type Mt4Analysis = { version: 1; draft: Mt4DecisionDraft; reasonTags: string[]; drawings: PersistedDrawing[]; decisions: Mt4Decision[];
  editor?: { decisionId?: string; candleTimestamp: number; referencePrice: number; originalDraft: Mt4DecisionDraft } };
export const defaultReasonTags = defaultDecisionReasonTags;

export function analysisKey(accountKey: string, symbol: string, timeframe: number) {
  return `kline.mt4.analysis.v1:${encodeURIComponent(accountKey)}:${encodeURIComponent(symbol)}:${timeframe}`;
}
export function emptyAnalysis(): Mt4Analysis {
  return { version: 1, draft: { marketState: "", location: "", reasons: [], stopLoss: "", takeProfit: "", note: "" }, reasonTags: [...defaultReasonTags], drawings: [], decisions: [] };
}
function normalizeDraft(value: unknown): Mt4DecisionDraft {
  const draft = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: string, limit = 100) => typeof draft[key] === "string" ? draft[key].slice(0, limit) : "";
  return { marketState: text("marketState"), location: text("location"), stopLoss: text("stopLoss"), takeProfit: text("takeProfit"), note: text("note", 4000),
    reasons: Array.isArray(draft.reasons) ? [...new Set(draft.reasons.filter((r): r is string => typeof r === "string").map(r => r.trim().slice(0, 100)).filter(Boolean))].slice(0, 30) : [] };
}
function normalizeDrawings(value: unknown): PersistedDrawing[] {
  if (!Array.isArray(value)) return [];
  return value.filter((d): d is PersistedDrawing => d && typeof d === "object" && typeof d.id === "string" && typeof d.name === "string" && typeof d.paneId === "string"
    && typeof d.lock === "boolean" && typeof d.visible === "boolean" && Number.isFinite(d.zLevel) && ["normal", "weak_magnet", "strong_magnet"].includes(d.mode)
    && Array.isArray(d.points) && d.points.length <= 1000 && d.points.every((p: Record<string, unknown>) => p && typeof p === "object"
      && ["timestamp", "dataIndex", "value"].every(k => p[k] == null || (typeof p[k] === "number" && Number.isFinite(p[k]))))).slice(0, 100);
}
export function readAnalysis(raw: string | null): Mt4Analysis {
  if (!raw) return emptyAnalysis();
  const data = JSON.parse(raw);
  if (!data || data.version !== 1) throw new Error("绘图与决策记录版本无法读取，请保留原记录后重试。");
  const draft = normalizeDraft(data.draft);
  return { version: 1, draft, reasonTags: Array.isArray(data.reasonTags) ? [...new Set(data.reasonTags.filter((r: unknown): r is string => typeof r === "string" && Boolean(r.trim())))].slice(0, 30) as string[] : [...new Set([...defaultReasonTags, ...draft.reasons])], drawings: normalizeDrawings(data.drawings),
    ...(data.editor && Number.isFinite(data.editor.candleTimestamp) && data.editor.candleTimestamp > 0 && Number.isFinite(data.editor.referencePrice) && data.editor.referencePrice > 0
      ? { editor: { ...(typeof data.editor.decisionId === "string" ? { decisionId: data.editor.decisionId } : {}), candleTimestamp: data.editor.candleTimestamp, referencePrice: data.editor.referencePrice, originalDraft: normalizeDraft(data.editor.originalDraft) } } : {}),
    decisions: (Array.isArray(data.decisions) ? data.decisions : []).filter((d: Mt4Decision) => d && typeof d.id === "string" && Number.isFinite(d.recordedAt)
      && d.candleTimestamp > 0 && Number.isFinite(d.candleTimestamp) && d.referencePrice > 0 && Number.isFinite(d.referencePrice))
      .map((d: Mt4Decision) => ({ id: d.id, recordedAt: d.recordedAt, candleTimestamp: d.candleTimestamp, referencePrice: d.referencePrice, draft: normalizeDraft(d.draft), drawings: normalizeDrawings(d.drawings),
        ...(d.backfilled ? { backfilled: true } : {}), ...(Number.isFinite(d.updatedAt) ? { updatedAt: d.updatedAt } : {}) })) };
}
export function decisionScore(draft: Mt4DecisionDraft) {
  return decisionPlanScore({ ...draft, stop: draft.stopLoss, target: draft.takeProfit });
}
function validatedDraft(value: Mt4DecisionDraft) {
  const draft = normalizeDraft(value);
  if (![draft.marketState, draft.location, draft.stopLoss, draft.takeProfit, draft.note.trim()].some(Boolean) && !draft.reasons.length) throw new Error("决策内容为空，请先填写计划。");
  for (const [label, value] of [["止损", draft.stopLoss], ["目标", draft.takeProfit]]) {
    if (value.trim() && (!Number.isFinite(Number(value)) || Number(value) <= 0)) throw new Error(`${label}价格需大于 0，或留空。`);
  }
  return draft;
}
export function recordDecision(state: Mt4Analysis, evidence: Pick<Mt4Decision, "id" | "recordedAt" | "candleTimestamp" | "referencePrice" | "backfilled">): Mt4Analysis {
  const draft = validatedDraft(state.draft);
  if (!(evidence.candleTimestamp > 0) || !Number.isFinite(evidence.candleTimestamp) || !(evidence.referencePrice > 0) || !Number.isFinite(evidence.referencePrice)) throw new Error("请等待当前图表行情返回后保存决策。");
  const decision = JSON.parse(JSON.stringify({ ...evidence, draft, drawings: state.drawings })) as Mt4Decision;
  return { ...state, decisions: [decision, ...state.decisions] };
}
export function addReasonTag(state: Mt4Analysis, value: string): Mt4Analysis {
  const tag = value.trim().replace(/\s+/g, " ").slice(0, 20);
  if (!tag) throw new Error("标签不能为空。");
  if (!state.reasonTags.includes(tag) && state.reasonTags.length >= 30) throw new Error("最多保留 30 个理由标签，请先删除不用的标签。");
  return { ...state, reasonTags: [...new Set([...state.reasonTags, tag])], draft: { ...state.draft, reasons: [...new Set([...state.draft.reasons, tag])] } };
}
export function renameReasonTag(state: Mt4Analysis, previous: string, value: string): Mt4Analysis {
  const tag = value.trim().replace(/\s+/g, " ").slice(0, 20);
  if (!tag || state.reasonTags.some(r => r !== previous && r === tag)) throw new Error("标签不能为空，也不能与已有标签重名。");
  return { ...state, reasonTags: state.reasonTags.map(r => r === previous ? tag : r), draft: { ...state.draft, reasons: state.draft.reasons.map(r => r === previous ? tag : r) } };
}
export function removeReasonTag(state: Mt4Analysis, tag: string): Mt4Analysis {
  return { ...state, reasonTags: state.reasonTags.filter(r => r !== tag), draft: { ...state.draft, reasons: state.draft.reasons.filter(r => r !== tag) } };
}
export function editDecisionRecord(state: Mt4Analysis, id: string, value: Mt4DecisionDraft, updatedAt: number): Mt4Analysis {
  const draft = validatedDraft(value);
  if (!state.decisions.some(d => d.id === id)) throw new Error("这份决策已不存在，请重新读取记录。");
  return { ...state, decisions: state.decisions.map(d => d.id === id ? { ...d, draft, updatedAt } : d) };
}
export function deleteDecisionRecord(state: Mt4Analysis, id: string): Mt4Analysis {
  return { ...state, decisions: state.decisions.filter(d => d.id !== id) };
}
export function applyAnalysisDrawings(state: Mt4Analysis, drawings: PersistedDrawing[], digits: number): Mt4Analysis {
  const position = [...drawings].reverse().find(d => d.name === "trainingPosition" && d.points.length >= 3);
  const hadPosition = state.drawings.some(d => d.name === "trainingPosition");
  const target = Number(position?.points[1]?.value), stop = Number(position?.points[2]?.value);
  return { ...state, drawings, draft: position || hadPosition ? { ...state.draft,
    takeProfit: Number.isFinite(target) ? target.toFixed(digits) : "", stopLoss: Number.isFinite(stop) ? stop.toFixed(digits) : "" } : state.draft };
}
