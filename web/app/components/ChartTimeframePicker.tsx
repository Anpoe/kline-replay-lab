"use client";
import { TIMEFRAME_IDS, TIMEFRAME_LABELS } from "../lib/timeframeCatalog";
export function ChartTimeframePicker({ value, available = TIMEFRAME_IDS, disabled, onChange, className = "timeframes" }: {
  value: string; available?: readonly string[]; disabled?: boolean; onChange: (value: string) => void; className?: string;
}) {
  return <div className={className} role="group" aria-label="周期" data-shared-timeframes>{TIMEFRAME_IDS.map(item => {
    const enabled = available.includes(item);
    return <button type="button" key={item} className={`${value === item ? "active" : ""}${enabled ? "" : " unavailable"}`}
      disabled={disabled || !enabled} aria-pressed={value === item} onClick={() => onChange(item)}>{TIMEFRAME_LABELS[item]}</button>;
  })}</div>;
}
