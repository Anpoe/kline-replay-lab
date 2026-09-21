import assert from "node:assert/strict";
import test from "node:test";
import {
  DukascopyHistoricalClient,
  createDukascopyQueryUrlBuilder,
} from "../app/lib/fx/dukascopyClient.ts";
import {
  aggregate5mToTimeframe,
  aggregateCandleChunks,
  aggregateM1To5m,
  findFxCandleGaps,
  isExpectedDukascopyClosureGap,
} from "../app/lib/fx/dukascopyAggregation.ts";
import { parseDukascopyCsv } from "../app/lib/fx/dukascopyCsv.ts";

const csvFixture = `timestamp,open,high,low,close,volume
2026-01-05T14:30:00Z,1.1000,1.1010,1.0990,1.1005,12
2026-01-05T14:35:00Z,1.1005,1.1020,1.1000,1.1015,15
2026-01-05T14:35:00Z,1.1005,1.1021,1.1000,1.1016,16
2026-01-05T14:40:00Z,1.1015,1.1000,1.1010,1.1012,17
`;

function candle(timestamp, close, volume = 1) {
  return {
    timestamp,
    open: close - 0.1,
    high: close + 0.2,
    low: close - 0.2,
    close,
    volume,
    turnover: null,
  };
}

test("解析带表头的 CSV，返回 UTC 毫秒并报告重复和异常 OHLC", () => {
  const result = parseDukascopyCsv(csvFixture);
  assert.equal(result.candles.length, 2);
  assert.equal(result.candles[0].timestamp, Date.parse("2026-01-05T14:30:00Z"));
  assert.equal(result.candles[1].volume, 15);
  assert.equal(result.report.received, 4);
  assert.equal(result.report.accepted, 2);
  assert.equal(result.report.duplicates, 1);
  assert.equal(result.report.invalid, 1);
  assert.equal(result.report.abnormalOhlc, 1);
  assert.equal(result.report.issues[0].code, "duplicate-timestamp");
  assert.equal(result.report.issues[1].code, "invalid-ohlc");
});

test("识别分号、日期/时间两列和逗号小数格式", () => {
  const result = parseDukascopyCsv(`Date;Time;Open;High;Low;Close;Volume
2026.01.05;09:30:00;1,1000;1,1010;1,0990;1,1005;10
`);
  assert.equal(result.report.accepted, 1);
  assert.equal(result.candles[0].timestamp, Date.parse("2026-01-05T09:30:00Z"));
  assert.equal(result.candles[0].open, 1.1);
  assert.equal(result.candles[0].volume, 10);
});

test("无时区日期按配置转换为 UTC", () => {
  const result = parseDukascopyCsv(`date,open,high,low,close
2026-01-05 09:30:00,1,2,0.5,1.5
`, { timestampTimeZone: "America/New_York" });
  assert.equal(result.candles[0].timestamp, Date.parse("2026-01-05T14:30:00Z"));
});

test("下载客户端只消费响应流，并通过注入 builder 生成 URL", async () => {
  const requested = [];
  const client = new DukascopyHistoricalClient({
    urlBuilder: createDukascopyQueryUrlBuilder({
      endpoint: "https://fixture.example/export",
      parameterNames: { instrument: "symbol", start: "from", end: "to", timeframe: "period" },
    }),
    fetcher: async (url) => {
      requested.push(String(url));
      return new Response("timestamp,open,high,low,close\n1767623400,1,2,0.5,1.5\n");
    },
  });

  const parsed = await client.downloadAndParseCsv({
    instrument: "EURUSD",
    start: "2026-01-05",
    end: "2026-01-06",
    timeframe: "m1",
  });
  const url = new URL(requested[0]);
  assert.equal(url.pathname, "/export");
  assert.equal(url.searchParams.get("symbol"), "EURUSD");
  assert.equal(url.searchParams.get("from"), "2026-01-05");
  assert.equal(url.searchParams.get("period"), "m1");
  assert.equal(parsed.report.accepted, 1);
  assert.equal(parsed.candles[0].timestamp, 1767623400000);
});

test("M1 聚合为 5m，并支持分块流式聚合", () => {
  const start = Date.UTC(2026, 0, 5, 0, 1);
  const source = [
    candle(start, 10, 2),
    candle(start + 60_000, 11, 3),
    candle(start + 3 * 60_000, 9, 4),
    candle(start + 4 * 60_000, 12, 5),
  ];
  const fiveMinute = aggregateM1To5m(source);
  assert.equal(fiveMinute.length, 2);
  assert.deepEqual(fiveMinute.map((bar) => bar.timestamp), [Date.UTC(2026, 0, 5, 0, 0), Date.UTC(2026, 0, 5, 0, 5)]);
  assert.equal(fiveMinute[0].open, 9.9);
  assert.equal(fiveMinute[0].high, 11.2);
  assert.equal(fiveMinute[0].low, 8.8);
  assert.equal(fiveMinute[0].close, 9);
  assert.equal(fiveMinute[0].volume, 9);

  const streamed = [...aggregateCandleChunks([source.slice(0, 2), source.slice(2)], "5m")];
  assert.deepEqual(streamed, fiveMinute);
});

