import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceWithinTask,
  DEFAULT_REPLAY_HISTORY_BARS,
  defaultTrainingTaskDraft,
  finishTask,
  MAX_REPLAY_HISTORY_BARS,
  MIN_REPLAY_HISTORY_BARS,
  normalizeReplayHistoryBars,
  rebaseTrainingTaskToBars,
  resolveTrainingTask,
  taskVisibleStartCursor,
  taskProgress,
} from "../app/lib/trainingTasks.ts";

const bars = Array.from({ length: 100 }, (_, index) => ({
  timestamp: Date.parse("2025-01-01T02:00:00Z") + index * 24 * 60 * 60 * 1000,
}));

test("starts from a specified date or one-based K-line number", () => {
  const byDate = resolveTrainingTask({
    ...defaultTrainingTaskDraft,
    startMode: "date",
    startDate: "2025-01-11",
  }, bars, "Asia/Shanghai", "date-seed");
  const byBar = resolveTrainingTask({
    ...defaultTrainingTaskDraft,
    startMode: "bar",
    startBar: 25,
  }, bars, "Asia/Shanghai", "bar-seed");

  assert.equal(byDate.startCursor, 10);
  assert.equal(byBar.startCursor, 24);
});

test("clamps replay to the configured length and completes at the boundary", () => {
  const task = resolveTrainingTask({
    ...defaultTrainingTaskDraft,
    startMode: "bar",
    startBar: 11,
    length: 12,
  }, bars, "Asia/Shanghai", "length-seed");

  assert.equal(task.startCursor, 10);
  assert.equal(task.endCursor, 22);
  assert.equal(advanceWithinTask(task, 20, 5), 22);
  assert.equal(finishTask(task, 21).status, "active");
  assert.equal(finishTask(task, 22).status, "completed");
  assert.deepEqual(taskProgress(task, 16), { revealed: 6, total: 12, percent: 50 });
});

test("uses inclusive date boundaries for test-range mode", () => {
  const task = resolveTrainingTask({
    ...defaultTrainingTaskDraft,
    mode: "range",
    startDate: "2025-01-06",
    endDate: "2025-01-10",
  }, bars, "Asia/Shanghai", "range-seed");

  assert.equal(task.startCursor, 5);
  assert.equal(task.endCursor, 9);
  assert.equal(task.mode, "range");
});

test("persists blind-test visibility settings and leaves room for a random task", () => {
  const task = resolveTrainingTask({
    ...defaultTrainingTaskDraft,
    mode: "blind",
    startMode: "random",
    length: 20,
    hideInstrument: true,
    hideDate: true,
    hidePrice: true,
  }, bars, "Asia/Shanghai", "stable-random-seed");

  assert.equal(task.hideInstrument, true);
  assert.equal(task.hideDate, true);
  assert.equal(task.hidePrice, true);
  assert.ok(task.endCursor - task.startCursor === 20);
  assert.ok(task.endCursor <= bars.length - 1);
});

test("keeps random training inside the configured historical window", () => {
  const task = resolveTrainingTask({
    ...defaultTrainingTaskDraft,
    startMode: "random",
    length: 5,
    randomStartDate: "2025-03-02",
    randomEndDate: "2025-03-12",
    randomRun: true,
  }, bars, "Asia/Shanghai", "bounded-random-seed");

  assert.ok(task.startCursor >= 60);
  assert.ok(task.startCursor <= 70);
  assert.equal(task.endCursor - task.startCursor, 5);
  assert.equal(task.randomRun, true);
});

test("persists the pattern filter reason on the resolved task", () => {
  const task = resolveTrainingTask({
    ...defaultTrainingTaskDraft,
    startMode: "bar",
    startBar: 25,
    patternPresetIds: ["breakout", "long-lower-wick"],
    patternPresetNames: ["区间突破", "长下影线"],
    patternMatchedPresetIds: ["breakout"],
    patternMatchTimestamp: bars[24].timestamp,
  }, bars, "Asia/Shanghai", "pattern-seed");

  assert.deepEqual(task.patternFilter, {
    presetIds: ["breakout", "long-lower-wick"],
    presetNames: ["区间突破", "长下影线"],
    matchedPresetIds: ["breakout"],
    matchTimestamp: bars[24].timestamp,
  });
});

test("persists the complete random setup for the next round", () => {
  const randomConfig = {
    instrumentMode: "market",
    anchorInstrumentId: "600519.SH",
    market: "A股",
    timeframeMode: "fixed",
    anchorTimeframe: "1d",
    fixedTimeframe: "1w",
    dateMode: "range",
    startDate: "2025-02-01",
    endDate: "2025-03-31",
    length: 40,
    includeIndices: false,
  };
  const task = resolveTrainingTask({
    ...defaultTrainingTaskDraft,
    startMode: "random",
    length: 20,
    randomRun: true,
    randomConfig,
  }, bars, "Asia/Shanghai", "random-config-seed");

  assert.deepEqual(task.randomConfig, randomConfig);
  assert.notEqual(task.randomConfig, randomConfig);
});

test("normalizes replay history bars into the supported range", () => {
  assert.equal(normalizeReplayHistoryBars(undefined), DEFAULT_REPLAY_HISTORY_BARS);
  assert.equal(normalizeReplayHistoryBars(12), MIN_REPLAY_HISTORY_BARS);
  assert.equal(normalizeReplayHistoryBars(777.6), 778);
  assert.equal(normalizeReplayHistoryBars(9000), MAX_REPLAY_HISTORY_BARS);
});

test("persists a fixed history window for new tasks while legacy tasks keep all history", () => {
  const task = resolveTrainingTask({
    ...defaultTrainingTaskDraft,
    startMode: "bar",
    startBar: 76,
    historyBars: 25,
  }, bars, "Asia/Shanghai", "history-window-seed");

  assert.equal(task.historyBars, MIN_REPLAY_HISTORY_BARS);
  assert.equal(taskVisibleStartCursor(task), 0);
  assert.equal(taskVisibleStartCursor({ startCursor: 550, historyBars: 100 }), 450);
  assert.equal(taskVisibleStartCursor({ startCursor: 550 }), 0);
});

test("rebases a persisted task onto a partial snapshot window by timestamp", () => {
  const fullBars = Array.from({ length: 300 }, (_, index) => ({ timestamp: index + 1 }));
  const task = resolveTrainingTask({
    ...defaultTrainingTaskDraft,
    startMode: "bar",
    startBar: 201,
    length: 50,
    historyBars: 100,
  }, fullBars, "UTC", "range-window-seed");
  const partialBars = fullBars.slice(100, 251);
  const rebased = rebaseTrainingTaskToBars(task, partialBars);

  assert.equal(rebased.startCursor, 100);
  assert.equal(rebased.endCursor, 150);
  assert.equal(rebased.startTimestamp, task.startTimestamp);
  assert.equal(rebased.endTimestamp, task.endTimestamp);
});
