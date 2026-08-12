"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Chart, KLineData, Overlay, OverlayTemplate, Period, Point } from "klinecharts";
import type { MovingAverageSettings } from "../lib/chartIndicators";

export type DrawingRequest = {
  name: string;
  nonce: number;
  mode?: "normal" | "weak_magnet" | "strong_magnet";
  styles?: unknown;
  extendData?: unknown;
} | null;

export type PersistedDrawing = {
  id: string;
  name: string;
  paneId: string;
  points: Array<Partial<Point>>;
  lock: boolean;
  visible: boolean;
  zLevel: number;
  mode: "normal" | "weak_magnet" | "strong_magnet";
  styles?: unknown;
  extendData?: unknown;
};

export type TradeMarker = {
  id: string;
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  entryTimestamp: number;
  exitPrice?: number;
  exitTimestamp?: number;
  realizedPnl?: number;
  hovered?: boolean;
};

export type DecisionMarker = {
  id: string;
  timestamp: number;
  price: number;
  label: string;
  hovered?: boolean;
};

export type CandleContextTarget = {
  dataIndex: number;
  timestamp: number;
  referencePrice: number;
};

export type ProtectionPriceKind = "stop-loss" | "take-profit";

export type ProtectionLine = {
  id: string;
  kind: ProtectionPriceKind;
  price: number;
  timestamp: number;
  label: string;
  movable: boolean;
  source: "draft" | "position";
  positionId?: string;
  side?: "long" | "short";
};

type TradeOverlayData = TradeMarker;
type DecisionOverlayData = DecisionMarker & { onSelect?: (id: string) => void };

const USER_DRAWING_GROUP = "user-drawings";
const TRADE_MARKER_GROUP = "trade-markers";
const DECISION_MARKER_GROUP = "decision-markers";
const PROTECTION_LINE_GROUP = "protection-lines";
const MOBILE_CHART_QUERY = "(max-width: 600px)";
const MOBILE_REPLAY_RIGHT_OFFSET = 16;
const DESKTOP_REPLAY_RIGHT_OFFSET = 64;
const MOBILE_REPLAY_BAR_SPACE = 8;
const DESKTOP_REPLAY_BAR_SPACE = 16;
const WHEEL_ZOOM_BASE = 1.1;
// Replay windows are intentionally small. Reloading the bounded window avoids
// a Chromium canvas invalidation race where overlays repaint but candles stay
// visually stale after a trade. Large free-training datasets stay incremental.
const AUTHORITATIVE_REPLAY_RESET_BAR_LIMIT = 1_000;
const PRICE_INDICATOR_PANE = "candle_pane";
const PRICE_INDICATOR_STYLES = {
  MA: ["#f2a93b", "#8f6ee8", "#2f80ed", "#20c997", "#ef6a68", "#e1c57f"],
  EMA: ["#ff7a45", "#b37feb", "#36cfc9", "#73d13d", "#ff85c0", "#69c0ff"],
} as const;

function syncMovingAverageIndicators(chart: Chart, settings: MovingAverageSettings) {
  (["MA", "EMA"] as const).forEach((name) => {
    const config = name === "MA" ? settings.ma : settings.ema;
    const existing = chart.getIndicators({ paneId: PRICE_INDICATOR_PANE, name });
    if (!config.enabled) {
      if (existing.length) chart.removeIndicator({ paneId: PRICE_INDICATOR_PANE, name });
      return;
    }

    const override = {
      name,
      paneId: PRICE_INDICATOR_PANE,
      calcParams: config.periods,
      styles: {
        lines: PRICE_INDICATOR_STYLES[name].map((color) => ({ color, size: 1.2 })),
      },
    };
    if (existing.length) chart.overrideIndicator(override);
    else chart.createIndicator(override, true);
  });
}
let tradeOverlayRegistered = false;
let decisionOverlayRegistered = false;
let trainingDrawingOverlaysRegistered = false;
let protectionLineOverlayRegistered = false;
let selectedTrainingTextId = "";

type FigureStyleBag = {
  line?: { color?: string; size?: number; style?: string; dashedValue?: number[] };
  rect?: {
    color?: string;
    borderColor?: string;
    borderSize?: number;
    borderStyle?: string;
    borderDashedValue?: number[];
  };
  text?: { color?: string; size?: number };
};

const overlayIgnoreEvents = [
  "onClick",
  "onDoubleClick",
  "onRightClick",
  "onPressedMoveStart",
  "onPressedMoving",
  "onPressedMoveEnd",
  "onSelected",
  "onDeselected",
];

