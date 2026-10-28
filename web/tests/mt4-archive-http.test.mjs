import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import ts from 'typescript';
import { archiveAccountKey } from '../local-data/mt4-archive.mjs';
import { Mt4Bridge } from '../local-data/mt4-bridge.mjs';
import { handleMt4Request } from '../local-data/mt4-http.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mt4-archive-http-'));
  const bridge = await new Mt4Bridge({ root }).init();
  const server = http.createServer((req, res) => void handleMt4Request(bridge, req, res));
  // Node fetch rejects these ports even if Windows allocates one for listen(0).
  const blocked = new Set([1719,1720,1723,2049,3659,4045,5060,5061,6000,6566,6665,6666,6667,6668,6669,6697,10080]);
  for (let attempt=0; ; attempt++) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    if (server.address().port > 1023 && !blocked.has(server.address().port)) break;
    await new Promise(resolve => server.close(resolve));
    if (attempt >= 10) throw Error('No fetch-compatible loopback test port available');
  }
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  return { bridge, origin: `http://127.0.0.1:${server.address().port}`, headers: { 'x-kline-mt4-session': bridge.uiSession } };
}
test('archive first use is empty, protected by browser session and denies cross-site requests', async t => {
  const f = await fixture(t), url = `${f.origin}/mt4/archive?action=accounts`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { ...f.headers, origin: 'https://evil.test' } })).status, 403);
  assert.deepEqual(await (await fetch(url, { headers: f.headers })).json(), { accounts: [] });
  assert.equal((await fetch(`${f.origin}/mt4/archive?action=unsupported`, { headers: f.headers })).status, 400);
  for (const body of ['null', '[]', '{}', 'broken']) assert.equal((await fetch(`${f.origin}/mt4/archive`, { method: 'POST', headers: f.headers, body })).status, 400);
});
test('archive HTTP backup/restore works offline without terminal pairing or credentials', async t => {
  const f = await fixture(t), url = `${f.origin}/mt4/archive`;
  const backup = await (await fetch(`${url}?action=backup`, { headers: f.headers })).json();
  assert.equal(backup.format, 'kline-mt4-archive'); assert.equal(JSON.stringify(backup).includes('token'), false);
  const restored = await fetch(url, { method: 'POST', headers: f.headers, body: JSON.stringify({ action: 'restore', backup }) });
  assert.equal(restored.status, 200); assert.equal((await restored.json()).restored, true);
  assert.equal(f.bridge.status().paired, false); assert.equal(f.bridge.status().enabled, false);
  assert.equal((await fetch(url, { method: 'POST', headers: f.headers, body: JSON.stringify({ action: 'rescan', accountKey: 'a'.repeat(64) }) })).status, 409);
});
const source = ts.transpileModule(readFileSync(new URL('../app/api/mt4/archive/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function routeFixture() {
  const route = {}, calls = [];
  new Function('require', 'exports', source)(() => ({ fetchLocalData: async (...args) => { calls.push(args); return Response.json({ accounts: [] }); } }), route);
  return { route, calls };
}
test('Web archive route checks origin, local host, session and body size before proxying', async () => {
  const { route, calls } = routeFixture(), token = 'a'.repeat(48), headers = { 'x-kline-mt4-session': token };
  for (const req of [new Request('http://example.com/api/mt4/archive'), new Request('http://127.0.0.1:3101/api/mt4/archive', { headers: { ...headers, origin: 'https://evil.test' } }), new Request('http://127.0.0.1:3101/api/mt4/archive', { method: 'POST', body: '{}' })]) assert.equal((await route.GET(req)).status, 403);
  assert.equal((await route.GET(new Request('http://127.0.0.1:3101/api/mt4/archive'))).status, 401);
  assert.equal(calls.length, 0);
  const result = await route.GET(new Request('http://127.0.0.1:3101/api/mt4/archive?action=accounts', { headers }));
  assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store'); assert.equal(calls[0][0], '/mt4/archive?action=accounts');
  const large = await route.POST(new Request('http://127.0.0.1:3101/api/mt4/archive', { method: 'POST', headers: { ...headers, 'x-kline-mt4': '1', 'content-length': String(129 * 1024 * 1024) }, body: '{}' }));
  assert.equal(large.status, 413); assert.equal(calls.length, 1);
});

test('offline archive HTTP date filters and chart reads preserve account, symbol and calendar boundaries', async t => {
  const f=await fixture(t), account={login:'123',server:'Broker',mode:'demo',currency:'USD'},key=archiveAccountKey(account);
  const day=Date.parse('2026-10-10T00:00:00Z')/1000;
  const order={ticket:42,symbol:'XAUUSD',type:0,lots:.1,openPrice:2000,stopLoss:0,takeProfit:0,profit:2,swap:0,commission:0,openTime:day,closeTime:day+3600,closePrice:2002,magic:0};
  const bar={timestamp:day*1000,open:2000,high:2002,low:1999,close:2001,volume:1};
  f.bridge.archive.ingest({account,symbols:[{symbol:'XAUUSD',digits:2}],chart:{symbol:'XAUUSD',timeframe:5,bars:[bar]},orders:[],history:[order],capturedAt:day+3600});
  const url=`${f.origin}/mt4/archive?accountKey=${key}&symbol=XAUUSD&from=2026-10-10&to=2026-10-10`;
  const list=await(await fetch(url+'&chartSymbol=XAUUSD',{headers:f.headers})).json();
  assert.equal(list.total,1);assert.equal(list.chartOrders[0].ticket,42);
  const chart=await(await fetch(url+'&action=chart&timeframe=5',{headers:f.headers})).json();
  assert.deepEqual(chart.bars,[bar]);assert.equal(chart.accountKey,key);
  const candlesUrl = `${f.origin}/mt4/archive?action=bars&accountKey=${key}&symbol=XAUUSD&timeframe=5`;
  const candles = await (await fetch(candlesUrl + `&focus=${bar.timestamp}&before=0&after=0`, { headers: f.headers })).json();
  assert.deepEqual(candles.bars, [bar]); assert.equal(candles.hasBefore, false); assert.equal(candles.hasAfter, false);
  assert.equal((await fetch(candlesUrl)).status, 401);
  assert.equal((await fetch(candlesUrl + '&before=1.5', { headers: f.headers })).status, 400);
  assert.equal((await fetch(candlesUrl + '&limit=5000', { headers: f.headers })).status, 400);
  assert.equal((await fetch(url.replace('from=2026-10-10','from=2026-10-11'),{headers:f.headers})).status,400);
  assert.equal((await fetch(url+'&action=chart&timeframe=5')).status,401);
  assert.equal(f.bridge.status().paired,false);assert.equal(f.bridge.status().enabled,false);
  const data={version:1,draft:{},drawings:[],decisions:[{id:'saved',recordedAt:1000,candleTimestamp:bar.timestamp,referencePrice:2000,draft:{stopLoss:'1990'},drawings:[]}]};
  f.bridge.archive.saveAnalysis({accountKey:key,symbol:'XAUUSD',timeframe:5,scope:'trade:42',revision:0,data});
  const plansUrl=`${f.origin}/mt4/archive?action=plans&accountKey=${key}&symbol=XAUUSD`;
  assert.equal((await fetch(plansUrl)).status,401);
  assert.equal((await fetch(plansUrl,{headers:{...f.headers,origin:'https://evil.test'}})).status,403);
  const plans=await(await fetch(plansUrl,{headers:f.headers})).json();
  assert.equal(plans.plans[0].decision.id,'saved');assert.equal(plans.plans[0].scope,'trade:42');assert.equal(plans.nextOffset,null);
  assert.equal((await fetch(plansUrl+'&offset=-1',{headers:f.headers})).status,400);
});
