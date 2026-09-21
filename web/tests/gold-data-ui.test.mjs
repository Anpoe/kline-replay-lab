import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const [manager, panel, gateway, api, providers, providerSettings] = await Promise.all([
  readFile(new URL("app/features/market-data/components/DataSourceManager.tsx", root), "utf8"),
  readFile(new URL("app/features/market-data/components/FxDataControlPanel.tsx", root), "utf8"),
  readFile(new URL("app/features/market-data/marketDataGateway.ts", root), "utf8"),
  readFile(new URL("app/api/fx-data/route.ts", root), "utf8"),
  readFile(new URL("app/api/data-providers/route.ts", root), "utf8"),
  readFile(new URL("app/features/market-data/components/ProviderSettingsPanel.tsx", root), "utf8"),
]);

test("黄金市场使用真实数据控制面板并选择 XAUUSD.GOLD", () => {
  assert.match(manager, /DEFAULT_GOLD_INSTRUMENTS/);
  assert.match(manager, /market === "GOLD"[\s\S]*FxDataControlPanel/);
  assert.doesNotMatch(manager, /黄金数据源尚未接入/);
  assert.match(panel, /XAUUSD\.GOLD/);
  assert.match(panel, /datasetLabel|instrumentNoun|marketLabel/);
});

test("黄金任务读取按品种过滤，避免显示最近的 FX 任务", () => {
  assert.match(manager, /const pairId = market === "GOLD" \? "XAUUSD\.GOLD"/);
  assert.match(gateway, /loadFxTask[\s\S]*pairId/);
  assert.match(gateway, /\/api\/fx-data\/repair/);
  assert.match(api, /url\.searchParams\.get\("market"\)/);
  assert.match(api, /getFxCatalog\(market\)/);
  assert.match(providers, /market: "外汇与黄金"/);
  assert.match(providerSettings, /外汇与黄金历史基准导入/);
  assert.match(providerSettings, /历史、每日增量、缺口修复都走 Dukascopy/);
});