function rgbaFromHex(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return `rgba(41, 98, 255, ${alpha})`;
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function ensureTrainingDrawingOverlays(registerOverlay: (template: OverlayTemplate) => void) {
  if (trainingDrawingOverlaysRegistered) return;

  registerOverlay({
    name: "trainingRectangle",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ overlay, coordinates }) => {
      if (coordinates.length < 2) return [];
      const start = coordinates[0];
      const end = coordinates[1];
      const styles = (overlay.styles ?? {}) as FigureStyleBag;
      const lineColor = styles.line?.color ?? styles.rect?.borderColor ?? "#2962ff";
      return [{
        type: "rect",
        attrs: {
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          width: Math.abs(end.x - start.x),
          height: Math.abs(end.y - start.y),
        },
        styles: {
          style: "stroke_fill",
          color: styles.rect?.color ?? rgbaFromHex(lineColor, 0.14),
          borderColor: styles.rect?.borderColor ?? lineColor,
          borderSize: styles.rect?.borderSize ?? styles.line?.size ?? 2,
          borderStyle: styles.rect?.borderStyle ?? "solid",
          borderDashedValue: styles.rect?.borderDashedValue ?? [4, 4],
        },
        ignoreEvent: overlayIgnoreEvents,
      }];
    },
  });

  const registerPositionOverlay = (name: string, direction: "long" | "short" | "auto") => {
    registerOverlay({
      name,
      totalStep: 4,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: true,
      needDefaultYAxisFigure: true,
      createPointFigures: ({ overlay, coordinates }) => {
        const entryPoint = coordinates[0];
        const targetPoint = coordinates[1];
        if (!entryPoint || !targetPoint) return [];
        const stopPoint = coordinates[2];
        const entryValue = Number(overlay.points[0]?.value ?? 0);
        const rawTargetValue = Number(overlay.points[1]?.value ?? entryValue);
        const rawStopValue = Number(overlay.points[2]?.value ?? entryValue);
        const resolvedDirection = direction === "auto"
          ? (rawTargetValue >= entryValue ? "long" : "short")
          : direction;
        const targetDistance = Math.abs(rawTargetValue - entryValue);
        const stopDistance = Math.abs(rawStopValue - entryValue);
        const targetValue = direction === "auto"
          ? rawTargetValue
          : resolvedDirection === "long" ? entryValue + targetDistance : entryValue - targetDistance;
        const stopValue = direction === "auto"
          ? rawStopValue
          : resolvedDirection === "long" ? entryValue - stopDistance : entryValue + stopDistance;
        const visualTargetPoint = direction === "auto" ? targetPoint : {
          ...targetPoint,
          y: resolvedDirection === "long"
            ? entryPoint.y - Math.abs(targetPoint.y - entryPoint.y)
            : entryPoint.y + Math.abs(targetPoint.y - entryPoint.y),
        };
        const visualStopPoint = !stopPoint ? undefined : direction === "auto" ? stopPoint : {
          ...stopPoint,
          y: resolvedDirection === "long"
            ? entryPoint.y + Math.abs(stopPoint.y - entryPoint.y)
            : entryPoint.y - Math.abs(stopPoint.y - entryPoint.y),
        };
        const rightX = Math.max(entryPoint.x, targetPoint.x, stopPoint?.x ?? targetPoint.x);
        const leftX = Math.min(entryPoint.x, rightX);
        const width = Math.max(1, Math.abs(rightX - entryPoint.x));
        const styles = (overlay.styles ?? {}) as FigureStyleBag;
        const accent = styles.line?.color ?? "#2962ff";
        const lineSize = styles.line?.size ?? 1;
        const positionData = overlay.extendData && typeof overlay.extendData === "object"
          ? overlay.extendData as Record<string, unknown>
          : {};
        const labelsVisible = positionData.hovered === true;
        const figures: Array<Record<string, unknown>> = [
          {
            type: "rect",
            attrs: {
              x: leftX,
              y: Math.min(entryPoint.y, visualTargetPoint.y),
              width,
              height: Math.abs(visualTargetPoint.y - entryPoint.y),
            },
            styles: {
              style: "stroke_fill",
              color: "rgba(38, 166, 154, 0.20)",
              borderColor: "rgba(38, 166, 154, 0.88)",
              borderSize: 1,
            },
            ignoreEvent: overlayIgnoreEvents,
          },
          {
            type: "line",
            attrs: { coordinates: [{ x: entryPoint.x, y: entryPoint.y }, { x: rightX, y: entryPoint.y }] },
            styles: { style: "solid", size: lineSize, color: accent },
            ignoreEvent: overlayIgnoreEvents,
          },
        ];

        const reward = resolvedDirection === "long" ? targetValue - entryValue : entryValue - targetValue;
        const rewardPct = entryValue ? (reward / entryValue) * 100 : 0;
        figures.push({
          type: "text",
          attrs: {
            x: rightX - 5,
            y: visualTargetPoint.y,
            text: `目标 ${rewardPct >= 0 ? "+" : ""}${rewardPct.toFixed(2)}%`,
            align: "right",
            baseline: "middle",
          },
          styles: { color: labelsVisible ? "#dff8f0" : "rgba(0, 0, 0, 0)", size: 10, backgroundColor: labelsVisible ? "#168a73" : "rgba(0, 0, 0, 0)", borderRadius: 3, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 },
          ignoreEvent: overlayIgnoreEvents,
        });

        if (visualStopPoint) {
          figures.push({
            type: "rect",
            attrs: {
              x: leftX,
              y: Math.min(entryPoint.y, visualStopPoint.y),
              width,
              height: Math.abs(visualStopPoint.y - entryPoint.y),
            },
            styles: {
              style: "stroke_fill",
              color: "rgba(239, 83, 80, 0.18)",
              borderColor: "rgba(239, 83, 80, 0.88)",
              borderSize: 1,
            },
            ignoreEvent: overlayIgnoreEvents,
          });
          const risk = resolvedDirection === "long" ? entryValue - stopValue : stopValue - entryValue;
          const riskPct = entryValue ? (risk / entryValue) * 100 : 0;
          const ratio = risk > 0 ? Math.max(0, reward / risk) : 0;
          figures.push(
            {
              type: "text",
              attrs: {
                x: rightX - 5,
                y: visualStopPoint.y,
                text: `止损 ${riskPct >= 0 ? "-" : "+"}${Math.abs(riskPct).toFixed(2)}%`,
                align: "right",
                baseline: "middle",
              },
              styles: { color: labelsVisible ? "#fff0ef" : "rgba(0, 0, 0, 0)", size: 10, backgroundColor: labelsVisible ? "#b84040" : "rgba(0, 0, 0, 0)", borderRadius: 3, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 },
              ignoreEvent: overlayIgnoreEvents,
            },
            {
              type: "text",
              attrs: {
                x: rightX - 5,
                y: entryPoint.y,
                text: `${resolvedDirection === "long" ? "多" : "空"} · 盈亏比 1:${ratio.toFixed(2)}`,
                align: "right",
                baseline: "bottom",
              },
              styles: { color: labelsVisible ? "#ecf3f1" : "rgba(0, 0, 0, 0)", size: 10, backgroundColor: labelsVisible ? "rgba(15, 24, 27, .88)" : "rgba(0, 0, 0, 0)", borderColor: labelsVisible ? accent : "rgba(0, 0, 0, 0)", borderSize: 1, borderRadius: 3, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 },
              ignoreEvent: overlayIgnoreEvents,
            },
          );
        }
        return figures;
      },
      onMouseEnter: ({ chart, overlay }) => {
        const data = overlay.extendData && typeof overlay.extendData === "object"
          ? overlay.extendData as Record<string, unknown>
          : {};
        if (data.hovered === true) return;
        chart.overrideOverlay({ id: overlay.id, extendData: { ...data, hovered: true } });
      },
      onMouseLeave: ({ chart, overlay }) => {
        const data = overlay.extendData && typeof overlay.extendData === "object"
          ? overlay.extendData as Record<string, unknown>
          : {};
        if (data.hovered !== true) return;
        chart.overrideOverlay({ id: overlay.id, extendData: { ...data, hovered: false } });
      },
    });
  };

  registerPositionOverlay("trainingPosition", "auto");
  registerPositionOverlay("trainingLongPosition", "long");
  registerPositionOverlay("trainingShortPosition", "short");
  registerOverlay({
    name: "trainingTextNote",
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates }) => {
      const point = coordinates[0];
      const extendData = overlay.extendData as { text?: string } | null;
      const text = extendData?.text?.trim();
      if (!point || !text) return [];
      const styles = (overlay.styles ?? {}) as FigureStyleBag;
      return [{
        type: "text",
        attrs: { x: point.x + 7, y: point.y - 7, text, align: "left", baseline: "bottom" },
        styles: {
          color: styles.text?.color ?? styles.line?.color ?? "#dce9e6",
          size: styles.text?.size ?? 12,
          weight: 600,
        },
        ignoreEvent: overlayIgnoreEvents,
      }];
    },
  });
  registerOverlay({
    name: "trainingTextBox",
    totalStep: 3,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates }) => {
      const start = coordinates[0];
      const end = coordinates[1];
      const extendData = overlay.extendData as { text?: string } | null;
      const text = extendData?.text?.trim();
      if (!start || !end || !text) return [];

      const styles = (overlay.styles ?? {}) as FigureStyleBag;
      const textColor = styles.text?.color ?? styles.line?.color ?? "#dce9e6";
      const fontSize = styles.text?.size ?? 18;
      const borderColor = styles.rect?.borderColor ?? styles.line?.color ?? "#2962ff";
      const selected = overlay.id === selectedTrainingTextId;
      const left = Math.min(start.x, end.x);
      const top = Math.min(start.y, end.y);
      const width = Math.max(36, Math.abs(end.x - start.x));
      const height = Math.max(fontSize + 16, Math.abs(end.y - start.y));
      const lineHeight = Math.max(14, Math.round(fontSize * 1.35));
      const maxCharacters = Math.max(2, Math.floor((width - 14) / Math.max(5, fontSize * 0.62)));
      const maxLines = Math.max(1, Math.floor((height - 12) / lineHeight));
      const wrappedLines = text.split("\n").flatMap((paragraph) => {
        if (!paragraph) return [""];
        const chunks: string[] = [];
        for (let offset = 0; offset < paragraph.length; offset += maxCharacters) {
          chunks.push(paragraph.slice(offset, offset + maxCharacters));
        }
        return chunks;
      }).slice(0, maxLines);

      const figures: Array<Record<string, unknown>> = selected ? [{
        type: "rect",
        attrs: { x: left, y: top, width, height },
        styles: {
          style: "stroke",
          color: "rgba(0, 0, 0, 0)",
          borderColor,
          borderSize: styles.rect?.borderSize ?? styles.line?.size ?? 1,
          borderStyle: styles.rect?.borderStyle ?? "solid",
        },
        ignoreEvent: overlayIgnoreEvents,
      }] : [];
      wrappedLines.forEach((line, index) => {
        figures.push({
          type: "text",
          attrs: {
            x: left + 7,
            y: top + 6 + index * lineHeight,
            text: line,
            align: "left",
            baseline: "top",
          },
          styles: {
            style: "fill",
            color: textColor,
            size: fontSize,
            weight: 600,
            family: "Helvetica Neue",
            backgroundColor: "transparent",
            borderColor: "transparent",
            borderSize: 0,
            borderRadius: 0,
            paddingLeft: 0,
            paddingTop: 0,
            paddingRight: 0,
            paddingBottom: 0,
          },
        });
      });
      return figures;
    },
  });
  trainingDrawingOverlaysRegistered = true;
}

