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

const capable = (overrides = {}) => snapshot({commandPollVersion:1, executionVersion:2, ...overrides});
test("fast pulses retain chart/catalogue, prioritize hot symbols and skip idle archive work", async t => {
  const f=await fixture(t);
  const chart={symbol:quote.symbol,timeframe:5,bars:[{timestamp:1800000000000,open:1.1,high:1.2,low:1,close:1.1,volume:2}]};
  await f.heartbeat(capable({chart,symbols:Array.from({length:300},(_,i)=>({...quote,symbol:i?"S"+i:quote.symbol}))}));
  let writes=0;f.bridge.collectArchive=()=>{writes++};
  const result=await f.bridge.terminal(f.pairing.token,capable({symbols:[{...quote,symbol:"NEW",bid:2,ask:2.1}]}),{fast:true});
  assert.equal(result.fastPollMs,200);assert.equal(result.archiveWire,"");assert.equal(writes,0);
  const next=f.bridge.status().snapshot;assert.deepEqual(next.chart,chart);assert.equal(next.symbols.length,300);assert.equal(next.symbols[0].symbol,"NEW");
});
test("lost wire is redelivered under the same ID and first-send time, final receipt stops delivery", async t => {
  const f=await fixture(t);await f.heartbeat(capable());await f.enable();await f.command();
  const pulse=(extra={})=>f.bridge.terminal(f.pairing.token,capable({capturedAt:1800000000,...extra}),{fast:true});
  const first=await pulse();assert.match(first.wire,/^11111111/);const sent=f.bridge.status().commands[0].sentAt;
  f.advance(199);assert.equal((await pulse()).wire,"");f.advance(1);assert.equal((await pulse()).wire,first.wire);assert.equal(f.bridge.status().commands[0].sentAt,sent);
  const receipt={id:"11111111-1111-4111-8111-111111111111",status:"succeeded",ticket:9001,error:""};
  assert.equal((await pulse({receipts:[receipt]})).wire,"");f.advance(300);assert.equal((await pulse({receipts:[receipt]})).wire,"");assert.equal(f.bridge.status().commands[0].status,"succeeded");
});
test("fast transport requires current authenticated capable context and rejects stale snapshots",async t=>{
 const f=await fixture(t);await f.heartbeat();await assert.rejects(()=>f.bridge.terminal(f.pairing.token,capable(),{fast:true}),/重新建立/);
 await f.heartbeat(capable());await f.enable();await f.command();
 for(const value of [capable({sessionId:"other"}),capable({account:{...snapshot().account,login:"999"}}),capable({capturedAt:1799999999})]) await assert.rejects(()=>f.bridge.terminal(f.pairing.token,value,{fast:true}),/重新建立|过期/);
 await assert.rejects(()=>f.bridge.terminal("invalid",capable(),{fast:true}),/凭证/);assert.equal(f.bridge.status().commands[0].status,"queued");
});
test("expired or capability-rejected commands are never redelivered",async t=>{
 const f=await fixture(t);await f.heartbeat(capable());await f.enable();await f.command(undefined,{sizingMode:"risk-percent",riskPercent:1,stopLoss:1.09});await f.heartbeat(capable());f.advance(201);
 assert.equal((await f.heartbeat(snapshot())).wire,"");assert.equal(f.bridge.status().commands[0].status,"failed");
 const g=await fixture(t);await g.heartbeat(capable());await g.enable();await g.command();await g.heartbeat(capable());g.advance(16000);assert.equal((await g.heartbeat(capable())).wire,"");assert.equal(g.bridge.status().commands[0].status,"unknown");
});

test("fast receipt preserves the closed trade in the permanent account archive",async t=>{
 const f=await fixture(t);await f.heartbeat(capable());await f.enable();await f.command();await f.heartbeat(capable());
 const order={ticket:9001,symbol:quote.symbol,type:0,lots:.01,openPrice:1.1,stopLoss:0,takeProfit:0,profit:2,swap:0,commission:0,openTime:1799999700,closeTime:1800000000,closePrice:1.1002,magic:20261013,comment:""};
 await f.bridge.terminal(f.pairing.token,capable({history:[order],receipts:[{id:"11111111-1111-4111-8111-111111111111",status:"succeeded",ticket:9001,error:""}]}),{fast:true});
 const saved=f.bridge.archive.list({accountKey:f.bridge.status().accountKey,symbol:quote.symbol,page:0});assert.equal(saved.total,1);assert.equal(saved.orders[0].ticket,9001);assert.equal(saved.orders[0].closeTime,1800000000);
});

test("failed durable saves never expose a wire or acknowledge a final receipt",async t=>{
 const f=await fixture(t);await f.heartbeat(capable());await f.enable();await f.command();const save=f.bridge.save.bind(f.bridge);
 f.bridge.save=async()=>{throw Error("disk unavailable")};
 await assert.rejects(()=>f.heartbeat(capable()),/disk/);assert.equal(f.bridge.status().commands[0].status,"queued");
 f.bridge.save=save;assert.match((await f.heartbeat(capable())).wire,/^11111111/);
 const data=capable({receipts:[{id:"11111111-1111-4111-8111-111111111111",status:"succeeded",ticket:9001,error:""}]});
 f.bridge.save=async()=>{throw Error("disk unavailable")};await assert.rejects(()=>f.bridge.terminal(f.pairing.token,data,{fast:true}),/disk/);assert.equal(f.bridge.status().commands[0].status,"sent");
 f.bridge.save=save;assert.equal((await f.bridge.terminal(f.pairing.token,data,{fast:true})).ack,"11111111-1111-4111-8111-111111111111");assert.equal(f.bridge.status().commands[0].status,"succeeded");
});
