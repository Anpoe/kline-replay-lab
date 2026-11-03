import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ts.createSourceFile('workbench.tsx', readFileSync(new URL('../app/components/TrainingWorkbench.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'startRandomTraining') callback = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback);
const compiled = ts.transpileModule(`const launch = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  const gate = { current: { busy: false, id: 0 } };
  const requests = [], launches = [], errors = [], statuses = [];
  const resolve = () => new Promise((yes, no) => requests.push({ yes, no }));
  const scope = {
    trainingLaunchRef: gate, loading: false, showRandomComplete: true,
    patternPresets: [{ id: 'pattern', name: '回调' }],
    preemptStartupRandom: () => { gate.current = { busy: false, id: gate.current.id + 1 }; },
    setStartingTraining: v => statuses.push(v), setQuickRandomError: v => errors.push(v),
    setPatternScanStatus() {}, setMobileToolbarOpen() {},
    resolvePatternRandomRequest: resolve, resolveRandomRequest: resolve,
    launchTraining: (...args) => launches.push(args),
  };
  const launch = new Function(...Object.keys(scope), `${compiled}; return launch;`)(...Object.values(scope));
  return { launch, gate, requests, launches, errors, statuses, cancel: scope.preemptStartupRandom };
}
const draft = { mode: 'blind', length: 100, hideInstrument: true, patternPresetIds: [] };
const config = { length: 100 };
const request = { instrumentId: '000831.SZ', timeframe: '1d', snapshotId: 'snapshot', draft };

test('quick start and next round use one synchronous lock and preserve the selected draft', async () => {
  const f = fixture();
  const first = f.launch(draft, config);
  await f.launch(draft, config);
  assert.equal(f.requests.length, 1);
  assert.equal(f.gate.current.busy, true);
  f.requests[0].yes(request); await first;
  assert.deepEqual(f.launches, [[request.instrumentId, request.timeframe, draft, request.snapshotId]]);
  assert.equal(f.gate.current.busy, false);
  assert.deepEqual(f.statuses, [true, false]);
});

test('leaving the completed round discards late responses without unlocking a newer request', async () => {
  const f = fixture();
  const old = f.launch(draft, config);
  f.cancel();
  const next = f.launch(draft, config);
  f.requests[0].yes(request); await old;
  assert.equal(f.launches.length, 0);
  assert.equal(f.gate.current.busy, true);
  f.requests[1].yes(request); await next;
  assert.equal(f.launches.length, 1);
});

test('empty results and exceptions keep the old round and allow retry', async () => {
  const f = fixture();
  for (const fail of [false, true]) {
    const pending = f.launch({ ...draft, patternPresetIds: ['pattern'] }, config);
    const request = f.requests.at(-1);
    if (fail) request.no(new Error('offline')); else request.yes(null);
    await pending;
    assert.equal(f.gate.current.busy, false);
    assert.ok(f.errors.at(-1));
    assert.match(f.errors.at(-1), fail ? /准备失败/ : /回调/);
    assert.equal(f.launches.length, 0);
  }
});
