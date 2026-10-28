import type { Mt4Symbol } from "./mt4Contracts";

type LotSymbol = Pick<Mt4Symbol, "symbol" | "minLot" | "maxLot" | "lotStep">;
type LotStorage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };

export function mt4LotPreferenceKey(accountKey: string, symbol?: LotSymbol) {
  return accountKey && symbol?.symbol ? `kline.mt4.order-lots.v1:${encodeURIComponent(accountKey)}:${encodeURIComponent(symbol.symbol)}` : "";
}

export function validMt4Lots(value: string, symbol: LotSymbol) {
  const lots = Number(value), units = lots / symbol.lotStep;
  return /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) && Number.isFinite(lots) && lots > 0
    && [symbol.minLot, symbol.maxLot, symbol.lotStep].every(Number.isFinite)
    && symbol.minLot > 0 && symbol.maxLot >= symbol.minLot && symbol.lotStep > 0
    && lots >= symbol.minLot && lots <= symbol.maxLot
    && Math.abs(units - Math.round(units)) <= 1e-7;
}

export function readMt4Lots(storage: LotStorage, accountKey: string, symbol?: LotSymbol) {
  const fallback = { value: String(symbol && symbol.minLot > 0 ? symbol.minLot : 0.01), error: "" };
  const key = mt4LotPreferenceKey(accountKey, symbol);
  if (!key || !symbol) return fallback;
  try {
    const stored = storage.getItem(key);
    if (stored === null) return fallback;
    return validMt4Lots(stored, symbol) ? { value: stored, error: "" }
      : { ...fallback, error: "已记住的手数不符合当前合约，已恢复最小手数。请重新填写。" };
  } catch { return { ...fallback, error: "手数未能读取，请重新填写后保存。" }; }
}

export function saveMt4Lots(storage: LotStorage, accountKey: string, symbol: LotSymbol | undefined, value: string) {
  const key = mt4LotPreferenceKey(accountKey, symbol);
  if (!key || !symbol || !validMt4Lots(value, symbol)) return { saved: false, error: "" };
  try {
    storage.setItem(key, value.trim());
    return { saved: true, error: "" };
  } catch { return { saved: false, error: "手数未保存，请释放浏览器存储空间后重试；本次仍可使用当前值。" }; }
}
