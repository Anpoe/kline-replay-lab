import assert from "node:assert/strict";
import test from "node:test";
import * as analysis from "../app/features/mt4/mt4Analysis.ts";
const draft = { marketState: "趋势", location: "回调位置", reasons: ["顺势", "关键位置"], stopLoss: "1.09", takeProfit: "1.12", note: "等待回调确认" };

test("MT4 analysis separates accounts, symbols and chart periods", () => {
  const key = analysis.analysisKey("account-a", "EURUSD.a", 5);
  assert.notEqual(key, analysis.analysisKey("account-b", "EURUSD.a", 5));
  assert.notEqual(key, analysis.analysisKey("account-a", "XAUUSD", 5));
  assert.notEqual(key, analysis.analysisKey("account-a", "EURUSD.a", 15));
});
test("decision captures an immutable plan, drawings and visible candle evidence", () => {
  const state = analysis.emptyAnalysis(); state.draft = structuredClone(draft);
  const next = analysis.recordDecision(state, { id: "decision-1", recordedAt: 1000, candleTimestamp: 900, referencePrice: 1.1 });
  state.draft.reasons.push("追加理由"); state.draft.note = "改写草稿";
  assert.deepEqual(next.decisions[0].draft, draft);
  assert.equal(next.decisions[0].candleTimestamp, 900);
  assert.equal(next.decisions[0].referencePrice, 1.1);
  assert.equal(state.decisions.length, 0);
  assert.deepEqual(analysis.readAnalysis(JSON.stringify(next)), next);
});
test("decision accepts partial plans like training, but rejects empty plans and invalid prices", () => {
  const state = analysis.emptyAnalysis();
  assert.throws(() => analysis.recordDecision(state, {}), /内容为空/);
  state.draft = { ...draft, reasons: ["顺势", "顺势"] };
  assert.equal(analysis.decisionScore(state.draft), 80);
  state.draft = { ...draft, stopLoss: "-1" };
  assert.throws(() => analysis.recordDecision(state, {}), /止损/);
  state.draft = { ...draft, stopLoss: "", takeProfit: "" };
  assert.throws(() => analysis.recordDecision(state, { candleTimestamp: 0, referencePrice: 0 }), /行情/);
});
test("analysis restores old storage and retains all saved decisions", () => {
  assert.deepEqual(analysis.readAnalysis(null), analysis.emptyAnalysis());
  assert.throws(() => analysis.readAnalysis("broken"));
  assert.throws(() => analysis.readAnalysis('{"version":2}'), /版本/);
  let state = analysis.emptyAnalysis(); state.draft = draft;
  for (let i = 0; i < 25; i++) state = analysis.recordDecision(state, { id: String(i), recordedAt: i + 1, candleTimestamp: 900, referencePrice: 1.1 });
  assert.equal(state.decisions.length, 25);
  assert.equal(state.decisions[0].id, "24");
  assert.equal(state.decisions.at(-1).id, "0");
  assert.equal(analysis.readAnalysis(JSON.stringify(state)).decisions.length, 25);
  const old = { version: 1, draft: { ...draft, reasons: ["自定义"] }, drawings: [], decisions: [] };
  assert.ok(analysis.readAnalysis(JSON.stringify(old)).reasonTags.includes("自定义"));
});
test("tag management persists deselected custom labels and preserves saved wording", () => {
  let state = analysis.emptyAnalysis(); state.draft = structuredClone(draft);
  state = analysis.recordDecision(state, { id: "one", recordedAt: 1000, candleTimestamp: 900, referencePrice: 1.1 });
  state = analysis.addReasonTag(state, "  新 理由  ");
  assert.ok(state.reasonTags.includes("新 理由"));
  state = analysis.renameReasonTag(state, "顺势", "顺大趋势");
  assert.ok(state.draft.reasons.includes("顺大趋势"));
  assert.ok(state.decisions[0].draft.reasons.includes("顺势"));
  assert.throws(() => analysis.renameReasonTag(state, "顺大趋势", "关键位置"), /重名/);
  state = analysis.removeReasonTag(state, "顺大趋势");
  assert.ok(!state.reasonTags.includes("顺大趋势"));
  assert.ok(!state.draft.reasons.includes("顺大趋势"));
  assert.ok(analysis.readAnalysis(JSON.stringify(state)).reasonTags.includes("新 理由"));
});
test("editing preserves original candle binding and deleting targets one record", () => {
  let state = analysis.emptyAnalysis(); state.draft = structuredClone(draft);
  state = analysis.recordDecision(state, { id: "one", recordedAt: 1000, candleTimestamp: 900, referencePrice: 1.1, backfilled: true });
  const next = analysis.editDecisionRecord(state, "one", { ...draft, note: "修订说明" }, 2000);
  assert.equal(next.decisions.length, 1);
  assert.equal(next.decisions[0].recordedAt, 1000);
  assert.equal(next.decisions[0].candleTimestamp, 900);
  assert.equal(next.decisions[0].backfilled, true);
  assert.equal(next.decisions[0].updatedAt, 2000);
  assert.equal(state.decisions[0].draft.note, draft.note);
  assert.equal(analysis.deleteDecisionRecord(next, "one").decisions.length, 0);
});
test("position drawing synchronizes target and stop, including deletion and undo", () => {
  const drawing = { id: "p", name: "trainingPosition", points: [{ value: 1.1 }, { value: 1.12 }, { value: 1.09 }] };
  const state = analysis.emptyAnalysis();
  const next = analysis.applyAnalysisDrawings(state, [drawing], 5);
  assert.equal(next.draft.takeProfit, "1.12000");
  assert.equal(next.draft.stopLoss, "1.09000");
  const removed = analysis.applyAnalysisDrawings(next, [], 5);
  assert.equal(removed.draft.stopLoss, "");
  assert.equal(analysis.applyAnalysisDrawings(removed, [drawing], 5).draft.stopLoss, "1.09000");
});