function alignLatestCandle(chart: Chart) {
  chart.scrollToRealTime();
  if (window.matchMedia(MOBILE_CHART_QUERY).matches) {
    chart.setOffsetRightDistance(MOBILE_REPLAY_RIGHT_OFFSET);
  } else {
    chart.setOffsetRightDistance(DESKTOP_REPLAY_RIGHT_OFFSET);
  }
}

function ensureProtectionLineOverlay(registerOverlay: (template: OverlayTemplate) => void) {
  if (protectionLineOverlayRegistered) return;
  registerOverlay({
    name: "trainingProtectionLine",
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates, bounding }) => {
      const point = coordinates[0];
      const data = overlay.extendData as ProtectionLine | null;
      if (!point || !data) return [];
      const stop = data.kind === "stop-loss";
      const color = stop ? "#ff6b68" : "#24d6a2";
      return [{
        type: "line",
        attrs: { coordinates: [{ x: 0, y: point.y }, { x: bounding.width, y: point.y }] },
        styles: { color, size: data.source === "position" ? 1.6 : 1.2, style: "dashed", dashedValue: [6, 4] },
      }, {
        type: "text",
        attrs: { x: 8, y: point.y - 5, text: data.label, align: "left", baseline: "bottom" },
        styles: { color, size: 11, weight: 650, backgroundColor: "rgba(8, 16, 18, .82)", paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 },
      }];
    },
  });
  protectionLineOverlayRegistered = true;
}

function wheelZoomScale(event: WheelEvent, viewportHeight: number) {
  const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? 32
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? viewportHeight
      : 1);
  const steps = Math.min(2, Math.max(0.25, Math.abs(delta) / 100));
  return Math.pow(WHEEL_ZOOM_BASE, (delta < 0 ? 1 : -1) * steps);
}

function ensureTradeOverlay(registerOverlay: (template: OverlayTemplate<TradeOverlayData>) => void) {
  if (tradeOverlayRegistered) return;
  const template: OverlayTemplate<TradeOverlayData> = {
    name: "tradeLifecycle",
    totalStep: 3,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates }) => {
      const trade = overlay.extendData;
      const entry = coordinates[0];
      if (!trade || !entry) return [];

      const isLong = trade.side === "long";
      const entryColor = isLong ? "#36d6a6" : "#ff7b78";
      const tagAlpha = trade.hovered ? "ff" : "86";
      const pointAlpha = trade.hovered ? "ff" : "78";
      const lineAlpha = trade.hovered ? "9a" : "34";
      const entryText = (isLong ? "买" : "卖") + " " + trade.qty;
      const figures = [
        {
          type: "circle",
          attrs: { x: entry.x, y: entry.y, r: 4 },
          styles: { style: "stroke_fill", color: "#0c1416", borderColor: entryColor + pointAlpha, borderSize: 2 },
          ignoreEvent: ["onClick", "onDoubleClick", "onRightClick", "onPressedMoveStart", "onPressedMoving", "onPressedMoveEnd", "onSelected", "onDeselected"],
        },
        {
          type: "text",
          attrs: {
            x: entry.x,
            y: entry.y + (isLong ? 14 : -14),
            text: entryText,
            align: "center",
            baseline: isLong ? "top" : "bottom",
          },
          styles: {
            color: "#07120f" + tagAlpha,
            size: 10,
            weight: 700,
            backgroundColor: entryColor + tagAlpha,
            borderRadius: 4,
            paddingLeft: 5,
            paddingRight: 5,
            paddingTop: 3,
            paddingBottom: 3,
          },
          ignoreEvent: ["onClick", "onDoubleClick", "onRightClick", "onPressedMoveStart", "onPressedMoving", "onPressedMoveEnd", "onSelected", "onDeselected"],
        },
      ];

      const exit = coordinates[1];
      if (exit) {
        const pnlValue = trade.realizedPnl ?? 0;
        const pnlText = (pnlValue >= 0 ? "+" : "") + pnlValue.toFixed(2);
        figures.unshift({
          type: "line",
          attrs: { coordinates: [entry, exit] },
          styles: { style: "dashed", size: 1, color: "#d6e7e3" + lineAlpha, dashedValue: [5, 5] },
          ignoreEvent: ["onClick", "onDoubleClick", "onRightClick", "onPressedMoveStart", "onPressedMoving", "onPressedMoveEnd", "onSelected", "onDeselected"],
        });
        figures.push(
          {
            type: "circle",
            attrs: { x: exit.x, y: exit.y, r: 4 },
            styles: { style: "stroke_fill", color: "#0c1416", borderColor: "#d9e8e4" + pointAlpha, borderSize: 2 },
            ignoreEvent: ["onClick", "onDoubleClick", "onRightClick", "onPressedMoveStart", "onPressedMoving", "onPressedMoveEnd", "onSelected", "onDeselected"],
          },
          {
            type: "text",
            attrs: {
              x: exit.x,
              y: exit.y + (isLong ? -14 : 14),
              text: "平 " + pnlText,
              align: "center",
              baseline: isLong ? "bottom" : "top",
            },
            styles: {
              color: "#0b1416" + tagAlpha,
              size: 10,
              weight: 700,
              backgroundColor: "#d9e8e4" + tagAlpha,
              borderRadius: 4,
              paddingLeft: 5,
              paddingRight: 5,
              paddingTop: 3,
              paddingBottom: 3,
            },
            ignoreEvent: ["onClick", "onDoubleClick", "onRightClick", "onPressedMoveStart", "onPressedMoving", "onPressedMoveEnd", "onSelected", "onDeselected"],
          },
        );
      }
      return figures;
    },
    onMouseEnter: ({ chart, overlay }) => {
      const trade = overlay.extendData;
      if (!trade || trade.hovered) return;
      chart.overrideOverlay({ id: overlay.id, extendData: { ...trade, hovered: true } });
    },
    onMouseLeave: ({ chart, overlay }) => {
      const trade = overlay.extendData;
      if (!trade || !trade.hovered) return;
      chart.overrideOverlay({ id: overlay.id, extendData: { ...trade, hovered: false } });
    },
  };
  registerOverlay(template);
  tradeOverlayRegistered = true;
}

