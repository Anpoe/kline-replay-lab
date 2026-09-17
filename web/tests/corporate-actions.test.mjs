import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CorporateActionsStore, normalizeCorporateActions } from '../local-data/corporate-actions-store.mjs';
import {
  buildTdxSecurityQuotesRequest,
  parseTdxCorporateActionsResponse,
  parseTdxSecurityQuotesResponse,
  TdxCorporateActionsClient,
} from '../local-data/tdx-corporate-actions-client.mjs';
import {
  cashDividendCreditsForBar,
  cashDividendIncomeFromEvents,
} from '../app/lib/corporateActions.ts';
import { TdxLocalStore } from '../local-data/legacy-tdx-store.mjs';

const raw = { year: 2026, month: 3, day: 11, category: 1, fenhong: 2, songzhuangu: 3, peigu: 1, peigujia: 5 };
const stocks = [{ id: '600000.SH', assetType: 'stock' }, { id: '000001.SZ', assetType: 'stock' }, { id: '920001.BJ', assetType: 'stock' }, { id: '000001.SH', assetType: 'index' }];
async function settled(store) {
  for (let i = 0; i < 200; i++) {
    const status = store.getStatus();
    if (!['queued', 'running'].includes(status.task?.status) && !store.maintenanceRunning) return status;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('task did not settle');
}
async function fixture(t, fetchEvents) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-actions-'));
  const store = await new CorporateActionsStore({ root, client: { fetchEvents, close() {} } }).init();
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  return { root, store };
}

test('normalizes ex-date and per-ten-share terms; never mistakes capital changes for dividends', () => {
  const events = normalizeCorporateActions('600000.SH', [raw, raw, { ...raw, category: 2 }, { ...raw, category: 11, suogu: 2 }]);
  assert.equal(events.length, 2);
  const dividend = events.find(event => event.category === 1);
  assert.equal(dividend.date, '2026-03-11');
  assert.equal(dividend.cashPer10, 2);
  assert.equal(dividend.bonusSharesPer10, 3);
  assert.equal(dividend.rightsSharesPer10, 1);
  assert.equal(dividend.rightsPrice, 5);
  assert.match(dividend.description, /每10股/);
  assert.throws(() => normalizeCorporateActions('600000.SH', null));
  assert.throws(() => normalizeCorporateActions('600000.SH', [{ ...raw, month: 2, day: 31 }]));
});

test('credits cash dividends only for long lots held before the ex-date', () => {
  const event = {
    id: '600000.SH:2026-03-11:1',
    instrumentId: '600000.SH',
    date: '2026-03-11',
    timestamp: Date.parse('2026-03-11T00:00:00Z'),
    category: 1,
    label: 'D',
    description: '每10股派2元（税前）',
    cashPer10: 2,
    bonusSharesPer10: 0,
    rightsSharesPer10: 0,
    rightsPrice: 0,
  };
  const credits = cashDividendCreditsForBar(
    [event],
    [
      { id: 'held-before', side: 'long', qty: 100, status: 'open', entryTimestamp: Date.parse('2026-03-10T00:00:00Z') },
      { id: 'bought-on-date', side: 'long', qty: 200, status: 'open', entryTimestamp: event.timestamp },
      { id: 'short-lot', side: 'short', qty: 300, status: 'open', entryTimestamp: Date.parse('2026-03-10T00:00:00Z') },
      { id: 'closed-before', side: 'long', qty: 400, status: 'closed', entryTimestamp: Date.parse('2026-03-10T00:00:00Z') },
    ],
    event.timestamp,
  );

  assert.deepEqual(credits, [{
    eventId: event.id,
    instrumentId: event.instrumentId,
    date: event.date,
    cashPer10: 2,
    quantity: 100,
    amount: 20,
  }]);
  assert.deepEqual(cashDividendCreditsForBar([event], [
    { id: 'held-before', side: 'long', qty: 100, status: 'open', entryTimestamp: Date.parse('2026-03-10T00:00:00Z') },
  ], event.timestamp, new Set([event.id])), []);
});

test('cash dividend income totals only durable dividend credit events', () => {
  assert.equal(cashDividendIncomeFromEvents([
    { type: 'cash_dividend_income_credited', payload: { amount: 20 } },
    { type: 'orders_filled', payload: { amount: 999 } },
    { type: 'cash_dividend_income_credited', payload: { amount: 1.25 } },
    { type: 'cash_dividend_income_credited', payload: { amount: 'not-a-number' } },
  ]), 21.25);
});

