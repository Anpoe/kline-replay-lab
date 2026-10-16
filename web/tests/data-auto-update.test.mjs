import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createBackgroundAutoUpdateRunner } from "../local-data/background-auto-update.mjs";

import {
  DATA_AUTO_UPDATE_SETTINGS_KEY,
  DEFAULT_DATA_AUTO_UPDATE_SCHEDULE_TIME,
  claimDataAutoUpdate,
  completeDataAutoUpdate,
  readDataAutoUpdateSettings,
  normalizeDataAutoUpdateSettings,
  renewDataAutoUpdate,
  shouldClaimDataAutoUpdate,
  writeDataAutoUpdateSettings,
} from "../app/lib/dataAutoUpdateSettings.ts";

const today = "2026-08-23";
const now = new Date("2026-08-23T08:00:00.000Z");

function settings(overrides = {}) {
  return {
    enabled: true,
    scheduledEnabled: false,
    scheduledTime: DEFAULT_DATA_AUTO_UPDATE_SCHEDULE_TIME,
    lastCheckDate: today,
    lastStartedAt: "2026-08-23T07:00:00.000Z",
    lastFinishedAt: "2026-08-23T07:30:00.000Z",
    lastStatus: "completed",
    lastMessage: "已完成",
    lastRunToken: null,
    ...overrides,
  };
}

function createDb(initialSettings, { beforeRun } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  if (initialSettings) {
    sqlite.prepare("INSERT INTO app_metadata (key, value) VALUES (?, ?)")
      .run(DATA_AUTO_UPDATE_SETTINGS_KEY, JSON.stringify(initialSettings));
  }
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...values) {
          return {
            async first() {
              return statement.get(...values) ?? null;
            },
            async run() {
              await beforeRun?.(sql, values);
              const result = statement.run(...values);
              return { meta: { changes: Number(result.changes) } };
            },
          };
        },
      };
    },
    close() {
      sqlite.close();
    },
  };
}

test("定时自动更新设置保留合法时间并为旧数据补默认值", () => {
  assert.deepEqual(
    normalizeDataAutoUpdateSettings({
      enabled: true,
      scheduledEnabled: true,
      scheduledTime: "09:30",
    }),
    {
      enabled: true,
      scheduledEnabled: true,
      scheduledTime: "09:30",
      lastCheckDate: null,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastStatus: "idle",
      lastMessage: "",
      lastRunToken: null,
    },
  );
  const legacy = normalizeDataAutoUpdateSettings({ enabled: true, scheduledTime: "25:70" });
  assert.equal(legacy.scheduledEnabled, false);
  assert.equal(legacy.scheduledTime, DEFAULT_DATA_AUTO_UPDATE_SCHEDULE_TIME);
});

