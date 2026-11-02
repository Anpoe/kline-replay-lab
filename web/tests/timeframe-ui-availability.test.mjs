import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from 'typescript';

const root = new URL("../app/", import.meta.url);
const workbench = await readFile(new URL("components/TrainingWorkbench.tsx", root), "utf8");
const picker = await readFile(new URL("components/ChartTimeframePicker.tsx", root), "utf8");
const settings = await readFile(new URL("features/settings/components/SettingsPanel.tsx", root), "utf8");
const review = await readFile(new URL("features/review/components/SessionHistoryPanel.tsx", root), "utf8");
const maintenance = await readFile(new URL("features/market-data/components/DataSourceManager.tsx", root), "utf8");

test("training chart controls iterate the complete catalog and disable unavailable periods", () => {
  assert.match(workbench, /TIMEFRAME_IDS/);
  assert.match(picker, /TIMEFRAME_IDS\.map\(item/);
  assert.match(workbench, /<ChartTimeframePicker[\s\S]{0,200}available=\{currentAvailableTimeframes\}/);
  assert.match(picker, /const enabled = available\.includes\(item\)/);
  assert.match(workbench, /<ChartTimeframePicker[\s\S]{0,240}disabled=\{chartViewLoading\}/);
  assert.match(picker, /disabled=\{disabled \|\| !enabled\}/);
  assert.doesNotMatch(workbench, /currentAvailableTimeframes\.map\(\(item\)/);
  assert.doesNotMatch(workbench, /setRuleNotice\(`当前品种没有/);
});

test("snapshot sessions and observation keep their mode while changing the chart timeframe", () => {
  const loadStart = workbench.indexOf("const loadTimeframeView = useCallback");
  const loadEnd = workbench.indexOf("const persistTrainingState", loadStart);
  const loader = workbench.slice(loadStart, loadEnd);
  const handlerStart = workbench.indexOf("const handleTimeframeChange");
  const handlerEnd = workbench.indexOf("const waitForCnLiveUpdate", handlerStart);
  const handler = workbench.slice(handlerStart, handlerEnd);

  assert.match(loader, /if \(!dataSnapshotId\)/);
  assert.doesNotMatch(loader, /!trainingTask\?\.randomRun/);
  const compiled = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [snapshot, live, expected] of [['snapshot', false, 'view'], ['', true, 'view'], ['', false, 'training']]) {
    const calls = [];
    const change = new Function('currentAvailableTimeframes', 'dataSnapshotId', 'liveMode', 'loadTimeframeView', 'startFreshTraining', 'instrumentId', `${compiled}\nreturn handleTimeframeChange;`)(
      ['1d', '1w'], snapshot, live,
      period => calls.push(['view', period]), (instrument, period) => calls.push(['training', period]), 'EURUSD.FX',
    );
    change('1w');
    assert.deepEqual(calls, [[expected, '1w']]);
    change('1m');
    assert.equal(calls.length, 1);
  }
  assert.doesNotMatch(handler, /if \(trainingTask\?\.randomRun\)/);
});

test("normal training uses date ranges and random training retains its period rule", () => {
  assert.match(picker, /TIMEFRAME_LABELS\[item\]/);
  assert.doesNotMatch(workbench, /setSetupTimeframe/);
  assert.match(settings, /data-settings-group="random-timeframe"/);
  assert.match(settings, /draft\.randomTimeframeMode/);
  assert.match(review, /timeframeLabel\(value\)/);
  assert.match(maintenance, /TIMEFRAME_IDS\.map\(\(value\)/);
  assert.match(maintenance, /disabled=\{!available\}/);
});
