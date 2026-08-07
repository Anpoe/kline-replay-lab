/**
 * Server-side, source-neutral parsing primitives for Dukascopy-style CSV data.
 *
 * Dukascopy's public export page documents CSV export, but the page does not
 * promise a stable machine endpoint or one fixed column layout.  This module
 * therefore accepts common CSV variants and keeps endpoint selection in the
 * client module rather than baking a URL into the parser.
 */

export type FxCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  turnover: number | null;
};

export type DukascopyCsvIssueCode =
  | "malformed-row"
  | "invalid-timestamp"
  | "invalid-price"
  | "invalid-volume"
  | "invalid-ohlc"
  | "duplicate-timestamp";

export type DukascopyCsvIssue = {
  lineNumber: number;
  code: DukascopyCsvIssueCode;
  message: string;
  raw?: string;
};

export type DukascopyQualityReport = {
  received: number;
  accepted: number;
  invalid: number;
  duplicates: number;
  outOfOrder: number;
  abnormalOhlc: number;
  firstTimestamp?: number;
  lastTimestamp?: number;
  issues: DukascopyCsvIssue[];
  suppressedIssueCount: number;
};

export type DukascopyCsvOptions = {
  /** Explicit delimiter. When omitted, comma/semicolon/tab/pipe are detected. */
  delimiter?: string;
  /** Time zone used only for date-times that have no explicit offset. */
  timestampTimeZone?: string;
  timestampUnit?: "auto" | "seconds" | "milliseconds" | "microseconds";
  duplicatePolicy?: "keep-first";
  /** Keep at most this many representative bad-row issues. */
  maxIssues?: number;
  /** Used for a numeric field with a comma but no dot. */
  decimalSeparator?: "auto" | "." | ",";
};

export type DukascopyParsedRow = {
  lineNumber: number;
  kind: "empty" | "comment" | "header" | "accepted" | "invalid" | "duplicate";
  candle?: FxCandle;
  issue?: DukascopyCsvIssue;
};

export type DukascopyCsvParser = {
  pushLine(line: string): DukascopyParsedRow;
  finish(): DukascopyQualityReport;
};

export type DukascopyParseResult = {
  candles: FxCandle[];
  report: DukascopyQualityReport;
};

type HeaderMapping = {
  timestampIndex?: number;
  dateIndex?: number;
  timeIndex?: number;
  openIndex: number;
  highIndex: number;
  lowIndex: number;
  closeIndex: number;
  volumeIndex?: number;
};

type RowLayout = {
  fields: string[];
  mapping?: HeaderMapping;
};

const DEFAULT_OPTIONS: Required<Pick<DukascopyCsvOptions, "timestampTimeZone" | "timestampUnit" | "duplicatePolicy" | "maxIssues" | "decimalSeparator">> = {
  timestampTimeZone: "UTC",
  timestampUnit: "auto",
  duplicatePolicy: "keep-first",
  maxIssues: 100,
  decimalSeparator: "auto",
};

const EMPTY_MARKERS = new Set(["", "-", "—", "null", "n/a", "na", "none"]);
const HEADER_ALIASES = {
  timestamp: new Set(["timestamp", "timestampms", "ts", "epoch", "epochms", "unix", "datetime", "datetimeutc", "utc", "time_stamp"]),
  date: new Set(["date", "day", "tradingdate"]),
  time: new Set(["time", "timeofday", "hour"]),
  open: new Set(["open", "o", "bidopen", "askopen", "openprice"]),
  high: new Set(["high", "h", "bidhigh", "askhigh", "highprice"]),
  low: new Set(["low", "l", "bidlow", "asklow", "lowprice"]),
  close: new Set(["close", "c", "bidclose", "askclose", "closeprice"]),
  volume: new Set(["volume", "vol", "tickvolume", "ticks", "tickvol"]),
} as const;

function cleanField(value: string | undefined) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim();
}

function normalizeHeader(value: string) {
  return cleanField(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
    .replace(/[()\[\].]/g, "");
}

function hasExplicitTimeZone(value: string) {
  return /(?:z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
}

function datePartsToUtcMs(year: number, month: number, day: number, hour: number, minute: number, second: number, millisecond: number) {
  const candidate = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const check = new Date(candidate);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return null;
  }
  return candidate;
}

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function localDateTimeParts(timestamp: number, timeZone: string): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = new Map(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  };
}

