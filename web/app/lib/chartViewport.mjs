// KLineCharts measures blank space from the candle edge; the handle marks its center.
export function chartShiftPlacement(width, barSpace, percent) {
  if (!(width > 0) || !Number.isFinite(width) || !(barSpace > 0) || !Number.isFinite(barSpace)) return null;
  const normalized = Math.max(5, Math.min(50, Number.isFinite(percent) ? percent : 20));
  const x = width * (1 - normalized / 100);
  return { x, rightOffset: width - x - barSpace / 2, percent: normalized };
}
