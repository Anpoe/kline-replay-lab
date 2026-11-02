import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as paging from '../app/lib/candlePaging.mjs';
import * as adjustments from '../app/lib/marketAdjustments.ts';

const source = ts.transpileModule(readFileSync(new URL('../app/api/candles/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(t, localRead = async () => null) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO app_metadata VALUES ('sample_data_seeded', '1');
    CREATE TABLE instruments (id TEXT, symbol TEXT, name TEXT, market TEXT, timezone TEXT, price_precision INTEGER);
    INSERT INTO instruments VALUES ('EURUSD.FX', 'EURUSD', '欧元美元', 'FX', 'UTC', 5), ('600519.SH', '600519', '贵州茅台', 'CN', 'Asia/Shanghai', 2);
    CREATE TABLE candles (instrument_id TEXT, timeframe TEXT, adjustment_type TEXT, timestamp INTEGER, open REAL, high REAL, low REAL, close REAL, volume REAL, turnover REAL);`);
  for (let timestamp = 1; timestamp <= 1201; timestamp++) sqlite.prepare("INSERT INTO candles VALUES ('EURUSD.FX', '1d', 'none', ?, 10, 11, 9, 10, 100, 1000)").run(timestamp);
  const db = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    const bound = args => ({ first: async () => statement.get(...args) ?? null, all: async () => ({ results: statement.all(...args) }), run: async () => statement.run(...args) });
    return { ...bound([]), bind: (...args) => bound(args) };
  } };
  const route = {};
  new Function('require', 'exports', source)(id => {
    if (id === '../../../db/runtime') return { getRawDb: () => db, ensureSchema: async () => {} };
    if (id === '../../../db/sample-data') return { SAMPLE_INSTRUMENTS: [] };
    if (id === '../../lib/marketAdjustments') return adjustments;
    if (id === '../../lib/candlePaging.mjs') return paging;
    if (id === '../../lib/localDataService') return { readLocalDataJson: localRead };
    if (id === '../../lib/timeframeCatalog') return { isSupportedTimeframe: value => value === '1d' };
    if (id === '../../lib/timeframeAvailability' || id === '../../lib/marketDataWriteGuard') return {};
    throw Error(`Unexpected dependency ${id}`);
  }, route);
  return { route, sqlite };
}

const get = (route, query) => route.GET(new Request(`http://localhost/api/candles?${query}`));
test('actual candle API SQL pages latest-to-oldest without changing unpaged consumers', async t => {
  const { route } = fixture(t);
  const latest = await (await get(route, 'instrument=EURUSD.FX&limit=500')).json();
  assert.equal(latest.candles.length, 500);
  assert.equal(latest.candles[0].timestamp, 702);
  assert.equal(latest.hasBefore, true);
  const older = await (await get(route, 'instrument=EURUSD.FX&limit=500&before=702')).json();
  assert.deepEqual(older.candles.map(bar => bar.timestamp), Array.from({ length: 500 }, (_, i) => i + 202));
  const first = await (await get(route, 'instrument=EURUSD.FX&limit=500&before=202')).json();
  assert.equal(first.candles.length, 201);
  assert.equal(first.hasBefore, false);
  assert.equal((await (await get(route, 'instrument=EURUSD.FX')).json()).candles.length, 1201);
  assert.equal((await get(route, 'instrument=EURUSD.FX&limit=100000')).status, 400);
});

test('local service receives bounded cursors; an empty final page never switches to sample data', async t => {
  let received;
  const { route, sqlite } = fixture(t, async url => { received = url; return { instrument: { id: '600519.SH' }, candles: [], hasBefore: false }; });
  sqlite.exec("INSERT INTO candles VALUES ('600519.SH', '1d', 'qfq', 1, 10, 11, 9, 10, 100, 1000)");
  const page = await (await get(route, 'instrument=600519.SH&limit=500&before=100')).json();
  assert.match(received, /limit=500&before=100/);
  assert.deepEqual(page.candles, []);
  assert.equal(page.hasBefore, false);
});

test('an already running local service without paging still yields bounded client pages', async t => {
  const candles = Array.from({ length: 1201 }, (_, timestamp) => ({ timestamp }));
  const { route } = fixture(t, async () => ({ instrument: { id: '600519.SH' }, candles }));
  const page = await (await get(route, 'instrument=600519.SH&limit=500&before=800')).json();
  assert.equal(page.candles.length, 500);
  assert.equal(page.candles[0].timestamp, 300);
  assert.equal(page.candles.at(-1).timestamp, 799);
  assert.equal(page.hasBefore, true);
});
