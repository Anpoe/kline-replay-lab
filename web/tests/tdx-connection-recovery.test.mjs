import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { TdxCorporateActionsClient } from '../local-data/tdx-corporate-actions-client.mjs';
import { TdxLocalStore } from '../local-data/legacy-tdx-store.mjs';

const dailyBody = Buffer.from('010039283501b4b6015414e401a032004911e1114e', 'hex');

function socketFixture() {
  const writes = [];
  const sockets = [];
  let active = 0;
  let peak = 0;
  const socketFactory = () => {
    const socket = new EventEmitter();
    socket.destroyed = false;
    socket.setTimeout = socket.setNoDelay = () => {};
    socket.destroy = () => {
      socket.destroyed = true;
      queueMicrotask(() => socket.emit('close'));
    };
    socket.write = (packet, callback) => {
      writes.push(packet);
      active += 1;
      peak = Math.max(peak, active);
      callback();
      const body = packet.length === 38 ? dailyBody : Buffer.alloc(11);
      const header = Buffer.alloc(16);
      header.writeUInt16LE(body.length, 12);
      header.writeUInt16LE(body.length, 14);
      setTimeout(() => {
        active -= 1;
        if (!socket.destroyed) socket.emit('data', Buffer.concat([header, body]));
      }, 2);
    };
    sockets.push(socket);
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  };
  return { socketFactory, sockets, writes, peak: () => peak };
}

test('TDX socket setup and response framing stay intact under overlapping callers', async t => {
  const fixture = socketFixture();
  const client = new TdxCorporateActionsClient({ hosts: [['fixture', 7709]], socketFactory: fixture.socketFactory });
  t.after(() => client.close());
  const [history, events, otherHistory] = await Promise.all([
    client.fetchDailyBars('000001.SZ'), client.fetchEvents('600000.SH'), client.fetchDailyBars('000002.SZ'),
  ]);
  assert.equal(history[0].instrumentId, '000001.SZ');
  assert.deepEqual(events, []);
  assert.equal(otherHistory[0].instrumentId, '000002.SZ');
  assert.equal(fixture.sockets.length, 1);
  assert.equal(fixture.writes.length, 6, 'one handshake and three business requests');
  assert.equal(fixture.peak(), 1);
});

test('aborting a queued history request never resets another caller\'s active socket', async t => {
  const client = new TdxCorporateActionsClient({ hosts: [['fixture', 7709]] });
  t.after(() => client.close());
  let release;
  const connected = new Promise(resolve => { release = resolve; });
  let resets = 0;
  client.connect = () => connected;
  client.reset = () => { resets += 1; };
  client.requestResponse = async () => dailyBody;
  const first = client.fetchDailyBars('000001.SZ');
  const controller = new AbortController();
  const aborted = assert.rejects(client.fetchDailyBars('000002.SZ', { signal: controller.signal }), { name: 'AbortError' });
  controller.abort();
  release();
  assert.equal((await first)[0].instrumentId, '000001.SZ');
  await aborted;
  assert.equal(resets, 0);
});

async function until(read, predicate) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const value = read();
    if (predicate(value)) return value;
    await wait(5);
  }
  throw new Error('fixture condition timed out');
}

async function maintenanceFixture(t, retryDelayMs = 1) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kline-tdx-recovery-'));
  const client = new TdxCorporateActionsClient({ hosts: [['fixture', 7709]], retryDelayMs });
  client.connect = async () => {};
  client.reset = () => {};
  const store = await new TdxLocalStore({
    root,
    nowProvider: () => new Date('2026-09-22T12:00:00+08:00'),
    corporateActionsClient: { close() {} },
    dailyQuotesClient: client,
  }).init();
  t.after(async () => {
    store.close();
    await until(() => store.maintenanceRunning, running => !running);
    await rm(root, { recursive: true, force: true });
  });
  store.manifestCache = {
    datasetVersion: 'tdx-fixture', incrementalSource: 'tdx-realtime', assets: ['stock'],
    instruments: ['000001.SZ', '000002.SZ'].map(id => ({
      id, assetType: 'stock', relativePath: `tdx/day/sz/${id.slice(0, 6)}.day`,
      barCount: 1, firstTimestamp: Date.UTC(2026, 8, 18), lastTimestamp: Date.UTC(2026, 8, 18),
    })),
  };
  return { store, client };
}

