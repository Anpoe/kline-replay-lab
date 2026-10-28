const fields = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'turnover'];
const equal = (left, right) => fields.every(field => left[field] === right[field]);
// Each subscription update recalculates every indicator over the whole dataset.
// Load a batch once; retain incremental updates for one candle and its prior close.
const MAX_INCREMENTAL_UPDATES = 2;
// null requests an authoritative load for a changed history/window or a bulk step.
export function incrementalBarUpdates(previous, next) {
  if (!previous.length || next.length < previous.length
    || next.length - previous.length > MAX_INCREMENTAL_UPDATES) return null;
  for (let i = 0; i < previous.length; i++) {
    if (previous[i].timestamp !== next[i]?.timestamp || (i < previous.length - 1 && !equal(previous[i], next[i]))) return null;
  }
  const last = previous.length - 1;
  const updates = [...(!equal(previous[last], next[last]) ? [next[last]] : []), ...next.slice(previous.length)];
  return updates.length <= MAX_INCREMENTAL_UPDATES ? updates : null;
}
