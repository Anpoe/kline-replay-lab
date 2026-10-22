"use client";

import { useEffect, useId, useMemo, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, ChevronLeft, ListChecks, Plus, RotateCcw, Star, Trash2, X } from 'lucide-react';
import { normalizeLists, updateLists, type ListAction, type Watchlist, type WatchlistItem, type WatchlistQuote } from './watchlistController';
import { loadWatchlistQuotes } from './watchlistGateway';

export type WatchlistSource = 'watchlist' | 'recent' | 'scan' | `custom:${string}`;
const storageKey = 'kline-training:watchlists:v1';
type Props = {
  source: WatchlistSource;
  onSource: (source: WatchlistSource) => void;
  favorites: WatchlistItem[];
  recent: WatchlistItem[];
  scan: WatchlistItem[];
  catalog: WatchlistItem[];
  ready: boolean;
  selectedId: string;
  onClose: () => void;
  onScan: () => void;
  onData: () => void;
  onOpen: (item: WatchlistItem, quote: WatchlistQuote | undefined, items: WatchlistItem[]) => void;
  onFavorite: (item: WatchlistItem) => string | void;
  onRemoveFavorite: (id: string) => void;
};

export function WatchlistPanel(props: Props) {
  const storageDescriptionId = useId();
  const [lists, setLists] = useState<Watchlist[]>([]);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const [storageRetry, setStorageRetry] = useState(0);
  const [manage, setManage] = useState(false), [adding, setAdding] = useState(false);
  const [name, setName] = useState(''), [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false), [deleting, setDeleting] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, WatchlistQuote>>({});
  const [loading, setLoading] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = localStorage.getItem(storageKey);
        setLists(stored ? normalizeLists(JSON.parse(stored)) : []);
        setReady(true); setError('');
      } catch { setReady(false); setError('列表未能读取，请恢复浏览器存储后重试。'); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageRetry]);

  const customId = props.source.startsWith('custom:') ? props.source.slice(7) : '';
  const current = lists.find(list => list.id === customId);
  const items = useMemo(() => props.source === 'recent' ? props.recent : props.source === 'scan' ? props.scan : customId ? current?.items ?? [] : props.favorites,
    [props.source, props.recent, props.scan, customId, current, props.favorites]);
  const quoteKey = JSON.stringify(items.map(item => ({ instrumentId: item.instrumentId, market: item.market })));
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const refreshQuotes = async () => {
      if (running || controller.signal.aborted) return;
      running = true;
      setLoading(true);
      const next = await loadWatchlistQuotes(JSON.parse(quoteKey), fetch, controller.signal);
      if (!controller.signal.aborted) { setQuotes(next); setLoading(false); }
      running = false;
    };
    const timer = window.setTimeout(() => void refreshQuotes(), 0);
    const interval = window.setInterval(() => { if (document.visibilityState !== 'hidden') void refreshQuotes(); }, 60_000);
    const focus = () => { if (document.visibilityState !== 'hidden') void refreshQuotes(); };
    window.addEventListener('focus', focus);
    return () => { controller.abort(); window.clearTimeout(timer); window.clearInterval(interval); window.removeEventListener('focus', focus); };
  }, [quoteKey, refresh]);

  const commit = (action: ListAction) => {
    if (!ready) return false;
    let next: Watchlist[];
    try {
      next = updateLists(lists, action);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '列表修改失败，请重试。'); return false; }
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { setError('列表未保存，请释放浏览器存储空间后重试。'); return false; }
    setLists(next); setError(''); return true;
  };
  const changeSource = (source: WatchlistSource) => {
    props.onSource(source); setDeleting(false); setCreating(false); setAdding(false); setName(lists.find(list => `custom:${list.id}` === source)?.name ?? '');
  };
  const addTo = (target: string, item: WatchlistItem) => {
    if (target === 'watchlist') { const failure = props.onFavorite(item); if (failure) setError(failure); }
    else commit({ type: 'add', id: target, item });
  };
  const editable = props.source === 'watchlist' || Boolean(current);
  const candidates = useMemo(() => {
    const all = [...new Map([...props.favorites, ...props.recent, ...props.scan, ...props.catalog].map(item => [item.instrumentId, item])).values()];
    const term = query.trim().toLocaleLowerCase();
    return all.filter(item => !items.some(existing => existing.instrumentId === item.instrumentId) && (!term || `${item.symbol} ${item.name} ${item.instrumentId}`.toLocaleLowerCase().includes(term))).slice(0, 30);
  }, [props.favorites, props.recent, props.scan, props.catalog, items, query]);
  return <aside className="watchlist-panel" aria-label="自选与最近浏览">
    <div className="watchlist-panel-head">
      <div><span className="section-label">WATCHLIST</span><strong>自选</strong></div>
      <button type="button" aria-label="收起自选列表" title="收起列表" onClick={props.onClose}><ChevronLeft size={16} /></button>
    </div>
    <div className="watchlist-source-row">
      <span className="sr-only" id={storageDescriptionId}>自建列表保存在当前浏览器，可在管理中新建或整理。</span>
      <select aria-label="选择看盘列表" title="自建列表保存在当前浏览器，可在“管理”中新建或整理" aria-describedby={storageDescriptionId} value={props.source} onChange={e => changeSource(e.target.value as WatchlistSource)}>
        <option value="watchlist">自选</option>
        {lists.map(list => <option key={list.id} value={`custom:${list.id}`}>{list.name}</option>)}
        <option value="recent">最近浏览</option><option value="scan">最近一次实时筛选</option>
      </select>
      <button type="button" className="watchlist-scan-button" onClick={props.onScan}><Activity size={13} />筛选</button>
    </div>
    <div className="watchlist-toolbar">
      <button type="button" className="ghost-button" aria-expanded={manage} onClick={() => { setManage(!manage); setName(current?.name ?? ''); setCreating(false); setDeleting(false); }}><ListChecks size={13} />管理</button>
      <button type="button" className="ghost-button" disabled={!editable || !ready || (!customId && !props.ready)} aria-expanded={adding} onClick={() => setAdding(!adding)}><Plus size={13} />品种</button>
      <button type="button" className="ghost-button" disabled={loading || !items.length} aria-label="刷新列表涨跌幅" title="读取最新可用行情，每分钟自动刷新" onClick={() => setRefresh(value => value + 1)}><RotateCcw size={13} className={loading ? 'spin' : undefined} /></button>
    </div>
    {error && <div className="watchlist-message" role="alert">{error}<button type="button" onClick={() => setStorageRetry(value => value + 1)}>重试读取</button></div>}
    {manage && <div className="watchlist-management" aria-label="列表管理">
      <button type="button" className="ghost-button" disabled={!ready} onClick={() => { setCreating(true); setName(''); setDeleting(false); }}><Plus size={13} />新建列表</button>
      {(creating || current) && <form onSubmit={e => {
        e.preventDefault();
        const id = creating ? crypto.randomUUID() : customId;
        if (commit({ type: creating ? 'create' : 'rename', id, name })) { const savedName = name.trim(); changeSource(`custom:${id}`); setName(savedName); }
      }}><input aria-label="列表名称" title="1–30 个字，名称不能重复" value={name} maxLength={30} onChange={e => setName(e.target.value)} placeholder="列表名称" /><button type="submit" className="ghost-button" disabled={!ready}>{creating ? '创建' : '改名'}</button></form>}
      {current && !creating && <button type="button" className="ghost-button danger" onClick={() => setDeleting(true)}><Trash2 size={13} />删除列表</button>}
      {deleting && current && <div className="watchlist-message" role="alert">删除“{current.name}”及其中的品种分组？其他列表中的品种会保留。<div><button type="button" className="danger" onClick={() => { if (commit({ type: 'delete', id: customId })) changeSource('watchlist'); }}>确认删除</button><button type="button" onClick={() => setDeleting(false)}>取消</button></div></div>}
    </div>}
    {adding && editable && <div className="watchlist-add" aria-label="添加品种">
      <input aria-label="搜索列表品种" placeholder="代码或名称" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="watchlist-candidates">{candidates.map(item => <button type="button" key={item.instrumentId} title={`${item.name} · ${item.market}`} onClick={() => addTo(customId || 'watchlist', item)}><span>{item.symbol}<small>{item.name}</small></span><Plus size={13} /></button>)}
        {!candidates.length && <span className="watchlist-empty">没有可添加的品种</span>}</div>
      <button type="button" className="ghost-button" onClick={props.onData}>管理行情</button>
    </div>}
    <div className="watchlist-list" role="list" aria-label="看盘品种" aria-busy={loading}>
      {items.map((item, index) => {
        const quote = quotes[item.instrumentId];
        const hasChange = quote?.changePct != null && Number.isFinite(quote.changePct);
        const status = loading ? '读取中' : quote?.error ? '读取失败' : quote?.close ? '缺少前收' : '缺少日线';
        const description = hasChange ? `最新可用交易日涨跌幅 ${quote.changePct!.toFixed(2)}%，行情时间 ${quote.timestamp ? new Date(quote.timestamp).toLocaleString('zh-CN') : '未知'}` : `${status}，可刷新重试或到“管理行情”补齐日线`;
        const favorite = props.favorites.some(existing => existing.instrumentId === item.instrumentId);
        return <div role="listitem" key={item.instrumentId}>
          <button type="button" className={`watchlist-row${props.selectedId === item.instrumentId ? ' active' : ''}`} onClick={() => props.onOpen(item, quote, items)}>
            <span className="watchlist-row-main"><strong>{item.symbol}</strong><small>{item.name} · {item.market === 'CN' ? 'A 股' : item.market === 'US' ? '美股' : item.market === 'GOLD' ? '黄金' : '外汇'}</small></span>
            <span className={hasChange ? (quote.changePct! >= 0 ? 'up' : 'down') : 'watchlist-quote-status'} title={description} aria-label={description}>{hasChange ? `${quote.changePct! >= 0 ? '+' : ''}${quote.changePct!.toFixed(2)}%` : status}</span>
            {favorite && <Star className="watchlist-row-star" size={13} fill="currentColor" aria-label="已加入自选" />}
          </button>
          {manage && <div className="watchlist-item-actions">
            <select aria-label={`将 ${item.symbol} 添加到列表`} value="" disabled={!ready || !props.ready} onChange={e => addTo(e.target.value, item)}><option value="" disabled>添加到…</option>{!favorite && <option value="watchlist">自选</option>}{lists.filter(list => !list.items.some(existing => existing.instrumentId === item.instrumentId)).map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select>
            {current && <><button type="button" aria-label={`上移 ${item.symbol}`} disabled={!index} onClick={() => commit({ type: 'move', id: customId, instrumentId: item.instrumentId, direction: -1 })}><ArrowUp size={13} /></button><button type="button" aria-label={`下移 ${item.symbol}`} disabled={index === items.length - 1} onClick={() => commit({ type: 'move', id: customId, instrumentId: item.instrumentId, direction: 1 })}><ArrowDown size={13} /></button></>}
            {editable && <button type="button" className="danger" disabled={!ready || !props.ready} aria-label={`从当前列表移除 ${item.symbol}`} onClick={() => customId ? commit({ type: 'remove', id: customId, instrumentId: item.instrumentId }) : props.onRemoveFavorite(item.instrumentId)}><X size={13} /></button>}
          </div>}
        </div>;
      })}
      {!items.length && <div className="watchlist-empty" role="status">{!ready ? error ? '列表尚未读取，请重试。' : '正在读取列表…' : !props.ready && !customId ? '正在读取自选…' : editable ? '列表为空，点击“+ 品种”添加。' : props.source === 'recent' ? '还没有最近浏览记录。' : '还没有筛选结果，点击“筛选”开始。'}</div>}
    </div>
    {Object.values(quotes).some(quote => quote.error || quote.changePct === null) && <div className="watchlist-recovery"><button type="button" className="ghost-button" onClick={() => setRefresh(value => value + 1)} disabled={loading}>重试行情</button><button type="button" className="ghost-button" onClick={props.onData}>管理行情</button></div>}
  </aside>;
}
