import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { buildReviewSessionSummariesInBatches } from "../app/features/review/reviewController.ts";

const source = ts.createSourceFile("TrainingWorkbench.tsx", readFileSync(
  new URL("../app/components/TrainingWorkbench.tsx", import.meta.url), "utf8",
), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "loadSessions") {
    callback = node.initializer.arguments[0].getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback, "the workbench session loader must exist");
const compiled = ts.transpileModule(`const load = ${callback};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(load) {
  const all = Array.from({ length: 486 }, (_, index) => ({ id: index }));
  const requests = [];
  let summaries = [];
  const scope = {
    sessionSummariesReadyRef: { current: false },
    sessionSummaryLoadRef: { current: { id: 0, controller: null } },
    reviewGateway: {
      async loadSessions(includeAll, signal) {
        requests.push(includeAll);
        return load ? load(includeAll, signal, all) : includeAll ? all : all.slice(0, 20);
      },
    },
    buildReviewSessionSummariesInBatches,
    compareTrainingSessionsByCreatedAt: (left, right) => left.id - right.id,
    buildSessionSummary: session => session,
    REVIEW_SESSION_SUMMARY_BATCH_SIZE: 500,
    setSessionSummaries: value => { summaries = value; },
  };
  const loadSessions = new Function(...Object.keys(scope), `${compiled}\nreturn load;`)(...Object.values(scope));
  return { loadSessions, requests, scope, summaries: () => summaries };
}

test("opening review after loading 20 recent sessions still loads the complete history", async () => {
  const state = fixture();
  await state.loadSessions();
  assert.equal(state.summaries().length, 20);
  await state.loadSessions(true);
  assert.equal(state.summaries().length, 486);
  assert.deepEqual(state.requests, [false, true]);
  await state.loadSessions(true);
  await state.loadSessions();
  assert.deepEqual(state.requests, [false, true]);
  assert.equal(state.summaries().length, 486);
});

test("saving invalidates history and a forced reload bypasses the complete cache", async () => {
  const state = fixture();
  await state.loadSessions(true);
  state.scope.sessionSummariesReadyRef.current = false;
  await state.loadSessions(true);
  await state.loadSessions(true, true);
  assert.deepEqual(state.requests, [true, true, true]);
});

test("failed full-history loading retains recent sessions and can retry", async () => {
  let fail = true;
  const state = fixture((includeAll, _signal, all) => {
    if (includeAll && fail) throw new Error("temporary failure");
    return includeAll ? all : all.slice(0, 20);
  });
  await state.loadSessions();
  await state.loadSessions(true);
  assert.equal(state.summaries().length, 20);
  fail = false;
  await state.loadSessions(true);
  assert.equal(state.summaries().length, 486);
});

test("a cancelled recent request cannot overwrite the complete history", async () => {
  let finishRecent;
  const state = fixture((includeAll, _signal, all) => includeAll ? all : new Promise(resolve => {
    finishRecent = () => resolve(all.slice(0, 20));
  }));
  const recent = state.loadSessions();
  await state.loadSessions(true);
  finishRecent();
  await recent;
  assert.equal(state.summaries().length, 486);
  await state.loadSessions(true);
  assert.deepEqual(state.requests, [false, true]);
});
