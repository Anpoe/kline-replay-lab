import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { zipSync } from "fflate";
import { TdxLocalStore } from "../local-data/store.mjs";
import {
  aggregateWeekly,
  classifyTdxInstrument,
  instrumentIdFromEntry,
  parseTdxDayBuffer,
} from "../local-data/tdx-day.mjs";

function dayBuffer(rows) {
  const buffer = Buffer.alloc(rows.length * 32);
  rows.forEach((row, index) => {
    const offset = index * 32;
    buffer.writeInt32LE(row.date, offset);
    buffer.writeInt32LE(Math.round(row.open * 100), offset + 4);
    buffer.writeInt32LE(Math.round(row.high * 100), offset + 8);
    buffer.writeInt32LE(Math.round(row.low * 100), offset + 12);
    buffer.writeInt32LE(Math.round(row.close * 100), offset + 16);
    buffer.writeFloatLE(row.turnover ?? 1000, offset + 20);
    buffer.writeInt32LE(row.volume ?? 100, offset + 24);
  });
  return buffer;
}

const sampleRows = [
  { date: 20260720, open: 10, high: 11, low: 9.8, close: 10.5, volume: 100 },
  { date: 20260721, open: 10.5, high: 12, low: 10.2, close: 11.8, volume: 200 },
  { date: 20260727, open: 11.8, high: 12.2, low: 11, close: 11.2, volume: 300 },
];

test("TDX .day records decode and aggregate into calendar weeks", () => {
  const bars = parseTdxDayBuffer(dayBuffer(sampleRows));
  assert.equal(bars.length, 3);
  assert.deepEqual(
    { open: bars[0].open, high: bars[1].high, close: bars[2].close },
    { open: 10, high: 12, close: 11.2 },
  );
  const weekly = aggregateWeekly(bars);
  assert.equal(weekly.length, 2);
  assert.deepEqual(
    { open: weekly[0].open, high: weekly[0].high, low: weekly[0].low, close: weekly[0].close, volume: weekly[0].volume },
    { open: 10, high: 12, low: 9.8, close: 11.8, volume: 300 },
  );
});

test("TDX paths map to stable ids and common asset classes", () => {
  assert.equal(instrumentIdFromEntry("sh/lday/sh600519.day"), "600519.SH");
  assert.equal(instrumentIdFromEntry("sz\\lday\\sz399001.day"), "399001.SZ");
  assert.equal(classifyTdxInstrument("600519.SH"), "stock");
  assert.equal(classifyTdxInstrument("000001.SH"), "index");
  assert.equal(classifyTdxInstrument("510300.SH"), "fund");
  assert.equal(classifyTdxInstrument("123001.SZ"), "convertible-bond");
});

test("local store downloads, indexes and serves daily/weekly candles", async (context) => {
  const archive = Buffer.from(zipSync({
    "sh/lday/sh600519.day": new Uint8Array(dayBuffer(sampleRows)),
    "sz/lday/sz399001.day": new Uint8Array(dayBuffer(sampleRows)),
  }));
  const server = http.createServer(async (request, response) => {
    if (request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const tradeDate = body.params?.trade_date;
      const items = tradeDate === "20260721"
        ? [["600519.SH", tradeDate, 10.5, 12, 10.2, 11.9, 2, 1]]
        : tradeDate === "20260728"
          ? [["600519.SH", tradeDate, 11.2, 12.4, 11.1, 12.1, 4, 2]]
          : [];
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        code: 0,
        data: {
          fields: ["ts_code", "trade_date", "open", "high", "low", "close", "vol", "amount"],
          items,
        },
      }));
      return;
    }
    const range = request.headers.range?.match(/^bytes=(\d+)-$/);
    const offset = range ? Number(range[1]) : 0;
    response.writeHead(offset ? 206 : 200, {
      "content-type": "application/zip",
      "content-length": archive.length - offset,
      ...(offset ? { "content-range": `bytes ${offset}-${archive.length - 1}/${archive.length}` } : {}),
    });
    response.end(archive.subarray(offset));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const address = server.address();
  const root = await mkdtemp(path.join(os.tmpdir(), "kline-tdx-test-"));

  const store = await new TdxLocalStore({
    root,
    sourceUrl: `http://127.0.0.1:${address.port}/hsjday.zip`,
    tushareUrl: `http://127.0.0.1:${address.port}/`,
    nowProvider: () => new Date("2026-07-28T12:00:00+08:00"),
    tushareThrottleMs: 0,
  }).init();
  context.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  await store.createTask({
    assets: ["stock", "index"],
    historyRange: "all",
    keepRawPackage: false,
  });
  const deadline = Date.now() + 5000;
  while (!["completed", "failed"].includes(store.getTask()?.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(store.getTask()?.status, "completed", store.getTask()?.error);
  assert.equal((await store.getInstruments()).length, 2);
  const daily = await store.getCandles("600519.SH", "1d");
  const weekly = await store.getCandles("600519.SH", "1w");
  assert.equal(daily.candles.length, 3);
  assert.equal(weekly.candles.length, 2);
  const coverage = await store.getCoverage({ offset: 1, limit: 2 });
  assert.equal(coverage.total, 4);
  assert.equal(coverage.coverage.length, 2);
  assert.deepEqual(coverage.coverage.map((item) => item.timeframe), ["1w", "1d"]);
  assert.match((await store.getManifest()).datasetVersion, /^tdx-[a-f0-9]{16}$/);

  await store.startCnMaintenance({ mode: "repair", token: "test-token", repairDays: 8 });
  const maintenanceDeadline = Date.now() + 5000;
  while (
    !["completed", "failed"].includes(store.getCnMaintenanceTask()?.status)
    && Date.now() < maintenanceDeadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(
    store.getCnMaintenanceTask()?.status,
    "completed",
    store.getCnMaintenanceTask()?.error,
  );
  assert.equal(store.getCnMaintenanceTask()?.progress.insertedBars, 1);
  assert.equal(store.getCnMaintenanceTask()?.progress.correctedBars, 1);
  const maintainedDaily = await store.getCandles("600519.SH", "1d");
  assert.equal(maintainedDaily.candles.length, 4);
  assert.equal(maintainedDaily.candles.find((item) =>
    new Date(item.timestamp).toISOString().startsWith("2026-07-21"))?.close, 11.9);
  assert.equal(maintainedDaily.candles.at(-1).close, 12.1);
  assert.equal((await store.getCandles("600519.SH", "1w")).candles.length, 2);
  assert.match((await store.getManifest()).datasetVersion, /-ts-\d+$/);

  const deletion = await store.deleteInstruments(["600519.SH"]);
  assert.deepEqual(deletion, { deletedInstruments: 1, instrumentIds: ["600519.SH"] });
  assert.equal(await store.getCandles("600519.SH", "1d"), null);
  assert.equal((await store.getInstruments()).length, 1);
  assert.match((await store.getManifest()).datasetVersion, /^tdx-[a-f0-9]{16}(?:-ts-\d+)?-edit-\d+$/);
});
