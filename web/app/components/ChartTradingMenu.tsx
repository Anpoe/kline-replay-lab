"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { chartOrderChoicesAtPrice, chartOrderLabel, protectionKindAtPrice, type ChartOrderChoice, type ChartProtectionKind } from "../lib/chartTrading";
import type { CandleContextTarget } from "./KLineReplayChart";
import type { ProtectionLine } from "../lib/tradeProtection";

export type ChartTradingPosition = { id: string; label: string; side: "long" | "short"; referencePrice: number };
export type PendingOrderCancellation = {
  scope: string; orders: Array<{ id: string; label: string; price: number; stopLoss?: number; takeProfit?: number }>; drawLines?: boolean;
  disabled: boolean; error?: string; onCancel: (id: string) => boolean | void | Promise<boolean | void>;
};
export type ChartTradingAdapter = {
  scope: string;
  disabled: boolean;
  disabledReason?: string;
  sellDisabled?: boolean;
  error?: string;
  buyReference: number;
  sellReference: number;
  positions: ChartTradingPosition[];
  quantity: { value: string | number; unit: string };
  previewQuantity?: (choice: ChartOrderChoice, price: number) => string | number;
  normalizePrice?: (price: number) => number;
  onOpen?: () => void;
  onOrder: (choice: ChartOrderChoice, price: number) => boolean | void;
  onProtection: (kind: ChartProtectionKind, price: number, positionId?: string) => boolean;
  onMarkerAction?: (line: ProtectionLine, price: number | null) => boolean;
  cancellation?: PendingOrderCancellation;
};
export type ChartTradingTarget = { x: number; y: number; price: number; scope: string; candle: CandleContextTarget | null; protectionOnly?: boolean; cancelIds?: string[]; marker?: ProtectionLine };