for (const mode of ['incremental', 'repair']) {
  test(`TDX ${mode} keeps the same task and completed symbols through automatic reconnect`, async t => {
    const { store, client } = await maintenanceFixture(t);
    const requests = [];
    const messages = [];
    const persist = store.persistMaintenanceTask.bind(store);
    store.persistMaintenanceTask = async () => { messages.push(store.maintenanceTask.message); await persist(); };
    client.requestResponse = async packet => {
      const code = packet.subarray(14, 20).toString('ascii');
      requests.push(code);
      if (code === '000002' && requests.filter(id => id === code).length < 3) throw new Error('fixture disconnect');
      return dailyBody;
    };
    const started = await store.startCnMaintenance({ mode });
    const task = await until(() => store.getCnMaintenanceTask(), task => !store.maintenanceRunning && task.status !== 'queued');
    assert.equal(task.id, started.id);
    assert.equal(task.status, 'completed');
    assert.equal(task.progress.processedInstruments, 2);
    assert.equal(task.progress.insertedBars, 2);
    assert.deepEqual(requests, ['000001', '000002', '000002', '000002']);
    assert.ok(messages.some(message => /自动重试/.test(message)), 'reconnecting must be visible while task stays running');
    assert.equal(Number(store.ensureOverlayDb().prepare('SELECT COUNT(*) AS count FROM daily_overlay').get().count), 2);
  });
}

test('pausing maintenance cancels reconnect backoff and resumes the pending symbol only', async t => {
  const { store, client } = await maintenanceFixture(t, 60_000);
  let disconnected = true;
  const requests = [];
  client.requestResponse = async packet => {
    const code = packet.subarray(14, 20).toString('ascii');
    requests.push(code);
    if (code === '000002' && disconnected) throw new Error('fixture disconnect');
    return dailyBody;
  };
  await store.startCnMaintenance({ mode: 'incremental' });
  await until(() => store.getCnMaintenanceTask(), task => /自动重试/.test(task.message));
  await store.pauseCnMaintenance();
  const paused = await until(() => store.getCnMaintenanceTask(), task => !store.maintenanceRunning && task.status === 'paused');
  assert.equal(paused.nextInstrumentIndex, 1);
  assert.equal(paused.progress.processedInstruments, 1);
  assert.deepEqual(requests, ['000001', '000002']);
  disconnected = false;
  await store.resumeCnMaintenance();
  const completed = await until(() => store.getCnMaintenanceTask(), task => !store.maintenanceRunning && task.status === 'completed');
  assert.equal(completed.progress.insertedBars, 2);
  assert.deepEqual(requests, ['000001', '000002', '000002']);
});

test('persistent maintenance failure preserves the completed prefix for explicit recovery', async t => {
  const { store, client } = await maintenanceFixture(t);
  let disconnected = true;
  const requests = [];
  client.requestResponse = async packet => {
    const code = packet.subarray(14, 20).toString('ascii');
    requests.push(code);
    if (code === '000002' && disconnected) throw new Error('fixture disconnect');
    return dailyBody;
  };
  await store.startCnMaintenance({ mode: 'incremental' });
  const failed = await until(() => store.getCnMaintenanceTask(), task => !store.maintenanceRunning && task.status === 'failed');
  assert.equal(failed.nextInstrumentIndex, 1);
  assert.match(failed.message, /连接.*重试.*仍未恢复/);
  assert.match(failed.error, /000002.SZ/);
  assert.match(failed.error, /fixture disconnect/);
  disconnected = false;
  await store.resumeCnMaintenance();
  const completed = await until(() => store.getCnMaintenanceTask(), task => !store.maintenanceRunning && task.status === 'completed');
  assert.equal(completed.progress.insertedBars, 2);
  assert.equal(requests.filter(code => code === '000001').length, 1);
});

