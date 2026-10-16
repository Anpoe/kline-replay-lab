"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, LineChart, X } from "lucide-react";
import { ChartIndicatorEditor } from "./ChartIndicatorEditor";
import type { MovingAverageKind, MovingAverageSettings, MacdSettings } from "../lib/chartIndicators";
export function ChartIndicatorMenu({ settings, onChange, macdSettings, onMacdChange, open, onOpenChange }: {
  settings: MovingAverageSettings; onChange: (settings: MovingAverageSettings) => void;
  macdSettings: MacdSettings; onMacdChange: (settings: MacdSettings) => void; open: boolean; onOpenChange: (value: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 80, width: 430 });
  const place = useCallback(() => {
    const bounds = root.current?.getBoundingClientRect(); if (!bounds) return;
    const width = Math.min(430, innerWidth - 24);
    setPosition({ left: Math.max(12, Math.min(bounds.right - width, innerWidth - width - 12)), top: Math.min(bounds.bottom + 8, innerHeight - 64), width });
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onOpenChange(false); };
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target) && !popover.current?.contains(event.target)) onOpenChange(false); };
    const resize = new ResizeObserver(place); if (root.current) resize.observe(root.current);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    document.addEventListener("keydown", close); document.addEventListener("pointerdown", outside);
    return () => { resize.disconnect(); document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, onOpenChange, place]);
  const summary = [...(["ma", "ema"] as MovingAverageKind[]).filter(kind => settings[kind].enabled)
    .map(kind => `${kind.toUpperCase()} ${settings[kind].periods.join("/")}`), ...(macdSettings.enabled ? [`MACD ${macdSettings.periods.join("/")}`] : [])].join(" · ") || "未启用";
  return <div className="indicator-toolbar" ref={root} data-shared-indicators><button type="button" className={open ? "active" : ""}
    aria-label="图表指标设置" aria-expanded={open} title={`指标：${summary}`} onClick={() => { if (!open) place(); onOpenChange(!open); }}><LineChart size={15} /><span>指标</span><small>{summary}</small><ChevronDown size={13} /></button>
    {open && createPortal(<div ref={popover} className="indicator-popover" style={{ position: "fixed", ...position, maxHeight: `calc(100dvh - ${position.top + 12}px)`, overflowY: "auto" }} role="dialog" aria-label="图表指标设置"><header><strong title="均线显示在主图，MACD 显示在副图">图表指标</strong><button type="button" aria-label="关闭指标设置" onClick={() => onOpenChange(false)}><X size={15} /></button></header>
      <ChartIndicatorEditor settings={settings} onChange={onChange} macdSettings={macdSettings} onMacdChange={onMacdChange} /></div>, document.body)}
  </div>;
}
