import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TdxLocalStore } from '../local-data/legacy-tdx-store.mjs';
import { latestClosedRealtimeDate } from '../local-data/cn-maintenance.mjs';

async function settled(store) {
  for (let i = 0; i < 200; i += 1) {
    const task = store.getCnMaintenanceTask();
    if (task && !['queued', 'running'].includes(task.status) && !store.maintenanceRunning) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('TDX 实时日线任务未完成');
}

function dayBuffer(rows) {
  const buffer = Buffer.alloc(rows.length * 32);
  rows.forEach((row, index) => {
    const offset = index * 32;
    buffer.writeInt32LE(row.date, offset);
    buffer.writeInt32LE(Math.round(row.open * 100), offset + 4);
    buffer.writeInt32LE(Math.round(row.high * 100), offset + 8);
    buffer.writeInt32LE(Math.round(row.low * 100), offset + 12);
    buffer.writeInt32LE(Math.round(row.close * 100), offset + 16);
    buffer.writeFloatLE(row.turnover ?? 20000, offset + 20);
    buffer.writeInt32LE(row.volume ?? 1000, offset + 24);
  });
  return buffer;
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
    incrementalSource: 'tdx-realtime',
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
    SELECT COUNT(*) AS count, close, volume, source FROM daily_overlay
    WHERE instrument_id = '000001.SZ' AND timestamp = ?
  `).get(Date.UTC(2026, 8, 14));
  assert.equal(Number(row.count), 1);
  assert.equal(Number(row.close), 11);
  assert.equal(Number(row.volume), 100000);
  assert.equal(row.source, 'tdx-realtime-daily');
});

test('TDX historical daily incremental resumes from the last complete bar before the current session closes', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-historical-incremental-'));
  const requested = [];
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-21T12:00:00+08:00'),
    corporateActionsClient: { close() {} },
    dailyQuotesClient: {
      async fetchDailyBars(instrumentId, options) {
        requested.push({ instrumentId, options });
        return [
          { instrumentId, timestamp: Date.UTC(2026, 8, 17), open: 9, high: 10, low: 8, close: 9.5, volume: 1000, turnover: 9500 },
          { instrumentId, timestamp: Date.UTC(2026, 8, 18), open: 9.5, high: 10.5, low: 9, close: 10, volume: 1200, turnover: 12000 },
          // The current Monday bar is intentionally incomplete and must not be written.
          { instrumentId, timestamp: Date.UTC(2026, 8, 21), open: 10, high: 10.2, low: 9.9, close: 10.1, volume: 300, turnover: 3000 },
        ];
      },
      close() {},
    },
  }).init();
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  store.manifestCache = {
    datasetVersion: 'tdx-test',
    incrementalSource: 'tdx-realtime',
    assets: ['stock'],
    instruments: [{
      id: '000001.SZ',
      assetType: 'stock',
      relativePath: 'tdx/day/sz/000001.day',
      barCount: 2,
      firstTimestamp: Date.UTC(2026, 8, 16),
      lastTimestamp: Date.UTC(2026, 8, 17),
    }],
  };
  store.ensureOverlayDb().prepare(`
    INSERT INTO daily_overlay (
      instrument_id, timestamp, open, high, low, close, volume, turnover,
      source, imported_at, is_new, volume_unit
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    '000001.SZ', Date.UTC(2026, 8, 21), 10, 10.2, 9.9, 10.1, 30000, 3000,
    'tdx-realtime-daily', new Date().toISOString(), 1, 'shares',
  );

  await store.startCnMaintenance({ mode: 'incremental' });
  const completed = await settled(store);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.purgedRows, 1);
  assert.equal(completed.progress.insertedBars, 1);
  assert.equal(completed.progress.acceptedRows, 1);
  assert.equal(completed.progress.receivedRows, 3);
  assert.equal(requested.length, 1);
  assert.deepEqual(requested[0], { instrumentId: '000001.SZ', options: { assetType: 'stock', count: 800 } });
  const rows = store.ensureOverlayDb().prepare(`
    SELECT timestamp, close, volume FROM daily_overlay WHERE instrument_id = '000001.SZ' ORDER BY timestamp
  `).all();
  assert.deepEqual(rows.map(row => ({ timestamp: Number(row.timestamp), close: Number(row.close), volume: Number(row.volume) })), [{
    timestamp: Date.UTC(2026, 8, 18),
    close: 10,
    volume: 120000,
  }]);
  assert.equal(store.manifestCache.instruments[0].lastTimestamp, Date.UTC(2026, 8, 18));
});

