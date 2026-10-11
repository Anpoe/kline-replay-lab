import assert from "node:assert/strict";
import test from "node:test";
import { buildLiveAccountLifecycleCommand, livePortfolioMatchesScope, sharedLiveAccountEquity } from "../app/features/live/liveAccountController.ts";
import { defaultAppSettings } from "../app/features/settings/settingsContracts.ts";

const account = { id: "old-US", market: "US", status: "active", tradingMode: "return", version: 63, cashBalance: 800, equity: 1000, displayName: "美股实时模拟账户" };

test("reset freezes the latest market defaults instead of the previous account configuration", () => {
  const settings = { ...defaultAppSettings, liveAccount: { tradingMode: "capital", initialCapitalByMarket: { CN: 10000, US: 5000 }, riskCapitalByMarket: { CN: 1000, US: 2000 } } };
  const command = buildLiveAccountLifecycleCommand(account, "reset-account", settings, "command", "new-US", 123);
  assert.equal(command.tradingMode, "capital");
  assert.equal(command.initialCapital, 5000);
  assert.equal(command.riskCapital, null);
  assert.equal(command.observedAccountVersion, 63);
  assert.equal(command.accountId, "old-US");
  assert.equal(command.newAccountId, "new-US");
  assert.equal(command.executionProfileVersion, settings.executionProfileVersion);
  assert.equal(buildLiveAccountLifecycleCommand({ ...account, market: "CN" }, "reset-account", settings, "c", "new-CN", 123).initialCapital, 10000);
  const pause = buildLiveAccountLifecycleCommand(account, "pause-account", settings, "pause", "unused", 123);
  assert.equal(pause.tradingMode, undefined);
});

test("current accounts, archived accounts and unlinked history are distinct scopes", () => {
  const accounts = [account, { ...account, id: "archived", status: "archived" }];
  const linked = { accountId: account.id }, archived = { accountId: "archived" }, legacy = {};
  assert.equal(livePortfolioMatchesScope(linked, "current", accounts), true);
  assert.equal(livePortfolioMatchesScope(archived, "current", accounts), false);
  assert.equal(livePortfolioMatchesScope(legacy, "current", accounts), false);
  assert.equal(livePortfolioMatchesScope(legacy, "unlinked", accounts), true);
  assert.equal(livePortfolioMatchesScope(archived, "archived", accounts), true);
  assert.equal(livePortfolioMatchesScope(linked, "archived", accounts), false);
});

test("shared equity includes every linked symbol, excludes other accounts and ignores closed lots", () => {
  const lot = { side: "long", qty: 10, entryPrice: 10, status: "open" };
  const portfolios = [
    { accountId: account.id, instrumentId: "A", latestClose: 12, positions: [lot, { ...lot, status: "closed" }] },
    { accountId: account.id, instrumentId: "B", latestClose: 30, positions: [lot] },
    { accountId: "another", instrumentId: "C", latestClose: 999, positions: [lot] },
  ];
  assert.equal(sharedLiveAccountEquity({ ...account, tradingMode: "capital" }, portfolios), 1220);
  assert.equal(sharedLiveAccountEquity({ ...account, tradingMode: "capital" }, portfolios, { instrumentId: "A", price: 15, positions: [{ ...lot, qty: 5 }] }), 1175);
  assert.equal(sharedLiveAccountEquity(account, portfolios), 1000);
});
