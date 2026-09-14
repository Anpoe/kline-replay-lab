export type PatternKind =
  | "breakout"
  | "uptrend"
  | "uptrend_breakout"
  | "always_in_long"
  | "always_in_short"
  | "trend_pullback"
  | "contraction"
  | "bullish_engulfing"
  | "bearish_engulfing"
  | "breakout_retest"
  | "failed_breakout"
  | "long_lower_wick"
  | "us_daily_first_pullback"
  | "fx_5m_hourly_first_pullback"
  | "custom";

export type PatternConditionKind =
  | "price_vs_ema"
  | "ema_relation"
  | "ema_slope"
  | "breakout"
  | "volume_vs_average"
  | "range_contraction"
  | "candle_body"
  | "close_location"
  | "wick_ratio"
  | "atr_percent"
  | "engulfing"
  | "breakout_retest";

export type PatternConditionValue = number | string;

export type PatternCondition = {
  id: string;
  kind: PatternConditionKind;
  parameters: Record<string, PatternConditionValue>;
};

export type PatternPreset = {
  id: string;
  kind: PatternKind;
  name: string;
  description: string;
  builtIn: boolean;
  parameters: Record<string, number>;
  conditions?: PatternCondition[];
  enabled?: boolean;
};

export type PatternParameterDefinition = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
};

export type PatternConditionOption = {
  value: string;
  label: string;
};

export type PatternConditionField = {
  key: string;
  label: string;
  type: "number" | "select";
  defaultValue: PatternConditionValue;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  options?: readonly PatternConditionOption[];
};

export type PatternConditionDefinition = {
  kind: PatternConditionKind;
  group: string;
  label: string;
  description: string;
  fields: readonly PatternConditionField[];
};

export type PatternCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
};

export type PatternMatch = {
  index: number;
  timestamp: number;
  presetIds: string[];
  presetNames: string[];
};

export const patternParameterDefinitions: Record<PatternKind, PatternParameterDefinition[]> = {
  breakout: [
    { key: "lookback", label: "前高/前低回看", min: 5, max: 120, step: 1, suffix: "根" },
    { key: "minimumBreakoutPct", label: "最小突破幅度", min: 0, max: 10, step: 0.1, suffix: "%" },
    { key: "volumeMultiplier", label: "成交量相对均量", min: 0, max: 5, step: 0.1, suffix: "倍" },
  ],
  uptrend: [
    { key: "fastPeriod", label: "短均线周期", min: 3, max: 60, step: 1 },
    { key: "slowPeriod", label: "长均线周期", min: 8, max: 200, step: 1 },
    { key: "slopeLookback", label: "趋势斜率回看", min: 2, max: 60, step: 1, suffix: "根" },
    { key: "minimumRisePct", label: "长均线最小升幅", min: 0, max: 20, step: 0.1, suffix: "%" },
  ],
  uptrend_breakout: [
    { key: "fastPeriod", label: "短均线周期", min: 3, max: 60, step: 1 },
    { key: "slowPeriod", label: "长均线周期", min: 8, max: 200, step: 1 },
    { key: "slopeLookback", label: "趋势斜率回看", min: 2, max: 60, step: 1, suffix: "根" },
    { key: "minimumRisePct", label: "长均线最小升幅", min: 0, max: 20, step: 0.1, suffix: "%" },
    { key: "lookback", label: "突破前高回看", min: 5, max: 120, step: 1, suffix: "根" },
    { key: "minimumBreakoutPct", label: "最小突破幅度", min: 0, max: 10, step: 0.1, suffix: "%" },
    { key: "volumeMultiplier", label: "成交量相对均量", min: 0, max: 5, step: 0.1, suffix: "倍" },
  ],
  always_in_long: [
    { key: "emaPeriod", label: "趋势 EMA 周期", min: 5, max: 100, step: 1 },
    { key: "pivotStrength", label: "摆动点左右确认", min: 1, max: 5, step: 1, suffix: "根" },
    { key: "followThroughBars", label: "突破跟进窗口", min: 1, max: 4, step: 1, suffix: "根" },
    { key: "emaSlopeBars", label: "EMA 连续同向", min: 1, max: 10, step: 1, suffix: "根" },
    { key: "stateLookback", label: "状态有效回看", min: 20, max: 500, step: 10, suffix: "根" },
    { key: "recentBreakoutBars", label: "最近有效突破", min: 4, max: 60, step: 1, suffix: "根内" },
    { key: "controlWindow", label: "当前控制窗口", min: 6, max: 40, step: 1, suffix: "根" },
    { key: "minimumTrendCloses", label: "均线正确一侧最少收盘", min: 3, max: 40, step: 1, suffix: "根" },
    { key: "maximumEmaCrosses", label: "窗口内最多穿越 EMA", min: 0, max: 6, step: 1, suffix: "次" },
  ],
  always_in_short: [
    { key: "emaPeriod", label: "趋势 EMA 周期", min: 5, max: 100, step: 1 },
    { key: "pivotStrength", label: "摆动点左右确认", min: 1, max: 5, step: 1, suffix: "根" },
    { key: "followThroughBars", label: "突破跟进窗口", min: 1, max: 4, step: 1, suffix: "根" },
    { key: "emaSlopeBars", label: "EMA 连续同向", min: 1, max: 10, step: 1, suffix: "根" },
    { key: "stateLookback", label: "状态有效回看", min: 20, max: 500, step: 10, suffix: "根" },
    { key: "recentBreakoutBars", label: "最近有效突破", min: 4, max: 60, step: 1, suffix: "根内" },
    { key: "controlWindow", label: "当前控制窗口", min: 6, max: 40, step: 1, suffix: "根" },
    { key: "minimumTrendCloses", label: "均线正确一侧最少收盘", min: 3, max: 40, step: 1, suffix: "根" },
    { key: "maximumEmaCrosses", label: "窗口内最多穿越 EMA", min: 0, max: 6, step: 1, suffix: "次" },
  ],
  trend_pullback: [
    { key: "fastPeriod", label: "短均线周期", min: 3, max: 60, step: 1 },
    { key: "slowPeriod", label: "长均线周期", min: 8, max: 200, step: 1 },
    { key: "touchTolerancePct", label: "回踩容差", min: 0.1, max: 8, step: 0.1, suffix: "%" },
  ],
  contraction: [
    { key: "lookback", label: "收缩窗口", min: 3, max: 40, step: 1, suffix: "根" },
    { key: "rangeRatio", label: "近期/此前波幅上限", min: 0.1, max: 1, step: 0.05 },
  ],
  bullish_engulfing: [
    { key: "minimumBodyPct", label: "实体占整根最低比例", min: 0, max: 100, step: 5, suffix: "%" },
  ],
  bearish_engulfing: [
    { key: "minimumBodyPct", label: "实体占整根最低比例", min: 0, max: 100, step: 5, suffix: "%" },
  ],
  breakout_retest: [
    { key: "lookback", label: "突破基准回看", min: 5, max: 120, step: 1, suffix: "根" },
    { key: "retestWindow", label: "突破后回踩窗口", min: 1, max: 30, step: 1, suffix: "根" },
    { key: "tolerancePct", label: "回踩容差", min: 0.1, max: 8, step: 0.1, suffix: "%" },
  ],
  failed_breakout: [
    { key: "lookback", label: "前高/前低回看", min: 5, max: 120, step: 1, suffix: "根" },
    { key: "minimumPiercePct", label: "最小刺破幅度", min: 0, max: 5, step: 0.1, suffix: "%" },
  ],
  long_lower_wick: [
    { key: "wickBodyRatio", label: "下影/实体最低倍数", min: 1, max: 10, step: 0.25, suffix: "倍" },
    { key: "closeLocationPct", label: "收盘位于振幅上方", min: 40, max: 95, step: 5, suffix: "%" },
  ],
  us_daily_first_pullback: [
    { key: "fastPeriod", label: "短均线周期", min: 3, max: 60, step: 1 },
    { key: "slowPeriod", label: "长均线周期", min: 8, max: 200, step: 1 },
    { key: "slopeLookback", label: "趋势斜率回看", min: 2, max: 60, step: 1, suffix: "根" },
    { key: "minimumRisePct", label: "长均线最小升幅", min: 0, max: 20, step: 0.1, suffix: "%" },
    { key: "breakoutLookback", label: "突破前高回看", min: 5, max: 120, step: 1, suffix: "根" },
    { key: "breakoutWindow", label: "突破后首次回调窗口", min: 2, max: 30, step: 1, suffix: "根" },
    { key: "minimumBreakoutPct", label: "最小突破幅度", min: 0, max: 5, step: 0.1, suffix: "%" },
    { key: "volumeMultiplier", label: "突破量相对均量", min: 0, max: 5, step: 0.1, suffix: "倍" },
    { key: "atrPeriod", label: "ATR 周期", min: 5, max: 60, step: 1 },
    { key: "maximumAtrPct", label: "ATR 占价格上限", min: 1, max: 20, step: 0.5, suffix: "%" },
    { key: "retestToleranceAtr", label: "回踩容差", min: 0.1, max: 2, step: 0.1, suffix: "ATR" },
    { key: "maximumExtensionAtr", label: "距 EMA 最远", min: 0.5, max: 10, step: 0.25, suffix: "ATR" },
    { key: "minimumSignalBodyPct", label: "信号 K 最小实体", min: 20, max: 90, step: 5, suffix: "%" },
    { key: "minimumCloseLocationPct", label: "信号 K 最低收盘位置", min: 50, max: 95, step: 5, suffix: "%" },
  ],
  fx_5m_hourly_first_pullback: [
    { key: "higherTimeframeMinutes", label: "方向周期", min: 60, max: 60, step: 60, suffix: "分钟" },
    { key: "higherEmaPeriod", label: "高周期 EMA", min: 5, max: 100, step: 1 },
    { key: "higherSlopeBars", label: "高周期 EMA 斜率", min: 1, max: 12, step: 1, suffix: "根" },
    { key: "higherControlWindow", label: "高周期控制窗口", min: 3, max: 20, step: 1, suffix: "根" },
    { key: "higherMinimumTrendCloses", label: "高周期 EMA 上方收盘", min: 2, max: 20, step: 1, suffix: "根" },
    { key: "emaPeriod", label: "5 分钟趋势 EMA", min: 5, max: 100, step: 1 },
    { key: "pivotStrength", label: "摆动点左右确认", min: 1, max: 5, step: 1, suffix: "根" },
    { key: "followThroughBars", label: "突破跟进窗口", min: 1, max: 4, step: 1, suffix: "根" },
    { key: "emaSlopeBars", label: "EMA 连续同向", min: 1, max: 10, step: 1, suffix: "根" },
    { key: "stateLookback", label: "状态有效回看", min: 20, max: 500, step: 10, suffix: "根" },
    { key: "recentBreakoutBars", label: "最近有效突破", min: 4, max: 60, step: 1, suffix: "根内" },
    { key: "controlWindow", label: "5 分钟控制窗口", min: 6, max: 40, step: 1, suffix: "根" },
    { key: "minimumTrendCloses", label: "EMA 上方最少收盘", min: 3, max: 40, step: 1, suffix: "根" },
    { key: "maximumEmaCrosses", label: "控制窗口最多穿越 EMA", min: 0, max: 6, step: 1, suffix: "次" },
    { key: "breakoutLookback", label: "5 分钟突破回看", min: 5, max: 120, step: 1, suffix: "根" },
    { key: "breakoutWindow", label: "首次回调窗口", min: 2, max: 30, step: 1, suffix: "根" },
    { key: "minimumBreakoutPct", label: "最小突破幅度", min: 0, max: 5, step: 0.1, suffix: "%" },
    { key: "atrPeriod", label: "ATR 周期", min: 5, max: 60, step: 1 },
    { key: "retestToleranceAtr", label: "回踩容差", min: 0.1, max: 2, step: 0.1, suffix: "ATR" },
    { key: "maximumExtensionAtr", label: "距 EMA 最远", min: 0.5, max: 10, step: 0.25, suffix: "ATR" },
    { key: "minimumSignalBodyPct", label: "信号 K 最小实体", min: 20, max: 90, step: 5, suffix: "%" },
    { key: "minimumCloseLocationPct", label: "信号 K 最低收盘位置", min: 50, max: 95, step: 5, suffix: "%" },
  ],
  custom: [],
};

