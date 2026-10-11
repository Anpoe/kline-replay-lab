import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BaoStockLocalStore } from "../local-data/baostock-store.mjs";
import { TdxLocalStore } from "../local-data/legacy-tdx-store.mjs";

const dates = [Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 8), Date.UTC(2026, 9, 9)];
const history = (prices) => prices.map((close, index) => ({ timestamp: dates[index], open: close, high: close + 1, low: close - 1, close, volume: 100, turnover: 1000 }));
const candles = history([10, 11, 10]);
const manifest = { instruments: [{ id: "600519.SH", symbol: "600519", name: "贵州茅台", assetType: "stock", barCount: 3, lastTimestamp: dates[2], relativePath: "sh/lday/sh600519.day" }] };

test("BaoStock scan keeps past matches and latest values with default latest-only behavior", async () => {
  const store = Object.create(BaoStockLocalStore.prototype);
  store.getManifest = async () => manifest;
  store.readDaily = () => candles;
  assert.equal((await store.scanLatest({ filters: { minPrice: 11 } })).matchedCount, 0);
  const result = await store.scanLatest({ filters: { minPrice: 11 }, lookbackDays: 2 });
  assert.equal(result.lookbackDays, 2);
  assert.equal(result.results[0].close, 10);
  assert.equal(result.results[0].matchedTimestamp, dates[1]);
  assert.equal(result.results[0].lagTradingDays, 1);
});

test("TDX scan reads historical matches from a clean local dataset", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kline-lag-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = path.join(root, manifest.instruments[0].relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  const buffer = Buffer.alloc(candles.length * 32);
  candles.forEach((bar, index) => {
    const offset = index * 32;
    const date = new Date(bar.timestamp).toISOString().slice(0, 10).replaceAll("-", "");
    buffer.writeUInt32LE(Number(date), offset);
    [bar.open, bar.high, bar.low, bar.close].forEach((value, field) => buffer.writeUInt32LE(value * 100, offset + 4 + field * 4));
    buffer.writeFloatLE(bar.turnover, offset + 20);
    buffer.writeUInt32LE(bar.volume, offset + 24);
  });
  await writeFile(target, buffer);
  const store = Object.create(TdxLocalStore.prototype);
  store.root = root;
  store.overlayDbFile = path.join(root, "absent.sqlite");
  store.getManifest = async () => manifest;
  assert.equal((await store.scanLatest({ filters: { minPrice: 11 } })).matchedCount, 0);
  const result = await store.scanLatest({ filters: { minPrice: 11 }, lookbackDays: 2 });
  assert.equal(result.results[0].close, 10);
  assert.equal(result.results[0].matchedTimestamp, dates[1]);
  assert.equal(result.results[0].lagTradingDays, 1);
});
