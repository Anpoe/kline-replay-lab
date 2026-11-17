import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
import { chunkSessionState, SESSION_CHUNK_BYTES, SESSION_CHUNK_PAGE } from '../app/lib/sessionChunks.ts';
import { beginSessionSave, putSessionChunks, commitSessionSave, writeSessionState, readSessionState } from '../app/lib/sessionStorage.ts';
import { createReviewGateway } from '../app/features/review/reviewGateway.ts';
import { sha256Text } from '../app/lib/snapshotStorage.ts';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  const runtime = readFileSync(new URL('../db/runtime.ts', import.meta.url), 'utf8');
  for (const match of runtime.matchAll(/db\.prepare\(`(CREATE (?:TABLE|INDEX) IF NOT EXISTS training_[\s\S]*?)`\)/g)) sql.exec(match[1]);
  sql.exec(`CREATE TABLE session_events(event_id TEXT PRIMARY KEY, session_id TEXT, sequence INTEGER,
    event_type TEXT, bar_timestamp INTEGER, payload_json TEXT, occurred_at TEXT)`);
  let injectedFailure = false;
  const writes = [];
  const db = {
    prepare(query) {
      let values = [];
      return {
        bind(...args) {
          for (const value of args) if (typeof value === 'string') assert.ok(Buffer.byteLength(value) <= SESSION_CHUNK_BYTES, 'bounded SQL bind');
          values = args;
          return this;
        },
        async first() {
          const row = sql.prepare(query).get(...values) ?? null;
          assert.ok(Buffer.byteLength(JSON.stringify(row)) < 1_000_000, 'bounded result');
          return row;
        },
        async all() {
          const results = sql.prepare(query).all(...values);
          assert.ok(Buffer.byteLength(JSON.stringify(results)) < 1_000_000, 'bounded result page');
          return { results };
        },
        async run() {
          if (injectedFailure && query.includes('training_state_chunks')) throw new Error('simulated storage interruption');
          writes.push(query);
          return { meta: sql.prepare(query).run(...values) };
        },
      };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec('COMMIT');
        return results;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  const head = () => sql.prepare('SELECT state_json FROM training_sessions WHERE id = ?').get('session')?.state_json;
  return { sql, db, head, writes, fail: value => { injectedFailure = value; } };
}

const metadata = { id: 'session', instrumentId: 'XAUUSD.GOLD', timeframe: '1m' };
async function upload(db, revision, state) {
  const chunks = await chunkSessionState(state);
  await beginSessionSave(db, metadata, revision, chunks.length);
  for (let offset = 0; offset < chunks.length; offset += SESSION_CHUNK_PAGE) {
    await putSessionChunks(db, metadata.id, revision, chunks.slice(offset, offset + SESSION_CHUNK_PAGE));
  }
  return chunks;
}

test('growing state, one oversized event and Unicode notes round trip beyond the single-row limit', async () => {
  const f = fixture();
  try {
    for (const size of [1, 4, 12]) {
      const state = { version: 10, cursor: size, decision: { note: '中文🙂\n"'.repeat(10_000) },
        events: [{ payload: { content: '数据🙂'.repeat(size * 180_000) } }], positions: Array.from({ length: 120 }, (_, id) => ({ id })) };
      await writeSessionState(f.db, metadata, state);
      assert.ok(Buffer.byteLength(f.head()) < 200);
      assert.deepEqual(JSON.parse(await readSessionState(f.db, metadata.id, f.head())), state);
      assert.ok(f.sql.prepare('SELECT max(length(CAST(payload_json AS BLOB))) AS size FROM training_state_chunks').get().size <= SESSION_CHUNK_BYTES);
    }
  } finally { f.sql.close(); }
});

test('only changed chunks are uploaded, and obsolete revisions and chunks are reclaimed', async () => {
  const f = fixture();
  try {
    const state = { version: 10, cursor: 1, events: Array.from({ length: 2_000 }, (_, id) => ({ id, text: 'event'.repeat(80) })) };
    await writeSessionState(f.db, metadata, state);
    const before = f.writes.filter(q => q.startsWith('INSERT OR IGNORE INTO training_state_chunks')).length;
    await writeSessionState(f.db, metadata, { ...state, cursor: 2 });
    const after = f.writes.filter(q => q.startsWith('INSERT OR IGNORE INTO training_state_chunks')).length;
    assert.equal(after - before, 1);
    assert.ok(f.sql.prepare('SELECT count(*) AS n FROM training_save_revisions').get().n <= 2);
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM training_state_chunks').get().n,
      new Set((await chunkSessionState({ ...state, cursor: 2 })).map(chunk => chunk.hash)).size);
  } finally { f.sql.close(); }
});

