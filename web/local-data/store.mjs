import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import unzipper from "unzipper";
import {
  aggregateWeekly,
  classifyTdxInstrument,
  fallbackInstrumentName,
  instrumentIdFromEntry,
  parseTdxDayBuffer,
  TDX_DAY_RECORD_SIZE,
} from "./tdx-day.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE_URL = "https://data.tdx.com.cn/vipdoc/hsjday.zip";
const DEFAULT_TUSHARE_URL = "https://api.tushare.pro";
const ASSET_KEYS = new Set(["stock", "index", "fund", "convertible-bond", "other"]);
const DAY_MS = 86_400_000;

function now() {
  return new Date().toISOString();
}

function compactDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10).replaceAll("-", "");
}

function displayDate(value) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function timestampFromCompactDate(value) {
  if (!/^\d{8}$/.test(String(value))) return Number.NaN;
  return Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
}

function weekdayDates(startTimestamp, endTimestamp) {
  const dates = [];
  for (let value = startTimestamp; value <= endTimestamp; value += DAY_MS) {
    const day = new Date(value).getUTCDay();
    if (day !== 0 && day !== 6) dates.push(compactDate(value));
  }
  return dates;
}

function sameCandle(left, right) {
  if (!left || !right) return false;
  const keys = ["open", "high", "low", "close", "volume", "turnover"];
  return keys.every((key) => {
    if (left[key] == null && right[key] == null) return true;
    return Math.abs(Number(left[key]) - Number(right[key])) < 0.000001;
  });
}

export function normalizeTushareDailyRows(payload) {
  if (payload?.code !== 0) throw new Error(payload?.msg || `Tushare 返回错误 ${payload?.code ?? "unknown"}`);
  const fields = Array.isArray(payload?.data?.fields) ? payload.data.fields : [];
  const items = Array.isArray(payload?.data?.items) ? payload.data.items : [];
  if (items.length >= 6000) {
    throw new Error("Tushare 单日返回达到 6000 行上限，为避免截断，本日未写入");
  }
  const rows = [];
  let invalid = 0;
  for (const item of items) {
    const row = Object.fromEntries(fields.map((field, index) => [field, item[index]]));
    const instrumentId = String(row.ts_code ?? "").toUpperCase();
    const timestamp = timestampFromCompactDate(String(row.trade_date ?? ""));
    const candle = {
      timestamp,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: row.vol == null ? null : Number(row.vol) * 100,
      turnover: row.amount == null ? null : Number(row.amount) * 1000,
    };
    const valid = (
      /^\d{6}\.(SH|SZ|BJ)$/.test(instrumentId)
      && Number.isFinite(timestamp)
      && Number.isFinite(candle.open)
      && Number.isFinite(candle.high)
      && Number.isFinite(candle.low)
      && Number.isFinite(candle.close)
      && candle.low > 0
      && candle.low <= Math.min(candle.open, candle.close)
      && candle.high >= Math.max(candle.open, candle.close)
    );
    if (!valid) {
      invalid += 1;
      continue;
    }
    rows.push({ instrumentId, ...candle });
  }
  return { rows, received: items.length, invalid };
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonAtomic(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, target);
}

async function fileSha256(target) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  return hash.digest("hex");
}

function safePlan(input = {}) {
  const assets = Array.isArray(input.assets)
    ? input.assets.filter((item) => ASSET_KEYS.has(item))
    : ["stock", "index"];
  return {
    assets: assets.length ? [...new Set(assets)] : ["stock", "index"],
    includeDelisted: input.includeDelisted !== false,
    historyRange: ["all", "20y", "10y"].includes(input.historyRange) ? input.historyRange : "all",
    keepRawPackage: Boolean(input.keepRawPackage),
  };
}

export class TdxLocalStore {
  constructor(options = {}) {
    this.root = path.resolve(options.root ?? process.env.KLINE_DATA_DIR ?? path.join(moduleDir, "..", ".local-data"));
    this.sourceUrl = options.sourceUrl ?? process.env.TDX_DAY_ZIP_URL ?? DEFAULT_SOURCE_URL;
    this.tushareUrl = options.tushareUrl ?? process.env.TUSHARE_API_URL ?? DEFAULT_TUSHARE_URL;
    this.fetcher = options.fetcher ?? fetch;
    this.nowProvider = options.nowProvider ?? (() => new Date());
    this.tushareThrottleMs = options.tushareThrottleMs ?? 1400;
    this.autoRefreshCatalog = options.autoRefreshCatalog ?? this.sourceUrl === DEFAULT_SOURCE_URL;
    this.taskFile = path.join(this.root, "task.json");
    this.catalogTaskFile = path.join(this.root, "catalog-task.json");
    this.maintenanceTaskFile = path.join(this.root, "cn-maintenance-task.json");
    this.manifestFile = path.join(this.root, "tdx", "manifest.json");
    this.overlayDbFile = path.join(this.root, "tdx", "tushare-overlay.sqlite");
    this.catalogFile = path.join(this.root, "catalog.json");
    this.packageFile = path.join(this.root, "packages", "hsjday.zip");
    this.partialPackageFile = `${this.packageFile}.part`;
    this.dataDir = path.join(this.root, "tdx", "day");
    this.task = null;
    this.catalogTask = null;
    this.maintenanceTask = null;
    this.overlayDb = null;
    this.running = false;
    this.maintenanceRunning = false;
    this.abortController = null;
    this.maintenanceAbortController = null;
    this.lastPersistAt = 0;
    this.manifestCache = undefined;
  }