test("5m 可按纽约 17:00 交易日切分为日线和周线", () => {
  const monday = Date.UTC(2026, 0, 5, 22, 0);
  const tuesday = Date.UTC(2026, 0, 6, 22, 0);
  const bars = [candle(monday, 10, 2), candle(monday + 5 * 60_000, 11, 3), candle(tuesday, 12, 4)];
  const daily = aggregate5mToTimeframe(bars, "1d");
  assert.deepEqual(daily.map((bar) => bar.timestamp), [monday, tuesday]);
  assert.equal(daily[0].volume, 5);

  const weekly = aggregate5mToTimeframe(bars, "1w", { weekStartsOn: 1 });
  assert.equal(weekly.length, 1);
  assert.equal(weekly[0].timestamp, monday);
  assert.equal(weekly[0].close, 12);
});

test("5m 可聚合为 M15、M30 和 H4，并在自然月边界生成 MN", () => {
  const start = Date.UTC(2026, 0, 5, 8, 0);
  const intraday = [
    candle(start, 10, 1),
    candle(start + 15 * 60_000, 11, 2),
    candle(start + 30 * 60_000, 12, 3),
    candle(start + 4 * 60 * 60_000, 13, 4),
  ];
  const m15 = aggregate5mToTimeframe(intraday, "15m");
  assert.deepEqual(m15.map((bar) => bar.timestamp), [
    start,
    start + 15 * 60_000,
    start + 30 * 60_000,
    start + 4 * 60 * 60_000,
  ]);
  assert.deepEqual(m15.map((bar) => bar.volume), [1, 2, 3, 4]);

  const m30 = aggregate5mToTimeframe(intraday, "30m");
  assert.deepEqual(m30.map((bar) => bar.timestamp), [start, start + 30 * 60_000, start + 4 * 60 * 60_000]);
  assert.deepEqual(m30.map((bar) => bar.volume), [3, 3, 4]);

  const h4 = aggregate5mToTimeframe(intraday, "4h");
  assert.deepEqual(h4.map((bar) => bar.timestamp), [start, start + 4 * 60 * 60_000]);
  assert.deepEqual(h4.map((bar) => bar.volume), [6, 4]);

  const monthly = aggregate5mToTimeframe([
    candle(Date.parse("2026-01-31T22:00:00Z"), 20, 5),
    candle(Date.parse("2026-02-01T22:00:00Z"), 21, 6),
    candle(Date.parse("2026-02-28T22:00:00Z"), 22, 7),
  ], "1mo");
  assert.deepEqual(monthly.map((bar) => bar.timestamp), [
    Date.parse("2026-01-01T22:00:00Z"),
    Date.parse("2026-02-01T22:00:00Z"),
  ]);
  assert.deepEqual(monthly.map((bar) => bar.volume), [5, 13]);
});

test("周末闭市被标记为 weekend，工作日断档才是普通 missing", () => {
  const fridayLast = Date.UTC(2026, 0, 9, 21, 55);
  const sundayOpen = Date.UTC(2026, 0, 11, 22, 0);
  const weekendGaps = findFxCandleGaps([candle(fridayLast, 10), candle(sundayOpen, 11)], "5m");
  assert.equal(weekendGaps.length, 1);
  assert.equal(weekendGaps[0].kind, "weekend");
  assert.equal(weekendGaps[0].ignored, true);

  const mondayStart = Date.UTC(2026, 0, 12, 22, 0);
  const workdayGaps = findFxCandleGaps([candle(mondayStart, 10), candle(mondayStart + 10 * 60_000, 11)], "5m");
  assert.equal(workdayGaps[0].kind, "missing");
  assert.equal(workdayGaps[0].missingBuckets, 1);
});

test("Dukascopy 日常维护和提前收市不作为可修复缺口", () => {
  assert.equal(
    isExpectedDukascopyClosureGap(
      Date.parse("2026-08-25T20:59:00Z"),
      Date.parse("2026-08-25T22:00:00Z"),
      "1m",
    ),
    true,
  );
  assert.equal(
    isExpectedDukascopyClosureGap(
      Date.parse("2026-09-07T18:28:00Z"),
      Date.parse("2026-09-07T22:00:00Z"),
      "1m",
    ),
    true,
  );
  assert.equal(
    isExpectedDukascopyClosureGap(
      Date.parse("2026-09-08T10:00:00Z"),
      Date.parse("2026-09-08T12:00:00Z"),
      "1m",
    ),
    false,
  );
  assert.equal(
    isExpectedDukascopyClosureGap(
      Date.parse("2026-08-25T20:55:00Z"),
      Date.parse("2026-08-25T22:00:00Z"),
      "5m",
    ),
    true,
  );
  assert.equal(
    isExpectedDukascopyClosureGap(
      Date.parse("2026-08-21T20:55:00Z"),
      Date.parse("2026-08-23T22:00:00Z"),
      "5m",
    ),
    true,
  );
  assert.equal(
    isExpectedDukascopyClosureGap(
      Date.parse("2026-08-25T23:55:00Z"),
      Date.parse("2026-09-13T22:00:00Z"),
      "5m",
    ),
    false,
  );
});
