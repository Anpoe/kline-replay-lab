import assert from "node:assert/strict";
import test from "node:test";

import {
  liveAccountAvailableCash,
  liveAccountCurrencyForMarket,
  liveAccountHasActivity,
  liveAccountIdForMarket,
  normalizeLiveMarketAccountSnapshot,
} from "../app/lib/tradingAccount.ts";

test("market accounts have stable independent identities and currencies", () => {
  assert.equal(liveAccountIdForMarket("CN"), "live-account-CN");
  assert.equal(liveAccountIdForMarket("US"), "live-account-US");
  assert.equal(liveAccountCurrencyForMarket("CN"), "CNY");
  assert.equal(liveAccountCurrencyForMarket("US"), "USD");
  assert.notEqual(liveAccountIdForMarket("CN"), liveAccountIdForMarket("US"));
});

test("capital account snapshots expose shared reservations without mixing markets", () => {
  const cn = normalizeLiveMarketAccountSnapshot({
    id: "live-account-CN",
    market: "CN",
    tradingMode: "capital",
    initialCapital: 100_000,
    cashBalance: 80_000,
    reservedCash: 20_000,
    equity: 101_000,
    portfolioInstrumentIds: ["600519.SH", "000001.SZ"],
  });
  const us = normalizeLiveMarketAccountSnapshot({
    id: "live-account-US",
    market: "US",
    tradingMode: "capital",
    initialCapital: 100_000,
    cashBalance: 100_000,
    portfolioInstrumentIds: ["AAPL.US"],
  });

  assert.equal(cn?.currency, "CNY");
  assert.equal(us?.currency, "USD");
  assert.equal(cn && liveAccountAvailableCash(cn), 60_000);
  assert.equal(us && liveAccountAvailableCash(us), 100_000);
  assert.deepEqual(cn?.portfolioInstrumentIds, ["600519.SH", "000001.SZ"]);
  assert.equal(liveAccountHasActivity(cn), true);
  assert.equal(liveAccountHasActivity(us), true);
});

test("return-mode account keeps its risk base separate from buying power", () => {
  const account = normalizeLiveMarketAccountSnapshot({
    id: "live-account-CN",
    market: "CN",
    tradingMode: "return",
    riskCapital: 50_000,
    cashBalance: 0,
    equity: 50_000,
  });
  assert.equal(account?.tradingMode, "return");
  assert.equal(account?.riskCapital, 50_000);
  assert.equal(account && liveAccountAvailableCash(account), 0);
});
