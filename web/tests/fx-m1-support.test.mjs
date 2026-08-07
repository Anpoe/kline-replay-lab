import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("FX 历史任务同时持久化 M1 与聚合后的 5m 数据", async () => {
  const source = await readFile(new URL("app/lib/fxDataService.ts", root), "utf8");

  assert.match(source, /const DEFAULT_TARGET_TIMEFRAMES = \["1m", "5m", "1h", "1d", "1w"\]/);
  assert.match(source, /persistCandles\(db, task, "1m", FX_SOURCE_DUKASCOPY, parsed\.candles\)/);
  assert.match(source, /persistCandles\(db, task, "5m", FX_SOURCE_DUKASCOPY, base\)/);
});

test("训练周期筛选和 K 线图支持 1m", async () => {
  const [workbench, chart, panel] = await Promise.all([
    readFile(new URL("app/components/TrainingWorkbench.tsx", root), "utf8"),
    readFile(new URL("app/components/KLineReplayChart.tsx", root), "utf8"),
    readFile(new URL("app/components/FxDataControlPanel.tsx", root), "utf8"),
  ]);

  assert.match(workbench, /const timeframes = \["1m", "5m", "1h", "1d", "1w"\]/);
  assert.match(chart, /"1m": \{ type: "minute", span: 1 \}/);
  assert.match(panel, /const TARGET_TIMEFRAMES: readonly FxTimeframe\[\] = \["1m", "5m", "1h", "1d", "1w"\]/);
});
