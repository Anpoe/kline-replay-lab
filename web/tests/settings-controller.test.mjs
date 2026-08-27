import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultAppSettings,
  normalizeSettings,
} from "../app/features/settings/settingsContracts.ts";
import {
  prepareSettingsSave,
  persistSettingsSave,
} from "../app/features/settings/settingsController.ts";

test("normalizes legacy and per-market order quantity settings", () => {
  const settings = normalizeSettings({
    ...defaultAppSettings,
    defaultOrderQty: 250,
    defaultOrderQtyByMarket: undefined,
    defaultTimeframe: "invalid",
    riskPercent: 999,
  });

  assert.equal(settings.defaultOrderQty, 250);
  assert.deepEqual(settings.defaultOrderQtyByMarket, { CN: 250, US: 250, FX: 250, GOLD: 250 });
  assert.equal(settings.defaultTimeframe, "1d");
  assert.equal(settings.riskPercent, 100);
});

test("rejects an incomplete random date range before persistence", () => {
  const result = prepareSettingsSave({
    ...defaultAppSettings,
    randomDateMode: "range",
    randomStartDate: "2025-01-01",
    randomEndDate: "",
  });

  assert.deepEqual(result, { ok: false, error: "随机时间段需要填写开始和结束日期。" });
});

test("rejects a random date range whose end precedes its start", () => {
  const result = prepareSettingsSave({
    ...defaultAppSettings,
    randomDateMode: "range",
    randomStartDate: "2025-02-01",
    randomEndDate: "2025-01-01",
  });

  assert.deepEqual(result, { ok: false, error: "随机时间段的结束日期不能早于开始日期。" });
});

test("persists only validated normalized settings", async () => {
  const writes = [];
  const result = await persistSettingsSave({
    ...defaultAppSettings,
    riskPercent: 0,
    randomDateMode: "all",
  }, {
    write: (settings) => writes.push(settings),
  });

  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].riskPercent, 1);
  assert.equal(writes[0], result.settings);
});

test("does not call the persistence adapter after validation fails", async () => {
  let writes = 0;
  const result = await persistSettingsSave({
    ...defaultAppSettings,
    randomDateMode: "range",
  }, {
    write: () => { writes += 1; },
  });

  assert.equal(result.ok, false);
  assert.equal(writes, 0);
});

test("waits for durable persistence before reporting settings saved", async () => {
  let releaseWrite = () => undefined;
  const pendingWrite = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  let settled = false;

  const resultPromise = Promise.resolve(persistSettingsSave(defaultAppSettings, {
    write: () => pendingWrite,
  })).then((result) => {
    settled = true;
    return result;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);

  releaseWrite();
  const result = await resultPromise;
  assert.equal(result.ok, true);
});

test("reports a durable persistence rejection instead of a successful save", async () => {
  const rejectedWrite = Promise.reject(new Error("database unavailable"));
  void rejectedWrite.catch(() => undefined);

  const result = await persistSettingsSave(defaultAppSettings, {
    write: () => rejectedWrite,
  });

  assert.deepEqual(result, { ok: false, error: "设置未能永久保存，请重试。" });
});

test("keeps strict mode, planning fields and personal SOP switches independent", () => {
  const settings = normalizeSettings({
    ...defaultAppSettings,
    strictModeEnabled: true,
    requirePretradePlan: false,
    requiredPretradeFields: ["marketState", "invalid", "stop"],
    sopCheckEnabled: false,
    personalSopCheckEnabled: true,
    personalSopAutoCloseEnabled: true,
  });

  assert.equal(settings.strictModeEnabled, true);
  assert.equal(settings.requirePretradePlan, false);
  assert.deepEqual(settings.requiredPretradeFields, ["marketState", "stop"]);
  assert.equal(settings.sopCheckEnabled, false);
  assert.equal(settings.personalSopCheckEnabled, true);
  assert.equal(settings.personalSopAutoCloseEnabled, true);
});

test("drops an active personal SOP that has not reached the 15-trade evidence line", () => {
  const settings = normalizeSettings({
    ...defaultAppSettings,
    activePersonalSopRule: {
      id: "weak-rule",
      version: "v1",
      title: "不够样本",
      scope: { market: "US", timeframe: "1d" },
      conditions: { patterns: [], reasons: [], plan: {} },
      management: { holdingBarsMin: 1, holdingBarsMax: 3 },
      stats: { samples: 14, winningTrades: 8, losingTrades: 6, flatTrades: 0, winRate: 57, averageResult: 1, totalResult: 14, profitFactor: 1.2 },
      managedDimensions: [],
      generatedAt: "2026-08-21T00:00:00.000Z",
    },
  });

  assert.equal(settings.activePersonalSopRule, null);
});