export const patternConditionDefinitions: readonly PatternConditionDefinition[] = [
  {
    kind: "price_vs_ema",
    group: "趋势指标",
    label: "收盘价与 EMA",
    description: "判断收盘价位于 EMA 上方或下方。",
    fields: [
      { key: "period", label: "EMA", type: "number", defaultValue: 20, min: 3, max: 200, step: 1, suffix: "根" },
      {
        key: "relation",
        label: "关系",
        type: "select",
        defaultValue: "above",
        options: [{ value: "above", label: "高于" }, { value: "below", label: "低于" }],
      },
    ],
  },
  {
    kind: "ema_relation",
    group: "趋势指标",
    label: "EMA 之间关系",
    description: "比较两条 EMA 的多空排列。",
    fields: [
      { key: "fastPeriod", label: "快线", type: "number", defaultValue: 10, min: 3, max: 200, step: 1, suffix: "根" },
      { key: "slowPeriod", label: "慢线", type: "number", defaultValue: 20, min: 3, max: 300, step: 1, suffix: "根" },
      {
        key: "relation",
        label: "关系",
        type: "select",
        defaultValue: "above",
        options: [{ value: "above", label: "高于" }, { value: "below", label: "低于" }],
      },
    ],
  },
  {
    kind: "ema_slope",
    group: "趋势指标",
    label: "EMA 方向",
    description: "判断 EMA 在指定回看范围内的方向和最小变化。",
    fields: [
      { key: "period", label: "EMA", type: "number", defaultValue: 20, min: 3, max: 200, step: 1, suffix: "根" },
      { key: "lookback", label: "回看", type: "number", defaultValue: 5, min: 1, max: 120, step: 1, suffix: "根" },
      {
        key: "direction",
        label: "方向",
        type: "select",
        defaultValue: "rising",
        options: [{ value: "rising", label: "上升" }, { value: "falling", label: "下降" }],
      },
      { key: "minimumPct", label: "最小变化", type: "number", defaultValue: 0, min: 0, max: 50, step: 0.1, suffix: "%" },
    ],
  },
  {
    kind: "breakout",
    group: "突破与回踩",
    label: "区间突破",
    description: "判断收盘价是否突破前方区间边界。",
    fields: [
      { key: "lookback", label: "回看", type: "number", defaultValue: 20, min: 5, max: 120, step: 1, suffix: "根" },
      {
        key: "direction",
        label: "方向",
        type: "select",
        defaultValue: "either",
        options: [{ value: "either", label: "任一方向" }, { value: "up", label: "向上" }, { value: "down", label: "向下" }],
      },
      { key: "minimumPct", label: "最小幅度", type: "number", defaultValue: 0.2, min: 0, max: 20, step: 0.1, suffix: "%" },
    ],
  },
  {
    kind: "breakout_retest",
    group: "突破与回踩",
    label: "突破回踩",
    description: "判断突破后是否回踩关键边界并守住。",
    fields: [
      { key: "lookback", label: "基准回看", type: "number", defaultValue: 20, min: 5, max: 120, step: 1, suffix: "根" },
      { key: "window", label: "回踩窗口", type: "number", defaultValue: 6, min: 1, max: 30, step: 1, suffix: "根" },
      {
        key: "direction",
        label: "方向",
        type: "select",
        defaultValue: "up",
        options: [{ value: "up", label: "向上突破" }, { value: "down", label: "向下突破" }],
      },
      { key: "tolerancePct", label: "回踩容差", type: "number", defaultValue: 1.2, min: 0.1, max: 8, step: 0.1, suffix: "%" },
    ],
  },
  {
    kind: "volume_vs_average",
    group: "量价与波幅",
    label: "成交量相对均量",
    description: "比较当前成交量与此前平均成交量。",
    fields: [
      { key: "lookback", label: "均量回看", type: "number", defaultValue: 20, min: 5, max: 120, step: 1, suffix: "根" },
      {
        key: "relation",
        label: "关系",
        type: "select",
        defaultValue: "at_least",
        options: [{ value: "at_least", label: "至少" }, { value: "at_most", label: "至多" }],
      },
      { key: "multiplier", label: "倍数", type: "number", defaultValue: 1.5, min: 0, max: 10, step: 0.1, suffix: "倍" },
    ],
  },
  {
    kind: "range_contraction",
    group: "量价与波幅",
    label: "波幅收缩",
    description: "比较近期平均振幅与此前同长度窗口。",
    fields: [
      { key: "lookback", label: "窗口", type: "number", defaultValue: 8, min: 3, max: 60, step: 1, suffix: "根" },
      { key: "ratio", label: "最大比例", type: "number", defaultValue: 0.65, min: 0.1, max: 1, step: 0.05 },
    ],
  },
  {
    kind: "atr_percent",
    group: "量价与波幅",
    label: "ATR 占价格",
    description: "限制 ATR 相对当前价格的比例。",
    fields: [
      { key: "period", label: "ATR", type: "number", defaultValue: 20, min: 5, max: 100, step: 1, suffix: "根" },
      {
        key: "relation",
        label: "关系",
        type: "select",
        defaultValue: "at_most",
        options: [{ value: "at_most", label: "至多" }, { value: "at_least", label: "至少" }],
      },
      { key: "percentage", label: "比例", type: "number", defaultValue: 8, min: 0.1, max: 50, step: 0.5, suffix: "%" },
    ],
  },
  {
    kind: "candle_body",
    group: "K 线形态",
    label: "K 线实体",
    description: "限制当前 K 线方向和实体占整根振幅的比例。",
    fields: [
      {
        key: "direction",
        label: "方向",
        type: "select",
        defaultValue: "bullish",
        options: [{ value: "bullish", label: "阳线" }, { value: "bearish", label: "阴线" }, { value: "any", label: "任意" }],
      },
      { key: "minimumPct", label: "最小实体", type: "number", defaultValue: 45, min: 0, max: 100, step: 5, suffix: "%" },
    ],
  },
  {
    kind: "close_location",
    group: "K 线形态",
    label: "收盘位置",
    description: "判断收盘价位于当前 K 线振幅的上方或下方。",
    fields: [
      {
        key: "direction",
        label: "位置",
        type: "select",
        defaultValue: "upper",
        options: [{ value: "upper", label: "上方" }, { value: "lower", label: "下方" }],
      },
      { key: "minimumPct", label: "最低位置", type: "number", defaultValue: 60, min: 5, max: 95, step: 5, suffix: "%" },
    ],
  },
  {
    kind: "wick_ratio",
    group: "K 线形态",
    label: "影线与实体",
    description: "比较上影线或下影线与实体的长度。",
    fields: [
      {
        key: "side",
        label: "影线",
        type: "select",
        defaultValue: "lower",
        options: [{ value: "lower", label: "下影线" }, { value: "upper", label: "上影线" }],
      },
      { key: "minimumRatio", label: "最低倍数", type: "number", defaultValue: 2.5, min: 1, max: 15, step: 0.25, suffix: "倍" },
    ],
  },
  {
    kind: "engulfing",
    group: "K 线形态",
    label: "吞没形态",
    description: "判断当前 K 线是否完整吞没上一根 K 线实体。",
    fields: [
      {
        key: "direction",
        label: "方向",
        type: "select",
        defaultValue: "bullish",
        options: [{ value: "bullish", label: "看涨吞没" }, { value: "bearish", label: "看跌吞没" }],
      },
      { key: "minimumBodyPct", label: "最小实体", type: "number", defaultValue: 45, min: 0, max: 100, step: 5, suffix: "%" },
    ],
  },
];

