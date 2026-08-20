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

test("persists only validated normalized settings", () => {
  const writes = [];
  const result = persistSettingsSave({
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

test("does not call the persistence adapter after validation fails", () => {
  let writes = 0;
  const result = persistSettingsSave({
    ...defaultAppSettings,
    randomDateMode: "range",
  }, {
    write: () => { writes += 1; },
  });

  assert.equal(result.ok, false);
  assert.equal(writes, 0);
});