test('parses TDX corporate-action response without a Python dependency', () => {
  const body = Buffer.alloc(11 + 29);
  body.writeUInt16LE(1, 9);
  let offset = 11;
  body[offset] = 0;
  Buffer.from('000001').copy(body, offset + 1);
  offset += 8;
  body.writeUInt32LE(20260311, offset);
  offset += 4;
  body[offset++] = 1;
  body.writeFloatLE(0.1, offset);
  body.writeFloatLE(5, offset + 4);
  body.writeFloatLE(2, offset + 8);
  body.writeFloatLE(3, offset + 12);

  const rows = parseTdxCorporateActionsResponse(body, '000001.SZ');
  assert.deepEqual(rows, [{
    year: 2026,
    month: 3,
    day: 11,
    category: 1,
    name: '除权除息',
    fenhong: rows[0].fenhong,
    peigujia: 5,
    songzhuangu: 2,
    peigu: 3,
    suogu: null,
    panqianliutong: null,
    panhouliutong: null,
    qianzongguben: null,
    houzongguben: null,
    fenshu: null,
    xingquanjia: null,
  }]);
});

function encodeTdxPrice(value) {
  const sign = value < 0 ? 0x40 : 0;
  let remaining = Math.abs(Math.trunc(value));
  const bytes = [sign | (remaining & 0x3f)];
  remaining >>>= 6;
  let index = 0;
  while (remaining > 0) {
    bytes[index] |= 0x80;
    bytes.push(remaining & 0x7f);
    remaining >>>= 7;
    index += 1;
  }
  return Buffer.from(bytes);
}

function buildSecurityQuotesBody() {
  const chunks = [Buffer.from([0, 0, 1, 0])];
  chunks.push(Buffer.from([0, ...Buffer.from('000001'), 1, 0]));
  const beforeAmount = [
    12345, -100, -50, 100, -200,
    0, 0, 100000, 1000,
  ];
  for (const value of beforeAmount) chunks.push(encodeTdxPrice(value));
  const amount = Buffer.alloc(4);
  amount.writeUInt32LE(0, 0);
  chunks.push(amount);
  for (const value of [0, 0, 0, 0, ...Array.from({ length: 20 }, () => 0)]) {
    chunks.push(encodeTdxPrice(value));
  }
  const tail = Buffer.alloc(10);
  tail.writeUInt16LE(1, 8);
  chunks.push(tail);
  return Buffer.concat(chunks);
}

test('builds and parses batched real-time TDX security quotes', () => {
  const request = buildTdxSecurityQuotesRequest(['000001.SZ', '600000.SH']);
  assert.equal(request.readUInt16LE(0), 0x10c);
  assert.equal(request.readUInt32LE(2), 0x02006320);
  assert.equal(request.readUInt16LE(6), 26);
  assert.equal(request.readUInt16LE(20), 2);
  assert.equal(request.subarray(22, 29).toString('ascii'), '\u0000000001');
  assert.equal(request[29], 1);
  assert.equal(request.subarray(30, 36).toString('ascii'), '600000');

  const [quote] = parseTdxSecurityQuotesResponse(buildSecurityQuotesBody());
  assert.equal(quote.instrumentId, '000001.SZ');
  assert.equal(quote.price, 123.45);
  assert.equal(quote.lastClose, 122.45);
  assert.equal(quote.open, 122.95);
  assert.equal(quote.high, 124.45);
  assert.equal(quote.low, 121.45);
  assert.equal(quote.volume, 100000);
  assert.equal(quote.active, true);
});

test('retries a quote request when a connected TDX node returns no rows', async () => {
  const client = new TdxCorporateActionsClient({
    hosts: [['empty-node', 7709], ['live-node', 7709]],
  });
  let attempts = 0;
  client.connect = async () => { attempts += 1; };
  client.reset = () => {};
  client.requestResponse = async () => attempts === 1
    ? Buffer.from([0x01, 0x02, 0x00, 0x00])
    : buildSecurityQuotesBody();
  const rows = await client.fetchDailyQuotes(['000001.SZ']);
  client.close();
  assert.equal(attempts, 2);
  assert.equal(rows[0].instrumentId, '000001.SZ');
  assert.equal(rows[0].price, 123.45);
});