const patternConditionDefinitionMap = new Map(
  patternConditionDefinitions.map((definition) => [definition.kind, definition]),
);

export function createDefaultPatternCondition(kind: PatternConditionKind, id = "condition-1"): PatternCondition {
  const definition = patternConditionDefinitionMap.get(kind) ?? patternConditionDefinitions[0];
  return {
    id,
    kind: definition.kind,
    parameters: Object.fromEntries(definition.fields.map((field) => [field.key, field.defaultValue])),
  };
}

export const defaultPatternPresets: PatternPreset[] = [
  { id: "breakout", kind: "breakout", name: "区间突破", description: "收盘有效越过此前区间高点或低点，可附加成交量确认。", builtIn: true, parameters: { lookback: 20, minimumBreakoutPct: 0.2, volumeMultiplier: 0 } },
  { id: "uptrend", kind: "uptrend", name: "上升趋势", description: "价格位于短均线上方、短均线位于长均线上方，并且长均线持续向上。", builtIn: true, parameters: { fastPeriod: 10, slowPeriod: 20, slopeLookback: 5, minimumRisePct: 0.5 } },
  { id: "uptrend-breakout", kind: "uptrend_breakout", name: "上升趋势突破", description: "先确认均线多头和长均线抬升，再要求当前收盘向上突破此前区间高点。", builtIn: true, parameters: { fastPeriod: 10, slowPeriod: 20, slopeLookback: 5, minimumRisePct: 0.5, lookback: 20, minimumBreakoutPct: 0.1, volumeMultiplier: 0 } },
  { id: "always-in-long", kind: "always_in_long", name: "Always In Long（严格结构）", description: "HH/HL 后向上突破并跟进，且当前仍在 EMA 上方单边控制；排除过期状态与频繁穿越均线的震荡。", builtIn: true, parameters: { emaPeriod: 20, pivotStrength: 2, followThroughBars: 2, emaSlopeBars: 3, stateLookback: 120, recentBreakoutBars: 18, controlWindow: 12, minimumTrendCloses: 9, maximumEmaCrosses: 1 } },
  { id: "always-in-short", kind: "always_in_short", name: "Always In Short（严格结构）", description: "LH/LL 后向下突破并跟进，且当前仍在 EMA 下方单边控制；排除过期状态与频繁穿越均线的震荡。", builtIn: true, parameters: { emaPeriod: 20, pivotStrength: 2, followThroughBars: 2, emaSlopeBars: 3, stateLookback: 120, recentBreakoutBars: 18, controlWindow: 12, minimumTrendCloses: 9, maximumEmaCrosses: 1 } },
  { id: "trend-pullback", kind: "trend_pullback", name: "趋势回调", description: "短均线保持在长均线之上，价格回踩短均线后重新收在其上方。", builtIn: true, parameters: { fastPeriod: 10, slowPeriod: 20, touchTolerancePct: 1.5 } },
  { id: "contraction", kind: "contraction", name: "波幅收缩", description: "近期平均振幅显著小于此前同长度窗口，代表价格正在压缩。", builtIn: true, parameters: { lookback: 8, rangeRatio: 0.65 } },
  { id: "bullish-engulfing", kind: "bullish_engulfing", name: "看涨吞没", description: "阳线实体完整吞没上一根阴线实体。", builtIn: true, parameters: { minimumBodyPct: 45 } },
  { id: "bearish-engulfing", kind: "bearish_engulfing", name: "看跌吞没", description: "阴线实体完整吞没上一根阳线实体。", builtIn: true, parameters: { minimumBodyPct: 45 } },
  { id: "breakout-retest", kind: "breakout_retest", name: "突破回踩", description: "此前刚完成向上突破，随后回踩旧阻力且收盘仍守在其上方。", builtIn: true, parameters: { lookback: 20, retestWindow: 6, tolerancePct: 1.2 } },
  { id: "failed-breakout", kind: "failed_breakout", name: "失败突破", description: "价格刺破此前区间边界，但收盘重新回到区间内。", builtIn: true, parameters: { lookback: 20, minimumPiercePct: 0.1 } },
  { id: "long-lower-wick", kind: "long_lower_wick", name: "长下影线", description: "下影显著长于实体，同时收盘处于整根 K 线的上部。", builtIn: true, parameters: { wickBodyRatio: 2.5, closeLocationPct: 60 } },
  { id: "us-daily-first-pullback", kind: "us_daily_first_pullback", name: "美股日线｜强突破首次回调", description: "正常波动的上升趋势先强势突破，再等待第一次回踩守住关键位并以强阳线恢复。", builtIn: true, parameters: { fastPeriod: 10, slowPeriod: 20, slopeLookback: 5, minimumRisePct: 0.1, breakoutLookback: 20, breakoutWindow: 8, minimumBreakoutPct: 0.1, volumeMultiplier: 1, atrPeriod: 20, maximumAtrPct: 8, retestToleranceAtr: 0.6, maximumExtensionAtr: 3, minimumSignalBodyPct: 40, minimumCloseLocationPct: 65 } },
  { id: "fx-5m-hourly-first-pullback", kind: "fx_5m_hourly_first_pullback", name: "外汇 5 分钟｜1 小时顺势首次回调", description: "只使用已完成的 1 小时 K 线确认多头控制，再筛选 5 分钟强突破后的第一次回踩。", builtIn: true, parameters: { higherTimeframeMinutes: 60, higherEmaPeriod: 20, higherSlopeBars: 1, higherControlWindow: 4, higherMinimumTrendCloses: 3, emaPeriod: 20, pivotStrength: 1, followThroughBars: 1, emaSlopeBars: 1, stateLookback: 160, recentBreakoutBars: 30, controlWindow: 8, minimumTrendCloses: 5, maximumEmaCrosses: 3, breakoutLookback: 20, breakoutWindow: 18, minimumBreakoutPct: 0, atrPeriod: 20, retestToleranceAtr: 1, maximumExtensionAtr: 5, minimumSignalBodyPct: 30, minimumCloseLocationPct: 60 } },
];

