import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("FX 历史任务同时持久化 M1 与聚合后的 5m 数据", async () => {
  const source = await readFile(new URL("app/lib/fxDataService.ts", root), "utf8");

  assert.match(source, /const DEFAULT_TARGET_TIMEFRAMES = \[\.\.\.TIMEFRAME_IDS\] as const/);
  assert.match(source, /persistCandles\([\s\S]*?"1m",[\s\S]*?FX_SOURCE_DUKASCOPY,[\s\S]*?parsed\.candles/);
  assert.match(source, /persistCandles\(db, task, "5m", FX_SOURCE_DUKASCOPY, base\)/);
});

test("FX M1 写库使用可恢复的小分片和有界覆盖统计", async () => {
  const source = await readFile(new URL("app/lib/fxDataService.ts", root), "utf8");

  assert.match(source, /const HISTORICAL_CHUNK_DAYS = 7/);
  assert.match(source, /const DUKASCOPY_INCREMENTAL_CHUNK_DAYS = 1/);
  assert.match(source, /const sharedDukascopyOfficialClient = new DukascopyOfficialClient\(\{[\s\S]*dailyConcurrency: 1[\s\S]*maxAttempts: 4/);
  assert.match(source, /FROM json_each\(\?\)/);
  assert.match(source, /timestamp BETWEEN \? AND \?/);
  assert.match(source, /uniqueTimestampCount - Number\(existingRange\?\.barCount \?\? 0\)/);
  assert.match(source, /readRecentBaseCandles\(db, task, currentChunkLastTimestamp, currentChunkLastTimestamp\)/);
  assert.match(source, /HIGHER_TIMEFRAME_LOOKBACK_DAYS = 42/);
  assert.match(source, /throughTimestamp/);
  assert.match(source, /chunkElapsedSeconds\.toFixed\(1\)/);
  assert.match(source, /isCandleRangeCovered\(db, task, "5m", FX_SOURCE_DUKASCOPY, base\)/);
  assert.match(source, /Re-write every affected higher-period bucket/);
  assert.match(source, /getTargetTimeframes\(parseJson<unknown>\(task\.targetTimeframesJson, \[\.\.\.DEFAULT_TARGET_TIMEFRAMES\]\), true\)/);
});

test("Dukascopy 增量以 M1 入库并由本地聚合 5m", async () => {
  const source = await readFile(new URL("app/lib/fxDataService.ts", root), "utf8");

  assert.match(source, /runDukascopyIncrementalTask/);
  assert.match(source, /persistCandles\(db, task, "1m", FX_SOURCE_DUKASCOPY, writeCandles\)/);
  assert.match(source, /const fiveMinuteCandles = aggregateM1To5m\(recentMinutes\)/);
  assert.match(source, /nextLastTimestamp \+ FX_TIMEFRAME_MS\["1m"\]/);
});

test("外汇和黄金增量共用 Dukascopy 完整 UTC 日并由本地聚合", async () => {
  const source = await readFile(new URL("app/lib/fxDataService.ts", root), "utf8");

  assert.match(source, /return runDukascopyIncrementalTask\(db, task, instrument, task\.mode === "repair"\)/);
  assert.match(source, /const sharedDukascopyOfficialClient = new DukascopyOfficialClient/);
  assert.match(source, /const officialClient = secrets\.dukascopyEndpoint \? null : sharedDukascopyOfficialClient/);
  assert.doesNotMatch(source, /sharedDukascopyIncrementalClient/);
  assert.match(source, /const DUKASCOPY_INCREMENTAL_OVERLAP_MINUTES = 3/);
  assert.match(source, /findRecentDukascopyGapStartTimestamp/);
  assert.match(source, /DUKASCOPY_GAP_LOOKBACK_DAYS = 30/);
  assert.match(source, /LAG\(timestamp\) OVER/);
  assert.match(source, /for \(const timeframe of \["1m", "5m"\] as const\)/);
  assert.match(source, /isExpectedDukascopyClosureGap/);
  assert.match(source, /latestCompletedDukascopyDate/);
  assert.match(source, /const recentGapStartTimestamp = repairGaps[\s\S]*?findRecentDukascopyGapStartTimestamp[\s\S]*?: null/);
  assert.match(source, /const initialStartTimestamp = lastTimestamp == null[\s\S]*?\? taskStartTimestamp[\s\S]*?: Math\.min\([\s\S]*?lastTimestamp - DUKASCOPY_INCREMENTAL_OVERLAP_MINUTES \* FX_TIMEFRAME_MS\["1m"\]/);
  assert.doesNotMatch(source, /Math\.max\(\s*taskStartTimestamp,\s*lastTimestamp - DUKASCOPY_INCREMENTAL_OVERLAP_MINUTES/);
  assert.match(source, /persistCandles\(db, task, "1m", FX_SOURCE_DUKASCOPY, writeCandles\)/);
  assert.match(source, /persistCandles\(db, task, "5m", FX_SOURCE_DUKASCOPY, fiveMinuteCandles\)/);
  assert.match(source, /const incrementalStart = requestedStartTimestamp/);
  assert.match(source, /const refreshStart = bucketStartTimestamp\(writeCandles\[0\]\.timestamp, timeframe\)/);
  assert.match(source, /formatCandleRange\(writeCandles\)/);
});

test("每日增量不扫描历史缺口，缺口修复单独扫描", async () => {
  const source = await readFile(new URL("app/lib/fxDataService.ts", root), "utf8");

  assert.match(source, /if \(repairGaps && !hasIncrementalCursor && recentGapStartTimestamp == null && lastTimestamp != null\)/);
  assert.match(source, /task\.mode === "repair"/);
  assert.match(source, /Dukascopy \$\{marketName\}每日增量更新完成/);
  assert.match(source, /Dukascopy \$\{marketName\}缺口修复完成/);
});

test("训练周期筛选和 K 线图支持 1m", async () => {
  const [chart, panel, settings] = await Promise.all([
    readFile(new URL("app/components/KLineReplayChart.tsx", root), "utf8"),
    readFile(new URL("app/features/market-data/components/FxDataControlPanel.tsx", root), "utf8"),
    readFile(new URL("app/features/settings/settingsContracts.ts", root), "utf8"),
  ]);

  assert.match(settings, /export const timeframes: string\[\] = \[\.\.\.TIMEFRAME_IDS\]/);
  assert.match(chart, /"1m": \{ type: "minute", span: 1 \}/);
  assert.match(panel, /const TARGET_TIMEFRAMES: readonly FxTimeframe\[\] = TIMEFRAME_IDS/);
});

test("FX 界面区分首次排队、分片续跑和 Dukascopy 限流", async () => {
  const [panel, manager] = await Promise.all([
    readFile(new URL("app/features/market-data/components/FxDataControlPanel.tsx", root), "utf8"),
    readFile(new URL("app/features/market-data/components/DataSourceManager.tsx", root), "utf8"),
  ]);

  assert.match(panel, /return "等待下一分片"/);
  assert.match(manager, /Math\.min\(30_000, 1_000 \* 2 \*\*/);
  assert.match(manager, /秒后自动重试/);
  assert.match(manager, /function isDukascopyRateLimited\(message: string\)/);
  assert.match(manager, /HTTP\\s\*429\|Too Many Requests/);
  assert.match(manager, /if \(isDukascopyRateLimited\(message\)\) \{[\s\S]*?已暂停自动重试，请稍后点击“重试”[\s\S]*?break;/);
});
