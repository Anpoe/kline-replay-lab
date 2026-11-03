import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('route.ts', readFileSync(new URL('../app/api/sessions/route.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const getter = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'GET');
const code = ts.transpileModule(getter.getText(source).replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
test('scoped session reads filter before limiting and preserve full history, trash and bound values', async () => {
 const db = new DatabaseSync(':memory:');
 try {
  db.exec('CREATE TABLE training_sessions(id TEXT, instrument_id TEXT, timeframe TEXT, data_snapshot_id TEXT, state_json TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT)');
  const insert = db.prepare('INSERT INTO training_sessions VALUES(?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 25; i++) insert.run(String(i), '000831.SZ', '1d', '', '{}', String(i).padStart(2, '0'), '', null);
  insert.run('other-period', '000831.SZ', '1w', '', '{}', '99', '', null);
  insert.run('other-stock', '002657.SZ', '1d', '', '{}', '99', '', null);
  insert.run('trash', '000831.SZ', '1d', '', '{}', '99', '', 'deleted');
  const runtime = { prepare(sql) { let args = []; return { bind(...values) { args = values; return this; }, async all() { return { results: db.prepare(sql).all(...args) }; } }; } };
  const get = new Function('ensureSchema', 'getRawDb', `${code}; return GET;`)(async () => {}, () => runtime);
  const read = async query => (await (await get(new Request('http://localhost/api/sessions?' + query))).json()).sessions;
  assert.equal((await read('instrument=000831.SZ&timeframe=1d')).length, 20);
  const all = await read('all=1&instrument=000831.SZ&timeframe=1d');
  assert.equal(all.length, 25); assert.equal(all[0].id, '24');
  assert.equal((await read('all=1')).length, 27);
  assert.deepEqual((await read('all=1&trash=1&instrument=000831.SZ&timeframe=1d')).map(s => s.id), ['trash']);
  assert.deepEqual(await read('all=1&instrument=' + encodeURIComponent("' OR 1=1 --")), []);
 } finally { db.close(); }
});
