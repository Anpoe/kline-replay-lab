import { Activity, RotateCcw, X } from "lucide-react";
import type { PatternPreset } from "../../../lib/patternFilters";
import type {
  LiveScanMarket,
  LiveScanResponse,
  LiveScanSort,
} from "../liveScanContracts";

type LiveScanPanelProps = {
  market: LiveScanMarket;
  presets: readonly PatternPreset[];
  presetIds: readonly string[];
  minPrice: string;
  maxPrice: string;
  minVolume: string;
  excludeLimitUp: boolean;
  sort: LiveScanSort;
  limit: number;
  status: string;
  error: string;
  running: boolean;
  data: LiveScanResponse | null;
  onClose: () => void;
  onMarketChange: (market: LiveScanMarket) => void;
  onTogglePreset: (presetId: string) => void;
  onClearPresets: () => void;
  onMinPriceChange: (value: string) => void;
  onMaxPriceChange: (value: string) => void;
  onMinVolumeChange: (value: string) => void;
  onExcludeLimitUpChange: (value: boolean) => void;
  onSortChange: (sort: LiveScanSort) => void;
  onLimitChange: (limit: number) => void;
  onStart: (skipUpdate: boolean) => void;
  onRestore: () => void;
  onSelectResult: (resultIndex: number) => void;
};

export function LiveScanPanel({
  market,
  presets,
  presetIds,
  minPrice,
  maxPrice,
  minVolume,
  excludeLimitUp,
  sort,
  limit,
  status,
  error,
  running,
  data,
  onClose,
  onMarketChange,
  onTogglePreset,
  onClearPresets,
  onMinPriceChange,
  onMaxPriceChange,
  onMinVolumeChange,
  onExcludeLimitUpChange,
  onSortChange,
  onLimitChange,
  onStart,
  onRestore,
  onSelectResult,
}: LiveScanPanelProps) {
  return (
    <div className="task-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !running) onClose();
    }}>
      <section className="task-modal live-scan-modal" role="dialog" aria-modal="true" aria-labelledby="live-scan-title">
        <div className="task-modal-head">
          <div>
            <span>LIVE MARKET SCREENER</span>
            <h2 id="live-scan-title">实盘筛选</h2>
            <p>只判断所选市场最近一个已收盘交易日；缺少当日数据时先自动增量更新。</p>
          </div>
          <button aria-label="关闭实盘筛选" disabled={running} onClick={onClose}><X size={19} /></button>
        </div>

        <div className="live-scan-market" role="group" aria-label="筛选市场">
          {(["CN", "US"] as LiveScanMarket[]).map((value) => (
            <button key={value} className={market === value ? "active" : ""} onClick={() => onMarketChange(value)}>
              {value === "CN" ? "A 股" : "美股"}<small>{value === "CN" ? "Tushare 增量" : "Alpaca SIP/IEX"}</small>
            </button>
          ))}
        </div>

        <fieldset className="task-pattern-filter">
          <legend>当日形态（可选，多个条件任一命中）</legend>
          <div className="task-pattern-head">
            <span>{presetIds.length ? `已选择 ${presetIds.length} 个形态` : "不选择形态时仅使用价格和流动性条件"}</span>
            {presetIds.length > 0 && <button type="button" onClick={onClearPresets}>清除形态</button>}
          </div>
          <div className="task-pattern-options">
            {presets.map((preset) => {
              const selected = presetIds.includes(preset.id);
              return <button type="button" key={preset.id} className={selected ? "active" : ""} title={preset.description} onClick={() => onTogglePreset(preset.id)}>{selected ? "✓ " : "+ "}{preset.name}</button>;
            })}
          </div>
        </fieldset>

        <div className="live-scan-filter-grid">
          <label>最低收盘价<input type="number" min="0" step="0.01" placeholder="不限" value={minPrice} onChange={(event) => onMinPriceChange(event.target.value)} /></label>
          <label>最高收盘价<input type="number" min="0" step="0.01" placeholder="不限" value={maxPrice} onChange={(event) => onMaxPriceChange(event.target.value)} /></label>
          <label>20 日平均成交量<input type="number" min="0" step="1000" placeholder="不限" value={minVolume} onChange={(event) => onMinVolumeChange(event.target.value)} /></label>
          <label>排序<select value={sort} onChange={(event) => onSortChange(event.target.value as LiveScanSort)}><option value="turnover">平均成交额从高到低</option><option value="volume">平均成交量从高到低</option><option value="change">当日涨幅从高到低</option></select></label>
          <label>最多显示<select value={limit} onChange={(event) => onLimitChange(Number(event.target.value))}><option value={50}>50 个</option><option value={100}>100 个</option><option value={200}>200 个</option><option value={500}>500 个</option></select></label>
        </div>

        {market === "CN" && (
          <div className="live-scan-filter-options">
            <label title="按各板块涨停价排除当日收盘涨停的股票">
              <input type="checkbox" checked={excludeLimitUp} onChange={(event) => onExcludeLimitUpChange(event.target.checked)} />
              <span>排除涨停</span>
              <small>按板块涨停价判断</small>
            </label>
          </div>
        )}

        {status && <div className="pattern-scan-status"><Activity size={14} />{status}</div>}
        {error && <div className="task-error"><strong>{error}</strong><button type="button" onClick={() => onStart(true)}>使用本地现有最新数据筛选</button></div>}

        {data && (
          <div className="live-scan-results">
            <header>
              <div><strong>筛选结果</strong><span>行情日期 {new Date(data.latestTimestamp).toLocaleDateString("zh-CN")} · 命中 {data.matchedCount.toLocaleString()} 个</span></div>
              <small>点击一行打开该标的最新日线</small>
            </header>
            <div className="live-scan-result-list">
              {data.results.length ? data.results.map((result, resultIndex) => (
                <button type="button" key={result.instrumentId} onClick={() => onSelectResult(resultIndex)}>
                  <span><strong>{result.symbol}</strong><small>{result.name}</small></span>
                  <span>{result.presetNames.join("、") || "基础条件"}</span>
                  <span className={result.changePct >= 0 ? "up" : "down"}>{result.changePct >= 0 ? "+" : ""}{result.changePct.toFixed(2)}%</span>
                  <span>{result.close.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                  <span>{result.averageVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </button>
              )) : <div className="live-scan-empty">当前条件没有命中品种，请减少形态或放宽价格、成交量条件。</div>}
            </div>
          </div>
        )}

        <div className="task-modal-actions">
          <button className="ghost-button" disabled={running} onClick={onClose}>关闭</button>
          <button className="ghost-button" disabled={running || !data?.results.length} title="恢复上次筛选结果和浮动导航位置" onClick={onRestore}><RotateCcw size={15} />恢复筛选</button>
          <button className="primary-button" disabled={running} onClick={() => onStart(false)}><Activity size={16} />{running ? "正在更新并筛选…" : "更新数据并开始筛选"}</button>
        </div>
      </section>
    </div>
  );
}
