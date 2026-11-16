import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { TdxLocalStore } from '../local-data/legacy-tdx-store.mjs';

const before = Date.UTC(2026, 8, 18);
const target = Date.UTC(2026, 8, 21);
const bar = (timestamp = target) => ({ timestamp, open: 10, high: 12, low: 9, close: 11, volume: 10, turnover: 11000 });

async function until(read, condition) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const value = read();
    if (condition(value)) return value;
    await wait(5);
  }
  throw new Error('maintenance fixture timed out');
}

async function fixture(t, fetchDailyBars, count = 2) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-lifecycle-'));
  const stores = [];
  const manifest = {
    datasetVersion: 'tdx-lifecycle', initialSource: 'tdx-zip', incrementalSource: 'tdx-realtime', includeCorporateActions: false,
    assets: ['stock'], instruments: Array.from({ length: count }, (_, index) => ({
      id: `${String(index + 1).padStart(6, '0')}.SZ`, assetType: 'stock',
      relativePath: `tdx/day/sz/${String(index + 1).padStart(6, '0')}.day`, barCount: 1,
      firstTimestamp: before, lastTimestamp: before,
    })),
  };
  await mkdir(path.join(root, 'tdx/day/sz'), { recursive: true });
  const buffer = Buffer.alloc(32);
  buffer.writeInt32LE(20260918, 0);
  for (const [offset, value] of [[4, 1000], [8, 1200], [12, 900], [16, 1100], [24, 1000]]) buffer.writeInt32LE(value, offset);
  buffer.writeFloatLE(11000, 20);
  for (const instrument of manifest.instruments) await writeFile(path.join(root, instrument.relativePath), buffer);
  await writeFile(path.join(root, 'tdx/manifest.json'), JSON.stringify(manifest));
  const open = async fetcher => {
    const store = await new TdxLocalStore({ root, nowProvider: () => new Date('2026-09-22T12:00:00+08:00'),
      corporateActionsClient: { close() {} }, dailyQuotesClient: { fetchDailyBars: fetcher, close() {} },
    }).init();
    stores.push(store);
    return store;
  };
  t.after(async () => {
    for (const store of stores) {
      await until(() => store.maintenanceRunning, running => !running);
      store.close();
    }
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'kline-tdx-lifecycle-')));
    await rm(root, { recursive: true, force: true });
  });
  return { root, manifest, open, store: await open(fetchDailyBars) };
}

const settled = store => until(() => store.getCnMaintenanceTask(), task => task && !['queued', 'running'].includes(task.status) && !store.maintenanceRunning);

for (const mode of ['incremental', 'repair']) {
  test(`TDX ${mode} rolls back coverage and counters when a symbol write fails midway`, async t => {
    const f = await fixture(t, async () => [bar(before - 86_400_000), bar()], 1);
    const db = f.store.ensureOverlayDb();
    const prepare = db.prepare.bind(db);
    let writes = 0;
    let failing = true;
    db.prepare = sql => {
      const statement = prepare(sql);
      if (/INSERT INTO daily_overlay/.test(sql)) {
        const run = statement.run.bind(statement);
        statement.run = (...args) => {
          writes += 1;
          if (failing && writes === 2) throw new Error('fixture write failure');
          return run(...args);
        };
      }
      return statement;
    };
    await f.store.startCnMaintenance({ mode });
    const failed = await settled(f.store);
    assert.equal(failed.status, 'failed');
    assert.equal(Number(prepare('SELECT COUNT(*) AS count FROM daily_overlay').get().count), 0);
    assert.equal((await f.store.getManifest()).instruments[0].barCount, 1);
    assert.equal(failed.progress.insertedBars, 0);
    failing = false;
    await f.store.resumeCnMaintenance();
    const completed = await settled(f.store);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.progress.insertedBars, 2);
    const instrument = (await f.store.getManifest()).instruments[0];
    assert.equal(instrument.barCount, 3);
    assert.equal(instrument.firstTimestamp, before - 86_400_000);
    assert.equal(instrument.lastTimestamp, target);
  });

  test(`TDX ${mode} restart after a partial failure retains coverage of completed symbols`, async t => {
    const f = await fixture(t, async id => {
      if (id === '000002.SZ') throw new Error('fixture connection lost');
      return [bar()];
    });
    await f.store.startCnMaintenance({ mode });
    const failed = await settled(f.store);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.nextInstrumentIndex, 1);
    const checkpoint = JSON.parse(await readFile(path.join(f.root, 'tdx/manifest.json'), 'utf8'));
    assert.equal(checkpoint.instruments[0].lastTimestamp, target);
    assert.equal(checkpoint.instruments[0].barCount, 2);
    f.store.close();
    const requests = [];
    const restarted = await f.open(async id => { requests.push(id); return [bar()]; });
    await restarted.resumeCnMaintenance();
    assert.equal((await settled(restarted)).status, 'completed');
    assert.deepEqual(requests, ['000002.SZ']);
    const manifest = JSON.parse(await readFile(path.join(f.root, 'tdx/manifest.json'), 'utf8'));
    for (const instrument of manifest.instruments) {
      assert.equal(instrument.lastTimestamp, target, `stale latest date for ${instrument.id}`);
      assert.equal(instrument.barCount, 2, `stale count for ${instrument.id}`);
    }
    const coverage = await restarted.getCoverage({ limit: 10 });
    assert.equal(coverage.coverage.filter(item => item.timeframe === '1d').reduce((sum, item) => sum + item.barCount, 0), 4);
  });

  test(`TDX ${mode} repairs a stale coverage checkpoint after an interrupted process`, async t => {
    const f = await fixture(t, async id => {
      if (id === '000002.SZ') throw new Error('fixture connection lost');
      return [bar()];
    });
    await f.store.startCnMaintenance({ mode });
    assert.equal((await settled(f.store)).nextInstrumentIndex, 1);
    f.store.close();
    // Reproduce a crash where the SQLite commit and task cursor reached disk,
    // while the manifest still contains its pre-update checkpoint.
    await writeFile(path.join(f.root, 'tdx/manifest.json'), JSON.stringify(f.manifest));
    const requests = [];
    const restarted = await f.open(async id => { requests.push(id); return [bar()]; });
    await restarted.resumeCnMaintenance();
    assert.equal((await settled(restarted)).status, 'completed');
    assert.deepEqual(requests, ['000002.SZ']);
    const manifest = await restarted.getManifest();
    assert.deepEqual(manifest.instruments.map(item => item.barCount), [2, 2]);
    assert.deepEqual(manifest.instruments.map(item => item.lastTimestamp), [target, target]);
  });
}

