"use client";

import { useEffect, useRef } from "react";
import type { Chart, KLineData, OverlayTemplate, Period } from "klinecharts";

type DrawingRequest = { name: string; nonce: number } | null;

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

type TradeOverlayData = TradeMarker;

const USER_DRAWING_GROUP = "user-drawings";
const TRADE_MARKER_GROUP = "trade-markers";
let tradeOverlayRegistered = false;

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
}: {
  bars: KLineData[];
  symbol: string;
  timezone: string;
  timeframe: string;
  pricePrecision: number;
  drawingRequest: DrawingRequest;
  clearNonce: number;
  tradeMarkers: TradeMarker[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const barsRef = useRef<KLineData[]>(bars);
  const tradeMarkersRef = useRef<TradeMarker[]>(tradeMarkers);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let disposeChart: (() => void) | null = null;

    void import("klinecharts").then(({ dispose, init, registerOverlay }) => {
      if (cancelled || !containerRef.current) return;
      ensureTradeOverlay(registerOverlay);
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
              high: { color: "#87979d" },
              low: { color: "#87979d" },
              last: {
                upColor: "#1fc79a",
                downColor: "#ef6a68",
                noChangeColor: "#9ca8ad",
              },
            },
            tooltip: { text: { color: "#aab6ba" } },
          },
          xAxis: {
            axisLine: { color: "rgba(133, 149, 158, 0.16)" },
            tickLine: { color: "rgba(133, 149, 158, 0.16)" },
            tickText: { color: "#687a81", size: 11 },
          },
          yAxis: {
            axisLine: { color: "rgba(133, 149, 158, 0.16)" },
            tickLine: { color: "rgba(133, 149, 158, 0.16)" },
            tickText: { color: "#687a81", size: 11 },
          },
          crosshair: {
            horizontal: {
              line: { color: "rgba(227, 238, 235, 0.35)" },
              text: { backgroundColor: "#263238", color: "#eff6f3" },
            },
            vertical: {
              line: { color: "rgba(227, 238, 235, 0.35)" },
              text: { backgroundColor: "#263238", color: "#eff6f3" },
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

      resizeObserver = new ResizeObserver(() => chart.resize());
      resizeObserver.observe(containerRef.current);
      disposeChart = () => dispose(chart);
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      disposeChart?.();
      chartRef.current = null;
    };
  }, [pricePrecision, symbol, timeframe, timezone]);

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
    });
  }, [bars, pricePrecision, symbol, timeframe, timezone]);

  useEffect(() => {
    tradeMarkersRef.current = tradeMarkers;
    if (chartRef.current) syncTradeMarkers(chartRef.current, tradeMarkers);
  }, [tradeMarkers]);

  useEffect(() => {
    if (!drawingRequest || !chartRef.current) return;
    chartRef.current.createOverlay({ name: drawingRequest.name, groupId: USER_DRAWING_GROUP });
  }, [drawingRequest]);

  useEffect(() => {
    if (!clearNonce || !chartRef.current) return;
    chartRef.current.removeOverlay({ groupId: USER_DRAWING_GROUP });
  }, [clearNonce]);

  return <div ref={containerRef} className="chart-canvas" aria-label={symbol + " K线图"} />;
}