test('TDX historical daily incremental catches up every closed session after a multi-day gap', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-historical-catchup-'));
  const requested = [];
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-21T12:00:00+08:00'),
    corporateActionsClient: { close() {} },
    dailyQuotesClient: {
      async fetchDailyBars(instrumentId, options) {
        requested.push({ instrumentId, options });
        return [
          { instrumentId, timestamp: Date.UTC(2026, 8, 17), open: 9, high: 10, low: 8, close: 9.5, volume: 1000, turnover: 9500 },
          { instrumentId, timestamp: Date.UTC(2026, 8, 18), open: 9.5, high: 10.5, low: 9, close: 10, volume: 1200, turnover: 12000 },
          { instrumentId, timestamp: Date.UTC(2026, 8, 21), open: 10, high: 10.2, low: 9.9, close: 10.1, volume: 300, turnover: 3000 },
        ];
      },
      close() {},
    },
  }).init();
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  store.manifestCache = {
    datasetVersion: 'tdx-test',
    incrementalSource: 'tdx-realtime',
    assets: ['stock'],
    instruments: [{
      id: '000001.SZ',
      assetType: 'stock',
      relativePath: 'tdx/day/sz/000001.day',
      barCount: 1,
      firstTimestamp: Date.UTC(2026, 8, 16),
      lastTimestamp: Date.UTC(2026, 8, 16),
    }],
  };

  await store.startCnMaintenance({ mode: 'incremental' });
  const completed = await settled(store);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.progress.insertedBars, 2);
  assert.equal(completed.progress.acceptedRows, 2);
  assert.equal(requested.length, 1);
  const rows = store.ensureOverlayDb().prepare(
    'SELECT timestamp FROM daily_overlay WHERE instrument_id = ? ORDER BY timestamp',
  ).all('000001.SZ');
  assert.deepEqual(rows.map((row) => Number(row.timestamp)), [
    Date.UTC(2026, 8, 17),
    Date.UTC(2026, 8, 18),
  ]);
});

test('TDX historical maintenance treats an empty provider response as retryable failure', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-historical-empty-'));
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-21T12:00:00+08:00'),
    corporateActionsClient: { close() {} },
    dailyQuotesClient: {
      async fetchDailyBars() { return []; },
      close() {},
    },
  }).init();
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  store.manifestCache = {
    datasetVersion: 'tdx-test',
    incrementalSource: 'tdx-realtime',
    assets: ['stock'],
    instruments: [{
      id: '000001.SZ',
      assetType: 'stock',
      relativePath: 'tdx/day/sz/000001.day',
      barCount: 1,
      firstTimestamp: Date.UTC(2026, 8, 16),
      lastTimestamp: Date.UTC(2026, 8, 16),
    }],
  };

  await store.startCnMaintenance({ mode: 'incremental' });
  const failed = await settled(store);
  assert.equal(failed.status, 'failed');
  assert.match(failed.message, /暂未返回历史日线/);
  assert.equal(failed.progress.receivedRows, 0);
});

