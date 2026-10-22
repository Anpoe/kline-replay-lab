import assert from "node:assert/strict";
import test from "node:test";
import { readMt4Lots, saveMt4Lots } from "../app/features/mt4/mt4LotPreferences.ts";

const eur = { symbol: "EURUSD.a", minLot: 0.01, maxLot: 100, lotStep: 0.01 };
const gold = { symbol: "XAUUSD.a", minLot: 0.1, maxLot: 20, lotStep: 0.1 };
function storage() {
  const data = new Map();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test("MT4 lots survive a fresh read and stay isolated by account and exact broker symbol", () => {
  const saved = storage();
  assert.equal(readMt4Lots(saved, "demo", eur).value, "0.01");
  assert.equal(saveMt4Lots(saved, "demo", eur, "0.23").saved, true);
  assert.equal(readMt4Lots(saved, "demo", eur).value, "0.23");
  assert.equal(readMt4Lots(saved, "real", eur).value, "0.01");
  assert.equal(readMt4Lots(saved, "demo", gold).value, "0.1");
  assert.equal(readMt4Lots(saved, "demo", { ...eur, symbol: "EURUSD" }).value, "0.01");
  saveMt4Lots(saved, "demo", gold, "1.2");
  saveMt4Lots(saved, "real", eur, "0.04");
  assert.equal(readMt4Lots(saved, "demo", eur).value, "0.23");
  assert.equal(readMt4Lots(saved, "demo", gold).value, "1.2");
  assert.equal(readMt4Lots(saved, "real", eur).value, "0.04");
});

test("temporary empty or invalid edits preserve the last valid lot preference", () => {
  const saved = storage();
  saveMt4Lots(saved, "account", eur, "0.30");
  for (const value of ["", " ", "0", "-1", "NaN", "Infinity", "0.005", "100.01", "0.015"]) {
    assert.equal(saveMt4Lots(saved, "account", eur, value).saved, false, value);
    assert.equal(readMt4Lots(saved, "account", eur).value, "0.30", value);
  }
  assert.equal(saveMt4Lots(saved, "account", eur, "0.29").saved, true);
  assert.equal(readMt4Lots(saved, "account", eur).value, "0.29");
});

test("missing context never writes a global preference; changed contract limits use the minimum", () => {
  const saved = storage();
  assert.equal(saveMt4Lots(saved, "", eur, "0.1").saved, false);
  assert.equal(saveMt4Lots(saved, "account", undefined, "0.1").saved, false);
  assert.equal(saved.data.size, 0);
  saveMt4Lots(saved, "account", eur, "0.03");
  const changed = readMt4Lots(saved, "account", { ...eur, minLot: 0.1, lotStep: 0.1 });
  assert.equal(changed.value, "0.1");
  assert.match(changed.error, /合约/);
  assert.equal(readMt4Lots(saved, "account", eur).value, "0.03");
});

test("read and write failures are recoverable and do not discard a saved quantity", () => {
  const saved = storage();
  saveMt4Lots(saved, "account", eur, "0.4");
  const blocked = { getItem() { throw Error("unavailable"); }, setItem() { throw Error("quota"); } };
  assert.match(readMt4Lots(blocked, "account", eur).error, /未能读取/);
  assert.match(saveMt4Lots(blocked, "account", eur, "0.6").error, /未保存/);
  assert.equal(readMt4Lots(saved, "account", eur).value, "0.4");
  assert.equal(saveMt4Lots(saved, "account", eur, "0.6").saved, true);
  assert.equal(readMt4Lots(saved, "account", eur).value, "0.6");
  saved.data.set([...saved.data.keys()][0], "broken");
  assert.equal(readMt4Lots(saved, "account", eur).value, "0.01");
});
