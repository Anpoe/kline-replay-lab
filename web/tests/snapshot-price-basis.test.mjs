import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as adjustments from "../app/lib/marketAdjustments.ts";
import * as replayRange from "../app/lib/replayRange.ts";

const source = ts.transpileModule(readFileSync(new URL("../app/api/snapshots/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(actualBasis) {
  const instrument = { id: "300730.SZ", market: "CN", timezone: "Asia/Shanghai" };
  const candles = [{ timestamp: 1528243200000, open: 47.05, high: 52, low: 47, close: 50.5 }];
  let hashInput;
  const db = { prepare(sql) { return { bind() { return { first: async () => sql.includes("FROM instruments") ? instrument : { present: 1 } }; } }; } };
  const exports = {};
  const require = (id) => {
    if (id === "../../../db/runtime") return { getRawDb: () => db, ensureSchema: async () => {} };
    if (id === "../../lib/localDataService") return { readLocalDataJson: async () => ({ instrument, candles, adjustmentType: actualBasis, source: "tdx-official" }) };
    if (id === "../../lib/marketAdjustments") return adjustments;
    if (id === "../../lib/replayRange") return replayRange;
    if (id === "../../lib/timeframeCatalog") return { TIMEFRAME_IDS: ["1d"], isSupportedTimeframe: () => true };
    if (id === "../../lib/snapshotStorage") return {
      buildSnapshotChunks: async () => [{ chunkHash: "chunk" }], canonicalStringify: JSON.stringify,
      buildSnapshotContentHash: async input => { hashInput = input; return "hash"; },
      getSnapshotByContentHash: async () => ({ adjustmentType: hashInput.adjustmentType }),
      snapshotResponse: async (_db, row) => ({ snapshot: row, instrument, candles }),
    };
    if (["../../lib/marketRules", "../../lib/patternFilters", "../../lib/fx/dukascopyAggregation", "../../lib/timeframeAggregation", "../../lib/timeframeView"].includes(id)) return {};
    throw new Error(`Unexpected dependency ${id}`);
  };
  new Function("require", "exports", source)(require, exports);
  return exports;
}

test("raw local candles are hashed and labelled raw even when the request prefers qfq", async () => {
  const route = fixture("none");
  const response = await route.POST(new Request("http://localhost/api/snapshots", { method: "POST", body: JSON.stringify({ instrumentId: "300730.SZ", timeframe: "1d", adjustmentType: "qfq" }) }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).snapshot.adjustmentType, "none");
});

test("provider-adjusted candles retain their actual basis and missing basis is recoverable", async () => {
  for (const basis of ["qfq", "hfq", undefined]) {
    const response = await fixture(basis).POST(new Request("http://localhost/api/snapshots", { method: "POST", body: JSON.stringify({ instrumentId: "300730.SZ", timeframe: "1d" }) }));
    const body = await response.json();
    if (basis) { assert.equal(response.status, 200); assert.equal(body.snapshot.adjustmentType, basis); }
    else { assert.equal(response.status, 422); assert.match(body.error, /复权口径/); }
  }
});
