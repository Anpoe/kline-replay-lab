import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TdxCorporateActionsClient } from './tdx-corporate-actions-client.mjs';

const stamp = () => new Date().toISOString();
const busy = task => ['queued', 'running'].includes(task?.status);
const number = value => {
  const result = Number(value ?? 0);
  if (!Number.isFinite(result) || result < 0) throw new Error('权息记录数值无效，已保留原记录');
  return Number(result.toFixed(6));
};

export function normalizeCorporateActions(instrumentId, rows) {
  if (!Array.isArray(rows)) throw new Error('未收到有效权息记录，已保留原记录');
  const events = new Map();
  for (const row of rows) {
    const category = Number(row.category);
    // Other categories describe listing/capital changes, not ex-rights events.
    if (![1, 11, 12].includes(category)) continue;
    const date = `${row.year}-${String(row.month).padStart(2, '0')}-${String(row.day).padStart(2, '0')}`;
    const timestamp = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
      throw new Error('权息记录日期无效，已保留原记录');
    }
    const event = { id: `${instrumentId}:${date}:${category}`, instrumentId, date, timestamp, category,
      cashPer10: category === 1 ? number(row.fenhong) : 0,
      bonusSharesPer10: category === 1 ? number(row.songzhuangu) : 0,
      rightsSharesPer10: category === 1 ? number(row.peigu) : 0,
      rightsPrice: category === 1 ? number(row.peigujia) : 0,
      shareRatio: category === 1 ? null : number(row.suogu), source: 'tdx',
    };
    const terms = [];
    if (event.cashPer10) terms.push(`每10股派${event.cashPer10}元（税前）`);
    if (event.bonusSharesPer10) terms.push(`每10股送转${event.bonusSharesPer10}股`);
    if (event.rightsSharesPer10) terms.push(`每10股配${event.rightsSharesPer10}股，配股价${event.rightsPrice}元`);
    event.label = event.cashPer10 ? 'D' : '权';
    event.description = category === 1 ? terms.join('；') || '除权除息' : category === 11 ? '缩股' : '扩股';
    events.set(event.id, event);
  }
  return [...events.values()].sort((a, b) => a.timestamp - b.timestamp || a.category - b.category);
}

// This sidecar never changes raw candles, price adjustments or training snapshots.
export class CorporateActionsStore {
  constructor({ root, client = new TdxCorporateActionsClient() }) {
    this.directory = path.join(root, 'tdx', 'corporate-actions');
    this.client = client;
    this.state = { enabled: false, lastCompletedAt: null, task: null };
    this.running = false;
    this.closed = false;
    this.db = null;
  }

