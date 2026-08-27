import assert from "node:assert/strict";
import test from "node:test";

import {
  createBackgroundAutoUpdateRunner,
  isScheduledAutoUpdateDue,
  localDateInTimeZone,
} from "../local-data/background-auto-update.mjs";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function createFakeFetch(routes) {
  const calls = [];
  const counts = new Map();
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const method = String(init.method ?? "GET").toUpperCase();
    const key = `${method} ${url.pathname}${url.search}`;
    const baseKey = `${method} ${url.pathname}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    calls.push({ key, baseKey, count, body: init.body ? JSON.parse(init.body) : undefined });
    const route = routes[key] ?? routes[baseKey];
    if (route == null) throw new Error(`未配置 fake route: ${key}`);
    const value = typeof route === "function" ? await route({ key, count, calls }) : route;
    return value && typeof value.json === "function" ? value : response(value);
  };
  return { fetchImpl, calls };
}

test("按系统本地日期计算跨午夜日期", () => {
  assert.equal(
    localDateInTimeZone(new Date(2026, 7, 24, 0, 30)),
    "2026-08-24",
  );
});

test("自动更新关闭时不 claim 也不创建市场任务", async () => {
  const { fetchImpl, calls } = createFakeFetch({
    "GET /api/data-auto-update": { settings: { enabled: false, lastStatus: "idle" } },
  });
  const runner = createBackgroundAutoUpdateRunner({
    fetchImpl,
    now: () => new Date("2026-08-23T08:00:00.000Z"),
  });

  const result = await runner.runIfDue();

  assert.deepEqual(result, { claimed: false, reason: "disabled" });
  assert.deepEqual(calls.map((call) => call.key), ["GET /api/data-auto-update"]);
});

test("定时点前不 claim，定时点后才允许执行", () => {
  const settings = { scheduledEnabled: true, scheduledTime: "18:00" };
  assert.equal(
    isScheduledAutoUpdateDue(settings, new Date(2026, 7, 23, 17, 59)),
    false,
  );
  assert.equal(
    isScheduledAutoUpdateDue(settings, new Date(2026, 7, 23, 18, 0)),
    true,
  );
});

test("仅开启定时更新且晚于时间启动时会立即 claim", async () => {
  const { fetchImpl, calls } = createFakeFetch({
    "GET /api/data-auto-update": {
      settings: {
        enabled: false,
        scheduledEnabled: true,
        scheduledTime: "09:00",
        lastCheckDate: "2026-08-22",
        lastStatus: "completed",
      },
    },
    "POST /api/data-auto-update": ({ calls: currentCalls }) => {
      const body = currentCalls.at(-1).body;
      if (body.action === "claim") return { shouldRun: true };
      assert.equal(body.action, "complete");
      return { completed: true };
    },
    "GET /api/data-auto-update?scope=existing": {
      markets: {
        CN: { existing: false, needsUpdate: false },
        US: { existing: false, needsUpdate: false },
        FX: { existing: false, needsUpdate: false, duePairIds: [] },
      },
    },
  });
  const runner = createBackgroundAutoUpdateRunner({
    fetchImpl,
    now: () => new Date(2026, 7, 23, 10, 0),
    randomUUID: () => "safe-token",
    sleep: async () => undefined,
  });

  const result = await runner.runIfDue();

  assert.equal(result.claimed, true);
  assert.equal(result.status, "completed");
  assert.deepEqual(calls.map((call) => call.key), [
    "GET /api/data-auto-update",
    "POST /api/data-auto-update",
    "GET /api/data-auto-update?scope=existing",
    "POST /api/data-auto-update",
  ]);
});

test("仅开启定时更新且尚未到时间时不 claim", async () => {
  const { fetchImpl, calls } = createFakeFetch({
    "GET /api/data-auto-update": {
      settings: { enabled: false, scheduledEnabled: true, scheduledTime: "18:00" },
    },
  });
  const runner = createBackgroundAutoUpdateRunner({
    fetchImpl,
    now: () => new Date(2026, 7, 23, 9, 0),
  });

  const result = await runner.runIfDue();

  assert.deepEqual(result, { claimed: false, reason: "scheduled-not-due" });
  assert.deepEqual(calls.map((call) => call.key), ["GET /api/data-auto-update"]);
});

test("已完成当天的 claim 不会启动市场任务", async () => {
  const { fetchImpl, calls } = createFakeFetch({
    "GET /api/data-auto-update": { settings: { enabled: true, lastStatus: "completed" } },
    "POST /api/data-auto-update": {
      shouldRun: false,
      settings: { enabled: true, lastStatus: "completed", lastCheckDate: "2026-08-23" },
    },
  });
  const runner = createBackgroundAutoUpdateRunner({
    fetchImpl,
    now: () => new Date("2026-08-23T08:00:00.000Z"),
    randomUUID: () => "safe-token",
  });

  const result = await runner.runIfDue();

  assert.deepEqual(result, { claimed: false, reason: "already-checked" });
  assert.deepEqual(calls.map((call) => call.key), [
    "GET /api/data-auto-update",
    "POST /api/data-auto-update",
  ]);
});

test("按 A 股、美股、外汇顺序执行并用同一 token 完成", async () => {
  const { fetchImpl, calls } = createFakeFetch({
    "GET /api/data-auto-update": { settings: { enabled: true, lastStatus: "idle" } },
    "POST /api/data-auto-update": ({ calls: currentCalls }) => {
      const body = currentCalls.at(-1).body;
      if (body.action === "claim") return { shouldRun: true, runToken: "safe-token" };
      assert.equal(body.action, "complete");
      assert.equal(body.runToken, "safe-token");
      assert.equal(body.status, "completed");
      return { completed: true };
    },
    "GET /api/data-auto-update?scope=existing": {
      markets: {
        CN: { existing: true, needsUpdate: true, reason: "有新数据" },
        US: { existing: true, needsUpdate: true, reason: "有新数据" },
        FX: { existing: true, needsUpdate: true, duePairIds: ["EUR/USD"], pairs: [], reason: "有新数据" },
        GOLD: { existing: false, needsUpdate: false, reason: "未接入" },
      },
    },
    "POST /api/cn-maintenance": { maintenanceTask: { status: "running" } },
    "GET /api/cn-maintenance": ({ count }) => count === 1
      ? { maintenanceTask: { status: "running" } }
      : { maintenanceTask: { status: "completed" } },
    "POST /api/data-jobs/market/sync": { run: { id: "us-run", status: "running" } },
    "POST /api/data-jobs/market/sync/worker": { run: { id: "us-run", status: "completed" } },
    "GET /api/fx-data?pairId=EUR%2FUSD": { task: null },
    "POST /api/fx-data/update": { task: { id: "fx-task", status: "queued" } },
    "POST /api/fx-data/run": { task: { id: "fx-task", status: "completed" } },
  });
  const logs = [];
  const runner = createBackgroundAutoUpdateRunner({
    fetchImpl,
    now: () => new Date("2026-08-23T08:00:00.000Z"),
    randomUUID: () => "safe-token",
    sleep: async () => undefined,
    onLog: (entry) => logs.push(entry),
  });

  const result = await runner.runIfDue();

  assert.equal(result.claimed, true);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.updated, ["A股", "美股", "EUR/USD"]);
  const keys = calls.map((call) => call.key);
  assert.ok(keys.indexOf("POST /api/cn-maintenance") < keys.indexOf("POST /api/data-jobs/market/sync"));
  assert.ok(keys.indexOf("POST /api/data-jobs/market/sync/worker") < keys.indexOf("POST /api/fx-data/update"));
  assert.doesNotMatch(JSON.stringify(logs), /safe-token/);
});

test("已有黄金数据且有新 M1 时会调度 XAUUSD.GOLD 增量任务", async () => {
  const { fetchImpl, calls } = createFakeFetch({
    "GET /api/data-auto-update": { settings: { enabled: true, lastStatus: "idle" } },
    "POST /api/data-auto-update": ({ calls: currentCalls }) => {
      const body = currentCalls.at(-1).body;
      return body.action === "claim"
        ? { shouldRun: true, runToken: "gold-token" }
        : { completed: true };
    },
    "GET /api/data-auto-update?scope=existing": {
      markets: {
        CN: { existing: false, needsUpdate: false },
        US: { existing: false, needsUpdate: false },
        FX: { existing: false, needsUpdate: false, duePairIds: [] },
        GOLD: { existing: true, needsUpdate: true, duePairIds: ["XAUUSD.GOLD"] },
      },
    },
    "GET /api/fx-data?pairId=XAUUSD.GOLD": { task: null },
    "POST /api/fx-data/update": { task: { id: "gold-task", status: "queued" } },
    "POST /api/fx-data/run": { task: { id: "gold-task", status: "completed" } },
  });
  const runner = createBackgroundAutoUpdateRunner({
    fetchImpl,
    now: () => new Date("2026-08-23T08:00:00.000Z"),
    randomUUID: () => "gold-token",
    sleep: async () => undefined,
  });

  const result = await runner.runIfDue();

  assert.equal(result.status, "completed");
  assert.deepEqual(result.updated, ["XAUUSD.GOLD"]);
  assert.ok(calls.some((call) => call.key === "POST /api/fx-data/update" && call.body.pairId === "XAUUSD.GOLD"));
});

test("长任务会用 claim token 续租", async () => {
  const { fetchImpl, calls } = createFakeFetch({
    "GET /api/data-auto-update": { settings: { enabled: true, lastStatus: "idle" } },
    "POST /api/data-auto-update": ({ calls: currentCalls }) => {
      const body = currentCalls.at(-1).body;
      if (body.action === "claim") return { shouldRun: true, runToken: "safe-token" };
      if (body.action === "renew") return { renewed: true };
      return { completed: true };
    },
    "GET /api/data-auto-update?scope=existing": {
      markets: {
        CN: { existing: true, needsUpdate: true, reason: "有新数据" },
        US: { existing: false, needsUpdate: false },
        FX: { existing: false, needsUpdate: false, duePairIds: [] },
      },
    },
    "POST /api/cn-maintenance": { maintenanceTask: { status: "running" } },
    "GET /api/cn-maintenance": ({ count }) => count === 1
      ? { maintenanceTask: { status: "running" } }
      : { maintenanceTask: { status: "completed" } },
  });
  const runner = createBackgroundAutoUpdateRunner({
    fetchImpl,
    now: () => new Date("2026-08-23T08:00:00.000Z"),
    randomUUID: () => "safe-token",
    leaseRenewIntervalMs: 1,
    sleep: async () => new Promise((resolve) => setTimeout(resolve, 8)),
  });

  const result = await runner.runIfDue();

  assert.equal(result.status, "completed");
  assert.ok(calls.some((call) => call.body?.action === "renew"));
});

test("单个市场失败后继续执行其他市场并记录 partial", async () => {
  const { fetchImpl, calls } = createFakeFetch({
    "GET /api/data-auto-update": { settings: { enabled: true, lastStatus: "idle" } },
    "POST /api/data-auto-update": ({ calls: currentCalls }) => {
      const body = currentCalls.at(-1).body;
      return body.action === "claim"
        ? { shouldRun: true, runToken: "safe-token" }
        : { completed: true };
    },
    "GET /api/data-auto-update?scope=existing": {
      markets: {
        CN: { existing: true, needsUpdate: true, reason: "有新数据" },
        US: { existing: true, needsUpdate: true, reason: "有新数据" },
        FX: { existing: false, needsUpdate: false, duePairIds: [], pairs: [], reason: "没有外汇数据" },
        GOLD: { existing: false, needsUpdate: false, reason: "未接入" },
      },
    },
    "POST /api/cn-maintenance": response({ error: "Tushare 不可用" }, 400),
    "POST /api/data-jobs/market/sync": { run: { id: "us-run", status: "running" } },
    "POST /api/data-jobs/market/sync/worker": { run: { id: "us-run", status: "completed" } },
  });
  const runner = createBackgroundAutoUpdateRunner({
    fetchImpl,
    now: () => new Date("2026-08-23T08:00:00.000Z"),
    randomUUID: () => "safe-token",
    sleep: async () => undefined,
  });

  const result = await runner.runIfDue();

  assert.equal(result.status, "partial");
  assert.deepEqual(result.updated, ["美股"]);
  assert.equal(result.failures.length, 1);
  assert.ok(calls.some((call) => call.key === "POST /api/data-jobs/market/sync"));
});
