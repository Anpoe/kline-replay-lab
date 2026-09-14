import assert from "node:assert/strict";
import test from "node:test";

import {
  createPreferencesGateway,
  createSettingsStorageGateway,
  settingsStorageKeys,
} from "../app/features/settings/settingsGateway.ts";
import { defaultAppSettings } from "../app/features/settings/settingsContracts.ts";
import { defaultMovingAverageSettings } from "../app/lib/chartIndicators.ts";
import { defaultPatternPresets } from "../app/lib/patternFilters.ts";

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
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

function createDeferred() {
  let resolve = () => undefined;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("loads and normalizes legacy settings without changing the storage key", () => {
  const storage = createMemoryStorage({
    [settingsStorageKeys.appSettings]: JSON.stringify({
      defaultOrderQty: 250,
      defaultTimeframe: "invalid",
      riskPercent: 999,
    }),
  });
  const gateway = createSettingsStorageGateway(storage);

  const result = gateway.loadAppSettings();

  assert.equal(result.settings.defaultOrderQty, 250);
  assert.equal(result.settings.defaultTimeframe, defaultAppSettings.defaultTimeframe);
  assert.equal(result.settings.riskPercent, 100);
  assert.equal(storage.values.has(settingsStorageKeys.appSettings), true);
  assert.equal(result.recoveredFromCorruption, false);
});

test("removes malformed settings and returns defaults", () => {
  const storage = createMemoryStorage({
    [settingsStorageKeys.appSettings]: "{not-json",
  });
  const gateway = createSettingsStorageGateway(storage);

  const result = gateway.loadAppSettings();

  assert.deepEqual(result.settings, defaultAppSettings);
  assert.equal(result.recoveredFromCorruption, true);
  assert.equal(storage.getItem(settingsStorageKeys.appSettings), null);
});

test("loads pattern, reason-tag, and indicator preferences with legacy fallbacks", () => {
  const storage = createMemoryStorage({
    [settingsStorageKeys.patternPresets]: JSON.stringify(defaultPatternPresets),
    [settingsStorageKeys.quickRandomPattern]: defaultPatternPresets[0].id,
    [settingsStorageKeys.randomTrainingPatternPresets]: JSON.stringify([defaultPatternPresets[0].id, "missing"]),
    [settingsStorageKeys.quickRandomMode]: "blind",
    [settingsStorageKeys.reasonTags]: JSON.stringify(["顺势", "自定义理由"]),
    [settingsStorageKeys.customReasonTags]: JSON.stringify(["自定义理由"]),
    [settingsStorageKeys.movingAverageSettings]: JSON.stringify(defaultMovingAverageSettings),
  });
  const gateway = createSettingsStorageGateway(storage);

  const patterns = gateway.loadPatternPreferences();
  const reasons = gateway.loadReasonTagPreferences();
  const indicators = gateway.loadMovingAverageSettings();

  assert.equal(patterns.quickRandomMode, "blind");
  assert.deepEqual(patterns.randomTrainingPatternPresetIds, [defaultPatternPresets[0].id]);
  assert.deepEqual(reasons.customReasonTags, ["自定义理由"]);
  assert.deepEqual(indicators, defaultMovingAverageSettings);
});

test("does not keep hidden built-ins in quick or random pattern selections", () => {
  const hiddenId = defaultPatternPresets[0].id;
  const storage = createMemoryStorage({
    [settingsStorageKeys.patternPresets]: JSON.stringify(defaultPatternPresets.map((preset) => (
      preset.id === hiddenId ? { ...preset, enabled: false } : preset
    ))),
    [settingsStorageKeys.quickRandomPattern]: hiddenId,
    [settingsStorageKeys.randomTrainingPatternPresets]: JSON.stringify([hiddenId, defaultPatternPresets[1].id]),
  });
  const gateway = createSettingsStorageGateway(storage);

  const patterns = gateway.loadPatternPreferences();

  assert.equal(patterns.patternPresets.find((preset) => preset.id === hiddenId)?.enabled, false);
  assert.equal(patterns.quickRandomPatternPresetId, "");
  assert.deepEqual(patterns.randomTrainingPatternPresetIds, [defaultPatternPresets[1].id]);
});

test("cleans all related pattern keys when one pattern preference is malformed", () => {
  const storage = createMemoryStorage({
    [settingsStorageKeys.patternPresets]: "{not-json",
    [settingsStorageKeys.quickRandomPattern]: "stale",
    [settingsStorageKeys.randomTrainingPatternPresets]: JSON.stringify(["stale"]),
    [settingsStorageKeys.quickRandomMode]: "blind",
  });
  const gateway = createSettingsStorageGateway(storage);

  const result = gateway.loadPatternPreferences();

  assert.deepEqual(result.patternPresets, defaultPatternPresets);
  assert.equal(result.quickRandomMode, "free");
  assert.deepEqual(result.randomTrainingPatternPresetIds, []);
  assert.equal(storage.getItem(settingsStorageKeys.patternPresets), null);
  assert.equal(storage.getItem(settingsStorageKeys.quickRandomPattern), null);
  assert.equal(storage.getItem(settingsStorageKeys.randomTrainingPatternPresets), null);
  assert.equal(storage.getItem(settingsStorageKeys.quickRandomMode), null);
});

test("preferences gateway preserves the existing API contract and normalizes errors", async () => {
  const requests = [];
  const gateway = createPreferencesGateway(async (input, init) => {
    requests.push({ input, init });
    return {
      ok: true,
      async json() {
        return { preferences: { version: 1, appSettings: defaultAppSettings } };
      },
    };
  });

  const loaded = await gateway.load();
  await gateway.save({ version: 1, appSettings: defaultAppSettings });

  assert.deepEqual(loaded, { version: 1, appSettings: defaultAppSettings });
  assert.equal(requests[0].input, "/api/preferences");
  assert.deepEqual(requests[0].init, { cache: "no-store" });
  assert.equal(requests[1].init.method, "PUT");
  assert.equal(requests[1].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(requests[1].init.body), { version: 1, appSettings: defaultAppSettings });
});

test("preferences gateway exposes a stable error for non-OK responses", async () => {
  const gateway = createPreferencesGateway(async () => ({
    ok: false,
    async json() {
      return { error: "server unavailable" };
    },
  }));

  await assert.rejects(() => gateway.load(), { message: "读取同步设置失败" });
  await assert.rejects(() => gateway.save({ version: 1 }), { message: "保存同步设置失败" });
});

test("restores chosen trading hours after saving and recreating the settings gateway", () => {
  const storage = createMemoryStorage();
  const session = { enabled: true, startTime: "07:00", endTime: "18:00", skipWeekends: true };
  createSettingsStorageGateway(storage).saveAppSettings({ ...defaultAppSettings, replayTradingSession: session });
  assert.deepEqual(createSettingsStorageGateway(storage).loadAppSettings().settings.replayTradingSession, session);
});

test("serializes preference saves so a slower old write cannot overwrite the latest settings", async () => {
  const firstWriteStarted = createDeferred();
  const releaseFirstWrite = createDeferred();
  const persistedTimeframes = [];
  let putCount = 0;
  const gateway = createPreferencesGateway(async (_input, init) => {
    if (init?.method === "PUT") {
      putCount += 1;
      const preferences = JSON.parse(init.body);
      if (putCount === 1) {
        firstWriteStarted.resolve();
        await releaseFirstWrite.promise;
      }
      persistedTimeframes.push(preferences.appSettings.defaultTimeframe);
    }
    return {
      ok: true,
      async json() {
        return { saved: true };
      },
    };
  });

  const oldSave = gateway.save({
    version: 1,
    appSettings: { ...defaultAppSettings, defaultTimeframe: "1m" },
  });
  await firstWriteStarted.promise;
  const latestSave = gateway.save({
    version: 1,
    appSettings: { ...defaultAppSettings, defaultTimeframe: "5m" },
  });
  await new Promise((resolve) => setImmediate(resolve));

  releaseFirstWrite.resolve();
  await Promise.all([oldSave, latestSave]);

  assert.deepEqual(persistedTimeframes, ["1m", "5m"]);
});

test("discards a preference read that became stale while newer settings were saved", async () => {
  const loadStarted = createDeferred();
  const releaseLoad = createDeferred();
  const oldPreferences = {
    version: 1,
    appSettings: { ...defaultAppSettings, defaultTimeframe: "1m" },
  };
  const gateway = createPreferencesGateway(async (_input, init) => {
    if (init?.method === "PUT") {
      return {
        ok: true,
        async json() {
          return { saved: true };
        },
      };
    }
    loadStarted.resolve();
    await releaseLoad.promise;
    return {
      ok: true,
      async json() {
        return { preferences: oldPreferences };
      },
    };
  });

  const pendingLoad = gateway.load();
  await loadStarted.promise;
  await gateway.save({
    version: 1,
    appSettings: { ...defaultAppSettings, defaultTimeframe: "5m" },
  });
  releaseLoad.resolve();

  assert.equal(await pendingLoad, undefined);
});