export function ChartTradingMenu({ target, trading, priceLabel, onDecision, onClose }: {
  target: ChartTradingTarget; trading: ChartTradingAdapter; priceLabel: string;
  onDecision: (target: CandleContextTarget) => void; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [attempted, setAttempted] = useState(false);
  const [working, setWorking] = useState(false);
  const cancelLock = useRef(false);
  const [cancelError, setCancelError] = useState("");
  const [editing, setEditing] = useState(false);
  const [editPrice, setEditPrice] = useState(String(target.marker?.price ?? ""));
  const [placement, setPlacement] = useState({ left: target.x, top: target.y });
  const cancel = trading.cancellation;
  const cancelledOrders = cancel?.scope === target.scope ? cancel.orders.filter(order => target.cancelIds?.includes(order.id)) : [];
  const orders = chartOrderChoicesAtPrice(target.price, trading.buyReference, trading.sellReference);
  const protections = trading.positions.flatMap(position => {
    const kind = protectionKindAtPrice(position.side, target.price, position.referencePrice);
    return kind ? [{ position, kind }] : [];
  });
  const error = cancelError || (target.cancelIds ? cancel?.disabled ? trading.disabledReason || "请先等待当前操作完成或恢复连接" : attempted ? cancel?.error : "" : trading.disabled ? trading.disabledReason : attempted ? trading.error : "");
  const marker = target.marker;
  const pendingMarker = marker?.kind === "entry-trigger" && Boolean(marker.orderId);
  const editableMarker = Boolean(marker && marker.source !== "plan" && (marker.kind !== "entry-trigger" || pendingMarker) && trading.onMarkerAction);
  const applyProtection = (kind: ChartProtectionKind, positionId?: string) => {
    setAttempted(true);
    if (!trading.disabled && trading.onProtection(kind, target.price, positionId)) onClose();
  };

  useLayoutEffect(() => {
    const bounds = panel.current?.getBoundingClientRect();
    if (bounds) setPlacement({ left: Math.max(8, Math.min(target.x, window.innerWidth - bounds.width - 8)), top: Math.max(8, Math.min(target.y, window.innerHeight - bounds.height - 8)) });
  }, [target, error, protections.length, cancelledOrders.length, editing]);

  useEffect(() => {
    const previous = document.activeElement;
    (panel.current?.querySelector<HTMLElement>(".chart-trading-row:not(:disabled)") ?? panel.current?.querySelector<HTMLElement>("button"))?.focus();
    const dismiss = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) onClose(); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? []);
      if (event.key === "Tab") {
        const edge = event.shiftKey ? controls[0] : controls.at(-1);
        if (document.activeElement === edge) { event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus(); }
      }
      if (!(event.target instanceof HTMLInputElement) && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        const index = controls.indexOf(document.activeElement as HTMLElement);
        controls[(index + (event.key === "ArrowDown" ? 1 : controls.length - 1)) % controls.length]?.focus();
      }
    };
    const close = () => onClose();
    document.addEventListener("pointerdown", dismiss, true); document.addEventListener("keydown", keyboard, true);
    window.addEventListener("resize", close);
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true); document.removeEventListener("keydown", keyboard, true);
      window.removeEventListener("resize", close); window.removeEventListener("scroll", scroll, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [onClose]);

  const title = marker ? pendingMarker ? "挂单操作" : marker.kind === "stop-loss" ? "止损操作" : marker.kind === "take-profit" ? "止盈操作" : "标记操作" : target.cancelIds ? "撤销挂单" : target.protectionOnly ? "持仓保护价" : "图表交易";
  return createPortal(<div ref={panel} className="chart-trading-menu" role="dialog" aria-modal="true" aria-label={title} style={placement} onKeyDown={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
    <div className="chart-trading-heading"><strong>{title}</strong><button type="button" className="ghost-button" aria-label="关闭图表交易" onClick={onClose}>×</button></div>
    {marker && <div className="chart-trading-group">
      <span className="chart-marker-label">{marker.label}</span>
      {editing ? <form className="chart-marker-edit" onSubmit={event => {
        event.preventDefault(); setAttempted(true);
        const price = Number(editPrice);
        if (!Number.isFinite(price) || price <= 0) { setCancelError("请填写大于零的价格"); return; }
        setCancelError("");
        if (trading.onMarkerAction?.(marker, price)) onClose();
      }}><input aria-label="修改标记价格" type="number" min={0} step="any" value={editPrice} onChange={event => setEditPrice(event.target.value)} /><button className="primary-button" disabled={trading.disabled || !marker.movable} type="submit">保存价格</button></form>
        : <button type="button" className="chart-trading-row" disabled={trading.disabled || !editableMarker || !marker.movable} onClick={() => setEditing(true)}>修改价格</button>}
      {pendingMarker ? <button className="chart-trading-row" type="button" disabled={working || cancel?.disabled} onClick={async () => {
        if (!cancel || cancel.disabled || cancelLock.current) return;
        cancelLock.current = true; setWorking(true); setAttempted(true);
        try { if (await cancel.onCancel(marker.orderId!) !== false) onClose(); }
        catch (error) { setCancelError(error instanceof Error ? error.message : "挂单未能撤销，请重新读取后重试。"); }
        finally { cancelLock.current = false; setWorking(false); }
      }}>撤销挂单 <X size={14} aria-hidden="true" /></button>
        : (marker.kind === "stop-loss" || marker.kind === "take-profit") && <button type="button" className="chart-trading-row" disabled={trading.disabled || !editableMarker} onClick={() => { setAttempted(true); if (trading.onMarkerAction?.(marker, null)) onClose(); }}>删除{marker.kind === "stop-loss" ? "止损" : "止盈"}<X size={14} aria-hidden="true" /></button>}
      {marker.source === "plan" && <span role="status">已保存的计划，仅供回看</span>}
      {editableMarker && !marker.movable && marker.hint && <span role="status">{marker.hint}</span>}
    </div>}
    {target.cancelIds && <div className="chart-trading-group">
      {cancelledOrders.map(order => <button className="chart-trading-row" type="button" key={order.id} aria-label={`撤单 ${order.label}`} disabled={working || cancel?.disabled} onClick={async () => {
        if (!cancel || cancel.disabled || cancelLock.current) return;
        cancelLock.current = true; setWorking(true); setCancelError("");
        try { if (await cancel.onCancel(order.id) !== false) onClose(); }
        catch (error) { setCancelError(error instanceof Error ? error.message : "挂单未能撤销，请重新读取后重试。"); }
        finally { cancelLock.current = false; setWorking(false); }
      }}><span>{order.label}</span><X size={14} aria-hidden="true" /></button>)}
      {!cancelledOrders.length && <span role="status">该挂单已成交或已撤销</span>}
      {working && <span role="status">正在提交撤单…</span>}
    </div>}
    {!marker && !target.cancelIds && !target.protectionOnly && <div className="chart-trading-group" aria-label="挂单">
      {orders.map(choice => {
        const quantity = trading.previewQuantity?.(choice, target.price) ?? trading.quantity.value;
        const label = chartOrderLabel(choice);
        return <button type="button" key={`${choice.side}-${choice.orderType}`} className={`chart-trading-row ${choice.side}`} disabled={trading.disabled || choice.side === "sell" && trading.sellDisabled}
          title={`${choice.side === "buy" ? "买入" : "卖出"}${choice.orderType === "limit" ? "限价" : "突破"}，点击即提交一笔挂单；数量沿用下方仓位设置`}
          onClick={() => { setAttempted(true); if (trading.onOrder(choice, target.price) === true) onClose(); }}>
          <span>{label} <span className="chart-trading-quantity">{quantity === "" ? "先设止损" : `${quantity}${trading.quantity.unit}`}</span></span><strong>{priceLabel}</strong>
        </button>;
      })}
    </div>}
    {!marker && !target.cancelIds && protections.length > 0 && <div className="chart-trading-group" aria-label="持仓保护价">
      {protections.map(({position, kind}) => <button type="button" className="chart-trading-row" key={position.id} disabled={trading.disabled} title="点击即修改此笔持仓，另一侧保护价保持原值" onClick={() => applyProtection(kind, position.id)}>
        <span>{kind === "stop-loss" ? "止损" : "止盈"} <span className="chart-trading-quantity">{position.label}</span></span><strong>{priceLabel}</strong>
      </button>)}
    </div>}
    {!marker && !target.cancelIds && !target.protectionOnly && <div className="chart-trading-group" aria-label="新委托保护价">
      {(["stop-loss", "take-profit"] as const).map(kind => <button type="button" className="chart-trading-row" key={kind} disabled={trading.disabled} title="填入下方新委托的保护价，后续开仓沿用此价格" onClick={() => applyProtection(kind)}>
        <span>{trading.positions.length ? "新委托" : "设置"}{kind === "stop-loss" ? "止损" : "止盈"}</span><strong>{priceLabel}</strong>
      </button>)}
    </div>}
    {error && <div className="chart-trading-error" role="alert">{error}</div>}
    {!marker && !target.cancelIds && !target.protectionOnly && target.candle && <button type="button" className="ghost-button chart-trading-decision" onClick={() => { onDecision(target.candle!); onClose(); }}>补写事前决策</button>}
  </div>, document.body);
}