test("自动更新时间判定使用系统本地时间而不是固定时区", async () => {
  const source = await readFile(new URL("../app/lib/dataAutoUpdateSettings.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Asia\/Shanghai/);
  assert.match(source, /getHours\(\)/);
});

test("A 股自动更新读取初始化时绑定的增量来源", async () => {
  const [service, localServer] = await Promise.all([
    readFile(new URL("../app/lib/dataAutoUpdateService.ts", import.meta.url), "utf8"),
    readFile(new URL("../local-data/server.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(service, /incrementalSource/);
  assert.match(service, /incrementalSource === "none"/);
  assert.match(service, /incrementalSource === "tdx-realtime"/);
  assert.match(service, /latestClosedCnDate/);
  assert.match(service, /typeof dataset\?\.includeCorporateActions === "boolean"/);
  assert.match(localServer, /incrementalEnabled/);
  assert.match(localServer, /incrementalSource: dataset\?\.incrementalSource/);
  assert.match(localServer, /manifest\.includeCorporateActions === true\s*\? store\.corporateActions\.getStatus\(\)\s*:\s*null/);
});

test("同日成功不再 claim，失败冷却后允许重试，跨日重新检查", () => {
  assert.equal(shouldClaimDataAutoUpdate(settings({ enabled: false }), today, now.getTime()), false);
  assert.equal(shouldClaimDataAutoUpdate(settings(), today, now.getTime()), false);
  assert.equal(shouldClaimDataAutoUpdate(settings({ lastStatus: "failed" }), today, now.getTime()), true);
  assert.equal(shouldClaimDataAutoUpdate(settings({ lastStatus: "partial" }), today, now.getTime()), true);
  assert.equal(shouldClaimDataAutoUpdate(settings({ lastCheckDate: "2026-08-22" }), today, now.getTime()), true);
  assert.equal(shouldClaimDataAutoUpdate(settings({ enabled: false, scheduledEnabled: true, scheduledTime: "09:00", lastCheckDate: "2026-08-22" }), today, new Date(2026, 7, 23, 10, 0).getTime()), true);
  assert.equal(shouldClaimDataAutoUpdate(settings({ lastStatus: "deferred" }), today, now.getTime()), true);
});

test("同日失败重试保留十五分钟冷却、定时开关和并发租约保护", async () => {
  for (const lastStatus of ["failed", "partial"]) {
    const previous = settings({ lastStatus, lastFinishedAt: now.toISOString() });
    assert.equal(shouldClaimDataAutoUpdate(previous, today, now.getTime() + 899_999), false);
    assert.equal(shouldClaimDataAutoUpdate(previous, today, now.getTime() + 900_000), true);
    assert.equal(shouldClaimDataAutoUpdate({ ...previous, enabled: false }, today, now.getTime() + 900_000), false);
    assert.equal(shouldClaimDataAutoUpdate({ ...previous, lastFinishedAt: null }, today, now.getTime()), true);
    const store = createDb(previous);
    try {
      const results = await Promise.all(["retry-1", "retry-2"].map((runToken) => claimDataAutoUpdate(store, {
        date: today, runToken, now: new Date(now.getTime() + 900_000),
      })));
      assert.equal(results.filter((result) => result.claimed).length, 1);
    } finally { store.close(); }
  }
});

test("后台更新在外汇服务恢复后同日重新执行，成功后不再重复创建任务", async () => {
  const store = createDb(settings({ lastCheckDate: "2026-08-22" }));
  let clock = new Date(now);
  let available = false;
  let tasks = 0;
  const runner = createBackgroundAutoUpdateRunner({
    now: () => clock,
    sleep: async () => undefined,
    leaseRenewIntervalMs: 0,
    fetchImpl: async (input, init = {}) => {
      const url = new URL(input);
      const body = init.body ? JSON.parse(init.body) : {};
      if (url.pathname === "/api/data-auto-update") {
        if (body.action === "claim") {
          const result = await claimDataAutoUpdate(store, { ...body, now: clock });
          return Response.json({ shouldRun: result.claimed, settings: result.settings });
        }
        if (body.action === "complete") return Response.json(await completeDataAutoUpdate(store, { ...body, now: clock }));
        if (url.searchParams.has("scope")) return Response.json({ markets: { FX: { existing: true, duePairIds: ["EURUSD.FX"] } } });
        return Response.json({ settings: await readDataAutoUpdateSettings(store) });
      }
      if (url.pathname === "/api/fx-data") return Response.json({ task: null });
      if (url.pathname === "/api/fx-data/update") return Response.json({ task: { id: `task-${++tasks}`, status: "queued" } });
      if (url.pathname === "/api/fx-data/run") return Response.json({ task: {
        status: available ? "completed" : "failed", error: available ? null : "数据服务要求访问验证，请稍后重试",
      } });
      throw new Error(`Unexpected request: ${url.pathname}`);
    },
  });
  try {
    assert.equal((await runner.runIfDue()).status, "failed");
    clock = new Date(now.getTime() + 14 * 60_000);
    assert.equal((await runner.runIfDue()).claimed, false);
    assert.equal(tasks, 1);
    available = true;
    clock = new Date(now.getTime() + 15 * 60_000);
    assert.equal((await runner.runIfDue()).status, "completed");
    assert.equal((await readDataAutoUpdateSettings(store)).lastStatus, "completed");
    assert.equal((await runner.runIfDue()).claimed, false);
    assert.equal(runner.getState().error, null);
    assert.equal(tasks, 2);
  } finally { store.close(); }
});

test("收盘前未写入的自动更新标记为 deferred，并允许收盘后同日重试", async () => {
  const store = createDb(settings({ lastStatus: "running", lastRunToken: "deferred-token" }));
  try {
    const completed = await completeDataAutoUpdate(store, {
      runToken: "deferred-token",
      status: "deferred",
      message: "尚未收市，等待收盘后重试",
      now,
    });
    assert.equal(completed.completed, true);
    assert.equal(completed.settings.lastStatus, "deferred");
    assert.equal(shouldClaimDataAutoUpdate(completed.settings, today, now.getTime()), true);
  } finally {
    store.close();
  }
});

test("运行中的自动更新只有超过租约才允许接管", () => {
  assert.equal(shouldClaimDataAutoUpdate(settings({
    lastStatus: "running",
    lastStartedAt: "2026-08-23T07:55:00.000Z",
  }), today, now.getTime()), false);
  assert.equal(shouldClaimDataAutoUpdate(settings({
    lastCheckDate: "2026-08-22",
    lastStatus: "running",
    lastStartedAt: "2026-08-23T07:55:00.000Z",
  }), today, now.getTime()), false);
  assert.equal(shouldClaimDataAutoUpdate(settings({
    lastStatus: "running",
    lastStartedAt: "2026-08-23T07:00:00.000Z",
  }), today, Date.parse("2026-08-23T07:11:00.000Z")), true);
});

test("定时 claim 在服务端仍未到时间时会被拒绝", async () => {
  const store = createDb(settings({
    enabled: false,
    scheduledEnabled: true,
    scheduledTime: "18:00",
    lastCheckDate: "2026-08-22",
    lastStatus: "failed",
  }));
  try {
    const result = await claimDataAutoUpdate(store, {
      date: today,
      runToken: "scheduled-token",
      trigger: "scheduled",
      now: new Date(2026, 7, 23, 17, 0),
    });
    assert.equal(result.claimed, false);
  } finally {
    store.close();
  }
});

test("跨日 claim 并发时只有一个成功", async () => {
  const store = createDb(settings({ lastCheckDate: "2026-08-22", lastStatus: "failed" }));
  try {
    const [first, second] = await Promise.all([
      claimDataAutoUpdate(store, { date: today, runToken: "token-1", now }),
      claimDataAutoUpdate(store, { date: today, runToken: "token-2", now }),
    ]);

    assert.equal([first.claimed, second.claimed].filter(Boolean).length, 1);
    const claimed = first.claimed ? first : second;
    assert.equal(claimed.settings.lastStatus, "running");
    assert.match(claimed.settings.lastMessage, /正在检查/);
  } finally {
    store.close();
  }
});

test("完成自动更新时必须匹配当前 claim token", async () => {
  const store = createDb(settings({
    lastStatus: "running",
    lastRunToken: "current-token",
    lastFinishedAt: null,
  }));
  try {
    const stale = await completeDataAutoUpdate(store, {
      runToken: "old-token",
      status: "completed",
      message: "旧任务完成",
      now,
    });
    assert.equal(stale.completed, false);

    const completed = await completeDataAutoUpdate(store, {
      runToken: "current-token",
      status: "completed",
      message: "全部完成",
      now,
    });
    assert.equal(completed.completed, true);
    assert.equal(completed.settings.lastStatus, "completed");
    assert.equal(completed.settings.lastRunToken, null);
  } finally {
    store.close();
  }
});

test("兼容旧自动更新完成请求不带 token", async () => {
  const store = createDb(settings({
    lastStatus: "running",
    lastRunToken: "current-token",
    lastFinishedAt: null,
  }));
  try {
    const completed = await completeDataAutoUpdate(store, {
      status: "completed",
      message: "旧调用方完成",
      now,
    });
    assert.equal(completed.completed, true);
  } finally {
    store.close();
  }
});

test("后台自动更新可用当前 token 续租", async () => {
  const store = createDb(settings({
    lastStatus: "running",
    lastRunToken: "current-token",
    lastFinishedAt: null,
    lastStartedAt: "2026-08-23T07:00:00.000Z",
  }));
  try {
    const stale = await renewDataAutoUpdate(store, {
      runToken: "old-token",
      now,
    });
    assert.equal(stale.renewed, false);

    const renewed = await renewDataAutoUpdate(store, {
      runToken: "current-token",
      now,
    });
    assert.equal(renewed.renewed, true);
    assert.equal(renewed.settings.lastStartedAt, now.toISOString());
    assert.equal(renewed.settings.lastRunToken, "current-token");
  } finally {
    store.close();
  }
});

test("设置写入不会覆盖并发 claim 的运行状态", async () => {
  let store;
  let injected = false;
  store = createDb(settings({ lastCheckDate: "2026-08-22", lastStatus: "failed" }), {
    beforeRun: async (sql) => {
      if (!injected && sql.includes("ON CONFLICT")) {
        injected = true;
        await claimDataAutoUpdate(store, { date: today, runToken: "claim-token", now });
      }
    },
  });
  try {
    const saved = await writeDataAutoUpdateSettings(store, { scheduledEnabled: true });
    const persisted = await readDataAutoUpdateSettings(store);
    assert.equal(saved.lastStatus, "running");
    assert.equal(persisted.lastStatus, "running");
    assert.equal(persisted.lastRunToken, "claim-token");
    assert.equal(persisted.scheduledEnabled, true);
  } finally {
    store.close();
  }
});

test("自动更新 API 使用原子 claim，后台 worker 保持本地运行 token", async () => {
  const route = await readFile(new URL("../app/api/data-auto-update/route.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../local-data/background-auto-update.mjs", import.meta.url), "utf8");

  assert.match(route, /claimDataAutoUpdate/);
  assert.match(route, /completeDataAutoUpdate/);
  assert.match(route, /renewDataAutoUpdate/);
  assert.match(route, /runToken/);
  assert.match(worker, /action: "claim"/);
  assert.match(worker, /action: "renew"/);
  assert.match(worker, /action: "complete".*runToken/s);
  assert.doesNotMatch(route, /\.\.\.\(result\.claimed \? \{ runToken \}/);
});