function patternConditionHistory(condition: PatternCondition) {
  const p = condition.parameters;
  switch (condition.kind) {
    case "price_vs_ema":
    case "atr_percent":
      return Math.round(finite(p.period, 20) * 4);
    case "ema_relation":
      return Math.round(Math.max(finite(p.fastPeriod, 10), finite(p.slowPeriod, 20)) * 4);
    case "ema_slope":
      return Math.round(finite(p.period, 20) * 4 + finite(p.lookback, 5));
    case "breakout":
    case "volume_vs_average":
      return Math.round(finite(p.lookback, 20));
    case "breakout_retest":
      return Math.round(finite(p.lookback, 20) + finite(p.window, 6));
    case "range_contraction":
      return Math.round(finite(p.lookback, 8) * 2);
    case "candle_body":
    case "close_location":
    case "wick_ratio":
    case "engulfing":
      return 1;
    default:
      return 0;
  }
}

export function requiredPatternHistory(presets: PatternPreset[]) {
  return Math.min(1_000, Math.max(0, ...presets.map((preset) => {
    if (preset.kind === "custom") {
      return Math.max(0, ...(preset.conditions ?? []).map(patternConditionHistory));
    }
    const p = preset.parameters;
    if (preset.kind === "uptrend" || preset.kind === "uptrend_breakout") {
      return Math.max(
        Math.round(p.lookback ?? 0),
        Math.round((p.slowPeriod ?? 0) * 4 + (p.slopeLookback ?? 0)),
      );
    }
    if (preset.kind === "always_in_long" || preset.kind === "always_in_short") {
      return Math.round(
        (p.stateLookback ?? 120)
        + (p.emaPeriod ?? 20) * 4
        + (p.pivotStrength ?? 2) * 4
        + (p.followThroughBars ?? 2)
        + (p.emaSlopeBars ?? 3)
        + (p.controlWindow ?? 12),
      );
    }
    if (preset.kind === "trend_pullback") {
      return Math.round(Math.max(p.fastPeriod ?? 0, p.slowPeriod ?? 0) * 4);
    }
    if (preset.kind === "contraction") return Math.round((p.lookback ?? 0) * 2);
    if (preset.kind === "breakout_retest") {
      return Math.round((p.lookback ?? 0) + (p.retestWindow ?? 0));
    }
    if (preset.kind === "breakout" || preset.kind === "failed_breakout") {
      return Math.round(p.lookback ?? 0);
    }
    if (preset.kind === "bullish_engulfing" || preset.kind === "bearish_engulfing") return 1;
    if (preset.kind === "us_daily_first_pullback") {
      return Math.round(Math.max(
        (p.slowPeriod ?? 20) * 4 + (p.slopeLookback ?? 5),
        (p.breakoutLookback ?? 20) + (p.breakoutWindow ?? 8),
        p.atrPeriod ?? 20,
        30,
      ));
    }
    if (preset.kind === "fx_5m_hourly_first_pullback") {
      const sourceMinutes = 5;
      const higherMinutes = p.higherTimeframeMinutes ?? 60;
      const higherRatio = Math.max(1, Math.round(higherMinutes / sourceMinutes));
      const higherHistory = higherRatio * (
        (p.higherEmaPeriod ?? 20) * 3
        + Math.max(p.higherSlopeBars ?? 3, p.higherControlWindow ?? 6)
        + 2
      );
      const alwaysInHistory = (p.stateLookback ?? 120)
        + (p.emaPeriod ?? 20) * 4
        + (p.pivotStrength ?? 2) * 4
        + (p.followThroughBars ?? 2)
        + (p.emaSlopeBars ?? 3)
        + (p.controlWindow ?? 12);
      const setupHistory = (p.breakoutLookback ?? 20) + (p.breakoutWindow ?? 10) + (p.atrPeriod ?? 20);
      return Math.round(Math.max(higherHistory, alwaysInHistory, setupHistory));
    }
    return 0;
  })));
}

function finite(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePresetText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") return fallback;
  const text = value.trim().slice(0, maxLength);
  if (!text || text.includes("\uFFFD") || [...text].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 0x80 && codePoint <= 0x9f;
  })) return fallback;
  return text;
}

function normalizeConditionFieldValue(field: PatternConditionField, value: unknown) {
  if (field.type === "number") {
    const fallback = Number(field.defaultValue);
    const parsed = finite(value, fallback);
    const minimum = field.min ?? Number.NEGATIVE_INFINITY;
    const maximum = field.max ?? Number.POSITIVE_INFINITY;
    return Math.max(minimum, Math.min(maximum, parsed));
  }
  const candidate = String(value ?? field.defaultValue);
  return field.options?.some((option) => option.value === candidate)
    ? candidate
    : String(field.defaultValue);
}