  async init() {
    await mkdir(this.root, { recursive: true });
    if (await exists(this.taskFile)) {
      try {
        this.task = JSON.parse(await readFile(this.taskFile, "utf8"));
        if (this.task.status === "running" || this.task.status === "queued") {
          this.task.status = "paused";
          this.task.message = "本地服务上次退出，任务已安全暂停，可继续。";
          this.task.updatedAt = now();
          await this.persistTask(true);
        }
      } catch {
        this.task = null;
      }
    }
    if (await exists(this.catalogTaskFile)) {
      try {
        this.catalogTask = JSON.parse(await readFile(this.catalogTaskFile, "utf8"));
        if (this.catalogTask.status === "running") {
          this.catalogTask.status = "paused";
          this.catalogTask.message = "名称更新因服务退出而暂停，可重新开始。";
          await writeJsonAtomic(this.catalogTaskFile, this.catalogTask);
        }
      } catch {
        this.catalogTask = null;
      }
    }
    if (await exists(this.maintenanceTaskFile)) {
      try {
        this.maintenanceTask = JSON.parse(await readFile(this.maintenanceTaskFile, "utf8"));
        if (["running", "queued"].includes(this.maintenanceTask.status)) {
          this.maintenanceTask.status = "paused";
          this.maintenanceTask.message = "本地服务上次退出，维护任务已安全暂停；继续时需要重新读取本机 Token。";
          this.maintenanceTask.updatedAt = now();
          await this.persistMaintenanceTask();
        }
      } catch {
        this.maintenanceTask = null;
      }
    }
    return this;
  }

  close() {
    this.overlayDb?.close();
    this.overlayDb = null;
  }

