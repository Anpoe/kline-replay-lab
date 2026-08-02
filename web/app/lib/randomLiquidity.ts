import { tradingDate } from "./marketRules.ts";
import type { RandomTrainingConfig } from "./trainingTasks.ts";

export type LiquidityCandle = {
  timestamp: number;
  close: number;
  volume?: number | null;
};

export function isUsMarket(market: string) {
  return market === "美股" || market.toUpperCase() === "US";
}

export function trailingAverageDailyDollarVolume(
  candles: LiquidityCandle[],
  startIndex: number,
  timezone: string,
  timeframe: string,
  lookbackSessions = 20,
) {
  const sessions = new Map<string, number>();
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const candle = candles[index];
    const session = tradingDate(candle.timestamp, timezone);
    if (!sessions.has(session) && sessions.size >= lookbackSessions) break;
    const dollarVolume = Math.max(0, Number(candle.close) || 0) * Math.max(0, Number(candle.volume) || 0);
    sessions.set(session, (sessions.get(session) ?? 0) + dollarVolume);
  }
  if (sessions.size < Math.min(10, lookbackSessions)) return 0;
  const total = [...sessions.values()].reduce((sum, value) => sum + value, 0);
  const weeklyDivisor = timeframe === "1w" ? 5 : 1;
  return total / sessions.size / weeklyDivisor;
}

export function randomEligibleStartIndices(
  candles: LiquidityCandle[],
  timezone: string,
  timeframe: string,
  requestedLength: number,
  config: RandomTrainingConfig,
  market: string,
) {
  const maximumIndex = candles.length - 1 - Math.max(1, requestedLength);
  if (maximumIndex < 40) return [];
  const useLiquidityFilter = isUsMarket(market) && config.usLiquidityFilter !== false;
  const minimumDollarVolume = Math.max(0, config.usMinAverageDailyDollarVolume ?? 1000000);
  const eligible: number[] = [];
  for (let index = 40; index <= maximumIndex; index += 1) {
    const date = tradingDate(candles[index].timestamp, timezone);
    if (config.dateMode === "range") {
      if (config.startDate && date < config.startDate) continue;
      if (config.endDate && date > config.endDate) continue;
    }
    if (
      useLiquidityFilter
      && trailingAverageDailyDollarVolume(candles, index, timezone, timeframe) < minimumDollarVolume
    ) continue;
    eligible.push(index);
  }
  return eligible;
}