test('interrupted or incomplete saves preserve the committed revision and retry idempotently', async () => {
  const f = fixture();
  try {
    await writeSessionState(f.db, metadata, { version: 10, events: [] });
    const original = f.head();
    const chunks = await chunkSessionState({ version: 10, note: 'x'.repeat(200_000) });
    await beginSessionSave(f.db, metadata, 'retry', chunks.length);
    await assert.rejects(() => commitSessionSave(f.db, 'session', 'retry'), /尚未完成/);
    f.fail(true);
    await assert.rejects(() => putSessionChunks(f.db, 'session', 'retry', chunks.slice(0, 1)), /interruption/);
    f.fail(false);
    assert.equal(f.head(), original);
    for (let offset = 0; offset < chunks.length; offset += SESSION_CHUNK_PAGE) {
      const page = chunks.slice(offset, offset + SESSION_CHUNK_PAGE);
      await putSessionChunks(f.db, 'session', 'retry', page);
      await putSessionChunks(f.db, 'session', 'retry', page);
    }
    const savedAt = await commitSessionSave(f.db, 'session', 'retry');
    assert.equal(await commitSessionSave(f.db, 'session', 'retry'), savedAt);
    assert.equal(JSON.parse(await readSessionState(f.db, 'session', original)).note.length, 200_000);
  } finally { f.sql.close(); }
});

test('concurrent stale revisions, changed chunks, corrupt chunks and deleted sessions are rejected', async () => {
  const f = fixture();
  try {
    await writeSessionState(f.db, metadata, { version: 10 });
    const version = f.sql.prepare('SELECT updated_at FROM training_sessions').get().updated_at;
    const chunks = await upload(f.db, 'earlier', { version: 10, cursor: 1 });
    await upload(f.db, 'later', { version: 10, cursor: 2 });
    await commitSessionSave(f.db, 'session', 'later');
    await assert.rejects(() => commitSessionSave(f.db, 'session', 'earlier'), /其他页面更新|过期/);
    await assert.rejects(() => beginSessionSave(f.db, metadata, 'stale', 1, version), /其他页面更新/);
    const latest = JSON.parse(await readSessionState(f.db, 'session', f.head()));
    assert.equal(latest.cursor, 2);
    await beginSessionSave(f.db, metadata, 'invalid', 1);
    await assert.rejects(() => putSessionChunks(f.db, 'session', 'invalid', [{ ...chunks[0], text: 'wrong' }]), /校验失败/);
    await putSessionChunks(f.db, 'session', 'invalid', chunks);
    const different = await chunkSessionState({ version: 10, cursor: 999 });
    await assert.rejects(() => putSessionChunks(f.db, 'session', 'invalid', different), /内容已改变/);
    f.sql.prepare('UPDATE training_sessions SET deleted_at = ?').run('deleted');
    await assert.rejects(() => beginSessionSave(f.db, metadata, 'deleted', 1), /回收站/);
    await assert.rejects(() => commitSessionSave(f.db, 'session', 'invalid'), /其他页面更新/);
  } finally { f.sql.close(); }
});

