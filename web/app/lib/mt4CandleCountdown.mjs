import { mt4ServerTime } from './mt4Clock.mjs';

export function mt4CandleCloseTime(openTime, timeframe) {
  if (!(openTime > 0) || ![1, 5, 15, 30, 60, 240, 1440, 10080, 43200].includes(timeframe)) return null;
  const opening = new Date(openTime);
  return timeframe === 43200
    ? Date.UTC(opening.getUTCFullYear(), opening.getUTCMonth() + 1, 1)
    : openTime + timeframe * 60000;
}

export function mt4CandleCountdown({ openTime, timeframe, serverTime, receivedAt, now, connected, anchor, monotonicNow }) {
  const closeTime = mt4CandleCloseTime(openTime, timeframe);
  if (closeTime == null) return null;
  if (!connected || now - receivedAt > 15000) return "已暂停";
  if (!(serverTime > 0)) return "—:—";
  const seconds = Math.max(0, Math.ceil((closeTime - mt4ServerTime({ serverTime, receivedAt, now, anchor, monotonicNow })) / 1000));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  const tail = `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return hours ? `${hours}:${tail}` : tail;
}