test('TDX serializes history and quote requests including connection setup', async t => {
  const client = new TdxCorporateActionsClient({ hosts: [['fixture', 7709]] });
  t.after(() => client.close());
  let active = 0;
  let peak = 0;
  let quotes = 0;
  client.connect = async () => { await wait(1); };
  client.reset = () => {};
  client.requestResponse = async packet => {
    active += 1;
    peak = Math.max(peak, active);
    try {
      await wait(5);
      if (packet.length === 38) return dailyBody;
      quotes += 1;
      // An empty quote response is valid protocol data; the quote client retries it.
      return Buffer.from([0, 0, 0, 0]);
    } finally {
      active -= 1;
    }
  };
  const [history, quoteResult] = await Promise.allSettled([
    client.fetchDailyBars('000001.SZ'),
    client.fetchDailyQuotes(['000001.SZ']),
  ]);
  assert.equal(history.status, 'fulfilled');
  assert.equal(history.value[0].instrumentId, '000001.SZ');
  assert.equal(quoteResult.status, 'rejected');
  assert.ok(quotes > 0);
  assert.equal(peak, 1, 'history and quotes must never read the socket concurrently');
  // A failed queued request must not poison subsequent requests.
  assert.equal((await client.fetchDailyBars('000002.SZ'))[0].instrumentId, '000002.SZ');
});

test('TDX waits before retrying a temporary outage even with a single configured host', async t => {
  const client = new TdxCorporateActionsClient({ hosts: [['fixture', 7709]], retryDelayMs: 1 });
  t.after(() => client.close());
  const retries = [];
  let requests = 0;
  client.connect = async () => {};
  client.reset = () => {};
  client.requestResponse = async () => {
    requests += 1;
    if (requests < 3) throw new Error('TDX 行情连接已断开');
    return dailyBody;
  };
  const rows = await client.fetchDailyBars('000001.SZ', { onRetry: retry => retries.push(retry) });
  assert.equal(rows.length, 1);
  assert.equal(requests, 3);
  assert.equal(retries.length, 2);
  assert.ok(retries[0].delayMs > 0);
  assert.ok(retries[1].delayMs > retries[0].delayMs);
});

test('TDX persistent failures stop after bounded retries and identify the affected symbol', async t => {
  const client = new TdxCorporateActionsClient({ hosts: [['fixture', 7709]], retryDelayMs: 1 });
  t.after(() => client.close());
  const retries = [];
  let requests = 0;
  client.connect = async () => {};
  client.reset = () => {};
  client.requestResponse = async () => { requests += 1; throw new Error('fixture disconnect'); };
  await assert.rejects(client.fetchDailyBars('000001.SZ', { onRetry: retry => retries.push(retry) }), error => {
    assert.match(error.message, /000001.SZ/);
    assert.match(error.message, /fixture disconnect/);
    return true;
  });
  assert.equal(requests, retries.length + 1);
  assert.ok(requests >= 3 && requests <= 8);
});

test('TDX abort interrupts retry backoff without starting another request', async t => {
  const client = new TdxCorporateActionsClient({ hosts: [['fixture', 7709]], retryDelayMs: 60_000 });
  t.after(() => client.close());
  const controller = new AbortController();
  let requests = 0;
  client.connect = async () => {};
  client.reset = () => {};
  client.requestResponse = async () => { requests += 1; throw new Error('fixture disconnect'); };
  await assert.rejects(client.fetchDailyBars('000001.SZ', {
    signal: controller.signal,
    onRetry: () => controller.abort(),
  }), { name: 'AbortError' });
  assert.equal(requests, 1);
});
