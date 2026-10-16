"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, X } from "lucide-react";

export function Mt4Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss, paused]);
  if (typeof document === "undefined") return null;
  return createPortal(<div className="mt4-toast" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
    onFocusCapture={() => setPaused(true)} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false); }}
    onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onDismiss(); } }}>
    <CheckCircle2 size={18} aria-hidden="true" />
    <span role="status" aria-live="polite" aria-atomic="true">{message}</span>
    <button type="button" aria-label="关闭通知" title="关闭通知" onClick={onDismiss}><X size={16} aria-hidden="true" /></button>
  </div>, document.body);
}
