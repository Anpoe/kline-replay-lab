export type Mt4BatchRow = { lots: string; price: string; sl: string; tp: string };
export type Mt4OrderSettings = {
  version: 1; count: string; sizingMode: 'fixed' | 'risk-percent'; riskPercent: string;
  orderType: 'market' | 'limit' | 'stop'; price: string; sl: string; tp: string; slippage: string;
  gapMode: 'off' | 'high' | 'low'; gapUnit: 'price' | 'percent'; gapThreshold: string; rows: Mt4BatchRow[];
};
type Storage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };
export function defaultMt4OrderSettings(): Mt4OrderSettings {
  return { version: 1, count: '1', sizingMode: 'fixed', riskPercent: '1', orderType: 'market', price: '', sl: '', tp: '', slippage: '20', gapMode: 'off', gapUnit: 'percent', gapThreshold: '3', rows: [] };
}
export function serializeMt4OrderSettings(value: Mt4OrderSettings) {
  return JSON.stringify({ ...defaultMt4OrderSettings(), ...value, rows: value.rows.map(row => ({ lots: row.lots, price: row.price, sl: row.sl, tp: row.tp })) });
}
export function resizeMt4BatchRows(rows: Mt4BatchRow[], count: number, defaults: Mt4BatchRow) {
  const next = rows.slice(0, 10).map(row => ({ ...row }));
  if (Number.isInteger(count) && count >= 1 && count <= 10) while (next.length < count) next.push({ ...defaults });
  return next;
}
const key = (account: string, symbol: string) => account && symbol ? `kline.mt4.order-settings.v1:${encodeURIComponent(account)}:${encodeURIComponent(symbol)}` : '';
function valid(value: unknown): value is Mt4OrderSettings {
  if (!value || typeof value !== 'object') return false;
  const s = value as Mt4OrderSettings, text = (x: unknown) => typeof x === 'string' && x.length <= 64;
  return s.version === 1 && ['count', 'riskPercent', 'price', 'sl', 'tp', 'slippage', 'gapThreshold'].every(k => text(s[k as keyof Mt4OrderSettings]))
    && ['fixed', 'risk-percent'].includes(s.sizingMode) && ['market', 'limit', 'stop'].includes(s.orderType)
    && ['off', 'high', 'low'].includes(s.gapMode) && ['price', 'percent'].includes(s.gapUnit)
    && Array.isArray(s.rows) && s.rows.length <= 10 && s.rows.every(row => row && ['lots', 'price', 'sl', 'tp'].every(k => text(row[k as keyof Mt4BatchRow])));
}
export function readMt4OrderSettings(storage: Storage, account: string, symbol: string) {
  const fallback = defaultMt4OrderSettings(), scope = key(account, symbol);
  if (!scope) return { value: fallback, error: '' };
  try {
    const raw = storage.getItem(scope); if (raw == null) return { value: fallback, error: '' };
    const value: unknown = JSON.parse(raw);
    if (!valid(value)) throw Error('invalid');
    return { value, error: '' };
  } catch { return { value: fallback, error: '下单设置未能读取，当前使用默认值；修改后可重新保存。' }; }
}
export function saveMt4OrderSettings(storage: Storage, account: string, symbol: string, value: Mt4OrderSettings) {
  const scope = key(account, symbol);
  if (!scope || !valid(value)) return { saved: false, error: '下单设置未保存，请检查当前填写内容。' };
  try { storage.setItem(scope, serializeMt4OrderSettings(value)); return { saved: true, error: '' }; }
  catch { return { saved: false, error: '下单设置未保存，请释放浏览器存储空间后重试；当前填写内容已保留。' }; }
}
