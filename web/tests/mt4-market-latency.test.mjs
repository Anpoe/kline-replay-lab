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


const bar=(timestamp,close=1.1,volume=2)=>({timestamp,open:1.1,high:1.3,low:1,close,volume});
const t0=1799999400000,t1=1799999700000,t2=1800000000000;
const live=(bars,fields={})=>snapshot({commandPollVersion:1,marketPollVersion:1,chart:{symbol:quote.symbol,timeframe:5,bars},...fields});
test("fast market pulses replace the current real candle, retain history and skip archive work",async t=>{
 const f=await fixture(t);await f.heartbeat(live([bar(t0),bar(t1),bar(t2)]));let archives=0;f.bridge.collectArchive=()=>{archives++};
 await f.bridge.terminal(f.pairing.token,live([bar(t1),bar(t2,1.2,9)]),{fast:true});
 assert.deepEqual(f.bridge.status().snapshot.chart.bars,[bar(t0),bar(t1),bar(t2,1.2,9)]);assert.equal(archives,0);
});
test("new candle merges the final previous OHLCV, appends once and bounds the window",async t=>{
 const f=await fixture(t);const history=Array.from({length:300},(_,i)=>bar(t2-(299-i)*300000));await f.heartbeat(live(history));
 const patch=live([bar(t2,1.22,25),bar(t2+300000,1.12,1)]);await f.bridge.terminal(f.pairing.token,patch,{fast:true});await f.bridge.terminal(f.pairing.token,patch,{fast:true});
 const saved=f.bridge.status().snapshot.chart.bars;assert.equal(saved.length,300);assert.deepEqual(saved.slice(-2),patch.chart.bars);assert.equal(saved[0].timestamp,history[1].timestamp);
});
test("selection changes, late tails and gaps never overwrite another chart or invent bars",async t=>{
 const f=await fixture(t);const original=live([bar(t0),bar(t1),bar(t2)]);await f.heartbeat(original);
 for(const patch of [live([bar(t0),bar(t1,1.2)]),live([bar(t2+600000)]),live([]),live([bar(t2,1.2)],{chart:{symbol:'OTHER',timeframe:5,bars:[bar(t2,1.2)]}}),live([],{chart:{symbol:quote.symbol,timeframe:15,bars:[bar(t2,1.2)]}})]){
 await f.bridge.terminal(f.pairing.token,patch,{fast:true});assert.deepEqual(f.bridge.status().snapshot.chart,original.chart);}
 await f.bridge.ui({action:'select',symbol:quote.symbol,timeframe:15});await f.bridge.terminal(f.pairing.token,live([bar(t2,1.2)]),{fast:true});assert.deepEqual(f.bridge.status().snapshot.chart,original.chart);
});
test("legacy fast payloads retain the full chart and oversized tails are rejected atomically",async t=>{
 const f=await fixture(t);const base=live([bar(t0),bar(t1),bar(t2)]);await f.heartbeat(base);
 await f.bridge.terminal(f.pairing.token,{...base,marketPollVersion:undefined,chart:{...base.chart,bars:[]}},{fast:true});assert.deepEqual(f.bridge.status().snapshot.chart,base.chart);
 await assert.rejects(()=>f.bridge.terminal(f.pairing.token,live([bar(t0),bar(t1),bar(t2)]),{fast:true}),/K 线/);assert.deepEqual(f.bridge.status().snapshot.chart,base.chart);
});
