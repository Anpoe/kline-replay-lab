"use client";

import { chartShiftPlacement, isCandleInViewport } from "../lib/chartViewport.mjs";
import { incrementalBarUpdates } from "../lib/chartBarUpdates.mjs";
import { interpolatedDrawingIndex } from "../lib/timeframeView.ts";
import { measuredMoveOverlay } from "../lib/measuredMove.ts";
import { rectangleControlPoints, rectangleOverlay } from "../lib/rectangleDrawing";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CandleTooltipStyle, Chart, Crosshair, KLineData, Overlay, OverlayCreate, OverlayFigure, OverlayTemplate, Period, Point } from "klinecharts";
import type { MacdSettings, MovingAverageSettings } from "../lib/chartIndicators";
import type { ProtectionLine, ProtectionPriceKind } from "../lib/tradeProtection";
import type { TimeframeId } from "../lib/timeframeCatalog";
import type { CorporateActionMarker } from "../lib/corporateActions";
import type { ShortcutSettings } from "../lib/keyboardShortcuts";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { ChartTradingMenu, type ChartTradingAdapter, type ChartTradingTarget } from "./ChartTradingMenu";
import { pendingOrderIdsAtPrice, protectionKindAtPrice } from "../lib/chartTrading";

export type { ProtectionLine, ProtectionPriceKind } from "../lib/tradeProtection";

export type PriceSelectionMode = ProtectionPriceKind | "entry-trigger";

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
  entryQty?: number;
  entryPrice: number;
  entryTimestamp: number;
  exitPrice?: number;
  exitTimestamp?: number;
  realizedPnl?: number;
  hovered?: boolean;
  entryPlotTimestamp?: number;
  exitPlotTimestamp?: number;
  eventKind?: "entry" | "exit";
  clickable?: boolean;
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
type CorporateActionOverlayData = CorporateActionMarker & { onSelect?: (id: string) => void };

const USER_DRAWING_GROUP = "user-drawings";
const TRADE_MARKER_GROUP = "trade-markers";
const DECISION_MARKER_GROUP = "decision-markers";
const CORPORATE_ACTION_GROUP = "corporate-action-markers";
const PROTECTION_LINE_GROUP = "protection-lines";
const MOBILE_CHART_QUERY = "(max-width: 600px)";
const MOBILE_REPLAY_BAR_SPACE = 8;
const DESKTOP_REPLAY_BAR_SPACE = 16;
const WHEEL_ZOOM_BASE = 1.1;
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

function syncMacdIndicator(chart: Chart, settings: MacdSettings) {
  const existing = chart.getIndicators({ name: "MACD" });
  if (!settings.enabled) {
    if (existing.length) chart.removeIndicator({ name: "MACD" });
    return;
  }
  if (existing.length) {
    chart.overrideIndicator({ id: existing[0].id, name: "MACD", calcParams: settings.periods });
  } else {
    chart.createIndicator({ name: "MACD", calcParams: settings.periods }, false);
  }
}
let tradeOverlayRegistered = false;
let decisionOverlayRegistered = false;
let trainingDrawingOverlaysRegistered = false;
let protectionLineOverlayRegistered = false;
let candleCountdownOverlayRegistered = false;
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

type LegacyCandleTooltipStyle = Partial<CandleTooltipStyle> & {
  text: { color: string };
};

type OverlayIgnoreEvent =
  | "onClick"
  | "onDoubleClick"
  | "onRightClick"
  | "onPressedMoveStart"
  | "onPressedMoving"
  | "onPressedMoveEnd"
  | "onSelected"
  | "onDeselected";

const overlayIgnoreEvents: OverlayIgnoreEvent[] = [
  "onClick",
  "onDoubleClick",
  "onRightClick",
  "onPressedMoveStart",
  "onPressedMoving",
  "onPressedMoveEnd",
  "onSelected",
  "onDeselected",
];
const overlayHoverIgnoreEvents: OverlayIgnoreEvent[] = [
  "onDoubleClick",
  "onRightClick",
  "onPressedMoveStart",
  "onPressedMoving",
  "onPressedMoveEnd",
];

function ensureTrainingDrawingOverlays(registerOverlay: (template: OverlayTemplate) => void) {
  if (trainingDrawingOverlaysRegistered) return;

  registerOverlay(measuredMoveOverlay);

  registerOverlay(rectangleOverlay);

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
        const figures: OverlayFigure[] = [
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
      const lineHeight = Math.max(14, fontSize * 1.35);
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

      const figures: OverlayFigure[] = selected ? [{
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
      const data = overlay.extendData as (ProtectionLine & { hovered?: boolean }) | null;
      if (!point || !data) return [];
      if (data.id.startsWith("current-price:")) return [{
        type: "line",
        attrs: { coordinates: [{ x: 0, y: point.y }, { x: bounding.width, y: point.y }] },
        styles: { color: "rgba(0, 0, 0, 0)", size: 10 },
      }, ...(data.hovered ? [{
        type: "text", attrs: { x: 8, y: point.y - 5, text: data.hint ?? "", align: "left", baseline: "bottom" },
        styles: { color: "#24d6a2", size: 11, backgroundColor: "rgba(8, 16, 18, .82)", paddingLeft: 4, paddingRight: 4 },
      } as OverlayFigure] : [])];
      const stop = data.kind === "stop-loss";
      const color = data.kind === "opening-gap-threshold"
        ? "#e1c57f"
        : data.kind === "entry-trigger" ? "#69c0ff" : stop ? "#ff6b68" : "#24d6a2";
      return [{
        type: "line",
        attrs: { coordinates: [{ x: 0, y: point.y }, { x: bounding.width, y: point.y }] },
        styles: { color, size: data.source === "position" ? 1.6 : 1.2, style: "dashed", dashedValue: [6, 4] },
      }, {
        type: "text",
        attrs: { x: 8, y: point.y - 5, text: data.hovered && data.hint ? `${data.label} · ${data.hint}` : data.label, align: "left", baseline: "bottom" },
        styles: { color, size: 11, weight: 650, backgroundColor: "rgba(8, 16, 18, .82)", paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 },
      }];
    },
    onMouseEnter: ({ chart, overlay }) => {
      const data = overlay.extendData as (ProtectionLine & { hovered?: boolean }) | null;
      if (data?.hint && !data.hovered) chart.overrideOverlay({ id: overlay.id, extendData: { ...data, hovered: true } });
    },
    onMouseLeave: ({ chart, overlay }) => {
      const data = overlay.extendData as (ProtectionLine & { hovered?: boolean }) | null;
      if (data?.hovered) chart.overrideOverlay({ id: overlay.id, extendData: { ...data, hovered: false } });
    },
  });
  protectionLineOverlayRegistered = true;
}

function ensureCandleCountdownOverlay(registerOverlay: (template: OverlayTemplate) => void) {
  if (candleCountdownOverlayRegistered) return;
  registerOverlay({
    name: "liveCandleCountdown", totalStep: 2,
    needDefaultPointFigure: false, needDefaultXAxisFigure: false, needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates, bounding }) => {
      const point = coordinates[0], data = overlay.extendData as { text: string; color: string } | undefined;
      if (!point || !data || point.x < 0 || point.x > bounding.width || point.y < 0 || point.y > bounding.height) return [];
      return [{ type: "text", attrs: {
        x: Math.max(4, Math.min(point.x + 20, bounding.width - Math.max(44, data.text.length * 9))),
        y: Math.max(4, Math.min(point.y + 8, bounding.height - 20)), text: data.text, align: "left", baseline: "top",
      }, styles: { color: data.color, size: 14, weight: 600, backgroundColor: "transparent", borderColor: "transparent", borderSize: 0,
        paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 }, ignoreEvent: overlayIgnoreEvents }];
    },
  });
  candleCountdownOverlayRegistered = true;
}

