import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { dateRangeBounds, mt4PeriodEnd } from '../app/lib/mt4History.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const archiveAccountKey = account => createHash('sha256').update(`${account.login}|${account.server}|${account.mode}`).digest('hex');
const periods = [1, 5, 15, 30, 60, 240, 1440, 10080, 43200];
const columns = {
  accounts: ['account_key', 'login', 'server', 'mode', 'currency', 'updated_at', 'scan_json'],
  orders: ['account_key', 'symbol', 'ticket', 'data_json', 'first_seen', 'last_seen', 'timeframe'],
  events: ['id', 'account_key', 'symbol', 'ticket', 'observed_at', 'captured_at', 'source', 'data_json', 'evidence_json'],
  bars: ['account_key', 'symbol', 'timeframe', 'timestamp', 'data_json', 'observed_at'],
  analyses: ['account_key', 'symbol', 'timeframe', 'scope', 'revision', 'data_json', 'updated_at'],
  analysis_versions: ['account_key', 'symbol', 'timeframe', 'scope', 'revision', 'data_json', 'updated_at'],
  market_requests: ['account_key', 'symbol', 'timeframe', 'anchor', 'status', 'updated_at'],
  instruments: ['account_key', 'symbol', 'data_json', 'updated_at'],
};
export class ArchiveError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const ensure = (test, message, status) => { if (!test) throw new ArchiveError(message, status); };
function context(accountKey, symbol, timeframe) {
  ensure(/^[a-f0-9]{64}$/.test(accountKey) && typeof symbol === 'string' && symbol.length > 0 && symbol.length <= 80 && !/[\x00-\x1f]/.test(symbol) && periods.includes(Number(timeframe)), '档案范围无效');
}
function semantic(order) {
  // Floating PnL is not an order modification. Closed PnL and fees remain evidence.
  return { ...order, profit: order.closeTime ? order.profit : 0, swap: order.closeTime ? order.swap : 0, commission: order.closeTime ? order.commission : 0 };
}
export class Mt4Archive {
  constructor({ directory, now = Date.now }) { this.directory = directory; this.file = path.join(directory, 'archive.sqlite'); this.now = now; this.db = null; }
  open() { this.access(() => {}); return this; }
  close() { this.db?.close(); this.db = null; }
  access(operation) {
    if (this.db) return operation(this.db);
    mkdirSync(this.directory, { recursive: true });
    const db = new DatabaseSync(this.file); this.db = db;
    try {
      db.exec(`PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS accounts(account_key TEXT PRIMARY KEY, login TEXT NOT NULL, server TEXT NOT NULL, mode TEXT NOT NULL, currency TEXT NOT NULL, updated_at INTEGER NOT NULL, scan_json TEXT NOT NULL DEFAULT '{}');
        CREATE TABLE IF NOT EXISTS orders(account_key TEXT NOT NULL REFERENCES accounts, symbol TEXT NOT NULL, ticket INTEGER NOT NULL, data_json TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, timeframe INTEGER NOT NULL, PRIMARY KEY(account_key,symbol,ticket));
        CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, account_key TEXT NOT NULL, symbol TEXT NOT NULL, ticket INTEGER NOT NULL, observed_at INTEGER NOT NULL, captured_at INTEGER NOT NULL, source TEXT NOT NULL, data_json TEXT NOT NULL, evidence_json TEXT NOT NULL, FOREIGN KEY(account_key,symbol,ticket) REFERENCES orders(account_key,symbol,ticket));
        CREATE INDEX IF NOT EXISTS events_order ON events(account_key,symbol,ticket,id);
        CREATE TABLE IF NOT EXISTS bars(account_key TEXT NOT NULL REFERENCES accounts, symbol TEXT NOT NULL, timeframe INTEGER NOT NULL, timestamp INTEGER NOT NULL, data_json TEXT NOT NULL, observed_at INTEGER NOT NULL, PRIMARY KEY(account_key,symbol,timeframe,timestamp));
        CREATE TABLE IF NOT EXISTS analyses(account_key TEXT NOT NULL REFERENCES accounts, symbol TEXT NOT NULL, timeframe INTEGER NOT NULL, scope TEXT NOT NULL, revision INTEGER NOT NULL, data_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(account_key,symbol,timeframe,scope));
        CREATE TABLE IF NOT EXISTS analysis_versions(account_key TEXT NOT NULL REFERENCES accounts, symbol TEXT NOT NULL, timeframe INTEGER NOT NULL, scope TEXT NOT NULL, revision INTEGER NOT NULL, data_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(account_key,symbol,timeframe,scope,revision));
        CREATE TABLE IF NOT EXISTS market_requests(account_key TEXT NOT NULL REFERENCES accounts, symbol TEXT NOT NULL, timeframe INTEGER NOT NULL, anchor INTEGER NOT NULL, status TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(account_key,symbol,timeframe,anchor));
        CREATE TABLE IF NOT EXISTS instruments(account_key TEXT NOT NULL REFERENCES accounts, symbol TEXT NOT NULL, data_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(account_key,symbol));
        PRAGMA user_version=1;`);
      return operation(db);
    } finally { db.close(); this.db = null; }
  }
  transaction(operation) { return this.access(db => { db.exec('BEGIN IMMEDIATE'); try { const result = operation(db); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }); }
  ingest(snapshot, { historyPage = null, scan = null } = {}) {
    return this.transaction(db => {
      const key = archiveAccountKey(snapshot.account), a = snapshot.account, now = this.now();
      db.prepare(`INSERT INTO accounts VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_key) DO UPDATE SET currency=excluded.currency,updated_at=excluded.updated_at`).run(key, a.login, a.server, a.mode, a.currency, now, '{}');
      if (scan) db.prepare('UPDATE accounts SET scan_json=? WHERE account_key=?').run(JSON.stringify(scan), key);
      const saveInstrument = db.prepare('INSERT INTO instruments VALUES(?,?,?,?) ON CONFLICT(account_key,symbol) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at WHERE instruments.data_json<>excluded.data_json');
      for (const instrument of snapshot.symbols ?? []) {
        const { symbol, digits, point, contractSize, tickSize, minLot, maxLot, lotStep } = instrument;
        saveInstrument.run(key, symbol, JSON.stringify({ symbol, digits, point, contractSize, tickSize, minLot, maxLot, lotStep }), now);
      }
      this.putBars(db, key, snapshot.chart.symbol, snapshot.chart.timeframe, snapshot.chart.bars, now);
      for (const [source, orders] of [['observed', snapshot.orders], ['history', snapshot.history], ['history-import', historyPage ?? []]]) for (const order of orders) {
        const old = db.prepare('SELECT * FROM orders WHERE account_key=? AND symbol=? AND ticket=?').get(key, order.symbol, order.ticket);
        if (old && JSON.parse(old.data_json).closeTime > 0 && !order.closeTime) continue;
        const sameChart = snapshot.chart.symbol === order.symbol;
        const timeframe = old?.timeframe ?? (sameChart ? snapshot.chart.timeframe : 5);
        const changed = !old || JSON.stringify(semantic(JSON.parse(old.data_json))) !== JSON.stringify(semantic(order));
        db.prepare(`INSERT INTO orders VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_key,symbol,ticket) DO UPDATE SET data_json=excluded.data_json,last_seen=excluded.last_seen`).run(key, order.symbol, order.ticket, JSON.stringify(order), old?.first_seen ?? now, now, timeframe);
        for (const anchor of [order.openTime, order.closeTime].filter(v => v > 0)) db.prepare('INSERT OR IGNORE INTO market_requests VALUES(?,?,?,?,?,?)').run(key, order.symbol, timeframe, anchor, 'queued', now);
        if (changed) {
          const analysis = this.analysis(key, order.symbol, timeframe);
          const evidence = { chart: sameChart ? snapshot.chart : null, analysis: analysis.revision ? analysis : null, serverUtcOffset: snapshot.serverUtcOffset ?? null, sessionId: snapshot.sessionId };
          db.prepare('INSERT INTO events(account_key,symbol,ticket,observed_at,captured_at,source,data_json,evidence_json) VALUES(?,?,?,?,?,?,?,?)').run(key, order.symbol, order.ticket, now, snapshot.capturedAt, source, JSON.stringify(order), JSON.stringify(evidence));
        }
      }
      return key;
    });
  }
  putBars(db, key, symbol, timeframe, bars, observedAt = this.now()) {
    context(key, symbol, timeframe);
    const statement = db.prepare(`INSERT INTO bars VALUES(?,?,?,?,?,?) ON CONFLICT(account_key,symbol,timeframe,timestamp) DO UPDATE SET data_json=excluded.data_json,observed_at=excluded.observed_at WHERE bars.data_json<>excluded.data_json`);
    for (const bar of bars) statement.run(key, symbol, timeframe, bar.timestamp, JSON.stringify(bar), observedAt);
    // One returned window can cover many trades. Do not request the same candles per ticket.
    const covered = db.prepare("UPDATE market_requests SET status='complete',updated_at=? WHERE account_key=? AND symbol=? AND timeframe=? AND status IN ('queued','missing') AND anchor*1000>=? AND anchor*1000<?");
    for (const bar of bars) covered.run(observedAt,key,symbol,timeframe,bar.timestamp,mt4PeriodEnd(bar.timestamp,timeframe));
  }
  saveBars(key, symbol, timeframe, bars) { return this.transaction(db => this.putBars(db, key, symbol, timeframe, bars)); }
  nextMarketRequest(key) { return this.access(db => db.prepare("SELECT symbol,timeframe,anchor FROM market_requests WHERE account_key=? AND status='queued' ORDER BY updated_at,anchor LIMIT 1").get(key)); }
  finishMarketRequest(key, symbol, timeframe, anchor, status) { return this.access(db => db.prepare('UPDATE market_requests SET status=?,updated_at=? WHERE account_key=? AND symbol=? AND timeframe=? AND anchor=?').run(status, this.now(), key, symbol, timeframe, anchor)); }
  retryMarketRequests(key) { return this.access(db => db.prepare("UPDATE market_requests SET status='queued' WHERE account_key=? AND status='missing'").run(key)); }
  accounts() { return this.access(db => db.prepare('SELECT * FROM accounts ORDER BY updated_at DESC').all().map(a => ({ accountKey: a.account_key, login: a.login, server: a.server, mode: a.mode, currency: a.currency, updatedAt: a.updated_at, scan: JSON.parse(a.scan_json), market: Object.fromEntries(db.prepare('SELECT status,COUNT(*) AS n FROM market_requests WHERE account_key=? GROUP BY status').all(a.account_key).map(row => [row.status,row.n])), symbols: db.prepare('SELECT symbol FROM orders WHERE account_key=? UNION SELECT symbol FROM bars WHERE account_key=? ORDER BY symbol').all(a.account_key,a.account_key).map(r => r.symbol) }))); }
  filterWhere({ accountKey, symbol = '', from = '', to = '' }) {
    ensure(/^[a-f0-9]{64}$/.test(accountKey), '请选择账户');
    let bounds; try { bounds=dateRangeBounds(from,to); } catch(error) { throw new ArchiveError(error.message); }
    let where='account_key=?';const args=[accountKey];
    if(symbol){where+=' AND symbol=?';args.push(symbol);}
    const time="COALESCE(NULLIF(json_extract(data_json,'$.closeTime'),0),json_extract(data_json,'$.openTime'))";
    if(bounds.start!=null){where+=` AND ${time}>=?`;args.push(bounds.start);}
    if(bounds.end!=null){where+=` AND ${time}<?`;args.push(bounds.end);}
    return {where,args,time,bounds};
  }
  list({ accountKey, symbol = '', from = '', to = '', page = 0, limit = 50, chartSymbol = '' }) {
    const {where,args,time}=this.filterWhere({accountKey,symbol,from,to});
    return this.access(db => {
      const total = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE ${where}`).get(...args).n;
      const size=Math.max(1,Math.min(100,Number(limit)||50)), actualPage=Math.min(Math.max(0,Math.trunc(Number(page)||0)),Math.max(0,Math.ceil(total/size)-1));
      const rows = db.prepare(`SELECT * FROM orders WHERE ${where} ORDER BY ${time} DESC,ticket DESC,symbol LIMIT ? OFFSET ?`).all(...args,size,actualPage*size);
      const decode=r=>({...JSON.parse(r.data_json),timeframe:r.timeframe,firstSeen:r.first_seen,lastSeen:r.last_seen,...(r.position!=null?{position:r.position}: {})});
      const chartRows=chartSymbol?db.prepare(`SELECT * FROM (SELECT *,ROW_NUMBER() OVER(ORDER BY ${time} DESC,ticket DESC,symbol)-1 AS position FROM orders WHERE ${where}) WHERE symbol=? AND json_extract(data_json,'$.type')<2 ORDER BY position LIMIT 2001`).all(...args,chartSymbol):[];
      return { total, page:actualPage, orders:rows.map(decode), chartOrders:chartRows.slice(0,2000).map(decode), chartLimited:chartRows.length>2000, updatedAt:this.now() };
    });
  }
  bars({ accountKey, symbol, timeframe, before = 0, after = 0, focus = 0, limit = 1000 }) {
    timeframe = Number(timeframe); context(accountKey, symbol, timeframe);
    const cursors = [before, after, focus].map(Number);
    ensure(cursors.every(n => Number.isSafeInteger(n) && n >= 0) && cursors.filter(Boolean).length <= 1, '行情读取位置无效');
    ensure(Number.isInteger(Number(limit)) && Number(limit) > 0 && Number(limit) <= 2000, '行情读取数量无效');
    [before, after, focus] = cursors; limit = Number(limit);
    return this.access(db => {
      const args = [accountKey, symbol, timeframe];
      const read = (condition, cursor, count, direction) => db.prepare(`SELECT data_json FROM bars WHERE account_key=? AND symbol=? AND timeframe=? ${condition} ORDER BY timestamp ${direction} LIMIT ?`).all(...args, ...(cursor ? [cursor] : []), count).map(row => JSON.parse(row.data_json));
      let bars;
      if (focus) {
        const left = read('AND timestamp<=?', focus, Math.ceil(limit / 2), 'DESC').reverse();
        const right = read('AND timestamp>?', focus, limit - left.length, 'ASC');
        bars = [...left, ...right];
      } else bars = before ? read('AND timestamp<?', before, limit, 'DESC').reverse() : after ? read('AND timestamp>?', after, limit, 'ASC') : read('', 0, limit, 'DESC').reverse();
      const exists = (comparison, timestamp) => !!db.prepare(`SELECT 1 FROM bars WHERE account_key=? AND symbol=? AND timeframe=? AND timestamp${comparison}? LIMIT 1`).get(...args, timestamp);
      const spec = db.prepare('SELECT data_json FROM instruments WHERE account_key=? AND symbol=?').get(accountKey, symbol);
      return { accountKey, symbol, timeframe, bars, hasBefore: bars.length > 0 && exists('<', bars[0].timestamp), hasAfter: bars.length > 0 && exists('>', bars.at(-1).timestamp), digits: spec ? JSON.parse(spec.data_json).digits : 5, updatedAt: this.now() };
    });
  }
  chart({accountKey,symbol,timeframe,from='',to=''}) {
    context(accountKey,symbol,Number(timeframe));const {where,args,bounds}=this.filterWhere({accountKey,symbol,from,to});
    return this.access(db=>{
      const span=db.prepare(`SELECT MIN(json_extract(data_json,'$.openTime')) AS first,MAX(COALESCE(NULLIF(json_extract(data_json,'$.closeTime'),0),json_extract(data_json,'$.openTime'))) AS last FROM orders WHERE ${where}`).get(...args);
      const start=Math.min(bounds.start??span.first??0,span.first??Infinity)*1000-Number(timeframe)*60000*60;
      const end=(bounds.end??span.last??0)*1000+Number(timeframe)*60000*60;
      const rows=db.prepare('SELECT data_json FROM bars WHERE account_key=? AND symbol=? AND timeframe=? AND timestamp BETWEEN ? AND ? ORDER BY timestamp DESC LIMIT 5001').all(accountKey,symbol,Number(timeframe),start,end);
      const spec=db.prepare('SELECT data_json FROM instruments WHERE account_key=? AND symbol=?').get(accountKey,symbol);
      return {accountKey,symbol,timeframe:Number(timeframe),bars:rows.slice(0,5000).reverse().map(r=>JSON.parse(r.data_json)),limited:rows.length>5000,digits:spec?JSON.parse(spec.data_json).digits:5,updatedAt:this.now()};
    });
  }
  trade(key, symbol, ticket, timeframe, focus = 0) {
    context(key, symbol, timeframe);
    return this.access(db => {
      const row = db.prepare('SELECT * FROM orders WHERE account_key=? AND symbol=? AND ticket=?').get(key, symbol, Number(ticket)); ensure(row, '该账户和品种下没有这笔交易', 404);
      const order = JSON.parse(row.data_json), events = db.prepare('SELECT * FROM events WHERE account_key=? AND symbol=? AND ticket=? ORDER BY id').all(key, symbol, Number(ticket)).map(r => ({ id: r.id, observedAt: r.observed_at, capturedAt: r.captured_at, source: r.source, order: JSON.parse(r.data_json), evidence: JSON.parse(r.evidence_json) }));
      const center = focus > 0 ? focus / 1000 : order.openTime;
      const start = (center - timeframe * 60 * 200) * 1000, end = (center + timeframe * 60 * 200) * 1000;
      // Bound rendering independently of archive size. Entry and exit can be selected separately.
      const bars = db.prepare('SELECT data_json FROM bars WHERE account_key=? AND symbol=? AND timeframe=? AND timestamp BETWEEN ? AND ? ORDER BY timestamp LIMIT 2000').all(key, symbol, Number(timeframe), start, end).map(r => JSON.parse(r.data_json));
      const spec = { digits: Math.max(0, ...[order.openPrice, order.stopLoss, order.takeProfit, order.closePrice].map(n => String(n).split('.')[1]?.length ?? 0)) };
      const instrument = db.prepare('SELECT data_json FROM instruments WHERE account_key=? AND symbol=?').get(key, symbol);
      const focusCovered = bars.some(bar => bar.timestamp <= center * 1000 && bar.timestamp + timeframe * 60000 > center * 1000);
      return { accountKey: key, symbol, timeframe: Number(timeframe), order, events, bars, focusCovered, digits: instrument ? JSON.parse(instrument.data_json).digits : Math.max(2, spec.digits), analysis: this.analysis(key, symbol, timeframe, `trade:${ticket}`) };
    });
  }
  analysis(key, symbol, timeframe, scope = 'chart') {
    context(key, symbol, timeframe); ensure(scope === 'chart' || /^trade:\d+$/.test(scope), '分析范围无效');
    return this.access(db => { const row = db.prepare('SELECT * FROM analyses WHERE account_key=? AND symbol=? AND timeframe=? AND scope=?').get(key, symbol, Number(timeframe), scope);
      return row ? { revision: row.revision, data: JSON.parse(row.data_json), updatedAt: row.updated_at } : { revision: 0, data: null, updatedAt: 0 }; });
  }
  decisionPlans({ accountKey, symbol, offset = 0, limit = 100 }) {
    context(accountKey, symbol, 1);
    offset = Number(offset); limit = Number(limit);
    ensure(Number.isSafeInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 100, '计划分页无效');
    return this.access(db => {
      const rows = db.prepare('SELECT timeframe,scope,data_json FROM analyses WHERE account_key=? AND symbol=? ORDER BY timeframe,scope LIMIT ? OFFSET ?').all(accountKey, symbol, limit + 1, offset);
      const plans = rows.slice(0, limit).flatMap(row => (JSON.parse(row.data_json).decisions ?? []).map(decision => ({ timeframe: row.timeframe, scope: row.scope, decision: { ...decision, drawings: [] } })));
      return { plans, nextOffset: rows.length > limit ? offset + limit : null };
    });
  }
  saveAnalysis({ accountKey, symbol, timeframe, scope = 'chart', revision, data, migrate = false }) {
    context(accountKey, symbol, timeframe);
    ensure(scope === 'chart' || /^trade:\d+$/.test(scope), '分析范围无效');
    ensure(data && data.version === 1 && Array.isArray(data.drawings) && Array.isArray(data.decisions) && data.draft && JSON.stringify(data).length <= 4 * 1024 * 1024, '绘图或决策格式无效');
    return this.transaction(db => {
      ensure(db.prepare('SELECT 1 FROM accounts WHERE account_key=?').get(accountKey), '账户尚未归档，请先验证连接', 404);
      if (scope !== 'chart') { ensure(/^trade:\d+$/.test(scope) && db.prepare('SELECT 1 FROM orders WHERE account_key=? AND symbol=? AND ticket=?').get(accountKey, symbol, Number(scope.slice(6))), '关联交易不存在'); }
      const old = this.analysis(accountKey, symbol, timeframe, scope);
      if (migrate && old.revision) return old;
      ensure(old.revision === revision, '其他页面已保存了新版本。请先导出当前内容，再重新读取档案。', 409);
      const next = { revision: old.revision + 1, data, updatedAt: this.now() }, args = [accountKey, symbol, Number(timeframe), scope, next.revision, JSON.stringify(data), next.updatedAt];
      db.prepare('INSERT INTO analysis_versions VALUES(?,?,?,?,?,?,?)').run(...args);
      db.prepare('INSERT INTO analyses VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_key,symbol,timeframe,scope) DO UPDATE SET revision=excluded.revision,data_json=excluded.data_json,updated_at=excluded.updated_at').run(...args);
      return next;
    });
  }
  backup() { return this.access(db => { const tables = Object.fromEntries(Object.keys(columns).map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])); return { format: 'kline-mt4-archive', version: 1, exportedAt: this.now(), checksum: hash(tables), tables }; }); }
  restore(backup) {
    ensure(backup?.format === 'kline-mt4-archive' && backup.version === 1 && backup.tables && hash(backup.tables) === backup.checksum, '备份格式或校验无效');
    for (const table of Object.keys(columns)) ensure(Array.isArray(backup.tables[table]) && backup.tables[table].length <= 1000000, '备份范围无效');
    for (const row of backup.tables.accounts) ensure(row.account_key === archiveAccountKey(row) && /^\d+$/.test(row.login) && ['demo','real','contest'].includes(row.mode), '备份账户无效');
    const keys = new Set(backup.tables.accounts.map(row => row.account_key));
    for (const [table, rows] of Object.entries(backup.tables)) {
      ensure(Object.hasOwn(columns, table), '备份包含不支持的记录');
      for (const row of rows) {
        ensure(keys.has(row.account_key), '备份账户关联无效');
        if (table !== 'accounts') context(row.account_key, row.symbol, row.timeframe ?? 5);
        if (row.data_json != null) {
          let value; try { value = JSON.parse(row.data_json); } catch { throw new ArchiveError('备份数据格式无效'); }
          if (table === 'orders' || table === 'events') ensure(value.ticket === row.ticket && value.symbol === row.symbol && Number.isInteger(value.type) && value.type >= 0 && value.type <= 5 && ['lots','openPrice','stopLoss','takeProfit','profit','swap','commission','openTime','closeTime','closePrice','magic'].every(k => Number.isFinite(value[k])), '备份交易无效');
          if (table === 'bars') ensure(value.timestamp === row.timestamp && ['open','high','low','close','volume'].every(k => Number.isFinite(value[k])) && value.low <= Math.min(value.open,value.close) && value.high >= Math.max(value.open,value.close), '备份行情无效');
          if (table === 'instruments') ensure(value.symbol === row.symbol && Number.isInteger(value.digits) && value.digits >= 0 && value.digits <= 10, '备份品种无效');
          if (table === 'analyses' || table === 'analysis_versions') ensure(value.version === 1 && Array.isArray(value.drawings) && Array.isArray(value.decisions) && value.draft && (row.scope === 'chart' || /^trade:\d+$/.test(row.scope)), '备份分析无效');
        }
        if (table === 'events') { try { JSON.parse(row.evidence_json); } catch { throw new ArchiveError('备份证据无效'); } }
      }
    }
    return this.transaction(db => {
      for (const [table, names] of Object.entries(columns)) for (const row of backup.tables[table]) {
        ensure(Object.keys(row).length === names.length && names.every(name => row[name] != null && ['string','number'].includes(typeof row[name])), '备份记录无效');
        const keys = table === 'accounts' ? ['account_key'] : table === 'events' ? ['id'] : table === 'orders' ? ['account_key','symbol','ticket'] : table === 'instruments' ? ['account_key','symbol'] : table === 'bars' ? ['account_key','symbol','timeframe','timestamp'] : table === 'market_requests' ? ['account_key','symbol','timeframe','anchor'] : ['account_key','symbol','timeframe','scope', ...(table === 'analysis_versions' ? ['revision'] : [])];
        const old = db.prepare(`SELECT * FROM ${table} WHERE ${keys.map(k => `${k}=?`).join(' AND ')}`).get(...keys.map(k => row[k]));
        ensure(!old || names.every(k => old[k] === row[k]), '备份与现有档案存在不同版本，请先备份当前档案并在空档案中恢复', 409);
        if (!old) db.prepare(`INSERT INTO ${table}(${names.join(',')}) VALUES(${names.map(() => '?').join(',')})`).run(...names.map(k => row[k]));
      }
      return { restored: true, accounts: backup.tables.accounts.length };
    });
  }
}