test('TDX daily incremental maintenance uses the latest closed weekday over the weekend', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-realtime-weekend-'));
  let calls = 0;
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-20T10:00:00+08:00'),
    corporateActionsClient: { close() {} },
    dailyQuotesClient: {
      async fetchDailyQuotes(instrumentIds) {
        calls += 1;
        return instrumentIds.map(instrumentId => ({
          instrumentId,
          active: true,
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
    incrementalSource: 'tdx-realtime',
    instruments: [{
      id: '000001.SZ',
      assetType: 'stock',
      relativePath: 'tdx/day/sz/000001.day',
      barCount: 1,
      firstTimestamp: Date.UTC(2026, 8, 17),
      lastTimestamp: Date.UTC(2026, 8, 17),
    }],
  };

  assert.equal(latestClosedRealtimeDate(() => new Date('2026-09-20T10:00:00+08:00')), '2026-09-18');
  const task = await store.startCnMaintenance({ mode: 'incremental' });
  assert.equal(task.kind, 'tdx-realtime-daily-maintenance');
  const completed = await settled(store);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.progress.insertedBars, 1);
  assert.equal(calls, 1);

  const row = store.ensureOverlayDb().prepare(`
    SELECT timestamp, close FROM daily_overlay
    WHERE instrument_id = '000001.SZ'
  `).get();
  assert.equal(Number(row.timestamp), Date.UTC(2026, 8, 18));
  assert.equal(Number(row.close), 10);
});

test('Tushare incremental source keeps both incremental and gap repair on Tushare', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tushare-maintenance-source-'));
  const requestedDates = [];
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-14T08:00:00Z'),
    tushareThrottleMs: 0,
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body);
      requestedDates.push(body.params.trade_date);
      const fields = ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'vol', 'amount'];
      const items = body.params.trade_date === '20260914'
        ? [['000001.SZ', '20260914', 9.5, 10.5, 9, 10, 1000, 20000]]
        : [];
      return new Response(JSON.stringify({ code: 0, data: { fields, items } }), { status: 200 });
    },
    corporateActionsClient: { close() {} },
    dailyQuotesClient: {
      async fetchDailyQuotes() {
        throw new Error('Tushare 增量来源不应调用 TDX 实时接口');
      },
      close() {},
    },
  }).init();
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  store.manifestCache = {
    datasetVersion: 'tdx-test',
    incrementalSource: 'tushare',
    assets: ['stock'],
    instruments: [{
      id: '000001.SZ',
      assetType: 'stock',
      relativePath: 'tdx/day/sz/000001.day',
      barCount: 1,
      firstTimestamp: Date.UTC(2026, 8, 11),
      lastTimestamp: Date.UTC(2026, 8, 11),
    }],
  };

  const incremental = await store.startCnMaintenance({ mode: 'incremental', token: 'test-token' });
  assert.equal(incremental.kind, 'tushare-cn-daily-maintenance');
  assert.equal(incremental.source, 'tushare');
  const incrementalDone = await settled(store);
  assert.equal(incrementalDone.status, 'completed');

  const repair = await store.startCnMaintenance({ mode: 'repair', repairDays: 7, token: 'test-token' });
  assert.equal(repair.kind, 'tushare-cn-daily-maintenance');
  assert.equal(repair.source, 'tushare');
  const repairDone = await settled(store);
  assert.equal(repairDone.status, 'completed');
  assert.ok(requestedDates.includes('20260914'));

  const row = store.ensureOverlayDb().prepare(
    'SELECT volume, source FROM daily_overlay WHERE instrument_id = ? AND timestamp = ?',
  ).get('000001.SZ', Date.UTC(2026, 8, 14));
  assert.equal(Number(row.volume), 100000);
  assert.equal(row.source, 'tushare-daily');
});

test('an initialization without an incremental source blocks daily maintenance', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-no-incremental-source-'));
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-14T08:00:00Z'),
    corporateActionsClient: { close() {} },
    dailyQuotesClient: { close() {} },
  }).init();
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  store.manifestCache = {
    datasetVersion: 'tdx-test',
    incrementalSource: 'none',
    instruments: [],
  };

  await assert.rejects(
    () => store.startCnMaintenance({ mode: 'incremental' }),
    /未设置日线增量来源/,
  );
  assert.equal(store.getCnMaintenanceTask(), null);
});