function ensureDecisionOverlay(registerOverlay: (template: OverlayTemplate<DecisionOverlayData>) => void) {
  if (decisionOverlayRegistered) return;
  registerOverlay({
    name: "decisionSubmission",
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates }) => {
      const decision = overlay.extendData;
      const point = coordinates[0];
      if (!decision || !point) return [];
      const alpha = decision.hovered ? "ff" : "82";
      const pointAlpha = decision.hovered ? "ff" : "9a";
      return [
        {
          type: "circle",
          attrs: { x: point.x, y: point.y, r: 4 },
          styles: {
            style: "stroke_fill",
            color: "#0c1416",
            borderColor: "#f1c86a" + pointAlpha,
            borderSize: 2,
          },
          ignoreEvent: ["onDoubleClick", "onRightClick", "onPressedMoveStart", "onPressedMoving", "onPressedMoveEnd"],
        },
        {
          type: "text",
          attrs: {
            x: point.x,
            y: point.y - 14,
            text: decision.label,
            align: "center",
            baseline: "bottom",
          },
          styles: {
            color: "#181207" + alpha,
            size: 10,
            weight: 700,
            backgroundColor: "#f1c86a" + alpha,
            borderRadius: 4,
            paddingLeft: 5,
            paddingRight: 5,
            paddingTop: 3,
            paddingBottom: 3,
          },
          ignoreEvent: ["onDoubleClick", "onRightClick", "onPressedMoveStart", "onPressedMoving", "onPressedMoveEnd"],
        },
      ];
    },
    onClick: ({ overlay }) => {
      const decision = overlay.extendData;
      if (decision) decision.onSelect?.(decision.id);
    },
    onMouseEnter: ({ chart, overlay }) => {
      const decision = overlay.extendData;
      if (!decision || decision.hovered) return;
      chart.overrideOverlay({ id: overlay.id, extendData: { ...decision, hovered: true } });
    },
    onMouseLeave: ({ chart, overlay }) => {
      const decision = overlay.extendData;
      if (!decision || !decision.hovered) return;
      chart.overrideOverlay({ id: overlay.id, extendData: { ...decision, hovered: false } });
    },
  });
  decisionOverlayRegistered = true;
}

function syncTradeMarkers(chart: Chart, tradeMarkers: TradeMarker[]) {
  chart.removeOverlay({ groupId: TRADE_MARKER_GROUP });
  tradeMarkers.forEach((trade) => {
    const points = [{ timestamp: trade.entryTimestamp, value: trade.entryPrice }];
    if (trade.exitTimestamp != null && trade.exitPrice != null) {
      points.push({ timestamp: trade.exitTimestamp, value: trade.exitPrice });
    }
    chart.createOverlay({
      name: "tradeLifecycle",
      groupId: TRADE_MARKER_GROUP,
      points,
      extendData: trade,
      lock: true,
      zLevel: 30,
    });
  });
}

function tradeMarkerSignature(tradeMarkers: TradeMarker[]) {
  return tradeMarkers.map((trade) => [
    trade.id,
    trade.side,
    trade.qty,
    trade.entryTimestamp,
    trade.entryPrice,
    trade.exitTimestamp ?? "",
    trade.exitPrice ?? "",
    trade.realizedPnl ?? "",
  ].join(":"))
    .join("|");
}

function syncDecisionMarkers(
  chart: Chart,
  decisionMarkers: DecisionMarker[],
  onDecisionSelect: (id: string) => void,
) {
  chart.removeOverlay({ groupId: DECISION_MARKER_GROUP });
  decisionMarkers.forEach((decision) => {
    chart.createOverlay({
      name: "decisionSubmission",
      groupId: DECISION_MARKER_GROUP,
      points: [{ timestamp: decision.timestamp, value: decision.price }],
      extendData: { ...decision, onSelect: onDecisionSelect },
      lock: true,
      zLevel: 31,
    });
  });
}

function decisionMarkerSignature(decisionMarkers: DecisionMarker[]) {
  return decisionMarkers.map((decision) => [
    decision.id,
    decision.timestamp,
    decision.price,
    decision.label,
  ].join(":"))
    .join("|");
}

function syncProtectionLines(
  chart: Chart,
  protectionLines: ProtectionLine[],
  onMove: (line: ProtectionLine, price: number) => boolean,
) {
  chart.removeOverlay({ groupId: PROTECTION_LINE_GROUP });
  protectionLines.forEach((line) => {
    chart.createOverlay({
      id: `protection:${line.id}`,
      name: "trainingProtectionLine",
      groupId: PROTECTION_LINE_GROUP,
      points: [{ timestamp: line.timestamp, value: line.price }],
      extendData: line,
      lock: !line.movable,
      zLevel: 29,
      onPressedMoveEnd: ({ chart: eventChart, overlay }) => {
        const nextPrice = Number(overlay.points[0]?.value);
        if (Number.isFinite(nextPrice) && nextPrice > 0 && onMove(line, nextPrice)) return;
        eventChart.overrideOverlay({
          id: overlay.id,
          points: [{ timestamp: line.timestamp, value: line.price }],
        });
      },
    });
  });
}

function protectionLineSignature(protectionLines: ProtectionLine[]) {
  return protectionLines.map((line) => [
    line.id,
    line.kind,
    line.price,
    line.timestamp,
    line.label,
    line.movable,
  ].join(":"))
    .join("|");
}

function serializeDrawing(overlay: Overlay, dataIndexOffset: number): PersistedDrawing {
  const rawExtendData = overlay.extendData ?? undefined;
  const extendData = ["trainingPosition", "trainingLongPosition", "trainingShortPosition"].includes(overlay.name)
    && rawExtendData && typeof rawExtendData === "object"
    ? Object.fromEntries(Object.entries(rawExtendData).filter(([key]) => key !== "hovered"))
    : rawExtendData;
  return {
    id: overlay.id,
    name: overlay.name,
    paneId: overlay.paneId,
    points: overlay.points.map((point) => ({
      dataIndex: point.dataIndex == null ? undefined : point.dataIndex + dataIndexOffset,
      timestamp: point.timestamp,
      value: point.value,
    })),
    lock: overlay.lock,
    visible: overlay.visible,
    zLevel: overlay.zLevel,
    mode: overlay.mode,
    styles: overlay.styles ?? undefined,
    extendData,
  };
}

type TrainingTextBoxData = Record<string, unknown> & {
  text?: string;
  textBaseWidth?: number;
  textBaseHeight?: number;
  textBaseSize?: number;
};

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * Keep the text size tied to the drawn box. KLineCharts moves the overlay
 * points when a handle is dragged, but it does not resize custom figures for
 * us, so we persist the original box as a baseline and derive a new font size
 * from the new box dimensions after each drag.
 */
