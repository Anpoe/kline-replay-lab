import type { OverlayTemplate, Point } from "klinecharts";

// Keep the saved two diagonal anchors; the other two handles exist only on canvas.
export function rectangleControlPoints(points: Array<Partial<Point>>) {
  const [start, end] = points;
  if (!start || !end) return points;
  return [{ ...start }, { ...end }, { ...end, value: start.value }, { ...start, value: end.value }];
}

export const rectangleOverlay: OverlayTemplate = {
  name: "trainingRectangle",
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  performEventMoveForDrawing: ({ points }) => {
    if (points.length >= 2) points.splice(0, points.length, ...rectangleControlPoints(points));
  },
  performEventPressedMove: ({ points, performPointIndex, performPoint }) => {
    if (points.length < 2) return;
    if (performPointIndex === 2) {
      points[0].value = performPoint.value;
      points[1] = { ...points[1], timestamp: performPoint.timestamp, dataIndex: performPoint.dataIndex };
    } else if (performPointIndex === 3) {
      points[0] = { ...points[0], timestamp: performPoint.timestamp, dataIndex: performPoint.dataIndex };
      points[1].value = performPoint.value;
    }
    points.splice(0, points.length, ...rectangleControlPoints(points));
  },
  createPointFigures: ({ overlay, coordinates }) => {
    if (coordinates.length < 2) return [];
    const [start, end] = coordinates;
    const styles = overlay.styles;
    const color = styles?.rect?.borderColor ?? styles?.line?.color ?? "#2962ff";
    const borderSize = styles?.rect?.borderSize ?? styles?.line?.size ?? 2;
    return [{
      type: "rect",
      attrs: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) },
      styles: { style: borderSize === 0 ? "fill" : "stroke_fill", color: borderSize === 0 ? `${color}38` : styles?.rect?.color ?? `${color}24`, borderColor: color, borderSize,
        borderStyle: styles?.rect?.borderStyle ?? "solid", borderDashedValue: styles?.rect?.borderDashedValue ?? [4, 4] },
      ignoreEvent: overlay.currentStep !== -1,
    }];
  },
};
