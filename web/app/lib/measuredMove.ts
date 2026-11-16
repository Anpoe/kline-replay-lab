import type { OverlayFigure, OverlayTemplate } from "klinecharts";

/** Two anchors mark 0 and 0.5; the remaining equal price move ends at 1. */
export const measuredMoveOverlay: OverlayTemplate = {
  name: "trainingMeasuredMove",
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ chart, overlay, coordinates }) => {
    const start = coordinates[0], middle = coordinates[1];
    const startPrice = overlay.points[0]?.value, middlePrice = overlay.points[1]?.value;
    if (!start || !middle || startPrice == null || middlePrice == null) return [];
    const targetPrice = middlePrice * 2 - startPrice;
    if (![startPrice, middlePrice, targetPrice].every(Number.isFinite)) return [];
    const target = chart.convertToPixel({ value: targetPrice }, { paneId: overlay.paneId });
    const targetY = (Array.isArray(target) ? target[0] : target)?.y;
    if (targetY == null || ![start.x, middle.x, start.y, middle.y, targetY].every(Number.isFinite)) return [];

    const chartStyles = chart.getStyles();
    const line = overlay.styles?.line ?? {};
    const color = line.color ?? chartStyles.overlay.line.color;
    const precision = chart.getSymbol()?.pricePrecision ?? 2;
    const showPrice = chartStyles.candle.priceMark.show;
    const left = Math.min(start.x, middle.x);
    const right = left + Math.max(80, Math.abs(middle.x - start.x));
    const levels = [
      { ratio: "0", price: startPrice, y: start.y },
      { ratio: "0.5", price: middlePrice, y: middle.y },
      { ratio: "1", price: targetPrice, y: targetY },
    ];
    return levels.flatMap(({ ratio, price, y }): OverlayFigure[] => [{
      type: "line",
      attrs: { coordinates: [{ x: left, y }, { x: right, y }] },
      styles: { color, size: line.size ?? chartStyles.overlay.line.size, style: line.style ?? "solid" },
    }, {
      type: "text",
      attrs: { x: left + 4, y: y - 4, text: showPrice ? `${ratio} (${price.toFixed(precision)})` : ratio, align: "left", baseline: "bottom" },
      styles: { ...chartStyles.overlay.text, color, size: 12, backgroundColor: "transparent", borderSize: 0, paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 },
      ignoreEvent: true,
    }]);
  },
};
