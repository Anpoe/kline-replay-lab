export type CandlePageQuery = { limit: number; before?: number };
export function candlePageQuery(params: URLSearchParams): CandlePageQuery | null;
export function sliceCandlePage<T extends { timestamp: number }>(candles: T[], query: CandlePageQuery | null): { candles: T[]; hasBefore?: boolean };
