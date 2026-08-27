import assert from "node:assert/strict";
import test from "node:test";

import {
  createMarketSyncWorkerCoordinator,
  createMarketSyncWorkerGate,
  shouldRefreshMarketSyncJobs,
} from "../app/lib/marketSyncWorkerCoordinator.ts";

test("同一个 run 的重叠 worker 请求只执行一次，并在短冷却窗口复用结果", async () => {
  let now = 0;
  let calls = 0;
  let release;
  const coordinator = createMarketSyncWorkerCoordinator({
    cooldownMs: 300,
    now: () => now,
  });
  const worker = () => {
    calls += 1;
    return new Promise((resolve) => {
      release = resolve;
    });
  };

  const first = coordinator.request("run-1", worker);
  const second = coordinator.request("run-1", () => Promise.resolve("错误的第二次请求"));
  await Promise.resolve();
  assert.equal(calls, 1);
  release("batch-1");
  assert.equal(await first, "batch-1");
  assert.equal(await second, "batch-1");

  const cached = await coordinator.request("run-1", () => Promise.resolve("错误的冷却期请求"));
  assert.equal(cached, "batch-1");
  assert.equal(calls, 1);

  now = 301;
  assert.equal(await coordinator.request("run-1", () => {
    calls += 1;
    return Promise.resolve("batch-2");
  }), "batch-2");
  assert.equal(calls, 2);
});

test("服务端 worker 门禁在已有批次运行时不等待并发请求", async () => {
  const gate = createMarketSyncWorkerGate();
  let release;
  let calls = 0;
  const first = gate.run(
    "run-1",
    () => {
      calls += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    async () => "busy",
  );

  assert.equal(await gate.run("run-1", async () => "错误的第二批", async () => "busy"), "busy");
  assert.equal(calls, 1);

  release("batch-1");
  assert.equal(await first, "batch-1");
  assert.equal(await gate.run("run-1", async () => "batch-2", async () => "busy"), "batch-2");
});

test("同步中的任务列表按时间间隔刷新，终态立即刷新", () => {
  assert.equal(shouldRefreshMarketSyncJobs("running", 1_000, 2_500), false);
  assert.equal(shouldRefreshMarketSyncJobs("running", 1_000, 3_000), true);
  assert.equal(shouldRefreshMarketSyncJobs("completed", 2_900, 2_901), true);
});
