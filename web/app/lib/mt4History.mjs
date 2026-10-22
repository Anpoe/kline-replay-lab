const empty = () => ({ symbol: '', from: '', to: '', showOnChart: true });
export function dateRangeBounds(from = '', to = '') {
  const date = value => {
    if (!value) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期格式无效');
    const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0,10) !== value) throw new Error('日期无效');
    return milliseconds / 1000;
  };
  const start = date(from), last = date(to);
  if (start != null && last != null && start > last) throw new Error('开始日期不能晚于结束日期');
  return { start, end: last == null ? null : last + 86400 };
}
export function readHistoryPreferences(raw) {
  const result = { version: 1, accountKey: '', accounts: {} };
  try {
    const value = JSON.parse(raw ?? 'null'); if (!value || value.version !== 1) return result;
    for (const [key, filter] of Object.entries(value.accounts ?? {}).slice(0,500)) {
      if (!/^[a-f0-9]{64}$/.test(key) || !filter || typeof filter !== 'object') continue;
      const next = { ...empty(), symbol: typeof filter.symbol === 'string' && filter.symbol.length <= 80 ? filter.symbol : '', from: typeof filter.from === 'string' ? filter.from : '', to: typeof filter.to === 'string' ? filter.to : '', showOnChart: filter.showOnChart !== false };
      try { dateRangeBounds(next.from,next.to); result.accounts[key] = next; } catch { result.accounts[key] = { ...next, from:'',to:'' }; }
    }
    if (/^[a-f0-9]{64}$/.test(value.accountKey)) result.accountKey=value.accountKey;
  } catch { /* Preferences have no trading authority; unreadable preferences use defaults. */ }
  return result;
}
export function rememberHistoryFilter(preferences, accountKey, filter) {
  return { version:1, accountKey, accounts:{...preferences.accounts,[accountKey]:{...empty(),...filter}} };
}
export function restoreHistorySelection(preferences, accounts, activeAccountKey, accountStatusReady) {
  // Restore list preferences only. Chart navigation requires a user action.
  // Wait for terminal status before choosing the default account.
  if (!accountStatusReady || !accounts.length) return null;
  const accountKey = [preferences.accountKey, activeAccountKey].find(key => accounts.some(account => account.accountKey === key)) ?? accounts[0].accountKey;
  const filter = preferences.accounts[accountKey] ?? empty();
  return { accountKey, filter };
}
export function mt4PeriodEnd(timestamp, timeframe) {
  if (timeframe !== 43200) return timestamp + timeframe * 60000;
  const date = new Date(timestamp); date.setUTCMonth(date.getUTCMonth()+1); return date.getTime();
}
export function buildMt4HistoryMarkers(orders, bars, timeframe, accountKey) {
  const point = seconds => {
    const t=seconds*1000; let low=0,high=bars.length-1,index=-1;
    while(low<=high){const middle=(low+high)>>1;if(bars[middle].timestamp<=t){index=middle;low=middle+1;}else high=middle-1;}
    return index>=0 && t<mt4PeriodEnd(bars[index].timestamp,timeframe) ? bars[index].timestamp : null;
  };
  return orders.flatMap(order => {
    if (order.type>1) return [];
    const entry=point(order.openTime),exit=order.closeTime>0?point(order.closeTime):null;
    const common={id:`${accountKey}:${encodeURIComponent(order.symbol)}:${order.ticket}`,accountKey,symbol:order.symbol,ticket:order.ticket,side:order.type===0?'long':'short',qty:order.lots,realizedPnl:order.profit+order.swap+order.commission};
    if(entry!=null)return [{...common,entryPrice:order.openPrice,entryTimestamp:order.openTime*1000,entryPlotTimestamp:entry,...(exit!=null?{exitPrice:order.closePrice,exitTimestamp:order.closeTime*1000,exitPlotTimestamp:exit}:{})}];
    if(exit!=null)return [{...common,id:common.id+'@exit',eventKind:'exit',entryPrice:order.closePrice,entryTimestamp:order.closeTime*1000,entryPlotTimestamp:exit}];
    return [];
  });
}
