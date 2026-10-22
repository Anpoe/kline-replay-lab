// MT4 snapshots have whole-second resolution. Keep one monotonic anchor instead
// of restarting elapsed time at every heartbeat's (variable) arrival time.
export function synchronizeMt4Clock(previous, { scope, serverTime, receivedAt, connected, now, monotonicNow }) {
  if (!connected || !(serverTime > 0) || !Number.isFinite(serverTime) || !(receivedAt > 0) || now - receivedAt > 15000) return null;
  const sameScope = previous?.scope === scope;
  if (sameScope && receivedAt <= previous.receivedAt) return previous;
  const sampledTime = serverTime * 1000 + Math.max(0, now - receivedAt);
  const projectedTime = sameScope ? previous.anchor.serverTime + monotonicNow - previous.anchor.monotonicTime : NaN;
  // Ignore sub-second quantization/arrival jitter, but accept a material terminal
  // clock correction or a new session. Ordinary samples never change tick phase.
  const keepAnchor = sameScope && monotonicNow >= previous.anchor.monotonicTime && receivedAt - previous.receivedAt <= 15000 && Math.abs(sampledTime - projectedTime) <= 2000;
  return { scope, receivedAt, anchor: keepAnchor ? previous.anchor : { serverTime: sampledTime, monotonicTime: monotonicNow } };
}

export function mt4ServerTime({ serverTime, receivedAt, anchor, now, monotonicNow = now }) {
  return anchor
    ? anchor.serverTime + Math.max(0, monotonicNow - anchor.monotonicTime)
    : serverTime * 1000 + Math.max(0, now - receivedAt);
}
