import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("FX 历史任务同时持久化 M1 与聚合后的 5m 数据", async () => {
  const source = await readFile(new URL("app/lib/fxDataService.ts", root), "utf8");

  assert.match(source, /const DEFAULT_TARGET_TIMEFRAMES = \["1m", "5m", "1h", "1d", "1w"\]/);
  assert.match(source, /persistCandles\([\s\S]*?"1m",[\s\S]*?FX_SOURCE_DUKASCOPY,[\s\S]*?parsed\.candles/);
  assert.match(source, /persistCandles\(db, task, "5m", FX_SOURCE_DUKASCOPY, base\)/);
});

test("FX M1 写库使用可恢复的小分片和有界覆盖统计", async () => {
  const source = await readFile(new URL("app/lib/fxDataService.ts", root), "utf8");

  assert.match(source, /const HISTORICAL_CHUNK_DAYS = 7/);
  assert.match(source, /const sharedDukascopyOfficialClient = new DukascopyOfficialClient\(\)/);
  assert.match(source, /FROM json_each\(\?\)/);
  assert.match(source, /timestamp BETWEEN \? AND \?/);
  assert.match(source, /uniqueTimestampCount - Number\(existingRange\?\.barCount \?\? 0\)/);
  assert.match(source, /readRecentBaseCandles\(db, task, currentChunkLastTimestamp, currentChunkLastTimestamp\)/);
  assert.match(source, /throughTimestamp/);
  assert.match(source, /chunkElapsedSeconds\.toFixed\(1\)/);
  assert.match(source, /isCandleRangeCovered\(db, task, "5m", FX_SOURCE_DUKASCOPY, base\)/);
  assert.match(source, /isCandleRangeCovered\(db, task, timeframe, FX_SOURCE_DUKASCOPY, candles\)/);
});

test("Twelve Data 增量以 M1 入库并由本地聚合 5m", async () => {
  const source = await readFile(new URL("app/lib/fxDataService.ts", root), "utf8");

  assert.match(source, /fetchTwelveDataOneMinuteChunk/);
  assert.match(source, /persistCandles\(db, task, "1m", FX_SOURCE_TWELVE_DATA, writeCandles\)/);
  assert.match(source, /const fiveMinuteCandles = aggregateM1To5m\(recentMinutes\)/);
  assert.match(source, /nextLastTimestamp \+ FX_TIMEFRAME_MS\["1m"\]/);
});

test("训练周期筛选和 K 线图支持 1m", async () => {
  const [chart, panel, settings] = await Promise.all([
    readFile(new URL("app/components/KLineReplayChart.tsx", root), "utf8"),
    readFile(new URL("app/features/market-data/components/FxDataControlPanel.tsx", root), "utf8"),
    readFile(new URL("app/features/settings/settingsContracts.ts", root), "utf8"),
  ]);

  assert.match(settings, /export const timeframes: string\[\] = \["1m", "5m", "1h", "1d", "1w"\]/);
  assert.match(chart, /"1m": \{ type: "minute", span: 1 \}/);
  assert.match(panel, /const TARGET_TIMEFRAMES: readonly FxTimeframe\[\] = \["1m", "5m", "1h", "1d", "1w"\]/);
});

test("FX 界面区分首次排队与分片续跑并自动重试断线", async () => {
  const [panel, manager] = await Promise.all([
    readFile(new URL("app/features/market-data/components/FxDataControlPanel.tsx", root), "utf8"),
    readFile(new URL("app/features/market-data/components/DataSourceManager.tsx", root), "utf8"),
  ]);

  assert.match(panel, /return "等待下一分片"/);
  assert.match(manager, /Math\.min\(30_000, 1_000 \* 2 \*\*/);
  assert.match(manager, /秒后自动重试/);
  assert.doesNotMatch(manager, /if \(failures >= 3\) break/);
});