test('TDX daily incremental maintenance skips pre-close quotes instead of stamping an uncertain date', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-realtime-cross-day-'));
  let now = new Date('2026-09-14T16:00:00+08:00');
  let volume = 1000;
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => now,
    corporateActionsClient: { close() {} },
    dailyQuotesClient: {
      async fetchDailyQuotes(instrumentIds) {
        return instrumentIds.map(instrumentId => ({
          instrumentId,
          price: 10,
          lastClose: 9,
          open: 9.5,
          high: 10.5,
          low: 9,
          volume,
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

  await store.startCnMaintenance({ mode: 'incremental' });
  await settled(store);
  now = new Date('2026-09-15T10:00:00+08:00');
  volume = 1200;
  await store.startCnMaintenance({ mode: 'incremental' });
  await settled(store);

  const rows = store.ensureOverlayDb().prepare(`
    SELECT timestamp, volume FROM daily_overlay
    WHERE instrument_id = '000001.SZ' ORDER BY timestamp
  `).all();
  assert.deepEqual(rows.map(row => ({ timestamp: Number(row.timestamp), volume: Number(row.volume) })), [{
    timestamp: Date.UTC(2026, 8, 14),
    volume: 100000,
  }]);
  assert.equal(store.getCnMaintenanceTask().message, '当前尚未收市或今天不是交易日，暂不写入实时日线。');
});

test('TDX pre-close checks purge a stale current-day overlay and stay retryable', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-realtime-deferred-'));
  let calls = 0;
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-15T10:00:00+08:00'),
    corporateActionsClient: { close() {} },
    dailyQuotesClient: {
      async fetchDailyQuotes() {
        calls += 1;
        return [];
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
  store.ensureOverlayDb().prepare(`
    INSERT INTO daily_overlay (
      instrument_id, timestamp, open, high, low, close, volume, turnover, source, imported_at, is_new
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    '000001.SZ', Date.UTC(2026, 8, 15), 9.5, 10.5, 9, 10, 100000, 20000,
    'tdx-realtime-daily', '2026-09-15T06:00:00.000Z', 1,
  );

  const task = await store.startCnMaintenance({ mode: 'incremental' });

  assert.equal(task.deferred, true);
  assert.equal(task.status, 'completed');
  assert.equal(calls, 0);
  assert.equal(Number(store.ensureOverlayDb().prepare(
    'SELECT COUNT(*) AS count FROM daily_overlay WHERE timestamp = ?',
  ).get(Date.UTC(2026, 8, 15)).count), 0);
});

test('TDX daily incremental maintenance keeps the native realtime path even when a repair token is present', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-incremental-native-'));
  let calls = 0;
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-15T16:00:00+08:00'),
    fetcher: async () => {
      throw new Error('增量路径不应调用 Tushare');
    },
    corporateActionsClient: { close() {} },
    dailyQuotesClient: {
      async fetchDailyQuotes(instrumentIds) {
        calls += 1;
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

  await store.startCnMaintenance({ mode: 'incremental', token: 'test-token', repairDays: 7 });
  const completed = await settled(store);

  assert.equal(completed.kind, 'tdx-realtime-daily-maintenance');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.progress.insertedBars, 1);
  assert.equal(calls, 1);
  const row = store.ensureOverlayDb().prepare(
    'SELECT close, volume FROM daily_overlay WHERE instrument_id = ? AND timestamp = ?',
  ).get('000001.SZ', Date.UTC(2026, 8, 15));
  assert.equal(Number(row.close), 10);
  assert.equal(Number(row.volume), 100000);
});

test('TDX daily incremental maintenance migrates legacy realtime volumes to shares once', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-realtime-volume-migration-'));
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-14T16:00:00+08:00'),
    corporateActionsClient: { close() {} },
    dailyQuotesClient: {
      async fetchDailyQuotes(instrumentIds) {
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
  store.manifestCache = {
    datasetVersion: 'tdx-test',
    instruments: [{
      id: '000001.SZ',
      assetType: 'stock',
      relativePath: 'tdx/day/sz/000001.day',
      barCount: 1,
      firstTimestamp: Date.UTC(2026, 8, 14),
      lastTimestamp: Date.UTC(2026, 8, 14),
    }],
  };
  store.ensureOverlayDb().prepare(`
    INSERT INTO daily_overlay (
      instrument_id, timestamp, open, high, low, close, volume, turnover, source, imported_at, is_new
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    '000001.SZ',
    Date.UTC(2026, 8, 14),
    9.5,
    10.5,
    9,
    10,
    1000,
    1000000,
    'tdx-realtime-daily',
    new Date().toISOString(),
    1,
  );

  await store.startCnMaintenance({ mode: 'incremental' });
  await settled(store);

  const row = store.ensureOverlayDb().prepare(`
    SELECT volume FROM daily_overlay WHERE instrument_id = '000001.SZ' AND timestamp = ?
  `).get(Date.UTC(2026, 8, 14));
  assert.equal(Number(row.volume), 100000);
  assert.equal(store.manifestCache.realtimeVolumeUnit, 'shares');
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
  const rows = store.ensureOverlayDb().prepare(
    'SELECT instrument_id, volume FROM daily_overlay ORDER BY instrument_id',
  ).all();
  assert.deepEqual(rows.map((row) => [row.instrument_id, Number(row.volume)]), [
    ['000001.SH', 1000],
    ['110001.SH', 100000],
    ['510300.SH', 100000],
    ['600000.SH', 100000],
  ]);
});

test('TDX gap repair uses local dated .day data and does not call Tushare', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-native-gap-'));
  const dayPath = path.join(root, 'tdx', 'day', 'sz', '000001.day');
  await mkdir(path.dirname(dayPath), { recursive: true });
  await writeFile(dayPath, dayBuffer([
    { date: 20260910, open: 9.5, high: 10.5, low: 9, close: 10, volume: 1000 },
  ]));
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-15T16:00:00+08:00'),
    fetcher: async () => { throw new Error('缺口修复不应调用 Tushare'); },
    corporateActionsClient: { close() {} },
    dailyQuotesClient: { close() {} },
  }).init();
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  store.manifestCache = {
    datasetVersion: 'tdx-test',
    instruments: [{
      id: '000001.SZ',
      assetType: 'stock',
      relativePath: 'tdx/day/sz/000001.day',
      barCount: 1,
      firstTimestamp: Date.UTC(2026, 8, 10),
      lastTimestamp: Date.UTC(2026, 8, 10),
    }],
  };
  store.ensureOverlayDb().prepare(`
    INSERT INTO daily_overlay (
      instrument_id, timestamp, open, high, low, close, volume, turnover, source, imported_at, is_new
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    '000001.SZ', Date.UTC(2026, 8, 10), 9, 9.5, 8.5, 9, 900, 18000,
    'tdx-realtime-daily', new Date().toISOString(), 0,
  );

  const task = await store.startCnMaintenance({ mode: 'repair', repairDays: 7 });
  const completed = await settled(store);
  const row = store.ensureOverlayDb().prepare(
    'SELECT close, volume, source FROM daily_overlay WHERE instrument_id = ? AND timestamp = ?',
  ).get('000001.SZ', Date.UTC(2026, 8, 10));

  assert.equal(task.kind, 'tdx-native-gap-repair');
  assert.equal(completed.status, 'completed');
  assert.equal(Number(row.close), 10);
  assert.equal(Number(row.volume), 1000);
  assert.equal(row.source, 'tdx-official-gap-repair');
});

test('TDX gap repair uses remote historical bars even when the manifest is already current', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-remote-gap-'));
  const dayPath = path.join(root, 'tdx', 'day', 'sz', '000001.day');
  await mkdir(path.dirname(dayPath), { recursive: true });
  await writeFile(dayPath, dayBuffer([
    { date: 20260910, open: 9.5, high: 10.5, low: 9, close: 10, volume: 1000 },
    { date: 20260914, open: 11.5, high: 12.5, low: 11, close: 12, volume: 1200 },
  ]));
  const requested = [];
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-15T16:00:00+08:00'),
    fetcher: async () => { throw new Error('远程通达信缺口修复不应调用 Tushare'); },
    corporateActionsClient: { close() {} },
    dailyQuotesClient: {
      async fetchDailyBars(instrumentId, options) {
        requested.push({ instrumentId, options });
        return [
          { instrumentId, timestamp: Date.UTC(2026, 8, 14), open: 11.5, high: 12.5, low: 11, close: 12, volume: 12, turnover: 20000 },
          { instrumentId, timestamp: Date.UTC(2026, 8, 11), open: 10.5, high: 11.5, low: 10, close: 11, volume: 1100, turnover: 11000 },
        ];
      },
      close() {},
    },
  }).init();
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  store.manifestCache = {
    datasetVersion: 'tdx-test',
    incrementalSource: 'tdx-realtime',
    assets: ['stock'],
    instruments: [{
      id: '000001.SZ',
      assetType: 'stock',
      relativePath: 'tdx/day/sz/000001.day',
      barCount: 2,
      firstTimestamp: Date.UTC(2026, 8, 10),
      lastTimestamp: Date.UTC(2026, 8, 14),
    }],
  };
  store.ensureOverlayDb().prepare(`
    INSERT INTO daily_overlay (
      instrument_id, timestamp, open, high, low, close, volume, turnover,
      source, imported_at, is_new, volume_unit
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    '000001.SZ', Date.UTC(2026, 8, 11), 10, 11, 9.5, 10.5, 100000, 10500,
    'tdx-realtime-daily', new Date().toISOString(), 0, 'shares',
  );

  await store.startCnMaintenance({ mode: 'repair', repairDays: 7 });
  const completed = await settled(store);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.progress.acceptedRows, 2);
  assert.equal(completed.progress.correctedBars, 1);
  assert.equal(completed.progress.unchangedBars, 1);
  assert.equal(requested.length, 1);
  assert.deepEqual(requested[0].options, { assetType: 'stock', count: 800 });
  const row = store.ensureOverlayDb().prepare(
    'SELECT close, volume, source FROM daily_overlay WHERE instrument_id = ? AND timestamp = ?',
  ).get('000001.SZ', Date.UTC(2026, 8, 11));
  assert.equal(Number(row.close), 11);
  assert.equal(Number(row.volume), 110000);
  assert.equal(row.source, 'tdx-official-gap-repair');
  assert.match(completed.message, /通达信历史缺口修复完成/);
});

test('TDX gap maintenance accepts rows for the selected non-stock categories', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-gap-assets-'));
  const dayPath = path.join(root, 'tdx', 'day', 'sh', '000001.day');
  await mkdir(path.dirname(dayPath), { recursive: true });
  await writeFile(dayPath, dayBuffer([
    { date: 20260914, open: 3800, high: 3900, low: 3790, close: 3880, volume: 1000 },
  ]));
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-14T12:00:00Z'),
    tushareThrottleMs: 0,
    fetcher: async () => { throw new Error('缺口修复不应调用 Tushare'); },
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

  await store.startCnMaintenance({ mode: 'repair', repairDays: 7 });
  const completed = await settled(store);

  assert.equal(completed.status, 'completed');
  assert.equal(completed.assets[0], 'index');
  assert.equal(completed.progress.acceptedRows, 1);
  assert.equal(completed.progress.insertedBars, 0);
  assert.equal(completed.progress.unchangedBars, 1);
  const row = store.ensureOverlayDb().prepare(
    'SELECT close, source FROM daily_overlay WHERE instrument_id = ? AND timestamp = ?',
  ).get('000001.SH', Date.UTC(2026, 8, 14));
  assert.equal(row, undefined);
});

test('TDX realtime quote reads do not write a daily bar or advance its date', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-realtime-quotes-'));
  const dayPath = path.join(root, 'tdx', 'day', 'sz', '000001.day');
  await mkdir(path.dirname(dayPath), { recursive: true });
  await writeFile(dayPath, dayBuffer([
    { date: 20260910, open: 9, high: 9.8, low: 8.8, close: 9.5, volume: 90000 },
    { date: 20260914, open: 9.5, high: 10.5, low: 9, close: 10, volume: 100000 },
  ]));
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-15T10:00:00+08:00'),
    corporateActionsClient: { close() {} },
    dailyQuotesClient: {
      async fetchDailyQuotes(instrumentIds) {
        return instrumentIds.map((instrumentId) => ({
          instrumentId,
          active: true,
          price: 10.2,
          lastClose: 10,
          open: 10.1,
          high: 10.3,
          low: 9.9,
          volume: 1234,
          turnover: 1250000,
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
      barCount: 2,
      firstTimestamp: Date.UTC(2026, 8, 10),
      lastTimestamp: Date.UTC(2026, 8, 14),
    }],
  };

  const prices = await store.getRealtimeQuotes(['000001.SZ']);
  assert.equal(prices.length, 1);
  assert.equal(prices[0].realtime, true);
  assert.equal(prices[0].timestamp, Date.UTC(2026, 8, 14));
  assert.equal(prices[0].close, 10.2);
  assert.equal(prices[0].volume, 123400);
  assert.equal(prices[0].dailyBarClosed, false);
  const recovered = await store.getRealtimeQuotes(
    ['000001.SZ'],
    { '000001.SZ': Date.UTC(2026, 8, 10) },
  );
  assert.deepEqual(recovered[0].entryBars, [{
    timestamp: Date.UTC(2026, 8, 14),
    open: 9.5,
    close: 10,
  }]);
  assert.equal(Number(store.ensureOverlayDb().prepare('SELECT COUNT(*) AS count FROM daily_overlay').get().count), 0);
});
