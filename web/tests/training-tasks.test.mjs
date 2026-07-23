import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceWithinTask,
  defaultTrainingTaskDraft,
  finishTask,
  resolveTrainingTask,
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

