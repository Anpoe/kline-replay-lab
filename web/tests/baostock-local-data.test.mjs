import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { BaoStockClient } from "../local-data/baostock-client.mjs";
import { BaoStockLocalStore } from "../local-data/baostock-store.mjs";
import {
  baoStockCodeFromInstrumentId,
  instrumentIdFromBaoStockCode,
  normalizeBaoStockRows,
} from "../local-data/baostock.mjs";

const execFileAsync = promisify(execFile);

const day = (value) => Date.UTC(
  Number(value.slice(0, 4)),
  Number(value.slice(5, 7)) - 1,
  Number(value.slice(8, 10)),
);

function fakeCatalog() {
  return [
    { code: "sh.600519", code_name: "贵州茅台", ipoDate: "2001-08-27", outDate: "", type: "1", status: "1" },
    { code: "sz.399001", code_name: "深证成指", ipoDate: "1991-04-04", outDate: "", type: "2", status: "1" },
  ];
}

function fakeHistory() {
  return [
    { date: "2026-07-20", code: "sh.600519", open: "10", high: "11", low: "9.8", close: "10.5", volume: "100", amount: "1000", adjustflag: "2" },
    { date: "2026-07-21", code: "sh.600519", open: "10.5", high: "12", low: "10.2", close: "11.8", volume: "200", amount: "2300", adjustflag: "2" },
    { date: "2026-07-27", code: "sh.600519", open: "11.8", high: "12.2", low: "11", close: "11.2", volume: "300", amount: "3300", adjustflag: "2" },
  ];
}

function createFakeClient() {
  let history = fakeHistory();
  return {
    async queryCatalog() {
      return fakeCatalog();
    },
    async queryHistory({ code }) {
      if (code === "sh.600519") return history;
      if (code === "sz.399001") return history.map((row) => ({ ...row, code }));
      return [];
    },
    async queryTradeDates() {
      return [
        { calendar_date: "2026-07-27", is_trading_day: "1" },
        { calendar_date: "2026-07-28", is_trading_day: "1" },
      ];
    },
    setHistory(rows) {
      history = rows;
    },
    close() {},
  };
}

function createDelayedClient() {
  const catalog = [
    { code: "sh.600519", code_name: "贵州茅台", ipoDate: "2001-08-27", outDate: "", type: "1", status: "1" },
    { code: "sz.000001", code_name: "平安银行", ipoDate: "1991-04-03", outDate: "", type: "1", status: "1" },
    { code: "sz.000002", code_name: "万科A", ipoDate: "1991-01-29", outDate: "", type: "1", status: "1" },
  ];
  let active = 0;
  let maxActive = 0;
  return {
    async queryCatalog() {
      return catalog;
    },
    async queryHistory({ code }) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return fakeHistory().map((row) => ({ ...row, code }));
    },
    maxActive() {
      return maxActive;
    },
    close() {},
  };
}

function createRestartingBridge(firstFailure = "timeout") {
  const children = [];
  return {
    children,
    spawn() {
      const generation = children.length + 1;
      const child = new EventEmitter();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      child.stdout = stdout;
      child.stderr = stderr;
      child.killed = false;
      child.stdin = {
        write(value) {
          const request = JSON.parse(value);
          if (generation === 1 && firstFailure === "timeout") return true;
          if (generation === 1 && firstFailure === "network") {
            queueMicrotask(() => stdout.write(JSON.stringify({
              id: request.id,
              ok: false,
              error: "网络接收错误。",
            }) + "\n"));
            return true;
          }
          queueMicrotask(() => stdout.write(JSON.stringify({
            id: request.id,
            ok: true,
            result: [{ code: request.code }],
          }) + "\n"));
          return true;
        },
      };
      child.kill = () => {
        if (child.killed) return false;
        child.killed = true;
        stdout.end();
        stderr.end();
        queueMicrotask(() => child.emit("close", null));
        return true;
      };
      children.push(child);
      return child;
    },
  };
}

