"use client";
import { X } from "lucide-react";
export function ChartDrawingTextEditor({ value, onChange, onPlace, onCancel, maxLength, className = "drawing-text-editor" }: {
  value: string; onChange: (value: string) => void; onPlace: () => void; onCancel: () => void; maxLength?: number; className?: string;
}) {
  return <form className={className} aria-label="文字标记输入" title="输入后按 Enter，再在图表拖出文字区域；选中后可移动、缩放和改字" onSubmit={e => { e.preventDefault(); onPlace(); }}>
    <input autoFocus value={value} aria-label="图表文字" placeholder="输入要写在图表上的文字" maxLength={maxLength} onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === "Escape") onCancel(); }} />
    <button type="submit" disabled={!value.trim()}>放置</button><button type="button" aria-label="取消文字标记" onClick={onCancel}><X size={15} /></button>
  </form>;
}
