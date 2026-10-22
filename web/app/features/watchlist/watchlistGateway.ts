import { quoteFromCandles, type WatchlistItem, type WatchlistQuote } from './watchlistController.ts';

type Fetcher = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
export async function loadWatchlistQuotes(items: readonly WatchlistItem[], fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<Record<string, WatchlistQuote>> {
  const quotes: Record<string, WatchlistQuote> = {};
  const read = async (url: string, init?: RequestInit) => {
    const response = await fetcher(url, { ...init, signal, cache: 'no-store' });
    if (!response.ok) throw new Error('行情读取失败');
    return response.json();
  };
  for (const market of ['CN', 'US']) {
    const group = items.filter(item => item.market === market);
    if (!group.length) continue;
    try {
      const payload = await read('/api/live-scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'refresh', market, instrumentIds: group.map(item => item.instrumentId) }) }) as { prices?: { instrumentId: string; close: number; previousClose?: number; timestamp: number; quoteTimestamp?: number }[] };
      for (const item of group) {
        const price = payload.prices?.find(price => price.instrumentId === item.instrumentId);
        quotes[item.instrumentId] = price ? { close: price.close, timestamp: price.quoteTimestamp ?? price.timestamp, changePct: Number.isFinite(price.close) && price.close > 0 && Number.isFinite(price.previousClose) && Number(price.previousClose) > 0 ? (price.close - Number(price.previousClose)) / Number(price.previousClose) * 100 : null } : { changePct: null };
      }
    } catch {
      for (const item of group) quotes[item.instrumentId] = { changePct: null, error: true };
    }
  }
  // Bound reads for non-equity markets; these endpoints only read stored bars.
  const others = items.filter(item => item.market !== 'CN' && item.market !== 'US');
  for (let start = 0; start < others.length; start += 4) {
    if (signal?.aborted) break;
    await Promise.all(others.slice(start, start + 4).map(async item => {
      try {
        const payload = await read(`/api/candles?instrument=${encodeURIComponent(item.instrumentId)}&timeframe=1d`) as { candles?: { timestamp: number; close: number }[] };
        quotes[item.instrumentId] = quoteFromCandles(payload.candles ?? []);
      } catch { quotes[item.instrumentId] = { changePct: null, error: true }; }
    }));
  }
  return quotes;
}