function zonedDateTimeToUtcMs(parts: LocalDateTimeParts, timeZone: string) {
  if (timeZone === "UTC" || timeZone === "Etc/UTC" || timeZone === "GMT") {
    return datePartsToUtcMs(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second, 0);
  }

  const wallClockAsUtc = datePartsToUtcMs(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second, 0);
  if (wallClockAsUtc == null) return null;
  let guess = wallClockAsUtc;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const actual = localDateTimeParts(guess, timeZone);
    const actualAsUtc = datePartsToUtcMs(actual.year, actual.month, actual.day, actual.hour, actual.minute, actual.second, 0);
    if (actualAsUtc == null) return null;
    const offset = actualAsUtc - guess;
    guess = wallClockAsUtc - offset;
  }
  return Number.isFinite(guess) ? guess : null;
}

function parseDateTimeText(value: string, timeZone: string) {
  const raw = cleanField(value).replace(/\u00a0/g, " ");
  if (!raw) return null;

  const explicitZone = hasExplicitTimeZone(raw);
  if (explicitZone) {
    const parsed = Date.parse(raw.replace(/\.(?=\d{1,3}(?:Z|[+-]\d{2}:?\d{2})$)/i, "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  const match = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?$/);
  if (!match) {
    const compact = raw.match(/^(\d{4})(\d{2})(\d{2})(?:[ T]+(\d{2})(\d{2})(\d{2})?)?$/);
    if (!compact) return null;
    const milliseconds = 0;
    const parts: LocalDateTimeParts = {
      year: Number(compact[1]),
      month: Number(compact[2]),
      day: Number(compact[3]),
      hour: Number(compact[4] ?? 0),
      minute: Number(compact[5] ?? 0),
      second: Number(compact[6] ?? 0),
    };
    const timestamp = zonedDateTimeToUtcMs(parts, timeZone);
    return timestamp == null ? null : timestamp + milliseconds;
  }

  const fraction = match[7] ? Number(`0.${match[7]}`) * 1000 : 0;
  const parts: LocalDateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
  };
  if (![parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second, fraction].every(Number.isFinite)) {
    return null;
  }
  const timestamp = zonedDateTimeToUtcMs(parts, timeZone);
  return timestamp == null ? null : timestamp + Math.floor(fraction);
}

function parseTimestamp(value: string, options: Required<Pick<DukascopyCsvOptions, "timestampTimeZone" | "timestampUnit">>) {
  const raw = cleanField(value);
  if (!raw) return null;
  const numeric = Number(raw.replace(/[,\s]/g, ""));
  if (raw !== "" && Number.isFinite(numeric) && /^[+-]?\d+(?:\.\d+)?$/.test(raw.replace(/\s/g, ""))) {
    const absolute = Math.abs(numeric);
    let timestamp = numeric;
    if (options.timestampUnit === "seconds" || (options.timestampUnit === "auto" && absolute >= 1e9 && absolute < 1e11)) {
      timestamp *= 1000;
    } else if (options.timestampUnit === "microseconds" || (options.timestampUnit === "auto" && absolute >= 1e14)) {
      timestamp /= 1000;
    }
    if (options.timestampUnit === "milliseconds" || options.timestampUnit === "auto") {
      if (options.timestampUnit === "auto" && absolute >= 1e11 && absolute < 1e14) timestamp = numeric;
    }
    if (Number.isFinite(timestamp) && timestamp >= -8.64e15 && timestamp <= 8.64e15) return Math.trunc(timestamp);
    return null;
  }
  const parsed = parseDateTimeText(raw, options.timestampTimeZone);
  return parsed == null || !Number.isFinite(parsed) ? null : Math.trunc(parsed);
}

function parseNumber(value: string | undefined, options: Required<Pick<DukascopyCsvOptions, "decimalSeparator">>) {
  const raw = cleanField(value);
  if (EMPTY_MARKERS.has(raw.toLowerCase())) return null;
  let normalized = raw.replace(/\s/g, "");
  if (options.decimalSeparator === "," || (options.decimalSeparator === "auto" && normalized.includes(",") && !normalized.includes("."))) {
    normalized = normalized.replace(/,/g, ".");
  } else {
    normalized = normalized.replace(/,/g, "");
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function splitDelimitedLine(line: string, delimiter: string | null) {
  if (delimiter === null) return cleanField(line).split(/\s+/g);
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  fields.push(field);
  return fields;
}

function countDelimiter(line: string, delimiter: string) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') quoted = !quoted;
    else if (character === delimiter && !quoted) count += 1;
  }
  return count;
}

function detectDelimiter(line: string) {
  const candidates = [",", ";", "\t", "|"];
  let selected: string | null = null;
  let best = 0;
  for (const candidate of candidates) {
    const score = countDelimiter(line, candidate);
    if (score > best) {
      selected = candidate;
      best = score;
    }
  }
  return selected;
}

function isComment(line: string) {
  const value = cleanField(line);
  return value.startsWith("#") || value.startsWith("//") || value.startsWith(";") && !value.slice(1).includes(";");
}

function isHeader(fields: string[]) {
  const normalized = fields.map(normalizeHeader);
  const hasPriceHeader = normalized.some((value) => HEADER_ALIASES.open.has(value)) &&
    normalized.some((value) => HEADER_ALIASES.high.has(value)) &&
    normalized.some((value) => HEADER_ALIASES.low.has(value)) &&
    normalized.some((value) => HEADER_ALIASES.close.has(value));
  const hasTimeHeader = normalized.some((value) => HEADER_ALIASES.timestamp.has(value)) ||
    normalized.some((value) => HEADER_ALIASES.date.has(value));
  return hasPriceHeader && hasTimeHeader;
}

function makeHeaderMapping(fields: string[]): HeaderMapping | null {
  const normalized = fields.map(normalizeHeader);
  const find = (aliases: ReadonlySet<string>) => normalized.findIndex((value) => aliases.has(value));
  const openIndex = find(HEADER_ALIASES.open);
  const highIndex = find(HEADER_ALIASES.high);
  const lowIndex = find(HEADER_ALIASES.low);
  const closeIndex = find(HEADER_ALIASES.close);
  if ([openIndex, highIndex, lowIndex, closeIndex].some((index) => index < 0)) return null;
  const timestampIndex = find(HEADER_ALIASES.timestamp);
  const dateIndex = find(HEADER_ALIASES.date);
  const timeIndex = find(HEADER_ALIASES.time);
  return {
    timestampIndex: timestampIndex >= 0 ? timestampIndex : dateIndex < 0 && timeIndex >= 0 ? timeIndex : undefined,
    dateIndex: dateIndex >= 0 ? dateIndex : undefined,
    timeIndex: dateIndex >= 0 && timeIndex >= 0 ? timeIndex : undefined,
    openIndex,
    highIndex,
    lowIndex,
    closeIndex,
    volumeIndex: (() => {
      const index = find(HEADER_ALIASES.volume);
      return index >= 0 ? index : undefined;
    })(),
  };
}

function looksLikeDate(value: string) {
  return /^\d{4}(?:[-/.]\d{1,2}(?:[-/.]\d{1,2})?|\d{4})/.test(cleanField(value));
}

function looksLikeClock(value: string) {
  return /^\d{1,2}:\d{2}(?::\d{2})?/.test(cleanField(value));
}

function positionalLayout(fields: string[]): HeaderMapping {
  const dateAndTime = fields.length >= 6 && looksLikeDate(fields[0]) && looksLikeClock(fields[1]);
  if (dateAndTime) {
    return {
      dateIndex: 0,
      timeIndex: 1,
      openIndex: 2,
      highIndex: 3,
      lowIndex: 4,
      closeIndex: 5,
      volumeIndex: fields.length > 6 ? 6 : undefined,
    };
  }
  return {
    timestampIndex: 0,
    openIndex: 1,
    highIndex: 2,
    lowIndex: 3,
    closeIndex: 4,
    volumeIndex: fields.length > 5 ? 5 : undefined,
  };
}

function issueMessage(code: DukascopyCsvIssueCode) {
  switch (code) {
    case "malformed-row": return "行字段数量不足或无法识别列布局";
    case "invalid-timestamp": return "时间戳或日期时间无法解析为 UTC 毫秒";
    case "invalid-price": return "OHLC 存在缺失、非有限数值或非正价格";
    case "invalid-volume": return "volume 不是非负有限数值";
    case "invalid-ohlc": return "OHLC 不满足 low <= min(open, close) <= max(open, close) <= high";
    case "duplicate-timestamp": return "时间戳重复，按 keep-first 丢弃后续行";
  }
}

function makeReport(): DukascopyQualityReport {
  return {
    received: 0,
    accepted: 0,
    invalid: 0,
    duplicates: 0,
    outOfOrder: 0,
    abnormalOhlc: 0,
    issues: [],
    suppressedIssueCount: 0,
  };
}

function cloneReport(report: DukascopyQualityReport): DukascopyQualityReport {
  return { ...report, issues: report.issues.map((issue) => ({ ...issue })) };
}

function addIssue(report: DukascopyQualityReport, issue: DukascopyCsvIssue, maxIssues: number) {
  if (report.issues.length < maxIssues) report.issues.push(issue);
  else report.suppressedIssueCount += 1;
}

function createIssue(lineNumber: number, code: DukascopyCsvIssueCode, raw: string): DukascopyCsvIssue {
  return {
    lineNumber,
    code,
    message: issueMessage(code),
    raw: raw.length > 240 ? `${raw.slice(0, 240)}…` : raw,
  };
}

function rowValues(layout: RowLayout, options: Required<Pick<DukascopyCsvOptions, "timestampTimeZone" | "timestampUnit" | "decimalSeparator">>) {
  const mapping = layout.mapping ?? positionalLayout(layout.fields);
  const fields = layout.fields;
  let timestampText = mapping.timestampIndex == null ? "" : fields[mapping.timestampIndex];
  if (mapping.timestampIndex == null && mapping.dateIndex != null) {
    timestampText = fields[mapping.dateIndex] ?? "";
    if (mapping.timeIndex != null && cleanField(fields[mapping.timeIndex])) timestampText += ` ${fields[mapping.timeIndex]}`;
  }
  const timestamp = parseTimestamp(timestampText, options);
  const open = parseNumber(fields[mapping.openIndex], options);
  const high = parseNumber(fields[mapping.highIndex], options);
  const low = parseNumber(fields[mapping.lowIndex], options);
  const close = parseNumber(fields[mapping.closeIndex], options);
  const volume = mapping.volumeIndex == null ? null : parseNumber(fields[mapping.volumeIndex], options);
  const volumeText = mapping.volumeIndex == null ? "" : cleanField(fields[mapping.volumeIndex]);
  return { timestamp, open, high, low, close, volume, volumeText };
}

export function createDukascopyCsvParser(inputOptions: DukascopyCsvOptions = {}): DukascopyCsvParser {
  const options = { ...DEFAULT_OPTIONS, ...inputOptions };
  if (options.duplicatePolicy !== "keep-first") throw new Error("Dukascopy CSV streaming parser only supports duplicatePolicy=keep-first");
  const report = makeReport();
  const seen = new Set<number>();
  let delimiter: string | null | undefined = options.delimiter;
  let headerResolved = false;
  let mapping: HeaderMapping | undefined;
  let lineNumber = 0;
  let previousTimestamp: number | undefined;

  const pushLine = (line: string): DukascopyParsedRow => {
    lineNumber += 1;
    const cleaned = String(line ?? "").replace(/\r$/, "");
    const trimmed = cleanField(cleaned);
    if (!trimmed) return { lineNumber, kind: "empty" };
    if (isComment(trimmed)) return { lineNumber, kind: "comment" };
    if (delimiter === undefined) delimiter = detectDelimiter(cleaned);
    const fields = splitDelimitedLine(cleaned, delimiter ?? null);
    if (!headerResolved) {
      headerResolved = true;
      if (isHeader(fields)) {
        mapping = makeHeaderMapping(fields) ?? undefined;
        return { lineNumber, kind: "header" };
      }
    }

    report.received += 1;
    const layout: RowLayout = { fields, mapping };
    const minimumFieldCount = mapping
      ? Math.max(mapping.openIndex, mapping.highIndex, mapping.lowIndex, mapping.closeIndex, mapping.timestampIndex ?? -1, mapping.dateIndex ?? -1, mapping.timeIndex ?? -1) + 1
      : 5;
    if (fields.length < minimumFieldCount) {
      report.invalid += 1;
      const issue = createIssue(lineNumber, "malformed-row", cleaned);
      addIssue(report, issue, options.maxIssues);
      return { lineNumber, kind: "invalid", issue };
    }

    const values = rowValues(layout, options);
    if (values.timestamp == null) {
      report.invalid += 1;
      const issue = createIssue(lineNumber, "invalid-timestamp", cleaned);
      addIssue(report, issue, options.maxIssues);
      return { lineNumber, kind: "invalid", issue };
    }
    if (![values.open, values.high, values.low, values.close].every((value) => value != null && Number.isFinite(value) && value > 0)) {
      report.invalid += 1;
      const issue = createIssue(lineNumber, "invalid-price", cleaned);
      addIssue(report, issue, options.maxIssues);
      return { lineNumber, kind: "invalid", issue };
    }
    if (mapping?.volumeIndex != null && values.volume == null && !EMPTY_MARKERS.has(values.volumeText.toLowerCase())) {
      report.invalid += 1;
      const issue = createIssue(lineNumber, "invalid-volume", cleaned);
      addIssue(report, issue, options.maxIssues);
      return { lineNumber, kind: "invalid", issue };
    }
    if (values.volume != null && (!Number.isFinite(values.volume) || values.volume < 0)) {
      report.invalid += 1;
      const issue = createIssue(lineNumber, "invalid-volume", cleaned);
      addIssue(report, issue, options.maxIssues);
      return { lineNumber, kind: "invalid", issue };
    }

    const open = values.open as number;
    const high = values.high as number;
    const low = values.low as number;
    const close = values.close as number;
    if (low > Math.min(open, close) || high < Math.max(open, close) || low > high) {
      report.invalid += 1;
      report.abnormalOhlc += 1;
      const issue = createIssue(lineNumber, "invalid-ohlc", cleaned);
      addIssue(report, issue, options.maxIssues);
      return { lineNumber, kind: "invalid", issue };
    }

    if (previousTimestamp != null && values.timestamp < previousTimestamp) report.outOfOrder += 1;
    previousTimestamp = values.timestamp;
    if (seen.has(values.timestamp)) {
      report.duplicates += 1;
      const issue = createIssue(lineNumber, "duplicate-timestamp", cleaned);
      addIssue(report, issue, options.maxIssues);
      return { lineNumber, kind: "duplicate", issue };
    }
    seen.add(values.timestamp);
    const candle: FxCandle = {
      timestamp: values.timestamp,
      open,
      high,
      low,
      close,
      volume: values.volume,
      turnover: null,
    };
    report.accepted += 1;
    report.firstTimestamp = report.firstTimestamp == null ? candle.timestamp : Math.min(report.firstTimestamp, candle.timestamp);
    report.lastTimestamp = report.lastTimestamp == null ? candle.timestamp : Math.max(report.lastTimestamp, candle.timestamp);
    return { lineNumber, kind: "accepted", candle };
  };

  return {
    pushLine,
    finish: () => cloneReport(report),
  };
}

export function parseDukascopyCsv(input: string | Iterable<string>, inputOptions: DukascopyCsvOptions = {}): DukascopyParseResult {
  const parser = createDukascopyCsvParser(inputOptions);
  const candles: FxCandle[] = [];
  const lines = typeof input === "string" ? splitDukascopyCsvText(input) : input;
  for (const line of lines) {
    const parsed = parser.pushLine(line);
    if (parsed.candle) candles.push(parsed.candle);
  }
  return { candles, report: parser.finish() };
}

export async function parseDukascopyCsvAsync(input: AsyncIterable<string | Uint8Array>, inputOptions: DukascopyCsvOptions = {}): Promise<DukascopyParseResult> {
  const parser = createDukascopyCsvParser(inputOptions);
  const candles: FxCandle[] = [];
  for await (const line of splitDukascopyCsvChunks(input)) {
    const parsed = parser.pushLine(line);
    if (parsed.candle) candles.push(parsed.candle);
  }
  return { candles, report: parser.finish() };
}

export function* splitDukascopyCsvText(text: string): Generator<string> {
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\n") continue;
    yield text.slice(start, index).replace(/\r$/, "");
    start = index + 1;
  }
  if (start < text.length) yield text.slice(start).replace(/\r$/, "");
}

export async function* splitDukascopyCsvChunks(chunks: AsyncIterable<string | Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of chunks) {
    pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let newlineIndex = pending.indexOf("\n");
    while (newlineIndex >= 0) {
      yield pending.slice(0, newlineIndex).replace(/\r$/, "");
      pending = pending.slice(newlineIndex + 1);
      newlineIndex = pending.indexOf("\n");
    }
  }
  pending += decoder.decode();
  if (pending) yield pending.replace(/\r$/, "");
}