test("BaoStock bridge keeps Windows JSON output ASCII-safe", async (context) => {
  const bridgeDirectory = fileURLToPath(new URL("../local-data/", import.meta.url));
  const python = process.env.BAOSTOCK_PYTHON ?? "python";
  try {
    const result = await execFileAsync(python, [
      "-c",
      "import sys; sys.path.insert(0, sys.argv[1]); from baostock_bridge import reply; reply(7, True, {'name': '\\u4e0a\\u8bc1\\u7efc\\u5408\\u6307\\u6570'})",
      bridgeDirectory,
    ], { encoding: "utf8" });
    const output = result.stdout.trim();
    assert.match(output, /^[\x00-\x7f]+$/);
    assert.equal(JSON.parse(output).result.name, "上证综合指数");
  } catch (error) {
    if (error?.code === "ENOENT") {
      context.skip("未安装 Python，跳过 BaoStock 桥接协议测试");
      return;
    }
    throw error;
  }
});

test("BaoStock code normalization keeps exchange ids and uses BaoStock daily units", () => {
  assert.equal(instrumentIdFromBaoStockCode("sh.600519"), "600519.SH");
  assert.equal(baoStockCodeFromInstrumentId("600519.SH"), "sh.600519");
  const result = normalizeBaoStockRows([
    ...fakeHistory(),
    { date: "2026-07-22", code: "sh.600519", open: "bad", high: "1", low: "1", close: "1", volume: "1", amount: "1" },
  ]);
  assert.equal(result.candles.length, 3);
  assert.equal(result.candles[0].volume, 100);
  assert.equal(result.candles[0].turnover, 1000);
  assert.equal(result.report.invalid, 1);
  assert.equal(result.candles[0].timestamp, day("2026-07-20"));
});

test("BaoStock client restarts the bridge and retries after a timeout", async () => {
  const bridge = createRestartingBridge();
  const client = new BaoStockClient({
    spawnProcess: (...args) => bridge.spawn(...args),
    timeoutMs: 15,
    maxRetries: 1,
    retryDelayMs: 0,
  });
  try {
    const result = await client.queryHistory({ code: "sh.600519" });
    assert.deepEqual(result, [{ code: "sh.600519" }]);
    assert.equal(bridge.children.length, 2);
    assert.equal(bridge.children[0].killed, true);
  } finally {
    client.close();
  }
});

test("BaoStock client restarts the bridge and retries after a network receive error", async () => {
  const bridge = createRestartingBridge("network");
  const client = new BaoStockClient({
    spawnProcess: (...args) => bridge.spawn(...args),
    timeoutMs: 15,
    maxRetries: 1,
    retryDelayMs: 0,
  });
  try {
    const result = await client.queryHistory({ code: "sh.600519" });
    assert.deepEqual(result, [{ code: "sh.600519" }]);
    assert.equal(bridge.children.length, 2);
    assert.equal(bridge.children[0].killed, true);
  } finally {
    client.close();
  }
});

test("BaoStock client refreshes an aged bridge session before the next request", async () => {
  const bridge = createRestartingBridge("none");
  let now = 0;
  const client = new BaoStockClient({
    spawnProcess: (...args) => bridge.spawn(...args),
    sessionRefreshMs: 1_000,
    nowProvider: () => now,
    timeoutMs: 15,
    maxRetries: 0,
    retryDelayMs: 0,
  });
  try {
    await client.queryHistory({ code: "sh.600519" });
    now = 1_001;
    await client.queryHistory({ code: "sh.600519" });
    assert.equal(bridge.children.length, 2);
    assert.equal(bridge.children[0].killed, true);
  } finally {
    client.close();
  }
});

