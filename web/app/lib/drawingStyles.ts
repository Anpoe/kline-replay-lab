type StyleBag = Record<string, Record<string, unknown>>;

export function drawingVisualStyles(styles: unknown, color: string, borderSize: number) {
  const existing = (styles && typeof styles === "object" ? styles : {}) as StyleBag;
  return {
    ...existing,
    line: { ...existing.line, color, size: borderSize > 0 ? borderSize : Number(existing.line?.size) || 2 },
    rect: { ...existing.rect, color: `${color}24`, borderColor: color, borderSize },
    text: { ...existing.text, color },
    point: { color: "#0c1416", borderSize: 2, radius: 4, ...existing.point, borderColor: color },
  };
}
