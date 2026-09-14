import {
  buildAlpacaMultiSymbolUrl,
  type AlpacaFeed,
  type SupportedTimeframe,
} from "./marketDataProviders.ts";

export const US_SYNC_POINT_BUDGET = 9_500;
export const US_SYNC_MAX_URL_LENGTH = 6_500;
export const US_SYNC_REQUEST_SPACING_MS = 400;
export const US_SYNC_MAX_CONCURRENT_BATCHES = 2;
export const US_SYNC_MAX_ATTEMPTS = 5;

export type MarketSyncMode = "initialize" | "update";

export function isMarketSyncRunTerminal(input: {
  queuedBatches: number;
  runningBatches: number;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
}) {
  return input.queuedBatches === 0
    && input.runningBatches === 0
    && input.completedJobs + input.failedJobs >= input.totalJobs;
}

export type AlpacaBatchPlan = {
  batchNo: number;
  symbols: string[];
  startDate: string;
  endDate: string;
  sessionCount: number;
  estimatedPoints: number;
  urlLength: number;
};

export type PlanAlpacaBatchesInput = {
  symbols: string[];
  startDate: string;
  endDate: string;
  sessionCount: number;
  feed?: AlpacaFeed;
  timeframe?: SupportedTimeframe;
  pointBudget?: number;
  maxUrlLength?: number;
};

function dateOffset(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeSymbols(symbols: string[]) {
  return [...new Set(
    symbols
      .map((symbol) => String(symbol).trim().toUpperCase())
      .filter(Boolean),
  )].sort();
}

export function countWeekdaySessions(startDate: string, endDate: string) {
  if (endDate < startDate) return 0;
  let current = startDate;
  let count = 0;
  while (current <= endDate) {
    const day = new Date(`${current}T12:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    current = dateOffset(current, 1);
  }
  return count;
}

export function countTradingSessions(
  startDate: string,
  endDate: string,
  calendarDates: string[],
) {
  if (endDate < startDate) return 0;
  const dates = new Set(calendarDates);
  return [...dates].filter((date) => date >= startDate && date <= endDate).length;
}

export function planAlpacaBatches(input: PlanAlpacaBatchesInput): AlpacaBatchPlan[] {
  const symbols = normalizeSymbols(input.symbols);
  if (!symbols.length || input.endDate < input.startDate) return [];

  const sessionCount = Math.max(1, Math.floor(input.sessionCount));
  const pointBudget = Math.max(1, Math.floor(input.pointBudget ?? US_SYNC_POINT_BUDGET));
  const maxUrlLength = Math.max(1_000, Math.floor(input.maxUrlLength ?? US_SYNC_MAX_URL_LENGTH));
  const feed = input.feed ?? "sip";
  const timeframe = input.timeframe ?? "1d";
  const maxSymbolsByPoints = Math.max(1, Math.floor(pointBudget / sessionCount));
  const batches: AlpacaBatchPlan[] = [];
  let current: string[] = [];

  const flush = () => {
    if (!current.length) return;
    const urlLength = buildAlpacaMultiSymbolUrl({
      symbols: current,
      timeframe,
      startDate: input.startDate,
      endDate: input.endDate,
      feed,
      limit: 10_000,
    }).length;
    batches.push({
      batchNo: batches.length + 1,
      symbols: [...current],
      startDate: input.startDate,
      endDate: input.endDate,
      sessionCount,
      estimatedPoints: current.length * sessionCount,
      urlLength,
    });
    current = [];
  };

  for (const symbol of symbols) {
    const candidate = [...current, symbol];
    const candidateUrlLength = buildAlpacaMultiSymbolUrl({
      symbols: candidate,
      timeframe,
      startDate: input.startDate,
      endDate: input.endDate,
      feed,
      limit: 10_000,
    }).length;
    const exceedsPointBudget = candidate.length > maxSymbolsByPoints;
    const exceedsUrlBudget = candidateUrlLength > maxUrlLength;
    if (current.length && (exceedsPointBudget || exceedsUrlBudget)) flush();
    current.push(symbol);
  }
  flush();
  return batches;
}

export function splitSymbols(symbols: string[]) {
  const normalized = normalizeSymbols(symbols);
  if (normalized.length <= 1) return [normalized];
  const middle = Math.ceil(normalized.length / 2);
  return [normalized.slice(0, middle), normalized.slice(middle)];
}

export function isAlpacaUrlTooLongError(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "status" in error
    && Number((error as { status?: unknown }).status) === 414,
  );
}

export function isAlpacaPermissionError(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "status" in error
    && Number((error as { status?: unknown }).status) === 403,
  );
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "未知错误");
}
