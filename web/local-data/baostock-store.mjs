import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { BaoStockClientPool } from "./baostock-client.mjs";
import {
  BAOSTOCK_ADJUSTFLAG,
  BAOSTOCK_ADJUSTMENT_TYPE,
  BAOSTOCK_SOURCE,
  aggregateMonthly,
  aggregateWeekly,
  baoStockCodeFromInstrumentId,
  cnPriceLimitRatio,
  coverageForCandles,
  dateTimestamp,
  normalizeBaoStockCatalog,
  normalizeBaoStockRows,
} from "./baostock.mjs";
import { screenLatestCandles } from "./pattern-scan.mjs";

const DAY_MS = 86_400_000;
const ASSET_KEYS = new Set(["stock", "index", "fund", "convertible-bond", "other"]);
const TIMEFRAMES = ["1d", "1w", "1mo"];
// BaoStock's official client is a single-socket C/S client. Do not expose a
// concurrency escape hatch: multiple sessions can trigger provider throttling
// or corrupt compressed responses even though each child process has its own
// socket.
const DEFAULT_HISTORY_CONCURRENCY = 1;
const MAX_HISTORY_CONCURRENCY = 1;

function nowValue(nowProvider) {
  return nowProvider().toISOString();
}

function dateText(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dateOffset(value, days) {
  const timestamp = dateTimestamp(value);
  return Number.isFinite(timestamp) ? dateText(timestamp + days * DAY_MS) : "";
}

function todayText(nowProvider) {
  return dateText(nowProvider().getTime());
}

function historyConcurrency(value) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_HISTORY_CONCURRENCY;
  return Math.min(MAX_HISTORY_CONCURRENCY, Math.max(1, parsed));
}

function sameValue(left, right) {
  if (left == null && right == null) return true;
  return Number.isFinite(Number(left)) && Number.isFinite(Number(right))
    && Math.abs(Number(left) - Number(right)) < 0.000001;
}

function sameCandle(left, right) {
  if (!left || !right) return false;
  return ["open", "high", "low", "close", "volume", "turnover"]
    .every((key) => sameValue(left[key], right[key]));
}

