import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFavoriteSymbols, groupFavoriteSymbols } from "../app/lib/symbolFavorites.ts";
import { decisionPlanScore } from "../app/lib/decisionPlan.ts";
import { readFile } from "node:fs/promises";

test("favorites appear first without changing broker symbols or catalogue order", () => {
  const symbols = [{ symbol: "EURUSD.a" }, { symbol: "XAUUSD+" }, { symbol: "USDJPY" }];
  const grouped = groupFavoriteSymbols(symbols, ["USDJPY", "XAUUSD+", "missing"]);
  assert.deepEqual(grouped.favorites.map(s => s.symbol), ["XAUUSD+", "USDJPY"]);
  assert.deepEqual(grouped.others.map(s => s.symbol), ["EURUSD.a"]);
  assert.deepEqual(symbols.map(s => s.symbol), ["EURUSD.a", "XAUUSD+", "USDJPY"]);
});
test("training and MT4 compose the same analysis controls instead of copied forms", async () => {
  const [training, mt4Panel, mt4Chart, decision] = await Promise.all([
    readFile(new URL("../app/components/TrainingWorkbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/features/mt4/components/Mt4Panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/features/mt4/components/Mt4ChartWorkbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/DecisionPlanCard.tsx", import.meta.url), "utf8"),
  ]);
  for (const name of ["DecisionPlanCard", "ChartDrawingRail", "DrawingObjectPanel", "DrawingPropertyBar", "ChartDrawingTextEditor"]) {
    assert.match(training, new RegExp(`<${name}\\b`)); assert.match(mt4Chart, new RegExp(`<${name}\\b`));
  }
  for (const name of ["ChartTimeframePicker", "ChartIndicatorMenu", "OrderEntryControls", "OrderEntryActions"]) {
    assert.match(training, new RegExp(`<${name}\\b`)); assert.match(mt4Panel, new RegExp(`<${name}\\b`));
  }
  assert.doesNotMatch(training, /function ChartIndicatorEditor\(/);
  assert.doesNotMatch(training, /<label>市场状态/);
  assert.doesNotMatch(mt4Chart, /<label>市场状态/);
  assert.doesNotMatch(mt4Chart, /movingAverageSettings=\{defaultMovingAverageSettings\}/);
  assert.doesNotMatch(decision, /priceMode|priceStep/);
  assert.match(decision, /className=\{`decision-price-level/);
});
test("favorite storage tolerates invalid entries and retains unavailable names", () => {
  assert.deepEqual(normalizeFavoriteSymbols(["XAUUSD", "XAUUSD", "EURUSD.a", null, 1, "", "missing"]), ["XAUUSD", "EURUSD.a", "missing"]);
  assert.deepEqual(normalizeFavoriteSymbols(undefined), []);
});
test("shared decision score measures the same completed fields and independent reasons", () => {
  const plan = { marketState: "趋势", location: "回调位置", stop: "10", target: "20", note: "", reasons: ["顺势", "顺势"] };
  assert.equal(decisionPlanScore(plan), 80);
  assert.equal(decisionPlanScore({ ...plan, reasons: ["顺势", "关键位置"] }), 100);
});
