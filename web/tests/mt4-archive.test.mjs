import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Mt4Archive, archiveAccountKey } from '../local-data/mt4-archive.mjs';
import { Mt4Bridge } from '../local-data/mt4-bridge.mjs';

const order = { ticket: 42, symbol: 'XAUUSD.a', type: 0, lots: 0.1, openPrice: 2000, stopLoss: 1990, takeProfit: 2030, profit: 0, swap: 0, commission: -1, openTime: 1800000000, closeTime: 0, closePrice: 0, magic: 7 };
function snapshot(login = '123', orders = [order]) {
  return { account: { login, server: 'Broker', mode: 'demo', currency: 'USD' }, capturedAt: 1800000001, sessionId: 'test',
    symbols: [{ symbol: order.symbol, digits: 2 }], chart: { symbol: order.symbol, timeframe: 5, bars: [{ timestamp: 1800000000000, open: 2000, high: 2001, low: 1999, close: 2000, volume: 2 }] }, orders, history: [] };
}
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mt4-archive-'));
  const archive = new Mt4Archive({ directory: dir });
  t.after(async () => { archive.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, archive };
}

test('saved plan lookup spans chart periods and trade scopes while preserving account and symbol boundaries', async t => {
  const { archive }=await fixture(t),a=snapshot(),key=archiveAccountKey(a.account);archive.ingest(a);archive.ingest(snapshot('456'));
  const plan=id=>({id,recordedAt:1000,candleTimestamp:1800000000000,referencePrice:2000,draft:{stopLoss:'1990',takeProfit:'2030'},drawings:[{id:'saved-drawing'}]});
  const data=id=>({version:1,draft:{},drawings:[],decisions:[plan(id)]});
  archive.saveAnalysis({accountKey:key,symbol:order.symbol,timeframe:5,scope:'trade:42',revision:0,data:data('historical')});
  archive.saveAnalysis({accountKey:key,symbol:order.symbol,timeframe:15,revision:0,data:data('live')});
  archive.saveAnalysis({accountKey:archiveAccountKey(snapshot('456').account),symbol:order.symbol,timeframe:5,revision:0,data:data('other-account')});
  archive.saveAnalysis({accountKey:key,symbol:'EURUSD.a',timeframe:5,revision:0,data:data('other-symbol')});
  const first=archive.decisionPlans({accountKey:key,symbol:order.symbol,limit:1});
  const second=archive.decisionPlans({accountKey:key,symbol:order.symbol,offset:first.nextOffset,limit:1});
  assert.deepEqual([...first.plans,...second.plans].map(p=>p.decision.id),['historical','live']);
  assert.equal(first.plans[0].scope,'trade:42');assert.equal(first.plans[0].timeframe,5);
  assert.deepEqual(first.plans[0].decision.drawings,[]);
  assert.equal(second.nextOffset,null);
  assert.equal(archive.analysis(key,order.symbol,5,'trade:42').data.decisions[0].drawings.length,1);
  assert.throws(()=>archive.decisionPlans({accountKey:key,symbol:order.symbol,offset:-1}),/分页/);
});
test('account/server/type and raw symbol isolate identical tickets; reimport is idempotent', async t => {
  const { archive } = await fixture(t), a = snapshot(), b = snapshot('456');
  archive.ingest(a); archive.ingest(a); archive.ingest(b);
  archive.ingest(snapshot('123', [{ ...order, symbol: 'EURUSD.a' }]));
  const key = archiveAccountKey(a.account);
  assert.equal(archive.list({ accountKey: key }).total, 2);
  assert.equal(archive.list({ accountKey: key, symbol: order.symbol }).total, 1);
  assert.equal(archive.trade(key, order.symbol, 42, 5).events.length, 1);
  assert.equal(archive.list({ accountKey: archiveAccountKey(b.account) }).total, 1);
  assert.notEqual(key, archiveAccountKey({ ...a.account, server: 'Other' }));
  assert.notEqual(key, archiveAccountKey({ ...a.account, mode: 'real' }));
});
test('preserves observed modifications and evidence; missing snapshot orders never infer a close', async t => {
  const { archive } = await fixture(t), a = snapshot(), key = archiveAccountKey(a.account);
  archive.ingest(a);
  archive.ingest({ ...a, orders: [{ ...order, profit: 10 }] });
  archive.ingest({ ...a, orders: [{ ...order, stopLoss: 2001 }] });
  archive.ingest({ ...a, orders: [], history: [] });
  let detail = archive.trade(key, order.symbol, 42, 5);
  assert.equal(detail.events.length, 2); assert.equal(detail.order.closeTime, 0);
  assert.equal(detail.events[0].order.stopLoss, 1990); assert.equal(detail.events[0].evidence.chart.bars.length, 1);
  archive.ingest({ ...a, orders: [], history: [{ ...order, stopLoss: 2001, closeTime: 1800000900, closePrice: 2010, profit: 100 }] });
  archive.ingest(a); // A stale open observation must not reopen a closed ticket.
  detail = archive.trade(key, order.symbol, 42, 5);
  assert.equal(detail.order.closeTime, 1800000900); assert.equal(detail.events.length, 3);
});
test('analysis uses revision checks, keeps immutable versions and never mixes symbol or timeframe', async t => {
  const { archive } = await fixture(t), a = snapshot(), key = archiveAccountKey(a.account); archive.ingest(a);
  const data = { version: 1, draft: { note: 'before' }, drawings: [], decisions: [] };
  assert.equal(archive.saveAnalysis({ accountKey: key, symbol: order.symbol, timeframe: 5, revision: 0, data }).revision, 1);
  assert.throws(() => archive.saveAnalysis({ accountKey: key, symbol: order.symbol, timeframe: 5, revision: 0, data }), /其他页面/);
  assert.equal(archive.analysis(key, order.symbol, 15).revision, 0);
  archive.ingest({ ...a, orders: [{ ...order, stopLoss: 2002 }] });
  archive.saveAnalysis({ accountKey: key, symbol: order.symbol, timeframe: 5, revision: 1, data: { ...data, draft: { note: 'after' } } });
  assert.equal(archive.trade(key, order.symbol, 42, 5).events.at(-1).evidence.analysis.data.draft.note, 'before');
});
test('durable restart and validated backup roundtrip preserve provenance without credentials', async t => {
  const { archive, dir } = await fixture(t), a = snapshot(), key = archiveAccountKey(a.account); archive.ingest(a);
  archive.close(); archive.open(); assert.equal(archive.list({ accountKey: key }).total, 1);
  const backup = archive.backup(); assert.equal(JSON.stringify(backup).includes('token'), false);
  const other = new Mt4Archive({ directory: path.join(dir, 'restore') });
  try {
    other.restore(backup); other.restore(backup);
    assert.equal(other.trade(key, order.symbol, 42, 5).events.length, 1);
    assert.throws(() => other.restore({ ...backup, version: 999 }), /备份/);
    const altered = structuredClone(backup); altered.tables.accounts[0].account_key = 'wrong';
    assert.throws(() => other.restore(altered), /备份/);
  } finally { other.close(); }
});

