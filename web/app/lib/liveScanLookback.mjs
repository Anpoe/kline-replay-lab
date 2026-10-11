export function normalizeLiveScanLookbackDays(value) {
  const days = Number(value);
  return Number.isFinite(days) ? Math.min(60, Math.max(1, Math.round(days))) : 1;
}

// Each evaluation receives only the history available at that close.
export function findRecentCandleMatch(candles, lookbackDays, evaluate) {
  const latest = evaluate(candles, false);
  if (!latest) return null;
  const days = normalizeLiveScanLookbackDays(lookbackDays);
  for (let lag = 0; lag < Math.min(days, candles.length); lag += 1) {
    const history = lag === 0 ? candles : candles.slice(0, candles.length - lag);
    const match = evaluate(history, true);
    if (match) return {
      ...latest,
      presetIds: match.presetIds,
      presetNames: match.presetNames,
      matchedTimestamp: match.timestamp,
      lagTradingDays: lag,
    };
  }
  return null;
}

// Market sessions, rather than a suspended symbol's bar count, define the range.
export function restrictMatchesToMarketDays(results, timestamps, lookbackDays) {
  const dates = [...new Set(timestamps)].sort((left, right) => right - left);
  const ages = new Map(dates.slice(0, normalizeLiveScanLookbackDays(lookbackDays))
    .map((timestamp, age) => [timestamp, age]));
  return results.flatMap((result) => {
    const age = ages.get(result.matchedTimestamp);
    return age == null ? [] : [{ ...result, lagTradingDays: age }];
  });
}
