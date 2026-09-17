import { dataMarkets, marketRuleCode, type DataMarket } from "./dataMarkets.ts";

export class MarketDataBusyError extends Error {
  readonly status = 409;
}

// The desktop background worker uses the same Web service as the UI. Hold
// these leases through the complete async operation, including paused writes
// that are still finishing their current chunk.
const writes = new Map<string, number>();
const clearing = new Set<DataMarket>();

export async function withMarketDataWrite<T>(market: string, work: () => Promise<T>): Promise<T> {
  const scope = marketRuleCode(market);
  if (clearing.has(scope as DataMarket) || (scope === "*" && clearing.size > 0)) {
    throw new MarketDataBusyError("正在清空行情，请完成后再重试此操作。");
  }
  writes.set(scope, (writes.get(scope) ?? 0) + 1);
  try {
    return await work();
  } finally {
    const remaining = (writes.get(scope) ?? 1) - 1;
    if (remaining) writes.set(scope, remaining);
    else writes.delete(scope);
  }
}

export async function withMarketDataClear<T>(market: DataMarket, work: () => Promise<T>): Promise<T> {
  if (clearing.has(market)) throw new MarketDataBusyError("正在清空该市场行情，请等待完成。");
  if (writes.has(market) || writes.has("*")) {
    throw new MarketDataBusyError("行情操作仍在处理中，请先暂停相关任务，等待当前处理完成后重试清空。");
  }
  clearing.add(market);
  try {
    return await work();
  } finally {
    clearing.delete(market);
  }
}

export async function marketDataWriteResponse(market: string, work: () => Promise<Response>) {
  try {
    return await withMarketDataWrite(market, work);
  } catch (error) {
    if (error instanceof MarketDataBusyError) return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}

export function isDataMarket(value: unknown): value is DataMarket {
  return dataMarkets.some((market) => market.id === value);
}