test('large legacy records read in bounded Unicode-safe pages and migrate on the next save', async () => {
  const f = fixture();
  try {
    const state = { version: 10, events: [], note: '旧数据🙂'.repeat(500_000) };
    f.sql.prepare('INSERT INTO training_sessions(id,instrument_id,timeframe,state_json,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run('session', metadata.instrumentId, metadata.timeframe, JSON.stringify(state), 'before', 'before');
    assert.deepEqual(JSON.parse(await readSessionState(f.db, 'session', null)), state);
    await writeSessionState(f.db, metadata, state);
    assert.deepEqual(JSON.parse(await readSessionState(f.db, 'session', f.head())), state);
  } finally { f.sql.close(); }
});

test('large gateway saves use bounded requests, reuse chunks and retry a lost commit response', async () => {
  const f = fixture();
  try {
    const source = ts.createSourceFile('route.ts', readFileSync(new URL('../app/api/sessions/route.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const postSource = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'POST');
    const code = ts.transpileModule(postSource.getText(source).replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const { SessionStorageError } = await import('../app/lib/sessionStorage.ts');
    const post = new Function('ensureSchema', 'getRawDb', 'isSupportedTimeframe', 'beginSessionSave', 'putSessionChunks', 'commitSessionSave', 'writeSessionState', 'SessionStorageError', `${code}; return POST;`)
      (async () => {}, () => f.db, () => true, beginSessionSave, putSessionChunks, commitSessionSave, writeSessionState, SessionStorageError);
    let loseCommit = true;
    const gateway = createReviewGateway(async (url, init) => {
      assert.ok(Buffer.byteLength(init.body) < 1_000_000, 'bounded request');
      const result = await post(new Request('http://localhost' + url, init));
      if (JSON.parse(init.body).action === 'commit-session' && loseCommit) {
        loseCommit = false;
        throw new Error('connection lost after commit');
      }
      return result;
    });
    const state = { version: 10, cursor: 1, events: [{ payload: { note: '中文🙂'.repeat(500_000) } }] };
    await gateway.saveSession({ ...metadata, state });
    assert.deepEqual(JSON.parse(await readSessionState(f.db, 'session', f.head())), state);
    await gateway.saveSession({ ...metadata, state: { ...state, cursor: 2 } });
    assert.equal(JSON.parse(await readSessionState(f.db, 'session', f.head())).cursor, 2);
  } finally { f.sql.close(); }
});

test('the save queue serializes revisions and coalesces pending states to the latest one', async () => {
  const cursors = [];
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const gateway = createReviewGateway(async (_url, init) => {
    const payload = JSON.parse(init.body);
    cursors.push(payload.state.cursor);
    if (cursors.length === 1) await held;
    return { ok: true, json: async () => ({}) };
  });
  const first = gateway.saveSession({ ...metadata, state: { cursor: 1 } });
  const second = gateway.saveSession({ ...metadata, state: { cursor: 2 } });
  const third = gateway.saveSession({ ...metadata, state: { cursor: 3 } });
  release();
  await Promise.all([first, second, third]);
  assert.deepEqual(cursors, [1, 3]);
});

test('HTTP browser hashing matches server SHA256 when SubtleCrypto is unavailable', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  try {
    for (const text of ['', 'abc', '中文🙂\uD800', 'data🙂'.repeat(20_000)]) {
      assert.equal(await sha256Text(text), createHash('sha256').update(text).digest('hex'));
    }
    const state = { version: 10, events: [], note: '中文🙂'.repeat(20_000) };
    const chunks = await chunkSessionState(state);
    assert.deepEqual(JSON.parse(chunks.map(chunk=>chunk.text).join('')), state);
  } finally { Object.defineProperty(globalThis, 'crypto', original); }
});

test('deleting a training cancels queued saves and waits for the in-flight revision', async () => {
  const calls = [];
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const gateway = createReviewGateway(async (_url, init) => {
    calls.push(init.method === 'DELETE' ? 'delete' : JSON.parse(init.body).state.cursor);
    if (calls.length === 1) await held;
    return { ok: true, json: async () => ({}) };
  });
  const first = gateway.saveSession({ ...metadata, state: { cursor: 1 } });
  const queued = gateway.saveSession({ ...metadata, state: { cursor: 2 } });
  const rejected = assert.rejects(queued, /删除处理中/);
  const deleted = gateway.deleteSession('session', true);
  await assert.rejects(() => gateway.saveSession({ ...metadata, state: { cursor: 3 } }), /删除处理中/);
  release();
  await Promise.all([first, rejected, deleted]);
  assert.deepEqual(calls, [1, 'delete']);
});

test('overlapping retries of the same commit acknowledge the same durable revision', async () => {
  const f = fixture();
  try {
    await upload(f.db, 'same-revision', { version: 10, cursor: 1 });
    const results = await Promise.all([
      commitSessionSave(f.db, 'session', 'same-revision'),
      commitSessionSave(f.db, 'session', 'same-revision'),
    ]);
    assert.equal(results[0], results[1]);
    assert.equal(JSON.parse(await readSessionState(f.db, 'session', f.head())).cursor, 1);
  } finally { f.sql.close(); }
});
