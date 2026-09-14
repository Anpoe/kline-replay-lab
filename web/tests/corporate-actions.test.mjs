import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CorporateActionsStore, normalizeCorporateActions } from '../local-data/corporate-actions-store.mjs';
import { TdxLocalStore } from '../local-data/legacy-tdx-store.mjs';

const raw = { year: 2026, month: 3, day: 11, category: 1, fenhong: 2, songzhuangu: 3, peigu: 1, peigujia: 5 };
const stocks = [{ id: '600000.SH', asset: 'stock' }, { id: '000001.SZ', asset: 'stock' }, { id: '920001.BJ', asset: 'stock' }, { id: '000001.SH', asset: 'index' }];
async function settled(store) {
  for (let i = 0; i < 200; i++) {
    if (!['queued', 'running'].includes(store.getStatus().task?.status)) return store.getStatus();
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
  const store = await new TdxLocalStore({ root, corporateActionsClient: { fetchEvents: async () => { requests++; return []; }, close() {} }, nowProvider: () => new Date('2026-03-11T12:00:00Z') }).init();
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  store.manifestCache = { instruments: [{ id: '600000.SH', asset: 'stock', lastTimestamp: Date.UTC(2026, 2, 11) }] };
  assert.equal(store.getTask(), null);
  await store.startCorporateActions();
  await settled(store.corporateActions);
  assert.equal(requests, 1);
  const maintenance = await store.startCnMaintenance({ token: 'test-only' });
  assert.equal(maintenance.status, 'completed');
  await settled(store.corporateActions);
  assert.equal(requests, 2);
});
