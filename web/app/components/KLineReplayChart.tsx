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

type TradeOverlayData = TradeMarker;
type DecisionOverlayData = DecisionMarker & { onSelect?: (id: string) => void };

const USER_DRAWING_GROUP = "user-drawings";
const TRADE_MARKER_GROUP = "trade-markers";
const DECISION_MARKER_GROUP = "decision-markers";
const MOBILE_CHART_QUERY = "(max-width: 600px)";
const MOBILE_REPLAY_RIGHT_OFFSET = 16;
const MOBILE_REPLAY_BAR_SPACE = 8;
let tradeOverlayRegistered = false;
let decisionOverlayRegistered = false;
let trainingDrawingOverlaysRegistered = false;

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
          styles: { color: "#dff8f0", size: 10, backgroundColor: "#168a73", borderRadius: 3, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 },
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
              styles: { color: "#fff0ef", size: 10, backgroundColor: "#b84040", borderRadius: 3, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 },
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
              styles: { color: "#ecf3f1", size: 10, backgroundColor: "rgba(15, 24, 27, .88)", borderColor: accent, borderSize: 1, borderRadius: 3, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 },
              ignoreEvent: overlayIgnoreEvents,
            },
          );
        }
        return figures;
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
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ overlay, coordinates }) => {
      const start = coordinates[0];
      const end = coordinates[1];
      const extendData = overlay.extendData as { text?: string } | null;
      const text = extendData?.text?.trim();
      if (!start || !end || !text) return [];

      const styles = (overlay.styles ?? {}) as FigureStyleBag;
      const textColor = styles.text?.color ?? styles.line?.color ?? "#dce9e6";
      const fontSize = styles.text?.size ?? 12;
      const borderColor = styles.rect?.borderColor ?? styles.line?.color ?? "#2962ff";
      const left = Math.min(start.x, end.x);
      const top = Math.min(start.y, end.y);
      const width = Math.max(20, Math.abs(end.x - start.x));
      const height = Math.max(fontSize + 12, Math.abs(end.y - start.y));
      const lineHeight = Math.max(12, Math.round(fontSize * 1.35));
      const maxCharacters = Math.max(2, Math.floor((width - 12) / Math.max(5, fontSize * 0.62)));
      const maxLines = Math.max(1, Math.floor((height - 12) / lineHeight));
      const wrappedLines = text.split("\n").flatMap((paragraph) => {
        if (!paragraph) return [""];
        const chunks: string[] = [];
        for (let offset = 0; offset < paragraph.length; offset += maxCharacters) {
          chunks.push(paragraph.slice(offset, offset + maxCharacters));
        }
        return chunks;
      }).slice(0, maxLines);

      const figures: Array<Record<string, unknown>> = [{
        type: "rect",
        attrs: { x: left, y: top, width, height },
        styles: {
          style: "stroke_fill",
          color: styles.rect?.color ?? "rgba(12, 20, 22, 0.70)",
          borderColor,
          borderSize: styles.rect?.borderSize ?? styles.line?.size ?? 1,
          borderStyle: styles.rect?.borderStyle ?? "solid",
        },
        ignoreEvent: overlayIgnoreEvents,
      }];
      wrappedLines.forEach((line, index) => {
        figures.push({
          type: "text",
          attrs: {
            x: left + 6,
            y: top + 6 + index * lineHeight,
            text: line,
            align: "left",
            baseline: "top",
          },
          styles: { color: textColor, size: fontSize, weight: 500 },
          ignoreEvent: overlayIgnoreEvents,
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
  }
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

function serializeDrawing(overlay: Overlay): PersistedDrawing {
  return {
    id: overlay.id,
    name: overlay.name,
    paneId: overlay.paneId,
    points: overlay.points.map((point) => ({
      dataIndex: point.dataIndex,
      timestamp: point.timestamp,
      value: point.value,
    })),
    lock: overlay.lock,
    visible: overlay.visible,
    zLevel: overlay.zLevel,
    mode: overlay.mode,
    styles: overlay.styles ?? undefined,
    extendData: overlay.extendData ?? undefined,
  };
}

function getPersistedDrawings(chart: Chart) {
  return chart.getOverlays({ groupId: USER_DRAWING_GROUP }).map(serializeDrawing);
}

const periods: Record<string, Period> = {
  "5m": { type: "minute", span: 5 },
  "1h": { type: "hour", span: 1 },
  "1d": { type: "day", span: 1 },
  "1w": { type: "week", span: 1 },
};

export function KLineReplayChart({
  bars,
  symbol,
  timezone,
  timeframe,
  pricePrecision,
  drawingRequest,
  clearNonce,
  tradeMarkers,
  decisionMarkers,
  drawings,
  drawingsRestoreNonce,
  hideDate,
  hidePrice,
  onDecisionSelect,
  onCandleContextMenu,
  onDrawingsChange,
  onDrawingSelect,
}: {
  bars: KLineData[];
  symbol: string;
  timezone: string;
  timeframe: string;
  pricePrecision: number;
  drawingRequest: DrawingRequest;
  clearNonce: number;
  tradeMarkers: TradeMarker[];
  decisionMarkers: DecisionMarker[];
  drawings: PersistedDrawing[];
  drawingsRestoreNonce: number;
  hideDate: boolean;
  hidePrice: boolean;
  onDecisionSelect: (id: string) => void;
  onCandleContextMenu: (target: CandleContextTarget) => void;
  onDrawingsChange: (drawings: PersistedDrawing[]) => void;
  onDrawingSelect: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const preservedBarSpaceRef = useRef<number | null>(null);
  const mobileRefreshZoomAppliedRef = useRef(false);
  const barsRef = useRef<KLineData[]>(bars);
  const tradeMarkersRef = useRef<TradeMarker[]>(tradeMarkers);
  const decisionMarkersRef = useRef<DecisionMarker[]>(decisionMarkers);
  const drawingsRef = useRef<PersistedDrawing[]>(drawings);
  const onDecisionSelectRef = useRef(onDecisionSelect);
  const onCandleContextMenuRef = useRef(onCandleContextMenu);
  const onDrawingsChangeRef = useRef(onDrawingsChange);
  const onDrawingSelectRef = useRef(onDrawingSelect);
  const suppressDrawingEventsRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastContextTriggerRef = useRef<{ timestamp: number; triggeredAt: number } | null>(null);
  const [drawingActive, setDrawingActive] = useState(false);

  const setDrawingInteraction = useCallback((active: boolean, chart = chartRef.current) => {
    setDrawingActive(active);
    chart?.setScrollEnabled(!active);
    chart?.setZoomEnabled(!active);
  }, []);

  const applyResponsiveViewport = useCallback((chart: Chart, applyRefreshDefault = false) => {
    const mobile = window.matchMedia(MOBILE_CHART_QUERY).matches;
    if (mobile && applyRefreshDefault && !mobileRefreshZoomAppliedRef.current) {
      chart.setBarSpace(MOBILE_REPLAY_BAR_SPACE);
      mobileRefreshZoomAppliedRef.current = true;
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
    points: drawing.points,
    lock: drawing.lock,
    visible: drawing.visible,
    zLevel: drawing.zLevel,
    mode: drawing.mode,
    styles: drawing.styles,
    extendData: drawing.extendData,
    onDrawEnd: ({ chart: eventChart }) => {
      if (!suppressDrawingEventsRef.current) onDrawingsChangeRef.current(getPersistedDrawings(eventChart));
    },
    onPressedMoveEnd: ({ chart: eventChart }) => {
      if (!suppressDrawingEventsRef.current) onDrawingsChangeRef.current(getPersistedDrawings(eventChart));
    },
    onSelected: ({ overlay }) => onDrawingSelectRef.current(overlay.id),
    onDeselected: () => onDrawingSelectRef.current(null),
    onRemoved: ({ chart: eventChart }) => {
      if (suppressDrawingEventsRef.current) return;
      queueMicrotask(() => onDrawingsChangeRef.current(getPersistedDrawings(eventChart)));
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
        getBars: ({ callback }) => callback(barsRef.current, false),
      });
      chart.createIndicator("VOL", false);
      syncTradeMarkers(chart, tradeMarkersRef.current);
      syncDecisionMarkers(chart, decisionMarkersRef.current, (id) => onDecisionSelectRef.current(id));
      restoreDrawings(chart, drawingsRef.current);
      const preserveCurrentZoom = () => {
        preservedBarSpaceRef.current = chart.getBarSpace().bar;
      };
      chart.subscribeAction("onZoom", preserveCurrentZoom);
      requestAnimationFrame(() => applyResponsiveViewport(chart, true));

      disposeChart = () => {
        preservedBarSpaceRef.current = chart.getBarSpace().bar;
        chart.unsubscribeAction("onZoom", preserveCurrentZoom);
        dispose(chart);
      };
    });

    return () => {
      cancelled = true;
      disposeChart?.();
      chartRef.current = null;
    };
  }, [applyResponsiveViewport, hideDate, hidePrice, pricePrecision, restoreDrawings, symbol, timeframe, timezone]);

  useEffect(() => {
    barsRef.current = bars;
    const chart = chartRef.current;
    if (!chart) return;
    chart.setTimezone(timezone);
    chart.setSymbol({ ticker: symbol, pricePrecision, volumePrecision: 0 });
    chart.setPeriod(periods[timeframe] ?? periods["1d"]);
    const barSpaceBeforeReset = chart.getBarSpace().bar;
    preservedBarSpaceRef.current = barSpaceBeforeReset;
    chart.resetData();
    requestAnimationFrame(() => {
      chart.setBarSpace(barSpaceBeforeReset);
      alignLatestCandle(chart);
      syncTradeMarkers(chart, tradeMarkersRef.current);
      syncDecisionMarkers(chart, decisionMarkersRef.current, (id) => onDecisionSelectRef.current(id));
      requestAnimationFrame(() => {
        chart.setBarSpace(barSpaceBeforeReset);
        alignLatestCandle(chart);
      });
    });
  }, [bars, pricePrecision, symbol, timeframe, timezone]);

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
    if (chartRef.current) syncTradeMarkers(chartRef.current, tradeMarkers);
  }, [tradeMarkers]);

  useEffect(() => {
    decisionMarkersRef.current = decisionMarkers;
    if (chartRef.current) {
      syncDecisionMarkers(chartRef.current, decisionMarkers, (id) => onDecisionSelectRef.current(id));
    }
  }, [decisionMarkers]);

  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);

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
      mode: drawingRequest.mode ?? "normal",
      modeSensitivity: 8,
      styles: drawingRequest.styles,
      extendData: drawingRequest.extendData,
      onDrawEnd: ({ chart: eventChart, overlay }) => {
        onDrawingsChangeRef.current(getPersistedDrawings(eventChart));
        onDrawingSelectRef.current(overlay.id);
        finishDrawing();
      },
      onPressedMoveEnd: ({ chart: eventChart }) => onDrawingsChangeRef.current(getPersistedDrawings(eventChart)),
      onSelected: ({ overlay }) => onDrawingSelectRef.current(overlay.id),
      onDeselected: () => onDrawingSelectRef.current(null),
      onRemoved: ({ chart: eventChart }) => {
        if (!suppressDrawingEventsRef.current) {
          queueMicrotask(() => onDrawingsChangeRef.current(getPersistedDrawings(eventChart)));
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
      dataIndex,
      timestamp: bar.timestamp,
      referencePrice: bar.close,
    } satisfies CandleContextTarget;
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

  return <div
    ref={containerRef}
    className={`chart-canvas${drawingActive ? " drawing-active" : ""}`}
    aria-label={drawingActive ? `${symbol} K线图，正在绘图` : symbol + " K线图，右键或长按已揭示的 K 线可补写事前决策"}
    title={drawingActive ? "正在绘图：拖动手指不会滚动页面或平移图表" : "右键或长按已揭示的 K 线可补写事前决策"}
    onContextMenu={handleContextMenu}
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={cancelLongPress}
    onPointerCancel={cancelLongPress}
    onPointerLeave={cancelLongPress}
  />;
}
