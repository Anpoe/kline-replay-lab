const RECORD_SIZE = 32;

export function instrumentIdFromEntry(entryPath) {
  const normalized = entryPath.replaceAll("\\", "/").toLowerCase();
  const match = normalized.match(/(?:^|\/)(sh|sz|bj)(\d{6})\.day$/);
  if (!match) return null;
  return `${match[2]}.${match[1].toUpperCase()}`;
}

export function classifyTdxInstrument(instrumentId) {
  const [code, exchange = ""] = instrumentId.split(".");
  if (exchange === "SH") {
    if (code.startsWith("000")) return "index";
    if (/^(110|113)/.test(code)) return "convertible-bond";
    if (/^(5|51|56|58)/.test(code)) return "fund";
    if (/^(600|601|603|605|688|689)/.test(code)) return "stock";
  }
  if (exchange === "SZ") {
    if (code.startsWith("399")) return "index";
    if (/^(123|127|128)/.test(code)) return "convertible-bond";
    if (/^(15|16|18)/.test(code)) return "fund";
    if (/^(000|001|002|003|300|301)/.test(code)) return "stock";
  }
  if (exchange === "BJ") {
    if (/^[489]/.test(code)) return "stock";
  }
  return "other";
}

export function cnPriceLimitRatio(instrumentId) {
  const normalized = String(instrumentId).toUpperCase();
  if (/^(?:688|689)\d{3}\.SH$/.test(normalized)) return 0.2;
  if (/^(?:300|301)\d{3}\.SZ$/.test(normalized)) return 0.2;
  if (/^[489]\d{5}\.BJ$/.test(normalized)) return 0.3;
  return 0.1;
}

export function fallbackInstrumentName(instrumentId, assetType = classifyTdxInstrument(instrumentId)) {
  const [code, exchange] = instrumentId.split(".");
  const exchangeName = { SH: "沪", SZ: "深", BJ: "北" }[exchange] ?? exchange;
  const typeName = {
    stock: "股票",
    index: "指数",
    fund: "基金",
    "convertible-bond": "可转债",
    other: "证券",
  }[assetType];
  return `${exchangeName}${typeName} ${code}`;
}

function validRecord(date, open, high, low, close) {
  const year = Math.trunc(date / 10000);
  const month = Math.trunc((date % 10000) / 100);
  const day = date % 100;
  return (
    year >= 1990 &&
    year <= 2100 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= 31 &&
    open > 0 &&
    high >= Math.max(open, close) &&
    low > 0 &&
    low <= Math.min(open, close)
  );
}

export function parseTdxDayBuffer(buffer, options = {}) {
  const startTimestamp = Number(options.startTimestamp ?? Number.NEGATIVE_INFINITY);
  const endTimestamp = Number(options.endTimestamp ?? Number.POSITIVE_INFINITY);
  const bars = [];
  const completeLength = buffer.length - (buffer.length % RECORD_SIZE);
  for (let offset = 0; offset < completeLength; offset += RECORD_SIZE) {
    const date = buffer.readInt32LE(offset);
    const openRaw = buffer.readInt32LE(offset + 4);
    const highRaw = buffer.readInt32LE(offset + 8);
    const lowRaw = buffer.readInt32LE(offset + 12);
    const closeRaw = buffer.readInt32LE(offset + 16);
    if (!validRecord(date, openRaw, highRaw, lowRaw, closeRaw)) continue;
    const year = Math.trunc(date / 10000);
    const month = Math.trunc((date % 10000) / 100);
    const day = date % 100;
    const timestamp = Date.UTC(year, month - 1, day);
    if (timestamp < startTimestamp || timestamp > endTimestamp) continue;
    bars.push({
      timestamp,
      open: openRaw / 100,
      high: highRaw / 100,
      low: lowRaw / 100,
      close: closeRaw / 100,
      turnover: Number(buffer.readFloatLE(offset + 20).toFixed(2)),
      volume: buffer.readInt32LE(offset + 24),
    });
  }
  // Some vendor packages contain an exact duplicate record or a late-added
  // record out of order. Keep one canonical bar per session so coverage,
  // chart merges and rolling indicators do not count the same day twice.
  const canonical = new Map();
  for (const bar of bars) canonical.set(bar.timestamp, bar);
  return [...canonical.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function isoWeekKey(timestamp) {
  const date = new Date(timestamp);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

export function aggregateWeekly(bars) {
  const weekly = [];
  let activeKey = "";
  let current = null;
  for (const bar of bars) {
    const key = isoWeekKey(bar.timestamp);
    if (key !== activeKey) {
      if (current) weekly.push(current);
      activeKey = key;
      current = { ...bar };
      continue;
    }
    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    current.volume = Number(current.volume ?? 0) + Number(bar.volume ?? 0);
    current.turnover = Number(current.turnover ?? 0) + Number(bar.turnover ?? 0);
  }
  if (current) weekly.push(current);
  return weekly;
}

function monthKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function aggregateMonthly(bars) {
  const monthly = [];
  let activeKey = "";
  let current = null;
  for (const bar of bars) {
    const key = monthKey(bar.timestamp);
    if (key !== activeKey) {
      if (current) monthly.push(current);
      activeKey = key;
      current = { ...bar };
      continue;
    }
    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    current.volume = Number(current.volume ?? 0) + Number(bar.volume ?? 0);
    current.turnover = Number(current.turnover ?? 0) + Number(bar.turnover ?? 0);
  }
  if (current) monthly.push(current);
  return monthly;
}

export const TDX_DAY_RECORD_SIZE = RECORD_SIZE;
