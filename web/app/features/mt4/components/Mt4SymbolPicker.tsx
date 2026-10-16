"use client";
import { useState } from "react";
import { Star } from "lucide-react";
import { groupFavoriteSymbols, normalizeFavoriteSymbols } from "../../../lib/symbolFavorites";
const key = "kline.mt4.symbol-favorites.v1";
function load() {
  try { return { favorites: typeof window === "undefined" ? [] : normalizeFavoriteSymbols(JSON.parse(localStorage.getItem(key) ?? "[]")), error: "" }; }
  catch { return { favorites: [], error: "收藏未能读取，重新收藏可保存当前选择。" }; }
}
export function Mt4SymbolPicker({ symbols, value, disabled, onChange }: { symbols: readonly { symbol: string }[]; value: string; disabled: boolean; onChange: (symbol: string) => void }) {
  const [initial] = useState(load);
  const [favorites, setFavorites] = useState<string[]>(initial.favorites), [error, setError] = useState(initial.error);
  const grouped = groupFavoriteSymbols(symbols, favorites), selected = favorites.includes(value);
  const toggle = () => {
    const next = selected ? favorites.filter(s => s !== value) : [...favorites, value];
    try { localStorage.setItem(key, JSON.stringify(next)); setFavorites(next); setError(""); }
    catch { setError("收藏未保存，请释放浏览器存储空间后重试。"); }
  };
  return <div className="mt4-symbol-picker"><label title="来自 MT4 市场报价，收藏品种置顶"><select aria-label="品种，来自 MT4 市场报价；收藏品种置顶" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
    {grouped.favorites.length > 0 && <optgroup label="收藏品种">{grouped.favorites.map(s => <option key={s.symbol} value={s.symbol}>★ {s.symbol}</option>)}</optgroup>}
    <optgroup label="其他品种">{grouped.others.map(s => <option key={s.symbol} value={s.symbol}>{s.symbol}</option>)}</optgroup>
  </select></label><button type="button" className={`ghost-button mt4-favorite-toggle ${selected ? "active" : ""}`} disabled={!value}
    aria-pressed={selected} aria-label={selected ? "取消收藏当前品种" : "收藏当前品种"} title={selected ? "取消收藏" : "收藏品种，菜单置顶"} onClick={toggle}><Star size={15} fill={selected ? "currentColor" : "none"} /></button>
    {error && <span className="mt4-preference-error" role="alert">{error}</span>}
  </div>;
}