  async init() {
    await mkdir(this.directory, { recursive: true });
    this.db = new DatabaseSync(path.join(this.directory, 'events.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS records (instrument_id TEXT PRIMARY KEY, events TEXT NOT NULL, checked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);`);
    const saved = this.db.prepare('SELECT payload FROM state WHERE id=1').get();
    if (saved) this.state = JSON.parse(saved.payload);
    if (this.state.task?.error?.includes("权息数据组件尚未安装")) {
      this.state.task.status = "paused";
      this.state.task.error = null;
      this.state.task.message = "权息查询方式已更新为内置服务，可继续未完成品种。";
      this.save();
    }
    if (busy(this.state.task)) {
      this.state.task.status = 'paused';
      this.state.task.message = '权息更新已暂停，可继续未完成的品种。';
      this.save();
    }
    return this;
  }

  save() {
    this.state.updatedAt = stamp();
    this.db.prepare('INSERT OR REPLACE INTO state VALUES (1, ?)').run(JSON.stringify(this.state));
  }

  getStatus() {
    const counts = this.db.prepare('SELECT COUNT(*) AS checked, COALESCE(SUM(json_array_length(events)), 0) AS events FROM records').get();
    // Do not send the full work queue to the browser on every poll.
    const task = this.state.task && { ...this.state.task, ids: undefined };
    return { ...this.state, task, eventCount: counts.events, checkedInstruments: counts.checked, source: 'tdx', coverage: '沪深股票' };
  }

  getEvents(instrumentId) {
    const row = this.db.prepare('SELECT events FROM records WHERE instrument_id=?').get(instrumentId);
    return row ? JSON.parse(row.events) : [];
  }

  deleteInstruments(instrumentIds) {
    if (!instrumentIds.length) return;
    const remove = this.db.prepare('DELETE FROM records WHERE instrument_id=?');
    this.db.exec('BEGIN');
    try {
      for (const instrumentId of instrumentIds) remove.run(instrumentId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async start(instruments) {
    if (this.closed) throw new Error('权息服务已关闭');
    if (this.running || busy(this.state.task)) return this.getStatus();
    // An interrupted initial build must not be silently discarded by a daily update.
    if (this.state.task && ['paused', 'failed'].includes(this.state.task.status)) return this.resume();
    const ids = [...new Set(instruments.filter(item => (item.asset ?? item.assetType) === 'stock' && /^\d{6}\.(SH|SZ)$/.test(item.id)).map(item => item.id))];
    this.state.enabled = true;
    this.state.task = { status: 'queued', ids, nextIndex: 0, total: ids.length, processed: 0, failed: [],
      skipped: instruments.length - ids.length, message: '等待更新权息信息', startedAt: stamp(), error: null };
    this.save();
    queueMicrotask(() => void this.run());
    return this.getStatus();
  }

  async pause() {
    if (busy(this.state.task)) {
      this.state.task.status = 'paused';
      this.state.task.message = '权息更新已暂停，可继续未完成的品种。';
      this.save();
    }
    return this.getStatus();
  }

  async resume() {
    if (this.running) throw new Error('正在结束当前请求，请稍后继续');
    const task = this.state.task;
    if (!task || !['failed', 'paused'].includes(task.status)) return this.getStatus();
    task.ids = [...new Set([...task.ids.slice(task.nextIndex), ...task.failed.map(item => item.instrumentId)])];
    task.nextIndex = 0;
    task.failed = [];
    task.status = 'queued';
    task.error = null;
    task.message = '等待继续更新权息信息';
    this.save();
    queueMicrotask(() => void this.run());
    return this.getStatus();
  }

  async run() {
    if (this.closed || this.running || !busy(this.state.task)) return;
    const task = this.state.task;
    this.running = true;
    task.status = 'running';
    try {
      this.save();
      let consecutiveFailures = 0;
      while (task.nextIndex < task.ids.length && task.status === 'running' && !this.closed) {
        const instrumentId = task.ids[task.nextIndex];
        try {
          const events = normalizeCorporateActions(instrumentId, await this.client.fetchEvents(instrumentId));
          if (this.closed || task.status !== 'running') break;
          // Event replacement and checkpoint commit together, including legitimate empty responses.
          this.db.exec('BEGIN');
          try {
            this.db.prepare('INSERT OR REPLACE INTO records VALUES (?, ?, ?)').run(instrumentId, JSON.stringify(events), stamp());
            task.nextIndex++;
            task.processed++;
            task.message = `已核对 ${task.processed} / ${task.total} 个品种`;
            this.save();
            this.db.exec('COMMIT');
          } catch (error) { this.db.exec('ROLLBACK'); throw error; }
          consecutiveFailures = 0;
        } catch (error) {
          if (this.closed || task.status !== 'running') break;
          task.failed.push({ instrumentId, error: error instanceof Error ? error.message : String(error) });
          task.nextIndex++;
          task.error = task.failed.at(-1).error;
          this.save();
          // Avoid spending hours retrying every symbol during a provider/dependency outage.
          if (++consecutiveFailures >= 3) break;
        }
      }
      if (!this.closed && task.status === 'running') {
        task.status = task.failed.length ? 'failed' : 'completed';
        task.message = task.failed.length ? '部分权息信息未能更新，已有记录已保留；可重试未完成品种。' : `权息信息已更新，已核对 ${task.processed} 个品种。`;
        if (task.status === 'completed') this.state.lastCompletedAt = stamp();
        this.save();
      }
    } catch (error) {
      if (!this.closed) {
        task.status = 'failed';
        task.error = error instanceof Error ? error.message : String(error);
        task.message = '权息更新未完成，可重试。';
        try { this.save(); } catch { /* Keep the last durable checkpoint on disk failure. */ }
      }
    } finally { this.running = false; }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.client.close();
    this.db?.close();
  }
}
