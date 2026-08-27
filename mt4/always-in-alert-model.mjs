export function cooldownAlertIndices(states, cooldownBars = 10) {
  if (!Array.isArray(states)) throw new TypeError("states must be an array");
  const cooldown = Math.max(0, Math.round(Number(cooldownBars)));
  const accepted = [];
  let lastAccepted = -cooldown - 1;
  for (let index = 0; index < states.length; index += 1) {
    if (!states[index] || index - lastAccepted <= cooldown) continue;
    accepted.push(index);
    lastAccepted = index;
  }
  return accepted;
}

export function assertClosedBarIndex(index, barCount) {
  if (!Number.isInteger(index) || !Number.isInteger(barCount) || index < 1 || index >= barCount) {
    throw new RangeError("Only a closed candle index (1..barCount-1) may be evaluated");
  }
  return true;
}
