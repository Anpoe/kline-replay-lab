import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { clearMarketData } from '../app/lib/marketDataClear.ts';
import { withMarketDataWrite, withMarketDataClear } from '../app/lib/marketDataWriteGuard.ts';

function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE instruments (id TEXT PRIMARY KEY, market TEXT);
    CREATE TABLE candles (instrument_id TEXT, timeframe TEXT, source TEXT);
    CREATE TABLE candle_coverage (instrument_id TEXT, timeframe TEXT);
    CREATE TABLE data_download_jobs (id TEXT, instrument_id TEXT, market TEXT, status TEXT, sync_run_id TEXT);
    CREATE TABLE fx_data_tasks (id TEXT, instrument_id TEXT, status TEXT);
    CREATE TABLE market_sync_runs (id TEXT, market TEXT, status TEXT);
    CREATE TABLE market_sync_batches (id TEXT, run_id TEXT, status TEXT);
    CREATE TABLE market_sync_locks (market TEXT);
    CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE training_sessions (id TEXT);
    CREATE TABLE data_snapshots (id TEXT);
    CREATE TABLE provider_settings (id TEXT);
    INSERT INTO training_sessions VALUES ('keep-session');
    INSERT INTO data_snapshots VALUES ('keep-snapshot');
    INSERT INTO provider_settings VALUES ('keep-settings');
  `);
  const db = {
    prepare(sql) {
      let bindings = [];
      return {
        bind(...values) { bindings = values; return this; },
        async first() { return sqlite.prepare(sql).get(...bindings) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...bindings) }; },
        async run() { return { meta: sqlite.prepare(sql).run(...bindings) }; },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  for (const [id, market] of [['cn', 'CN'], ['us', 'US'], ['fx', 'FOREX'], ['gold', 'METAL'], ['custom', 'CUSTOM']]) {
    sqlite.prepare('INSERT INTO instruments VALUES (?, ?)').run(id, market);
    for (const timeframe of ['1m', '1d', '1w']) {
      sqlite.prepare('INSERT INTO candles VALUES (?, ?, ?)').run(id, timeframe, 'test');
      sqlite.prepare('INSERT INTO candle_coverage VALUES (?, ?)').run(id, timeframe);
    }
    sqlite.prepare('INSERT INTO data_download_jobs VALUES (?, ?, ?, ?, NULL)').run(id, id, market, 'paused');
  }
  return { db, sqlite };
}

for (const [market, id] of [['CN', 'cn'], ['US', 'us'], ['FX', 'fx'], ['GOLD', 'gold']]) {
  test(`clears every timeframe of ${market}, retaining other markets and training data`, async t => {
    const { db, sqlite } = database(t);
    let localCalls = 0;
    const result = await clearMarketData(db, market, { clearLocalData: async () => { localCalls++; } });
    assert.equal(result.deletedRows, 3);
    assert.equal(localCalls, market === 'CN' ? 1 : 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM candles WHERE instrument_id = ?').get(id).n, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM candle_coverage WHERE instrument_id = ?').get(id).n, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM data_download_jobs WHERE instrument_id = ?').get(id).n, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM candles').get().n, 12);
    assert.equal(sqlite.prepare('SELECT value FROM app_metadata WHERE key = ?').get(`market_data_cleared:${market}`).value, '1');
    assert.equal(sqlite.prepare("SELECT value FROM app_metadata WHERE key = 'sample_data_seeded'").get().value, '1');
    for (const table of ['training_sessions', 'data_snapshots', 'provider_settings']) {
      assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 1);
    }
    assert.equal((await clearMarketData(db, market, { clearLocalData: async () => {} })).deletedRows, 0);
  });
}

test('removes orphan FX tasks and keeps GOLD tasks, including alias markets', async t => {
  const { db, sqlite } = database(t);
  sqlite.exec(`INSERT INTO fx_data_tasks VALUES ('fx-task', 'EURUSD.FX', 'paused'), ('gold-task', 'XAUUSD.GOLD', 'paused');`);
  await clearMarketData(db, 'FX');
  assert.deepEqual(sqlite.prepare('SELECT id FROM fx_data_tasks').all().map(r => r.id), ['gold-task']);
});

test('removes US batches and locks with their run', async t => {
  const { db, sqlite } = database(t);
  sqlite.exec(`INSERT INTO market_sync_runs VALUES ('us-run', 'US', 'paused');
    INSERT INTO market_sync_batches VALUES ('batch', 'us-run', 'queued');
    INSERT INTO data_download_jobs VALUES ('managed', 'us', 'US', 'queued', 'us-run');
    INSERT INTO market_sync_locks VALUES ('US');`);
  await clearMarketData(db, 'US');
  for (const table of ['market_sync_runs', 'market_sync_batches', 'market_sync_locks']) {
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  }
});

test('stale download metadata cannot delete candles belonging to another market', async t => {
  const { db, sqlite } = database(t);
  sqlite.exec("INSERT INTO data_download_jobs VALUES ('stale', 'gold', 'FX', 'paused', NULL)");
  await clearMarketData(db, 'FX');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM candles WHERE instrument_id = 'gold'").get().n, 3);
});

test('database failure rolls back market deletion', async t => {
  const { db, sqlite } = database(t);
  sqlite.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON candle_coverage BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
  await assert.rejects(clearMarketData(db, 'US'), /test failure/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM candles').get().n, 15);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM app_metadata').get().n, 0);
});

test('rejects unrecognized market without any deletion', async t => {
  const { db, sqlite } = database(t);
  for (const market of ['', 'ALL', "US'); DELETE FROM candles; --", undefined]) {
    await assert.rejects(clearMarketData(db, market), /市场/);
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM candles').get().n, 15);
});

test('busy jobs and unavailable CN service leave data intact', async t => {
  const { db, sqlite } = database(t);
  sqlite.exec("UPDATE data_download_jobs SET status = 'running' WHERE market = 'CN'");
  let touchedLocal = false;
  await assert.rejects(clearMarketData(db, 'CN', { clearLocalData: async () => { touchedLocal = true; } }), /暂停/);
  assert.equal(touchedLocal, false);
  sqlite.exec("UPDATE data_download_jobs SET status = 'paused'");
  await assert.rejects(clearMarketData(db, 'CN', { clearLocalData: async () => { throw new Error('连接失败'); } }), /连接失败/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM candles').get().n, 15);
});

test('a pending write blocks clearing only its own market until fully settled', async () => {
  let finish;
  const pending = withMarketDataWrite('FX', () => new Promise(resolve => { finish = resolve; }));
  await assert.rejects(withMarketDataClear('FX', async () => {}), /暂停|处理/);
  await withMarketDataClear('GOLD', async () => {});
  finish();
  await pending;
  await withMarketDataClear('FX', async () => {
    await assert.rejects(withMarketDataWrite('FX', async () => {}), /清空/);
    await assert.rejects(withMarketDataClear('FX', async () => {}), /清空/);
    await withMarketDataWrite('GOLD', async () => {});
  });
});

test('write and clear guards release after errors', async () => {
  await assert.rejects(withMarketDataWrite('US', async () => { throw new Error('write failed'); }));
  await assert.rejects(withMarketDataClear('US', async () => { throw new Error('clear failed'); }));
  await withMarketDataWrite('US', async () => {});
  await withMarketDataClear('US', async () => {});
});
