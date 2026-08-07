import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../app/components/FxDataControlPanel.tsx", import.meta.url);

test("FX 数据维护面板暴露宿主可注入的任务契约", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /export type FxDataControlApiPaths/);
  assert.match(source, /export type FxDataControlAction/);
  assert.match(source, /export type FxDataControlPanelProps/);
  assert.match(source, /apiPaths: FxDataControlApiPaths/);
  assert.match(source, /currentTask\?: FxDataTask \| null/);
  assert.match(source, /onAction: \(action: FxDataControlAction\)/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /\/api\//);
});

test("FX 数据维护面板包含历史初始化、增量更新和任务控制文案", async () => {
  const source = await readFile(sourceUrl, "utf8");

  for (const label of [
    "货币对",
    "起始日期",
    "结束日期",
    "初始化历史数据",
    "增量更新",
    "暂停",
    "恢复",
    "重试",
    "取消",
    "质量摘要",
  ]) {
    assert.match(source, new RegExp(label));
  }

  assert.match(source, /Dukascopy CSV/);
  assert.match(source, /Twelve Data REST/);
  assert.match(source, /setup-pipeline/);
  assert.match(source, /local-task-progress/);
  assert.match(source, /task-error/);
  assert.match(source, /invalidRows/);
  assert.match(source, /missingIntervals/);
});