async function bridgeFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mt4-archive-bridge-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const bridge = await new Mt4Bridge({ root, now: () => 1800000001000 }).init(), pairing = await bridge.ui({ action: 'pair' });
  const raw = snapshot();
  const quote = { symbol: order.symbol, digits: 2, point: 0.01, bid: 2000, ask: 2001, quoteTime: 1800000001, minLot: 0.01, maxLot: 100, lotStep: 0.01, contractSize: 100, tickValue: 1, tickSize: 0.01, stopLevel: 0, freezeLevel: 0, tradeAllowed: true };
  const payload = { ...raw, protocolVersion: 1, archiveVersion: 1, historyTotal: 0, account: { ...raw.account, balance: 1000, equity: 1000, margin: 0, freeMargin: 1000, profit: 0, connected: true, tradeAllowed: true, allowReal: false }, symbols: [quote], orderCount: 1, receipts: [] };
  const heartbeat = extra => bridge.terminal(pairing.token, { ...payload, ...extra });
  return { bridge, root, payload, heartbeat, key: archiveAccountKey(payload.account) };
}
test('all observed candles survive restart and cursor paging beyond 5000, isolated by account/symbol/period', async t => {
  const { archive, dir } = await fixture(t), a = snapshot(), key = archiveAccountKey(a.account);
  archive.ingest(a); archive.ingest(snapshot('456'));
  const bars = Array.from({ length: 6505 }, (_, i) => ({ ...a.chart.bars[0], timestamp: a.chart.bars[0].timestamp - (6504 - i) * 300000 }));
  archive.saveBars(key, order.symbol, 5, bars);
  archive.saveBars(key, order.symbol, 15, [bars[0]]);
  archive.saveBars(key, 'EURUSD.a', 5, [bars[1]]);
  const restarted = new Mt4Archive({ directory: dir });
  const query = { accountKey: key, symbol: order.symbol, timeframe: 5 };
  let page = restarted.bars(query), read = [...page.bars];
  while (page.hasBefore) { page = restarted.bars({ ...query, before: read[0].timestamp }); read = [...page.bars, ...read]; }
  assert.deepEqual(read, bars); assert.equal(new Set(read.map(bar => bar.timestamp)).size, 6505);
  const focused = restarted.bars({ ...query, focus: bars[2000].timestamp, limit: 200 });
  assert.equal(focused.hasBefore, true); assert.equal(focused.hasAfter, true); assert.ok(focused.bars.some(b => b.timestamp === bars[2000].timestamp));
  const after = restarted.bars({ ...query, after: focused.bars.at(-1).timestamp, limit: 200 });
  assert.equal(after.bars[0].timestamp, focused.bars.at(-1).timestamp + 300000);
  assert.equal(restarted.bars({ ...query, timeframe: 15 }).bars.length, 1);
  assert.equal(restarted.bars({ ...query, symbol: 'EURUSD.a' }).bars.length, 1);
  assert.ok(restarted.accounts().find(account => account.accountKey === key).symbols.includes('EURUSD.a'), 'Observed instruments remain discoverable without any trade');
  assert.equal(restarted.bars({ ...query, accountKey: archiveAccountKey(snapshot('456').account) }).bars.length, 1);
  assert.throws(() => restarted.bars({ ...query, before: -1 }), /位置/);
  assert.throws(() => restarted.bars({ ...query, limit: 500000 }), /数量/);
  assert.throws(() => restarted.bars({ ...query, before: 1, after: 2 }), /位置/);
});
test('fast displayed tail and final close are durable without rebuilding archive order evidence', async t => {
  const f = await bridgeFixture(t);
  const full = { ...f.payload, commandPollVersion: 1, marketPollVersion: 1 };
  await f.heartbeat(full);
  const original = f.payload.chart.bars[0];
  const closed = { ...original, close: 2001, volume: 100 };
  const next = { ...original, timestamp: original.timestamp + 300000, close: 2000.5 };
  let ingests = 0; const ingest = f.bridge.archive.ingest.bind(f.bridge.archive);
  f.bridge.archive.ingest = (...args) => { ingests++; return ingest(...args); };
  await f.bridge.terminal(f.bridge.state.token, { ...full, chart: { ...full.chart, bars: [closed, next] } }, { fast: true });
  assert.equal(ingests, 0);
  const restarted = new Mt4Archive({ directory: path.join(f.root, 'mt4') });
  const result = restarted.bars({ accountKey: f.key, symbol: order.symbol, timeframe: 5 });
  assert.deepEqual(result.bars, [closed, next]);
  assert.equal(restarted.trade(f.key, order.symbol, order.ticket, 5).events.length, 1);
});
test('bridge paginates more than 50 historical orders, persists cursors, then collects historical candles', async t => {
  const f = await bridgeFixture(t), history = Array.from({ length: 125 }, (_, i) => ({ ...order, ticket: 100 + i, openTime: 1790000000 + i * 100, closeTime: 1790000060 + i * 100, closePrice: 2010 }));
  const extra = { orders: [], orderCount: 0, history: history.slice(-50), historyTotal: 125 };
  let reply = await f.heartbeat(extra);
  for (let offset = 0; offset < 125; offset += 50) {
    const wire = reply.archiveWire.split('|'); assert.equal(wire[1], 'h'); assert.equal(Number(wire[6]), offset);
    reply = await f.heartbeat({ ...extra, archiveResponse: { id: wire[0], kind: 'h', ok: true, offset, next: Math.min(125, offset + 50), total: 125, orders: history.slice(offset, offset + 50) } });
  }
  assert.equal(f.bridge.archive.list({ accountKey: f.key }).total, 125);
  assert.equal(f.bridge.status().archive.scan.complete, true);
  assert.equal(f.bridge.archive.accounts()[0].scan.offset, 125);
  const wire = reply.archiveWire.split('|'); assert.equal(wire[1], 'b');
  const anchor = Number(wire[8]);
  const bar = { ...f.payload.chart.bars[0], timestamp: anchor * 1000 };
  await f.heartbeat({ ...extra, archiveResponse: { id: wire[0], kind: 'b', ok: true, bars: [bar] } });
  const restarted = new Mt4Archive({ directory: path.join(f.root, 'mt4') });
  assert.equal(restarted.trade(f.key, order.symbol, history[0].ticket, 5).bars.some(b => b.timestamp === bar.timestamp), true);
  assert.equal(restarted.trade(f.key, order.symbol, history[0].ticket, 5).events.length, 1);
});
test('history range shrink and account switching never delete or reassign archived evidence', async t => {
  const f = await bridgeFixture(t);
  let reply = await f.heartbeat({ historyTotal: 1 });
  const oldJob = reply.archiveWire.split('|');
  await f.heartbeat({ historyTotal: 0, account: { ...f.payload.account, login: '999' }, orders: [{ ...order, openPrice: 100 }] });
  reply = await f.heartbeat({ historyTotal: 0, account: { ...f.payload.account, login: '999' }, archiveResponse: { id: oldJob[0], kind: 'h', ok: true, offset: 0, next: 1, total: 1, orders: [{ ...order, closeTime: 123 }] } });
  assert.equal(reply.wire, '');
  assert.equal(f.bridge.archive.trade(f.key, order.symbol, order.ticket, 5).order.openPrice, 2000);
  const other = archiveAccountKey({ ...f.payload.account, login: '999' });
  assert.equal(f.bridge.archive.trade(other, order.symbol, order.ticket, 5).order.closeTime, 0);
});
test('malformed or failed history page cannot advance cursor; explicit rescan recovers', async t => {
  const f = await bridgeFixture(t), reply = await f.heartbeat({ historyTotal: 1 }), wire = reply.archiveWire.split('|');
  await f.heartbeat({ historyTotal: 1, archiveResponse: { id: wire[0], kind: 'h', ok: false, offset: 0, next: 1, total: 1, orders: [] } });
  assert.equal(f.bridge.status().archive.scan.offset, 0); assert.match(f.bridge.status().archive.error, /历史读取未完成/);
  await f.bridge.run(() => f.bridge.archiveRequest({ action: 'rescan', accountKey: f.key }));
  const recovered = await f.heartbeat({ historyTotal: 1 });
  assert.equal(f.bridge.status().archive.error, ''); assert.notEqual(recovered.archiveWire.split('|')[0], wire[0]);
});
test('analysis migration is non-destructive and invalid scopes cannot write another trade', async t => {
  const { archive } = await fixture(t), raw = snapshot(), key = archiveAccountKey(raw.account); archive.ingest(raw);
  const data = { version: 1, draft: { note: 'current' }, drawings: [], decisions: [] };
  archive.saveAnalysis({ accountKey: key, symbol: order.symbol, timeframe: 5, revision: 0, data });
  const migrated = archive.saveAnalysis({ accountKey: key, symbol: order.symbol, timeframe: 5, revision: 0, data: { ...data, draft: { note: 'stale browser' } }, migrate: true });
  assert.equal(migrated.data.draft.note, 'current');
  assert.throws(() => archive.saveAnalysis({ accountKey: key, symbol: 'OTHER', timeframe: 5, scope: 'trade:42', revision: 0, data }), /交易不存在/);
  assert.throws(() => archive.saveAnalysis({ accountKey: key, symbol: order.symbol, timeframe: 5, scope: 'other', revision: 0, data }), /范围无效/);
});
test('restore conflict rolls back earlier rows, preserving existing records', async t => {
  const { archive, dir } = await fixture(t); archive.ingest(snapshot());
  const source = new Mt4Archive({ directory: path.join(dir, 'source') });
  source.ingest(snapshot('456')); source.ingest(snapshot('123', [{ ...order, stopLoss: 1980 }]));
  assert.throws(() => archive.restore(source.backup()), /不同版本/);
  assert.equal(archive.accounts().length, 1);
  assert.equal(archive.trade(archiveAccountKey(snapshot().account), order.symbol, 42, 5).order.stopLoss, 1990);
});

