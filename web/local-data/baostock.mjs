import {
  aggregateMonthly,
  aggregateWeekly,
  cnPriceLimitRatio,
  fallbackInstrumentName,
} from "./tdx-day.mjs";

const EXCHANGES = new Set(["SH", "SZ", "BJ"]);
const DATE_PATTERN = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/;

export const BAOSTOCK_ADJUSTMENT_TYPE = "qfq";
export const BAOSTOCK_ADJUSTFLAG = "2";
export const BAOSTOCK_SOURCE = "baostock-qfq";

export function instrumentIdFromBaoStockCode(value) {
  const text = String(value ?? "").trim().toLowerCase();
  const prefixed = text.match(/^(sh|sz|bj)\.(\d{6})$/);
  if (prefixed) return `${prefixed[2]}.${prefixed[1].toUpperCase()}`;
  const suffixed = text.match(/^(\d{6})\.(sh|sz|bj)$/);
  if (suffixed) return `${suffixed[1]}.${suffixed[2].toUpperCase()}`;
  return null;
}

export function baoStockCodeFromInstrumentId(value) {
  const match = String(value ?? "").trim().toUpperCase().match(/^(\d{6})\.(SH|SZ|BJ)$/);
  return match ? `${match[2].toLowerCase()}.${match[1]}` : null;
}

export function dateTimestamp(value) {
  const match = String(value ?? "").trim().match(DATE_PATTERN);
  if (!match) return Number.NaN;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(timestamp);
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3])
    ? timestamp
    : Number.NaN;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function validCandle(candle) {
  return Number.isFinite(candle.timestamp)
    && Number.isFinite(candle.open)
    && Number.isFinite(candle.high)
    && Number.isFinite(candle.low)
    && Number.isFinite(candle.close)
    && candle.open > 0
    && candle.high > 0
    && candle.low > 0
    && candle.close > 0
    && candle.low <= Math.min(candle.open, candle.close)
    && candle.high >= Math.max(candle.open, candle.close);
}

/**
 * BaoStock returns adjusted OHLC directly when adjustflag=2.  This function
 * deliberately does not apply another factor locally; doing so would double
 * adjust the series.
 */
export function normalizeBaoStockRows(rows) {
  const unique = new Map();
  let invalid = 0;
  const input = Array.isArray(rows) ? rows : [];
  for (const row of input) {
    const candle = {
      timestamp: dateTimestamp(row?.date),
      open: Number(row?.open),
      high: Number(row?.high),
      low: Number(row?.low),
      close: Number(row?.close),
      volume: finiteOrNull(row?.volume),
      turnover: finiteOrNull(row?.amount),
    };
    if (!validCandle(candle)) {
      invalid += 1;
      continue;
    }
    unique.set(candle.timestamp, candle);
  }
  const candles = [...unique.values()].sort((left, right) => left.timestamp - right.timestamp);
  return {
    candles,
    report: {
      received: input.length,
      accepted: candles.length,
      invalid,
      duplicates: input.length - invalid - candles.length,
      firstTimestamp: candles[0]?.timestamp,
      lastTimestamp: candles.at(-1)?.timestamp,
    },
  };
}

export function classifyBaoStockInstrument(rowOrId) {
  const row = rowOrId && typeof rowOrId === "object" ? rowOrId : {};
  const type = Number(row.type);
  if (type === 1) return "stock";
  if (type === 2) return "index";
  if (type === 4) return "convertible-bond";
  if (type === 5 || type === 6) return "fund";
  const id = typeof rowOrId === "string"
    ? rowOrId
    : instrumentIdFromBaoStockCode(row.code);
  const normalized = String(id ?? "").toUpperCase();
  const [code, exchange = ""] = normalized.split(".");
  if (!EXCHANGES.has(exchange)) return "other";
  if ((exchange === "SH" && code.startsWith("000")) || (exchange === "SZ" && code.startsWith("399"))) return "index";
  if (/^(110|113|123|127|128)\d{3}$/.test(code)) return "convertible-bond";
  if (/^5\d{5}$/.test(code) || /^(15|16|18|51|56|58)\d{4}$/.test(code)) return "fund";
  if (/^(0|2|3|4|6|8)\d{5}$/.test(code)) return "stock";
  return "other";
}

export function normalizeBaoStockCatalog(rows) {
  const instruments = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = instrumentIdFromBaoStockCode(row?.code);
    if (!id || seen.has(id)) continue;
    const assetType = classifyBaoStockInstrument(row);
    const name = String(row?.code_name ?? row?.name ?? "").trim() || fallbackInstrumentName(id, assetType);
    const code = baoStockCodeFromInstrumentId(id);
    const ipoTimestamp = dateTimestamp(row?.ipoDate) || Date.UTC(1990, 0, 1);
    const outDate = dateTimestamp(row?.outDate);
    seen.add(id);
    instruments.push({
      id,
      symbol: id,
      baostockCode: code,
      name,
      market: "CN",
      exchange: id.split(".")[1],
      timezone: "Asia/Shanghai",
      pricePrecision: assetType === "index" ? 2 : 2,
      assetType,
      status: String(row?.status ?? row?.tradeStatus ?? "1"),
      firstTimestamp: ipoTimestamp,
      outTimestamp: outDate || null,
      barCount: 0,
      lastTimestamp: 0,
      timeframes: [],
      source: BAOSTOCK_SOURCE,
    });
  }
  return instruments.sort((left, right) => left.id.localeCompare(right.id));
}

export function coverageForCandles(candles) {
  const daily = Array.isArray(candles) ? candles : [];
  const weekly = aggregateWeekly(daily);
  const monthly = aggregateMonthly(daily);
  const coverage = (bars) => ({
    barCount: bars.length,
    firstTimestamp: bars[0]?.timestamp ?? 0,
    lastTimestamp: bars.at(-1)?.timestamp ?? 0,
  });
  return {
    "1d": coverage(daily),
    "1w": coverage(weekly),
    "1mo": coverage(monthly),
  };
}

export { aggregateMonthly, aggregateWeekly, cnPriceLimitRatio };