test('TDX repairs a committed overlay even when the interrupted task cursor was not advanced', async t => {
  const f = await fixture(t, async () => [bar()], 1);
  await f.store.startCnMaintenance({ mode: 'incremental' });
  await settled(f.store);
  f.store.close();
  await writeFile(path.join(f.root, 'tdx/manifest.json'), JSON.stringify(f.manifest));
  const task = JSON.parse(await readFile(path.join(f.root, 'cn-maintenance-task.json'), 'utf8'));
  Object.assign(task, { status: 'running', nextInstrumentIndex: 0, writeCompleted: false });
  task.progress.processedInstruments = 0;
  await writeFile(path.join(f.root, 'cn-maintenance-task.json'), JSON.stringify(task));
  const restarted = await f.open(async () => [bar()]);
  assert.equal(restarted.getCnMaintenanceTask().status, 'paused');
  await restarted.resumeCnMaintenance();
  assert.equal((await settled(restarted)).status, 'completed');
  const manifest = await restarted.getManifest();
  assert.equal(manifest.instruments[0].barCount, 2);
  assert.equal(manifest.instruments[0].lastTimestamp, target);
  assert.notEqual(manifest.datasetVersion, f.manifest.datasetVersion);
});

test('TDX reports manifest write failures instead of leaving a completed task running', async t => {
  const { store } = await fixture(t, async () => [bar()], 1);
  store.persistTdxMaintenanceManifest = async () => { throw new Error('fixture disk full'); };
  await store.startCnMaintenance({ mode: 'incremental' });
  const failed = await settled(store);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /fixture disk full/);
});

test('TDX rapid pause then resume waits for the previous writer instead of losing the resume request', async t => {
  let release;
  let calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const { store } = await fixture(t, async () => {
    calls += 1;
    return calls === 1 ? pending : [bar()];
  }, 1);
  await store.startCnMaintenance({ mode: 'incremental' });
  await until(() => calls, count => count === 1);
  await store.pauseCnMaintenance();
  const resumed = store.resumeCnMaintenance();
  // Release a request that was already in flight when the pause was clicked.
  setTimeout(() => release([bar()]), 20);
  await resumed;
  assert.equal((await settled(store)).status, 'completed');
  assert.equal(store.getCnMaintenanceTask().progress.insertedBars, 1);
});

test('TDX historical pagination catches up long gaps and repeated updates do not inflate counts', async t => {
  const days = [];
  for (let timestamp = target; days.length < 910; timestamp -= 86_400_000) {
    if (![0, 6].includes(new Date(timestamp).getUTCDay())) days.push(timestamp);
  }
  const history = [bar(target + 86_400_000), ...days.map(timestamp => bar(timestamp))];
  const requests = [];
  const { store, root, manifest } = await fixture(t, async (_id, { start = 0, count }) => {
    requests.push({ start, count });
    return history.slice(start, start + count);
  }, 1);
  manifest.instruments[0].firstTimestamp = days.at(-1) - 86_400_000;
  manifest.instruments[0].lastTimestamp = days.at(-1) - 86_400_000;
  await writeFile(path.join(root, 'tdx/manifest.json'), JSON.stringify(manifest));
  await store.startCnMaintenance({ mode: 'incremental' });
  const first = await settled(store);
  assert.equal(first.status, 'completed');
  assert.deepEqual(requests, [{ start: 0, count: 64 }, { start: 64, count: 800 }, { start: 864, count: 800 }]);
  const db = store.ensureOverlayDb();
  const initialCount = Number(db.prepare('SELECT COUNT(*) AS count FROM daily_overlay').get().count);
  assert.equal(initialCount, 909, 'existing base day remains in the .day file');
  assert.equal(first.progress.insertedBars, 909);
  assert.equal(db.prepare('SELECT 1 FROM daily_overlay WHERE timestamp > ?').get(target), undefined);
  const count = store.manifestCache.instruments[0].barCount;
  await store.startCnMaintenance({ mode: 'incremental' });
  const second = await settled(store);
  assert.equal(second.status, 'completed');
  assert.equal(second.progress.insertedBars, 0);
  assert.equal(store.manifestCache.instruments[0].barCount, count);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM daily_overlay').get().count), initialCount);
});
