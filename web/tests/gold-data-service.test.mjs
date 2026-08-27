import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getMarketInstrumentDefinition } from "../app/lib/fxDataContracts.ts";

const serviceSource = await readFile(new URL("../app/lib/fxDataService.ts", import.meta.url), "utf8");

test("黄金目录解析结果可供数据任务使用", () => {
  assert.equal(getMarketInstrumentDefinition("XAU/USD")?.id, "XAUUSD.GOLD");
  assert.equal(getMarketInstrumentDefinition("XAU/USD")?.market, "GOLD");
  assert.match(serviceSource, /getFxCatalog\(market: \"FX\" \| \"GOLD\" = \"FX\"\)/);
  assert.match(serviceSource, /market === \"GOLD\"/);
});

test("创建任务使用跨市场 resolver 并保存两个黄金供应商代码", () => {
  assert.match(serviceSource, /getMarketInstrumentDefinition\(input\.pairId\)/);
  assert.match(serviceSource, /instrument\.dukascopySymbol/);
  assert.match(serviceSource, /instrument\.twelveDataSymbol/);
});
