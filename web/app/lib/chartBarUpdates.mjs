const fields = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'turnover'];
const equal = (left, right) => fields.every(field => left[field] === right[field]);
// null means history/window changed; otherwise update the former last bar before appending.
export function incrementalBarUpdates(previous, next) {
  if (!previous.length || next.length < previous.length) return null;
  for (let i = 0; i < previous.length; i++) {
    if (previous[i].timestamp !== next[i]?.timestamp || (i < previous.length - 1 && !equal(previous[i], next[i]))) return null;
  }
  const last = previous.length - 1;
  return [...(!equal(previous[last], next[last]) ? [next[last]] : []), ...next.slice(previous.length)];
}
