import assert from "node:assert/strict";
import test from "node:test";

import { createBackgroundWorkerServer } from "../local-data/background-worker.mjs";

function fakeRunner(state = {}) {
  let stopped = false;
  return {
    getState() {
      return { phase: "idle", lastStatus: "completed", ...state, stopped };
    },
    async runIfDue() {
      return { claimed: false, reason: "already-checked" };
    },
    stop() {
      stopped = true;
    },
  };
}

test("worker health/status 只暴露本机任务摘要", async (t) => {
  const server = createBackgroundWorkerServer({
    runner: fakeRunner({ phase: "idle", lastStatus: "completed" }),
    host: "127.0.0.1",
    port: 0,
    scheduleMs: 60_000,
  });
  await server.start();
  t.after(() => server.stop());

  const health = await fetch(`http://127.0.0.1:${server.port}/health`).then((result) => result.json());
  const status = await fetch(`http://127.0.0.1:${server.port}/status`).then((result) => result.json());

  assert.equal(health.ok, true);
  assert.equal(health.service, "kline-background-worker");
  assert.equal(status.phase, "idle");
  assert.equal("token" in status, false);
});

test("worker shutdown 停止调度并关闭服务", async () => {
  const runner = fakeRunner();
  const server = createBackgroundWorkerServer({
    runner,
    host: "127.0.0.1",
    port: 0,
    scheduleMs: 60_000,
  });
  await server.start();

  const response = await fetch(`http://127.0.0.1:${server.port}/shutdown`, { method: "POST" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { stopping: true });
  await server.stop();
  assert.equal(runner.getState().stopped, true);
});

test("worker 拒绝非 loopback 监听", () => {
  assert.throws(
    () => createBackgroundWorkerServer({ runner: fakeRunner(), host: "0.0.0.0" }),
    /loopback|本机/,
  );
});
