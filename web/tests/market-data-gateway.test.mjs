import assert from "node:assert/strict";
import test from "node:test";

import {
  createMarketDataGateway,
  createMarketDataStorageGateway,
  marketDataStorageKeys,
} from "../app/features/market-data/marketDataGateway.ts";

function response({ ok = true, payload = {} } = {}) {
  return {
    ok,
    async json() {
      return payload;
    },
  };
}

test("clear request contains the explicit market confirmation and preserves server errors", async () => {
  const calls = [];
  const gateway = createMarketDataGateway(async (url, init) => {
    calls.push({ url, init });
    return response({ payload: { cleared: true } });
  });
  for (const market of ["CN", "US", "FX", "GOLD"]) await gateway.clearMarketData(market);
  assert.deepEqual(calls.map(call => JSON.parse(call.init.body)), ["CN", "US", "FX", "GOLD"].map(market => ({ market, confirmation: market })));
  assert.ok(calls.every(call => call.url === "/api/market-data" && call.init.method === "DELETE"));
  const failing = createMarketDataGateway(async () => response({ ok: false, payload: { error: "请先暂停任务" } }));
  await assert.rejects(failing.clearMarketData("CN"), /请先暂停任务/);
  await gateway.loadFxTask(undefined, undefined, "FX");
  assert.equal(calls.at(-1).url, "/api/fx-data?market=FX");
});

function createMemoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("preserves provider, job, and task polling endpoints", async () => {
  const requests = [];
  const gateway = createMarketDataGateway(async (input, init) => {
    requests.push({ input, init });
    return response({ payload: { providers: [], jobs: [], task: null, run: null } });
  });

  await gateway.loadProviders();
  await gateway.loadAutoUpdateStatus();
  await gateway.loadJobs("US");
  await gateway.loadMarketSync("run-1");
  await gateway.loadLocalTask();
  await gateway.loadCatalogTask();
  await gateway.loadCnMaintenanceTask();
  await gateway.loadFxTask();

  assert.deepEqual(requests.map((request) => request.input), [
    "/api/data-providers",
    "/api/data-auto-update",
    "/api/data-jobs?market=US",
    "/api/data-jobs/market/sync?runId=run-1",
    "/api/local-data",
    "/api/local-data?action=catalog-status",
    "/api/cn-maintenance",
    "/api/fx-data",
  ]);
  assert.equal(requests[1].init.cache, "no-store");
  assert.equal(requests[3].init.cache, "no-store");
  assert.equal(requests[7].init.cache, "no-store");
});

test("filters FX task polling by pair without breaking the legacy signal argument", async () => {
  const requests = [];
  const gateway = createMarketDataGateway(async (input, init) => {
    requests.push({ input, init });
    return response({ payload: { task: null } });
  });
  const signal = new AbortController().signal;

  await gateway.loadFxTask("XAUUSD.GOLD");
  await gateway.loadFxTask(signal);

  assert.equal(requests[0].input, "/api/fx-data?pairId=XAUUSD.GOLD");
  assert.equal(requests[0].init.signal, undefined);
  assert.equal(requests[1].input, "/api/fx-data");
  assert.equal(requests[1].init.signal, signal);
});

test("preserves data task actions and provider setting payloads", async () => {
  const requests = [];
  const gateway = createMarketDataGateway(async (input, init) => {
    requests.push({ input, init });
    return response({ payload: { task: { id: "task-1" }, run: { id: "run-1" }, autoUpdate: { enabled: true } } });
  });

  await gateway.startLocalInitialization({ assets: ["stock"] });
  await gateway.cnMaintenanceAction("start", "repair", 30);
  await gateway.startMarketSync("US", "initialize");
  await gateway.marketSyncWorker("run-1");
  await gateway.marketSyncAction("run-1", "pause");
  await gateway.runDownloadJob("job-1");
  await gateway.runFxTask("task-1");
  await gateway.fxDataAction({ type: "task", taskId: "task-1", action: "resume" });
  await gateway.updateJob("job-1", "retry");
  await gateway.saveProviderSettings({ provider: "tdxquant", tdxQuantEndpoint: "http://127.0.0.1:17709" });
  await gateway.deleteProviderSettings("tdxquant");

  assert.equal(requests[0].input, "/api/local-data");
  assert.deepEqual(JSON.parse(requests[0].init.body), { action: "start", plan: { assets: ["stock"] } });
  assert.deepEqual(JSON.parse(requests[1].init.body), { action: "start", mode: "repair", repairDays: 30 });
  assert.deepEqual(JSON.parse(requests[2].init.body), { market: "US", mode: "initialize" });
  assert.deepEqual(JSON.parse(requests[3].init.body), { runId: "run-1" });
  assert.deepEqual(JSON.parse(requests[4].init.body), { runId: "run-1", action: "pause" });
  assert.deepEqual(JSON.parse(requests[5].init.body), { id: "job-1" });
  assert.deepEqual(JSON.parse(requests[6].init.body), { taskId: "task-1" });
  assert.deepEqual(JSON.parse(requests[7].init.body), { taskId: "task-1", action: "resume" });
  assert.deepEqual(JSON.parse(requests[8].init.body), { id: "job-1", action: "retry" });
  assert.equal(requests[9].input, "/api/provider-settings");
  assert.equal(requests[10].input, "/api/provider-settings?provider=tdxquant");
  assert.equal(requests[10].init.method, "DELETE");
});

test("deduplicates the same market sync worker across gateway instances", async () => {
  const requests = [];
  let release;
  const fetcher = async (input, init) => {
    requests.push({ input, init });
    return await new Promise((resolve) => {
      release = () => resolve(response({ payload: { run: { id: "run-shared", status: "running" } } }));
    });
  };
  const firstGateway = createMarketDataGateway(fetcher);
  const secondGateway = createMarketDataGateway(fetcher);

  const first = firstGateway.marketSyncWorker("run-shared");
  const second = secondGateway.marketSyncWorker("run-shared");
  await Promise.resolve();
  assert.equal(requests.length, 1);

  release();
  assert.deepEqual(await first, { run: { id: "run-shared", status: "running" } });
  assert.deepEqual(await second, { run: { id: "run-shared", status: "running" } });
});

test("preserves the market onboarding storage key and cleans malformed data", () => {
  const storage = createMemoryStorage();
  const gateway = createMarketDataStorageGateway(storage);
  gateway.saveOnboardingPlan({ kind: "quick" });
  assert.deepEqual(gateway.loadOnboardingPlan(), { kind: "quick" });
  assert.equal(storage.values.has(marketDataStorageKeys.onboarding), true);
  storage.setItem(marketDataStorageKeys.onboarding, "{bad-json");
  assert.equal(gateway.loadOnboardingPlan(), null);
  assert.equal(storage.getItem(marketDataStorageKeys.onboarding), null);
});
