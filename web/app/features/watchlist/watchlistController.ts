export type WatchlistItem = { instrumentId: string; symbol: string; name: string; market: string };
export type Watchlist = { id: string; name: string; items: WatchlistItem[] };
export type WatchlistQuote = { close?: number; timestamp?: number; changePct: number | null; error?: boolean };
export type ListAction =
  | { type: 'create' | 'rename'; id: string; name: string }
  | { type: 'delete'; id: string }
  | { type: 'add'; id: string; item: WatchlistItem }
  | { type: 'remove'; id: string; instrumentId: string }
  | { type: 'move'; id: string; instrumentId: string; direction: -1 | 1 };

export function normalizeLists(value: unknown): Watchlist[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('列表未能读取，请恢复浏览器存储后重试。');
  const ids = new Set<string>();
  return value.map(list => {
    if (!list || typeof list.id !== 'string' || !list.id || ids.has(list.id) || typeof list.name !== 'string' || !list.name.trim() || list.name.length > 30 || !Array.isArray(list.items) || list.items.length > 500) throw new Error('列表未能读取，请恢复浏览器存储后重试。');
    ids.add(list.id);
    const items: WatchlistItem[] = [];
    for (const item of list.items) {
      if (!item || !['instrumentId', 'symbol', 'name', 'market'].every(key => typeof item[key] === 'string') || !item.instrumentId) throw new Error('列表未能读取，请恢复浏览器存储后重试。');
      if (!items.some(existing => existing.instrumentId === item.instrumentId)) items.push({ instrumentId: item.instrumentId, symbol: item.symbol, name: item.name, market: item.market });
    }
    return { id: list.id, name: list.name.trim(), items };
  });
}

export function updateLists(lists: Watchlist[], action: ListAction): Watchlist[] {
  if (action.type === 'create' || action.type === 'rename') {
    const name = action.name.trim();
    if (!name || name.length > 30) throw new Error('列表名称请填写 1–30 个字。');
    if (name === '自选' || lists.some(list => list.id !== action.id && list.name === name)) throw new Error('已有同名列表，请换一个名称。');
    if (action.type === 'create') {
      if (lists.length >= 50) throw new Error('最多创建 50 个列表，请先删除不需要的列表。');
      return [...lists, { id: action.id, name, items: [] }];
    }
    return lists.map(list => list.id === action.id ? { ...list, name } : list);
  }
  if (action.type === 'delete') return lists.filter(list => list.id !== action.id);
  return lists.map(list => {
    if (list.id !== action.id) return list;
    if (action.type === 'add') {
      if (list.items.some(item => item.instrumentId === action.item.instrumentId)) return list;
      if (list.items.length >= 500) throw new Error('每个列表最多 500 个品种，请先移除不需要的品种。');
      return { ...list, items: [...list.items, action.item] };
    }
    if (action.type === 'remove') return { ...list, items: list.items.filter(item => item.instrumentId !== action.instrumentId) };
    if (action.type !== 'move') return list;
    const items = [...list.items], from = items.findIndex(item => item.instrumentId === action.instrumentId), to = from + action.direction;
    if (from < 0 || to < 0 || to >= items.length) return list;
    [items[from], items[to]] = [items[to], items[from]];
    return { ...list, items };
  });
}

export function quoteFromCandles(candles: readonly { timestamp: number; close: number }[]): WatchlistQuote {
  const days = [...new Map(candles.filter(bar => Number.isFinite(bar.timestamp)).map(bar => [bar.timestamp, bar])).values()].sort((a, b) => a.timestamp - b.timestamp);
  const latest = days.at(-1), previous = days.at(-2);
  return { close: latest?.close, timestamp: latest?.timestamp, changePct: latest && previous && Number.isFinite(latest.close) && latest.close > 0 && Number.isFinite(previous.close) && previous.close > 0 ? (latest.close - previous.close) / previous.close * 100 : null };
}
