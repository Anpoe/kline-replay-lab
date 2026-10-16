import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Mt4Bridge } from "../local-data/mt4-bridge.mjs";

const quote = { symbol: "EURUSD.a", digits: 5, point: 0.00001, bid: 1.1, ask: 1.1002, quoteTime: 1800000000,
  minLot: 0.01, maxLot: 100, lotStep: 0.01, contractSize: 100000, tickValue: 1, tickSize: 0.00001,
  stopLevel: 10, freezeLevel: 0, tradeAllowed: true };
function snapshot(overrides = {}) {
  return { protocolVersion: 1, sessionId: "terminal-1", capturedAt: 1800000000,
    account: { login: "12345", server: "Broker-Demo", mode: "demo", currency: "USD", balance: 10000,
      equity: 10000, margin: 0, freeMargin: 10000, profit: 0, connected: true, tradeAllowed: true, allowReal: false },
    symbols: [quote], orders: [], history: [], chart: { symbol: "EURUSD.a", timeframe: 5, bars: [] }, receipts: [], ...overrides };
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "kline-mt4-"));
  let time = 1800000000000;
  const bridge = await new Mt4Bridge({ root, now: () => time }).init();
  t.after(() => rm(root, { force: true, recursive: true }));
  const pairing = await bridge.ui({ action: "pair" });
  const heartbeat = (data = snapshot()) => bridge.terminal(pairing.token, { ...data, capturedAt: Math.floor(time / 1000) });
  const enable = () => bridge.ui({ action: "enable", accountKey: bridge.status().accountKey, confirmation: "12345" });
  const command = (id = "11111111-1111-4111-8111-111111111111", fields = {}) => bridge.ui({ action: "command", command: {
    id, accountKey: bridge.status().accountKey, type: "open", symbol: "EURUSD.a", side: "buy", orderType: "market",
    lots: 0.01, price: 0, stopLoss: 0, takeProfit: 0, slippage: 20, ...fields } });
  return { bridge, root, pairing, heartbeat, enable, command, advance: ms => { time += ms; } };
}
test("first use pairs, validates snapshots and requires explicit enable", async t => {
  const f = await fixture(t);
  assert.equal(f.bridge.status().connection, "waiting");
  await assert.rejects(() => f.bridge.terminal("bad", snapshot()), /凭证/);
  await f.heartbeat();
  await assert.rejects(() => f.command(), /开启/);
  await f.enable();
  const result = await f.command();
  assert.equal(result.commands[0].status, "queued");
  assert.equal(f.bridge.status().snapshot.account.balance, 10000);
});
test("terminal clock offset is optional, preserved and bounded", async t => {
  const f = await fixture(t); await f.heartbeat();
  assert.equal(f.bridge.status().snapshot.serverUtcOffset, undefined);
  await f.heartbeat(snapshot({ serverUtcOffset: 7200 }));
  assert.equal(f.bridge.status().snapshot.serverUtcOffset, 7200);
  assert.equal(f.bridge.status().snapshot.capturedAt, 1800000000);
  await assert.rejects(() => f.heartbeat(snapshot({ serverUtcOffset: 86400 })), /终端时差/);
});
test("risk sizing requires capable EA, recomputes lots and remains idempotent", async t => {
  const f = await fixture(t); await f.heartbeat(); await f.enable();
  const input = { sizingMode: "risk-percent", riskPercent: 1, lots: 0.01, stopLoss: 1.09 };
  await assert.rejects(() => f.command(undefined, input), /更新/);
  await f.heartbeat(snapshot({ executionVersion: 2 }));
  const result = await f.command(undefined, input);
  assert.equal(result.commands[0].lots, 0.09);
  assert.equal((await f.command(undefined, input)).commands.length, 1);
  const wire = (await f.heartbeat(snapshot({ executionVersion: 2 }))).wire.split("|");
  assert.equal(wire.length, 23); assert.equal(wire[16], "risk-percent"); assert.equal(wire[17], "1");
  assert.equal((await f.heartbeat(snapshot({ executionVersion: 2 }))).wire, "");
});
test("gap filter binds the current market-buy bar and rejects blocked or stale context", async t => {
  const f = await fixture(t);
  const chart = { symbol: quote.symbol, timeframe: 5, bars: [
    { timestamp: 1799999700000, open: 1.1, high: 1.11, low: 1.09, close: 1.1, volume: 10 },
    { timestamp: 1800000000000, open: 1.1001, high: 1.11, low: 1.09, close: 1.1002, volume: 10 }] };
  await f.heartbeat(snapshot({ executionVersion: 2, chart })); await f.enable();
  const input = { gapMode: "high", gapUnit: "percent", gapThreshold: 0.1, gapTimeframe: 5, gapBarTime: 1800000000000 };
  await assert.rejects(() => f.command(undefined, { ...input, gapThreshold: 0.0001 }), /不符合/);
  await assert.rejects(() => f.command(undefined, { ...input, gapBarTime: 1799999700000 }), /重新读取/);
  await f.command(undefined, input);
  const wire = (await f.heartbeat(snapshot({ executionVersion: 2, chart }))).wire.split("|");
  assert.equal(wire[18], "high"); assert.equal(wire[22], "1800000000");
});
test("capability downgrade before delivery rejects advanced command without dispatch", async t => {
  const f = await fixture(t); await f.heartbeat(snapshot({ executionVersion: 2 })); await f.enable();
  await f.command(undefined, { sizingMode: "risk-percent", riskPercent: 1, stopLoss: 1.09 });
  assert.equal((await f.heartbeat()).wire, "");
  assert.equal(f.bridge.status().commands[0].status, "failed");
});
test("same command id is idempotent, conflicting reuse fails and delivery happens once", async t => {
  const f = await fixture(t); await f.heartbeat(); await f.enable(); await f.command();
  assert.equal((await f.command()).commands.length, 1);
  await assert.rejects(() => f.command(undefined, { lots: 0.02 }), /重复/);
  const delivery = await f.heartbeat();
  assert.match(delivery.wire, /^11111111/);
  assert.equal((await f.heartbeat()).wire, "");
  await f.heartbeat(snapshot({ receipts: [{ id: "11111111-1111-4111-8111-111111111111", status: "succeeded", ticket: 9001, error: "" }] }));
  assert.equal(f.bridge.status().commands[0].ticket, 9001);
  assert.equal(f.bridge.status().commands[0].status, "succeeded");
});
test("lost delivery, heartbeat expiry and restart never replay an order", async t => {
  const f = await fixture(t); await f.heartbeat(); await f.enable(); await f.command(); await f.heartbeat();
  f.advance(16000);
  assert.equal(f.bridge.status().connection, "offline");
  assert.equal(f.bridge.status().commands[0].status, "unknown");
  assert.equal((await f.heartbeat()).wire, "");
  const restarted = await new Mt4Bridge({ root: f.root, now: () => 1800000016000 }).init();
  assert.equal(restarted.status().enabled, false);
  assert.equal((await restarted.terminal(f.pairing.token, snapshot())).wire, "");
  assert.equal(restarted.status().commands[0].status, "unknown");
});
test("account switch blocks old commands and real accounts need both approvals", async t => {
  const f = await fixture(t); await f.heartbeat(); await f.enable(); await f.command();
  const real = snapshot(); real.account = { ...real.account, mode: "real", server: "Broker-Live" };
  assert.equal((await f.heartbeat(real)).wire, "");
  assert.equal(f.bridge.status().commands[0].status, "cancelled");
  await assert.rejects(() => f.enable(), /实盘/);
  real.account.allowReal = true; await f.heartbeat(real);
  await assert.rejects(() => f.enable(), /实盘/);
  await f.bridge.ui({ action: "enable", accountKey: f.bridge.status().accountKey, confirmation: "12345", acceptReal: true });
  assert.equal(f.bridge.status().enabled, true);
});
test("volume, stale quotes, stops and serial queue use broker rules", async t => {
  const f = await fixture(t); await f.heartbeat(); await f.enable();
  await assert.rejects(() => f.command(undefined, { lots: 0.015 }), /手数/);
  await assert.rejects(() => f.command(undefined, { stopLoss: 1.09999 }), /止损/);
  await f.command();
  await assert.rejects(() => f.command("22222222-2222-4222-8222-222222222222"), /未完成/);
  await f.bridge.ui({ action: "pause" });
  assert.equal((await f.heartbeat()).wire, "");
  f.advance(61000); await f.heartbeat(); await f.enable();
  await assert.rejects(() => f.command("33333333-3333-4333-8333-333333333333"), /报价/);
});
test("different terminal instance cannot hijack a live pairing", async t => {
  const f = await fixture(t); await f.heartbeat(); await f.enable();
  await assert.rejects(() => f.heartbeat(snapshot({ sessionId: "terminal-2" })), /另一个/);
  f.advance(16000); await f.heartbeat(snapshot({ sessionId: "terminal-2" }));
  assert.equal(f.bridge.status().enabled, false);
});
test("malformed snapshots and unsolicited receipts do not change command state", async t => {
  const f = await fixture(t); await f.heartbeat(); await f.enable(); await f.command();
  await f.heartbeat(snapshot({ receipts: [{ id: "11111111-1111-4111-8111-111111111111", status: "succeeded", ticket: 1, error: "" }] }));
  assert.equal(f.bridge.status().commands[0].status, "sent");
  await assert.rejects(() => f.heartbeat(snapshot({ symbols: [{ ...quote, ask: NaN }] })), /报价/);
  assert.equal(f.bridge.status().snapshot.symbols[0].ask, quote.ask);
});
test("late and repeated receipts reconcile unknown results without another delivery", async t => {
  const f = await fixture(t); await f.heartbeat(); await f.enable(); await f.command(); await f.heartbeat();
  f.advance(16000); f.bridge.status();
  const data = snapshot({ receipts: [{ id: "11111111-1111-4111-8111-111111111111", status: "succeeded", ticket: 9010, error: "" }] });
  const first = await f.heartbeat(data), second = await f.heartbeat(data);
  assert.equal(first.wire, ""); assert.equal(second.wire, ""); assert.equal(first.ack, second.ack);
  assert.equal(f.bridge.status().commands[0].status, "succeeded");
});
test("close, cancel and protection target the current broker ticket", async t => {
  const f = await fixture(t);
  const order = { ticket: 123, symbol: quote.symbol, type: 0, lots: 0.01, openPrice: 1.1, stopLoss: 0, takeProfit: 0,
    profit: 2, swap: -1, commission: -1, openTime: 1800000000, closeTime: 0, closePrice: 0, magic: 0 };
  await f.heartbeat(snapshot({ orders: [order] })); await f.enable();
  await assert.rejects(() => f.command(undefined, { type: "cancel", ticket: 123 }), /订单/);
  await assert.rejects(() => f.command(undefined, { type: "close", ticket: 124 }), /订单/);
  await f.command(undefined, { type: "protect", ticket: 123, stopLoss: 1.09, takeProfit: 1.11 });
  assert.equal(f.bridge.status().commands[0].type, "protect");
});
test("concurrent duplicate submissions persist one command and restart cancels an unsent command", async t => {
  const f = await fixture(t); await f.heartbeat(); await f.enable();
  await Promise.all([f.command(), f.command(), f.command()]);
  assert.equal(f.bridge.status().commands.length, 1);
  const restarted = await new Mt4Bridge({ root: f.root, now: () => 1800000000000 }).init();
  assert.equal(restarted.status().commands[0].status, "cancelled");
  assert.equal((await restarted.terminal(f.pairing.token, snapshot())).wire, "");
});
test("broker symbol suffixes survive the wire and missing symbols are rejected", async t => {
  const f = await fixture(t); const name = "EUR/USD:a";
  await assert.rejects(() => f.heartbeat(snapshot({ symbols: [{ ...quote, symbol: undefined }] })), /品种名称/);
  await f.heartbeat(snapshot({ symbols: [{ ...quote, symbol: name }], chart: { symbol: name, timeframe: 5, bars: [] } }));
  await f.enable(); await f.command(undefined, { symbol: name });
  const result = await f.heartbeat(snapshot({ symbols: [{ ...quote, symbol: name }], chart: { symbol: name, timeframe: 5, bars: [] } }));
  assert.equal(result.wire.split("|")[7], name);
});
test("broker tick increments and rejection recovery are explicit", async t => {
  const f = await fixture(t);
  await f.heartbeat(snapshot({ symbols: [{ ...quote, tickSize: 0.001 }] })); await f.enable();
  await assert.rejects(() => f.command(undefined, { stopLoss: 1.0996 }), /跳动单位/);
  await f.command(); await f.heartbeat();
  await f.heartbeat(snapshot({ receipts: [{ id: "11111111-1111-4111-8111-111111111111", status: "failed", ticket: 0, error: "MT4 error 130" }] }));
  const c = f.bridge.status().commands[0];
  assert.equal(c.status, "failed"); assert.match(c.error, /调整价格/); assert.equal(c.rawError, "MT4 error 130");
});
