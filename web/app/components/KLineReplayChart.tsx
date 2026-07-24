"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Chart, KLineData, Overlay, OverlayTemplate, Period, Point } from "klinecharts";

type DrawingRequest = { name: string; nonce: number } | null;

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

type TradeOverlayData = TradeMarker;
type DecisionOverlayData = DecisionMarker & { onSelect?: (id: string) => void };

const USER_DRAWING_GROUP = "user-drawings";
const TRADE_MARKER_GROUP = "trade-markers";
const DECISION_MARKER_GROUP = "decision-markers";
let tradeOverlayRegistered = false;
let decisionOverlayRegistered = false;

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
  onDrawingsChange,
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
  onDrawingsChange: (drawings: PersistedDrawing[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const barsRef = useRef<KLineData[]>(bars);
  const tradeMarkersRef = useRef<TradeMarker[]>(tradeMarkers);
  const decisionMarkersRef = useRef<DecisionMarker[]>(decisionMarkers);
  const drawingsRef = useRef<PersistedDrawing[]>(drawings);
  const onDecisionSelectRef = useRef(onDecisionSelect);
  const onDrawingsChangeRef = useRef(onDrawingsChange);
  const suppressDrawingEventsRef = useRef(false);

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

      disposeChart = () => dispose(chart);
    });

    return () => {
      cancelled = true;
      disposeChart?.();
      chartRef.current = null;
    };
  }, [hideDate, hidePrice, pricePrecision, restoreDrawings, symbol, timeframe, timezone]);

  useEffect(() => {
    barsRef.current = bars;
    const chart = chartRef.current;
    if (!chart) return;
    chart.setTimezone(timezone);
    chart.setSymbol({ ticker: symbol, pricePrecision, volumePrecision: 0 });
    chart.setPeriod(periods[timeframe] ?? periods["1d"]);
    chart.resetData();
    requestAnimationFrame(() => {
      chart.scrollToRealTime();
      syncTradeMarkers(chart, tradeMarkersRef.current);
      syncDecisionMarkers(chart, decisionMarkersRef.current, (id) => onDecisionSelectRef.current(id));
    });
  }, [bars, pricePrecision, symbol, timeframe, timezone]);

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
    onDecisionSelectRef.current = onDecisionSelect;
  }, [onDecisionSelect]);

  useEffect(() => {
    if (!drawingRequest || !chartRef.current) return;
    chartRef.current.createOverlay({
      name: drawingRequest.name,
      groupId: USER_DRAWING_GROUP,
      onDrawEnd: ({ chart }) => onDrawingsChangeRef.current(getPersistedDrawings(chart)),
      onPressedMoveEnd: ({ chart }) => onDrawingsChangeRef.current(getPersistedDrawings(chart)),
      onRemoved: ({ chart }) => {
        if (suppressDrawingEventsRef.current) return;
        queueMicrotask(() => onDrawingsChangeRef.current(getPersistedDrawings(chart)));
      },
    });
  }, [drawingRequest]);

  useEffect(() => {
    if (!drawingsRestoreNonce || !chartRef.current) return;
    restoreDrawings(chartRef.current, drawingsRef.current);
  }, [drawingsRestoreNonce, restoreDrawings]);

  useEffect(() => {
    if (!clearNonce || !chartRef.current) return;
    suppressDrawingEventsRef.current = true;
    chartRef.current.removeOverlay({ groupId: USER_DRAWING_GROUP });
    suppressDrawingEventsRef.current = false;
  }, [clearNonce]);

  return <div ref={containerRef} className="chart-canvas" aria-label={symbol + " K线图"} />;
}
