import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { defaultReviewSessionFilters } from "../app/features/review/reviewContracts.ts";
import * as controller from "../app/features/review/reviewController.ts";

const source = ts.createSourceFile("workbench.tsx", readFileSync(new URL("../app/components/TrainingWorkbench.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "deleteTrainingSessions") callback = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback);
const compiled = ts.transpileModule(`const cleanup = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function cleanupFixture({ fail = [], confirm = true, active = "other" } = {}) {
  let summaries = ["a", "b", "c"].map((id, index) => ({ session: { id }, hasMeaningfulActivity: index === 1 }));
  const requests = [], statuses = [], confirmations = [];
  let navigator = summaries.map(item => item.session), reviewed = { session: { id: "a" } }, draftRemoved = false, resets = 0, busy = false;
  const scope = {
    sessionCleanupRunningRef: { current: false },
    sessionId: active,
    window: { confirm: message => { confirmations.push(message); return confirm; } },
    setEmptySessionCleanupRunning: value => { busy = value; },
    setSessionSummaries: update => { summaries = update(summaries); },
    setSessionCleanupStatus: value => statuses.push(value),
    reviewGateway: { deleteSession: async id => { requests.push(id); if (fail.includes(id)) throw Error("offline"); } },
    compareTrainingSessionSummariesByCreatedAt: (a, b) => a.session.id.localeCompare(b.session.id),
    setTrainingNavigatorSessions: update => { navigator = update(navigator); },
    reviewedSession: reviewed,
    setReviewedSession: value => { reviewed = value; },
    settingsGateway: { loadLastDraft: () => ({ id: "a" }), removeLastDraft: () => { draftRemoved = true; } },
    resetTraining: () => { resets++; },
  };
  const cleanup = new Function(...Object.keys(scope), `${compiled}\nreturn cleanup;`)(...Object.values(scope));
  return { cleanup, candidates: [...summaries], requests, statuses, confirmations, scope,
    state: () => ({ summaries, navigator, reviewed, draftRemoved, resets, busy }) };
}

test("selected cleanup reuses recycling, restores failures and updates only successfully deleted references", async () => {
  const f = cleanupFixture({ fail: ["b"] });
  await f.cleanup(f.candidates);
  assert.deepEqual(f.requests, ["a", "b", "c"]);
  assert.deepEqual(f.state().summaries.map(item => item.session.id), ["b"]);
  assert.deepEqual(f.state().navigator.map(item => item.id), ["b"]);
  assert.equal(f.state().reviewed, null);
  assert.equal(f.state().draftRemoved, true);
  assert.equal(f.state().resets, 0);
  assert.equal(f.state().busy, false);
  assert.match(f.statuses.at(-1), /1 场.*重试/);
});

test("empty cleanup protects meaningful activity and cancellation sends no request", async () => {
  const f = cleanupFixture();
  await f.cleanup(f.candidates, true);
  assert.deepEqual(f.requests, ["a", "c"]);
  const cancelled = cleanupFixture({ confirm: false });
  await cancelled.cleanup(cancelled.candidates);
  assert.deepEqual(cancelled.requests, []);
  assert.equal(cancelled.state().summaries.length, 3);
});

test("duplicate execution is blocked and active training is explicitly included in confirmation", async () => {
  const f = cleanupFixture({ active: "a" });
  await Promise.all([f.cleanup(f.candidates), f.cleanup(f.candidates)]);
  assert.deepEqual(f.requests, ["a", "b", "c"]);
  assert.equal(f.confirmations.length, 1);
  assert.match(f.confirmations[0], /当前训练/);
  assert.equal(f.state().resets, 1);
});

const panelSource = readFileSync(new URL("../app/features/review/components/SessionHistoryPanel.tsx", import.meta.url), "utf8");
const panelCode = ts.transpileModule(panelSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
function panelFixture() {
  const states = []; let cursor = 0;
  const exports = {};
  const require = id => id === "react" ? { useState: initial => {
    const index = cursor++;
    if (!(index in states)) states[index] = initial;
    return [states[index], value => { states[index] = value; }];
  } } : id.includes("reviewContracts") ? { defaultReviewSessionFilters } : id.includes("reviewController") ? controller : id.includes("timeframeCatalog") ? { timeframeLabel: v => v } : { Trash2: "svg", RotateCcw: "svg" };
  new Function("require", "exports", "React", panelCode)(require, exports, { createElement, Fragment: Symbol.for("react.fragment") });
  const deleted = [];
  const props = { items: Array.from({ length: 81 }, (_, i) => ({ id: String(i), instrumentId: `FX${i}`, timeframe: "1m" })), totalCount: 81, filters: defaultReviewSessionFilters, timeframes: [], modeOptions: [], auditEvents: [], emptyText: "空", onFilterChange: update => { props.filters = { ...props.filters, ...update }; }, onResetFilters() {}, onReview() {}, onResume() {}, onDelete() {}, onDeleteEmpty() {}, onDeleteSelected: ids => deleted.push(ids), emptyActivityCount: 0, batchDeleteRunning: false, cleanupStatus: "" };
  let nodes;
  const render = () => {
    cursor = 0; nodes = [];
    const walk = node => { if (!node || typeof node !== "object") return; if (Array.isArray(node)) { node.forEach(walk); return; } nodes.push(node); walk(node.props?.children); };
    walk(exports.SessionHistoryPanel(props));
    return nodes;
  };
  const text = node => Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node?.props?.children) : String(node ?? "");
  const button = label => nodes.find(n => n.type === "button" && text(n).startsWith(label));
  render();
  return { props, render, button, deleted };
}

test("cleanup selection covers unloaded pages, checkbox and keyboard toggles, and resets on filter change", () => {
  const f = panelFixture();
  assert.equal(f.button("清理").props.disabled, false);
  f.button("清理").props.onClick(); f.render();
  f.button("全选").props.onClick();
  let nodes = f.render();
  assert.ok(nodes.filter(n => n.type === "input" && n.props.type === "checkbox").length < 81);
  f.button("删除所选").props.onClick();
  assert.equal(f.deleted[0].length, 81);
  nodes.find(n => n.type === "input" && n.props.type === "checkbox").props.onChange();
  nodes = f.render();
  nodes.find(n => n.props?.className?.startsWith("session-row")).props.onKeyDown({ key: " ", preventDefault() {} });
  f.render(); f.button("删除所选").props.onClick();
  assert.equal(f.deleted[1].length, 81);
  nodes = f.render();
  nodes.find(n => n.type === "input" && n.props.placeholder).props.onChange({ target: { value: "FX1" } });
  f.render();
  assert.equal(f.button("删除所选").props.disabled, true);
  f.props.filters = defaultReviewSessionFilters;
  f.render();
  assert.equal(f.button("删除所选").props.disabled, true);
});

test("removed records are excluded, failures remain selected and running cleanup locks actions", () => {
  const f = panelFixture(); f.button("清理").props.onClick(); f.render();
  f.button("全选").props.onClick(); f.render();
  f.props.items = f.props.items.slice(0, 1); f.render();
  f.button("删除所选").props.onClick(); assert.deepEqual(f.deleted[0], ["0"]);
  f.props.batchDeleteRunning = true;
  const nodes = f.render();
  assert.equal(f.button("删除所选").props.disabled, true);
  assert.ok(nodes.filter(n => n.type === "input" && n.props.type === "checkbox").every(n => n.props.disabled));
});
