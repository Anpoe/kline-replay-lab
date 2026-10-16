export function calculateCloseStandardDeviation(
  candles: Array<{ close: number }>, endIndex: number, lookback: number,
): { mean: number; deviation: number; percentage: number } | null;
export function matchesStandardDeviationCondition(
  candles: Array<{ close: number }>, index: number, parameters: Record<string, number | string>,
): boolean;
export function matchesBreakoutStandardDeviation(
  candles: Array<{ close: number }>, index: number, lookback: number,
  parameters: Record<string, number>, high: number, low: number,
): boolean;