function syncCandleCountdown(chart: Chart, text: string | null | undefined) {
  const id = "live-candle-countdown", bar = chart.getDataList().at(-1);
  if (!text || !bar) { chart.removeOverlay({ id }); return; }
  const overlay = { id, name: "liveCandleCountdown", groupId: "live-candle-status", paneId: PRICE_INDICATOR_PANE,
    points: [{ timestamp: bar.timestamp, value: bar.close }], lock: true, visible: true,
    extendData: { text, color: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() } };
  if (chart.getOverlays({ id }).length) chart.overrideOverlay(overlay);
  else chart.createOverlay(overlay);
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
      const ignored = trade.clickable ? overlayIgnoreEvents.filter(event => event !== "onClick") : overlayIgnoreEvents;
      const entryText = trade.eventKind === "exit" ? "平 " + (trade.realizedPnl ?? 0).toFixed(2) : (isLong ? "买" : "卖") + " " + (trade.entryQty ?? trade.qty);
      const figures: OverlayFigure[] = [
        {
          key: "entry-point", type: "circle",
          attrs: { x: entry.x, y: entry.y, r: 4 },
          styles: { style: "stroke_fill", color: "#0c1416", borderColor: entryColor + pointAlpha, borderSize: 2 },
          ignoreEvent: ignored,
        },
        {
          key: "entry-label", type: "text",
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
          ignoreEvent: ignored,
        },
      ];

      const exit = coordinates[1];
      if (exit) {
        const pnlValue = trade.realizedPnl;
        const pnlText = pnlValue == null ? "待核验" : (pnlValue >= 0 ? "+" : "") + pnlValue.toFixed(2);
        figures.unshift({
          type: "line",
          attrs: { coordinates: [entry, exit] },
          styles: { style: "dashed", size: 1, color: "#d6e7e3" + lineAlpha, dashedValue: [5, 5] },
          ignoreEvent: ignored,
        });
        figures.push(
          {
            key: "exit-point", type: "circle",
            attrs: { x: exit.x, y: exit.y, r: 4 },
            styles: { style: "stroke_fill", color: "#0c1416", borderColor: "#d9e8e4" + pointAlpha, borderSize: 2 },
            ignoreEvent: ignored,
          },
          {
            key: "exit-label", type: "text",
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
            ignoreEvent: ignored,
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
          ignoreEvent: overlayHoverIgnoreEvents,
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
          ignoreEvent: overlayHoverIgnoreEvents,
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

let corporateActionOverlayRegistered = false;

function ensureCorporateActionOverlay(registerOverlay: (template: OverlayTemplate<CorporateActionOverlayData>) => void) {
  if (corporateActionOverlayRegistered) return;
  registerOverlay({
    name: "corporateActionMarker",
    totalStep: 1,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates, bounding }) => {
      const action = overlay.extendData;
      const point = coordinates[0];
      if (!action || !point) return [];
      const markerY = bounding.height - 8;
      return [
        {
          type: "circle",
          attrs: { x: point.x, y: markerY, r: 5 },
          styles: { style: "stroke_fill", color: "#f1c86a", borderColor: "#261d08", borderSize: 2 },
          ignoreEvent: overlayHoverIgnoreEvents,
        },
        {
          type: "text",
          attrs: { x: point.x, y: markerY - 10, text: action.label, align: "center", baseline: "bottom" },
          styles: {
            color: "#1b1508",
            size: 10,
            weight: 800,
            backgroundColor: "#f1c86a",
            borderRadius: 4,
            paddingLeft: 4,
            paddingRight: 4,
            paddingTop: 2,
            paddingBottom: 2,
          },
          ignoreEvent: overlayHoverIgnoreEvents,
        },
      ];
    },
  });
  corporateActionOverlayRegistered = true;
}

function syncTradeMarkers(chart: Chart, tradeMarkers: TradeMarker[], onSelect?: (id: string, event: "entry" | "exit") => void) {
  chart.removeOverlay({ groupId: TRADE_MARKER_GROUP });
  tradeMarkers.forEach((trade) => {
    const points = [{ timestamp: trade.entryPlotTimestamp ?? trade.entryTimestamp, value: trade.entryPrice }];
    if (trade.exitTimestamp != null && trade.exitPrice != null) {
      points.push({ timestamp: trade.exitPlotTimestamp ?? trade.exitTimestamp, value: trade.exitPrice });
    }
    chart.createOverlay({
      name: "tradeLifecycle",
      groupId: TRADE_MARKER_GROUP,
      points,
      extendData: { ...trade, clickable: !!onSelect },
      onClick: onSelect ? ({ figure }) => { onSelect(trade.id, trade.eventKind === "exit" || figure?.key?.startsWith("exit") ? "exit" : "entry"); return true; } : undefined,
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
    trade.entryQty ?? trade.qty,
    trade.entryTimestamp, trade.entryPlotTimestamp, trade.exitPlotTimestamp, trade.eventKind,
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
  groupId = PROTECTION_LINE_GROUP,
  onContext?: (line: ProtectionLine) => void,
) {
  chart.removeOverlay({ groupId });
  protectionLines.forEach((line) => {
    chart.createOverlay({
      id: `protection:${line.id}`,
      name: "trainingProtectionLine",
      groupId,
      points: [{ timestamp: line.timestamp, value: line.price }],
      extendData: line,
      lock: !line.movable,
      zLevel: line.source === 'position' ? 30 : 29,
      onRightClick: event => { event.preventDefault?.(); onContext?.(event.overlay.extendData as ProtectionLine); },
      onPressedMoveEnd: ({ chart: eventChart, overlay }) => {
        const nextPrice = Number(overlay.points[0]?.value);
        if (Number.isFinite(nextPrice) && nextPrice > 0 && onMove(line, nextPrice)) return;
        const current = eventChart.getOverlays({ id: overlay.id })[0]?.extendData as ProtectionLine | undefined;
        if (!current) return;
        eventChart.overrideOverlay({
          id: overlay.id,
          points: [{ timestamp: current.timestamp, value: current.price }],
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

// This hit area follows the native last-price line. Dragging never moves the quote.
function syncCurrentPriceLine(chart: Chart, line: ProtectionLine | null, onMove: (line: ProtectionLine, price: number) => void, dragging: { current: boolean }) {
  const groupId = "current-price-drag";
  if (!line) { chart.removeOverlay({ groupId }); dragging.current = false; return; }
  const id = `protection:${line.id}`;
  if (chart.getOverlays({ id })[0]) {
    chart.overrideOverlay({ id, extendData: line, ...(!dragging.current ? { points: [{ timestamp: line.timestamp, value: line.price }] } : {}) });
    return;
  }
  chart.removeOverlay({ groupId }); dragging.current = false;
  let dragStartPrice = line.price;
  chart.createOverlay({ id, name: "trainingProtectionLine", groupId, points: [{ timestamp: line.timestamp, value: line.price }],
    extendData: line, lock: false, needDefaultPointFigure: false, zLevel: 28,
    onPressedMoveStart: ({ overlay }) => { dragging.current = true; dragStartPrice = Number(overlay.points[0]?.value); },
    onRightClick: event => event.preventDefault?.(),
    onPressedMoveEnd: ({ chart: eventChart, overlay }) => {
      dragging.current = false;
      const current = eventChart.getOverlays({ id })[0]?.extendData as ProtectionLine | undefined;
      if (!current) return;
      const price = Number(overlay.points[0]?.value);
      eventChart.overrideOverlay({ id, points: [{ timestamp: current.timestamp, value: current.price }] });
      if (Number.isFinite(price) && price > 0 && Math.abs(price - dragStartPrice) > Number.EPSILON * Math.max(1, price)) onMove(current, price);
    },
  });
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
    points: (overlay.name === "trainingRectangle" ? overlay.points.slice(0, 2) : overlay.points).map((point) => ({
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

  const converted = chart.convertToPixel(overlay.points.map(point => ({
    dataIndex: point.timestamp == null ? point.dataIndex : interpolatedDrawingIndex(chart.getDataList(), point.timestamp),
    value: point.value,
  })), { paneId: overlay.paneId });
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
  const effectiveBaseWidth = initializeBase ? width : baseWidth ?? inferredWidth;
  const effectiveBaseHeight = initializeBase ? height : baseHeight ?? inferredHeight;
  const effectiveBaseSize = initializeBase ? currentSize : baseSize ?? currentSize;
  const shouldScale = !initializeBase && baseWidth != null && baseHeight != null && baseSize != null;

  let nextSize = currentSize;
  if (shouldScale) {
    const scaleX = width / effectiveBaseWidth;
    const scaleY = height / effectiveBaseHeight;
    const xChanged = Math.abs(width - effectiveBaseWidth) > 0.01;
    const yChanged = Math.abs(height - effectiveBaseHeight) > 0.01;
    const scale = xChanged && yChanged
      ? Math.sqrt(scaleX * scaleY)
      : xChanged ? scaleX : scaleY;
    nextSize = Math.max(10, Math.min(96, effectiveBaseSize * scale));
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
  if (initializeBase || missingBaseline || nextSize !== currentSize) {
    chart.overrideOverlay({ id: overlay.id, styles: nextStyles, extendData: nextData });
  }
}

function getPersistedDrawings(chart: Chart, dataIndexOffset: number) {
  return chart.getOverlays({ groupId: USER_DRAWING_GROUP })
    .filter(overlay => overlay.currentStep === -1)
    .map((overlay) => serializeDrawing(overlay, dataIndexOffset));
}

/** Use the chart's native sub-bar drag support after the two-point text placement finishes. */
function enableTextBoxFreeMovement(overlay: Overlay) {
  if (overlay.name !== "trainingTextBox") return;
  overlay.drawingMode = "continuous";
  overlay.mode = "normal";
}

const periods: Record<TimeframeId, Period> = {
  "1m": { type: "minute", span: 1 },
  "5m": { type: "minute", span: 5 },
  "15m": { type: "minute", span: 15 },
  "30m": { type: "minute", span: 30 },
  "1h": { type: "hour", span: 1 },
  "4h": { type: "hour", span: 4 },
  "1d": { type: "day", span: 1 },
  "1w": { type: "week", span: 1 },
  "1mo": { type: "month", span: 1 },
};

export function KLineReplayChart({
  keyboardShortcuts,
  shortcutsEnabled = true,
  liveUpdates = false,
  bars,
  dataIndexOffset,
  symbol,
  timezone,
  timeframe,
  pricePrecision,
  movingAverageSettings,
  macdSettings,
  drawingRequest,
  clearNonce,
  tradeMarkers,
  decisionMarkers,
  corporateActionMarkers,
  protectionLines,
  priceSelectionMode,
  drawings,
  selectedDrawingId,
  drawingsRestoreNonce,
  hideDate,
  hidePrice,
  enableCandleContextMenu = true,
  latestCandleCountdown,
  focusTimestamp,
  focusNonce,
  onHistoryRange,
  onTradeSelect,
  onDecisionSelect,
  onCorporateActionSelect,
  onProtectionPriceSelect,
  onProtectionLineMove,
  onCandleContextMenu,
  onDrawingsChange,
  onDrawingSelect,
  onDrawingCancel,
  trading,
}: {
  keyboardShortcuts?: ShortcutSettings;
  shortcutsEnabled?: boolean;
  liveUpdates?: boolean;
  bars: KLineData[];
  dataIndexOffset: number;
  symbol: string;
  timezone: string;
  timeframe: string;
  pricePrecision: number;
  movingAverageSettings: MovingAverageSettings;
  macdSettings: MacdSettings;
  drawingRequest: DrawingRequest;
  clearNonce: number;
  tradeMarkers: TradeMarker[];
  decisionMarkers: DecisionMarker[];
  corporateActionMarkers: CorporateActionMarker[];
  protectionLines: ProtectionLine[];
  priceSelectionMode: PriceSelectionMode | null;
  drawings: PersistedDrawing[];
  selectedDrawingId: string;
  drawingsRestoreNonce: number;
  hideDate: boolean;
  hidePrice: boolean;
  enableCandleContextMenu?: boolean;
  latestCandleCountdown?: string | null;
  focusTimestamp?: number;
  focusNonce?: number;
  onHistoryRange?: (range: { before: boolean; after: boolean }) => void;
  onTradeSelect?: (id: string, event: "entry" | "exit") => void;
  onDecisionSelect: (id: string) => void;
  onCorporateActionSelect: (id: string) => void;
  onProtectionPriceSelect: (kind: PriceSelectionMode, price: number) => void;
  onProtectionLineMove: (line: ProtectionLine, price: number) => boolean;
  onCandleContextMenu: (target: CandleContextTarget, options?: { preserveChartViewport?: boolean }) => void;
  onDrawingsChange: (drawings: PersistedDrawing[]) => void;
  onDrawingSelect: (id: string | null) => void;
  onDrawingCancel?: () => void;
  trading?: ChartTradingAdapter;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const focusAppliedRef = useRef('');
  const preservedBarSpaceRef = useRef<number | null>(null);
  const refreshZoomAppliedRef = useRef(false);
  const barsRef = useRef<KLineData[]>(bars);
  const historyRangeRef = useRef(onHistoryRange);
  useEffect(() => { historyRangeRef.current = onHistoryRange; }, [onHistoryRange]);
  const countdownRef = useRef(latestCandleCountdown);
  const appliedBarsRef = useRef<KLineData[]>([]);
  const updateBarRef = useRef<((bar: KLineData) => void) | null>(null);
  const dataIndexOffsetRef = useRef(dataIndexOffset);
  const tradeMarkersRef = useRef<TradeMarker[]>(tradeMarkers);
  const decisionMarkersRef = useRef<DecisionMarker[]>(decisionMarkers);
  const corporateActionMarkersRef = useRef<CorporateActionMarker[]>(corporateActionMarkers);
  const protectionLinesRef = useRef<ProtectionLine[]>(protectionLines);
  const syncedTradeMarkersRef = useRef("");
  const syncedDecisionMarkersRef = useRef("");
  const syncedCorporateActionMarkersRef = useRef("");
  const syncedProtectionLinesRef = useRef("");
  const drawingsRef = useRef<PersistedDrawing[]>(drawings);
  const movingAverageSettingsRef = useRef(movingAverageSettings);
  const macdSettingsRef = useRef(macdSettings);
  const onDecisionSelectRef = useRef(onDecisionSelect);
  const onTradeSelectRef = useRef(onTradeSelect);
  useEffect(() => { onTradeSelectRef.current = onTradeSelect; }, [onTradeSelect]);
  const onCorporateActionSelectRef = useRef(onCorporateActionSelect);
  const onProtectionPriceSelectRef = useRef(onProtectionPriceSelect);
  const onProtectionLineMoveRef = useRef(onProtectionLineMove);
  const contextOperationRef = useRef<{ kind: "marker"; line: ProtectionLine } | { kind: "drawing" | "price-selection" } | null>(null);
  const rememberMarkerContext = useCallback((line: ProtectionLine) => { contextOperationRef.current = { kind: "marker", line }; }, []);
  // Native overlay right-clicks run on mousedown, before the DOM contextmenu.
  // Do not prevent their default action: drawings still delete/cancel normally.
  const rememberDrawingContext = useCallback(() => { contextOperationRef.current = { kind: "drawing" }; }, []);
  const onCandleContextMenuRef = useRef(onCandleContextMenu);
  const onDrawingsChangeRef = useRef(onDrawingsChange);
  const onDrawingSelectRef = useRef(onDrawingSelect);
  const onDrawingCancelRef = useRef(onDrawingCancel);
  const drawingRequestRef = useRef(drawingRequest);
  const drawingKey = drawingRequest ? `${drawingRequest.name}:${drawingRequest.nonce}` : "";
  const suppressDrawingEventsRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastContextTriggerRef = useRef<{ timestamp: number; triggeredAt: number } | null>(null);
  const [drawingActive, setDrawingActive] = useState(false);
  const shiftPercentRef = useRef(20);
  const followLatestRef = useRef(true);
  const applyingViewportRef = useRef(false);
  const [shiftHandle, setShiftHandle] = useState({ x: 0, percent: 20 });
  const [tradingTarget, setTradingTarget] = useState<ChartTradingTarget | null>(null);
  const tradingContext = `${trading?.scope ?? ""}:${drawingActive}:${priceSelectionMode ?? ""}`;
  const [menuContext, setMenuContext] = useState(tradingContext);
  if (menuContext !== tradingContext) { setMenuContext(tradingContext); setTradingTarget(null); }
  const closeTradingMenu = useCallback(() => setTradingTarget(null), []);
  const tradingRef = useRef(trading);
  const currentPriceDraggingRef = useRef(false);
  const currentPriceMoveRef = useRef<(line: ProtectionLine, price: number) => void>(() => {});
  useEffect(() => { tradingRef.current = trading; }, [trading]);
  useEffect(() => {
    currentPriceMoveRef.current = (line, rawPrice) => {
      const latest = tradingRef.current;
      if (!latest || latest.disabled || line.id !== `current-price:${latest.scope}`) return;
      const price = latest.normalizePrice?.(rawPrice) ?? Number(rawPrice.toFixed(pricePrecision));
      const bounds = containerRef.current?.getBoundingClientRect();
      if (!bounds || !latest.positions.length) return;
      latest.onOpen?.();
      if (latest.positions.length === 1) {
        const position = latest.positions[0];
        const kind = protectionKindAtPrice(position.side, price, position.referencePrice);
        if (kind) latest.onProtection(kind, price, position.id);
      } else setTradingTarget({ x: bounds.right - 280, y: bounds.top + 80, price, scope: latest.scope, candle: null, protectionOnly: true });
    };
  }, [pricePrecision]);
  const refreshCurrentPriceLine = useCallback((chart: Chart) => {
    const latest = tradingRef.current, last = barsRef.current.at(-1);
    const line: ProtectionLine | null = latest && !latest.disabled && latest.positions.length && last && !drawingActive && !priceSelectionMode
      ? { id: `current-price:${latest.scope}`, kind: "entry-trigger", price: last.close, timestamp: last.timestamp, label: "现价", hint: "拖动设置持仓止损或止盈", source: "rule", movable: true }
      : null;
    syncCurrentPriceLine(chart, line, (line, price) => currentPriceMoveRef.current(line, price), currentPriceDraggingRef);
    const cancellation = latest?.cancellation;
    const pendingLines: ProtectionLine[] = cancellation?.drawLines && last ? cancellation.orders.flatMap(order => [
      { id: `pending:${cancellation.scope}:${order.id}`, kind: "entry-trigger" as const, price: order.price, label: order.label },
      ...(order.stopLoss ? [{ id: `pending:${cancellation.scope}:${order.id}:stop-loss`, kind: "stop-loss" as const, price: order.stopLoss, label: `${order.label.split(" ")[0]} SL · ${order.stopLoss.toFixed(pricePrecision)}` }] : []),
      ...(order.takeProfit ? [{ id: `pending:${cancellation.scope}:${order.id}:take-profit`, kind: "take-profit" as const, price: order.takeProfit, label: `${order.label.split(" ")[0]} TP · ${order.takeProfit.toFixed(pricePrecision)}` }] : []),
    ].map(line => ({ ...line, timestamp: last.timestamp, hint: "拖动修改价格，右键管理订单", source: "order" as const, movable: !cancellation.disabled, orderId: order.id }))) : [];
    syncProtectionLines(chart, pendingLines, (line, price) => tradingRef.current?.onMarkerAction?.(line, price) ?? false, "pending-order-lines", rememberMarkerContext);
  }, [drawingActive, priceSelectionMode, pricePrecision, rememberMarkerContext]);
  const refreshCurrentPriceLineRef = useRef(refreshCurrentPriceLine);

  useKeyboardShortcuts({ settings: keyboardShortcuts, enabled: shortcutsEnabled, contextKey: `${symbol}:${timeframe}`,
    isAvailable: action => ["chartLeft", "chartRight", "chartZoomIn", "chartZoomOut", "chartLatest"].includes(action)
      && Boolean(chartRef.current?.getDataList().length) && !drawingActive && !priceSelectionMode,
    onAction: action => {
      const chart = chartRef.current;
      if (!chart) return false;
      if (action === "chartLeft" || action === "chartRight") {
        followLatestRef.current = false;
        chart.scrollByDistance(chart.getBarSpace().bar * (action === "chartLeft" ? 1 : -1), 0);
      } else if (action === "chartZoomIn" || action === "chartZoomOut") {
        chart.zoomAtCoordinate(action === "chartZoomIn" ? 1.15 : 1 / 1.15, undefined, 0);
      } else if (action === "chartLatest") {
        followLatestRef.current = true;
        alignViewport(chart, true);
      }
      return true;
    },
  });


  const alignViewport = useCallback((chart: Chart, forceLatest = false) => {
    const width = chart.getSize(PRICE_INDICATOR_PANE, "main")?.width ?? 0;
    const placement = chartShiftPlacement(width, chart.getBarSpace().bar, shiftPercentRef.current);
    if (!placement) return;
    setShiftHandle(previous => previous.x === placement.x && previous.percent === placement.percent ? previous : { x: placement.x, percent: placement.percent });
    if (!forceLatest && focusTimestamp && chart.getDataList().length && barsRef.current.some(bar => Math.abs(bar.timestamp - focusTimestamp) < 32 * 86400000)) {
      const focusKey = `${symbol}:${timeframe}:${focusTimestamp}:${focusNonce ?? 0}`;
      if (focusAppliedRef.current !== focusKey) {
        followLatestRef.current = false; applyingViewportRef.current = true;
        chart.scrollToTimestamp(focusTimestamp, 0); chart.scrollByDistance(-placement.rightOffset, 0);
        focusAppliedRef.current = focusKey; applyingViewportRef.current = false;
      }
    }
    if (!forceLatest && !followLatestRef.current) return;
    applyingViewportRef.current = true;
    chart.setOffsetRightDistance(placement.rightOffset);
    chart.scrollToRealTime(0);
    applyingViewportRef.current = false;
  }, [focusTimestamp, focusNonce, symbol, timeframe]);

  const changeChartShift = (percent: number) => {
    shiftPercentRef.current = Math.max(5, Math.min(50, percent));
    followLatestRef.current = true;
    if (chartRef.current) alignViewport(chartRef.current, true);
  };

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
    alignViewport(chart);
  }, [alignViewport]);

  const createPersistedDrawing = useCallback((chart: Chart, drawing: PersistedDrawing) => {
    const id = chart.createOverlay({
    id: drawing.id,
    name: drawing.name,
    groupId: USER_DRAWING_GROUP,
    paneId: drawing.paneId,
    points: (drawing.name === "trainingRectangle" ? rectangleControlPoints(drawing.points) : drawing.points).map(point => {
      if (drawing.name === "trainingTextBox" && point.timestamp != null) {
        return { ...point, dataIndex: interpolatedDrawingIndex(chart.getDataList(), point.timestamp) };
      }
      const index = point.timestamp == null ? -1 : chart.getDataList().findIndex(bar => bar.timestamp === point.timestamp);
      return { ...point, dataIndex: index >= 0 ? index : point.dataIndex == null ? undefined : point.dataIndex - dataIndexOffsetRef.current };
    }),
    ...(drawing.name === "trainingTextBox" ? { needDefaultPointFigure: drawing.id === selectedTrainingTextId } : {}),
    lock: drawing.lock,
    visible: drawing.visible,
    zLevel: drawing.zLevel,
    mode: drawing.mode,
    styles: drawing.styles as OverlayCreate["styles"],
    extendData: drawing.extendData,
    onRightClick: rememberDrawingContext,
    onDrawEnd: ({ chart: eventChart, overlay }) => {
      enableTextBoxFreeMovement(overlay);
      syncTrainingTextBoxScale(eventChart, overlay, true);
      if (!suppressDrawingEventsRef.current) {
        onDrawingsChangeRef.current(getPersistedDrawings(eventChart, dataIndexOffsetRef.current));
      }
    },
    onPressedMoveStart: ({ chart: eventChart, overlay }) => syncTrainingTextBoxScale(eventChart, overlay, true),
    onPressedMoving: ({ chart: eventChart, overlay, figure }) => {
      if (figure?.type === "circle") syncTrainingTextBoxScale(eventChart, overlay);
    },
    onPressedMoveEnd: ({ chart: eventChart, overlay, figure }) => {
      if (figure?.type === "circle") syncTrainingTextBoxScale(eventChart, overlay);
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
    });
    if (typeof id === "string") chart.getOverlays({ id }).forEach(enableTextBoxFreeMovement);
    return id;
  }, [rememberDrawingContext]);

  const restoreDrawings = useCallback((chart: Chart, nextDrawings: PersistedDrawing[]) => {
    suppressDrawingEventsRef.current = true;
    chart.getOverlays({ groupId: USER_DRAWING_GROUP }).filter(overlay => overlay.currentStep === -1).forEach(overlay => chart.removeOverlay({ id: overlay.id }));
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
      ensureCandleCountdownOverlay(registerOverlay);
      ensureDecisionOverlay(registerOverlay);
      ensureCorporateActionOverlay(registerOverlay);
      ensureTrainingDrawingOverlays(registerOverlay);
      const chart = init(containerRef.current, {
        // The application owns bindings and their enable/disable state.
        hotkey: { enabled: false },
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
              title: { show: false },
              text: { color: "#aab6ba" },
            } as LegacyCandleTooltipStyle,
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
      focusAppliedRef.current = '';
      followLatestRef.current = true;
      chart.setSymbol({ ticker: symbol, pricePrecision, volumePrecision: 0 });
      chart.setPeriod(periods[timeframe as TimeframeId] ?? periods["1d"]);
      chart.setDataLoader({
        getBars: ({ callback }) => {
          const currentBars = [...barsRef.current];
          // The chart mutates its input list when it appends a live candle.
          // Keep the previous application frame independent for rollover detection.
          appliedBarsRef.current = [...currentBars];
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
      let hoveredCorporateActionId = "";
      const handleCorporateActionCrosshair = (data?: unknown) => {
        const crosshair = data as Crosshair | undefined;
        const point = crosshair?.x != null
          ? (chart.convertFromPixel([{ x: crosshair.x, y: crosshair.y }], { paneId: PRICE_INDICATOR_PANE }) as Partial<Point>[])[0]
          : undefined;
        const timestamp = point?.timestamp;
        const hoveredAction = crosshair?.paneId === PRICE_INDICATOR_PANE && timestamp != null
          ? corporateActionMarkersRef.current.find((action) => action.barTimestamp === timestamp)
          : undefined;
        const nextId = hoveredAction?.id ?? "";
        if (nextId === hoveredCorporateActionId) return;
        hoveredCorporateActionId = nextId;
        onCorporateActionSelectRef.current(nextId);
      };
      chart.subscribeAction("onCrosshairChange", handleCorporateActionCrosshair);
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
      syncMacdIndicator(chart, macdSettingsRef.current);
      syncTradeMarkers(chart, tradeMarkersRef.current, onTradeSelectRef.current ? (id, event) => onTradeSelectRef.current?.(id,event) : undefined);
      syncedTradeMarkersRef.current = tradeMarkerSignature(tradeMarkersRef.current);
      syncDecisionMarkers(chart, decisionMarkersRef.current, (id) => onDecisionSelectRef.current(id));
      syncedDecisionMarkersRef.current = decisionMarkerSignature(decisionMarkersRef.current);
      syncCorporateActionMarkers(chart, corporateActionMarkersRef.current, (id) => onCorporateActionSelectRef.current(id));
      syncedCorporateActionMarkersRef.current = corporateActionMarkerSignature(corporateActionMarkersRef.current);
      syncProtectionLines(chart, protectionLinesRef.current, (line, price) => onProtectionLineMoveRef.current(line, price), PROTECTION_LINE_GROUP, rememberMarkerContext);
      refreshCurrentPriceLineRef.current(chart);
      syncedProtectionLinesRef.current = protectionLineSignature(protectionLinesRef.current);
      restoreDrawings(chart, drawingsRef.current);
      const latestCandleVisible = () => {
        const last = chart.getDataList().at(-1);
        const width = chart.getSize(PRICE_INDICATOR_PANE, "main")?.width ?? 0;
        const point = last ? chart.convertToPixel({ timestamp: last.timestamp, value: last.close }, { paneId: PRICE_INDICATOR_PANE }) : undefined;
        const coordinate = Array.isArray(point) ? point[0] : point;
        return isCandleInViewport(coordinate?.x, width, chart.getBarSpace().gapBar);
      };
      // Visible-range changes precede onZoom. Keep the settled pre-zoom state;
      // a zoom that reveals the latest candle must not also jump to it.
      let latestVisibleBeforeZoom = latestCandleVisible();
      let historyRangePending = false;
      const preserveCurrentZoom = () => {
        preservedBarSpaceRef.current = chart.getBarSpace().bar;
        if (!applyingViewportRef.current) {
          historyRangePending = true;
          followLatestRef.current = latestVisibleBeforeZoom;
          if (latestVisibleBeforeZoom) alignViewport(chart, true);
        }
        latestVisibleBeforeZoom = latestCandleVisible();
      };
      const preserveManualScroll = () => {
        if (!applyingViewportRef.current) { followLatestRef.current = false; historyRangePending = true; }
        latestVisibleBeforeZoom = latestCandleVisible();
      };
      chart.subscribeAction("onZoom", preserveCurrentZoom);
      chart.subscribeAction("onScroll", preserveManualScroll);
      // Axis measurement and indicator layout can change the plot width without
      // resizing its outer container. Wait for layout to settle before aligning;
      // onScroll runs after onVisibleRangeChange and must retain manual panning.
      let shiftLayoutFrame: number | null = null;
      const scheduleShiftLayout = () => {
        if (applyingViewportRef.current || shiftLayoutFrame != null) return;
        shiftLayoutFrame = requestAnimationFrame(() => {
          shiftLayoutFrame = null;
          if (chartRef.current === chart) {
            alignViewport(chart);
            latestVisibleBeforeZoom = latestCandleVisible();
            if (historyRangePending) {
              historyRangePending = false;
              const range = chart.getVisibleRange();
              historyRangeRef.current?.({ before: range.from < 30, after: range.to > chart.getDataList().length - 30 });
            }
          }
        });
      };
      chart.subscribeAction("onVisibleRangeChange", scheduleShiftLayout);
      const shiftResize = new ResizeObserver(scheduleShiftLayout);
      shiftResize.observe(chartContainer);
      requestAnimationFrame(() => { applyResponsiveViewport(chart, true); syncCandleCountdown(chart, countdownRef.current); });

      disposeChart = () => {
        preservedBarSpaceRef.current = chart.getBarSpace().bar;
        chartContainer.removeEventListener("wheel", handleWheelZoom, { capture: true });
        chart.unsubscribeAction("onZoom", preserveCurrentZoom);
        chart.unsubscribeAction("onScroll", preserveManualScroll);
        chart.unsubscribeAction("onVisibleRangeChange", scheduleShiftLayout);
        if (shiftLayoutFrame != null) cancelAnimationFrame(shiftLayoutFrame);
        shiftResize.disconnect();
        chart.unsubscribeAction("onCrosshairChange", handleCorporateActionCrosshair);
        onCorporateActionSelectRef.current("");
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
      syncedCorporateActionMarkersRef.current = "";
      syncedProtectionLinesRef.current = "";
    };
  }, [alignViewport, applyResponsiveViewport, hideDate, hidePrice, pricePrecision, rememberMarkerContext, restoreDrawings, symbol, timeframe, timezone]);

  useEffect(() => {
    barsRef.current = bars;
    const chart = chartRef.current;
    if (!chart) return;
    const barSpaceBeforeUpdate = chart.getBarSpace().bar;
    preservedBarSpaceRef.current = barSpaceBeforeUpdate;
    const previouslyApplied = appliedBarsRef.current;
    const previousLastTimestamp = previouslyApplied.at(-1)?.timestamp;
    const visibleBefore = chart.getVisibleRange();
    const anchorIndex = Math.max(0, Math.min(previouslyApplied.length - 1, Math.floor((visibleBefore.from + visibleBefore.to) / 2)));
    const anchorTimestamp = previouslyApplied[anchorIndex]?.timestamp;
    const anchorPoint = anchorTimestamp == null ? undefined : chart.convertToPixel({ timestamp: anchorTimestamp }, { paneId: PRICE_INDICATOR_PANE });
    const anchorX = (Array.isArray(anchorPoint) ? anchorPoint[0] : anchorPoint)?.x;
    const rebased = previouslyApplied.length > 0 && bars.length > 0 && previouslyApplied[0].timestamp !== bars[0].timestamp;
    const rebaseDrawingIndexes = () => {
      if (!rebased) return;
      const indexes = new Map(bars.map((bar, index) => [bar.timestamp, index]));
      chart.getOverlays({ groupId: USER_DRAWING_GROUP }).forEach(overlay => chart.overrideOverlay({
        id: overlay.id,
        points: overlay.points.map(point => ({ ...point, dataIndex: point.timestamp == null ? point.dataIndex
          : overlay.name === "trainingTextBox" ? interpolatedDrawingIndex(bars, point.timestamp)
          : indexes.get(point.timestamp) ?? point.dataIndex })),
      }));
    };
    const restoreViewport = () => {
      // A new current candle returns to the handle; same-bar quotes preserve manual panning.
      if (!focusTimestamp && bars.length && previousLastTimestamp !== bars.at(-1)?.timestamp) followLatestRef.current = true;
      if (followLatestRef.current) { alignViewport(chart); return; }
      if (anchorTimestamp == null || anchorX == null || !bars.some(bar => bar.timestamp === anchorTimestamp)) return;
      const nextPoint = chart.convertToPixel({ timestamp: anchorTimestamp }, { paneId: PRICE_INDICATOR_PANE });
      const nextX = (Array.isArray(nextPoint) ? nextPoint[0] : nextPoint)?.x;
      if (nextX == null) return;
      applyingViewportRef.current = true;
      chart.scrollByDistance(anchorX - nextX, 0);
      applyingViewportRef.current = false;
    };
    const updates = incrementalBarUpdates(previouslyApplied, bars);
    if (updates?.length === 0) return;
    const updateBar = updateBarRef.current;
    if (updates && updateBar) {
      // Replay and live quotes share the same tail-update path. A historical
      // correction, rewind or window rebase still requires an authoritative load.
      updates.forEach(updateBar);
      const chartBars = chart.getDataList();
      const chartLastTimestamp = chartBars.at(-1)?.timestamp;
      if (chartBars.length !== bars.length || chartLastTimestamp !== bars.at(-1)?.timestamp) {
        chart.resetData();
      } else {
        appliedBarsRef.current = [...bars];
      }
    } else {
      chart.resetData();
    }

    requestAnimationFrame(() => {
      if (chartRef.current !== chart) return;
      // KLineCharts draws candles and overlays on separate canvases. Explicitly
      // invalidate the layout so Chrome cannot retain an old candle layer while
      // a trade marker and the price axis continue to move.
      chart.resize();
      chart.setBarSpace(barSpaceBeforeUpdate);
      rebaseDrawingIndexes(); restoreViewport();
    });
  }, [alignViewport, bars, focusTimestamp, liveUpdates, onHistoryRange]);

  useEffect(() => {
    movingAverageSettingsRef.current = movingAverageSettings;
    if (chartRef.current) syncMovingAverageIndicators(chartRef.current, movingAverageSettings);
  }, [movingAverageSettings]);

  useEffect(() => {
    countdownRef.current = latestCandleCountdown;
    const frame = requestAnimationFrame(() => { if (chartRef.current) syncCandleCountdown(chartRef.current, latestCandleCountdown); });
    return () => cancelAnimationFrame(frame);
  }, [latestCandleCountdown, bars]);

  useEffect(() => {
    macdSettingsRef.current = macdSettings;
    if (chartRef.current) syncMacdIndicator(chartRef.current, macdSettings);
  }, [macdSettings]);

  useEffect(() => {
    const mobileQuery = window.matchMedia(MOBILE_CHART_QUERY);
    const handleViewportChange = () => {
      const chart = chartRef.current;
      if (!chart) return;
      requestAnimationFrame(() => alignViewport(chart));
    };

    mobileQuery.addEventListener("change", handleViewportChange);
    return () => mobileQuery.removeEventListener("change", handleViewportChange);
  }, [alignViewport]);

  useEffect(() => {
    tradeMarkersRef.current = tradeMarkers;
    const signature = tradeMarkerSignature(tradeMarkers);
    if (chartRef.current && signature !== syncedTradeMarkersRef.current) {
      syncTradeMarkers(chartRef.current, tradeMarkers, onTradeSelectRef.current ? (id, event) => onTradeSelectRef.current?.(id,event) : undefined);
      syncedTradeMarkersRef.current = signature;
      requestAnimationFrame(() => {
        if (chartRef.current) alignViewport(chartRef.current);
      });
    }
  }, [alignViewport, tradeMarkers]);

  useEffect(() => {
    decisionMarkersRef.current = decisionMarkers;
    const signature = decisionMarkerSignature(decisionMarkers);
    if (chartRef.current && signature !== syncedDecisionMarkersRef.current) {
      syncDecisionMarkers(chartRef.current, decisionMarkers, (id) => onDecisionSelectRef.current(id));
      syncedDecisionMarkersRef.current = signature;
    }
  }, [decisionMarkers]);

  useEffect(() => {
    corporateActionMarkersRef.current = corporateActionMarkers;
    const signature = corporateActionMarkerSignature(corporateActionMarkers);
    if (chartRef.current && signature !== syncedCorporateActionMarkersRef.current) {
      onCorporateActionSelectRef.current("");
      syncCorporateActionMarkers(
        chartRef.current,
        corporateActionMarkers,
        (id) => onCorporateActionSelectRef.current(id),
      );
      syncedCorporateActionMarkersRef.current = signature;
    }
  }, [corporateActionMarkers]);

  useEffect(() => {
    protectionLinesRef.current = protectionLines;
    const signature = protectionLineSignature(protectionLines);
    if (chartRef.current && signature !== syncedProtectionLinesRef.current) {
      syncProtectionLines(
        chartRef.current,
        protectionLines,
        (line, price) => onProtectionLineMoveRef.current(line, price),
        PROTECTION_LINE_GROUP, rememberMarkerContext,
      );
      syncedProtectionLinesRef.current = signature;
    }
  }, [protectionLines, rememberMarkerContext]);

  useEffect(() => {
    refreshCurrentPriceLineRef.current = refreshCurrentPriceLine;
    if (chartRef.current) refreshCurrentPriceLine(chartRef.current);
  }, [trading, bars, refreshCurrentPriceLine]);

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

  useEffect(() => { onDrawingCancelRef.current = onDrawingCancel; }, [onDrawingCancel]);
  useEffect(() => { if (priceSelectionMode && drawingKey) onDrawingCancelRef.current?.(); }, [drawingKey, priceSelectionMode]);
  useEffect(() => {
    drawingRequestRef.current = drawingRequest;
    if (!drawingRequest) return;
    chartRef.current?.getOverlays({ groupId: USER_DRAWING_GROUP }).filter(overlay => overlay.currentStep !== -1).forEach(overlay => {
      chartRef.current?.overrideOverlay({ id: overlay.id, styles: drawingRequest.styles as OverlayCreate["styles"], mode: drawingRequest.mode ?? "normal" });
    });
  }, [drawingRequest]);

  useEffect(() => {
    onDecisionSelectRef.current = onDecisionSelect;
  }, [onDecisionSelect]);

  useEffect(() => {
    onCorporateActionSelectRef.current = onCorporateActionSelect;
  }, [onCorporateActionSelect]);

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
    if (!drawingKey || !chartRef.current) return;
    const chart = chartRef.current;
    setDrawingInteraction(true, chart);
    let disposed = false;
    let pendingId: string | null = null;
    const finishDrawing = () => {
      if (disposed) return;
      disposed = true;
      setDrawingInteraction(false, chart);
      onDrawingCancelRef.current?.();
    };
    const createNext = () => {
      const drawingRequest = drawingRequestRef.current;
      if (disposed || !drawingRequest) return;
      const overlayId = chart.createOverlay({
        name: drawingRequest.name,
        groupId: USER_DRAWING_GROUP,
        ...(drawingRequest.name === "trainingTextBox" ? { needDefaultPointFigure: false } : {}),
        mode: drawingRequest.mode ?? "normal",
        modeSensitivity: 8,
        styles: drawingRequest.styles as OverlayCreate["styles"],
        extendData: drawingRequest.extendData,
        onRightClick: rememberDrawingContext,
        onDrawEnd: ({ chart: eventChart, overlay }) => {
          enableTextBoxFreeMovement(overlay);
          syncTrainingTextBoxScale(eventChart, overlay, true);
          selectedTrainingTextId = overlay.name === "trainingTextBox" ? overlay.id : "";
          eventChart.overrideOverlay({
            id: overlay.id,
            ...(overlay.name === "trainingTextBox" ? { needDefaultPointFigure: true } : {}),
          });
          onDrawingsChangeRef.current(getPersistedDrawings(eventChart, dataIndexOffsetRef.current));
          onDrawingSelectRef.current(overlay.id);
          pendingId = null;
          queueMicrotask(createNext);
        },
        onPressedMoveStart: ({ chart: eventChart, overlay }) => syncTrainingTextBoxScale(eventChart, overlay, true),
        onPressedMoving: ({ chart: eventChart, overlay, figure }) => {
          if (figure?.type === "circle") syncTrainingTextBoxScale(eventChart, overlay);
        },
        onPressedMoveEnd: ({ chart: eventChart, overlay, figure }) => {
          if (figure?.type === "circle") syncTrainingTextBoxScale(eventChart, overlay);
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
        onRemoved: ({ chart: eventChart, overlay }) => {
          if (!suppressDrawingEventsRef.current) {
            queueMicrotask(() => onDrawingsChangeRef.current(
              getPersistedDrawings(eventChart, dataIndexOffsetRef.current),
            ));
          }
          if (!suppressDrawingEventsRef.current && overlay.id === pendingId) finishDrawing();
        },
      });
      pendingId = typeof overlayId === "string" ? overlayId : null;
      if (!pendingId) finishDrawing();
    };
    createNext();
    return () => {
      disposed = true;
      const suppressed = suppressDrawingEventsRef.current;
      suppressDrawingEventsRef.current = true;
      try { if (pendingId) chart.removeOverlay({ id: pendingId }); }
      finally { suppressDrawingEventsRef.current = suppressed; }
      setDrawingInteraction(false, chart);
    };
  }, [drawingKey, rememberDrawingContext, setDrawingInteraction]);

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
    onDrawingCancelRef.current?.();
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
    if (!candlePane || x < 0 || x > (chart.getSize("candle_pane", "main")?.width ?? candlePane.width) || y < candlePane.top || y > candlePane.top + candlePane.height) return null;

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
    if (!candlePane || x < 0 || x > (chart.getSize("candle_pane", "main")?.width ?? candlePane.width) || y < candlePane.top || y > candlePane.top + candlePane.height) return null;
    const converted = chart.convertFromPixel([{ x, y }], { paneId: "candle_pane" });
    const point = Array.isArray(converted) ? converted[0] : converted;
    const value = Number(point?.value);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const triggerCandleContext = (target: CandleContextTarget, options?: { preserveChartViewport?: boolean }) => {
    const now = Date.now();
    const previous = lastContextTriggerRef.current;
    if (!options?.preserveChartViewport && previous?.timestamp === target.timestamp && now - previous.triggeredAt < 900) return;
    lastContextTriggerRef.current = { timestamp: target.timestamp, triggeredAt: now };
    onCandleContextMenuRef.current(target, options);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current != null) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    touchStartRef.current = null;
  };

  const handleContextMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 2) return;
    contextOperationRef.current = drawingActive ? { kind: "drawing" } : priceSelectionMode ? { kind: "price-selection" } : null;
    setTradingTarget(null);
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    cancelLongPress();
    const operation = contextOperationRef.current;
    contextOperationRef.current = null;
    if (!enableCandleContextMenu || drawingActive || priceSelectionMode || (operation && operation.kind !== "marker")) {
      setTradingTarget(null);
      return;
    }
    if (operation?.kind === "marker") {
      if (trading) {
        trading.onOpen?.();
        setTradingTarget({ x: event.clientX, y: event.clientY, price: operation.line.price, scope: trading.scope, candle: null, marker: operation.line });
      } else setTradingTarget(null);
      return;
    }
    if (trading) {
      const rawPrice = resolvePriceAt(event.clientX, event.clientY);
      if (rawPrice == null) return;
      trading.onOpen?.();
      const tolerance = Math.abs((resolvePriceAt(event.clientX, event.clientY + 6) ?? resolvePriceAt(event.clientX, event.clientY - 6) ?? rawPrice) - rawPrice);
      const cancelIds = pendingOrderIdsAtPrice(trading.cancellation?.orders ?? [], rawPrice, tolerance);
      const candle = resolveCandleAt(event.clientX, event.clientY);
      setTradingTarget({ x: event.clientX, y: event.clientY, price: trading.normalizePrice?.(rawPrice) ?? Number(rawPrice.toFixed(pricePrecision)), scope: trading.scope, candle, ...(cancelIds.length ? { cancelIds } : {}) });
      if (candle && !cancelIds.length) triggerCandleContext(candle, { preserveChartViewport: true });
      return;
    }
    const target = resolveCandleAt(event.clientX, event.clientY);
    if (!target) return;
    triggerCandleContext(target);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enableCandleContextMenu) return;
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

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (priceSelectionMode && !drawingActive && event.pointerType === "touch") {
      const price = resolvePriceAt(event.clientX, event.clientY);
      if (price != null) {
        onProtectionPriceSelectRef.current(priceSelectionMode, price);
      }
    }
    cancelLongPress();
  };

  const priceSelectionLabel = priceSelectionMode === "stop-loss"
    ? "止损"
    : priceSelectionMode === "take-profit"
      ? "止盈"
      : "触发价";

  return <><div
    ref={containerRef}
    className={`chart-canvas${drawingActive ? " drawing-active" : ""}${priceSelectionMode ? " price-selecting" : ""}`}
    aria-label={drawingActive
      ? `${symbol} K线图，正在绘图`
      : priceSelectionMode
        ? `${symbol} K线图，点击选择${priceSelectionLabel}`
        : enableCandleContextMenu
          ? symbol + (trading ? " K线图，右键同时打开交易菜单和补写事前决策，长按 K 线补写事前决策" : " K线图，右键或长按已揭示的 K 线可补写事前决策")
          : symbol + " K线图，仅用于查看和添加图表标记"}
    title={drawingActive
      ? "正在绘图：拖动手指不会滚动页面或平移图表"
      : priceSelectionMode
        ? `点击图表选择${priceSelectionLabel}`
        : enableCandleContextMenu ? trading ? undefined : "右键或长按已揭示的 K 线可补写事前决策" : "仅用于查看行情和添加图表标记"}
    onClickCapture={handleClick}
    onMouseDownCapture={handleContextMouseDown}
    onContextMenu={handleContextMenu}
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={handlePointerUp}
    onPointerCancel={cancelLongPress}
    onPointerLeave={() => {
      cancelLongPress();
      onCorporateActionSelectRef.current("");
    }}
  />{trading && tradingTarget?.scope === trading.scope && <ChartTradingMenu key={`${tradingTarget.x}:${tradingTarget.y}:${tradingTarget.price}:${tradingTarget.protectionOnly}:${tradingTarget.marker?.id}`} target={tradingTarget} trading={trading} priceLabel={hidePrice ? "—" : tradingTarget.price.toFixed(pricePrecision)} onDecision={onCandleContextMenu} onClose={closeTradingMenu} />}{shiftHandle.x > 0 && <button className="chart-shift-handle" style={{ left: shiftHandle.x }}
    role="slider" aria-label="平移图表" aria-valuemin={50} aria-valuemax={95} aria-valuenow={100 - shiftHandle.percent}
    aria-valuetext={`右侧留白 ${Math.round(shiftHandle.percent)}%`} title="拖动三角设置留白；最新 K 线可见时缩放对齐，换根自动对齐；方向键微调，双击恢复"
    onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId) || !chartRef.current || !containerRef.current) return;
      const width = chartRef.current.getSize(PRICE_INDICATOR_PANE, "main")?.width ?? 0;
      if (width) changeChartShift(100 * (1 - (event.clientX - containerRef.current.getBoundingClientRect().left) / width));
    }}
    onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onDoubleClick={() => changeChartShift(20)} onKeyDown={event => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault(); changeChartShift(event.key === "Home" ? 50 : event.key === "End" ? 5 : shiftPercentRef.current + (event.key === "ArrowLeft" ? 2 : -2));
      }
    }} />}</>;
}

function syncCorporateActionMarkers(
  chart: Chart,
  markers: CorporateActionMarker[],
  onSelect: (id: string) => void,
) {
  chart.removeOverlay({ groupId: CORPORATE_ACTION_GROUP });
  markers.forEach((action) => {
    chart.createOverlay({
      name: "corporateActionMarker",
      groupId: CORPORATE_ACTION_GROUP,
      points: [{ timestamp: action.barTimestamp, value: action.price }],
      extendData: { ...action, onSelect },
      lock: true,
      zLevel: 32,
    });
  });
}

function corporateActionMarkerSignature(markers: CorporateActionMarker[]) {
  return markers.map((action) => [action.id, action.barTimestamp, action.price, action.label, action.date, action.description].join(":")).join("|");
}
