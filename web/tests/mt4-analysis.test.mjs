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
test("tag rename follows training history updates; deletion preserves recorded wording", () => {
  let state = analysis.emptyAnalysis(); state.draft = structuredClone(draft);
  state = analysis.recordDecision(state, { id: "one", recordedAt: 1000, candleTimestamp: 900, referencePrice: 1.1 });
  state = analysis.addReasonTag(state, "  新 理由  ");
  assert.ok(state.reasonTags.includes("新 理由"));
  state = analysis.renameReasonTag(state, "顺势", "顺大趋势");
  assert.ok(state.draft.reasons.includes("顺大趋势"));
  assert.ok(state.decisions[0].draft.reasons.includes("顺大趋势"));
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

test('explicit trade links keep account, symbol and order identity, survive reload and clean up on decision deletion',()=>{let state=analysis.emptyAnalysis();state.draft=structuredClone(draft);state=analysis.recordDecision(state,{id:'one',recordedAt:1000,candleTimestamp:900,referencePrice:1.1});state=analysis.linkDecisionTrade(state,'one',{accountKey:'a',symbol:'EURUSD.a',ticket:10,openTime:9});state=analysis.linkDecisionTrade(state,'one',{accountKey:'b',symbol:'EURUSD.a',ticket:10,openTime:9});state=analysis.linkDecisionTrade(state,'one',{accountKey:'a',symbol:'XAUUSD',ticket:10,openTime:9});assert.equal(state.tradeLinks.length,3);assert.equal(analysis.readAnalysis(JSON.stringify(state)).tradeLinks.length,3);assert.equal(analysis.linkDecisionTrade(state,'one',{accountKey:'a',symbol:'EURUSD.a',ticket:10,openTime:9}).tradeLinks.length,3);assert.equal(analysis.deleteDecisionRecord(state,'one').tradeLinks.length,0);});

test('entry receipts associate only confirmed identities and are idempotent without overwriting an edited draft',()=>{let state=analysis.emptyAnalysis();state.draft={...draft,note:'正在写下一份'};const receipt={commandId:'cmd',accountKey:'a',symbol:'EURUSD.a',timeframe:5,ticket:9,openTime:10,candleTimestamp:900,referencePrice:1.1,draft};const next=analysis.applyEntryReceipt(state,receipt);assert.equal(next.decisions.length,1);assert.equal(next.decisions[0].autoGenerated,true);assert.equal(next.tradeLinks[0].ticket,9);assert.equal(next.draft.note,'正在写下一份');assert.strictEqual(analysis.applyEntryReceipt(next,receipt),next);const manual=analysis.recordDecision(next,{id:'manual',recordedAt:2000,candleTimestamp:900,referencePrice:1.1});assert.equal(manual.decisions.length,1);assert.equal(manual.decisions[0].id,next.decisions[0].id);assert.equal(manual.tradeLinks[0].decisionId,manual.decisions[0].id);});

test('two confirmed entries on one candle reuse the automatic decision and retain both exact links',()=>{const first={commandId:'c1',accountKey:'a',symbol:'EURUSD',timeframe:5,ticket:1,openTime:10,candleTimestamp:900,referencePrice:1.1,draft};const next=analysis.applyEntryReceipt(analysis.applyEntryReceipt(analysis.emptyAnalysis(),first),{...first,commandId:'c2',ticket:2,openTime:11});assert.equal(next.decisions.length,1);assert.equal(next.decisions[0].autoGenerated,true);assert.equal(next.tradeLinks.length,2);assert.ok(next.tradeLinks.every(link=>link.decisionId===next.decisions[0].id));});

test("saved empty drafts stay empty when an unrelated annotation changes", () => {
  const position={id:'p',name:'trainingPosition',points:[{value:15},{value:20},{value:10}]};
  const state={...analysis.emptyAnalysis(),drawings:[position]};
  const next=analysis.applyAnalysisDrawings(state,[position,{id:'note',name:'trainingTextNote',points:[{value:16}]}],2);
  assert.equal(next.draft,state.draft);
  assert.equal(next.draft.stopLoss,'');
  assert.equal(next.draft.takeProfit,'');
});

test("historical backfills do not replace an automatic pretrade plan on the same candle", () => {
  const state=analysis.emptyAnalysis();state.draft=structuredClone(draft);
  const automatic=analysis.ensureProtectiveAnalysis(state,{id:'automatic',recordedAt:1000,candleTimestamp:900,referencePrice:1.1});
  const next=analysis.recordDecision(automatic,{id:'backfill',recordedAt:2000,candleTimestamp:900,referencePrice:1.1,backfilled:true});
  assert.equal(next.decisions.length,2);
  assert.equal(next.decisions[0].id,'backfill');
  assert.equal(next.decisions[0].backfilled,true);
  assert.equal(next.decisions[1].id,'automatic');
});
