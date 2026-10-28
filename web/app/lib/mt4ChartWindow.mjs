import { mt4ServerTime } from './mt4Clock.mjs';
import { mt4CandleCloseTime } from './mt4CandleCountdown.mjs';

export const DEFAULT_MT4_CHART_MOTION = Object.freeze({ enabled: false, startSeconds: 10, endSeconds: 10, soundEnabled: false });
export function normalizeMt4ChartMotion(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const seconds = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(86400, Math.round(value))) : fallback;
  return { enabled: input.enabled === true, startSeconds: seconds(input.startSeconds, 10), endSeconds: seconds(input.endSeconds, 10), soundEnabled: input.soundEnabled === true };
}

export function shouldPlayMt4WindowSound(previous, next) {
  return !!previous && previous.scope === next.scope && previous.window === 'frozen' && next.window === 'live'
    && next.settings.enabled === true && next.settings.soundEnabled === true
    && ['enabled', 'soundEnabled', 'startSeconds', 'endSeconds'].every(key => previous.settings[key] === next.settings[key]);
}

export function mt4ChartWindow({ settings, openTime, timeframe, serverTime, receivedAt, now, connected, anchor, monotonicNow }) {
  if (!settings.enabled) return 'live';
  if (!connected || !(receivedAt > 0) || now - receivedAt > 15000) return 'paused';
  if (!(serverTime > 0) || !Number.isFinite(serverTime)) return 'clock';
  const closeTime = mt4CandleCloseTime(openTime, timeframe);
  if (closeTime == null) return 'waiting';
  const time = mt4ServerTime({ serverTime, receivedAt, now, anchor, monotonicNow });
  if (time < openTime || time >= closeTime) return 'waiting';
  return time < openTime + settings.startSeconds * 1000 || time >= closeTime - settings.endSeconds * 1000 ? 'live' : 'frozen';
}

/** A new scope/bar takes one genuine snapshot; ticks outside the window retain it. */
export function selectMt4ChartFrame(previous, { scope, bars, window }) {
  if (previous?.scope === scope && (previous.bars === bars || (!previous.bars.length && !bars.length))) return previous;
  if (previous?.scope === scope && previous.bars.at(-1)?.timestamp === bars.at(-1)?.timestamp && window !== 'live') return previous;
  return { scope, bars };
}

export function mt4FloatingOrderKey(order) {
  return JSON.stringify([order.ticket, order.symbol, order.openTime, order.type, order.lots ?? null]);
}
export function selectMt4FloatingFrame(previous, { scope, barTimestamp, window, profit, orders }) {
  const frozen = previous?.scope === scope && previous.barTimestamp === barTimestamp && window !== 'live';
  const orderProfits = Object.fromEntries(orders.filter(order => order.type < 2).map(order => {
    const key = mt4FloatingOrderKey(order);
    return [key, frozen && Object.hasOwn(previous.orderProfits, key) ? previous.orderProfits[key] : order.profit + order.swap + order.commission];
  }));
  const total = values => Object.values(values).reduce((sum, value) => sum + value, 0);
  const added = Object.fromEntries(Object.entries(orderProfits).filter(([key]) => !Object.hasOwn(previous?.orderProfits ?? {}, key)));
  const removed = Object.fromEntries(Object.entries(previous?.orderProfits ?? {}).filter(([key]) => !Object.hasOwn(orderProfits, key)));
  const visibleProfit = frozen ? previous.profit + total(added) - total(removed) : profit;
  const next = { scope, barTimestamp, profit: !orders.length && profit === 0 ? 0 : visibleProfit, orderProfits };
  return previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}
