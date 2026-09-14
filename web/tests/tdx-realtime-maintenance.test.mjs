import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TdxLocalStore } from '../local-data/legacy-tdx-store.mjs';

async function settled(store) {
  for (let i = 0; i < 200; i += 1) {
    const task = store.getCnMaintenanceTask();
    if (task && !['queued', 'running'].includes(task.status) && !store.maintenanceRunning) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('TDX 实时日线任务未完成');
}

test('TDX daily incremental maintenance works without a token and updates the same day in place', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-realtime-'));
  let close = 10;
  let calls = 0;
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-14T12:00:00Z'),
    corporateActionsClient: { close() {} },
    dailyQuotesClient: {
      async fetchDailyQuotes(instrumentIds) {
        calls += 1;
        return instrumentIds.map(instrumentId => ({
          instrumentId,
          active: true,
          price: close,
          lastClose: 9,
          open: 9.5,
          high: close + 0.5,
          low: 9,
          volume: 1000,
          turnover: 20000,
        }));
      },
      close() {},
    },
  }).init();
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  store.manifestCache = {
    datasetVersion: 'tdx-test',
    instruments: [{
      id: '000001.SZ',
      assetType: 'stock',
      relativePath: 'tdx/day/sz/000001.day',
      barCount: 1,
      firstTimestamp: Date.UTC(2026, 8, 11),
      lastTimestamp: Date.UTC(2026, 8, 11),
    }],
  };

  const first = await store.startCnMaintenance({ mode: 'incremental' });
  assert.equal(first.kind, 'tdx-realtime-daily-maintenance');
  assert.ok(['queued', 'running'].includes(first.status));
  const completed = await settled(store);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.progress.processedInstruments, 1);
  assert.equal(completed.progress.insertedBars, 1);
  assert.equal(calls, 1);

  close = 11;
  const second = await store.startCnMaintenance({ mode: 'incremental' });
  assert.equal(second.kind, 'tdx-realtime-daily-maintenance');
  const corrected = await settled(store);
  assert.equal(corrected.progress.insertedBars, 0);
  assert.equal(corrected.progress.correctedBars, 1);
  assert.equal(calls, 2);

  const row = store.ensureOverlayDb().prepare(`
    SELECT COUNT(*) AS count, close, source FROM daily_overlay
    WHERE instrument_id = '000001.SZ' AND timestamp = ?
  `).get(Date.UTC(2026, 8, 14));
  assert.equal(Number(row.count), 1);
  assert.equal(Number(row.close), 11);
  assert.equal(row.source, 'tdx-realtime-daily');
});

test('TDX daily incremental maintenance resumes the same date after a mid-batch failure', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-realtime-resume-'));
  let calls = 0;
  const instruments = Array.from({ length: 81 }, (_, index) => ({
    id: `${String(index + 1).padStart(6, '0')}.SZ`,
    assetType: 'stock',
    relativePath: `tdx/day/sz/${String(index + 1).padStart(6, '0')}.day`,
    barCount: 1,
    firstTimestamp: Date.UTC(2026, 8, 11),
    lastTimestamp: Date.UTC(2026, 8, 11),
  }));
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-14T12:00:00Z'),
    corporateActionsClient: { close() {} },
    dailyQuotesClient: {
      async fetchDailyQuotes(instrumentIds) {
        calls += 1;
        if (calls === 2) throw new Error('模拟请求中断');
        return instrumentIds.map(instrumentId => ({
          instrumentId,
          price: 10,
          lastClose: 9,
          open: 9.5,
          high: 10.5,
          low: 9,
          volume: 1000,
          turnover: 20000,
        }));
      },
      close() {},
    },
  }).init();
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  store.manifestCache = { datasetVersion: 'tdx-test', instruments };

  await store.startCnMaintenance({ mode: 'incremental' });
  const failed = await settled(store);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.progress.processedInstruments, 80);
  assert.equal(failed.nextDateIndex, 0);

  await store.resumeCnMaintenance();
  const resumed = await settled(store);
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.progress.processedInstruments, 81);
  assert.equal(resumed.progress.insertedBars, 81);
  assert.equal(resumed.nextDateIndex, 1);

  const row = store.ensureOverlayDb().prepare(`
    SELECT COUNT(*) AS count FROM daily_overlay WHERE timestamp = ?
  `).get(Date.UTC(2026, 8, 14));
  assert.equal(Number(row.count), 81);
});

