export function normalizeLiveScanLookbackDays(value: unknown): number;
export function findRecentCandleMatch<T, R extends { timestamp: number; presetIds: string[]; presetNames: string[] }>(
  candles: T[], lookbackDays: unknown, evaluate: (history: T[], applyFilters: boolean) => R | null,
): (R & { matchedTimestamp: number; lagTradingDays: number }) | null;
export function restrictMatchesToMarketDays<T extends { matchedTimestamp: number }>(
  results: T[], timestamps: Iterable<number>, lookbackDays: unknown,
): Array<T & { lagTradingDays: number }>;
