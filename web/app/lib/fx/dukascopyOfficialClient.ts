import {
  parseDukascopyCsv,
  type DukascopyParseResult,
  type FxCandle,
} from "./dukascopyCsv.ts";

/** The official widget publishes the current Jetta service location here. */
export const DUKASCOPY_WIDGET_CONFIG_URL = "https://widgets.dukascopy.com/en/config.json";
/** Stable official fallback used when the widget config points at a test host. */
export const DUKASCOPY_PRODUCTION_SERVER_URL = "https://jetta.dukascopy.com";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 750;
const DEFAULT_DAILY_CONCURRENCY = 4;
const MAX_RETRY_DELAY_MS = 8_000;

type JsonObject = Record<string, unknown>;

type OfficialHistoryDescriptor = {
  period?: unknown;
  from?: unknown;
};

type OfficialInstrumentPayload = JsonObject & {
  code?: unknown;
  histories?: unknown;
};

type OfficialCandlePayload = JsonObject & {
  times?: unknown;
  opens?: unknown;
  highs?: unknown;
  lows?: unknown;
  closes?: unknown;
  volumes?: unknown;
  timestamp?: unknown;
  shift?: unknown;
  multiplier?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
};

export type DukascopyOfficialFetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type DukascopyOfficialClientOptions = {
  /** Injected in tests; production uses the runtime fetch implementation. */
  fetcher?: DukascopyOfficialFetcher;
  /** Used by tests or a controlled deployment; otherwise config.json is resolved. */
  serverUrl?: string;
  configUrl?: string;
  /** Prevent a blocked upstream from holding a task open indefinitely. */
  timeoutMs?: number;
  /** Total attempts for retryable requests, including the first request. */
  maxAttempts?: number;
  /** Initial retry delay; each later retry uses exponential backoff. */
  retryBaseDelayMs?: number;
  /** Number of daily candle files downloaded at the same time. */
  dailyConcurrency?: number;
};

export type DukascopyOfficialDownloadRequest = {
  instrument: string;
  start: string;
  end: string;
  timeframe?: string;
  offerSide?: "BID" | "ASK";
  signal?: AbortSignal;
};

export type DukascopyOfficialParseResult = DukascopyParseResult & {
  /** First available minute timestamp reported by the official instrument feed. */
  availableFrom: number | null;
};

export class DukascopyOfficialClientError extends Error {
  readonly status?: number;
  readonly url: string;
  readonly retryAfterMs?: number;

  constructor(message: string, url: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = "DukascopyOfficialClientError";
    this.url = url;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function isTooLateForOfficialRange(error: unknown) {
  return error instanceof DukascopyOfficialClientError
    && error.status === 400
    && /from time is too late/i.test(error.message);
}

function positiveInteger(value: unknown, fallback: number, maximum: number) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.max(Math.floor(number), 1), maximum);
}

function retryAfterMilliseconds(response: Response) {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function isRetryableError(error: unknown) {
  if (!(error instanceof DukascopyOfficialClientError)) return false;
  return error.status === undefined
    || error.status === 408
    || error.status === 425
    || error.status === 429
    || error.status >= 500;
}

function waitForRetry(delayMs: number, signal?: AbortSignal) {
  const abortSignal = signal;
  if (abortSignal?.aborted) return Promise.reject(abortSignal.reason ?? new Error("Request cancelled"));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
      reject(abortSignal?.reason ?? new Error("Request cancelled"));
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  concurrency: number,
  worker: (item: Input, index: number) => Promise<Output>,
) {
  const results = new Array<Output>(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function defaultFetcher(input: string | URL, init?: RequestInit) {
  if (typeof globalThis.fetch !== "function") throw new Error("当前运行时没有可用的 fetch");
  return globalThis.fetch(input, init);
}

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} 必须是 YYYY-MM-DD`);
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} 不是有效日期`);
  return timestamp;
}

function normalizeServerUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Dukascopy 官方数据服务必须使用 HTTPS");
  const hostname = url.hostname.toLowerCase();
  if (hostname !== "dukascopy.com" && !hostname.endsWith(".dukascopy.com")) {
    throw new Error("Dukascopy 官方数据服务地址不在允许的官方域名内");
  }
  const basePath = url.pathname.replace(/^\/+|\/+$/g, "");
  url.pathname = `/${basePath ? `${basePath}/` : ""}v1`;
  return url.toString().replace(/\/+$/, "");
}

function normalizeInstrumentCandidates(value: string) {
  const raw = value.trim().toUpperCase();
  const compact = raw.replace(/[\/_-]/g, "");
  const candidates: string[] = [];
  if (compact.length === 6) {
    candidates.push(`${compact.slice(0, 3)}-${compact.slice(3)}`);
    candidates.push(raw);
    candidates.push(`${compact.slice(0, 3)}/${compact.slice(3)}`);
  } else {
    candidates.push(raw);
  }
  candidates.push(compact);
  return [...new Set(candidates.filter(Boolean))];
}

function pathUrl(base: string, segments: readonly string[]) {
  return `${base}/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function asNumberArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => finiteNumber(item)).filter((item): item is number => item !== null)
    : [];
}

function normalizeTimestamp(value: unknown) {
  const timestamp = finiteNumber(value);
  if (timestamp === null) return null;
  if (Math.abs(timestamp) < 100_000_000_000) return timestamp * 1000;
  return timestamp;
}

function priceScale(multiplier: number) {
  if (!Number.isFinite(multiplier) || multiplier === 0) return 1;
  return multiplier > 1 ? multiplier : 10 ** Math.abs(Math.log10(multiplier));
}

function applyDelta(previous: number, delta: number, multiplier: number, scale: number) {
  return Math.round((previous + delta * multiplier) * scale) / scale;
}

function decodeDirectRows(payload: JsonObject, from: number, till: number) {
  const rows = Array.isArray(payload.candles)
    ? payload.candles
    : Array.isArray(payload.data) && payload.data.every((item) => item && typeof item === "object")
      ? payload.data
      : null;
  if (!rows) return null;
  return rows.flatMap((item) => {
    const row = asJsonObject(item);
    const timestamp = normalizeTimestamp(row.timestamp ?? row.time ?? row.date);
    const open = finiteNumber(row.open ?? row.o);
    const high = finiteNumber(row.high ?? row.h);
    const low = finiteNumber(row.low ?? row.l);
    const close = finiteNumber(row.close ?? row.c);
    if (timestamp === null || open === null || high === null || low === null || close === null || timestamp < from || timestamp >= till) return [];
    const volume = finiteNumber(row.volume ?? row.v);
    return [{ timestamp, open, high, low, close, volume, turnover: null } satisfies FxCandle];
  });
}

function decodeDeltaRows(payload: OfficialCandlePayload, from: number, till: number) {
  const times = asNumberArray(payload.times);
  if (!times.length) return [];
  const opens = asNumberArray(payload.opens);
  const highs = asNumberArray(payload.highs);
  const lows = asNumberArray(payload.lows);
  const closes = asNumberArray(payload.closes);
  const volumes = asNumberArray(payload.volumes);
  if ([opens, highs, lows, closes].some((values) => values.length !== times.length)) {
    throw new Error("Dukascopy 官方分钟数据的 OHLC 数组长度不一致");
  }

  const shift = finiteNumber(payload.shift) ?? 1;
  const multiplier = finiteNumber(payload.multiplier) ?? 1;
  const scale = priceScale(multiplier);
  let timestamp = finiteNumber(payload.timestamp) ?? 0;
  let open = finiteNumber(payload.open) ?? 0;
  let high = finiteNumber(payload.high) ?? 0;
  let low = finiteNumber(payload.low) ?? 0;
  let close = finiteNumber(payload.close) ?? 0;
  const candles: FxCandle[] = [];
  for (let index = 0; index < times.length; index += 1) {
    timestamp += shift * times[index];
    open = applyDelta(open, opens[index], multiplier, scale);
    high = applyDelta(high, highs[index], multiplier, scale);
    low = applyDelta(low, lows[index], multiplier, scale);
    close = applyDelta(close, closes[index], multiplier, scale);
    if (timestamp < from || timestamp >= till) continue;
    candles.push({
      timestamp,
      open,
      high,
      low,
      close,
      volume: volumes[index] === undefined ? null : Math.round(volumes[index] * 1_000_000),
      turnover: null,
    });
  }
  return candles;
}

function decodeCandlePayload(payload: unknown, from: number, till: number) {
  const object = asJsonObject(payload) as OfficialCandlePayload;
  return decodeDirectRows(object, from, till) ?? decodeDeltaRows(object, from, till);
}

function emptyParsedResult(availableFrom: number | null): DukascopyOfficialParseResult {
  return {
    ...parseDukascopyCsv("timestamp,open,high,low,close,volume\n", { timestampUnit: "milliseconds" }),
    availableFrom,
  };
}

function candleCsvLines(candles: readonly FxCandle[]) {
  return [
    "timestamp,open,high,low,close,volume",
    ...candles.map((candle) => [
      candle.timestamp,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume ?? "",
    ].join(",")),
  ];
}

export function formatDukascopyCsv(candles: readonly FxCandle[]) {
  return `${candleCsvLines(candles).join("\n")}\n`;
}

export class DukascopyOfficialClient {
  private readonly fetcher: DukascopyOfficialFetcher;
  private readonly configUrl: string;
  private readonly configuredServerUrl?: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly dailyConcurrency: number;
  private serverUrlsPromise?: Promise<string[]>;
  private readonly instrumentCache = new Map<string, Promise<OfficialInstrumentInfo>>();

  constructor(options: DukascopyOfficialClientOptions = {}) {
    this.fetcher = options.fetcher ?? defaultFetcher;
    this.configUrl = options.configUrl ?? DUKASCOPY_WIDGET_CONFIG_URL;
    this.configuredServerUrl = options.serverUrl ? normalizeServerUrl(options.serverUrl) : undefined;
    this.timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : DEFAULT_TIMEOUT_MS;
    this.maxAttempts = positiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 6);
    this.retryBaseDelayMs = Number.isFinite(options.retryBaseDelayMs) && Number(options.retryBaseDelayMs) >= 0
      ? Number(options.retryBaseDelayMs)
      : DEFAULT_RETRY_BASE_DELAY_MS;
    this.dailyConcurrency = positiveInteger(options.dailyConcurrency, DEFAULT_DAILY_CONCURRENCY, 6);
  }

  private async serverUrls() {
    if (this.configuredServerUrl) return [this.configuredServerUrl];
    this.serverUrlsPromise ??= this.resolveServerUrls();
    return this.serverUrlsPromise;
  }

  private async fetchWithTimeout(input: string | URL, init: RequestInit = {}) {
    if (init.signal?.aborted) {
      throw new DukascopyOfficialClientError("Dukascopy 官方数据请求已取消", String(input));
    }
    const controller = new AbortController();
    let callerAborted = false;
    const onAbort = () => {
      callerAborted = true;
      controller.abort(init.signal?.reason);
    };
    init.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetcher(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof DukascopyOfficialClientError) throw error;
      const url = String(input);
      if (callerAborted) throw new DukascopyOfficialClientError("Dukascopy 官方数据请求已取消", url);
      if (controller.signal.aborted) {
        throw new DukascopyOfficialClientError(
          `连接 Dukascopy 官方数据服务超时（${Math.ceil(this.timeoutMs / 1000)} 秒）`,
          url,
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new DukascopyOfficialClientError(`无法连接 Dukascopy 官方数据服务：${message}`, url);
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", onAbort);
    }
  }

  private async resolveServerUrls() {
    const production = normalizeServerUrl(DUKASCOPY_PRODUCTION_SERVER_URL);
    let response: Response;
    try {
      response = await this.fetchWithTimeout(this.configUrl, { headers: { accept: "application/json" } });
    } catch {
      // The config endpoint is only a locator. If it is unavailable, the
      // stable official production host is still enough to serve the feed.
      return [production];
    }
    const body = await response.text();
    if (!response.ok) return [production];
    let payload: JsonObject;
    try {
      payload = asJsonObject(JSON.parse(body));
    } catch {
      return [production];
    }
    const serverUrl = typeof payload.JETTA_SERVER_URL === "string" ? payload.JETTA_SERVER_URL : "";
    if (!serverUrl) return [production];
    const configured = normalizeServerUrl(serverUrl);
    const configuredHostname = new URL(configured).hostname.toLowerCase();
    // The widget may advertise a test host that is frequently unreachable.
    // Prefer production so each task chunk does not pay a full timeout first.
    const candidates = configuredHostname.includes(".test.")
      ? [production]
      : [configured, production];
    return [...new Set(candidates)];
  }

  private async requestJsonOnce(url: string, signal: AbortSignal | undefined, allowMissing: boolean) {
    const response = await this.fetchWithTimeout(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal,
    });
    const body = await response.text();
    if (allowMissing && response.status === 404) return null;
    let payload: unknown = null;
    try {
      payload = body ? JSON.parse(body) : null;
    } catch {
      if (response.ok) throw new DukascopyOfficialClientError("Dukascopy 官方数据返回的不是 JSON", url, response.status);
    }
    if (!response.ok) {
      const detail = asJsonObject(payload).error;
      throw new DukascopyOfficialClientError(
        `Dukascopy 官方数据返回 HTTP ${response.status}${detail ? `：${String(detail)}` : ""}`,
        url,
        response.status,
        retryAfterMilliseconds(response),
      );
    }
    return payload;
  }

  private async requestJsonWithRetry(url: string, signal: AbortSignal | undefined, allowMissing: boolean) {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.requestJsonOnce(url, signal, allowMissing);
      } catch (error) {
        if (signal?.aborted || !isRetryableError(error) || attempt >= this.maxAttempts) {
          if (isRetryableError(error) && attempt > 1 && error instanceof DukascopyOfficialClientError) {
            throw new DukascopyOfficialClientError(
              `${error.message}（已尝试 ${attempt} 次）`,
              error.url,
              error.status,
              error.retryAfterMs,
            );
          }
          throw error;
        }
        const retryDelay = Math.max(
          Math.min(MAX_RETRY_DELAY_MS, this.retryBaseDelayMs * (2 ** (attempt - 1))),
          error instanceof DukascopyOfficialClientError ? error.retryAfterMs ?? 0 : 0,
        );
        try {
          await waitForRetry(retryDelay, signal);
        } catch {
          throw new DukascopyOfficialClientError("Dukascopy 官方数据请求已取消", url);
        }
      }
    }
    throw new DukascopyOfficialClientError("Dukascopy 官方数据请求失败", url);
  }

  private requestJson(url: string, signal?: AbortSignal) {
    return this.requestJsonWithRetry(url, signal, false);
  }

  private requestJsonAllowMissing(url: string, signal?: AbortSignal) {
    return this.requestJsonWithRetry(url, signal, true);
  }

  private async loadInstrument(symbol: string, signal?: AbortSignal): Promise<OfficialInstrumentInfo> {
    const cacheKey = symbol.trim().toUpperCase();
    const cached = this.instrumentCache.get(cacheKey);
    if (cached) return cached;
    const promise = this.fetchInstrument(symbol, signal);
    this.instrumentCache.set(cacheKey, promise);
    void promise.catch(() => {
      if (this.instrumentCache.get(cacheKey) === promise) this.instrumentCache.delete(cacheKey);
    });
    return promise;
  }

  private async fetchInstrument(symbol: string, signal?: AbortSignal): Promise<OfficialInstrumentInfo> {
    const servers = await this.serverUrls();
    let lastUrl = "";
    let lastError: unknown = null;
    for (const base of servers) {
      let tryNextServer = false;
      for (const candidate of normalizeInstrumentCandidates(symbol)) {
        const url = pathUrl(base, ["instruments", candidate]);
        lastUrl = url;
        try {
          const payload = await this.requestJson(url, signal) as OfficialInstrumentPayload;
          const histories = Array.isArray(payload.histories) ? payload.histories as OfficialHistoryDescriptor[] : [];
          const minuteHistory = histories.find((history) => {
            const period = String(history.period ?? "").toUpperCase();
            return period === "MINUTE" || period === "M1" || period === "1";
          });
          const minuteFrom = normalizeTimestamp(minuteHistory?.from);
          const code = typeof payload.code === "string" && payload.code.trim() ? payload.code : candidate;
          return {
            payload,
            code,
            serverUrl: base,
            pathCodes: [...new Set([
              code.replaceAll("/", "-"),
              code,
              ...normalizeInstrumentCandidates(symbol),
            ])],
            minuteFrom,
          };
        } catch (error) {
          lastError = error;
          const status = error instanceof DukascopyOfficialClientError ? error.status : undefined;
          if (status !== 404 && status !== 400 && status !== 422) {
            tryNextServer = true;
            break;
          }
        }
      }
      if (!tryNextServer && lastError instanceof DukascopyOfficialClientError && [404, 400, 422].includes(lastError.status ?? 0)) continue;
    }
    if (lastError && !(lastError instanceof DukascopyOfficialClientError && [404, 400, 422].includes(lastError.status ?? 0))) {
      throw lastError;
    }
    throw new DukascopyOfficialClientError("Dukascopy 官方数据中找不到该货币对", lastUrl);
  }

  async getMinuteAvailability(symbol: string, signal?: AbortSignal) {
    return (await this.loadInstrument(symbol, signal)).minuteFrom;
  }

  async downloadAndParseCsv(request: DukascopyOfficialDownloadRequest): Promise<DukascopyOfficialParseResult> {
    const start = normalizeDate(request.start, "start");
    const end = normalizeDate(request.end, "end") + 86_400_000;
    if (end <= start) throw new Error("Dukascopy 历史日期范围无效");
    const timeframe = String(request.timeframe ?? "1m").toLowerCase();
    if (!(["1m", "m1", "minute", "1"].includes(timeframe))) {
      throw new Error("Dukascopy 官方内置适配器只提供 1 分钟原始数据");
    }

    const instrument = await this.loadInstrument(request.instrument, request.signal);
    const effectiveStart = Math.max(start, instrument.minuteFrom ?? start);
    if (effectiveStart >= end) return emptyParsedResult(instrument.minuteFrom);

    const firstDay = new Date(effectiveStart);
    firstDay.setUTCHours(0, 0, 0, 0);
    const days: number[] = [];
    for (let day = firstDay.getTime(); day < end; day += 86_400_000) days.push(day);
    const dailyCandles = await mapWithConcurrency(days, this.dailyConcurrency, async (day) => {
      try {
        const date = new Date(day);
        let payload: unknown = null;
        let requestedPath = "";
        for (const pathCode of instrument.pathCodes) {
          requestedPath = pathUrl(instrument.serverUrl, [
            "candles",
            "minute",
            pathCode,
            request.offerSide ?? "BID",
            String(date.getUTCFullYear()),
            String(date.getUTCMonth() + 1),
            String(date.getUTCDate()),
          ]);
          payload = await this.requestJsonAllowMissing(requestedPath, request.signal);
          if (payload !== null) break;
        }
        if (payload === null) return [];
        try {
          return decodeCandlePayload(payload, start, end);
        } catch (error) {
          throw new DukascopyOfficialClientError(
            error instanceof Error ? error.message : "Dukascopy 官方分钟数据无法解码",
            requestedPath,
          );
        }
      } catch (error) {
        // The official feed uses HTTP 400 when a requested day is newer than
        // its current minute-data horizon. Treat that day as empty so a range
        // ending near the present can finish without discarding prior days.
        if (isTooLateForOfficialRange(error)) return [];
        throw error;
      }
    });

    const candles = dailyCandles.flat();
    candles.sort((left, right) => left.timestamp - right.timestamp);
    const parsed = parseDukascopyCsv(candleCsvLines(candles), {
      timestampUnit: "milliseconds",
      timestampTimeZone: "UTC",
    });
    return { ...parsed, availableFrom: instrument.minuteFrom };
  }
}

type OfficialInstrumentInfo = {
  payload: OfficialInstrumentPayload;
  code: string;
  serverUrl: string;
  pathCodes: string[];
  minuteFrom: number | null;
};