function writeJsonAtomic(target, value) {
  return mkdir(path.dirname(target), { recursive: true }).then(async () => {
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  });
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function safePlan(input = {}) {
  const assets = Array.isArray(input.assets)
    ? input.assets.filter((value) => ASSET_KEYS.has(value))
    : ["stock", "index"];
  return {
    source: "baostock",
    provider: "baostock",
    assets: assets.length ? [...new Set(assets)] : ["stock", "index"],
    includeDelisted: input.includeDelisted !== false,
    historyRange: ["all", "20y", "10y"].includes(input.historyRange) ? input.historyRange : "all",
    // BaoStock returns adjusted prices directly.  The local contract is fixed
    // to qfq so a caller cannot accidentally request an unadjusted series.
    adjustmentType: BAOSTOCK_ADJUSTMENT_TYPE,
  };
}

function progressFor(totalInstruments = 0) {
  return {
    downloadedBytes: 0,
    totalBytes: 0,
    processedFiles: 0,
    totalFiles: totalInstruments,
    indexedInstruments: 0,
    totalInstruments,
    processedInstruments: 0,
    receivedBars: 0,
    acceptedBars: 0,
    insertedBars: 0,
    correctedBars: 0,
    unchangedBars: 0,
    skippedInstruments: 0,
    invalidBars: 0,
    ignoredRows: 0,
    adjustmentProcessed: 0,
    adjustmentTotal: totalInstruments,
    adjustmentRows: 0,
    adjustmentMissing: 0,
  };
}

function assetSelected(assetType, planAssets) {
  return planAssets.includes(assetType)
    || (assetType === "convertible-bond" && planAssets.includes("convertible-bond"));
}

function normalizeCatalogForPlan(rows, plan) {
  const candidates = normalizeBaoStockCatalog(rows);
  return candidates.filter((instrument) => {
    if (!assetSelected(instrument.assetType, plan.assets)) return false;
    if (plan.includeDelisted) return true;
    return instrument.status === "1" || instrument.status === "";
  });
}

function coverageWithDefaults(instrument) {
  if (instrument.coverage && typeof instrument.coverage === "object") return instrument.coverage;
  const count = Math.max(0, Number(instrument.barCount) || 0);
  return {
    "1d": { barCount: count, firstTimestamp: instrument.firstTimestamp ?? 0, lastTimestamp: instrument.lastTimestamp ?? 0 },
    "1w": { barCount: count ? Math.ceil(count / 5) : 0, firstTimestamp: instrument.firstTimestamp ?? 0, lastTimestamp: instrument.lastTimestamp ?? 0 },
    "1mo": { barCount: count ? Math.ceil(count / 21) : 0, firstTimestamp: instrument.firstTimestamp ?? 0, lastTimestamp: instrument.lastTimestamp ?? 0 },
  };
}

export class BaoStockLocalStore {
  constructor(options = {}) {
    this.root = path.resolve(options.root ?? process.env.KLINE_DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".local-data"));
    this.nowProvider = options.nowProvider ?? (() => new Date());
    this.historyConcurrency = historyConcurrency(options.historyConcurrency ?? process.env.BAOSTOCK_CONCURRENCY);
    this.client = options.client ?? new BaoStockClientPool({
      poolSize: this.historyConcurrency,
      clientOptions: options.clientOptions,
    });
    this.dataDir = path.join(this.root, "baostock");
    this.dbFile = path.join(this.dataDir, "market.sqlite");
    this.manifestFile = path.join(this.dataDir, "manifest.json");
    // Keep BaoStock task state separate from the legacy TDX/Tushare store so
    // both providers can remain installed and selectable at the same time.
    this.taskFile = path.join(this.root, "baostock-task.json");
    this.catalogTaskFile = path.join(this.root, "baostock-catalog-task.json");
    this.maintenanceTaskFile = path.join(this.root, "baostock-cn-maintenance-task.json");
    this.db = null;
    this.task = null;
    this.catalogTask = null;
    this.maintenanceTask = null;
    this.manifestCache = undefined;
    this.running = false;
    this.maintenanceRunning = false;
    this.catalogRunning = false;
    this.abortController = null;
    this.maintenanceAbortController = null;
    this.lastPersistAt = 0;
  }

  async init() {
    await mkdir(this.root, { recursive: true });
    await mkdir(this.dataDir, { recursive: true });
    this.ensureDb();
    await this.loadTaskState();
    await this.loadCatalogTask();
    await this.loadMaintenanceTask();
    return this;
  }

  ensureDb() {
    if (this.db) return this.db;
    this.db = new DatabaseSync(this.dbFile);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS instruments (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        market TEXT NOT NULL,
        exchange TEXT NOT NULL,
        timezone TEXT NOT NULL,
        price_precision INTEGER NOT NULL,
        asset_type TEXT NOT NULL,
        baostock_code TEXT NOT NULL,
        status TEXT NOT NULL,
        first_timestamp INTEGER NOT NULL DEFAULT 0,
        last_timestamp INTEGER NOT NULL DEFAULT 0,
        bar_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS candles (
        instrument_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL,
        turnover REAL,
        adjustment_type TEXT NOT NULL,
        source TEXT NOT NULL,
        PRIMARY KEY (instrument_id, timestamp, adjustment_type)
      );
      CREATE INDEX IF NOT EXISTS candles_instrument_timestamp_idx
        ON candles(instrument_id, timestamp);
    `);
    return this.db;
  }

  async loadTaskState() {
    if (!(await exists(this.taskFile))) return;
    try {
      const task = JSON.parse(await readFile(this.taskFile, "utf8"));
      if (!String(task?.kind ?? "").startsWith("baostock-")) {
        await rm(this.taskFile, { force: true });
        return;
      }
      this.task = task;
      if (["running", "queued"].includes(this.task.status)) {
        this.task.status = "paused";
        this.task.message = "本地服务上次退出，BaoStock 任务已安全暂停，可继续。";
        await this.persistTask(true);
      }
    } catch {
      this.task = null;
    }
  }

  async loadCatalogTask() {
    if (!(await exists(this.catalogTaskFile))) return;
    try {
      this.catalogTask = JSON.parse(await readFile(this.catalogTaskFile, "utf8"));
      if (this.catalogTask.status === "running") {
        this.catalogTask.status = "paused";
        this.catalogTask.message = "BaoStock 名称目录更新因服务退出而暂停，可重新开始。";
        await writeJsonAtomic(this.catalogTaskFile, this.catalogTask);
      }
    } catch {
      this.catalogTask = null;
    }
  }

  async loadMaintenanceTask() {
    if (!(await exists(this.maintenanceTaskFile))) return;
    try {
      const task = JSON.parse(await readFile(this.maintenanceTaskFile, "utf8"));
      if (!String(task?.kind ?? "").startsWith("baostock-")) {
        await rm(this.maintenanceTaskFile, { force: true });
        return;
      }
      this.maintenanceTask = task;
      if (["running", "queued"].includes(this.maintenanceTask.status)) {
        this.maintenanceTask.status = "paused";
        this.maintenanceTask.message = "本地服务上次退出，BaoStock 维护任务已安全暂停，可继续。";
        await this.persistMaintenanceTask();
      }
    } catch {
      this.maintenanceTask = null;
    }
  }

  close() {
    this.abortController?.abort();
    this.maintenanceAbortController?.abort();
    this.client?.close?.();
    this.db?.close();
    this.db = null;
  }

  getTask() {
    return this.task;
  }

  getCatalogTask() {
    return this.catalogTask;
  }

  getCnMaintenanceTask() {
    return this.maintenanceTask;
  }

  async getManifest() {
    if (this.manifestCache !== undefined) return this.manifestCache;
    if (!(await exists(this.manifestFile))) return null;
    try {
      this.manifestCache = JSON.parse(await readFile(this.manifestFile, "utf8"));
      return this.manifestCache;
    } catch {
      this.manifestCache = null;
      return null;
    }
  }

  async getDatasetStatus() {
    const manifest = await this.getManifest();
    if (!manifest) return null;
    return {
      source: "baostock",
      adjustmentType: BAOSTOCK_ADJUSTMENT_TYPE,
      adjustmentStatus: manifest.adjustmentStatus ?? "ready",
      adjustmentSource: "baostock-adjustflag-2",
      adjustmentUpdatedAt: manifest.adjustmentUpdatedAt ?? manifest.updatedAt ?? null,
      factorCount: 0,
    };
  }

  async resetData() {
    this.ensureDb().exec("DELETE FROM candles; DELETE FROM instruments;");
    this.manifestCache = null;
    await rm(this.manifestFile, { force: true });
  }

  async persistTask(force = false) {
    if (!this.task) return;
    const current = Date.now();
    if (!force && current - this.lastPersistAt < 250) return;
    this.lastPersistAt = current;
    this.task.updatedAt = nowValue(this.nowProvider);
    await writeJsonAtomic(this.taskFile, this.task);
  }

  async persistMaintenanceTask() {
    if (!this.maintenanceTask) return;
    this.maintenanceTask.updatedAt = nowValue(this.nowProvider);
    await writeJsonAtomic(this.maintenanceTaskFile, this.maintenanceTask);
  }

  async persistManifest(manifest) {
    manifest.updatedAt = nowValue(this.nowProvider);
    await writeJsonAtomic(this.manifestFile, manifest);
    this.manifestCache = manifest;
  }

  historyStartDate(instrument, historyRange) {
    if (historyRange === "all") return dateText(Number(instrument.firstTimestamp) || Date.UTC(1990, 0, 1));
    const years = historyRange === "20y" ? 20 : 10;
    const date = this.nowProvider();
    return `${date.getUTCFullYear() - years}-01-01`;
  }

  assertRunning(task = this.task) {
    if (!task || task.status !== "running") {
      const error = new Error("BaoStock 任务已暂停");
      error.name = "AbortError";
      throw error;
    }
  }

  async createTask(plan) {
    if (this.running || ["queued", "running"].includes(this.task?.status)) {
      throw new Error("已有 BaoStock 初始化任务正在运行");
    }
    const normalizedPlan = safePlan(plan);
    await this.resetData();
    this.task = {
      id: `baostock_${randomUUID()}`,
      kind: "baostock-full-daily",
      status: "queued",
      stage: "cataloging",
      plan: normalizedPlan,
      nextInstrumentIndex: 0,
      catalogReady: false,
      progress: progressFor(0),
      message: "任务已创建，准备读取 BaoStock 品种目录。",
      error: null,
      createdAt: nowValue(this.nowProvider),
      updatedAt: nowValue(this.nowProvider),
    };
    await this.persistTask(true);
    queueMicrotask(() => void this.runTask());
    return this.task;
  }

  async pauseTask() {
    if (!this.task || !["queued", "running"].includes(this.task.status)) return this.task;
    this.task.status = "paused";
    this.task.message = "正在安全暂停；已写入的 BaoStock 行情和进度会保留。";
    this.abortController?.abort();
    await this.persistTask(true);
    return this.task;
  }

  async resumeTask() {
    if (!this.task || !["paused", "failed"].includes(this.task.status)) return this.task;
    this.task.status = "queued";
    this.task.error = null;
    this.task.message = "BaoStock 任务已恢复。";
    await this.persistTask(true);
    queueMicrotask(() => void this.runTask());
    return this.task;
  }

  async deleteTask({ removeData = false } = {}) {
    await this.pauseTask();
    this.task = null;
    await rm(this.taskFile, { force: true });
    if (removeData) await this.resetData();
  }

  async fetchCatalog() {
    return normalizeCatalogForPlan(await this.client.queryCatalog(), this.task.plan);
  }

  createManifest(instruments, plan) {
    return {
      schemaVersion: 1,
      source: "baostock",
      sourceVersion: "query_history_k_data_plus",
      adjustmentType: BAOSTOCK_ADJUSTMENT_TYPE,
      adjustmentStatus: "building",
      adjustmentSource: "baostock-adjustflag-2",
      adjustmentUpdatedAt: nowValue(this.nowProvider),
      factorCount: 0,
      datasetVersion: `baostock-${Date.now()}`,
      createdAt: nowValue(this.nowProvider),
      updatedAt: nowValue(this.nowProvider),
      historyRange: plan.historyRange,
      assets: plan.assets,
      includeDelisted: plan.includeDelisted,
      maintenanceSource: "baostock-query_history_k_data_plus",
      instruments,
    };
  }

  insertCatalogInstruments(instruments) {
    const db = this.ensureDb();
    const statement = db.prepare(`INSERT INTO instruments
      (id, symbol, name, market, exchange, timezone, price_precision,
       asset_type, baostock_code, status, first_timestamp, last_timestamp,
       bar_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        symbol = excluded.symbol, name = excluded.name, market = excluded.market,
        exchange = excluded.exchange, timezone = excluded.timezone,
        price_precision = excluded.price_precision, asset_type = excluded.asset_type,
        baostock_code = excluded.baostock_code, status = excluded.status,
        first_timestamp = excluded.first_timestamp, updated_at = excluded.updated_at`);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const instrument of instruments) {
        statement.run(
          instrument.id,
          instrument.symbol,
          instrument.name,
          instrument.market,
          instrument.exchange,
          instrument.timezone,
          instrument.pricePrecision,
          instrument.assetType,
          instrument.baostockCode,
          instrument.status,
          instrument.firstTimestamp,
          instrument.lastTimestamp,
          instrument.barCount,
          nowValue(this.nowProvider),
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  readDaily(instrumentId, startTimestamp = Number.NEGATIVE_INFINITY) {
    const query = Number.isFinite(startTimestamp)
      ? `SELECT timestamp, open, high, low, close, volume, turnover
        FROM candles WHERE instrument_id = ? AND adjustment_type = ? AND timestamp >= ?
        ORDER BY timestamp ASC`
      : `SELECT timestamp, open, high, low, close, volume, turnover
        FROM candles WHERE instrument_id = ? AND adjustment_type = ?
        ORDER BY timestamp ASC`;
    const params = Number.isFinite(startTimestamp)
      ? [instrumentId, BAOSTOCK_ADJUSTMENT_TYPE, startTimestamp]
      : [instrumentId, BAOSTOCK_ADJUSTMENT_TYPE];
    const rows = this.ensureDb().prepare(query).all(...params);
    return rows.map((row) => ({
      timestamp: Number(row.timestamp),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: row.volume == null ? null : Number(row.volume),
      turnover: row.turnover == null ? null : Number(row.turnover),
    }));
  }

  writeDaily(instrumentId, candles) {
    if (!candles.length) return { inserted: 0, corrected: 0, unchanged: 0 };
    const db = this.ensureDb();
    const select = db.prepare(`SELECT open, high, low, close, volume, turnover
      FROM candles WHERE instrument_id = ? AND timestamp = ? AND adjustment_type = ?`);
    const upsert = db.prepare(`INSERT INTO candles
      (instrument_id, timestamp, open, high, low, close, volume, turnover, adjustment_type, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(instrument_id, timestamp, adjustment_type) DO UPDATE SET
        open = excluded.open, high = excluded.high, low = excluded.low,
        close = excluded.close, volume = excluded.volume, turnover = excluded.turnover,
        source = excluded.source`);
    let inserted = 0;
    let corrected = 0;
    let unchanged = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const candle of candles) {
        const current = select.get(instrumentId, candle.timestamp, BAOSTOCK_ADJUSTMENT_TYPE);
        if (!current) inserted += 1;
        else if (sameCandle(current, candle)) unchanged += 1;
        else corrected += 1;
        upsert.run(
          instrumentId,
          candle.timestamp,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume,
          candle.turnover,
          BAOSTOCK_ADJUSTMENT_TYPE,
          BAOSTOCK_SOURCE,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { inserted, corrected, unchanged };
  }

  updateInstrumentMetadata(manifest, instrument) {
    const daily = this.readDaily(instrument.id);
    const coverage = coverageForCandles(daily);
    instrument.barCount = daily.length;
    instrument.firstTimestamp = daily[0]?.timestamp ?? instrument.firstTimestamp ?? 0;
    instrument.lastTimestamp = daily.at(-1)?.timestamp ?? 0;
    instrument.coverage = coverage;
    instrument.timeframes = daily.length ? [...TIMEFRAMES] : [];
    instrument.source = BAOSTOCK_SOURCE;
    this.ensureDb().prepare(`UPDATE instruments SET first_timestamp = ?, last_timestamp = ?,
      bar_count = ?, name = ?, status = ?, updated_at = ? WHERE id = ?`).run(
      instrument.firstTimestamp,
      instrument.lastTimestamp,
      instrument.barCount,
      instrument.name,
      instrument.status,
      nowValue(this.nowProvider),
      instrument.id,
    );
    manifest.instruments = manifest.instruments.map((item) => item.id === instrument.id ? instrument : item);
    return daily;
  }

  async downloadInstrument(manifest, instrument, plan) {
    const rows = await this.client.queryHistory({
      code: instrument.baostockCode ?? baoStockCodeFromInstrumentId(instrument.id),
      startDate: this.historyStartDate(instrument, plan.historyRange),
      endDate: todayText(this.nowProvider),
      frequency: "d",
      adjustflag: BAOSTOCK_ADJUSTFLAG,
    });
    this.assertRunning();
    const normalized = normalizeBaoStockRows(rows);
    const stats = this.writeDaily(instrument.id, normalized.candles);
    this.updateInstrumentMetadata(manifest, instrument);
    return { report: normalized.report, stats, hasData: normalized.candles.length > 0 };
  }

  async runTask() {
    if (this.running || !this.task || !["queued", "running"].includes(this.task.status)) return;
    this.running = true;
    this.task.status = "running";
    this.task.error = null;
    this.abortController = new AbortController();
    try {
      let manifest = await this.getManifest();
      if (!manifest || !this.task.catalogReady) {
        this.task.stage = "cataloging";
        this.task.message = "正在读取 BaoStock 品种目录，不使用旧 TDX 文件。";
        await this.persistTask(true);
        const instruments = await this.fetchCatalog();
        if (!instruments.length) throw new Error("BaoStock 未返回符合当前方案的 A 股品种，请检查 BaoStock 安装和方案范围");
        manifest = this.createManifest(instruments, this.task.plan);
        this.insertCatalogInstruments(instruments);
        this.task.catalogReady = true;
        this.task.progress = progressFor(instruments.length);
        this.task.progress.indexedInstruments = 0;
        await this.persistManifest(manifest);
        await this.persistTask(true);
      }

      const instruments = manifest.instruments;
      this.task.progress.totalInstruments = instruments.length;
      this.task.progress.totalFiles = instruments.length;
      const startIndex = Number(this.task.nextInstrumentIndex) || 0;
      for (let index = startIndex; index < instruments.length; index += this.historyConcurrency) {
        this.assertRunning();
        const batch = instruments.slice(index, index + this.historyConcurrency);
        const batchEnd = index + batch.length;
        this.task.stage = "downloading";
        this.task.message = `串行读取 BaoStock 前复权日线（${index + 1} - ${batchEnd} / ${instruments.length}，单会话）。`;
        await this.persistTask(true);
        const results = [];
        for (const instrument of batch) {
          results.push(await this.downloadInstrument(manifest, instrument, this.task.plan));
        }
        this.assertRunning();
        for (const result of results) {
          this.task.progress.receivedBars += result.report.received;
          this.task.progress.acceptedBars += result.report.accepted;
          this.task.progress.invalidBars += result.report.invalid;
          this.task.progress.insertedBars += result.stats.inserted;
          this.task.progress.correctedBars += result.stats.corrected;
          this.task.progress.unchangedBars += result.stats.unchanged;
          if (!result.hasData) this.task.progress.skippedInstruments += 1;
        }
        this.task.progress.processedFiles = batchEnd;
        this.task.progress.processedInstruments = batchEnd;
        this.task.progress.indexedInstruments = batchEnd;
        this.task.nextInstrumentIndex = batchEnd;
        manifest.datasetVersion = `baostock-${Date.now()}`;
        await this.persistManifest(manifest);
        await this.persistTask(true);
      }
      manifest.adjustmentStatus = "ready";
      manifest.adjustmentType = BAOSTOCK_ADJUSTMENT_TYPE;
      manifest.adjustmentSource = "baostock-adjustflag-2";
      manifest.adjustmentUpdatedAt = nowValue(this.nowProvider);
      manifest.datasetVersion = `baostock-${Date.now()}`;
      await this.persistManifest(manifest);
      this.task.status = "completed";
      this.task.stage = "completed";
      this.task.message = `BaoStock 初始化完成：已处理 ${instruments.length.toLocaleString()} 个品种，训练统一使用前复权价格。`;
      await this.persistTask(true);
    } catch (error) {
      if (this.task?.status === "paused" || error?.name === "AbortError") {
        if (this.task) {
          this.task.status = "paused";
          this.task.message = "BaoStock 任务已暂停，继续时将从已有进度恢复。";
          await this.persistTask(true);
        }
      } else if (this.task) {
        this.task.status = "failed";
        this.task.error = error instanceof Error ? error.message : String(error);
        this.task.message = "BaoStock 初始化失败；已保留可恢复进度。";
        await this.persistTask(true);
      }
    } finally {
      this.abortController = null;
      this.running = false;
    }
  }

  async startCatalogRefresh() {
    if (this.catalogRunning || ["queued", "running"].includes(this.catalogTask?.status)) {
      throw new Error("BaoStock 名称目录更新已经在运行");
    }
    this.catalogTask = {
      id: `baostock_catalog_${randomUUID()}`,
      kind: "baostock-catalog-refresh",
      status: "queued",
      message: "准备读取 BaoStock 最新品种名称。",
      error: null,
      progress: { processed: 0, total: 0, updated: 0 },
      createdAt: nowValue(this.nowProvider),
      updatedAt: nowValue(this.nowProvider),
    };
    await writeJsonAtomic(this.catalogTaskFile, this.catalogTask);
    queueMicrotask(() => void this.runCatalogRefresh());
    return this.catalogTask;
  }

  async runCatalogRefresh() {
    if (this.catalogRunning || !this.catalogTask) return;
    this.catalogRunning = true;
    this.catalogTask.status = "running";
    try {
      const manifest = await this.getManifest();
      if (!manifest) throw new Error("请先完成 BaoStock A 股初始化");
      const latest = new Map(normalizeBaoStockCatalog(await this.client.queryCatalog()).map((item) => [item.id, item]));
      this.catalogTask.progress.total = manifest.instruments.length;
      for (const instrument of manifest.instruments) {
        const current = latest.get(instrument.id);
        if (current?.name && current.name !== instrument.name) {
          instrument.name = current.name;
          this.catalogTask.progress.updated += 1;
          this.ensureDb().prepare("UPDATE instruments SET name = ?, updated_at = ? WHERE id = ?")
            .run(instrument.name, nowValue(this.nowProvider), instrument.id);
        }
        this.catalogTask.progress.processed += 1;
      }
      await this.persistManifest(manifest);
      this.catalogTask.status = "completed";
      this.catalogTask.message = `BaoStock 名称目录更新完成：已检查 ${this.catalogTask.progress.total.toLocaleString()} 个品种。`;
      await writeJsonAtomic(this.catalogTaskFile, this.catalogTask);
    } catch (error) {
      this.catalogTask.status = "failed";
      this.catalogTask.error = error instanceof Error ? error.message : String(error);
      this.catalogTask.message = "BaoStock 名称目录更新失败。";
      await writeJsonAtomic(this.catalogTaskFile, this.catalogTask);
    } finally {
      this.catalogRunning = false;
    }
  }

  async getInstruments() {
    const manifest = await this.getManifest();
    return (manifest?.instruments ?? [])
      .filter((instrument) => Number(instrument.barCount) > 0)
      .map((instrument) => ({
        ...instrument,
        timeframes: instrument.timeframes?.length ? instrument.timeframes : [...TIMEFRAMES],
        adjustmentType: BAOSTOCK_ADJUSTMENT_TYPE,
        source: BAOSTOCK_SOURCE,
      }));
  }

  async getCoverage({ offset = 0, limit = 100, query = "" } = {}) {
    const manifest = await this.getManifest();
    if (!manifest) return { coverage: [], total: 0, summary: { instrumentCount: 0, barCount: 0, timeframes: [] } };
    const normalizedQuery = String(query).trim().toLowerCase();
    const instruments = manifest.instruments.filter((instrument) => Number(instrument.barCount) > 0 && (
      !normalizedQuery
      || instrument.id.toLowerCase().includes(normalizedQuery)
      || instrument.name.toLowerCase().includes(normalizedQuery)
      || "baostock".includes(normalizedQuery)
      || "前复权".includes(normalizedQuery)
    ));
    const all = instruments.flatMap((instrument) => TIMEFRAMES.map((timeframe) => {
      const item = coverageWithDefaults(instrument)[timeframe] ?? {};
      return {
        id: instrument.id,
        symbol: instrument.symbol,
        name: instrument.name,
        market: "CN",
        timezone: instrument.timezone,
        pricePrecision: instrument.pricePrecision,
        assetType: instrument.assetType,
        timeframe,
        barCount: Number(item.barCount ?? 0),
        firstTimestamp: Number(item.firstTimestamp ?? 0),
        lastTimestamp: Number(item.lastTimestamp ?? 0),
        adjustmentType: BAOSTOCK_ADJUSTMENT_TYPE,
        source: BAOSTOCK_SOURCE,
        datasetVersion: manifest.datasetVersion,
      };
    }));
    const safeOffset = Math.max(0, Math.trunc(Number(offset) || 0));
    const safeLimit = Math.min(500, Math.max(1, Math.trunc(Number(limit) || 100)));
    return {
      coverage: all.slice(safeOffset, safeOffset + safeLimit),
      total: all.length,
      summary: {
        instrumentCount: instruments.length,
        barCount: all.reduce((sum, item) => sum + item.barCount, 0),
        timeframes: [...TIMEFRAMES],
      },
    };
  }

  async getCandles(instrumentId, timeframe = "1d") {
    if (!TIMEFRAMES.includes(timeframe)) return null;
    const manifest = await this.getManifest();
    const instrument = manifest?.instruments.find((item) => item.id === instrumentId);
    if (!instrument || Number(instrument.barCount) <= 0) return null;
    const daily = this.readDaily(instrumentId);
    if (!daily.length) return null;
    const candles = timeframe === "1w"
      ? aggregateWeekly(daily)
      : timeframe === "1mo"
        ? aggregateMonthly(daily)
        : daily;
    return {
      instrument: {
        id: instrument.id,
        symbol: instrument.symbol,
        name: instrument.name,
        market: "CN",
        timezone: instrument.timezone,
        pricePrecision: instrument.pricePrecision,
        assetType: instrument.assetType,
      },
      timeframe,
      adjustmentType: BAOSTOCK_ADJUSTMENT_TYPE,
      source: BAOSTOCK_SOURCE,
      datasetVersion: manifest.datasetVersion,
      candles,
    };
  }

  async getLatestCandles(instrumentIds = [], entryAfter = {}) {
    const manifest = await this.getManifest();
    if (!manifest) return [];
    const requested = new Set(instrumentIds.map((value) => String(value)).filter(Boolean));
    const output = [];
    for (const instrument of manifest.instruments.filter((item) => requested.has(item.id))) {
      const latest = this.ensureDb().prepare(`SELECT timestamp, open, close
        FROM candles WHERE instrument_id = ? AND adjustment_type = ?
        ORDER BY timestamp DESC LIMIT 1`).get(instrument.id, BAOSTOCK_ADJUSTMENT_TYPE);
      if (!latest) continue;
      const after = Number(entryAfter?.[instrument.id]);
      const entry = Number.isFinite(after)
        ? this.ensureDb().prepare(`SELECT timestamp, open FROM candles
            WHERE instrument_id = ? AND adjustment_type = ? AND timestamp > ?
            ORDER BY timestamp ASC LIMIT 1`).get(instrument.id, BAOSTOCK_ADJUSTMENT_TYPE, after)
        : null;
      output.push({
        instrumentId: instrument.id,
        timestamp: Number(latest.timestamp),
        open: Number(latest.open),
        close: Number(latest.close),
        ...(entry ? { entryTimestamp: Number(entry.timestamp), entryOpen: Number(entry.open) } : {}),
      });
    }
    return output;
  }

  async scanLatest({ presets = [], filters = {}, limit = 100, sort = "turnover" } = {}) {
    const manifest = await this.getManifest();
    if (!manifest) throw new Error("请先完成 BaoStock A 股全市场前复权初始化");
    const stocks = manifest.instruments.filter((instrument) => instrument.assetType === "stock" && Number(instrument.barCount) > 0);
    const latestTimestamp = stocks.reduce((maximum, instrument) => Math.max(maximum, Number(instrument.lastTimestamp) || 0), 0);
    const results = [];
    for (const instrument of stocks) {
      if (Number(instrument.lastTimestamp) < latestTimestamp - 3 * DAY_MS) continue;
      const candles = this.readDaily(instrument.id, latestTimestamp - 420 * DAY_MS);
      const scanFilters = filters.excludeLimitUp
        ? { ...filters, limitUpRatio: cnPriceLimitRatio(instrument.id), priceTick: 0.01 }
        : filters;
      const match = screenLatestCandles(candles, presets, scanFilters);
      if (!match || match.timestamp !== latestTimestamp) continue;
      results.push({ instrumentId: instrument.id, symbol: instrument.symbol, name: instrument.name, market: "CN", ...match });
    }
    const sortKey = sort === "change" ? "changePct" : sort === "volume" ? "averageVolume" : "averageTurnover";
    results.sort((left, right) => Number(right[sortKey]) - Number(left[sortKey]));
    const resultLimit = Number(limit);
    return {
      market: "CN",
      latestTimestamp,
      scannedCount: stocks.length,
      matchedCount: results.length,
      results: resultLimit === 0
        ? results
        : results.slice(0, Math.min(500, Math.max(1, resultLimit || 100))),
    };
  }

  async deleteInstruments(instrumentIds) {
    const manifest = await this.getManifest();
    if (!manifest) return { deletedInstruments: 0, instrumentIds: [] };
    const targets = new Set((instrumentIds ?? []).map((value) => String(value)).filter(Boolean));
    const deleted = manifest.instruments.filter((instrument) => targets.has(instrument.id)).map((instrument) => instrument.id);
    if (!deleted.length) return { deletedInstruments: 0, instrumentIds: [] };
    const db = this.ensureDb();
    const removeCandles = db.prepare("DELETE FROM candles WHERE instrument_id = ?");
    const removeInstrument = db.prepare("DELETE FROM instruments WHERE id = ?");
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const id of deleted) {
        removeCandles.run(id);
        removeInstrument.run(id);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    manifest.instruments = manifest.instruments.filter((instrument) => !targets.has(instrument.id));
    manifest.datasetVersion = `baostock-${Date.now()}-edit`;
    await this.persistManifest(manifest);
    return { deletedInstruments: deleted.length, instrumentIds: deleted };
  }

  async startCnMaintenance({ mode = "incremental", repairDays = 30 } = {}) {
    if (![
      "incremental",
      "repair",
    ].includes(mode)) throw new Error("不支持的 A 股维护模式");
    if (this.maintenanceRunning || ["queued", "running"].includes(this.maintenanceTask?.status)) {
      throw new Error("已有 A 股 BaoStock 维护任务正在运行");
    }
    const manifest = await this.getManifest();
    if (!manifest || manifest.adjustmentStatus !== "ready") {
      throw new Error("请先完成 BaoStock A 股全市场前复权初始化");
    }
    const days = Math.min(120, Math.max(7, Math.trunc(Number(repairDays) || 30)));
    const stocks = manifest.instruments.filter((instrument) => instrument.assetType === "stock");
    const progress = {
      processedDates: 0,
      totalDates: stocks.length,
      receivedRows: 0,
      acceptedRows: 0,
      insertedBars: 0,
      correctedBars: 0,
      unchangedBars: 0,
      factorRows: 0,
      ignoredRows: 0,
      invalidRows: 0,
      processedInstruments: 0,
      totalInstruments: stocks.length,
    };
    this.maintenanceTask = {
      id: `baostock_maintenance_${randomUUID()}`,
      kind: "baostock-cn-daily-maintenance",
      mode,
      status: "queued",
      message: mode === "repair" ? `准备使用 BaoStock 回查最近 ${days} 个自然日。` : "准备使用 BaoStock 检查 A 股前复权增量。",
      error: null,
      repairDays: days,
      nextInstrumentIndex: 0,
      nextDateIndex: 0,
      progress,
      createdAt: nowValue(this.nowProvider),
      updatedAt: nowValue(this.nowProvider),
    };
    await this.persistMaintenanceTask();
    queueMicrotask(() => void this.runCnMaintenance());
    return this.maintenanceTask;
  }

  async pauseCnMaintenance() {
    if (!this.maintenanceTask || !["queued", "running"].includes(this.maintenanceTask.status)) return this.maintenanceTask;
    this.maintenanceTask.status = "paused";
    this.maintenanceTask.message = "BaoStock 维护任务已暂停；已写入的行情和游标会保留。";
    this.maintenanceAbortController?.abort();
    await this.persistMaintenanceTask();
    return this.maintenanceTask;
  }

  async resumeCnMaintenance() {
    if (!this.maintenanceTask || !["paused", "failed"].includes(this.maintenanceTask.status)) return this.maintenanceTask;
    this.maintenanceTask.status = "queued";
    this.maintenanceTask.error = null;
    this.maintenanceTask.message = "BaoStock 维护任务已恢复。";
    await this.persistMaintenanceTask();
    queueMicrotask(() => void this.runCnMaintenance());
    return this.maintenanceTask;
  }

  async runCnMaintenance() {
    if (this.maintenanceRunning || !this.maintenanceTask || !["queued", "running"].includes(this.maintenanceTask.status)) return;
    this.maintenanceRunning = true;
    this.maintenanceAbortController = new AbortController();
    this.maintenanceTask.status = "running";
    try {
      const manifest = await this.getManifest();
      const stocks = (manifest?.instruments ?? []).filter((instrument) => instrument.assetType === "stock");
      const today = todayText(this.nowProvider);
      for (let index = Number(this.maintenanceTask.nextInstrumentIndex) || 0; index < stocks.length; index += 1) {
        if (this.maintenanceTask.status !== "running") {
          const error = new Error("BaoStock 维护任务已暂停");
          error.name = "AbortError";
          throw error;
        }
        const instrument = stocks[index];
        const startDate = this.maintenanceTask.mode === "repair"
          ? dateOffset(today, -(this.maintenanceTask.repairDays - 1))
          : dateOffset(dateText(Number(instrument.lastTimestamp) || Date.UTC(1990, 0, 1)), 1);
        this.maintenanceTask.message = `正在读取 ${instrument.id} 的 BaoStock 前复权增量（${index + 1} / ${stocks.length}）。`;
        await this.persistMaintenanceTask();
        if (startDate <= today) {
          const rows = await this.client.queryHistory({
            code: instrument.baostockCode ?? baoStockCodeFromInstrumentId(instrument.id),
            startDate,
            endDate: today,
            frequency: "d",
            adjustflag: BAOSTOCK_ADJUSTFLAG,
          });
          const normalized = normalizeBaoStockRows(rows);
          const stats = this.writeDaily(instrument.id, normalized.candles);
          this.updateInstrumentMetadata(manifest, instrument);
          this.maintenanceTask.progress.receivedRows += normalized.report.received;
          this.maintenanceTask.progress.acceptedRows += normalized.report.accepted;
          this.maintenanceTask.progress.invalidRows += normalized.report.invalid;
          this.maintenanceTask.progress.insertedBars += stats.inserted;
          this.maintenanceTask.progress.correctedBars += stats.corrected;
          this.maintenanceTask.progress.unchangedBars += stats.unchanged;
        }
        this.maintenanceTask.nextInstrumentIndex = index + 1;
        this.maintenanceTask.nextDateIndex = index + 1;
        this.maintenanceTask.progress.processedInstruments = index + 1;
        this.maintenanceTask.progress.processedDates = index + 1;
        manifest.datasetVersion = `baostock-${Date.now()}`;
        await this.persistManifest(manifest);
        await this.persistMaintenanceTask();
      }
      this.maintenanceTask.status = "completed";
      this.maintenanceTask.message = this.maintenanceTask.mode === "repair"
        ? `BaoStock 缺口回查完成：补入 ${this.maintenanceTask.progress.insertedBars.toLocaleString()} 根，校正 ${this.maintenanceTask.progress.correctedBars.toLocaleString()} 根。`
        : `BaoStock 增量检查完成：新增 ${this.maintenanceTask.progress.insertedBars.toLocaleString()} 根，校正 ${this.maintenanceTask.progress.correctedBars.toLocaleString()} 根。`;
      await this.persistMaintenanceTask();
    } catch (error) {
      if (this.maintenanceTask?.status === "paused" || error?.name === "AbortError") {
        if (this.maintenanceTask) {
          this.maintenanceTask.status = "paused";
          this.maintenanceTask.message = "BaoStock 维护任务已暂停，继续时会从尚未完成的品种恢复。";
          await this.persistMaintenanceTask();
        }
      } else if (this.maintenanceTask) {
        this.maintenanceTask.status = "failed";
        this.maintenanceTask.error = error instanceof Error ? error.message : String(error);
        this.maintenanceTask.message = "BaoStock A 股数据维护失败；已经完成的品种和写入内容均已保留。";
        await this.persistMaintenanceTask();
      }
    } finally {
      this.maintenanceAbortController = null;
      this.maintenanceRunning = false;
    }
  }

  async getLatestClosedTradeDate() {
    const current = this.nowProvider();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(current);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const today = `${values.year}-${values.month}-${values.day}`;
    const cutoff = Number(values.hour) * 60 + Number(values.minute) >= 930 ? today : dateOffset(today, -1);
    const dates = await this.client.queryTradeDates({ startDate: dateOffset(cutoff, -90), endDate: cutoff });
    const available = (Array.isArray(dates) ? dates : [])
      .filter((row) => String(row?.is_trading_day ?? row?.is_open ?? "") === "1")
      .map((row) => String(row?.calendar_date ?? row?.cal_date ?? "").slice(0, 10))
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= cutoff)
      .sort();
    return available.at(-1) ?? null;
  }
}
