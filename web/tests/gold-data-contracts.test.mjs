import assert from "node:assert/strict";
import test from "node:test";
import {
  GOLD_INSTRUMENT_CATALOG,
  getMarketInstrumentDefinition,
  MARKET_INSTRUMENT_CATALOG,
  normalizeMarketInstrument,
} from "../app/lib/fxDataContracts.ts";

test("标准化黄金内部品种并保留 Dukascopy 映射", () => {
  assert.equal(normalizeMarketInstrument("XAUUSD.GOLD"), "XAUUSD.GOLD");
  assert.equal(normalizeMarketInstrument("XAUUSD"), "XAUUSD.GOLD");
  assert.equal(normalizeMarketInstrument("XAU/USD"), "XAUUSD.GOLD");

  const instrument = getMarketInstrumentDefinition("gold");
  assert.equal(instrument?.id, "XAUUSD.GOLD");
  assert.equal(instrument?.market, "GOLD");
  assert.equal(instrument?.dukascopySymbol, "XAUUSD");
  assert.equal(instrument?.pricePrecision, 2);
});

test("黄金目录独立于 FX 目录，但包含在市场总目录", () => {
  assert.deepEqual(GOLD_INSTRUMENT_CATALOG.map((item) => item.id), ["XAUUSD.GOLD"]);
  assert.equal(MARKET_INSTRUMENT_CATALOG.some((item) => item.id === "XAUUSD.GOLD"), true);
  assert.equal(MARKET_INSTRUMENT_CATALOG.filter((item) => item.market === "FX").length, 6);
});

test("不把未知贵金属或 FX 品种误认成黄金", () => {
  assert.equal(normalizeMarketInstrument("XAG/USD"), null);
  assert.equal(normalizeMarketInstrument("EUR/USD"), "EURUSD.FX");
});
