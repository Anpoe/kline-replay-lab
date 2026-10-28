import { OrderPriceInput } from '../../../components/OrderEntryControls';
import { Check } from 'lucide-react';
import type { PriceSelectionMode } from '../../../components/KLineReplayChart';
import type { Mt4BatchRow } from '../mt4OrderSettings';
import type { Mt4Symbol } from '../mt4Contracts';
import { riskSizedMt4Lots } from '../../../lib/mt4OrderRules.mjs';

export function Mt4BatchOrders({ rows, count, orderType, sizingMode, riskPercent, balance, symbol, disabled, chartReady, selection, onChange, onPick }: {
  rows: Mt4BatchRow[]; count: number; orderType: string; sizingMode: string; riskPercent: number; balance: number; symbol?: Mt4Symbol;
  disabled: boolean; chartReady: boolean; selection: { index: number; kind: PriceSelectionMode } | null;
  onChange: (index: number, field: keyof Mt4BatchRow, value: string) => void; onPick: (index: number, kind: PriceSelectionMode) => void;
}) {
  return <section className="mt4-batch-orders" aria-label="逐笔下单设置">
    <header><div><strong>逐笔设置</strong><span className="mt4-batch-count">{count} 笔</span></div><span className="mt4-batch-memory" tabIndex={0} title="按当前账户和品种自动保存，切换周期保留；减少订单数后，暂时隐藏的行也会保留"><Check size={12} aria-hidden="true" />自动记忆</span></header>
    <div className="mt4-batch-order-grid mt4-batch-order-head" aria-hidden="true"><span>序号</span><span>{sizingMode === 'risk-percent' ? '预估买入手数' : '每笔手数'}</span><span>触发价</span><span>止损</span><span>止盈</span></div>
    {rows.slice(0, count).map((row, index) => {
      let lots = row.lots;
      if (sizingMode === 'risk-percent') {
        lots = '';
        if (symbol) try { lots = String(riskSizedMt4Lots({ balance, riskPercent: riskPercent / count, entryPrice: orderType === 'market' ? symbol.ask : Number(row.price), stopLoss: Number(row.sl), symbol }).lots); } catch { /* Submit provides the actionable sizing error. */ }
      }
      return <div className="mt4-batch-order-grid" key={index} data-batch-row={index + 1}>
        <strong className="mt4-batch-row-number">{String(index + 1).padStart(2, '0')}</strong><label title={sizingMode === 'risk-percent' ? '整批风险均分，每笔按自己的止损距离计算；卖出按卖价计算' : '该笔订单的固定手数'}><input aria-label={`第 ${index + 1} 笔手数`} type="number" min={symbol?.minLot} max={symbol?.maxLot} step={symbol?.lotStep} value={lots} readOnly={sizingMode === 'risk-percent'} disabled={disabled} placeholder="先选止损" onChange={e => onChange(index, 'lots', e.target.value)} /></label>
        {(['price', 'sl', 'tp'] as const).map(field => {
          const kind: PriceSelectionMode = field === 'price' ? 'entry-trigger' : field === 'sl' ? 'stop-loss' : 'take-profit';
          const label = field === 'price' ? '触发价' : field === 'sl' ? '止损价' : '止盈价';
          return field === 'price' && orderType === 'market' ? <span className="mt4-batch-market-price" key={field}>市价</span> : <OrderPriceInput key={field} compact placeholder={field === 'price' ? '输入价格' : '未设置'} label="" inputLabel={`第 ${index + 1} 笔${label}`} value={row[field]} step={symbol?.point} disabled={disabled} pickDisabled={!chartReady} selected={selection?.index === index && selection.kind === kind} pickLabel={`第 ${index + 1} 笔：在图表选择${label}`} onChange={value => onChange(index, field, value)} onPick={() => onPick(index, kind)} />;
        })}
      </div>;
    })}
  </section>;
}