test('TDX daily maintenance follows the asset categories saved in the manifest', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-realtime-assets-'));
  const requestedBatches = [];
  const instruments = [
    ['600000.SH', 'stock'],
    ['000001.SH', 'index'],
    ['510300.SH', 'fund'],
    ['110001.SH', 'convertible-bond'],
  ].map(([id, assetType]) => ({
    id,
    assetType,
    relativePath: `tdx/day/${id.split('.')[1].toLowerCase()}/${id.split('.')[0]}.day`,
    barCount: 1,
    firstTimestamp: Date.UTC(2026, 8, 11),
    lastTimestamp: Date.UTC(2026, 8, 11),
  }));
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-14T12:00:00Z'),
    corporateActionsClient: { close() {} },
    dailyQuotesClient: {
      async fetchDailyQuotes(instrumentIds) {
        requestedBatches.push(instrumentIds);
        return instrumentIds.map((instrumentId) => ({
          instrumentId,
          price: 10,
          lastClose: 9,
          open: 9.5,
          high: 10.5,
          low: 9,
          volume: 1000,
          turnover: 20000,
        }));
      },
      close() {},
    },
  }).init();
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  store.manifestCache = {
    datasetVersion: 'tdx-test',
    assets: ['stock', 'index', 'fund', 'convertible-bond'],
    instruments,
  };

  await store.startCnMaintenance({ mode: 'incremental' });
  const completed = await settled(store);

  assert.equal(completed.progress.totalInstruments, 4);
  assert.equal(completed.progress.processedInstruments, 4);
  assert.equal(completed.progress.acceptedRows, 4);
  assert.equal(completed.progress.insertedBars, 4);
  assert.deepEqual(requestedBatches, [[
    '600000.SH',
    '000001.SH',
    '510300.SH',
    '110001.SH',
  ]]);
});

test('TDX gap maintenance accepts rows for the selected non-stock categories', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-gap-assets-'));
  const requestedDates = [];
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-14T12:00:00Z'),
    tushareThrottleMs: 0,
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body);
      requestedDates.push(body.params.trade_date);
      const items = body.params.trade_date === '20260914'
        ? [['000001.SH', '20260914', 3800, 3900, 3790, 3880, 100, 2000]]
        : [];
      return {
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'vol', 'amount'],
            items,
          },
        }),
      };
    },
    corporateActionsClient: { close() {} },
    dailyQuotesClient: { close() {} },
  }).init();
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  store.manifestCache = {
    datasetVersion: 'tdx-test',
    assets: ['index'],
    instruments: [{
      id: '000001.SH',
      assetType: 'index',
      relativePath: 'tdx/day/sh/000001.day',
      barCount: 1,
      firstTimestamp: Date.UTC(2026, 8, 11),
      lastTimestamp: Date.UTC(2026, 8, 11),
    }],
  };

  await store.startCnMaintenance({ mode: 'repair', token: 'test-token', repairDays: 7 });
  const completed = await settled(store);

  assert.equal(completed.status, 'completed');
  assert.equal(completed.assets[0], 'index');
  assert.equal(completed.progress.acceptedRows, 1);
  assert.equal(completed.progress.insertedBars, 1);
  assert.deepEqual(requestedDates, ['20260908', '20260909', '20260910', '20260911', '20260914']);
  const row = store.ensureOverlayDb().prepare(
    'SELECT close FROM daily_overlay WHERE instrument_id = ? AND timestamp = ?',
  ).get('000001.SH', Date.UTC(2026, 8, 14));
  assert.equal(Number(row.close), 3880);
});