test('calendar filters share one scope across pages, chart markers and archived candles', async t => {
  const { archive } = await fixture(t), a = snapshot(), key = archiveAccountKey(a.account);
  const day = Date.parse('2026-10-10T00:00:00Z') / 1000;
  const history = Array.from({ length: 125 }, (_, i) => ({ ...order, ticket: 1000+i, openTime: day+i*60, closeTime: day+i*60+30, closePrice: 2001 }));
  history.push({ ...order, ticket: 999, closeTime: day-1, openTime: day-60, closePrice: 2001 });
  history.push({ ...order, ticket: 998, closeTime: day+86400, openTime: day+86300, closePrice: 2001 });
  archive.ingest({ ...a, orders: [], history });
  archive.ingest({ ...snapshot('other'), orders:[], history: [{...history[0], openPrice: 9999}] });
  const query = { accountKey:key, from:'2026-10-10', to:'2026-10-10', chartSymbol:order.symbol };
  const first=archive.list(query), third=archive.list({...query,page:2});
  assert.equal(first.total,125); assert.equal(first.orders.length,50); assert.equal(first.chartOrders.length,125);
  assert.equal(third.orders.length,25); assert.equal(third.chartOrders[100].position,100);
  assert.equal(first.chartOrders.some(o=>o.openPrice===9999),false);
  assert.equal(archive.list({...query,symbol:'EURUSD'}).chartOrders.length,0);
  assert.equal(archive.list({...query,page:500}).page,2);
  assert.throws(()=>archive.list({...query,from:'2026-10-11'}),/开始日期/);
  const bar = {...a.chart.bars[0],timestamp:day*1000};
  archive.saveBars(key,order.symbol,5,[bar]);
  assert.deepEqual(archive.chart({...query,symbol:order.symbol,timeframe:5}).bars,[bar]);
  assert.equal(archive.chart({...query,symbol:'EURUSD',timeframe:5}).bars.length,0);
  assert.equal(archive.chart({...query,symbol:order.symbol,timeframe:15}).bars.length,0);
});
test('one candle window completes covered anchors only, retaining gaps and account boundaries', async t => {
  const { archive } = await fixture(t), a=snapshot(),key=archiveAccountKey(a.account),base=1790000000;
  const orders=[0,30,120,600].map((offset,i)=>({...order,ticket:100+i,openTime:base+offset}));
  archive.ingest({...a,orders});
  const other=snapshot('other',orders); archive.ingest(other);
  const bar={...a.chart.bars[0],timestamp:base*1000};
  archive.saveBars(key,order.symbol,5,[bar]);
  assert.equal(archive.nextMarketRequest(key).anchor,base+600);
  assert.equal(archive.nextMarketRequest(archiveAccountKey(other.account)).anchor,base);
  archive.saveBars(key,order.symbol,15,[{...bar,timestamp:(base+600)*1000}]);
  assert.equal(archive.nextMarketRequest(key).anchor,base+600);
  archive.saveBars(key,order.symbol,5,[{...bar,timestamp:(base+900)*1000}]);
  assert.equal(archive.nextMarketRequest(key).anchor,base+600);
});
test('a successful terminal reply outside requested time remains missing rather than claiming synchronization', async t => {
  const f=await bridgeFixture(t);
  // The requested historical window must not be replaced by unrelated current bars.

  const old={...order,ticket:900,openTime:1790000000,closeTime:1790000300,closePrice:2001};
  const reply=await f.heartbeat({orders:[],orderCount:0,history:[old],historyTotal:0});
  const wire=reply.archiveWire.split('|'); assert.equal(wire[1],'b');
  await f.heartbeat({orders:[],orderCount:0,history:[old],historyTotal:0,archiveResponse:{id:wire[0],kind:'b',ok:true,bars:[{...f.payload.chart.bars[0],timestamp:1700000000000}]}});
  assert.ok(f.bridge.archive.accounts()[0].market.missing>0);
});
