const DAY_MS = 86_400_000;
const CN_TIME_ZONE = "Asia/Shanghai";
const CN_MARKET_CLOSE_MINUTES = 15 * 60;

function dateText(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function formatDate(timestamp, format) {
  const iso = dateText(timestamp);
  return format === "compact" ? iso.replaceAll("-", "") : iso;
}

function timestampFromDate(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  if (!match) return Number.NaN;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(timestamp);
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3])
    ? timestamp
    : Number.NaN;
}

function cnNowParts(nowProvider) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(nowProvider());
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/**
 * Return the most recent weekday whose 15:00 China close has passed.
 * Holidays are intentionally left to the provider trading calendar; a
 * provider response with no rows is treated as a non-trading day.
 */
export function latestClosedCnDate(nowProvider = () => new Date(), format = "iso") {
  const values = cnNowParts(nowProvider);
  let timestamp = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
  const weekday = new Date(timestamp).getUTCDay();
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  if (weekday === 0 || weekday === 6 || minutes < CN_MARKET_CLOSE_MINUTES) timestamp -= DAY_MS;
  while ([0, 6].includes(new Date(timestamp).getUTCDay())) timestamp -= DAY_MS;
  return formatDate(timestamp, format);
}

/**
 * Return the latest date for which a TDX real-time quote is safe to treat as a
 * closed daily bar. Before a weekday close, the quote may belong to the
 * current session or may still be yesterday's snapshot, so it must not be
 * stamped as a date. On weekends, the latest completed weekday remains safe.
 */
export function latestClosedRealtimeDate(nowProvider = () => new Date(), format = "iso") {
  const values = cnNowParts(nowProvider);
  let timestamp = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
  const weekday = new Date(timestamp).getUTCDay();
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  if (weekday === 0 || weekday === 6) {
    timestamp -= (weekday === 0 ? 2 : 1) * DAY_MS;
    while ([0, 6].includes(new Date(timestamp).getUTCDay())) timestamp -= DAY_MS;
    return formatDate(timestamp, format);
  }
  if (minutes < CN_MARKET_CLOSE_MINUTES) return null;
  return formatDate(timestamp, format);
}

export function closedCnDateWindow(nowProvider = () => new Date(), repairDays = 30, format = "iso") {
  const days = Math.min(120, Math.max(1, Math.trunc(Number(repairDays) || 30)));
  const endDate = latestClosedCnDate(nowProvider, "iso");
  const endTimestamp = timestampFromDate(endDate);
  const startTimestamp = Math.max(Date.UTC(1990, 0, 1), endTimestamp - (days - 1) * DAY_MS);
  const dates = [];
  for (let timestamp = startTimestamp; timestamp <= endTimestamp; timestamp += DAY_MS) {
    const weekday = new Date(timestamp).getUTCDay();
    if (weekday !== 0 && weekday !== 6) dates.push(formatDate(timestamp, format));
  }
  return {
    startDate: formatDate(startTimestamp, format),
    endDate: formatDate(endTimestamp, format),
    dates,
  };
}