test('empty successful history still enables daily upkeep, supported stocks only, corrections replace atomically', async t => {
  let records = [];
  const calls = [];
  const { store } = await fixture(t, async id => { calls.push(id); return records; });
  assert.equal(store.getStatus().enabled, false);
  await store.start(stocks);
  let status = await settled(store);
  assert.equal(status.enabled, true);
  assert.equal(status.task.status, 'completed');
  assert.equal(status.eventCount, 0);
  assert.equal(status.task.skipped, 2);
  assert.deepEqual(calls, ['600000.SH', '000001.SZ']);
  records = [raw, raw];
  await store.start(stocks);
  await settled(store);
  assert.equal(store.getEvents('600000.SH').length, 1);
  records = [{ ...raw, fenhong: 5 }];
  await store.start(stocks);
  await settled(store);
  assert.equal(store.getEvents('600000.SH')[0].cashPer10, 5);
  records = [];
  await store.start(stocks);
  status = await settled(store);
  assert.equal(status.eventCount, 0);
});

test('failed symbol preserves cached events, retry processes only failed symbols; restart preserves enabled state', async t => {
  let fail = false;
  const calls = [];
  const { store, root } = await fixture(t, async id => {
    calls.push(id);
    if (fail && id === '600000.SH') throw new Error('network unavailable');
    return [raw];
  });
  await store.start(stocks);
  await settled(store);
  fail = true;
  await store.start(stocks);
  const status = await settled(store);
  assert.equal(status.task.status, 'failed');
  assert.equal(status.task.failed.length, 1);
  assert.equal(store.getEvents('600000.SH').length, 1);
  fail = false;
  calls.length = 0;
  await store.resume();
  await settled(store);
  assert.deepEqual(calls, ['600000.SH']);
  store.close();
  const reopened = await new CorporateActionsStore({ root, client: { close() {} } }).init();
  assert.equal(reopened.getStatus().enabled, true);
  assert.equal(reopened.getStatus().eventCount, 2);
  reopened.close();
});

test('pause does not publish in-flight response, then resumes without losing pending work', async t => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const { store } = await fixture(t, async () => { entered(); return await new Promise(resolve => { release = resolve; }); });
  await store.start(stocks.slice(0, 1));
  await started;
  await store.pause();
  release([raw]);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(store.getEvents('600000.SH').length, 0);
  store.client.fetchEvents = async () => [raw];
  await store.resume();
  await settled(store);
  assert.equal(store.getEvents('600000.SH').length, 1);
});

test('existing TDX dataset can build without initialization task; daily upkeep runs even with no new candles', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-actions-integration-'));
  let requests = 0;
  const store = await new TdxLocalStore({
    root,
    corporateActionsClient: { fetchEvents: async () => { requests++; return []; }, close() {} },
    dailyQuotesClient: { fetchDailyQuotes: async () => [], close() {} },
    nowProvider: () => new Date('2026-03-11T12:00:00Z'),
  }).init();
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  store.manifestCache = {
    initialSource: 'tdx-zip',
    incrementalSource: 'tdx-realtime',
    includeCorporateActions: true,
    instruments: [{ id: '600000.SH', asset: 'stock', lastTimestamp: Date.UTC(2026, 2, 11) }],
  };
  assert.equal(store.getTask(), null);
  await store.startCorporateActions();
  await settled(store.corporateActions);
  assert.equal(requests, 1);
  const maintenance = await store.startCnMaintenance();
  assert.ok(['queued', 'running', 'completed'].includes(maintenance.status));
  await settled({
    getStatus: () => ({ task: store.getCnMaintenanceTask() }),
    get maintenanceRunning() { return store.maintenanceRunning; },
  });
  assert.equal(store.getCnMaintenanceTask().status, 'completed');
  await settled(store.corporateActions);
  assert.equal(requests, 2);
});

test('disabled corporate-action configuration blocks sync at the local store', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-actions-disabled-'));
  let requests = 0;
  const store = await new TdxLocalStore({
    root,
    corporateActionsClient: { fetchEvents: async () => { requests += 1; return [raw]; }, close() {} },
    dailyQuotesClient: { fetchDailyQuotes: async () => [], close() {} },
  }).init();
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  store.manifestCache = {
    initialSource: 'tdx-zip',
    incrementalSource: 'tdx-realtime',
    includeCorporateActions: false,
    instruments: [{ id: '600000.SH', assetType: 'stock', lastTimestamp: Date.UTC(2026, 2, 11) }],
  };

  await assert.rejects(() => store.startCorporateActions(), /未开启权息信息同步/);
  await store.maintainCorporateActions();
  assert.equal(requests, 0);
});