function syncTrainingTextBoxScale(chart: Chart, overlay: Overlay, initializeBase = false) {
  if (overlay.name !== "trainingTextBox" || overlay.points.length < 2) return;

  const converted = chart.convertToPixel(overlay.points, { paneId: overlay.paneId });
  const coordinates = (Array.isArray(converted) ? converted : [converted]) as Array<Partial<{ x: number; y: number }> >;
  const start = coordinates[0];
  const end = coordinates[1];
  if (start?.x == null || start.y == null || end?.x == null || end.y == null) return;

  const width = Math.max(36, Math.abs(end.x - start.x));
  const height = Math.max(24, Math.abs(end.y - start.y));
  const rawStyles = overlay.styles && typeof overlay.styles === "object"
    ? overlay.styles as Record<string, unknown>
    : {};
  const rawTextStyles = rawStyles.text && typeof rawStyles.text === "object"
    ? rawStyles.text as Record<string, unknown>
    : {};
  const currentSize = positiveNumber(rawTextStyles.size) ?? 18;
  const data = overlay.extendData && typeof overlay.extendData === "object"
    ? { ...(overlay.extendData as Record<string, unknown>) } as TrainingTextBoxData
    : {} as TrainingTextBoxData;
  const text = typeof data.text === "string" ? data.text : "";
  const baseSize = positiveNumber(data.textBaseSize);
  const baseWidth = positiveNumber(data.textBaseWidth);
  const baseHeight = positiveNumber(data.textBaseHeight);
  const inferredWidth = Math.max(36, text.length * currentSize * 0.62 + 14);
  const inferredHeight = Math.max(24, currentSize + 16);
  const effectiveBaseWidth = baseWidth ?? (initializeBase ? width : inferredWidth);
  const effectiveBaseHeight = baseHeight ?? (initializeBase ? height : inferredHeight);
  const effectiveBaseSize = baseSize ?? currentSize;
  const shouldScale = !initializeBase && baseWidth != null && baseHeight != null && baseSize != null;

  let nextSize = currentSize;
  if (shouldScale) {
    const scaleX = width / effectiveBaseWidth;
    const scaleY = height / effectiveBaseHeight;
    const xChanged = Math.abs(scaleX - 1) > 0.02;
    const yChanged = Math.abs(scaleY - 1) > 0.02;
    const scale = xChanged && yChanged
      ? Math.sqrt(scaleX * scaleY)
      : xChanged ? scaleX : scaleY;
    nextSize = Math.max(10, Math.min(96, Math.round(effectiveBaseSize * scale)));
  }

  const nextStyles = {
    ...rawStyles,
    text: {
      ...rawTextStyles,
      size: nextSize,
      backgroundColor: "transparent",
      borderColor: "transparent",
      borderSize: 0,
      paddingLeft: 0,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
    },
  };
  const nextData: TrainingTextBoxData = {
    ...data,
    textBaseWidth: effectiveBaseWidth,
    textBaseHeight: effectiveBaseHeight,
    textBaseSize: effectiveBaseSize,
  };
  const missingBaseline = baseWidth == null || baseHeight == null || baseSize == null;
  if (missingBaseline || nextSize !== currentSize) {
    chart.overrideOverlay({ id: overlay.id, styles: nextStyles, extendData: nextData });
  }
}

function getPersistedDrawings(chart: Chart, dataIndexOffset: number) {
  return chart.getOverlays({ groupId: USER_DRAWING_GROUP })
    .map((overlay) => serializeDrawing(overlay, dataIndexOffset));
}

const periods: Record<string, Period> = {
  "1m": { type: "minute", span: 1 },
  "5m": { type: "minute", span: 5 },
  "1h": { type: "hour", span: 1 },
  "1d": { type: "day", span: 1 },
  "1w": { type: "week", span: 1 },
};