test("BaoStock initialization serializes history requests through one session", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kline-baostock-concurrency-test-"));
  const client = createDelayedClient();
  const store = await new BaoStockLocalStore({
    root,
    client,
    historyConcurrency: 2,
    nowProvider: () => new Date("2026-07-28T12:00:00+08:00"),
  }).init();
  context.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  await store.createTask({ assets: ["stock"], historyRange: "all" });
  const deadline = Date.now() + 5000;
  while (![
    "completed",
    "failed",
  ].includes(store.getTask()?.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(store.getTask()?.status, "completed", store.getTask()?.error);
  assert.equal(client.maxActive(), 1);
  assert.equal(store.getTask()?.progress.processedInstruments, 3);
});

test("BaoStock local store coexists with legacy A-share files and serves qfq daily/weekly/monthly data", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kline-baostock-test-"));
  const legacyDay = path.join(root, "tdx", "day", "sh600519.day");
  await mkdir(path.dirname(legacyDay), { recursive: true });
  await writeFile(legacyDay, Buffer.from("legacy"));
  await writeFile(path.join(root, "task.json"), JSON.stringify({ kind: "tdx-full-daily", status: "completed" }));
  const client = createFakeClient();
  const store = await new BaoStockLocalStore({
    root,
    client,
    nowProvider: () => new Date("2026-07-28T12:00:00+08:00"),
  }).init();
  context.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  await store.createTask({ assets: ["stock", "index"], historyRange: "all" });
  const deadline = Date.now() + 5000;
  while (!["completed", "failed"].includes(store.getTask()?.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(store.getTask()?.status, "completed", store.getTask()?.error);
  assert.equal((await store.getManifest()).source, "baostock");
  assert.equal((await store.getManifest()).adjustmentType, "qfq");
  assert.equal((await store.getManifest()).adjustmentStatus, "ready");
  assert.equal((await store.getManifest()).adjustmentSource, "baostock-adjustflag-2");
  assert.equal((await store.getManifest()).factorCount, 0);
  assert.equal((await store.getInstruments()).length, 2);
  assert.equal((await store.getInstruments()).find((item) => item.id === "600519.SH").source, "baostock-qfq");
  assert.equal(await access(path.join(root, "tdx")).then(() => true, () => false), true);

  const daily = await store.getCandles("600519.SH", "1d", "none");
  const weekly = await store.getCandles("600519.SH", "1w");
  const monthly = await store.getCandles("600519.SH", "1mo");
  assert.equal(daily.adjustmentType, "qfq");
  assert.equal(daily.source, "baostock-qfq");
  assert.equal(daily.candles.length, 3);
  assert.equal(daily.candles[1].close, 11.8);
  assert.equal(weekly.candles.length, 2);
  assert.equal(monthly.candles.length, 1);
  assert.equal((await store.getCoverage({})).total, 6);

  client.setHistory([
    ...fakeHistory().map((row) => row.date === "2026-07-21" ? { ...row, close: "11.9" } : row),
    { date: "2026-07-28", code: "sh.600519", open: "11.2", high: "12.4", low: "11.1", close: "12.1", volume: "400", amount: "4800", adjustflag: "2" },
  ]);
  await store.startCnMaintenance({ mode: "repair", repairDays: 8 });
  const maintenanceDeadline = Date.now() + 5000;
  while (!["completed", "failed"].includes(store.getCnMaintenanceTask()?.status) && Date.now() < maintenanceDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(store.getCnMaintenanceTask()?.status, "completed", store.getCnMaintenanceTask()?.error);
  assert.equal(store.getCnMaintenanceTask()?.progress.correctedBars, 2);
  assert.equal(store.getCnMaintenanceTask()?.progress.insertedBars, 2);
  const maintained = await store.getCandles("600519.SH", "1d");
  assert.equal(maintained.candles.find((item) => item.timestamp === day("2026-07-21")).close, 11.9);
  assert.equal(maintained.candles.at(-1).close, 12.1);

  const deleted = await store.deleteInstruments(["600519.SH"]);
  assert.deepEqual(deleted, { deletedInstruments: 1, instrumentIds: ["600519.SH"] });
  assert.equal(await store.getCandles("600519.SH", "1d"), null);
});

test("BaoStock daily maintenance follows the selected asset categories", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kline-baostock-maintenance-assets-"));
  const requestedCodes = [];
  const client = {
    async queryHistory({ code }) {
      requestedCodes.push(code);
      return fakeHistory().map((row) => ({ ...row, code }));
    },
    close() {},
  };
  const store = await new BaoStockLocalStore({
    root,
    client,
    nowProvider: () => new Date("2026-07-28T12:00:00+08:00"),
  }).init();
  context.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  store.manifestCache = {
    assets: ["stock", "index"],
    adjustmentStatus: "ready",
    instruments: [
      {
        id: "600519.SH",
        name: "贵州茅台",
        assetType: "stock",
        status: "1",
        baostockCode: "sh.600519",
        firstTimestamp: day("2026-07-20"),
        lastTimestamp: day("2026-07-27"),
        barCount: 3,
      },
      {
        id: "399001.SZ",
        name: "深证成指",
        assetType: "index",
        status: "1",
        baostockCode: "sz.399001",
        firstTimestamp: day("2026-07-20"),
        lastTimestamp: day("2026-07-27"),
        barCount: 3,
      },
    ],
  };

  await store.startCnMaintenance({ mode: "repair", repairDays: 8 });
  const deadline = Date.now() + 5000;
  while (!["completed", "failed"].includes(store.getCnMaintenanceTask()?.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(store.getCnMaintenanceTask()?.status, "completed", store.getCnMaintenanceTask()?.error);
  assert.equal(store.getCnMaintenanceTask()?.progress.totalInstruments, 2);
  assert.equal(store.getCnMaintenanceTask()?.progress.processedInstruments, 2);
  assert.deepEqual(requestedCodes, ["sh.600519", "sz.399001"]);
});

test("BaoStock incremental maintenance rechecks a rolling window and repairs a gap before the latest bar", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kline-baostock-incremental-gap-"));
  const requests = [];
  const client = {
    async queryHistory(request) {
      requests.push(request);
      return [
        { date: "2026-07-21", code: request.code, open: "10.5", high: "12", low: "10.2", close: "11.9", volume: "200", amount: "2300", adjustflag: "2" },
        { date: "2026-07-23", code: request.code, open: "11.9", high: "12.3", low: "11.7", close: "12.1", volume: "250", amount: "3000", adjustflag: "2" },
      ];
    },
    close() {},
  };
  const store = await new BaoStockLocalStore({
    root,
    client,
    nowProvider: () => new Date("2026-07-28T16:00:00+08:00"),
  }).init();
  context.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  store.manifestCache = {
    assets: ["stock"],
    adjustmentStatus: "ready",
    instruments: [{
      id: "600519.SH",
      name: "贵州茅台",
      assetType: "stock",
      status: "1",
      baostockCode: "sh.600519",
      firstTimestamp: day("2026-07-21"),
      // The local latest bar is newer than the missing 23rd. A lastTimestamp
      // cursor alone would skip that gap; the rolling window must not.
      lastTimestamp: day("2026-07-28"),
      barCount: 2,
    }],
  };
  store.writeDaily("600519.SH", [
    { timestamp: day("2026-07-21"), open: 10.5, high: 12, low: 10.2, close: 11.8, volume: 200, turnover: 2300 },
    { timestamp: day("2026-07-28"), open: 12, high: 12.4, low: 11.8, close: 12.2, volume: 300, turnover: 3300 },
  ]);

  await store.startCnMaintenance({ mode: "incremental", repairDays: 8 });
  const deadline = Date.now() + 5000;
  while (!["completed", "failed"].includes(store.getCnMaintenanceTask()?.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(store.getCnMaintenanceTask()?.status, "completed", store.getCnMaintenanceTask()?.error);
  assert.equal(store.getCnMaintenanceTask()?.progress.correctedBars, 1);
  assert.equal(store.getCnMaintenanceTask()?.progress.insertedBars, 1);
  assert.deepEqual(requests.map(({ startDate, endDate }) => ({ startDate, endDate })), [{
    startDate: "2026-07-21",
    endDate: "2026-07-28",
  }]);
  const daily = await store.getCandles("600519.SH", "1d");
  assert.equal(daily.candles.find((item) => item.timestamp === day("2026-07-21")).close, 11.9);
  assert.equal(daily.candles.find((item) => item.timestamp === day("2026-07-23")).close, 12.1);
  assert.equal(daily.candles.at(-1).timestamp, day("2026-07-28"));
});
