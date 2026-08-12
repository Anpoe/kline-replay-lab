import assert from "node:assert/strict";
import test from "node:test";

import {
  accountNotional,
  accountPnl,
  createFxInstrumentEconomics,
  marginAccountSnapshot,
  parseFxInstrumentCurrencies,
  pipValueInAccount,
  quoteToAccountRate,
  requiredMargin,
  sourceQuotePrice,
} from "../app/lib/fxTrading.ts";

test("parses FX currencies and converts quote PnL into a USD account", () => {
  assert.deepEqual(parseFxInstrumentCurrencies("EURUSD.FX"), {
    baseCurrency: "EUR",
    quoteCurrency: "USD",
  });

  const eurusd = createFxInstrumentEconomics("EURUSD.FX", { accountCurrency: "USD", leverage: 100 });
  assert.ok(Math.abs(accountNotional(1.1, 1, eurusd) - 110_000) < 1e-8);
  assert.ok(Math.abs(requiredMargin(1.1, 1, eurusd) - 1_100) < 1e-8);
  assert.ok(Math.abs(accountPnl(1.1, 1.101, 1, "long", eurusd) - 100) < 1e-8);
  assert.equal(pipValueInAccount(1.1, 1, eurusd), 10);

  const usdjpy = createFxInstrumentEconomics("USDJPY.FX", { accountCurrency: "USD", leverage: 100 });
  assert.ok(Math.abs(quoteToAccountRate(usdjpy, 150) - 1 / 150) < 1e-12);
  assert.ok(Math.abs(accountNotional(150, 1, usdjpy) - 100_000) < 1e-8);
  assert.ok(Math.abs(requiredMargin(150, 1, usdjpy) - 1_000) < 1e-8);
  assert.ok(Math.abs(pipValueInAccount(150, 1, usdjpy) - 6.666666666666667) < 1e-12);
});

test("uses a frozen manual rate when the account is a third currency", () => {
  const eurgbp = createFxInstrumentEconomics("EURGBP.FX", {
    accountCurrency: "USD",
    leverage: 50,
    manualQuoteToAccountRate: 1.25,
  });
  assert.equal(quoteToAccountRate(eurgbp, 0.85), 1.25);
  assert.equal(accountNotional(0.85, 1, eurgbp), 106_250);
  assert.equal(requiredMargin(0.85, 1, eurgbp), 2_125);
});

test("builds Ask from BID while sell-side executions remain on BID", () => {
  const economics = createFxInstrumentEconomics("EURUSD.FX");
  assert.equal(sourceQuotePrice("sell", 1.1, 20, economics), 1.1);
  assert.equal(sourceQuotePrice("buy", 1.1, 20, economics), 1.1022);
});

test("margin snapshot exposes equity, available margin and stop-out state", () => {
  const economics = createFxInstrumentEconomics("EURUSD.FX", {
    accountCurrency: "USD",
    leverage: 100,
    stopOutLevelPct: 60,
  });
  const snapshot = marginAccountSnapshot({
    balance: 1_000,
    positions: [{
      side: "long",
      qty: 1,
      entryPrice: 1.1,
      status: "open",
      marginUsed: 1_100,
      instrumentEconomics: economics,
    }],
    sourcePrice: 1.095,
    spreadBps: 0,
    economics,
  });
  assert.ok(Math.abs(snapshot.floatingPnl + 500) < 1e-8);
  assert.ok(Math.abs(snapshot.equity - 500) < 1e-8);
  assert.ok(Math.abs(snapshot.marginLevelPct - 45.4545454545) < 1e-8);
  assert.equal(snapshot.liquidationRequired, true);
});
