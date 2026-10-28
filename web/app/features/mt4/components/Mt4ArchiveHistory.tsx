'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Download, Info, RefreshCw, Upload } from 'lucide-react';
import { requestMt4Archive } from '../mt4Gateway';
import type { ArchiveAccount, ArchiveOrder, ArchiveTrade, HistoryFilter, HistoryFilterSelection, HistoryRecords, HistoryChartSelection } from '../mt4ArchiveContracts';
import type { Mt4Status } from '../mt4Contracts';
import { downloadArchiveJson } from './Mt4PersistentAnalysis';
import { dateRangeBounds, readHistoryPreferences, rememberHistoryFilter, restoreHistorySelection } from '../../../lib/mt4History.mjs';
import { readAnalysis } from '../mt4Analysis';
import { ChartMarkerToggle } from '../../../components/DecisionReview';

export function Mt4ArchiveHistory({ activeAccountKey, accountStatusReady, refreshAt, archiveStatus, onSelect, selected, chartSymbol, onFiltersChange, onRecords, chartSelection, onNotice }: {
  onNotice: (message: string) => void;
  chartSymbol: string; onFiltersChange: (selection: HistoryFilterSelection) => void; onRecords: (records: HistoryRecords) => void; chartSelection?: HistoryChartSelection | null;
  activeAccountKey: string; accountStatusReady: boolean; refreshAt: number; archiveStatus?: Mt4Status['archive']; onSelect: (trade: ArchiveTrade, account: ArchiveAccount, focus?: number, evidence?: ArchiveTrade['events'][number]) => void; selected?: ArchiveTrade | null;
}) {
  const [storedPreferences] = useState(() => {
    try { return { data: readHistoryPreferences(typeof window === 'undefined' ? null : localStorage.getItem('kline.mt4.history-filters.v1')), error: '' }; }
    catch { return { data: readHistoryPreferences(null), error: '筛选记忆暂不可用，当前仍可筛选；请允许浏览器保存数据后重试' }; }
  });
  const preferences = storedPreferences.data;
  const [preferenceError, setPreferenceError] = useState(storedPreferences.error);
  const preferenceRef = useRef(preferences), initialized = useRef(false), navigate = useRef(false), filterSignature = useRef('');
  const [filter, setFilter] = useState<HistoryFilter>({ symbol: '', from: '', to: '', showOnChart: true });
  const { symbol, from, to, showOnChart } = filter;
  const [accounts, setAccounts] = useState<ArchiveAccount[]>([]), [accountKey, setAccountKey] = useState(''), [page, setPage] = useState(0);
  const [orders, setOrders] = useState<ArchiveOrder[]>([]), [total, setTotal] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0);
  const importRef = useRef<HTMLInputElement>(null), selectSequence = useRef(0);
  const migrated = useRef(new Set<string>());
  const account = accounts.find(a => a.accountKey === accountKey);
  useEffect(() => {
    const controller = new AbortController();
    void requestMt4Archive<{ accounts: ArchiveAccount[] }>({ action: 'accounts' }, undefined, controller.signal).then(async result => {
      if (controller.signal.aborted) return;
      setAccounts(result.accounts);
      const restored = !initialized.current ? restoreHistorySelection(preferenceRef.current, result.accounts, activeAccountKey, accountStatusReady) : null;
      if (restored) {
        initialized.current = true;
        setFilter(restored.filter);
        navigate.current = false;
        setAccountKey(restored.accountKey);
      }
      if (!result.accounts.length) setLoading(false);
      for (let i = 0; i < localStorage.length && !controller.signal.aborted; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('kline.mt4.analysis.v1:') || migrated.current.has(key)) continue;
        const parts = key.split(':');
        if (parts.length !== 4 || !result.accounts.some(a => a.accountKey === decodeURIComponent(parts[1]))) continue;
        try {
          const data = readAnalysis(localStorage.getItem(key));
          await requestMt4Archive({}, { action: 'save-analysis', accountKey: decodeURIComponent(parts[1]), symbol: decodeURIComponent(parts[2]), timeframe: Number(parts[3]), revision: 0, data, migrate: true }, controller.signal);
          migrated.current.add(key);
        } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '部分已有标记未能保存，浏览器原记录仍保留，请重试读取'); }
      }
    }).catch(e => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : '账户档案读取失败'); setLoading(false); } });
    return () => controller.abort();
  }, [activeAccountKey, accountStatusReady, refreshAt, refresh]);
  let dateError = '';
  try { dateRangeBounds(from, to); } catch(e) { dateError = e instanceof Error ? e.message : '日期无效'; }
  const effectiveChartSymbol = symbol || chartSymbol || account?.symbols[0] || '';
  useEffect(() => {
    if (!account || dateError) return;
    const signature = JSON.stringify([accountKey, filter]);
    if (filterSignature.current === signature) return;
    filterSignature.current = signature;
    preferenceRef.current = rememberHistoryFilter(preferenceRef.current, accountKey, filter);
    void Promise.resolve().then(() => { localStorage.setItem('kline.mt4.history-filters.v1', JSON.stringify(preferenceRef.current)); setPreferenceError(''); }).catch(() => setPreferenceError('筛选未能保存，请释放浏览器存储空间后重试'));
    onFiltersChange({ account, filter, navigate: navigate.current }); navigate.current = false;
  }, [account, accountKey, filter, dateError, onFiltersChange]);
  const recordsScope = useRef('');
  useEffect(() => {
    if (!accountKey) return;
    const controller = new AbortController();
    const scope = JSON.stringify([accountKey, effectiveChartSymbol, from, to, symbol, showOnChart]);
    if (scope !== recordsScope.current || dateError) { onRecords({ accountKey, chartSymbol: effectiveChartSymbol, orders: [], limited: false, showOnChart }); recordsScope.current = scope; }
    if (dateError) return;
    void requestMt4Archive<{ orders: ArchiveOrder[]; total: number; page: number; chartOrders: ArchiveOrder[]; chartLimited: boolean }>({ accountKey, symbol, from, to, page, chartSymbol: effectiveChartSymbol }, undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (!Number.isInteger(result.page) || !Array.isArray(result.chartOrders)) throw new Error('请在控制面板重启服务，再刷新页面以使用历史筛选');
      setOrders(result.orders); setTotal(result.total); setPage(result.page); setError(''); setLoading(false);
      onRecords({ accountKey, chartSymbol: effectiveChartSymbol, orders: result.chartOrders ?? [], limited: !!result.chartLimited, showOnChart });
    }).catch(e => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : '历史记录读取失败'); setLoading(false); } });
    return () => controller.abort();
  }, [accountKey, symbol, from, to, page, refreshAt, refresh, effectiveChartSymbol, showOnChart, dateError, onRecords]);
  const changeFilter = (patch: Partial<HistoryFilter>) => {
    selectSequence.current++; navigate.current = patch.showOnChart == null; const next = { ...filter, ...patch }; setFilter(next); setPage(0); setOrders([]); setTotal(0);
    try { dateRangeBounds(next.from,next.to); setLoading(true); } catch { setLoading(false); }
  };
  useEffect(() => () => { selectSequence.current++; }, []);
  const readTrade = useCallback(async (order: ArchiveOrder, focus?: number) => {
    if (!account) return; const sequence = ++selectSequence.current;
    setBusy(true); setError('');
    try {
      const detail = await requestMt4Archive<ArchiveTrade>({ action: 'trade', accountKey, symbol: order.symbol, ticket: order.ticket, timeframe: order.timeframe, focus: focus ?? order.openTime * 1000 }, undefined, AbortSignal.timeout(15000));
      if (sequence === selectSequence.current) { onSelect(detail, account, focus); document.getElementById('mt4-chart-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    } catch (e) { if (sequence === selectSequence.current) setError(e instanceof Error ? e.message : '交易未能读取，请重试'); }
    finally { if (sequence === selectSequence.current) setBusy(false); }
  }, [account, accountKey, onSelect]);
  const handledSelection = useRef(0);
  useEffect(() => {
    if (!chartSelection || chartSelection.accountKey !== accountKey || handledSelection.current === chartSelection.nonce) return;
    handledSelection.current = chartSelection.nonce;
    setPage(Math.floor((chartSelection.order.position ?? 0) / 50));
    void readTrade(chartSelection.order, chartSelection.focus);
  }, [chartSelection, accountKey, readTrade]);
  const action = async (operation: () => Promise<void>) => { setBusy(true); setError(''); onNotice(''); try { await operation(); setRefresh(n => n + 1); } catch (e) { setError(e instanceof Error ? e.message : '档案操作未完成，请重试'); } finally { setBusy(false); } };
  const time = (seconds: number) => seconds ? new Date(seconds * 1000).toLocaleString('zh-CN', { timeZone: 'UTC', hour12: false }) : '—';
  const activeScan = archiveStatus?.scan?.accountKey === accountKey ? archiveStatus.scan : account?.scan;
  const needsUpdate = archiveStatus?.terminalVersion === 0 && activeAccountKey === accountKey;
  const pageCount = Math.max(1, Math.ceil(total / 50));
  const range = orders.length ? `${page * 50 + 1}–${page * 50 + orders.length}` : '0';
  const price = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  const historyHint = '每批读取 50 条，自动继续到终端已加载历史的末尾，没有 50 笔总量限制；扫描条数包含出入金等非交易记录。导入前请在 MT4 账户历史选择全部历史；接入前的修改过程无法还原。';
  return <details className="mt4-trade-history mt4-archive-history" open><summary><ChevronDown size={14} /><span className="mt4-archive-title">历史档案</span><span className="mt4-history-count">已归档 {total} 笔</span><span className="mt4-archive-summary-meta">{orders.length ? `本页 ${range}` : '按账户与品种保存'}</span></summary>
    <div className="mt4-archive-toolbar">
      <div className="mt4-archive-filters">
        <label className="mt4-archive-account-filter"><span>账户</span><select aria-label="历史档案账户" value={accountKey} disabled={busy} onChange={e => { selectSequence.current++; navigate.current = true; setAccountKey(e.target.value); setFilter(preferenceRef.current.accounts[e.target.value] ?? { symbol:'', from:'', to:'', showOnChart:true }); setPage(0); setOrders([]); setLoading(true); }}>{!accounts.length && <option value="">暂无账户档案</option>}{accounts.map(a => <option key={a.accountKey} value={a.accountKey}>{a.login} · {a.server} · {a.mode === 'real' ? '实盘' : a.mode === 'demo' ? '模拟' : '竞赛'}</option>)}</select></label>
        <label className="mt4-archive-symbol-filter"><span>品种</span><select aria-label="历史档案品种" value={symbol} disabled={busy} onChange={e => { changeFilter({ symbol: e.target.value }); }}><option value="">全部品种</option>{account?.symbols.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className="mt4-archive-date-filter" title="按 MT4 服务器日期筛选：已结束交易按平仓时间，未结束交易按开仓时间"><span>开始</span><input type="date" aria-label="历史开始日期，MT4 服务器日期" value={from} onChange={e => changeFilter({ from: e.target.value })} /></label>
        <label className="mt4-archive-date-filter" title="包含结束日期当天，按 MT4 服务器日期"><span>结束</span><input type="date" aria-label="历史结束日期，包含当天" value={to} onChange={e => changeFilter({ to: e.target.value })} /></label>
        {(from || to) && <button className="ghost-button" aria-label="清除时间筛选" onClick={() => changeFilter({ from:'', to:'' })}>清除</button>}
        <ChartMarkerToggle className="mt4-archive-chart-toggle" checked={showOnChart} onChange={showOnChart => changeFilter({ showOnChart })} />
      </div>
      <div className="mt4-actions mt4-archive-actions"><button className="ghost-button mt4-archive-refresh" aria-label="刷新" title="刷新档案列表" disabled={busy} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={14} /></button><button className="ghost-button mt4-archive-sync" disabled={busy || !accountKey || accountKey !== activeAccountKey} title="重新读取当前账户已加载的全部历史，并重试缺失行情" onClick={() => void action(async () => { await requestMt4Archive({}, { action: 'rescan', accountKey }); onNotice('已开始同步终端当前加载的历史'); })}><RefreshCw size={13} />同步历史</button><span className="mt4-archive-action-divider" aria-hidden="true" /><button className="ghost-button" disabled={busy} title="备份所有账户的交易、行情、分析和修订记录，不包含连接凭证" onClick={() => void action(async () => { const backup = await requestMt4Archive({ action: 'backup' }, undefined, AbortSignal.timeout(60000)); downloadArchiveJson(backup, `MT4-历史档案-${new Date().toISOString().slice(0,10)}.json`); onNotice('备份已下载'); })}><Download size={13} />备份</button><button className="ghost-button" disabled={busy} title="恢复到空档案或补回一致记录；存在不同版本时保留当前档案并停止恢复" onClick={() => importRef.current?.click()}><Upload size={13} />恢复</button><input hidden type="file" accept="application/json,.json" ref={importRef} aria-label="选择历史档案备份" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void action(async () => { if (file.size > 128 * 1024 * 1024) throw new Error('备份文件过大'); const backup: unknown = JSON.parse(await file.text()); await requestMt4Archive({}, { action: 'restore', backup }, AbortSignal.timeout(60000)); onNotice('档案已恢复'); }); }} /></div>
    </div>
    <div className="mt4-archive-status-row" role="status">
      <span className={`mt4-archive-coverage ${needsUpdate ? 'needs-update' : activeScan?.complete ? 'complete' : ''}`} tabIndex={0} title={historyHint} aria-label={`${needsUpdate ? '完整历史尚未同步' : '历史同步状态'}。${historyHint}`}><i aria-hidden="true" />{needsUpdate ? '完整历史待同步' : activeScan?.complete ? `已扫描 ${activeScan.total} 条` : activeScan?.total != null ? `正在归档 ${activeScan.offset ?? 0} / ${activeScan.total}` : '已保存接收记录'}</span>
      {account?.market && <span className="mt4-archive-market-status" tabIndex={0} title="统计交易开仓与平仓附近的行情窗口；同步历史可重试缺失窗口" aria-label="交易附近行情窗口归档状态">行情已存 <strong>{account.market.complete ?? 0}</strong><span>待补 <strong>{account.market.queued ?? 0}</strong></span>{account.market.missing ? <span className="down">缺失 <strong>{account.market.missing}</strong></span> : null}</span>}
      <span className="mt4-archive-page-size" title={historyHint}>每页 50 笔</span>
    </div>
    {needsUpdate && <div className="mt4-archive-upgrade" role="status"><Info size={16} aria-hidden="true" /><div><strong>连接 EA 待更新</strong><span>当前连接仅回传最近 50 笔；更新并重新挂载后可同步完整历史。</span></div><a className="ghost-button" href="/mt4/BatchOrderPanelEA.ex4" download><Download size={13} />下载面板合并版</a></div>}
    {archiveStatus?.error && <div className="mt4-error" role="alert">{archiveStatus.error}<button className="ghost-button" disabled={busy} onClick={() => void action(async () => { await requestMt4Archive({}, { action: 'rescan', accountKey: activeAccountKey }); })}>重试同步</button></div>}
    {preferenceError && <div className="mt4-error" role="alert">{preferenceError}</div>}
    {dateError && <div className="mt4-error" role="alert">{dateError}</div>}
    {error && <div className="mt4-error" role="alert">{error}<button className="ghost-button" onClick={() => setRefresh(n => n + 1)}>重试读取</button></div>}
    <span id="mt4-archive-row-help" className="live-sr-only">点击交易行，或聚焦后按 Enter、空格回看开仓位置；行内按钮分别定位开仓和平仓。</span>
    {!orders.length ? <div className="mt4-table-empty" role="status">{loading ? '正在读取历史档案' : accountKey ? '这个账户和品种下暂无已归档交易' : '连接 MT4 后自动建立账户档案，也可以恢复已有备份'}</div> : <div className="mt4-table-wrap" role="region" aria-label="历史交易档案" tabIndex={0}><table className="mt4-table mt4-archive-table"><colgroup>{[12,11,10,6,11,11,11,16,12].map((width,i) => <col key={i} style={{ width: `${width}%` }} />)}</colgroup><thead><tr><th>订单号</th><th>品种</th><th>方向</th><th className="mt4-number">手数</th><th className="mt4-number">开仓价</th><th className="mt4-number">平仓价</th><th className="mt4-number">净盈亏 <span className="mt4-table-currency">{account?.currency}</span></th><th>交易时间</th><th className="mt4-row-action">回看</th></tr></thead><tbody>{orders.map(o => <tr key={`${accountKey}:${o.symbol}:${o.ticket}`} className="mt4-archive-row" aria-describedby="mt4-archive-row-help" tabIndex={busy ? -1 : 0} aria-disabled={busy} title="点击回看开仓位置"
      onClick={event => { if (!busy && !(event.target as Element).closest('button, a, input, select, textarea, summary') && !window.getSelection()?.toString()) void readTrade(o); }}
      onKeyDown={event => { if (event.target === event.currentTarget && !busy && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); void readTrade(o); } }} aria-selected={selected?.accountKey === accountKey && selected.symbol === o.symbol && selected.order.ticket === o.ticket}>
      <td className="mt4-ticket"><button className="mt4-archive-ticket" disabled={busy} onClick={() => void readTrade(o)} title="在当前图表定位这笔交易">#{o.ticket}</button></td><td className="mt4-order-symbol">{o.symbol}</td><td><span className={`mt4-order-side ${o.type % 2 === 0 ? 'buy' : 'sell'}`}>{['买入','卖出','买入限价','卖出限价','买入止损','卖出止损'][o.type]}</span></td><td className="mt4-number">{o.lots}</td><td className="mt4-number">{price(o.openPrice)}</td><td className={`mt4-number ${o.closeTime ? '' : 'mt4-unset'}`}>{o.closeTime ? price(o.closePrice) : '—'}</td><td className={`mt4-number mt4-order-profit ${o.profit + o.swap + o.commission > 0 ? 'up' : o.profit + o.swap + o.commission < 0 ? 'down' : ''}`} title={`手续费 ${o.commission}；隔夜费 ${o.swap}；${account?.currency ?? ''}`}>{o.profit + o.swap + o.commission > 0 ? '+' : ''}{(o.profit + o.swap + o.commission).toFixed(2)}</td><td className="mt4-trade-time"><time title={`MT4 服务器时间 ${time(o.closeTime || o.openTime)}`}>{time(o.closeTime || o.openTime)}</time>{!o.closeTime && <span className="mt4-archive-open-order">未结束</span>}</td><td className="mt4-row-action"><div className="mt4-actions"><button className="ghost-button" disabled={busy} title="定位开仓时的图表" onClick={() => void readTrade(o)}>开仓</button>{o.closeTime > 0 && <button className="ghost-button" disabled={busy} title="定位平仓时的图表" onClick={() => void readTrade(o, o.closeTime * 1000)}>平仓</button>}</div></td>
    </tr>)}</tbody></table></div>}
    {total > 0 && <div className="mt4-archive-pagination"><span className="mt4-archive-range">显示 {range} 笔，共 {total} 笔</span><div className="mt4-archive-page-controls"><button className="ghost-button" aria-label="上一页" title="上一页" disabled={!page || busy} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /></button><span>第 {page + 1} / {pageCount} 页</span><button className="ghost-button" aria-label="下一页" title="下一页" disabled={(page + 1) * 50 >= total || busy} onClick={() => setPage(p => p + 1)}><ChevronRight size={14} /></button></div></div>}
    {selected && selected.accountKey === accountKey && (!symbol || selected.symbol === symbol) && <details className="mt4-archive-events"><summary>#{selected.order.ticket} · {selected.symbol} · 已留档过程 {selected.events.length}</summary>{selected.events.map(event => <article key={event.id}><time>{new Date(event.observedAt).toLocaleString('zh-CN')}</time><span>{event.source === 'observed' ? '接入后观察' : '终端历史导入'} · {event.order.closeTime ? '已结束' : '未结束'} · {event.order.lots} 手 · 止损 {event.order.stopLoss || '—'} · 止盈 {event.order.takeProfit || '—'}</span><span>开仓 {time(event.order.openTime)} @ {event.order.openPrice} · 平仓 {time(event.order.closeTime)} @ {event.order.closeTime ? event.order.closePrice : '—'} · 手续费 {event.order.commission} · 隔夜费 {event.order.swap} · 盈亏 {event.order.profit} · 标识 {event.order.magic}{event.order.comment ? ` · ${event.order.comment}` : ''}</span>{event.evidence.analysis?.data && <span title="当时保存的版本不随后续复盘修改">{event.source === 'observed' ? '当时决策' : '导入时分析'}：{event.evidence.analysis.data.draft.note || event.evidence.analysis.data.draft.marketState || '已留档'} · 标记 {event.evidence.analysis.data.drawings.length}</span>}{event.evidence.analysis?.data && event.evidence.chart && <button className="ghost-button" onClick={() => { const owner = accounts.find(a => a.accountKey === selected.accountKey); if (owner) onSelect({ ...selected, timeframe: event.evidence.chart!.timeframe }, owner, event.evidence.chart!.bars.at(-1)?.timestamp ?? selected.order.openTime * 1000, event); }}>{event.source === 'observed' ? '查看当时标记' : '查看导入时标记'}</button>}</article>)}</details>}
  </details>;
}
