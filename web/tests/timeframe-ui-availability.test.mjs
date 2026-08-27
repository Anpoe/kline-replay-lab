import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../app/", import.meta.url);
const workbench = await readFile(new URL("components/TrainingWorkbench.tsx", root), "utf8");
const settings = await readFile(new URL("features/settings/components/SettingsPanel.tsx", root), "utf8");
const review = await readFile(new URL("features/review/components/SessionHistoryPanel.tsx", root), "utf8");
const maintenance = await readFile(new URL("features/market-data/components/DataSourceManager.tsx", root), "utf8");

test("training chart controls iterate the complete catalog and disable unavailable periods", () => {
  assert.match(workbench, /TIMEFRAME_IDS/);
  assert.match(workbench, /TIMEFRAME_IDS\.map\(\(item\)/);
  assert.match(workbench, /const available = currentAvailableTimeframes\.includes\(item\)/);
  assert.match(workbench, /disabled=\{chartViewLoading \|\| !available\}/);
  assert.doesNotMatch(workbench, /currentAvailableTimeframes\.map\(\(item\)/);
  assert.doesNotMatch(workbench, /setRuleNotice\(`当前品种没有/);
});

test("every active snapshot session keeps its mode while changing the chart timeframe", () => {
  const loadStart = workbench.indexOf("const loadTimeframeView = useCallback");
  const loadEnd = workbench.indexOf("const persistTrainingState", loadStart);
  const loader = workbench.slice(loadStart, loadEnd);
  const handlerStart = workbench.indexOf("const handleTimeframeChange");
  const handlerEnd = workbench.indexOf("const waitForCnLiveUpdate", handlerStart);
  const handler = workbench.slice(handlerStart, handlerEnd);

  assert.match(loader, /if \(!dataSnapshotId\)/);
  assert.doesNotMatch(loader, /!trainingTask\?\.randomRun/);
  assert.match(handler, /if \(dataSnapshotId\) \{\s*void loadTimeframeView\(nextTimeframe\);/);
  assert.doesNotMatch(handler, /if \(trainingTask\?\.randomRun\)/);
});

test("settings, setup, and review period selectors use MT4 labels", () => {
  assert.match(workbench, /timeframeLabel\(item\)/);
  assert.match(settings, /timeframeLabel\(item\)/);
  assert.match(settings, /canAggregateTimeframe\(sourceTimeframe, targetTimeframe\)/);
  assert.match(review, /timeframeLabel\(value\)/);
  assert.match(maintenance, /TIMEFRAME_IDS\.map\(\(value\)/);
  assert.match(maintenance, /disabled=\{!available\}/);
});