export function KLineReplayChart({
  bars,
  dataIndexOffset,
  symbol,
  timezone,
  timeframe,
  pricePrecision,
  movingAverageSettings,
  drawingRequest,
  clearNonce,
  tradeMarkers,
  decisionMarkers,
  protectionLines,
  priceSelectionMode,
  drawings,
  selectedDrawingId,
  drawingsRestoreNonce,
  hideDate,
  hidePrice,
  onDecisionSelect,
  onProtectionPriceSelect,
  onProtectionLineMove,
  onCandleContextMenu,
  onDrawingsChange,
  onDrawingSelect,
}: {
  bars: KLineData[];
  dataIndexOffset: number;
  symbol: string;
  timezone: string;
  timeframe: string;
  pricePrecision: number;
  movingAverageSettings: MovingAverageSettings;
  drawingRequest: DrawingRequest;
  clearNonce: number;
  tradeMarkers: TradeMarker[];
  decisionMarkers: DecisionMarker[];
  protectionLines: ProtectionLine[];
  priceSelectionMode: ProtectionPriceKind | null;
  drawings: PersistedDrawing[];
  selectedDrawingId: string;
  drawingsRestoreNonce: number;
  hideDate: boolean;
  hidePrice: boolean;
  onDecisionSelect: (id: string) => void;
  onProtectionPriceSelect: (kind: ProtectionPriceKind, price: number) => void;
  onProtectionLineMove: (line: ProtectionLine, price: number) => boolean;
  onCandleContextMenu: (target: CandleContextTarget) => void;
  onDrawingsChange: (drawings: PersistedDrawing[]) => void;
  onDrawingSelect: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const preservedBarSpaceRef = useRef<number | null>(null);
  const refreshZoomAppliedRef = useRef(false);
  const barsRef = useRef<KLineData[]>(bars);
  const appliedBarsRef = useRef<KLineData[]>([]);
  const updateBarRef = useRef<((bar: KLineData) => void) | null>(null);
  const dataIndexOffsetRef = useRef(dataIndexOffset);
  const tradeMarkersRef = useRef<TradeMarker[]>(tradeMarkers);
  const decisionMarkersRef = useRef<DecisionMarker[]>(decisionMarkers);
  const protectionLinesRef = useRef<ProtectionLine[]>(protectionLines);
  const syncedTradeMarkersRef = useRef("");
  const syncedDecisionMarkersRef = useRef("");
  const syncedProtectionLinesRef = useRef("");
  const drawingsRef = useRef<PersistedDrawing[]>(drawings);
  const movingAverageSettingsRef = useRef(movingAverageSettings);
  const onDecisionSelectRef = useRef(onDecisionSelect);
  const onProtectionPriceSelectRef = useRef(onProtectionPriceSelect);
  const onProtectionLineMoveRef = useRef(onProtectionLineMove);
  const onCandleContextMenuRef = useRef(onCandleContextMenu);
  const onDrawingsChangeRef = useRef(onDrawingsChange);
  const onDrawingSelectRef = useRef(onDrawingSelect);
  const suppressDrawingEventsRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastContextTriggerRef = useRef<{ timestamp: number; triggeredAt: number } | null>(null);
  const [drawingActive, setDrawingActive] = useState(false);

  useEffect(() => {
    dataIndexOffsetRef.current = dataIndexOffset;
  }, [dataIndexOffset]);

  const setDrawingInteraction = useCallback((active: boolean, chart = chartRef.current) => {
    setDrawingActive(active);
    chart?.setScrollEnabled(!active);
    chart?.setZoomEnabled(!active);
  }, []);

  const applyResponsiveViewport = useCallback((chart: Chart, applyRefreshDefault = false) => {
    const mobile = window.matchMedia(MOBILE_CHART_QUERY).matches;
    if (applyRefreshDefault && !refreshZoomAppliedRef.current) {
      const refreshBarSpace = mobile ? MOBILE_REPLAY_BAR_SPACE : DESKTOP_REPLAY_BAR_SPACE;
      chart.setBarSpace(refreshBarSpace);
      preservedBarSpaceRef.current = refreshBarSpace;
      refreshZoomAppliedRef.current = true;
    } else if (preservedBarSpaceRef.current != null) {
      chart.setBarSpace(preservedBarSpaceRef.current);
    }
    alignLatestCandle(chart);
  }, []);

  const createPersistedDrawing = useCallback((chart: Chart, drawing: PersistedDrawing) => chart.createOverlay({
    id: drawing.id,
    name: drawing.name,
    groupId: USER_DRAWING_GROUP,
    paneId: drawing.paneId,
    points: drawing.points.map((point) => ({
      ...point,
      dataIndex: point.dataIndex == null ? undefined : point.dataIndex - dataIndexOffsetRef.current,
    })),
    needDefaultPointFigure: drawing.name === "trainingTextBox"
      ? drawing.id === selectedTrainingTextId
      : undefined,
    lock: drawing.lock,
    visible: drawing.visible,
    zLevel: drawing.zLevel,
    mode: drawing.mode,
    styles: drawing.styles,
    extendData: drawing.extendData,
    onDrawEnd: ({ chart: eventChart, overlay }) => {
      syncTrainingTextBoxScale(eventChart, overlay, true);
      if (!suppressDrawingEventsRef.current) {
        onDrawingsChangeRef.current(getPersistedDrawings(eventChart, dataIndexOffsetRef.current));
      }
    },
    onPressedMoveEnd: ({ chart: eventChart, overlay }) => {
      syncTrainingTextBoxScale(eventChart, overlay);
      if (!suppressDrawingEventsRef.current) {
        onDrawingsChangeRef.current(getPersistedDrawings(eventChart, dataIndexOffsetRef.current));
      }
    },
    onSelected: ({ chart, overlay }) => {
      selectedTrainingTextId = overlay.name === "trainingTextBox" ? overlay.id : "";
      syncTrainingTextBoxScale(chart, overlay, true);
      chart.overrideOverlay({
        id: overlay.id,
        ...(overlay.name === "trainingTextBox" ? { needDefaultPointFigure: true } : {}),
      });
      onDrawingSelectRef.current(overlay.id);
    },
    onDeselected: ({ chart, overlay }) => {
      selectedTrainingTextId = "";
      chart.overrideOverlay({
        id: overlay.id,
        ...(overlay.name === "trainingTextBox" ? { needDefaultPointFigure: false } : {}),
      });
      onDrawingSelectRef.current(null);
    },
    onRemoved: ({ chart: eventChart }) => {
      if (suppressDrawingEventsRef.current) return;
      queueMicrotask(() => onDrawingsChangeRef.current(
        getPersistedDrawings(eventChart, dataIndexOffsetRef.current),
      ));
    },
  }), []);

  const restoreDrawings = useCallback((chart: Chart, nextDrawings: PersistedDrawing[]) => {
    suppressDrawingEventsRef.current = true;
    chart.removeOverlay({ groupId: USER_DRAWING_GROUP });
    nextDrawings.forEach((drawing) => createPersistedDrawing(chart, drawing));
    suppressDrawingEventsRef.current = false;
  }, [createPersistedDrawing]);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let disposeChart: (() => void) | null = null;

    void import("klinecharts").then(({ dispose, init, registerOverlay }) => {
      if (cancelled || !containerRef.current) return;
      ensureTradeOverlay(registerOverlay);
      ensureProtectionLineOverlay(registerOverlay);
      ensureDecisionOverlay(registerOverlay);
      ensureTrainingDrawingOverlays(registerOverlay);
      const chart = init(containerRef.current, {
        locale: "zh-CN",
        timezone,
        styles: {
          grid: {
            horizontal: { color: "rgba(133, 149, 158, 0.10)", size: 1 },
            vertical: { color: "rgba(133, 149, 158, 0.08)", size: 1 },
          },
          candle: {
            bar: {
              upColor: "#1fc79a",
              downColor: "#ef6a68",
              noChangeColor: "#9ca8ad",
              upBorderColor: "#1fc79a",
              downBorderColor: "#ef6a68",
              noChangeBorderColor: "#9ca8ad",
              upWickColor: "#1fc79a",
              downWickColor: "#ef6a68",
              noChangeWickColor: "#9ca8ad",
            },
            priceMark: {
              show: !hidePrice,
              high: { color: "#87979d" },
              low: { color: "#87979d" },
              last: {
                upColor: "#1fc79a",
                downColor: "#ef6a68",
                noChangeColor: "#9ca8ad",
              },
            },
            tooltip: {
              showRule: hideDate || hidePrice ? "none" : "follow_cross",
              text: { color: "#aab6ba" },
            },
          },
          xAxis: {
            axisLine: { color: "rgba(133, 149, 158, 0.16)" },
            tickLine: { color: "rgba(133, 149, 158, 0.16)" },
            tickText: { color: hideDate ? "rgba(0, 0, 0, 0)" : "#687a81", size: 11 },
          },
          yAxis: {
            axisLine: { color: "rgba(133, 149, 158, 0.16)" },
            tickLine: { color: "rgba(133, 149, 158, 0.16)" },
            tickText: { color: hidePrice ? "rgba(0, 0, 0, 0)" : "#687a81", size: 11 },
          },
          crosshair: {
            horizontal: {
              line: { color: "rgba(227, 238, 235, 0.35)" },
              text: {
                backgroundColor: hidePrice ? "rgba(0, 0, 0, 0)" : "#263238",
                color: hidePrice ? "rgba(0, 0, 0, 0)" : "#eff6f3",
              },
            },
            vertical: {
              line: { color: "rgba(227, 238, 235, 0.35)" },
              text: {
                backgroundColor: hideDate ? "rgba(0, 0, 0, 0)" : "#263238",
                color: hideDate ? "rgba(0, 0, 0, 0)" : "#eff6f3",
              },
            },
          },
        },
      });
      if (!chart) return;
      chartRef.current = chart;
      chart.setSymbol({ ticker: symbol, pricePrecision, volumePrecision: 0 });
      chart.setPeriod(periods[timeframe] ?? periods["1d"]);
      chart.setDataLoader({
        getBars: ({ callback }) => {
          const currentBars = [...barsRef.current];
          appliedBarsRef.current = currentBars;
          callback(currentBars, false);
        },
        subscribeBar: ({ callback }) => {
          updateBarRef.current = callback;
        },
        unsubscribeBar: () => {
          updateBarRef.current = null;
        },
      });
      chart.setZoomAnchor("cursor");
      const chartContainer = containerRef.current;
      const handleWheelZoom = (event: WheelEvent) => {
        if (!event.deltaY || !chartContainer) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const bounds = chartContainer.getBoundingClientRect();
        const x = Math.min(bounds.width, Math.max(0, event.clientX - bounds.left));
        chart.zoomAtCoordinate(wheelZoomScale(event, bounds.height), { x, y: 0 });
        preservedBarSpaceRef.current = chart.getBarSpace().bar;
      };
      chartContainer.addEventListener("wheel", handleWheelZoom, { capture: true, passive: false });
      chart.createIndicator("VOL", false);
      syncMovingAverageIndicators(chart, movingAverageSettingsRef.current);
      syncTradeMarkers(chart, tradeMarkersRef.current);
      syncedTradeMarkersRef.current = tradeMarkerSignature(tradeMarkersRef.current);
      syncDecisionMarkers(chart, decisionMarkersRef.current, (id) => onDecisionSelectRef.current(id));
      syncedDecisionMarkersRef.current = decisionMarkerSignature(decisionMarkersRef.current);
      syncProtectionLines(chart, protectionLinesRef.current, (line, price) => onProtectionLineMoveRef.current(line, price));
      syncedProtectionLinesRef.current = protectionLineSignature(protectionLinesRef.current);
      restoreDrawings(chart, drawingsRef.current);
      const preserveCurrentZoom = () => {
        preservedBarSpaceRef.current = chart.getBarSpace().bar;
      };
      chart.subscribeAction("onZoom", preserveCurrentZoom);
      requestAnimationFrame(() => applyResponsiveViewport(chart, true));

      disposeChart = () => {
        preservedBarSpaceRef.current = chart.getBarSpace().bar;
        chartContainer.removeEventListener("wheel", handleWheelZoom, { capture: true });
        chart.unsubscribeAction("onZoom", preserveCurrentZoom);
        dispose(chart);
      };
    });

    return () => {
      cancelled = true;
      disposeChart?.();
      chartRef.current = null;
      appliedBarsRef.current = [];
      updateBarRef.current = null;
      syncedTradeMarkersRef.current = "";
      syncedDecisionMarkersRef.current = "";
      syncedProtectionLinesRef.current = "";
    };
  }, [applyResponsiveViewport, hideDate, hidePrice, pricePrecision, restoreDrawings, symbol, timeframe, timezone]);

  useEffect(() => {
    barsRef.current = bars;
    const chart = chartRef.current;
    if (!chart) return;
    const barSpaceBeforeUpdate = chart.getBarSpace().bar;
    preservedBarSpaceRef.current = barSpaceBeforeUpdate;
    const previouslyApplied = appliedBarsRef.current;
    const samePrefix = previouslyApplied.length <= bars.length
      && previouslyApplied.every((bar, index) => bar.timestamp === bars[index]?.timestamp);
    const appendedBars = samePrefix ? bars.slice(previouslyApplied.length) : [];
    const previousLastBar = previouslyApplied.at(-1);
    const nextLastBar = bars.at(-1);
    const lastBarChanged = samePrefix
      && appendedBars.length === 0
      && previousLastBar != null
      && nextLastBar != null
      && (
        previousLastBar.open !== nextLastBar.open
        || previousLastBar.high !== nextLastBar.high
        || previousLastBar.low !== nextLastBar.low
        || previousLastBar.close !== nextLastBar.close
        || previousLastBar.volume !== nextLastBar.volume
      );
    const barsChanged = !samePrefix
      || appendedBars.length > 0
      || previouslyApplied.length !== bars.length
      || lastBarChanged;
    const updateBar = updateBarRef.current;
    if (barsChanged && bars.length <= AUTHORITATIVE_REPLAY_RESET_BAR_LIMIT) {
      // A single authoritative load also collapses multiple indicator updates
      // into one paint, which keeps the candle and overlay canvases in sync.
      chart.resetData();
    } else if (samePrefix && updateBar) {
      appendedBars.forEach((bar) => updateBar(bar));
      if (lastBarChanged && nextLastBar) updateBar(nextLastBar);
      const chartBars = chart.getDataList();
      const chartLastTimestamp = chartBars.at(-1)?.timestamp;
      if (chartBars.length !== bars.length || chartLastTimestamp !== nextLastBar?.timestamp) {
        chart.resetData();
      } else {
        appliedBarsRef.current = [...bars];
      }
    } else if (!samePrefix || previouslyApplied.length !== bars.length || lastBarChanged) {
      chart.resetData();
    }

    requestAnimationFrame(() => {
      // KLineCharts draws candles and overlays on separate canvases. Explicitly
      // invalidate the layout so Chrome cannot retain an old candle layer while
      // a trade marker and the price axis continue to move.
      chart.resize();
      chart.setBarSpace(barSpaceBeforeUpdate);
      alignLatestCandle(chart);
      requestAnimationFrame(() => {
        chart.resize();
        chart.setBarSpace(barSpaceBeforeUpdate);
        alignLatestCandle(chart);
      });
    });
  }, [bars]);

  useEffect(() => {
    movingAverageSettingsRef.current = movingAverageSettings;
    if (chartRef.current) syncMovingAverageIndicators(chartRef.current, movingAverageSettings);
  }, [movingAverageSettings]);

  useEffect(() => {
    const mobileQuery = window.matchMedia(MOBILE_CHART_QUERY);
    const handleViewportChange = () => {
      const chart = chartRef.current;
      if (!chart) return;
      requestAnimationFrame(() => alignLatestCandle(chart));
    };

    mobileQuery.addEventListener("change", handleViewportChange);
    return () => mobileQuery.removeEventListener("change", handleViewportChange);
  }, []);

  useEffect(() => {
    tradeMarkersRef.current = tradeMarkers;
    const signature = tradeMarkerSignature(tradeMarkers);
    if (chartRef.current && signature !== syncedTradeMarkersRef.current) {
      syncTradeMarkers(chartRef.current, tradeMarkers);
      syncedTradeMarkersRef.current = signature;
      requestAnimationFrame(() => {
        if (chartRef.current) alignLatestCandle(chartRef.current);
      });
    }
  }, [tradeMarkers]);

  useEffect(() => {
    decisionMarkersRef.current = decisionMarkers;
    const signature = decisionMarkerSignature(decisionMarkers);
    if (chartRef.current && signature !== syncedDecisionMarkersRef.current) {
      syncDecisionMarkers(chartRef.current, decisionMarkers, (id) => onDecisionSelectRef.current(id));
      syncedDecisionMarkersRef.current = signature;
    }
  }, [decisionMarkers]);

  useEffect(() => {
    protectionLinesRef.current = protectionLines;
    const signature = protectionLineSignature(protectionLines);
    if (chartRef.current && signature !== syncedProtectionLinesRef.current) {
      syncProtectionLines(
        chartRef.current,
        protectionLines,
        (line, price) => onProtectionLineMoveRef.current(line, price),
      );
      syncedProtectionLinesRef.current = signature;
    }
  }, [protectionLines]);

  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);

  useEffect(() => {
    const selectedText = selectedDrawingId && drawings.some((drawing) => drawing.id === selectedDrawingId && drawing.name === "trainingTextBox")
      ? selectedDrawingId
      : "";
    selectedTrainingTextId = selectedText;
    const chart = chartRef.current;
    if (!chart) return;
    chart.getOverlays({ groupId: USER_DRAWING_GROUP }).forEach((overlay) => {
      chart.overrideOverlay({
        id: overlay.id,
        ...(overlay.name === "trainingTextBox" ? { needDefaultPointFigure: overlay.id === selectedText } : {}),
      });
    });
  }, [drawings, selectedDrawingId]);

  useEffect(() => {
    onDrawingsChangeRef.current = onDrawingsChange;
  }, [onDrawingsChange]);

  useEffect(() => {
    onDrawingSelectRef.current = onDrawingSelect;
  }, [onDrawingSelect]);

  useEffect(() => {
    onDecisionSelectRef.current = onDecisionSelect;
  }, [onDecisionSelect]);

  useEffect(() => {
    onProtectionPriceSelectRef.current = onProtectionPriceSelect;
  }, [onProtectionPriceSelect]);

  useEffect(() => {
    onProtectionLineMoveRef.current = onProtectionLineMove;
  }, [onProtectionLineMove]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setScrollEnabled(!drawingActive && !priceSelectionMode);
    chart.setZoomEnabled(!drawingActive && !priceSelectionMode);
  }, [drawingActive, priceSelectionMode]);

  useEffect(() => {
    onCandleContextMenuRef.current = onCandleContextMenu;
  }, [onCandleContextMenu]);

  useEffect(() => {
    if (!drawingRequest || !chartRef.current) return;
    const chart = chartRef.current;
    setDrawingInteraction(true, chart);
    const finishDrawing = () => setDrawingInteraction(false, chart);
    const overlayId = chart.createOverlay({
      name: drawingRequest.name,
      groupId: USER_DRAWING_GROUP,
      needDefaultPointFigure: drawingRequest.name === "trainingTextBox" ? false : undefined,
      mode: drawingRequest.mode ?? "normal",
      modeSensitivity: 8,
      styles: drawingRequest.styles,
      extendData: drawingRequest.extendData,
      onDrawEnd: ({ chart: eventChart, overlay }) => {
        syncTrainingTextBoxScale(eventChart, overlay, true);
        selectedTrainingTextId = overlay.name === "trainingTextBox" ? overlay.id : "";
        eventChart.overrideOverlay({
          id: overlay.id,
          ...(overlay.name === "trainingTextBox" ? { needDefaultPointFigure: true } : {}),
        });
        onDrawingsChangeRef.current(getPersistedDrawings(eventChart, dataIndexOffsetRef.current));
        onDrawingSelectRef.current(overlay.id);
        finishDrawing();
      },
      onPressedMoveEnd: ({ chart: eventChart, overlay }) => {
        syncTrainingTextBoxScale(eventChart, overlay);
        onDrawingsChangeRef.current(getPersistedDrawings(eventChart, dataIndexOffsetRef.current));
      },
      onSelected: ({ chart, overlay }) => {
        selectedTrainingTextId = overlay.name === "trainingTextBox" ? overlay.id : "";
        syncTrainingTextBoxScale(chart, overlay, true);
        chart.overrideOverlay({
          id: overlay.id,
          ...(overlay.name === "trainingTextBox" ? { needDefaultPointFigure: true } : {}),
        });
        onDrawingSelectRef.current(overlay.id);
      },
      onDeselected: ({ chart, overlay }) => {
        selectedTrainingTextId = "";
        chart.overrideOverlay({
          id: overlay.id,
          ...(overlay.name === "trainingTextBox" ? { needDefaultPointFigure: false } : {}),
        });
        onDrawingSelectRef.current(null);
      },
      onRemoved: ({ chart: eventChart }) => {
        if (!suppressDrawingEventsRef.current) {
          queueMicrotask(() => onDrawingsChangeRef.current(
            getPersistedDrawings(eventChart, dataIndexOffsetRef.current),
          ));
        }
        finishDrawing();
      },
    });
    if (!overlayId) finishDrawing();
  }, [drawingRequest, setDrawingInteraction]);

  useEffect(() => {
    if (!drawingsRestoreNonce || !chartRef.current) return;
    restoreDrawings(chartRef.current, drawingsRef.current);
  }, [drawingsRestoreNonce, restoreDrawings]);

  useEffect(() => {
    if (!clearNonce || !chartRef.current) return;
    suppressDrawingEventsRef.current = true;
    chartRef.current.removeOverlay({ groupId: USER_DRAWING_GROUP });
    suppressDrawingEventsRef.current = false;
    setDrawingInteraction(false);
  }, [clearNonce, setDrawingInteraction]);

  useEffect(() => {
    if (!drawingActive || !containerRef.current) return;
    const container = containerRef.current;
    const preventTouchScroll = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    container.addEventListener("touchmove", preventTouchScroll, { passive: false, capture: true });
    return () => container.removeEventListener("touchmove", preventTouchScroll, { capture: true });
  }, [drawingActive]);

  useEffect(() => () => {
    if (longPressTimerRef.current != null) window.clearTimeout(longPressTimerRef.current);
  }, []);

  const resolveCandleAt = (clientX: number, clientY: number) => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container) return null;

    const bounds = container.getBoundingClientRect();
    const candlePane = chart.getSize("candle_pane", "root");
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    if (!candlePane || y < candlePane.top || y > candlePane.top + candlePane.height) return null;

    const converted = chart.convertFromPixel([{ x, y }], { paneId: "candle_pane" });
    const point = Array.isArray(converted) ? converted[0] : converted;
    const dataIndex = Math.round(point?.dataIndex ?? Number.NaN);
    const bar = barsRef.current[dataIndex];
    if (!bar) return null;

    return {
      dataIndex: dataIndex + dataIndexOffsetRef.current,
      timestamp: bar.timestamp,
      referencePrice: bar.close,
    } satisfies CandleContextTarget;
  };

  const resolvePriceAt = (clientX: number, clientY: number) => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container) return null;
    const bounds = container.getBoundingClientRect();
    const candlePane = chart.getSize("candle_pane", "root");
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    if (!candlePane || y < candlePane.top || y > candlePane.top + candlePane.height) return null;
    const converted = chart.convertFromPixel([{ x, y }], { paneId: "candle_pane" });
    const point = Array.isArray(converted) ? converted[0] : converted;
    const value = Number(point?.value);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const triggerCandleContext = (target: CandleContextTarget) => {
    const now = Date.now();
    const previous = lastContextTriggerRef.current;
    if (previous?.timestamp === target.timestamp && now - previous.triggeredAt < 900) return;
    lastContextTriggerRef.current = { timestamp: target.timestamp, triggeredAt: now };
    onCandleContextMenuRef.current(target);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current != null) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    touchStartRef.current = null;
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (drawingActive) {
      event.preventDefault();
      return;
    }
    const target = resolveCandleAt(event.clientX, event.clientY);
    if (!target) return;
    event.preventDefault();
    cancelLongPress();
    triggerCandleContext(target);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drawingActive) return;
    if (priceSelectionMode) return;
    if (event.pointerType !== "touch") return;
    const target = resolveCandleAt(event.clientX, event.clientY);
    if (!target) return;
    cancelLongPress();
    touchStartRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      touchStartRef.current = null;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(30);
      triggerCandleContext(target);
    }, 520);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 10) return;
    cancelLongPress();
  };

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!priceSelectionMode || drawingActive) return;
    const price = resolvePriceAt(event.clientX, event.clientY);
    if (price != null) onProtectionPriceSelectRef.current(priceSelectionMode, price);
  };

  return <div
    ref={containerRef}
    className={`chart-canvas${drawingActive ? " drawing-active" : ""}${priceSelectionMode ? " price-selecting" : ""}`}
    aria-label={drawingActive
      ? `${symbol} K线图，正在绘图`
      : priceSelectionMode
        ? `${symbol} K线图，点击选择${priceSelectionMode === "stop-loss" ? "止损" : "止盈"}价格`
        : symbol + " K线图，右键或长按已揭示的 K 线可补写事前决策"}
    title={drawingActive
      ? "正在绘图：拖动手指不会滚动页面或平移图表"
      : priceSelectionMode
        ? `点击图表选择${priceSelectionMode === "stop-loss" ? "止损" : "止盈"}价格`
        : "右键或长按已揭示的 K 线可补写事前决策"}
    onClickCapture={handleClick}
    onContextMenu={handleContextMenu}
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={cancelLongPress}
    onPointerCancel={cancelLongPress}
    onPointerLeave={cancelLongPress}
  />;
}
