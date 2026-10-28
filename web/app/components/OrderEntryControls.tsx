"use client";
import type { ReactNode } from "react";
import { MousePointer2, TrendingDown, TrendingUp, X } from "lucide-react";

type Choice = { value: string; label: string; disabled?: boolean };
export type OrderPricePickerProps = {
  label: string; value: string; selected: boolean; disabled?: boolean; title: string;
  pickLabel: string; clearLabel: string; onPick: () => void; onClear: () => void;
};
export function OrderPricePicker({ label, value, selected, disabled, title, pickLabel, clearLabel, onPick, onClear }: OrderPricePickerProps) {
  return <label>{label}<span className="protection-picker-control">
    <button type="button" aria-label={pickLabel} aria-pressed={selected} disabled={disabled} className={selected ? "active" : ""} title={title} onClick={onPick}>{value || "点击图表选价"}</button>
    {value && <button type="button" aria-label={clearLabel} className="clear" title="清除价格" onClick={onClear}><X size={11} /></button>}
  </span></label>;
}
export function OrderPriceInput({ label, inputLabel, value, step, selected, disabled, pickDisabled, pickLabel, compact = false, placeholder, onChange, onPick }: {
  label: string; inputLabel: string; value: string; step?: number; selected: boolean; disabled?: boolean; pickDisabled?: boolean;
  pickLabel: string; compact?: boolean; placeholder?: string; onChange: (value: string) => void; onPick: () => void;
}) {
  return <label>{label}<span className={`entry-trigger-control${compact ? " compact" : ""}`}><input type="number" min={0} value={value} step={step} disabled={disabled} placeholder={placeholder} onChange={e => onChange(e.target.value)} aria-label={inputLabel} /><button type="button" disabled={disabled || pickDisabled} aria-label={pickLabel} aria-pressed={selected} className={selected ? "active" : ""} title={pickLabel} onClick={onPick}><MousePointer2 size={13} />{!compact && "图表"}</button></span></label>;
}
export function OrderEntryControls({ sizing, order, riskField, gap, thresholdField, entryField, stop, target, extra, footer, info }: {
  sizing: { value: string; options: readonly Choice[]; onChange: (value: string) => void };
  order: { value: string; options: readonly Choice[]; onChange: (value: string) => void };
  riskField?: ReactNode;
  gap: { mode: "off" | "high" | "low"; disabled?: boolean; title: string; onChange: () => void };
  thresholdField?: ReactNode; entryField?: ReactNode; stop?: OrderPricePickerProps; target?: OrderPricePickerProps;
  extra?: ReactNode; footer?: ReactNode; info?: string;
}) {
  return <div className="execution-order-controls" data-shared-order-controls>
    <label>下单方式<select aria-label="下单方式" value={sizing.value} onChange={e => sizing.onChange(e.target.value)}>{sizing.options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select></label>
    {riskField}
    <label>开仓委托<select aria-label="开仓委托类型" value={order.value} onChange={e => order.onChange(e.target.value)}>{order.options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select></label>
    <label>跳空不买<button type="button" className={`opening-gap-mode-button ${gap.mode}`} disabled={gap.disabled} aria-label="跳空不买模式" aria-pressed={gap.mode !== "off"} title={gap.title} onClick={gap.onChange}>{gap.mode === "low" ? "低开不买" : "高开不买"}</button></label>
    {thresholdField}{entryField}{stop && <OrderPricePicker {...stop} />}{target && <OrderPricePicker {...target} />}{extra}{info && <small tabIndex={0} title={info} aria-label={info}>成交规则</small>}{footer}
  </div>;
}
type Action = { disabled: boolean; title?: string; label: string; mobileLabel: string; onClick: () => void };
export function OrderEntryActions({ quantity, sell, buy, children }: { quantity: ReactNode; sell: Action; buy: Action; children?: ReactNode }) {
  return <div className="order-entry" data-shared-order-actions>{quantity}
    <button type="button" className="sell-button" disabled={sell.disabled} title={sell.title} onClick={sell.onClick}><TrendingDown size={16} /><span className="desktop-order-label">{sell.label}</span><span className="mobile-order-label">{sell.mobileLabel}</span></button>
    <button type="button" className="buy-button" disabled={buy.disabled} title={buy.title} onClick={buy.onClick}><TrendingUp size={16} /><span className="desktop-order-label">{buy.label}</span><span className="mobile-order-label">{buy.mobileLabel}</span></button>
    {children}
  </div>;
}
