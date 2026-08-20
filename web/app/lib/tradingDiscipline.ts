export type PretradePlanField = "marketState" | "location" | "reasons" | "stop" | "target" | "note";

export const pretradePlanFieldOptions: ReadonlyArray<{
  key: PretradePlanField;
  label: string;
  description: string;
}> = [
  { key: "marketState", label: "市场状态", description: "趋势、震荡、突破或反转尝试" },
  { key: "location", label: "当前位置", description: "回调、区间边缘或关键突破位" },
  { key: "reasons", label: "交易理由（至少 2 个）", description: "至少两个独立理由" },
  { key: "stop", label: "失效 / 止损", description: "什么情况证明判断失效" },
  { key: "target", label: "第一目标", description: "第一处计划兑现位置" },
  { key: "note", label: "计划说明", description: "等待什么、什么情况放弃" },
];

export const defaultRequiredPretradeFields: PretradePlanField[] = [
  "marketState",
  "location",
  "reasons",
  "stop",
  "target",
];
