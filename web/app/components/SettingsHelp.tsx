import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

/** Compact help shared by preference and connection controls. */
export function SettingsHelp({ children, label = "设置说明" }: { children: ReactNode; label?: string }) {
  const id = useId();
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const show = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 48);
    setPosition({
      left: Math.max(24, Math.min(rect.right - width, window.innerWidth - width - 24)),
      top: window.innerHeight - rect.bottom < 260 ? rect.top - 8 : rect.bottom + 8,
      above: window.innerHeight - rect.bottom < 260,
    });
  };
  return (
    <span className="settings-help">
      <button type="button" aria-label={label} aria-describedby={id} aria-expanded={Boolean(position)}
        onMouseEnter={(event) => show(event.currentTarget)} onMouseLeave={() => setPosition(null)}
        onFocus={(event) => show(event.currentTarget)} onBlur={() => setPosition(null)}
        onClick={(event) => show(event.currentTarget)}
        onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setPosition(null); } }}>
        <Info size={14} />
      </button>
      <span id={id} className="live-sr-only">{children}</span>
      {position && createPortal(
        <span className="settings-help-popover" aria-hidden="true" style={{ left: position.left, top: position.top, transform: position.above ? "translateY(-100%)" : undefined }}>{children}</span>,
        document.body,
      )}
    </span>
  );
}