export function normalizePatternConditions(value: unknown): PatternCondition[] {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set<string>();
  return value.flatMap((candidate, index): PatternCondition[] => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const item = candidate as Partial<PatternCondition>;
    const definition = patternConditionDefinitionMap.get(String(item.kind) as PatternConditionKind);
    if (!definition) return [];
    const rawParameters = item.parameters && typeof item.parameters === "object" && !Array.isArray(item.parameters)
      ? item.parameters as Record<string, unknown>
      : {};
    const baseId = typeof item.id === "string" && item.id.trim() ? item.id.trim().slice(0, 80) : `condition-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    return [{
      id,
      kind: definition.kind,
      parameters: Object.fromEntries(definition.fields.map((field) => [
        field.key,
        normalizeConditionFieldValue(field, rawParameters[field.key]),
      ])),
    }];
  }).slice(0, 12);
}

export function isPatternPresetAvailable(preset: PatternPreset | null | undefined) {
  return Boolean(preset && preset.enabled !== false);
}

export function visiblePatternPresets(presets: readonly PatternPreset[]) {
  return presets.filter((preset) => isPatternPresetAvailable(preset));
}

export function normalizePatternPresets(value: unknown): PatternPreset[] {
  if (!Array.isArray(value)) return defaultPatternPresets.map((preset) => ({ ...preset, parameters: { ...preset.parameters } }));
  const defaultsById = new Map(defaultPatternPresets.map((preset) => [preset.id, preset]));
  const normalized = value.flatMap((candidate): PatternPreset[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Partial<PatternPreset>;
    if (!item.id || !item.kind) return [];
    if (item.kind === "custom") {
      return [{
        id: String(item.id),
        kind: "custom",
        name: normalizePresetText(item.name, "自定义形态", 30),
        description: normalizePresetText(item.description, "由多个筛选条件组合而成。", 160),
        builtIn: false,
        parameters: {},
        conditions: normalizePatternConditions(item.conditions),
        ...(item.enabled === false ? { enabled: false } : {}),
      }];
    }
    if (!(item.kind in patternParameterDefinitions)) return [];
    const fallback = defaultsById.get(item.id) ?? defaultPatternPresets.find((preset) => preset.kind === item.kind);
    if (!fallback) return [];
    const parameters = Object.fromEntries(patternParameterDefinitions[item.kind].map((definition) => {
      const fallbackValue = fallback.parameters[definition.key] ?? definition.min;
      const nextValue = finite(item.parameters?.[definition.key], fallbackValue);
      return [definition.key, Math.max(definition.min, Math.min(definition.max, nextValue))];
    }));
    const builtIn = Boolean(item.builtIn && defaultsById.has(item.id));
    return [{
      id: String(item.id),
      kind: item.kind,
      name: builtIn ? fallback.name : normalizePresetText(item.name, fallback.name, 30),
      description: builtIn ? fallback.description : normalizePresetText(item.description, fallback.description, 160),
      builtIn,
      parameters,
      ...(item.enabled === false ? { enabled: false } : {}),
    }];
  });
  const found = new Set(normalized.map((preset) => preset.id));
  for (const preset of defaultPatternPresets) {
    if (!found.has(preset.id)) normalized.push({ ...preset, parameters: { ...preset.parameters } });
  }
  return normalized.slice(0, 40);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function emaAt(candles: PatternCandle[], index: number, period: number) {
  const start = Math.max(0, index - period * 4);
  const multiplier = 2 / (period + 1);
  let result = candles[start]?.close ?? 0;
  for (let cursor = start + 1; cursor <= index; cursor += 1) {
    result = candles[cursor].close * multiplier + result * (1 - multiplier);
  }
  return result;
}

type AlwaysInDirection = -1 | 0 | 1;
type SwingPoint = { index: number; price: number };
type PendingBreakout = { index: number; high: number; low: number; pivotIndex: number };

function patternInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(finite(value, fallback))));
}

function alwaysInStateSeries(
  candles: PatternCandle[],
  maximumIndex: number,
  parameters: Record<string, number>,
) {
  const endIndex = Math.min(candles.length - 1, Math.max(-1, Math.round(maximumIndex)));
  const states = new Int8Array(Math.max(0, endIndex + 1));
  if (endIndex < 0) return states;

  const emaPeriod = patternInteger(parameters.emaPeriod, 20, 5, 100);
  const pivotStrength = patternInteger(parameters.pivotStrength, 2, 1, 5);
  const followThroughBars = patternInteger(parameters.followThroughBars, 2, 1, 4);
  const emaSlopeBars = patternInteger(parameters.emaSlopeBars, 3, 1, 10);
  const stateLookback = patternInteger(parameters.stateLookback, 120, 20, 500);
  const recentBreakoutBars = patternInteger(parameters.recentBreakoutBars, 18, 4, 60);
  const controlWindow = patternInteger(parameters.controlWindow, 12, 6, 40);
  const minimumTrendCloses = patternInteger(parameters.minimumTrendCloses, 9, 3, controlWindow);
  const maximumEmaCrosses = patternInteger(parameters.maximumEmaCrosses, 1, 0, 6);
  const ema = new Float64Array(endIndex + 1);
  const multiplier = 2 / (emaPeriod + 1);
  ema[0] = candles[0].close;
  for (let index = 1; index <= endIndex; index += 1) {
    ema[index] = candles[index].close * multiplier + ema[index - 1] * (1 - multiplier);
  }

  const emaMoves = (index: number, direction: -1 | 1) => {
    if (index < emaSlopeBars) return false;
    for (let cursor = index - emaSlopeBars + 1; cursor <= index; cursor += 1) {
      if (direction === 1 ? ema[cursor] <= ema[cursor - 1] : ema[cursor] >= ema[cursor - 1]) return false;
    }
    return true;
  };
  const isConfirmedPivot = (index: number, direction: -1 | 1, knownIndex: number) => {
    if (index < pivotStrength || index + pivotStrength > knownIndex) return false;
    const price = direction === 1 ? candles[index].high : candles[index].low;
    for (let offset = 1; offset <= pivotStrength; offset += 1) {
      const left = direction === 1 ? candles[index - offset].high : candles[index - offset].low;
      const right = direction === 1 ? candles[index + offset].high : candles[index + offset].low;
      if (direction === 1 ? price <= left || price <= right : price >= left || price >= right) return false;
    }
    return true;
  };

  const swingHighs: SwingPoint[] = [];
  const swingLows: SwingPoint[] = [];
  let state: AlwaysInDirection = 0;
  let lastStateEvent = -1;
  let usedBullPivotIndex = -1;
  let usedBearPivotIndex = -1;
  let pendingBull: PendingBreakout | null = null;
  let pendingBear: PendingBreakout | null = null;

  for (let index = 0; index <= endIndex; index += 1) {
    const pivotIndex = index - pivotStrength;
    if (isConfirmedPivot(pivotIndex, 1, index)) {
      swingHighs.push({ index: pivotIndex, price: candles[pivotIndex].high });
      if (swingHighs.length > 2) swingHighs.shift();
    }
    if (isConfirmedPivot(pivotIndex, -1, index)) {
      swingLows.push({ index: pivotIndex, price: candles[pivotIndex].low });
      if (swingLows.length > 2) swingLows.shift();
    }

    const current = candles[index];
    const bullStructure = swingHighs.length === 2 && swingLows.length === 2
      && swingHighs[1].price > swingHighs[0].price
      && swingLows[1].price > swingLows[0].price;
    const bearStructure = swingHighs.length === 2 && swingLows.length === 2
      && swingHighs[1].price < swingHighs[0].price
      && swingLows[1].price < swingLows[0].price;

    if (pendingBull) {
      const age = index - pendingBull.index;
      if (current.close < pendingBull.low || age > followThroughBars) {
        pendingBull = null;
      } else if (age >= 1 && current.close > pendingBull.high && current.close > current.open
        && current.close > ema[index] && emaMoves(index, 1) && bullStructure) {
        state = 1;
        lastStateEvent = index;
        usedBullPivotIndex = pendingBull.pivotIndex;
        pendingBull = null;
        pendingBear = null;
      }
    }
    if (pendingBear) {
      const age = index - pendingBear.index;
      if (current.close > pendingBear.high || age > followThroughBars) {
        pendingBear = null;
      } else if (age >= 1 && current.close < pendingBear.low && current.close < current.open
        && current.close < ema[index] && emaMoves(index, -1) && bearStructure) {
        state = -1;
        lastStateEvent = index;
        usedBearPivotIndex = pendingBear.pivotIndex;
        pendingBear = null;
        pendingBull = null;
      }
    }

    if (state !== 0 && lastStateEvent >= 0 && index - lastStateEvent > stateLookback) state = 0;

    const previous = candles[index - 1];
    const latestHigh = swingHighs.at(-1);
    const latestLow = swingLows.at(-1);
    if (!pendingBull && latestHigh && latestHigh.index > usedBullPivotIndex && previous
      && previous.close <= latestHigh.price && current.close > latestHigh.price && current.close > current.open) {
      pendingBull = { index, high: current.high, low: current.low, pivotIndex: latestHigh.index };
    }
    if (!pendingBear && latestLow && latestLow.index > usedBearPivotIndex && previous
      && previous.close >= latestLow.price && current.close < latestLow.price && current.close < current.open) {
      pendingBear = { index, high: current.high, low: current.low, pivotIndex: latestLow.index };
    }
    const structureMatches = state === 1 ? bullStructure : state === -1 ? bearStructure : false;
    const windowStart = index - controlWindow + 1;
    let trendSideCloses = 0;
    let emaCrosses = 0;
    if (state !== 0 && windowStart >= 0) {
      let previousSide = Math.sign(candles[windowStart].close - ema[windowStart]);
      for (let cursor = windowStart; cursor <= index; cursor += 1) {
        const side = Math.sign(candles[cursor].close - ema[cursor]);
        if (state === 1 ? side > 0 : side < 0) trendSideCloses += 1;
        if (cursor > windowStart && side !== 0 && previousSide !== 0 && side !== previousSide) emaCrosses += 1;
        if (side !== 0) previousSide = side;
      }
    }
    const directionStillControls = state !== 0
      && structureMatches
      && lastStateEvent >= 0
      && index - lastStateEvent <= recentBreakoutBars
      && windowStart >= 0
      && trendSideCloses >= minimumTrendCloses
      && emaCrosses <= maximumEmaCrosses
      && (state === 1
        ? current.close > ema[index] && ema[index] > ema[windowStart] && current.close > candles[windowStart].close
        : current.close < ema[index] && ema[index] < ema[windowStart] && current.close < candles[windowStart].close);
    states[index] = directionStillControls ? state : 0;
  }
  return states;
}

function alwaysInDirectionAt(candles: PatternCandle[], index: number, parameters: Record<string, number>) {
  const emaPeriod = patternInteger(parameters.emaPeriod, 20, 5, 100);
  const pivotStrength = patternInteger(parameters.pivotStrength, 2, 1, 5);
  const followThroughBars = patternInteger(parameters.followThroughBars, 2, 1, 4);
  const emaSlopeBars = patternInteger(parameters.emaSlopeBars, 3, 1, 10);
  const stateLookback = patternInteger(parameters.stateLookback, 120, 20, 500);
  const controlWindow = patternInteger(parameters.controlWindow, 12, 6, 40);
  const history = stateLookback + emaPeriod * 4 + pivotStrength * 4 + followThroughBars + emaSlopeBars + controlWindow;
  const startIndex = Math.max(0, index - history);
  const window = candles.slice(startIndex, index + 1);
  const states = alwaysInStateSeries(window, window.length - 1, parameters);
  return (states.at(-1) ?? 0) as AlwaysInDirection;
}

function priorExtremes(candles: PatternCandle[], index: number, lookback: number) {
  const previous = candles.slice(Math.max(0, index - lookback), index);
  return {
    high: previous.length ? Math.max(...previous.map((bar) => bar.high)) : Number.NaN,
    low: previous.length ? Math.min(...previous.map((bar) => bar.low)) : Number.NaN,
  };
}

function isUptrend(candles: PatternCandle[], index: number, parameters: Record<string, number>) {
  const fast = Math.round(parameters.fastPeriod);
  const slow = Math.round(parameters.slowPeriod);
  const slopeLookback = Math.round(parameters.slopeLookback);
  if (fast >= slow || index < Math.max(slow, slopeLookback)) return false;
  const current = candles[index];
  const fastEma = emaAt(candles, index, fast);
  const slowEma = emaAt(candles, index, slow);
  const priorSlowEma = emaAt(candles, index - slopeLookback, slow);
  const minimumRise = parameters.minimumRisePct / 100;
  return current.close > fastEma
    && fastEma > slowEma
    && slowEma >= priorSlowEma * (1 + minimumRise);
}

function hasVolumeConfirmation(candles: PatternCandle[], index: number, lookback: number, multiplier: number) {
  if (multiplier <= 0) return true;
  const current = candles[index];
  if (!Number.isFinite(current?.volume)) return false;
  const volumeAverage = average(candles.slice(index - lookback, index).map((bar) => finite(bar.volume, 0)).filter((value) => value > 0));
  return volumeAverage <= 0 || finite(current.volume, 0) >= volumeAverage * multiplier;
}

function median(values: number[]) {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function observedIntervalMinutes(candles: PatternCandle[], index: number) {
  const intervals: number[] = [];
  const start = Math.max(1, index - 30);
  for (let cursor = start; cursor <= index; cursor += 1) {
    const interval = candles[cursor].timestamp - candles[cursor - 1].timestamp;
    if (interval > 0) intervals.push(interval / 60_000);
  }
  return median(intervals);
}

function matchesInterval(candles: PatternCandle[], index: number, expectedMinutes: number) {
  const observed = observedIntervalMinutes(candles, index);
  return Number.isFinite(observed) && Math.abs(observed - expectedMinutes) <= expectedMinutes * 0.12;
}

function averageTrueRangeAt(candles: PatternCandle[], index: number, period: number) {
  const start = Math.max(1, index - period + 1);
  if (index - start + 1 < period) return Number.NaN;
  const ranges: number[] = [];
  for (let cursor = start; cursor <= index; cursor += 1) {
    const current = candles[cursor];
    const previousClose = candles[cursor - 1].close;
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previousClose),
      Math.abs(current.low - previousClose),
    ));
  }
  return average(ranges);
}

function isStrongBullishCandle(bar: PatternCandle, minimumBodyPct: number, minimumCloseLocationPct: number) {
  const range = Math.max(bar.high - bar.low, Number.EPSILON);
  const bodyPct = (bar.close - bar.open) / range * 100;
  const closeLocationPct = (bar.close - bar.low) / range * 100;
  return bar.close > bar.open && bodyPct >= minimumBodyPct && closeLocationPct >= minimumCloseLocationPct;
}

type RecentBullBreakout = { index: number; boundary: number };

function findRecentStrongBullBreakout(
  candles: PatternCandle[],
  index: number,
  parameters: Record<string, number>,
  volumeMultiplier: number,
): RecentBullBreakout | null {
  const lookback = patternInteger(parameters.breakoutLookback, 20, 5, 120);
  const window = patternInteger(parameters.breakoutWindow, 8, 2, 30);
  const minimumBreakout = finite(parameters.minimumBreakoutPct, 0.1) / 100;
  const minimumBody = finite(parameters.minimumSignalBodyPct, 40);
  const minimumCloseLocation = finite(parameters.minimumCloseLocationPct, 65);
  for (let breakoutIndex = index - 1; breakoutIndex >= Math.max(lookback, index - window); breakoutIndex -= 1) {
    const bar = candles[breakoutIndex];
    const boundary = priorExtremes(candles, breakoutIndex, lookback).high;
    if (!Number.isFinite(boundary) || bar.close <= boundary * (1 + minimumBreakout)) continue;
    if (!isStrongBullishCandle(bar, minimumBody, minimumCloseLocation)) continue;
    if (!hasVolumeConfirmation(candles, breakoutIndex, lookback, volumeMultiplier)) continue;
    return { index: breakoutIndex, boundary };
  }
  return null;
}

function matchesFirstBullPullback(
  candles: PatternCandle[],
  index: number,
  breakout: RecentBullBreakout,
  parameters: Record<string, number>,
  anchorEmaPeriod: number,
) {
  const current = candles[index];
  const previous = candles[index - 1];
  if (!current || !previous) return false;
  const minimumBody = finite(parameters.minimumSignalBodyPct, 40);
  const minimumCloseLocation = finite(parameters.minimumCloseLocationPct, 65);
  if (!isStrongBullishCandle(current, minimumBody, minimumCloseLocation) || current.close <= previous.high) return false;

  let pullbackStart = -1;
  for (let cursor = breakout.index + 1; cursor <= index; cursor += 1) {
    const bar = candles[cursor];
    const prior = candles[cursor - 1];
    if (bar.close < prior.close || bar.low < prior.low) {
      pullbackStart = cursor;
      break;
    }
  }
  if (pullbackStart < 0) return false;
  for (let cursor = pullbackStart + 1; cursor < index; cursor += 1) {
    if (isStrongBullishCandle(candles[cursor], minimumBody, minimumCloseLocation)
      && candles[cursor].close > candles[cursor - 1].high) return false;
  }

  const atrPeriod = patternInteger(parameters.atrPeriod, 20, 5, 60);
  const atr = averageTrueRangeAt(candles, index, atrPeriod);
  if (!Number.isFinite(atr) || atr <= 0) return false;
  const tolerance = atr * finite(parameters.retestToleranceAtr, 0.6);
  const anchorEma = emaAt(candles, index, anchorEmaPeriod);
  const pullbackBars = candles.slice(pullbackStart, index + 1);
  const pullbackLow = Math.min(...pullbackBars.map((bar) => bar.low));
  const testedBreakout = Math.abs(pullbackLow - breakout.boundary) <= tolerance;
  const testedEma = Math.abs(pullbackLow - anchorEma) <= tolerance;
  if (!testedBreakout && !testedEma) return false;
  if (pullbackBars.some((bar) => bar.close < breakout.boundary - tolerance)) return false;
  if (current.close < breakout.boundary || current.close < anchorEma) return false;
  const maximumExtension = atr * finite(parameters.maximumExtensionAtr, 3);
  return current.close - anchorEma <= maximumExtension;
}

function matchesUsDailyFirstPullback(candles: PatternCandle[], index: number, parameters: Record<string, number>) {
  if (!matchesInterval(candles, index, 1_440) || !isUptrend(candles, index, parameters)) return false;
  const atrPeriod = patternInteger(parameters.atrPeriod, 20, 5, 60);
  const atr = averageTrueRangeAt(candles, index, atrPeriod);
  const current = candles[index];
  if (!Number.isFinite(atr) || atr <= 0 || atr / current.close * 100 > finite(parameters.maximumAtrPct, 8)) return false;
  const breakout = findRecentStrongBullBreakout(
    candles,
    index,
    parameters,
    finite(parameters.volumeMultiplier, 1),
  );
  return Boolean(breakout && matchesFirstBullPullback(
    candles,
    index,
    breakout,
    parameters,
    patternInteger(parameters.slowPeriod, 20, 8, 200),
  ));
}

function aggregateCompletedCandles(
  candles: PatternCandle[],
  index: number,
  targetMinutes: number,
  requiredTargetBars: number,
) {
  const sourceMinutes = observedIntervalMinutes(candles, index);
  if (!Number.isFinite(sourceMinutes) || targetMinutes <= sourceMinutes || targetMinutes % sourceMinutes !== 0) return [];
  const sourceMs = Math.round(sourceMinutes * 60_000);
  const targetMs = Math.round(targetMinutes * 60_000);
  const expectedBars = Math.round(targetMinutes / sourceMinutes);
  const minimumBars = Math.max(1, Math.floor(expectedBars * 0.8));
  const firstIndex = Math.max(0, index - expectedBars * (requiredTargetBars + 2));
  const knownThrough = candles[index].timestamp + sourceMs;
  const buckets = new Map<number, PatternCandle[]>();
  for (let cursor = firstIndex; cursor <= index; cursor += 1) {
    const bar = candles[cursor];
    const bucketStart = Math.floor(bar.timestamp / targetMs) * targetMs;
    const list = buckets.get(bucketStart) ?? [];
    list.push(bar);
    buckets.set(bucketStart, list);
  }
  return [...buckets.entries()].flatMap(([timestamp, bars]): PatternCandle[] => {
    if (timestamp + targetMs > knownThrough || bars.length < minimumBars) return [];
    const volumes = bars.map((bar) => bar.volume).filter((value): value is number => Number.isFinite(value));
    return [{
      timestamp,
      open: bars[0].open,
      high: Math.max(...bars.map((bar) => bar.high)),
      low: Math.min(...bars.map((bar) => bar.low)),
      close: bars.at(-1)?.close ?? bars[0].close,
      volume: volumes.length ? volumes.reduce((sum, value) => sum + value, 0) : null,
    }];
  });
}

function hasHigherTimeframeBullControl(candles: PatternCandle[], parameters: Record<string, number>) {
  const period = patternInteger(parameters.higherEmaPeriod, 20, 5, 100);
  const slopeBars = patternInteger(parameters.higherSlopeBars, 3, 1, 12);
  const controlWindow = patternInteger(parameters.higherControlWindow, 6, 3, 20);
  const minimumTrendCloses = patternInteger(
    parameters.higherMinimumTrendCloses,
    4,
    2,
    controlWindow,
  );
  const index = candles.length - 1;
  if (index < period * 2 + Math.max(slopeBars, controlWindow)) return false;
  const currentEma = emaAt(candles, index, period);
  const priorEma = emaAt(candles, index - slopeBars, period);
  if (candles[index].close <= currentEma || currentEma <= priorEma) return false;
  const windowStart = index - controlWindow + 1;
  let closesAbove = 0;
  let crosses = 0;
  let previousSide = Math.sign(candles[windowStart].close - emaAt(candles, windowStart, period));
  for (let cursor = windowStart; cursor <= index; cursor += 1) {
    const side = Math.sign(candles[cursor].close - emaAt(candles, cursor, period));
    if (side > 0) closesAbove += 1;
    if (cursor > windowStart && side !== 0 && previousSide !== 0 && side !== previousSide) crosses += 1;
    if (side !== 0) previousSide = side;
  }
  return closesAbove >= minimumTrendCloses && crosses <= 1 && candles[index].close > candles[windowStart].close;
}

function matchesFxFiveMinuteFirstPullback(candles: PatternCandle[], index: number, parameters: Record<string, number>) {
  if (!matchesInterval(candles, index, 5)) return false;
  const higherMinutes = patternInteger(parameters.higherTimeframeMinutes, 60, 15, 240);
  const higherPeriod = patternInteger(parameters.higherEmaPeriod, 20, 5, 100);
  const higherHistory = higherPeriod * 3
    + Math.max(
      patternInteger(parameters.higherSlopeBars, 3, 1, 12),
      patternInteger(parameters.higherControlWindow, 6, 3, 20),
    )
    + 2;
  const higherCandles = aggregateCompletedCandles(candles, index, higherMinutes, higherHistory);
  if (!hasHigherTimeframeBullControl(higherCandles, parameters)) return false;
  if (alwaysInDirectionAt(candles, index, parameters) !== 1) return false;
  const breakout = findRecentStrongBullBreakout(candles, index, parameters, 0);
  return Boolean(breakout && matchesFirstBullPullback(
    candles,
    index,
    breakout,
    parameters,
    patternInteger(parameters.emaPeriod, 20, 5, 100),
  ));
}

function conditionNumber(condition: PatternCondition, key: string, fallback: number) {
  return finite(condition.parameters[key], fallback);
}

function conditionRelation(condition: PatternCondition, key: string, fallback: string) {
  return String(condition.parameters[key] ?? fallback);
}

function averageVolumeAt(candles: PatternCandle[], index: number, lookback: number) {
  return average(candles
    .slice(Math.max(0, index - lookback), index)
    .map((bar) => finite(bar.volume, 0))
    .filter((value) => value > 0));
}

function matchesPatternCondition(candles: PatternCandle[], index: number, condition: PatternCondition) {
  const current = candles[index];
  if (!current) return false;
  const p = condition.parameters;
  switch (condition.kind) {
    case "price_vs_ema": {
      const period = patternInteger(p.period, 20, 3, 200);
      const ema = emaAt(candles, index, period);
      return conditionRelation(condition, "relation", "above") === "below"
        ? current.close < ema
        : current.close > ema;
    }
    case "ema_relation": {
      const fastPeriod = patternInteger(p.fastPeriod, 10, 3, 200);
      const slowPeriod = patternInteger(p.slowPeriod, 20, 3, 300);
      const fast = emaAt(candles, index, fastPeriod);
      const slow = emaAt(candles, index, slowPeriod);
      return conditionRelation(condition, "relation", "above") === "below" ? fast < slow : fast > slow;
    }
    case "ema_slope": {
      const period = patternInteger(p.period, 20, 3, 200);
      const lookback = patternInteger(p.lookback, 5, 1, 120);
      if (index < lookback) return false;
      const currentEma = emaAt(candles, index, period);
      const priorEma = emaAt(candles, index - lookback, period);
      const minimum = conditionNumber(condition, "minimumPct", 0) / 100;
      return conditionRelation(condition, "direction", "rising") === "falling"
        ? currentEma <= priorEma * (1 - minimum)
        : currentEma >= priorEma * (1 + minimum);
    }
    case "breakout": {
      const lookback = patternInteger(p.lookback, 20, 5, 120);
      if (index < lookback) return false;
      const boundary = priorExtremes(candles, index, lookback);
      const margin = conditionNumber(condition, "minimumPct", 0.2) / 100;
      const direction = conditionRelation(condition, "direction", "either");
      const brokeUp = current.close > boundary.high * (1 + margin);
      const brokeDown = current.close < boundary.low * (1 - margin);
      return direction === "up" ? brokeUp : direction === "down" ? brokeDown : brokeUp || brokeDown;
    }
    case "volume_vs_average": {
      const lookback = patternInteger(p.lookback, 20, 5, 120);
      const currentVolume = finite(current.volume, 0);
      const averageVolume = averageVolumeAt(candles, index, lookback);
      if (currentVolume <= 0 || averageVolume <= 0) return false;
      const threshold = averageVolume * Math.max(0, conditionNumber(condition, "multiplier", 1));
      return conditionRelation(condition, "relation", "at_least") === "at_most"
        ? currentVolume <= threshold
        : currentVolume >= threshold;
    }
    case "range_contraction": {
      const lookback = patternInteger(p.lookback, 8, 3, 60);
      if (index < lookback * 2 - 1) return false;
      const ranges = candles.map((bar) => Math.max(0, bar.high - bar.low));
      const recent = average(ranges.slice(index - lookback + 1, index + 1));
      const previous = average(ranges.slice(index - lookback * 2 + 1, index - lookback + 1));
      return previous > 0 && recent / previous <= conditionNumber(condition, "ratio", 0.65);
    }
    case "candle_body": {
      const bodyRatio = Math.abs(current.close - current.open)
        / Math.max(current.high - current.low, Number.EPSILON) * 100;
      const direction = conditionRelation(condition, "direction", "bullish");
      const directionMatches = direction === "any"
        || (direction === "bullish" && current.close > current.open)
        || (direction === "bearish" && current.close < current.open);
      return directionMatches && bodyRatio >= conditionNumber(condition, "minimumPct", 45);
    }
    case "close_location": {
      const location = (current.close - current.low)
        / Math.max(current.high - current.low, Number.EPSILON) * 100;
      const minimum = conditionNumber(condition, "minimumPct", 60);
      return conditionRelation(condition, "direction", "upper") === "lower"
        ? location <= 100 - minimum
        : location >= minimum;
    }
    case "wick_ratio": {
      const body = Math.max(Math.abs(current.close - current.open), (current.high - current.low) * 0.03);
      const side = conditionRelation(condition, "side", "lower");
      const wick = side === "upper"
        ? current.high - Math.max(current.open, current.close)
        : Math.min(current.open, current.close) - current.low;
      return wick / body >= conditionNumber(condition, "minimumRatio", 2.5);
    }
    case "atr_percent": {
      const period = patternInteger(p.period, 20, 5, 100);
      const atr = averageTrueRangeAt(candles, index, period);
      if (!Number.isFinite(atr) || current.close <= 0) return false;
      const percentage = atr / current.close * 100;
      const threshold = conditionNumber(condition, "percentage", 8);
      return conditionRelation(condition, "relation", "at_most") === "at_least"
        ? percentage >= threshold
        : percentage <= threshold;
    }
    case "engulfing": {
      const previous = candles[index - 1];
      if (!previous) return false;
      const bodyRatio = Math.abs(current.close - current.open)
        / Math.max(current.high - current.low, Number.EPSILON) * 100;
      if (bodyRatio < conditionNumber(condition, "minimumBodyPct", 45)) return false;
      return conditionRelation(condition, "direction", "bullish") === "bearish"
        ? previous.close > previous.open
          && current.close < current.open
          && current.open >= previous.close
          && current.close <= previous.open
        : previous.close < previous.open
          && current.close > current.open
          && current.open <= previous.close
          && current.close >= previous.open;
    }
    case "breakout_retest": {
      const lookback = patternInteger(p.lookback, 20, 5, 120);
      const window = patternInteger(p.window, 6, 1, 30);
      if (index < lookback + 1) return false;
      const tolerance = conditionNumber(condition, "tolerancePct", 1.2) / 100;
      const direction = conditionRelation(condition, "direction", "up");
      for (let breakoutIndex = Math.max(lookback, index - window); breakoutIndex < index; breakoutIndex += 1) {
        const boundary = priorExtremes(candles, breakoutIndex, lookback);
        if (direction === "down") {
          if (!Number.isFinite(boundary.low) || candles[breakoutIndex].close >= boundary.low) continue;
          if (current.high >= boundary.low * (1 - tolerance)
            && current.high <= boundary.low * (1 + tolerance)
            && current.close <= boundary.low) return true;
        } else {
          if (!Number.isFinite(boundary.high) || candles[breakoutIndex].close <= boundary.high) continue;
          if (current.low <= boundary.high * (1 + tolerance)
            && current.low >= boundary.high * (1 - tolerance)
            && current.close >= boundary.high) return true;
        }
      }
      return false;
    }
    default:
      return false;
  }
}

function matchesCustomPattern(candles: PatternCandle[], index: number, preset: PatternPreset) {
  const conditions = preset.conditions ?? [];
  return conditions.length > 0 && conditions.every((condition) => matchesPatternCondition(candles, index, condition));
}

export function matchesPattern(candles: PatternCandle[], index: number, preset: PatternPreset) {
  const current = candles[index];
  if (!current || !isPatternPresetAvailable(preset)) return false;
  const p = preset.parameters;
  if (preset.kind === "custom") return matchesCustomPattern(candles, index, preset);
  if (preset.kind === "breakout") {
    const lookback = Math.round(p.lookback);
    if (index < lookback) return false;
    const boundary = priorExtremes(candles, index, lookback);
    const margin = p.minimumBreakoutPct / 100;
    const broke = current.close > boundary.high * (1 + margin) || current.close < boundary.low * (1 - margin);
    if (!broke) return false;
    return hasVolumeConfirmation(candles, index, lookback, p.volumeMultiplier);
  }
  if (preset.kind === "uptrend") {
    return isUptrend(candles, index, p);
  }
  if (preset.kind === "uptrend_breakout") {
    const lookback = Math.round(p.lookback);
    if (index < lookback || !isUptrend(candles, index, p)) return false;
    const boundary = priorExtremes(candles, index, lookback).high;
    const brokeUp = current.close > boundary * (1 + p.minimumBreakoutPct / 100);
    return brokeUp && hasVolumeConfirmation(candles, index, lookback, p.volumeMultiplier);
  }
  if (preset.kind === "always_in_long" || preset.kind === "always_in_short") {
    const direction = alwaysInDirectionAt(candles, index, p);
    return preset.kind === "always_in_long" ? direction === 1 : direction === -1;
  }
  if (preset.kind === "trend_pullback") {
    const fast = Math.round(p.fastPeriod);
    const slow = Math.round(p.slowPeriod);
    if (index < slow) return false;
    const fastEma = emaAt(candles, index, fast);
    const slowEma = emaAt(candles, index, slow);
    const tolerance = p.touchTolerancePct / 100;
    return fastEma > slowEma && current.low <= fastEma * (1 + tolerance) && current.close >= fastEma && current.close > current.open;
  }
  if (preset.kind === "contraction") {
    const lookback = Math.round(p.lookback);
    if (index < lookback * 2 - 1) return false;
    const ranges = candles.map((bar) => Math.max(0, bar.high - bar.low));
    const recent = average(ranges.slice(index - lookback + 1, index + 1));
    const previous = average(ranges.slice(index - lookback * 2 + 1, index - lookback + 1));
    return previous > 0 && recent / previous <= p.rangeRatio;
  }
  if (preset.kind === "bullish_engulfing" || preset.kind === "bearish_engulfing") {
    const previous = candles[index - 1];
    if (!previous) return false;
    const bodyRatio = Math.abs(current.close - current.open) / Math.max(current.high - current.low, Number.EPSILON) * 100;
    if (bodyRatio < p.minimumBodyPct) return false;
    if (preset.kind === "bullish_engulfing") {
      return previous.close < previous.open && current.close > current.open && current.open <= previous.close && current.close >= previous.open;
    }
    return previous.close > previous.open && current.close < current.open && current.open >= previous.close && current.close <= previous.open;
  }
  if (preset.kind === "breakout_retest") {
    const lookback = Math.round(p.lookback);
    const retestWindow = Math.round(p.retestWindow);
    if (index < lookback + 1) return false;
    for (let breakoutIndex = Math.max(lookback, index - retestWindow); breakoutIndex < index; breakoutIndex += 1) {
      const boundary = priorExtremes(candles, breakoutIndex, lookback).high;
      if (!Number.isFinite(boundary) || candles[breakoutIndex].close <= boundary) continue;
      const tolerance = p.tolerancePct / 100;
      if (current.low <= boundary * (1 + tolerance) && current.low >= boundary * (1 - tolerance) && current.close >= boundary) return true;
    }
    return false;
  }
  if (preset.kind === "failed_breakout") {
    const lookback = Math.round(p.lookback);
    if (index < lookback) return false;
    const boundary = priorExtremes(candles, index, lookback);
    const margin = p.minimumPiercePct / 100;
    const failedUp = current.high > boundary.high * (1 + margin) && current.close < boundary.high;
    const failedDown = current.low < boundary.low * (1 - margin) && current.close > boundary.low;
    return failedUp || failedDown;
  }
  if (preset.kind === "long_lower_wick") {
    const body = Math.max(Math.abs(current.close - current.open), (current.high - current.low) * 0.03);
    const lowerWick = Math.min(current.open, current.close) - current.low;
    const closeLocation = (current.close - current.low) / Math.max(current.high - current.low, Number.EPSILON) * 100;
    return lowerWick / body >= p.wickBodyRatio && closeLocation >= p.closeLocationPct;
  }
  if (preset.kind === "us_daily_first_pullback") {
    return matchesUsDailyFirstPullback(candles, index, p);
  }
  if (preset.kind === "fx_5m_hourly_first_pullback") {
    return matchesFxFiveMinuteFirstPullback(candles, index, p);
  }
  return false;
}

export function findPatternMatches(
  candles: PatternCandle[],
  presets: PatternPreset[],
  options: { cooldownBars?: number; startTimestamp?: number; endTimestamp?: number; maximumIndex?: number } = {},
) {
  const matches: PatternMatch[] = [];
  const cooldownBars = Math.max(0, Math.round(options.cooldownBars ?? 0));
  const maximumIndex = Math.min(candles.length - 1, options.maximumIndex ?? candles.length - 1);
  const alwaysInStates = new Map<PatternPreset, Int8Array>();
  for (const preset of presets) {
    if (preset.kind === "always_in_long" || preset.kind === "always_in_short") {
      alwaysInStates.set(preset, alwaysInStateSeries(candles, maximumIndex, preset.parameters));
    }
  }
  let lastAcceptedIndex = -cooldownBars - 1;
  for (let index = 0; index <= maximumIndex; index += 1) {
    const candle = candles[index];
    if (options.startTimestamp != null && candle.timestamp < options.startTimestamp) continue;
    if (options.endTimestamp != null && candle.timestamp > options.endTimestamp) continue;
    const hitPresets = presets.filter((preset) => {
      const states = alwaysInStates.get(preset);
      if (!states) return matchesPattern(candles, index, preset);
      return preset.kind === "always_in_long" ? states[index] === 1 : states[index] === -1;
    });
    if (!hitPresets.length || index - lastAcceptedIndex <= cooldownBars) continue;
    matches.push({
      index,
      timestamp: candle.timestamp,
      presetIds: hitPresets.map((preset) => preset.id),
      presetNames: hitPresets.map((preset) => preset.name),
    });
    lastAcceptedIndex = index;
  }
  return matches;
}