  ensureOverlayDb() {
    if (this.overlayDb) return this.overlayDb;
    this.overlayDb = new DatabaseSync(this.overlayDbFile);
    this.overlayDb.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS daily_overlay (
        instrument_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL,
        turnover REAL,
        source TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        is_new INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (instrument_id, timestamp)
      );
      CREATE INDEX IF NOT EXISTS daily_overlay_timestamp_idx ON daily_overlay(timestamp);
    `);
    return this.overlayDb;
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

  getTask() {
    return this.task;
  }

  getCatalogTask() {
    return this.catalogTask;
  }

  getCnMaintenanceTask() {
    return this.maintenanceTask;
  }

  async persistMaintenanceTask() {
    if (!this.maintenanceTask) return;
    this.maintenanceTask.updatedAt = now();
    await writeJsonAtomic(this.maintenanceTaskFile, this.maintenanceTask);
  }

  async startCnMaintenance({ mode = "incremental", token, repairDays = 30 } = {}) {
    if (!token) throw new Error("请先在“设置 → 数据源设置”配置 Tushare Token");
    if (!["incremental", "repair"].includes(mode)) throw new Error("不支持的 A 股维护模式");
    if (this.maintenanceRunning || ["queued", "running"].includes(this.maintenanceTask?.status)) {
      throw new Error("已有 A 股维护任务正在运行");
    }
    const manifest = await this.getManifest();
    if (!manifest) throw new Error("请先完成 TDX A 股全市场日线初始化");
    const days = Math.min(120, Math.max(7, Math.trunc(Number(repairDays) || 30)));
    const effectiveLastTimestamp = this.effectiveLastTimestamp(manifest);
    const todayTimestamp = Date.UTC(
      this.nowProvider().getFullYear(),
      this.nowProvider().getMonth(),
      this.nowProvider().getDate(),
    );
    const startTimestamp = mode === "incremental"
      ? effectiveLastTimestamp + DAY_MS
      : Math.max(Date.UTC(1990, 0, 1), todayTimestamp - (days - 1) * DAY_MS);
    const dates = startTimestamp <= todayTimestamp ? weekdayDates(startTimestamp, todayTimestamp) : [];
    this.maintenanceTask = {
      id: `tushare_${randomUUID()}`,
      kind: "tushare-cn-daily-maintenance",
      mode,
      status: "queued",
      message: dates.length
        ? mode === "incremental" ? "准备按交易日拉取全市场增量日线。" : `准备回查最近 ${days} 个自然日并修复缺口。`
        : "本地 A 股日线已经是最新状态。",
      error: null,
      repairDays: days,
      dates,
      nextDateIndex: 0,
      progress: {
        processedDates: 0,
        totalDates: dates.length,
        receivedRows: 0,
        acceptedRows: 0,
        insertedBars: 0,
        correctedBars: 0,
        unchangedBars: 0,
        ignoredRows: 0,
        invalidRows: 0,
      },
      createdAt: now(),
      updatedAt: now(),
    };
    await this.persistMaintenanceTask();
    if (!dates.length) {
      this.maintenanceTask.status = "completed";
      await this.persistMaintenanceTask();
      return this.maintenanceTask;
    }
    queueMicrotask(() => void this.runCnMaintenance(token));
    return this.maintenanceTask;
  }

  async pauseCnMaintenance() {
    if (!this.maintenanceTask || !["queued", "running"].includes(this.maintenanceTask.status)) {
      return this.maintenanceTask;
    }
    this.maintenanceTask.status = "paused";
    this.maintenanceTask.message = "维护任务已暂停；已写入的日期和进度会保留。";
    this.maintenanceAbortController?.abort();
    await this.persistMaintenanceTask();
    return this.maintenanceTask;
  }

  async resumeCnMaintenance(token) {
    if (!token) throw new Error("继续任务需要在本机配置 Tushare Token");
    if (!this.maintenanceTask || !["paused", "failed"].includes(this.maintenanceTask.status)) {
      return this.maintenanceTask;
    }
    this.maintenanceTask.status = "queued";
    this.maintenanceTask.error = null;
    this.maintenanceTask.message = "维护任务已恢复。";
    await this.persistMaintenanceTask();
    queueMicrotask(() => void this.runCnMaintenance(token));
    return this.maintenanceTask;
  }

  effectiveLastTimestamp(manifest) {
    let value = manifest.instruments.reduce(
      (maximum, instrument) => Math.max(maximum, Number(instrument.lastTimestamp) || 0),
      0,
    );
    const row = this.ensureOverlayDb().prepare("SELECT MAX(timestamp) AS value FROM daily_overlay").get();
    value = Math.max(value, Number(row?.value) || 0);
    return value;
  }

  async readRecentBaseCandles(instrument, startTimestamp) {
    const target = path.resolve(this.root, instrument.relativePath);
    if (!target.startsWith(this.root) || !(await exists(target))) return new Map();
    const fileStat = await stat(target);
    const spanDays = Math.max(1, Math.ceil((Date.now() - startTimestamp) / DAY_MS));
    const recordCount = Math.min(
      Math.trunc(fileStat.size / TDX_DAY_RECORD_SIZE),
      Math.ceil(spanDays * 5 / 7) + 24,
    );
    const byteLength = recordCount * TDX_DAY_RECORD_SIZE;
    const buffer = Buffer.allocUnsafe(byteLength);
    const handle = await open(target, "r");
    try {
      await handle.read(buffer, 0, byteLength, Math.max(0, fileStat.size - byteLength));
    } finally {
      await handle.close();
    }
    return new Map(
      parseTdxDayBuffer(buffer, { startTimestamp }).map((candle) => [candle.timestamp, candle]),
    );
  }

  async fetchTushareTradeDate(token, tradeDate) {
    this.maintenanceAbortController = new AbortController();
    const response = await this.fetcher(this.tushareUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_name: "daily",
        token,
        params: { trade_date: tradeDate },
        fields: "ts_code,trade_date,open,high,low,close,vol,amount",
      }),
      signal: AbortSignal.any([
        this.maintenanceAbortController.signal,
        AbortSignal.timeout(25_000),
      ]),
    });
    if (!response.ok) throw new Error(`Tushare 请求失败（HTTP ${response.status}）`);
    return normalizeTushareDailyRows(await response.json());
  }

  async runCnMaintenance(token) {
    if (
      this.maintenanceRunning
      || !this.maintenanceTask
      || !["queued", "running"].includes(this.maintenanceTask.status)
    ) return;
    this.maintenanceRunning = true;
    this.maintenanceTask.status = "running";
    this.maintenanceTask.error = null;
    const manifest = await this.getManifest();
    const instrumentMap = new Map(
      (manifest?.instruments ?? [])
        .filter((instrument) => instrument.assetType === "stock")
        .map((instrument) => [instrument.id, instrument]),
    );
    const firstDate = this.maintenanceTask.dates[this.maintenanceTask.nextDateIndex];
    const startTimestamp = firstDate ? timestampFromCompactDate(firstDate) : Date.now();
    const baseCache = new Map();
    const overlayDb = this.ensureOverlayDb();
    const existingRows = overlayDb.prepare(`
      SELECT instrument_id, timestamp, open, high, low, close, volume, turnover, is_new
      FROM daily_overlay WHERE timestamp >= ?
    `).all(startTimestamp);
    const existingOverlay = new Map(
      existingRows.map((row) => [`${row.instrument_id}:${row.timestamp}`, row]),
    );
    const upsert = overlayDb.prepare(`
      INSERT INTO daily_overlay (
        instrument_id, timestamp, open, high, low, close, volume, turnover, source, imported_at, is_new
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'tushare-daily', ?, ?)
      ON CONFLICT(instrument_id, timestamp) DO UPDATE SET
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        volume = excluded.volume,
        turnover = excluded.turnover,
        source = excluded.source,
        imported_at = excluded.imported_at,
        is_new = excluded.is_new
    `);
    try {
      while (this.maintenanceTask.nextDateIndex < this.maintenanceTask.dates.length) {
        if (this.maintenanceTask.status !== "running") {
          const error = new Error("维护任务已暂停");
          error.name = "AbortError";
          throw error;
        }
        const tradeDate = this.maintenanceTask.dates[this.maintenanceTask.nextDateIndex];
        this.maintenanceTask.message = `正在读取 ${displayDate(tradeDate)} 全市场不复权日线。`;
        await this.persistMaintenanceTask();
        const startedAt = Date.now();
        const normalized = await this.fetchTushareTradeDate(token, tradeDate);
        this.maintenanceTask.progress.receivedRows += normalized.received;
        this.maintenanceTask.progress.invalidRows += normalized.invalid;
        let changed = false;
        overlayDb.exec("BEGIN IMMEDIATE");
        try {
          for (const row of normalized.rows) {
            const instrument = instrumentMap.get(row.instrumentId);
            if (!instrument) {
              this.maintenanceTask.progress.ignoredRows += 1;
              continue;
            }
            this.maintenanceTask.progress.acceptedRows += 1;
            if (!baseCache.has(row.instrumentId)) {
              baseCache.set(
                row.instrumentId,
                await this.readRecentBaseCandles(instrument, startTimestamp),
              );
            }
            const key = `${row.instrumentId}:${row.timestamp}`;
            const overlay = existingOverlay.get(key);
            const base = baseCache.get(row.instrumentId).get(row.timestamp);
            const current = overlay ?? base;
            if (sameCandle(current, row)) {
              this.maintenanceTask.progress.unchangedBars += 1;
              continue;
            }
            const isNew = current ? Number(overlay?.is_new ?? 0) : 1;
            if (current) this.maintenanceTask.progress.correctedBars += 1;
            else this.maintenanceTask.progress.insertedBars += 1;
            upsert.run(
              row.instrumentId,
              row.timestamp,
              row.open,
              row.high,
              row.low,
              row.close,
              row.volume,
              row.turnover,
              now(),
              isNew,
            );
            existingOverlay.set(key, { ...row, instrument_id: row.instrumentId, is_new: isNew });
            if (!current) {
              instrument.barCount += 1;
              instrument.firstTimestamp = Math.min(instrument.firstTimestamp, row.timestamp);
              instrument.lastTimestamp = Math.max(instrument.lastTimestamp, row.timestamp);
            }
            changed = true;
          }
          overlayDb.exec("COMMIT");
        } catch (error) {
          overlayDb.exec("ROLLBACK");
          throw error;
        }
        this.maintenanceTask.nextDateIndex += 1;
        this.maintenanceTask.progress.processedDates = this.maintenanceTask.nextDateIndex;
        this.maintenanceTask.message = normalized.received
          ? `${displayDate(tradeDate)} 已核对 ${normalized.received.toLocaleString()} 行。`
          : `${displayDate(tradeDate)} 无日线返回，按休市日或尚未入库处理。`;
        if (changed) {
          manifest.baseDatasetVersion ??= manifest.datasetVersion;
          manifest.datasetVersion = `${manifest.baseDatasetVersion}-ts-${Date.now()}`;
          manifest.updatedAt = now();
          manifest.maintenanceSource = "tushare-120-daily";
          await writeJsonAtomic(this.manifestFile, manifest);
          this.manifestCache = manifest;
        }
        await this.persistMaintenanceTask();
        const remainingThrottle = this.tushareThrottleMs - (Date.now() - startedAt);
        if (remainingThrottle > 0 && this.maintenanceTask.nextDateIndex < this.maintenanceTask.dates.length) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, remainingThrottle);
            this.maintenanceAbortController.signal.addEventListener("abort", () => {
              clearTimeout(timer);
              const error = new Error("维护任务已暂停");
              error.name = "AbortError";
              reject(error);
            }, { once: true });
          });
        }
      }
      this.maintenanceTask.status = "completed";
      this.maintenanceTask.message = this.maintenanceTask.mode === "incremental"
        ? `增量检查完成：新增 ${this.maintenanceTask.progress.insertedBars.toLocaleString()} 根，校正 ${this.maintenanceTask.progress.correctedBars.toLocaleString()} 根。`
        : `缺口回查完成：补入 ${this.maintenanceTask.progress.insertedBars.toLocaleString()} 根，校正 ${this.maintenanceTask.progress.correctedBars.toLocaleString()} 根。`;
      await this.persistMaintenanceTask();
    } catch (error) {
      if (this.maintenanceTask?.status === "paused" || error?.name === "AbortError") {
        if (this.maintenanceTask) {
          this.maintenanceTask.status = "paused";
          this.maintenanceTask.message = "维护任务已暂停，继续时会从尚未完成的日期恢复。";
          await this.persistMaintenanceTask();
        }
      } else if (this.maintenanceTask) {
        this.maintenanceTask.status = "failed";
        this.maintenanceTask.error = error instanceof Error ? error.message : String(error);
        this.maintenanceTask.message = "A 股数据维护失败；已完成的日期和写入内容均已保留。";
        await this.persistMaintenanceTask();
      }
    } finally {
      this.maintenanceAbortController = null;
      this.maintenanceRunning = false;
    }
  }

  async startCatalogRefresh() {
    if (this.catalogTask?.status === "running") return this.catalogTask;
    const manifest = await this.getManifest();
    if (!manifest) throw new Error("请先完成通达信日线初始化");
    this.catalogTask = {
      id: `catalog_${randomUUID()}`,
      status: "running",
      processed: 0,
      total: manifest.instruments.length,
      resolved: 0,
      message: "正在从在线证券目录匹配中文名称。",
      error: null,
      createdAt: now(),
      updatedAt: now(),
    };
    await writeJsonAtomic(this.catalogTaskFile, this.catalogTask);
    queueMicrotask(() => void this.runCatalogRefresh());
    return this.catalogTask;
  }

  async persistCatalogState(names, manifest) {
    await writeJsonAtomic(this.catalogFile, names);
    await writeJsonAtomic(this.manifestFile, manifest);
    this.manifestCache = manifest;
    if (this.catalogTask) {
      this.catalogTask.updatedAt = now();
      await writeJsonAtomic(this.catalogTaskFile, this.catalogTask);
    }
  }

  async runCatalogRefresh() {
    try {
      const manifest = await this.getManifest();
      if (!manifest) throw new Error("本机数据版本不存在");
      const names = await this.loadCatalogNames();
      const manifestIds = new Set(manifest.instruments.map((instrument) => instrument.id));
      const batchSize = 120;
      for (let offset = 0; offset < manifest.instruments.length; offset += batchSize) {
        const batch = manifest.instruments.slice(offset, offset + batchSize);
        const requested = new Map(batch.map((instrument) => {
          const [code, exchange] = instrument.id.split(".");
          const marketNumber = exchange === "SH" ? "1" : "0";
          return [`${marketNumber}.${code}`, instrument.id];
        }));
        const secids = [...requested.keys()].join(",");
        const endpoint = `https://82.push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12%2Cf13%2Cf14&secids=${encodeURIComponent(secids)}`;
        let diff = [];
        try {
          const response = await fetch(endpoint, {
            headers: { "user-agent": "KLine-Training-Camp/0.16 local-catalog" },
            signal: AbortSignal.timeout(12000),
          });
          if (response.ok) {
            const payload = await response.json();
            diff = Array.isArray(payload?.data?.diff) ? payload.data.diff : [];
          }
        } catch {
          diff = [];
        }
        for (const item of diff) {
          const instrumentId = requested.get(`${Number(item.f13)}.${String(item.f12).padStart(6, "0")}`);
          const name = String(item.f14 ?? "").trim();
          if (instrumentId && name && name !== "-") names[instrumentId] = name;
        }
        this.catalogTask.processed = Math.min(manifest.instruments.length, offset + batch.length);
        this.catalogTask.resolved = Object.keys(names).filter((id) => manifestIds.has(id)).length;
        this.catalogTask.message = `已处理 ${this.catalogTask.processed.toLocaleString()} / ${manifest.instruments.length.toLocaleString()} 个代码。`;
        this.catalogTask.updatedAt = now();
        await writeJsonAtomic(this.catalogTaskFile, this.catalogTask);
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      manifest.instruments = manifest.instruments.map((instrument) => ({
        ...instrument,
        name: names[instrument.id] ?? instrument.name,
        nameResolved: Boolean(names[instrument.id]),
      }));
      manifest.catalogSource = "eastmoney-quote-directory";
      manifest.catalogUpdatedAt = now();
      this.catalogTask.status = "completed";
      this.catalogTask.resolved = manifest.instruments.filter((instrument) => instrument.nameResolved).length;
      this.catalogTask.message = `名称目录更新完成：已匹配 ${this.catalogTask.resolved.toLocaleString()} / ${manifest.instruments.length.toLocaleString()} 个品种。`;
      await this.persistCatalogState(names, manifest);
    } catch (error) {
      if (!this.catalogTask) return;
      this.catalogTask.status = "failed";
      this.catalogTask.error = error instanceof Error ? error.message : String(error);
      this.catalogTask.message = "名称目录更新失败，可稍后重试。";
      this.catalogTask.updatedAt = now();
      await writeJsonAtomic(this.catalogTaskFile, this.catalogTask);
    }
  }

  async deleteInstruments(instrumentIds) {
    const manifest = await this.getManifest();
    if (!manifest) return { deletedInstruments: 0 };
    const targets = new Set(instrumentIds.filter((id) => typeof id === "string"));
    const deleted = [];
    for (const instrument of manifest.instruments) {
      if (!targets.has(instrument.id)) continue;
      const target = path.resolve(this.root, instrument.relativePath);
      const relative = path.relative(this.root, target);
      if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
        await rm(target, { force: true });
        deleted.push(instrument.id);
      }
    }
    if (deleted.length) {
      if (await exists(this.overlayDbFile)) {
        const removeOverlay = this.ensureOverlayDb().prepare(
          "DELETE FROM daily_overlay WHERE instrument_id = ?",
        );
        this.overlayDb.exec("BEGIN IMMEDIATE");
        try {
          for (const instrumentId of deleted) removeOverlay.run(instrumentId);
          this.overlayDb.exec("COMMIT");
        } catch (error) {
          this.overlayDb.exec("ROLLBACK");
          throw error;
        }
      }
      manifest.instruments = manifest.instruments.filter((instrument) => !targets.has(instrument.id));
      manifest.datasetVersion = `${manifest.datasetVersion.split("-edit-")[0]}-edit-${Date.now()}`;
      manifest.updatedAt = now();
      await writeJsonAtomic(this.manifestFile, manifest);
      this.manifestCache = manifest;
    }
    return { deletedInstruments: deleted.length, instrumentIds: deleted };
  }

  async createTask(plan) {
    if (this.running || ["queued", "running"].includes(this.task?.status)) {
      throw new Error("已有初始化任务正在运行");
    }
    this.task = {
      id: `tdx_${randomUUID()}`,
      kind: "tdx-full-daily",
      status: "queued",
      stage: "waiting",
      plan: safePlan(plan),
      progress: {
        downloadedBytes: 0,
        totalBytes: 0,
        processedFiles: 0,
        totalFiles: 0,
        indexedInstruments: 0,
      },
      message: "任务已创建，准备下载通达信官方日线完整包。",
      error: null,
      createdAt: now(),
      updatedAt: now(),
    };
    await this.persistTask(true);
    queueMicrotask(() => void this.runTask());
    return this.task;
  }

  async pauseTask() {
    if (!this.task || !["queued", "running"].includes(this.task.status)) return this.task;
    this.task.status = "paused";
    this.task.message = "正在安全暂停；已下载的字节和已解压文件会保留。";
    this.task.updatedAt = now();
    this.abortController?.abort();
    await this.persistTask(true);
    return this.task;
  }

  async resumeTask() {
    if (!this.task || !["paused", "failed"].includes(this.task.status)) return this.task;
    this.task.status = "queued";
    this.task.error = null;
    this.task.message = "任务已恢复。";
    this.task.updatedAt = now();
    await this.persistTask(true);
    queueMicrotask(() => void this.runTask());
    return this.task;
  }

  async deleteTask({ removeData = false } = {}) {
    await this.pauseTask();
    this.task = null;
    await rm(this.taskFile, { force: true });
    if (removeData) {
      this.overlayDb?.close();
      this.overlayDb = null;
      await rm(path.join(this.root, "tdx"), { recursive: true, force: true });
      await rm(path.join(this.root, "packages"), { recursive: true, force: true });
    }
  }

  async persistTask(force = false) {
    if (!this.task) return;
    const current = Date.now();
    if (!force && current - this.lastPersistAt < 350) return;
    this.lastPersistAt = current;
    this.task.updatedAt = now();
    await writeJsonAtomic(this.taskFile, this.task);
  }

  async runTask() {
    if (this.running || !this.task || !["queued", "running"].includes(this.task.status)) return;
    this.running = true;
    this.task.status = "running";
    this.task.error = null;
    try {
      await this.downloadPackage();
      this.assertRunning();
      const checksum = await this.verifyPackage();
      this.assertRunning();
      const manifest = await this.extractAndIndex(checksum);
      this.assertRunning();
      if (!this.task.plan.keepRawPackage) {
        await rm(this.packageFile, { force: true });
      }
      this.task.status = "completed";
      this.task.stage = "completed";
      this.task.message = `初始化完成：${manifest.instruments.length.toLocaleString()} 个品种，日线可直接训练，周线按需生成。`;
      await this.persistTask(true);
      if (this.autoRefreshCatalog) await this.startCatalogRefresh();
    } catch (error) {
      if (this.task?.status === "paused" || error?.name === "AbortError") {
        if (this.task) {
          this.task.status = "paused";
          this.task.message = "任务已暂停，继续时将从已有进度恢复。";
          await this.persistTask(true);
        }
      } else if (this.task) {
        this.task.status = "failed";
        this.task.error = error instanceof Error ? error.message : String(error);
        this.task.message = "初始化失败；已保留可恢复进度。";
        await this.persistTask(true);
      }
    } finally {
      this.abortController = null;
      this.running = false;
    }
  }

  assertRunning() {
    if (!this.task || this.task.status !== "running") {
      const error = new Error("任务已暂停");
      error.name = "AbortError";
      throw error;
    }
  }

  async downloadPackage() {
    this.task.stage = "downloading";
    this.task.message = "正在断点下载通达信官方日线完整包。";
    await mkdir(path.dirname(this.packageFile), { recursive: true });
    if (await exists(this.packageFile)) {
      const packageStat = await stat(this.packageFile);
      this.task.progress.downloadedBytes = packageStat.size;
      this.task.progress.totalBytes = Math.max(this.task.progress.totalBytes, packageStat.size);
      await this.persistTask(true);
      return;
    }

    const partialSize = (await exists(this.partialPackageFile)) ? (await stat(this.partialPackageFile)).size : 0;
    const headers = partialSize > 0 ? { Range: `bytes=${partialSize}-` } : {};
    this.abortController = new AbortController();
    const response = await fetch(this.sourceUrl, {
      headers,
      redirect: "follow",
      signal: this.abortController.signal,
    });
    if (response.status === 416 && partialSize > 0) {
      await rename(this.partialPackageFile, this.packageFile);
      this.task.progress.downloadedBytes = partialSize;
      this.task.progress.totalBytes = partialSize;
      await this.persistTask(true);
      return;
    }
    if (!response.ok || !response.body) throw new Error(`完整包下载失败（HTTP ${response.status}）`);

    const resumed = response.status === 206 && partialSize > 0;
    const baseSize = resumed ? partialSize : 0;
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    this.task.progress.downloadedBytes = baseSize;
    this.task.progress.totalBytes = baseSize + contentLength;
    if (!resumed && partialSize > 0) await rm(this.partialPackageFile, { force: true });

    const output = createWriteStream(this.partialPackageFile, { flags: resumed ? "a" : "w" });
    const reader = response.body.getReader();
    try {
      while (true) {
        this.assertRunning();
        const { done, value } = await reader.read();
        if (done) break;
        if (!output.write(Buffer.from(value))) {
          await new Promise((resolve) => output.once("drain", resolve));
        }
        this.task.progress.downloadedBytes += value.byteLength;
        await this.persistTask();
      }
      await new Promise((resolve, reject) => output.end((error) => error ? reject(error) : resolve()));
    } catch (error) {
      output.destroy();
      throw error;
    }
    await rename(this.partialPackageFile, this.packageFile);
    await this.persistTask(true);
  }

  async verifyPackage() {
    this.task.stage = "verifying";
    this.task.message = "正在校验 ZIP 完整性并生成数据版本指纹。";
    await this.persistTask(true);
    const checksum = await fileSha256(this.packageFile);
    const directory = await unzipper.Open.file(this.packageFile);
    const dayFiles = directory.files.filter((entry) => instrumentIdFromEntry(entry.path));
    if (dayFiles.length < 100 && this.sourceUrl === DEFAULT_SOURCE_URL) {
      throw new Error("ZIP 校验失败：未找到预期数量的 .day 文件");
    }
    this.task.progress.totalFiles = dayFiles.length;
    await this.persistTask(true);
    return checksum;
  }

  async loadCatalogNames() {
    const seed = JSON.parse(await readFile(path.join(moduleDir, "catalog.seed.json"), "utf8"));
    if (!(await exists(this.catalogFile))) return seed;
    try {
      return { ...seed, ...JSON.parse(await readFile(this.catalogFile, "utf8")) };
    } catch {
      return seed;
    }
  }

  async extractAndIndex(checksum) {
    this.task.stage = "extracting";
    this.task.message = "正在扫描、分类并导入日线分区文件。";
    this.task.progress.processedFiles = 0;
    this.task.progress.indexedInstruments = 0;
    await mkdir(this.dataDir, { recursive: true });
    const names = await this.loadCatalogNames();
    const previousManifest = await this.getManifest();
    const sourceVersionChanged = Boolean(previousManifest?.checksum && previousManifest.checksum !== checksum);
    const directory = await unzipper.Open.file(this.packageFile);
    const entries = directory.files.filter((entry) => instrumentIdFromEntry(entry.path));
    const instruments = [];
    const cutoff = this.historyCutoff();

    for (const entry of entries) {
      this.assertRunning();
      const instrumentId = instrumentIdFromEntry(entry.path);
      const assetType = classifyTdxInstrument(instrumentId);
      if (!this.task.plan.assets.includes(assetType)) {
        this.task.progress.processedFiles += 1;
        continue;
      }
      const [code, exchange] = instrumentId.split(".");
      const target = path.join(this.dataDir, exchange.toLowerCase(), `${code}.day`);
      await mkdir(path.dirname(target), { recursive: true });
      const expectedSize = Number(entry.vars?.uncompressedSize ?? entry.uncompressedSize ?? 0);
      if (sourceVersionChanged || !(await exists(target)) || (await stat(target)).size !== expectedSize) {
        const temp = `${target}.tmp`;
        await pipeline(entry.stream(), createWriteStream(temp));
        await rename(temp, target);
      }
      const data = await readFile(target);
      const bars = parseTdxDayBuffer(data, cutoff ? { startTimestamp: cutoff } : undefined);
      if (bars.length) {
        if (cutoff && bars.length * TDX_DAY_RECORD_SIZE !== data.length) {
          const compact = Buffer.allocUnsafe(bars.length * TDX_DAY_RECORD_SIZE);
          let offset = 0;
          for (let sourceOffset = 0; sourceOffset < data.length; sourceOffset += TDX_DAY_RECORD_SIZE) {
            const date = data.readInt32LE(sourceOffset);
            const year = Math.trunc(date / 10000);
            const month = Math.trunc((date % 10000) / 100);
            const day = date % 100;
            if (Date.UTC(year, month - 1, day) < cutoff) continue;
            data.copy(compact, offset, sourceOffset, sourceOffset + TDX_DAY_RECORD_SIZE);
            offset += TDX_DAY_RECORD_SIZE;
          }
          await writeFile(target, compact.subarray(0, offset));
        }
        instruments.push({
          id: instrumentId,
          symbol: instrumentId,
          name: names[instrumentId] ?? fallbackInstrumentName(instrumentId, assetType),
          nameResolved: Boolean(names[instrumentId]),
          market: "CN",
          exchange,
          timezone: "Asia/Shanghai",
          pricePrecision: 2,
          assetType,
          relativePath: path.relative(this.root, target).replaceAll("\\", "/"),
          barCount: bars.length,
          firstTimestamp: bars[0].timestamp,
          lastTimestamp: bars.at(-1).timestamp,
        });
      }
      this.task.progress.processedFiles += 1;
      this.task.progress.indexedInstruments = instruments.length;
      await this.persistTask();
    }

    instruments.sort((left, right) => left.id.localeCompare(right.id));
    const manifest = {
      schemaVersion: 1,
      source: "tdx-official-hsjday",
      sourceUrl: this.sourceUrl,
      datasetVersion: `tdx-${checksum.slice(0, 16)}`,
      checksum,
      createdAt: now(),
      historyRange: this.task.plan.historyRange,
      assets: this.task.plan.assets,
      instruments,
    };
    await writeJsonAtomic(this.manifestFile, manifest);
    this.manifestCache = manifest;
    this.task.stage = "weekly-ready";
    this.task.message = "日线索引已建立；周线将在首次打开品种时自动聚合并缓存于内存。";
    await this.persistTask(true);
    return manifest;
  }

  historyCutoff() {
    if (this.task.plan.historyRange === "all") return null;
    const years = this.task.plan.historyRange === "20y" ? 20 : 10;
    const date = new Date();
    return Date.UTC(date.getUTCFullYear() - years, 0, 1);
  }

  async getInstruments() {
    return (await this.getManifest())?.instruments ?? [];
  }

  async getCoverage({ offset = 0, limit = 100, query = "" } = {}) {
    const manifest = await this.getManifest();
    if (!manifest) return {
      coverage: [],
      total: 0,
      summary: { instrumentCount: 0, barCount: 0, timeframes: [] },
    };
    const normalizedQuery = query.trim().toLowerCase();
    const matched = normalizedQuery
      ? manifest.instruments.filter((instrument) =>
          instrument.id.toLowerCase().includes(normalizedQuery) ||
          instrument.name.toLowerCase().includes(normalizedQuery) ||
          instrument.market.toLowerCase().includes(normalizedQuery) ||
          "tdx-official".includes(normalizedQuery))
      : manifest.instruments;
    const safeOffset = Math.max(0, Math.trunc(Number(offset) || 0));
    const safeLimit = Math.min(500, Math.max(1, Math.trunc(Number(limit) || 100)));
    const total = matched.length * 2;
    const coverage = [];
    for (let rowIndex = safeOffset; rowIndex < Math.min(total, safeOffset + safeLimit); rowIndex += 1) {
      const instrument = matched[Math.floor(rowIndex / 2)];
      const timeframe = rowIndex % 2 === 0 ? "1d" : "1w";
      coverage.push({
        id: instrument.id,
        symbol: instrument.symbol,
        name: instrument.name,
        market: instrument.market,
        timezone: instrument.timezone,
        pricePrecision: instrument.pricePrecision,
        assetType: instrument.assetType,
        timeframe,
        barCount: timeframe === "1d" ? instrument.barCount : Math.ceil(instrument.barCount / 5),
        firstTimestamp: instrument.firstTimestamp,
        lastTimestamp: instrument.lastTimestamp,
        adjustmentType: "none",
        source: manifest.maintenanceSource ? "tdx-official+tushare" : "tdx-official",
        datasetVersion: manifest.datasetVersion,
      });
    }
    const barCount = manifest.instruments.reduce(
      (sum, instrument) => sum + instrument.barCount + Math.ceil(instrument.barCount / 5),
      0,
    );
    return {
      coverage,
      total,
      summary: {
        instrumentCount: manifest.instruments.length,
        barCount,
        timeframes: ["1d", "1w"],
      },
    };
  }

  async getCandles(instrumentId, timeframe = "1d") {
    if (!["1d", "1w"].includes(timeframe)) return null;
    const manifest = await this.getManifest();
    const instrument = manifest?.instruments.find((item) => item.id === instrumentId);
    if (!instrument) return null;
    const target = path.resolve(this.root, instrument.relativePath);
    if (!target.startsWith(this.root) || !(await exists(target))) return null;
    const daily = parseTdxDayBuffer(await readFile(target));
    const overlays = (await exists(this.overlayDbFile))
      ? this.ensureOverlayDb().prepare(`
          SELECT timestamp, open, high, low, close, volume, turnover
          FROM daily_overlay WHERE instrument_id = ? ORDER BY timestamp ASC
        `).all(instrumentId)
      : [];
    const merged = new Map(daily.map((candle) => [candle.timestamp, candle]));
    for (const overlay of overlays) {
      merged.set(Number(overlay.timestamp), {
        timestamp: Number(overlay.timestamp),
        open: Number(overlay.open),
        high: Number(overlay.high),
        low: Number(overlay.low),
        close: Number(overlay.close),
        volume: overlay.volume == null ? null : Number(overlay.volume),
        turnover: overlay.turnover == null ? null : Number(overlay.turnover),
      });
    }
    const effectiveDaily = [...merged.values()].sort((left, right) => left.timestamp - right.timestamp);
    return {
      instrument: {
        id: instrument.id,
        symbol: instrument.symbol,
        name: instrument.name,
        market: instrument.market,
        timezone: instrument.timezone,
        pricePrecision: instrument.pricePrecision,
        assetType: instrument.assetType,
      },
      timeframe,
      adjustmentType: "none",
      source: overlays.length ? "tdx-official+tushare" : "tdx-official",
      datasetVersion: manifest.datasetVersion,
      candles: timeframe === "1w" ? aggregateWeekly(effectiveDaily) : effectiveDaily,
    };
  }
}
