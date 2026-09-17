import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { zipSync } from 'fflate';
import { BaoStockLocalStore } from '../local-data/baostock-store.mjs';
import { TdxLocalStore } from '../local-data/legacy-tdx-store.mjs';
import { clearLocalMarketData } from '../local-data/clear-market-data.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-clear-market-'));
  const row = Buffer.alloc(32);
  row.writeInt32LE(20260820, 0);
  [1000, 1100, 900, 1050].forEach((price, i) => row.writeInt32LE(price, 4 + 4 * i));
  row.writeFloatLE(1000, 20);
  row.writeInt32LE(100, 24);
  const archive = zipSync({ 'vipdoc/sh/lday/sh600519.day': row });
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-length': archive.length });
    response.end(archive);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const stores = {
    baostock: await new BaoStockLocalStore({ root, client: {
      queryCatalog: async () => [{ code: 'sh.600519', code_name: '贵州茅台', ipoDate: '2001-08-27', type: '1', status: '1' }],
      queryHistory: async () => [{ date: '2026-08-20', code: 'sh.600519', open: '10', high: '11', low: '9', close: '10.5', volume: '100', amount: '1000', adjustflag: '2' }],
      close() {},
    } }).init(),
    tdx: await new TdxLocalStore({ root, sourceUrl: `http://127.0.0.1:${server.address().port}/history.zip`, autoRefreshCatalog: false }).init(),
  };
  t.after(async () => {
    for (const store of Object.values(stores)) store.close();
    await new Promise(resolve => server.close(resolve));
    assert.ok(root.startsWith(path.join(os.tmpdir(), 'kline-clear-market-')));
    await rm(root, { recursive: true, force: true });
  });
  return { root, stores };
}

async function initialize(store) {
  await store.createTask({ assets: ['stock'], historyRange: 'all', keepRawPackage: true, includeCorporateActions: false });
  const deadline = Date.now() + 5000;
  while ((store.running || ['queued', 'running'].includes(store.getTask()?.status)) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(store.getTask()?.status, 'completed', store.getTask()?.error);
}

test('clears both CN providers, packages and task files, then initializes again without restarting', async t => {
  const { root, stores } = await fixture(t);
  await initialize(stores.baostock);
  await initialize(stores.tdx);
  for (const store of Object.values(stores)) assert.ok((await store.getInstruments()).length > 0);
  await writeFile(path.join(root, 'settings-sentinel.json'), 'keep');
  await writeFile(path.join(root, 'source-selection.json'), '{"source":"tdx"}');
  for (const store of Object.values(stores)) {
    store.maintenanceTask = { status: 'paused' };
    await writeFile(store.maintenanceTaskFile, JSON.stringify(store.maintenanceTask));
    await writeFile(store.catalogTaskFile, '{"status":"completed"}');
  }
  await clearLocalMarketData(stores);
  for (const store of Object.values(stores)) {
    assert.equal(await store.getManifest(), null);
    assert.deepEqual(await store.getInstruments(), []);
    assert.equal(store.getTask(), null);
    assert.equal(store.getCnMaintenanceTask(), null);
    assert.equal(store.getCatalogTask(), null);
    await assert.rejects(access(store.taskFile));
    await assert.rejects(access(store.maintenanceTaskFile));
    await assert.rejects(access(store.catalogTaskFile));
  }
  await assert.rejects(access(path.join(root, 'packages', 'hsjday.zip')));
  assert.equal(await readFile(path.join(root, 'settings-sentinel.json'), 'utf8'), 'keep');
  assert.equal(await readFile(path.join(root, 'source-selection.json'), 'utf8'), '{"source":"tdx"}');
  await clearLocalMarketData(stores);
  await initialize(stores.baostock);
  await initialize(stores.tdx);
  for (const store of Object.values(stores)) assert.ok((await store.getInstruments()).length > 0);
});

test('refuses all deletion if either active or inactive provider still has work in flight', async t => {
  const { root, stores } = await fixture(t);
  await mkdir(path.join(root, 'packages'), { recursive: true });
  const sentinel = path.join(root, 'packages', 'keep.zip');
  await writeFile(sentinel, 'keep');
  for (const [store, key] of [[stores.baostock, 'running'], [stores.baostock, 'maintenanceRunning'],
    [stores.baostock, 'catalogRunning'], [stores.tdx, 'running'], [stores.tdx, 'maintenanceRunning'],
    [stores.tdx, 'catalogRunning'], [stores.tdx.corporateActions, 'running']]) {
    store[key] = true;
    await assert.rejects(clearLocalMarketData(stores), /处理中/);
    assert.equal(await readFile(sentinel, 'utf8'), 'keep');
    store[key] = false;
  }
});
